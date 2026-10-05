// Node-compatible unit tests for DesktopUpdateSource in-flight behavior
// These tests verify the shared action suppression/join requirements without jsdom
import { describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateBridge, DesktopUpdatePresentation } from '../src/types.ts'
import { DesktopUpdateSource } from '../src/client/desktop-update-source.ts'

/** Resolvers for one pending bridge action call. */
interface PendingCall { resolve: () => void; reject: (e: Error) => void }

describe('DesktopUpdateSource shared in-flight action', () => {
  function createMockBridge(): {
    bridge: DesktopUpdateBridge
    subscriber: () => ((p: DesktopUpdatePresentation) => void) | undefined
    nextOpenResolvers: () => PendingCall
    nextCheckResolvers: () => PendingCall
    resolveStatus: (p: DesktopUpdatePresentation) => void
    rejectStatus: (e: Error) => void
  } {
    let sub: ((p: DesktopUpdatePresentation) => void) | undefined
    let openResolvers: PendingCall | undefined
    let checkResolvers: PendingCall | undefined

    const { promise: statusPromise, resolve: resolveStatus, reject: rejectStatus } = Promise.withResolvers<DesktopUpdatePresentation>()

    return {
      bridge: {
        status: vi.fn(() => statusPromise),
        open: vi.fn(() => {
          const { promise, resolve, reject } = Promise.withResolvers<void>()
          openResolvers = { resolve, reject }
          return promise
        }),
        check: vi.fn(() => {
          const { promise, resolve, reject } = Promise.withResolvers<void>()
          checkResolvers = { resolve, reject }
          return promise
        }),
        subscribe: vi.fn((fn) => { sub = fn; return () => {} }),
      },
      subscriber: () => sub,
      nextOpenResolvers: () => {
        if (openResolvers === undefined) throw new Error('no pending open call')
        return openResolvers
      },
      nextCheckResolvers: () => {
        if (checkResolvers === undefined) throw new Error('no pending check call')
        return checkResolvers
      },
      resolveStatus,
      rejectStatus,
    }
  }

  describe('check concurrent call joining', () => {
    it('joins concurrent check() calls into one bridge interaction', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Start first check
      const promise1 = source.check()
      expect(mock.bridge.check).toHaveBeenCalledTimes(1)

      // Concurrent check should return same promise, not call bridge again
      const promise2 = source.check()
      expect(mock.bridge.check).toHaveBeenCalledTimes(1)
      expect(promise1).toBe(promise2)

      // Complete the action
      mock.nextCheckResolvers().resolve()
      await Promise.all([promise1, promise2])

      source.dispose()
    })

    it('allows new check() after previous completes', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // First check
      const promise1 = source.check()
      mock.nextCheckResolvers().resolve()
      await promise1

      // Second check should call bridge again
      const promise2 = source.check()
      expect(mock.bridge.check).toHaveBeenCalledTimes(2)

      mock.nextCheckResolvers().resolve()
      await promise2

      source.dispose()
    })
  })

  describe('open/check mutual exclusion', () => {
    it('check() does not start while open() is in-flight and joins the open action', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Start open
      source.open()
      expect(mock.bridge.open).toHaveBeenCalledTimes(1)

      // Check during open should not call bridge.check()
      const checkPromise = source.check()
      expect(mock.bridge.check).not.toHaveBeenCalled()

      // Resolve the open action; the joined check promise should resolve too
      mock.nextOpenResolvers().resolve()
      await expect(checkPromise).resolves.toBeUndefined()

      source.dispose()
    })

    it('open() does not start while check() is in-flight', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Start check
      const checkPromise = source.check()
      expect(mock.bridge.check).toHaveBeenCalledTimes(1)

      // Open during check should be no-op
      source.open()
      expect(mock.bridge.open).not.toHaveBeenCalled()

      mock.nextCheckResolvers().resolve()
      await checkPromise
      source.dispose()
    })

    it('open() can start after check() completes', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Complete a check first
      const checkPromise = source.check()
      mock.nextCheckResolvers().resolve()
      await checkPromise

      // Now open should work
      source.open()
      expect(mock.bridge.open).toHaveBeenCalledTimes(1)

      mock.nextOpenResolvers().resolve()
      source.dispose()
    })
  })

  describe('retry after failed state', () => {
    it('allows check() retry after bridge rejection clears failed state', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // First check fails
      const promise1 = source.check()
      mock.nextCheckResolvers().reject(new Error('network error'))
      await promise1

      // Source should be in failed state
      expect(source.store.getSnapshot().failed).toBe(true)

      // Retry should be allowed - this is the key requirement
      const promise2 = source.check()
      // Should call bridge again (retry allowed)
      expect(mock.bridge.check).toHaveBeenCalledTimes(2)

      mock.nextCheckResolvers().resolve()
      await promise2

      // Failed state should clear on new action start
      expect(source.store.getSnapshot().failed).toBe(false)

      source.dispose()
    })

    it('allows open() retry after bridge rejection', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // First open fails
      source.open()
      mock.nextOpenResolvers().reject(new Error('user cancelled'))

      // Wait for the rejection to be processed
      await new Promise(r => setTimeout(r, 10))

      // Source should be in failed state
      expect(source.store.getSnapshot().failed).toBe(true)

      // Retry should be allowed
      source.open()
      expect(mock.bridge.open).toHaveBeenCalledTimes(2)

      mock.nextOpenResolvers().resolve()
      source.dispose()
    })
  })

  describe('busy phase no-op', () => {
    it('check() no-ops when presentation is in active phase', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Simulate active phase from subscription
      mock.subscriber()?.({ phase: 'checking' } as DesktopUpdatePresentation)

      // Check should no-op
      const promise = source.check()
      expect(mock.bridge.check).not.toHaveBeenCalled()
      await expect(promise).resolves.toBeUndefined()

      source.dispose()
    })

    it('open() no-ops when presentation is in active phase', () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Simulate active phase
      mock.subscriber()?.({ phase: 'downloading', percent: 50 } as DesktopUpdatePresentation)

      // Open should no-op
      source.open()
      expect(mock.bridge.open).not.toHaveBeenCalled()

      source.dispose()
    })
  })

  describe('post-disposal no mutation', () => {
    it('ignores check() after disposal', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      source.dispose()

      const promise = source.check()
      expect(mock.bridge.check).not.toHaveBeenCalled()
      await expect(promise).resolves.toBeUndefined()
    })

    it('ignores open() after disposal', () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      source.dispose()

      source.open()
      expect(mock.bridge.open).not.toHaveBeenCalled()
    })

    it('ignores late check completion after disposal', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      const promise = source.check()
      source.dispose()

      // Late completion should not mutate store
      const before = { ...source.store.getSnapshot() }
      mock.nextCheckResolvers().resolve()
      await promise
      const after = source.store.getSnapshot()

      expect(after).toEqual(before)
    })

    it('ignores late open completion after disposal', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      source.open()
      source.dispose()

      // Late completion should not mutate store
      const before = { ...source.store.getSnapshot() }
      mock.nextOpenResolvers().resolve()
      await new Promise(r => setTimeout(r, 10))
      const after = source.store.getSnapshot()

      expect(after).toEqual(before)
    })
  })

  describe('failure clearing on new presentation', () => {
    it('clears failed state when fresh presentation arrives via subscription', () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Set failed state
      source.store.set({ ...source.store.getSnapshot(), failed: true })
      expect(source.store.getSnapshot().failed).toBe(true)

      // New presentation via subscription clears failure
      mock.subscriber()?.({ phase: 'idle' } as DesktopUpdatePresentation)
      expect(source.store.getSnapshot().failed).toBe(false)

      source.dispose()
    })

    it('clears failed state when fresh presentation arrives via status', async () => {
      const mock = createMockBridge()
      const source = new DesktopUpdateSource(mock.bridge)

      // Set failed state
      source.store.set({ ...source.store.getSnapshot(), failed: true })
      expect(source.store.getSnapshot().failed).toBe(true)

      // Status resolving with presentation clears failure
      mock.resolveStatus({ phase: 'idle' } as DesktopUpdatePresentation)
      await new Promise(r => setTimeout(r, 10))

      expect(source.store.getSnapshot().failed).toBe(false)

      source.dispose()
    })
  })
})
