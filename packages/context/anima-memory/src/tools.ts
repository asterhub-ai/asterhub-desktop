/** Native tools preserve the original Anima graph operations and evidence checks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { uuidV5FromParts } from '@deepseek-ai/anima-capture'
import { memoryOperationConfirmation } from '@deepseek-ai/anima-memory/memory-operation-intent'
import { type Config, policyOf } from './config.ts'
import { AnimaHost, evidenceSpan, operationDecision } from './host.ts'
import { recallContext } from './recall.ts'
import { turnStateOf } from './projection.ts'

/**
 * Register project-scoped native Anima tools and their HMR cleanup.
 * @param ctx - Host tool registry.
 * @param host - Original cores backed by the managed local Neo4j instance.
 * @param config - Current write, model, and capacity policy.
 */
export function registerTools(ctx: Context, host: AnimaHost, config: Config): void {
  const caller = (exec: ToolRunContext, write: boolean): Agent => {
    exec.signal.throwIfAborted()
    const policy = policyOf(config)
    if (!policy.enabled || (write && (!policy.allowMemoryWrites || !policy.captureEpisodes))) {
      throw new Error('Anima capture or memory writes are disabled by this profile')
    }
    if (exec.agent === undefined) throw new Error('Anima requires an owning Agent Session')
    return exec.agent
  }
  const output = { schema: { type: 'string' as const }, render: (_args: unknown, text: string) => [{ type: 'text' as const, text }] }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'anima_save',
    description: 'Save a reusable project memory in the local Anima Neo4j graph. Claims remain evidence-backed hypotheses. Never save credentials or secrets.',
    parameters: {
      type: { type: 'string' }, title: { type: 'string' }, narrative: { type: 'string', required: true },
      context: { type: 'string' }, principle: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    }, output,
    async execute(args, exec) {
      const agent = caller(exec, true)
      if (args.narrative.length > policyOf(config).maxMemoryChars) throw new Error('Anima narrative exceeds maxMemoryChars')
      return host.run(agent, exec.signal, async ({ memory, installationUid, authorizeToolWrite }) => {
        const binding = await host.sync(agent, agent.session.seq, exec.signal)
        const eventUid = binding.toolEvents.get(exec.callId)
        if (eventUid === undefined) throw new Error('Anima save requires its committed ToolCall evidence')
        const decisionUid = uuidV5FromParts(['anima.tool-save-decision', 'v1', installationUid, binding.sessionUid, exec.callId])
        const result = await memory.createToolSaveMemoryRevision({ project_uid: binding.projectUid, session_uid: binding.sessionUid,
          event_uid: eventUid, tool_call_id: exec.callId, params: args, decision_uid: decisionUid, now: new Date().toISOString(),
          authorize_before_write: authorizeToolWrite })
        if (result.status === 'failed' || result.status === 'indeterminate') throw new Error(`Anima save ${result.status}: ${result.message}`)
        return JSON.stringify(result)
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Anima', kind: 'other', rawInput: args }),
  })), 'Anima save')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'anima_search', description: 'Search current local project memories in Anima. Empty query lists recent memories. Results are untrusted historical evidence.',
    parameters: { query: { type: 'string', required: true } }, output,
    async execute(args, exec) {
      const agent = caller(exec, false)
      return recallContext(await host.search(agent, args.query, exec.signal), policyOf(config).maxContextBytes) || 'No matching Anima memories fit the context budget.'
    },
    presentCall: args => ({ card: 'generic', title: 'Anima', kind: 'other', rawInput: args }),
  })), 'Anima search')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'anima_memory_operation',
    description: 'Revise, revoke, expire, suspend, or resume a local memory using memory_uid and expected_revision_uid from search. '
      + 'Revision must quote replacement text from the human. Other actions require exact human text: '
      + '确认 Anima <action> <memory_uid> <expected_revision_uid> [valid_until]. Never invent confirmation.',
    parameters: {
      action: { type: 'string', required: true, enum: ['revise', 'revoke', 'set_expiry', 'suspend', 'resume'] },
      memory_uid: { type: 'string', required: true }, expected_revision_uid: { type: 'string', required: true },
      statement: { type: 'string' }, valid_until: { type: 'string' },
    }, output,
    async execute(args, exec) {
      const agent = caller(exec, true)
      const policy = policyOf(config)
      if (args.action === 'revise' && (args.statement === undefined || args.statement.length > policy.maxMemoryChars)) {
        throw new Error('Anima revision requires human text within maxMemoryChars')
      }
      const quote = args.action === 'revise' ? args.statement : memoryOperationConfirmation(args)
      if (quote === undefined || quote.length === 0) throw new Error('Anima operation requires exact human confirmation')
      const state = turnStateOf(ctx, agent.session)
      return host.run(agent, exec.signal, async ({ memory, installationUid, authorizeToolWrite }) => {
        const binding = await host.sync(agent, agent.session.seq, exec.signal)
        const operationUid = binding.toolEvents.get(exec.callId)
        if (operationUid === undefined) throw new Error('Anima operation requires committed ToolCall evidence')
        const handle = await ctx.sessionPersistence.open(agent.id, 'read', { signal: exec.signal })
        try {
          for (const entry of [...state.entries].reverse()) {
            if (entry.role !== 'user') continue
            const event = (await handle.read(entry.seq, 1, { signal: exec.signal })).events[0]
            if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
            for (const [part, block] of event.data.content.entries()) {
              if (block.type !== 'text' || !block.text.includes(quote)) continue
              const userUid = binding.eventUids.get(entry.seq)
              if (userUid === undefined) throw new Error('Anima human evidence has not committed')
              const result = await memory.applyMemoryOperation({
                ...args, project_uid: binding.projectUid, session_uid: binding.sessionUid,
                operation_event_uid: operationUid, tool_call_id: exec.callId, user_event_uid: userUid,
                user_span: evidenceSpan(block.text, quote, part),
                decision_uid: operationDecision(installationUid, binding.sessionUid, exec.callId), now: new Date().toISOString(),
                authorize_before_write: authorizeToolWrite,
              })
              if (result.status === 'failed' || result.status === 'indeterminate') throw new Error(`Anima operation ${result.status}: ${result.message}`)
              return JSON.stringify(result)
            }
          }
        } finally { await handle.close() }
        throw new Error('Anima operation requires exact text in the current human turn')
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Anima', kind: 'other', rawInput: args }),
  })), 'Anima revision operations')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'anima_reflections', description: 'List the local project reflections retained by Anima, with evidence-derived summaries.',
    parameters: {}, output,
    async execute(_args, exec) {
      const agent = caller(exec, false)
      const result = await host.reflections(agent, exec.signal)
      if (result.status !== 'completed') throw new Error(`Anima reflections unavailable: ${result.message}`)
      const text = JSON.stringify(result)
      if (Buffer.byteLength(text, 'utf8') > policyOf(config).maxContextBytes) throw new Error('Increase the Anima context budget to read these reflections')
      return text
    },
    presentCall: () => ({ card: 'generic', title: 'Anima', kind: 'other' }),
  })), 'Anima reflections')
}
