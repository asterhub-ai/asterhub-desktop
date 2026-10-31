/** Built-in Anima uses its original graph cores with an AsterHub-owned local Neo4j process. */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-working-directory'
import { type Config, policyOf } from './config.ts'
import { AnimaHost } from './host.ts'
import { registerTurnProjection, messageText, turnStateOf } from './projection.ts'
import { registerTools } from './tools.ts'
import { recallContext } from './recall.ts'
import { personalityContext } from './personality.ts'

export { Config, policyOf } from './config.ts'
export type { Policy } from './config.ts'

/** Loader plugin identity; the profile row anima owns its settings. */
export const name = 'anima-memory'
/** All operations use native Session persistence and model services. */
export const inject = ['agents', 'sessions', 'tools', 'llm', 'sessionProjections', 'sessionPersistence', 'workingDirectory']

/**
 * Mount local Anima tools, durable recall, and completed-turn graph processing.
 * @param ctx - Host plugin context.
 * @param config - Validated local runtime configuration and live policy references.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const policy = policyOf(config)
  if ((policy.modelProvider.trim() === '') !== (policy.model.trim() === '')) throw new Error('Anima model provider and model must be configured together')
  const host = new AnimaHost(ctx, config)
  const abort = new AbortController()
  const pending = new Set<Promise<void>>()
  ctx.effect(() => async () => {
    abort.abort(new Error('Anima is shutting down'))
    await Promise.all(pending)
    await host.close()
  }, 'Anima graph lifecycle')
  await registerTurnProjection(ctx, () => policyOf(config).maxInputBytes)
  registerTools(ctx, host, config)
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    const policy = policyOf(config)
    if (!policy.enabled || step !== 1 || decision.kind !== 'enter') return decision
    const personality = createUserMessage({ source: { kind: 'anima' }, content: [{ type: 'text', text: personalityContext(config) }] })
    const personalized = { ...decision, messages: [personality, ...decision.messages] }
    if (!policy.automaticRecall) return personalized
    const query = decision.messages.filter(message => message.source.kind === 'user')
      .map(message => messageText(message.content)).join('\n')
    if (query.trim() === '') return personalized
    try {
      const text = recallContext(await host.search(agent, query, signal), policy.maxContextBytes)
      if (text === '') return personalized
      return { ...decision, messages: [createUserMessage({ source: { kind: 'anima' }, content: [{ type: 'text', text }] }), ...personalized.messages] }
    } catch (error) {
      if (signal.aborted) throw error
      ctx.logger.warn(`Anima recall is unavailable: ${String(error)}`)
      const notice = 'Anima local graph memory is currently unavailable. Do not claim that stored memories were recalled or updated.'
      return { ...decision, messages: [createUserMessage({ source: { kind: 'anima', form: 'notice', summary: 'Local Anima memory is unavailable' },
        content: [{ type: 'text', text: notice }] }), ...personalized.messages] }
    }
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || event.data.reason.kind !== 'completed') return
    const policy = policyOf(config)
    if (!policy.enabled || !policy.captureEpisodes || abort.signal.aborted) return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    const turn = turnStateOf(ctx, session)
    const work = host.processTurn(agent, event.seq + 1, abort.signal, turn)
      .catch((error: unknown) => { ctx.logger.warn(`Anima graph processing failed: ${String(error)}`) })
    pending.add(work)
    void work.finally(() => pending.delete(work))
  })
  ctx.on('session/disposed', (session) => {
    const work = host.disposeSession(session).catch((error: unknown) => {
      ctx.logger.warn(`Anima Session cleanup failed: ${String(error)}`)
    })
    pending.add(work)
    void work.finally(() => pending.delete(work))
  })
}
