/** Replayable bounded turn evidence and the exact last admitted model route. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'

const entrySchema = z.object({ seq: z.number(), role: z.enum(['user', 'assistant']), text: z.string() })
/** Runtime turn evidence is derived from the Session log, including after resume. */
export const turnStateSchema = z.object({
  turn: z.number(), entries: z.array(entrySchema), truncated: z.boolean(),
  route: z.object({ provider: z.string(), model: z.string() }).nullable(),
})
/** Bounded replayable input to local capture and model extraction. */
export type TurnState = z.infer<typeof turnStateSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Current turn's explicit human and assistant evidence for Anima. */
    animaTurn: TurnState
  }
}

/**
 * Return textual content only; attachments and tool calls remain in their original Session log.
 * @param content - Logged message blocks.
 * @returns the original text blocks joined by a newline.
 */
export function messageText(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * Register the turn evidence projection, including its HMR disposer.
 * @param ctx - Projection registry owner.
 * @param maxBytes - Current complete serialized evidence state limit.
 */
export function registerTurnProjection(ctx: Context, maxBytes: () => number): void {
  ctx.effect(() => ctx.sessionProjections.register({
    key: 'animaTurn', stateSchema: turnStateSchema, stateVersion: 1,
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
  }), 'Anima turn evidence')
}
