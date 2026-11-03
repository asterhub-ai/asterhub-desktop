import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { registerTurnProjection, turnStateOf } from '../src/projection.ts'

it('reads the registered turn projection through contextual service access', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await registerTurnProjection(ctx, () => 8192)
    const session = ctx.sessions.create(SessionId('anima-turn-projection'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Remember the isolated acceptance marker.' }],
    }), { surfaceOp: 'append' })
    expect(turnStateOf(ctx, session)).toMatchObject({
      turn: 1,
      entries: [{ role: 'user', text: 'Remember the isolated acceptance marker.' }],
    })
  } finally {
    await ctx.fiber.dispose()
  }
})
