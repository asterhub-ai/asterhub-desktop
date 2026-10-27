import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCwd } from '../src/cwd.ts'
import { SESSION_FORMAT_VERSION, SessionId } from '../src/types.ts'
import type { SessionHeader } from '../src/types.ts'

const header: SessionHeader = {
  version: SESSION_FORMAT_VERSION,
  id: SessionId('cwd-test'),
  createdAt: 1,
  cwd: '/historical',
  isSeeded: false,
}

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

function capability(): SessionCwd {
  const ctx = new Context()
  contexts.push(ctx)
  return new SessionCwd(ctx)
}

describe('SessionCwd', () => {
  it('uses the historical cwd only before the first provider binds', () => {
    expect(capability().resolve(header)).toBe('/historical')
  })

  it('rejects duplicate providers, honors authoritative absence/errors, and fails closed after disposal', () => {
    const cwd = capability()
    const resolver = (): string | undefined => undefined
    const dispose = cwd.registerResolver(resolver)
    expect(() => cwd.registerResolver(resolver)).toThrow(/already registered/)
    expect(cwd.resolve(header)).toBeUndefined()
    dispose()
    expect(() => cwd.resolve(header)).toThrow(/unavailable/)
    const second = cwd.registerResolver(() => { throw new Error('provider failure') })
    expect(() => cwd.resolve(header)).toThrow('provider failure')
    dispose()
    expect(() => cwd.resolve(header)).toThrow(/provider failure/)
    second()
    expect(() => cwd.resolve(header)).toThrow(/unavailable/)
  })

  it('makes stale disposers harmless when the callback identity is reused', () => {
    const cwd = capability()
    const resolver = (): string => '/current'
    const stale = cwd.registerResolver(resolver)
    stale()
    const current = cwd.registerResolver(resolver)
    stale()
    expect(cwd.resolve(header)).toBe('/current')
    current()
    expect(() => cwd.resolve(header)).toThrow(/unavailable/)
  })
})
