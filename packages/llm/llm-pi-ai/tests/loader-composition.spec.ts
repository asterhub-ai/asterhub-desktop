/** Profile patch edits and credential updates reach the next real adapter request. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createMessage, createUserMessage, userAgent } from '@deepseek-ai/dsh-llm'
import type { PiAiProviderProfile } from '../src/config.ts'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import ProjectStorage from '@deepseek-ai/dsh-project-storage'
import SessionCwd from '@deepseek-ai/dsh-session/cwd'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { APPLICATION_MODEL_ROUTE } from '../../../bundle/asterhub-product/src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

/** One text block, then a tool call truncated by the output-token ceiling. */
const truncatedToolCallEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"partial"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\\"text\\":"}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
  '[DONE]',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** Boot the dormant composition: a bare `llm-pi-ai` row with no config at all. */
async function loadComposition(withProjectStorage = false): Promise<{ ctx: Context; settingsPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-pi-composition-'))
  await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  PI_COMPOSITION_KEY: key-from-store\n', { mode: 0o600 })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    ...withProjectStorage ? [
      '- id: session-cwd',
      "  name: '@deepseek-ai/dsh-session/cwd'",
      '- id: project-storage',
      "  name: '@deepseek-ai/dsh-project-storage'",
      '  config:',
      "    sessionMode: 'project-local'",
      `    locatorPath: ${JSON.stringify(join(root, 'locator.json'))}`,
      `    legacySessionRoot: ${JSON.stringify(join(root, 'sessions'))}`,
      '    metadataLimitBytes: 1048576',
      '    lockDeadlineMs: 5000',
    ] : [],
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ...withProjectStorage ? [
      ['@deepseek-ai/dsh-session/cwd', SessionCwd] as const,
      ['@deepseek-ai/dsh-project-storage', ProjectStorage] as const,
    ] : [],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  const patchPath = await profileComposition(ctx, root, configPath)
  return { ctx, settingsPath: patchPath }
}

describe('llm-pi-ai real dormant composition', () => {
  it('clones and loads the frozen application PiAI profile without dropping off:null', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pi-application-profile-'))
    const credentialPath = join(root, '.credentials.yaml')
    await writeFile(credentialPath, 'version: 1\nrefs:\n  ASTERHUB_ROUTE_KEY: isolated-test-key\n', { mode: 0o600 })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalCredentialProvider, { path: credentialPath, debounceMs: 10 })

    const patch = await readFile(new URL('../../../bundle/asterhub-product/cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('providers: !!js')
    expect(patch).toContain('structuredClone')
    const profiles: Record<string, PiAiProviderProfile> = {
      sub2api: structuredClone(APPLICATION_MODEL_ROUTE.profile as PiAiProviderProfile),
    }

    await ctx.plugin(LlmPiAi, {
      appIdentity: { product: 'asterhub', url: 'https://github.com/asterhub-ai/asterhub-desktop' },
      deploymentLocked: true,
      providers: profiles,
    })
    expect(Object.isFrozen(APPLICATION_MODEL_ROUTE.profile)).toBe(true)
    expect(Object.isFrozen(profiles[APPLICATION_MODEL_ROUTE.provider])).toBe(false)
    const model = profiles[APPLICATION_MODEL_ROUTE.provider]?.models?.[0]
    const reasoningEfforts = typeof model?.reasoningEfforts === 'object' && model.reasoningEfforts !== null
      ? model.reasoningEfforts
      : undefined
    expect(reasoningEfforts?.off).toBeNull()
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual([APPLICATION_MODEL_ROUTE.provider])
  })

  it('resolves an optional project attachment service from a real Loader composition', { timeout: 30_000 }, async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition(true)
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 20_000 })

    const projectRoot = join(root!, 'project')
    await mkdir(projectRoot)
    const binding = await ctx.projectStorage.open({ root: projectRoot, mode: 'new' })
    const sessionId = SessionId('project-scope-session')
    await ctx.projectStorage.bindSession({
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 10,
      cwd: projectRoot, isSeeded: false, delegationDepth: 0,
    })

    const locateSession = vi.spyOn(ctx.projectStorage, 'locateSession')
    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-flash', messages: [], sessionId })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(ctx.projectStorage.locateSession(sessionId)?.projectId).toBe(binding.id)
    expect(locateSession).toHaveBeenCalledWith(sessionId)
    locateSession.mockRestore()
    expect(server.requests).toHaveLength(1)
  })

  it('boots with zero routes and registers one the moment settings supply a profile', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()

    // The shipped posture: the adapter exists, no route does.
    expect(ctx.llm.listProviders()).toEqual([])

    // Exactly what the web Models page leaves on disk.
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-flash', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
  })

  it('uses settings-only route headers for model discovery', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ body: JSON.stringify({ data: [{ id: 'acme-private' }] }) }])
    const { ctx, settingsPath } = await loadComposition()

    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      acme-gateway:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      '        api: openai-completions',
      `        baseURL: ${server.url}`,
      '        headers:',
      '          X-Company-Code: private-tenant',
      '          Accept: text/plain',
      '          User-Agent: deployment-owned',
      '        models:',
      '          - id: acme-bootstrap',
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['acme-gateway'])
    }, { timeout: 5000 })

    await expect(ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      api: 'openai-completions',
    })).resolves.toEqual([{ id: 'acme-private', name: 'acme-private' }])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.['x-company-code']).toBe('private-tenant')
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('continues natively after max-token assembly drops a tool call, with pruned replay metadata', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([
      { events: truncatedToolCallEvents },
      { events: textEvents },
    ])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const truncated = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })
    expect(truncated.finish).toEqual({ kind: 'max-tokens' })
    expect(truncated.message.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(truncated.message.source).toEqual({
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-flash',
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-flash',
          stopReason: 'length',
        },
        blocks: [{ type: 'text' }],
      },
    })

    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        truncated.message,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
    const followup = server.requests[1] as { messages?: unknown[] }
    expect(followup.messages?.[0]).not.toHaveProperty('tool_calls')
  })

  it('continues a legacy session whose stored replay state no longer matches its content', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    // A pre-envelope session log entry: max-token assembly dropped the tool
    // call from content while the flat v1 state still describes both blocks.
    const poisoned = createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial' }],
      source: {
        kind: 'model',
        ...{
          provider: 'deepseek',
          model: 'deepseek-flash',
          replayState: {
            kind: 'pi-ai',
            version: 1,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-flash',
            stopReason: 'length',
            blocks: [{ type: 'text' }, { type: 'tool-call' }],
          },
        },
      },
    })
    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        poisoned,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.finish).toEqual({ kind: 'stop' })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
  })
})
