import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'

let sessionCounter = 0

export function createTestSession(cwd?: string, rawId?: string): Session {
  const id = SessionId(rawId ?? `tool-fs-test-${++sessionCounter}`)
  return Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    ...(cwd === undefined ? {} : { cwd }),
    isSeeded: false,
  })
}

export function createTestAgent(ctx: Context, session: Session, options: AgentOptions = {}): Agent {
  return {
    id: session.id,
    options,
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx,
    send() {},
    followup() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject() {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}
