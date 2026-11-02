/**
 * Cross-process write-ownership lock for one session's artifact directory,
 * held for the whole life of a write handle. On Windows, this holds a named
 * kernel semaphore derived from the session lock path — never a file lock or handle,
 * so readers, searches, and directory removal proceed freely while the lock is held.
 * Contention maps to SessionAlreadyOwnedError; the kernel releases the lock when the
 * holder's handle closes or process dies.
 *
 * In the virtual browser worker runtime (`dsh-webworker`), persistence operates within
 * a single worker process where an in-process lock table enforces mutual exclusion per
 * session artifact path. Other platforms fail closed.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/lease
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { acquireLockHandleWin32, releaseLockHandleWin32 } from './win32.ts'

/** Base name of the kernel lock file inside a session's directory. */
export const LEASE_FILENAME = 'session.lock'

/** Active in-process locks held in the browser worker runtime. */
const workerHeldLocks = new Set<string>()

/** The held write lock: a Win32 semaphore handle or worker in-process path lease. */
type HeldLock =
  | { readonly kind: 'win32'; readonly handle: number }
  | { readonly kind: 'worker'; readonly path: string }

/**
 * One held write lock. Constructed only by {@link SessionWriteLease.acquire};
 * `release` closes the descriptor or handle, which is what releases the lock.
 */
export class SessionWriteLease {
  private released = false

  private constructor(private readonly held: HeldLock) {}

  /**
   * Acquire the session directory's write lock.
   * On Windows, acquires a Win32 named semaphore.
   * In a browser worker (`dsh-webworker`), enforces in-process single-writer exclusion.
   * Other platforms are unsupported and fail closed.
   * @param dir - the session's artifact directory (created if absent).
   * @param id - the session the lock guards, for error identities.
   * @returns the held lock.
   * @throws {SessionAlreadyOwnedError} while another holder keeps the lock.
   */
  static async acquire(dir: string, id: SessionId): Promise<SessionWriteLease> {
    const path = join(dir, LEASE_FILENAME)
    await mkdir(dir, { recursive: true, mode: 0o700 })

    if (process.platform === 'win32') {
      let handle: number
      try {
        handle = await acquireLockHandleWin32(path)
      } catch (error: unknown) {
        // Sharing violation: another handle already holds the write exclusion.
        if ((error as NodeJS.ErrnoException | null)?.code === 'EBUSY') throw new SessionAlreadyOwnedError(id)
        throw error
      }
      return new SessionWriteLease({ kind: 'win32', handle })
    }

    if (process.title === 'dsh-webworker') {
      if (workerHeldLocks.has(path)) {
        throw new SessionAlreadyOwnedError(id)
      }
      workerHeldLocks.add(path)
      return new SessionWriteLease({ kind: 'worker', path })
    }

    throw new Error(`session write lease is unsupported on ${process.platform}`)
  }

  /**
   * Release the lock by closing its handle or releasing its in-process reservation. Idempotent.
   */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    if (this.held.kind === 'win32') {
      await releaseLockHandleWin32(this.held.handle)
    } else {
      workerHeldLocks.delete(this.held.path)
    }
  }
}
