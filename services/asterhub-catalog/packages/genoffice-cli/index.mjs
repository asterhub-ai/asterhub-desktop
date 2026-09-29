import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'

export const name = 'asterhub-genoffice-cli'
export const inject = ['tools', 'profileContext']

const SERVER_NAME = 'aster_genoffice'
const MAX_PUBLIC_TOOL_NAME_LENGTH = 64
const INVALID_PUBLIC_TOOL_NAME_CHARS = /[^A-Za-z0-9_-]/g
const PUBLIC_TOOL_NAME_HASH_LENGTH = 12
const MCP_TIMEOUT_MS = 120_000
const MAX_SESSION_SERVERS = 8
const ALLOWED_TOOLS = new Set([
  'info',
  'create_docx',
  'create_xlsx',
  'create_pptx',
  'deck_start',
  'deck_page',
  'deck_build',
  'deck_replace',
  'docs_apply',
  'docs_check',
  'docs_read',
  'guide',
  'merge',
  'pdf_read',
  'sheet_apply',
  'sheet_check',
  'sheet_read',
  'slides_apply',
  'slides_audit',
  'slides_check',
  'slides_read',
  'slides_replace',
])
const WRITE_TOOLS = new Set([
  'create_docx',
  'create_xlsx',
  'create_pptx',
  'deck_start',
  'deck_page',
  'deck_build',
  'deck_replace',
  'docs_apply',
  'merge',
  'sheet_apply',
  'slides_apply',
  'slides_replace',
])

const cliEntry = fileURLToPath(new URL('./resources/cli/genoffice.cjs', import.meta.url))

function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_PUBLIC_TOOL_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_TOOL_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, PUBLIC_TOOL_NAME_HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_TOOL_NAME_LENGTH - PUBLIC_TOOL_NAME_HASH_LENGTH - 1)}_${hash}`
}

function childEnvironment(root) {
  return {
    ...scrubbedParentEnv(),
    ELECTRON_RUN_AS_NODE: '1',
    GENOFFICE_ALLOWED_ROOTS: root,
    GENOFFICE_AUDIT_LOG: 'off',
  }
}

async function openClient(root) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, 'mcp'],
    cwd: root,
    env: childEnvironment(root),
  })
  const client = new Client({ name: 'asterhub-genoffice', version: '0.11.0' }, { capabilities: {} })
  await client.connect(transport)
  return { client, transport }
}

async function sessionRoot(execution) {
  const cwd = execution.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
    throw new Error('GenOffice requires an active session with an absolute workspace directory')
  }
  const root = await realpath(cwd)
  if (!(await stat(root)).isDirectory()) throw new Error('GenOffice workspace is not a directory')
  return root
}

function writeApproval(ctx, toolName) {
  return ctx.on('tools/pre-execute', async (execution, next) => {
    if (execution.name !== publicToolName(SERVER_NAME, toolName)) return next()
    if (!WRITE_TOOLS.has(toolName)) return next()
    const approval = ctx.get('approval')
    if (approval === undefined || execution.agent === undefined) {
      return { kind: 'deny', reason: 'GenOffice file changes require an available workspace approval prompt.' }
    }
    const root = execution.agent.session.header.cwd
    const outcome = await approval.request({
      agent: execution.agent,
      toolName: execution.name,
      callId: execution.callId,
      reason: `Allow GenOffice to create or modify files inside the current workspace${root ? ` (${root})` : ''}?`,
      signal: execution.signal,
    })
    return outcome === 'allowed-once'
      ? next()
      : { kind: 'deny', reason: outcome === 'rejected' ? 'The user rejected the GenOffice file change.' : 'GenOffice file change approval was unavailable or cancelled.' }
  })
}

/** Install the GenOffice CLI/MCP bridge with per-session file roots and write approval. */
export async function apply(ctx) {
  const profileRoot = await realpath(ctx.profileContext.cwd)
  const discovery = await openClient(profileRoot)
  let tools
  try {
    tools = (await discovery.client.listTools(undefined, { cacheMode: 'refresh' })).tools
  }
  finally {
    await discovery.client.close()
  }

  const available = new Map(tools.filter(tool => ALLOWED_TOOLS.has(tool.name)).map(tool => [tool.name, tool]))
  if (available.size !== ALLOWED_TOOLS.size) {
    const missing = [...ALLOWED_TOOLS].filter(tool => !available.has(tool))
    throw new Error(`GenOffice CLI package is missing curated tools: ${missing.join(', ')}`)
  }

  const connections = new Map()
  const disposers = []
  const releaseConnection = async connection => {
    if (!connection) return
    connections.delete(connection.sessionId)
    await connection.client.close().catch(() => undefined)
  }

  const connectSession = async execution => {
    const root = await sessionRoot(execution)
    const sessionId = execution.agent.session.id
    const existing = connections.get(sessionId)
    if (existing?.root === root && !existing.closed) return existing
    if (existing) await releaseConnection(existing)

    if (connections.size >= MAX_SESSION_SERVERS) {
      const oldest = [...connections.values()]
        .filter(connection => connection.inFlight === 0)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0]
      if (oldest === undefined) throw new Error('GenOffice reached its active workspace limit; retry after another session finishes')
      await releaseConnection(oldest)
    }

    const opened = await openClient(root)
    const connection = {
      sessionId,
      root,
      client: opened.client,
      transport: opened.transport,
      inFlight: 0,
      lastUsed: Date.now(),
      closed: false,
    }
    opened.transport.onclose = () => {
      connection.closed = true
      if (connections.get(sessionId) === connection) connections.delete(sessionId)
    }
    connections.set(sessionId, connection)
    return connection
  }

  for (const [rawName, tool] of available) {
    const definition = createMcpToolDefinition(ctx, {
      name: publicToolName(SERVER_NAME, rawName),
      rawName,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      taskRequired: tool.execution?.taskSupport === 'required',
      call: async (args, execution) => {
        const connection = await connectSession(execution)
        connection.inFlight += 1
        connection.lastUsed = Date.now()
        try {
          return await connection.client.callTool(
            { name: rawName, arguments: args },
            { signal: execution.signal, timeout: MCP_TIMEOUT_MS, toolDefinition: tool },
          )
        }
        catch (error) {
          if (connection.closed) await releaseConnection(connection)
          throw error
        }
        finally {
          connection.inFlight -= 1
          connection.lastUsed = Date.now()
        }
      },
    })
    disposers.push(ctx.tools.register(definition))
    disposers.push(writeApproval(ctx, rawName))
  }

  ctx.effect(() => async () => {
    for (const dispose of disposers.splice(0)) dispose()
    await Promise.all([...connections.values()].map(releaseConnection))
  }, 'asterhub-genoffice-cli: lifecycle')
}
