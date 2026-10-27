import { describe, expect, it, vi } from 'vitest'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { openAutomationSession } from '../src/client/session-navigation.ts'

function createSessionList(ids: SessionId[] = []) {
  let snapshot: SessionListState = { ids, byId: {}, phase: 'ready', projectionsBySession: {} }
  const listeners = new Set<() => void>()
  const source: ObservableSnapshot<SessionListState> = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    source,
    setIds(nextIds: SessionId[]) {
      snapshot = { ...snapshot, ids: nextIds }
      for (const listener of listeners) listener()
    },
  }
}

describe('automation session navigation', () => {
  it('reports a failed cache refresh and does not navigate to a session absent from cache', async () => {
    const id = SessionId('historical-session')
    const refreshError = new Error('session list unavailable')
    const list = createSessionList()
    const sessions = {
      list: list.source,
      refresh: vi.fn(async () => { throw refreshError }),
    }
    const navigate = vi.fn()
    const reportError = vi.fn()

    await openAutomationSession(id, sessions, navigate, reportError)

    expect(sessions.refresh).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('reports a completed refresh that still does not contain the requested session', async () => {
    const id = SessionId('missing-session')
    const list = createSessionList()
    const sessions = {
      list: list.source,
      refresh: vi.fn(async () => {}),
    }
    const navigate = vi.fn()
    const reportError = vi.fn()

    await openAutomationSession(id, sessions, navigate, reportError)

    expect(sessions.refresh).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('refreshes the cache before navigating to a historical session', async () => {
    const id = SessionId('historical-session')
    const order: string[] = []
    const list = createSessionList()
    const sessions = {
      list: list.source,
      refresh: vi.fn(async () => { order.push('refresh'); list.setIds([id]) }),
    }

    await openAutomationSession(id, sessions, () => { order.push('navigate') }, vi.fn())

    expect(order).toEqual(['refresh', 'navigate'])
  })
})
