/**
 * The adoption event append: the durable record that moves a stored Session's
 * effective working directory onto the adopting Workspace root.
 * @module @deepseek-ai/dsh-project-adopt/adopt-session
 */

import { realpath } from 'node:fs/promises'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-working-directory'

/**
 * Append the adoption `working-directory/change` event to a stored Session's log
 * unless the log already records `targetRoot` as its current directory. The
 * stored header is never rewritten; replaying the appended event restores the
 * adopted directory on this machine. Re-running on an already adopted Session
 * opens and reads the log once and writes nothing.
 * @param persistence - Project Session persistence owning the stored Session.
 * @param sessionId - Stored Session identity to rehome.
 * @param targetRoot - Canonical directory the Session adopts as its effective working directory.
 * @returns completion after the appended event is durable; resolves without writing when the log already ends at `targetRoot`.
 * @throws when the Session cannot be opened, read, or appended; the log is left unchanged unless the append itself succeeded.
 */
export async function appendWorkingDirectoryEvent(
  persistence: SessionPersistence,
  sessionId: SessionId,
  targetRoot: string,
): Promise<void> {
  const handle = await persistence.open(sessionId, 'write')
  try {
    const { events } = await handle.read(0)
    const known = events.findLast(event => event.type === 'working-directory/change')?.data.cwd
      ?? handle.header.cwd
    if (known !== undefined && await resolvesTo(known, targetRoot)) return
    const last = events.at(-1)
    const event: SessionEvent = {
      type: 'working-directory/change',
      seq: SessionSeq(last === undefined ? 0 : last.seq + 1),
      time: Date.now(),
      data: { cwd: targetRoot },
    }
    await handle.append([event])
    await handle.flush()
  } finally {
    await handle.close()
  }
}

/**
 * Whether `path` names the same live directory as `targetRoot`.
 * @param path - Candidate directory, usually a historical log value.
 * @param targetRoot - Canonical live directory.
 * @returns `false` when `path` does not resolve, since a vanished directory can never equal the live target.
 * @throws when `path` fails to resolve for a reason other than absence.
 */
async function resolvesTo(path: string, targetRoot: string): Promise<boolean> {
  try {
    return await realpath(path) === targetRoot
  } catch (error) {
    // The known directory usually names the origin machine and is gone.
    if (isMissingPath(error)) return false
    throw error
  }
}

/**
 * Whether a filesystem error reports a missing path.
 * @param error - Error from a `node:fs` operation.
 * @returns `true` when the error carries the `ENOENT` code.
 */
function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
