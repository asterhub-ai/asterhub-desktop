import type { Context } from '@deepseek-ai/cordis'
import type {} from './index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectAttachmentScope } from './types.ts'

/**
 * Resolve attachment ownership from the registered Session membership.
 * @param ctx - Host context with the project storage service.
 * @param sessionId - trusted Session address from the Host or live Agent.
 * @returns the project ID and Session ID required to route attachment access.
 * @throws when the Session has no registered project owner.
 */
export function resolveProjectAttachmentScope(ctx: Context, sessionId: SessionId): ProjectAttachmentScope {
  const location = ctx.projectStorage.locateSession(sessionId)
  if (location === undefined) throw new Error(`Session has no registered project attachment owner: ${sessionId}`)
  return { projectId: location.projectId, sessionId }
}
