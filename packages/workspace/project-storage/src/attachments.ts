import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectAttachmentScope, ProjectStorage } from './types.ts'

/**
 * Resolve attachment ownership from the registered Session membership.
 * @param ctx - Host context that resolves ProjectStorage from Cordis's global store without property injection.
 * @param sessionId - trusted Session address from the Host or live Agent.
 * @returns the project attachment scope, or `undefined` when project storage is not mounted.
 * @throws when the Session has no registered project owner.
 */
export function resolveProjectAttachmentScope(ctx: Context, sessionId: SessionId): ProjectAttachmentScope | undefined {
  const storage = ctx.get('projectStorage', false) as ProjectStorage | undefined
  if (storage === undefined) return undefined
  const location = storage.locateSession(sessionId)
  if (location === undefined) throw new Error(`Session has no registered project attachment owner: ${sessionId}`)
  return { projectId: location.projectId, sessionId }
}
