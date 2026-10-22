/**
 * Session Controller Client apply inside the assembled client: Remote events
 * arriving as emit frames on the `$events` stream, the control stream over
 * the real Connection, and Agent Context identity through the Typert registry.
 */
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { ok, type RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, type TestClient, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { isTypertOwnedValue } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, vi } from 'vitest'
import { ClientSessions } from '../src/client/sessions/service.ts'
import type { SessionListValue } from '../src/types.ts'

const SELF = '@deepseek-ai/dsh-api-session-controller'
const ROSTER = webApp.closure([SELF])
const it = createClientTest({ roster: ROSTER })
const EVENTS = '$events'
const CONTROL = 'session/control'
/** The first client boot pays the cold module transform of the cone. */
const COLD_BOOT_TIMEOUT_MS = 60_000

const sid = (value: string): SessionId => value as SessionId

afterEach(() => {
  vi.restoreAllMocks()
})

async function bench(start: () => Promise<TestClient>) {
  const client = await start()
  return { client, sessions: client.ctx.sessions as ClientSessions }
}

/** Deliver one Remote event the way the Host forwards it: an emit frame on the `$events` stream, consumed by the client. */
async function emit(mock: RemoteMock, event: string, ...args: unknown[]): Promise<void> {
  mock.streams.push(EVENTS, { type: 'emit', event, args })
  await mock.streams.drained(EVENTS)
}

describe('Session Controller Client apply', () => {
  it('routes Remote events from the $events stream into the object layer and runs handleConnected once per generation', async ({ mock, start }) => {
    const { client, sessions } = await bench(start)
    // The first generation's `connection/reset` already ran it; apply itself saw no Host yet.
    await vi.waitFor(() => {
      expect(client.connection.generation.getSnapshot()?.id).toBe(1)
      expect(sessions.list.getSnapshot().phase).toBe('ready')
      expect(mock.remote.session.list).toHaveBeenCalledOnce()
    })

    await emit(mock, 'api-session/added', { agentAvailable: true, sessionId: sid('session-1'), updatedAt: 1, running: false, blank: true })
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().byId[sid('session-1')]).toMatchObject({ running: false, updatedAt: 1 })
    })

    // Materialize the object layer so the Agent-failure event has a Session to land on.
    using reference = sessions.retainAgentScope(sid('session-1'))
    await emit(mock, 'api-session/status', sid('session-1'), true)
    await emit(mock, 'api-session/activity', sid('session-1'), 9)
    await emit(mock, 'api-session/error', sid('session-1'), 'agent failed')
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().byId[sid('session-1')]).toMatchObject({ running: true, updatedAt: 9 })
      expect(reference.binding.session.getSnapshot()).toMatchObject({ running: true, lastAgentError: 'agent failed' })
    })

    await emit(mock, 'api-session/removed', sid('session-1'))
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().byId[sid('session-1')]).toBeUndefined()
      expect(reference.binding.session.getSnapshot().removed).toBe(true)
    })

    client.connection.reconnect()
    await mock.streams.opened(EVENTS, 2)
    // The new generation reloads the catalog once and reopens the control stream once.
    await vi.waitFor(() => {
      expect(client.connection.generation.getSnapshot()?.id).toBe(2)
      expect(mock.remote.session.list).toHaveBeenCalledTimes(2)
      expect(mock.log.streams(CONTROL)).toHaveLength(2)
    })
    await client.flush()
    expect(mock.remote.session.list).toHaveBeenCalledTimes(2)
  }, COLD_BOOT_TIMEOUT_MS)

  it('runs handleConnected at apply when the Host is already connected, as a reload of the row does', async ({ mock, start }) => {
    const { client, sessions } = await bench(start)
    await vi.waitFor(() => {
      expect(client.connection.generation.getSnapshot()?.id).toBe(1)
      expect(sessions.list.getSnapshot().phase).toBe('ready')
      expect(mock.remote.session.list).toHaveBeenCalledOnce()
      expect(mock.log.streams(CONTROL)).toHaveLength(1)
    })

    await client.reload(SELF)
    const reloadedSessions = client.ctx.sessions as ClientSessions

    await vi.waitFor(() => {
      expect(mock.remote.session.list).toHaveBeenCalledTimes(2)
      expect(mock.log.streams(CONTROL)).toHaveLength(2)
      expect(reloadedSessions.list.getSnapshot().phase).toBe('ready')
    })
  })

  it('keeps immediate control projections when the ready notification follows their baseline', async ({ mock, start }) => {
    const sessionId = sid('immediate-baseline')
    mock.remote.session.list.mockResolvedValue(ok({ items: [{
      sessionId, updatedAt: 1, running: false, blank: false, agentAvailable: true,
    }] }))
    let projection = { asOfSeq: 20, values: { title: 'Before restart' } }
    mock.stream(CONTROL, (_args, stream) => {
      stream.push({ type: 'baseline', value: { projections: { [sessionId]: projection } } })
    })
    const { client, sessions } = await bench(start)
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().byId[sessionId]?.title).toBe('Before restart')
      expect(mock.remote.session.list).toHaveBeenCalledOnce()
    })
    client.ctx.emit('connection/reset')
    await client.flush()
    expect(sessions.list.getSnapshot().byId[sessionId]?.title).toBe('Before restart')

    // A new Host generation invalidates the old cut before the reopened baseline arrives (lower seq wins only after the clear).
    projection = { asOfSeq: 1, values: { title: 'After restart' } }
    client.connection.reconnect()
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().byId[sessionId]?.title).toBe('After restart')
      expect(mock.remote.session.list).toHaveBeenCalledTimes(2)
    })

    // After the row unloads, later generations neither repull the list nor reopen the control stream.
    await client.unload(SELF)
    client.connection.reconnect()
    await mock.streams.opened(EVENTS, 3)
    await vi.waitFor(() => { expect(client.connection.generation.getSnapshot()?.id).toBe(3) })
    await client.flush()
    expect(mock.remote.session.list).toHaveBeenCalledTimes(2)
    expect(mock.log.streams(CONTROL)).toHaveLength(2)
  })

  it('accepts the control baseline, retries a carrier loss once, and reports a second opening snapshot as a protocol failure', async ({ mock, start }) => {
    const sessionId = sid('control-baseline')
    const item = {
      sessionId, updatedAt: 1, running: false, blank: false, agentAvailable: true,
    }
    mock.remote.session.list.mockResolvedValue(ok({ items: [item] }))
    let opens = 0
    mock.stream(CONTROL, (_args, stream) => {
      opens += 1
      stream.push({ type: 'baseline', value: { projections: { [sessionId]: {
        asOfSeq: opens, values: { title: `baseline ${String(opens)}` },
      } } } })
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sessions } = await bench(start)
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().byId[sessionId]?.title).toBe('baseline 1')
    })

    // One immediate retry while the Host is available reopens the stream, whose script pushes a fresh baseline.
    mock.streams.fail(CONTROL, new RemoteStreamCarrierError('generation lost'))
    await vi.waitFor(() => {
      expect(mock.log.streams(CONTROL)).toHaveLength(2)
      expect(sessions.list.getSnapshot().byId[sessionId]?.title).toBe('baseline 2')
    })
    expect(opens).toBe(2)

    // A second opening snapshot inside one generation is a protocol failure; the accepted cut stays published.
    mock.streams.push(CONTROL, { type: 'baseline', value: { projections: {} } })
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(
        '[session-controller] control stream failed:',
        expect.objectContaining({ message: 'session control stream emitted more than one opening snapshot' }),
      )
    })
    expect(sessions.list.getSnapshot().byId[sessionId]?.title).toBe('baseline 2')
    expect(mock.log.streams(CONTROL)).toHaveLength(2)
  })

  it('materializes Host-addressed Agent scopes before the Session list arrives', async ({ mock, start }) => {
    const list = Promise.withResolvers<RemoteResult<SessionListValue>>()
    mock.remote.session.list.mockReturnValueOnce(list.promise)
    const { client, sessions } = await bench(start)
    const adapter = client.ctx.typert.contexts.getClient('agent')
    const first = adapter?.resolve(sid('agent-early'))
    const second = adapter?.resolve(sid('agent-early'))
    if (!isTypertOwnedValue(first) || !isTypertOwnedValue(second)) throw new Error('expected owned Contexts')
    using firstOwner = first
    using secondOwner = second
    expect(sessions.scopeOf(firstOwner.value)).toBe(sid('agent-early'))
    expect(secondOwner.value).toBe(firstOwner.value)
    expect(sessions.retainInfo(sid('agent-early')).getSnapshot()).toEqual({ referenceCount: 2, retainedBy: { gateway: 2 } })
    expect(mock.log.requests('session/follow')).toHaveLength(0)
    list.resolve(ok({ items: [] }))
    await vi.waitFor(() => { expect(sessions.list.getSnapshot().phase).toBe('ready') })
    expect(sessions.scope(sid('agent-early'))).toBe(firstOwner.value)
  })

  it('projects Agent Context identity in both directions and withdraws the adapter when the row unloads', async ({ mock, start }) => {
    const { client, sessions } = await bench(start)
    await vi.waitFor(() => { expect(sessions.list.getSnapshot().phase).toBe('ready') })

    await emit(mock, 'api-session/added', { agentAvailable: true, sessionId: sid('agent-1'), updatedAt: 1, running: false, blank: true })
    expect(sessions.scope(sid('agent-1'))).toBeUndefined()
    using reference = sessions.retainAgentScope(sid('agent-1'))
    const scoped = reference.binding.ctx
    const adapter = client.ctx.typert.contexts.getClient('agent')
    expect(adapter?.identity(client.ctx)).toBeUndefined()
    expect(adapter?.identity(scoped)).toBe(sid('agent-1'))
    const resolved = adapter?.resolve(sid('agent-1'))
    if (!isTypertOwnedValue(resolved)) throw new Error('expected invocation ownership')
    using invocation = resolved
    expect(invocation.value).toBe(scoped)

    await client.unload(SELF)
    expect(client.ctx.typert.contexts.getClient('agent')).toBeUndefined()
  })

  it('waits for a Host generation before retrying the control stream', async ({ mock, start }) => {
    const sessionId = sid('control-generation')
    const hostBack = Promise.withResolvers<undefined>()
    let eventsOpens = 0
    let controlOpens = 0
    // The second $events generation stays unready until the test lets the Host answer.
    mock.stream(EVENTS, (_args, stream) => {
      eventsOpens += 1
      const ready = { type: 'ready', clientId: `mock-client-${String(eventsOpens)}`, host: { home: '/home/mock' } }
      if (eventsOpens === 1) stream.push(ready)
      else void hostBack.promise.then(() => { stream.push(ready) })
    })
    mock.stream(CONTROL, (_args, stream) => {
      controlOpens += 1
      stream.push({ type: 'baseline', value: { projections: { [sessionId]: {
        asOfSeq: controlOpens, values: { title: `baseline ${String(controlOpens)}` },
      } } } })
    })
    const { client, sessions } = await bench(start)
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().projectionsBySession[sessionId]?.values.title).toBe('baseline 1')
    })

    client.connection.reconnect()
    await mock.streams.opened(EVENTS, 2)
    expect(client.connection.generation.getSnapshot()).toBeUndefined()

    // Without a Host generation the carrier loss cannot reopen: no new open and no new baseline.
    mock.streams.fail(CONTROL, new RemoteStreamCarrierError('offline'))
    await client.flush()
    expect(controlOpens).toBe(1)
    expect(mock.log.streams(CONTROL)).toHaveLength(1)
    expect(sessions.list.getSnapshot().projectionsBySession[sessionId]?.values.title).toBe('baseline 1')

    hostBack.resolve(undefined)
    await vi.waitFor(() => {
      expect(client.connection.generation.getSnapshot()).toMatchObject({ id: 2 })
      expect(mock.log.streams(CONTROL)).toHaveLength(2)
      expect(sessions.list.getSnapshot().projectionsBySession[sessionId]?.values.title).toBe('baseline 2')
    })
  })
})
