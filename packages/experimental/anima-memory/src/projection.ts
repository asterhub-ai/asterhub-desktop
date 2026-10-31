/** Replayable bounded turn evidence and the exact last admitted model route. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'

const entrySchema = z.object({ seq: z.number(), role: z.enum(['user', 'assistant']), text: z.string() })
/** Runtime turn evidence is derived from the Session log, including after resume. */
export const turnStateSchema = z.object({
  turn: z.number(), entries: z.array(entrySchema), truncated: z.boolean(),
  route: z.object({ provider: z.string(), model: z.string() }).nullable(),
})
/** Bounded replayable input to local capture and model extraction. */
export type TurnState = z.infer<typeof turnStateSchema>

const handles = new WeakMap<object, ProjectionHandle<TurnState>>()

/**
 * Return textual content only; attachments and tool calls remain in their original Session log.
 * @param content - Logged message blocks.
 * @returns the original text blocks joined by a newline.
 */
export function messageText(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * Register the turn evidence projection and retain its ready handle on the registry instance.
 * @param ctx - Projection registry owner.
 * @param maxBytes - Current complete serialized evidence state limit.
 * @returns ready handle promise whose registration is bound to the context fiber.
 */
export async function registerTurnProjection(ctx: Context, maxBytes: () => number): Promise<ProjectionHandle<TurnState>> {
  const registry = ctx.sessionProjections
  const handle = await registry.register({
    key: 'animaTurn',
    stateSchema: turnStateSchema,
    stateVersion: 1,
    init: () => ({ turn: 0, entries: [], truncated: false, route: null }),
    apply(state, event) {
      if (event.type === 'turn/start') return { ...state, turn: event.data.turn, entries: [], truncated: false }
      if (event.type === 'request/header') {
        const { provider, model } = event.data.header.config
        return { ...state, route: { provider, model } }
      }
      if (state.truncated) return state
      let entry: z.infer<typeof entrySchema>
      if (event.type === 'user/message' && event.data.source.kind === 'user') {
        entry = { seq: event.seq, role: 'user', text: messageText(event.data.content) }
      } else if (event.type === 'assistant/message' && event.data.interrupted !== true) {
        entry = { seq: event.seq, role: 'assistant', text: messageText(event.data.message.content) }
      } else return state
      if (entry.text.length === 0) return state
      const next = { ...state, entries: [...state.entries, entry] }
      return Buffer.byteLength(JSON.stringify(next), 'utf8') > maxBytes() ? { ...state, truncated: true } : next
    },
  })
  handles.set(registry, handle)
  ctx.effect(() => () => {
    if (handles.get(registry) === handle) {
      handles.delete(registry)
    }
  }, 'Anima turn projection lifecycle')
  return handle
}

/**
 * Read current turn evidence for one session using the registered projection handle.
 * @param ctx - Host plugin context owning sessionProjections.
 * @param session - Session whose turn state is read.
 * @returns the current turn state.
 * @throws when the projection is not registered on the supplied context.
 */
export function turnStateOf(ctx: Context, session: Session): TurnState {
  const handle = handles.get(ctx.sessionProjections)
  if (handle === undefined) {
    throw new Error('Anima turn projection is not registered on this Context')
  }
  return handle.stateOf(session)
}
