import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Refresh the session cache before navigating to a historical session. */
export async function openAutomationSession(
  id: SessionId,
  sessions: Pick<ClientContext['sessions'], 'list' | 'refresh'>,
  navigate: (sessionId: SessionId) => void,
  reportError: () => void,
): Promise<void> {
  if (!sessions.list.getSnapshot().ids.includes(id)) {
    try {
      await sessions.refresh()
    } catch {
      reportError()
      return
    }
  }
  if (!sessions.list.getSnapshot().ids.includes(id)) {
    reportError()
    return
  }
  navigate(id)
}
