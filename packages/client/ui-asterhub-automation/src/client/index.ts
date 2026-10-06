/**
 * Native AsterHub automation panel, browser entry.
 *
 * Registers the task management page directly below Plugins (order 10),
 * with a main keyed panel and sidebar.panellist entry.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
const PANEL_ID = 'asterhub-automation' as MainPanelId
import type {
  AutomationTask, AutomationTaskId, AutomationRun, AutomationRunId,
  AutomationDraft, AutomationChoices, AutomationPreview,
  AutomationOperation, AutomationPreparedOperation, AutomationMutationResult, AutomationRunsPage,
} from '@deepseek-ai/dsh-asterhub-automation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import automationRemote from '@deepseek-ai/dsh-asterhub-automation/remote'
import type {} from '@deepseek-ai/dsh-asterhub-automation/remote'
import { AutomationPanelIcon } from './AutomationPanelIcon.tsx'
import { AutomationPanel, type AutomationPanelInjected } from './AutomationPanel.tsx'
import type { AutomationDetailInjected, ManagementOutcome } from './AutomationDetail.tsx'
import { createCatalogSource } from './catalog-source.ts'
import { createToastSource } from './toast-source.ts'
import { en, zh, NS, type AutomationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native automation panel copy. */
    [NS]: AutomationKey
  }
}

/** Required services for the automation panel. */
export const inject = ['remote', 'slots', 'locale', 'uiWorkspace', 'sessions', 'workspaces']

/**
 * Register the native automation panel.
 * @param ctx - browser services used by these contributions.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(automationRemote)
  const ui = ctx.inject(['remote.automation', 'slots', 'locale', 'uiWorkspace', 'sessions', 'workspaces'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}

/** Operation that Detail can execute after user confirmation. */
export interface PendingOperation {
  readonly requestId: string
  readonly confirmationId: string | null
  readonly operation: AutomationOperation
  readonly summary: string
}

/**
 * Prepare an operation for later execution after user confirmation.
 * Returns the prepared state that Detail renders in its confirmation dialog.
 */
async function prepareOperation(
  ctx: ClientContext,
  operation: AutomationOperation,
): Promise<{ ok: true; prepared: PendingOperation } | { ok: false; errorCode: string }> {
  const prepared = await ctx.remote.automation.prepareOperation(operation) as { ok: true; value: AutomationPreparedOperation } | { ok: false; error: { code: string } }
  if (!prepared.ok) {
    return { ok: false, errorCode: prepared.error.code }
  }
  const value = prepared.value
  return {
    ok: true,
    prepared: {
      requestId: value.requestId,
      confirmationId: value.confirmationId,
      operation,
      summary: value.summary,
    },
  }
}

/**
 * Commit a prepared operation using the SAME requestId + confirmationId from prepare.
 * This is called AFTER user explicitly confirms, with the exact IDs issued by prepare.
 */
async function commitOperation(
  ctx: ClientContext,
  requestId: string,
  confirmationId: string | null,
): Promise<ManagementOutcome> {
  const result = await ctx.remote.automation.commitOperation({ requestId, confirmationId })
  if (!result.ok) {
    return { ok: false, taskId: '' as AutomationTaskId, deleted: false, runId: null, errorCode: result.error.code }
  }
  const value: AutomationMutationResult = result.value
  return {
    ok: true,
    taskId: value.taskId,
    deleted: value.deleted,
    runId: value.runId,
    errorCode: '',
  }
}

function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-asterhub-automation: dictionaries')
  const t = ctx.locale.bind(NS)

  // Catalog source for task list - follows ui-schedule patterns
  const manager = createCatalogSource<AutomationTask>({
    list: async () => {
      const result = await ctx.remote.automation.list({ limit: 100, status: 'all' })
      if (!result.ok) {
        // Detect unauthorized vs generic error
        if ((result.error as any).code === 'unauthorized' || (result.error as any).code === 'not_authenticated') {
          const err = new Error('unauthorized') as Error & { code: string }
          err.code = 'unauthorized'
          throw err
        }
        throw result.error
      }
      return [...result.value.tasks]
    },
    subscribeChanged: listener => ctx.remote.$on('automation/changed' as any, listener),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })

  // Toast source for notifications
  const toast = createToastSource()

  // Diff cache for run state notifications
  let lastRunSnapshot = new Map<string, { state: string; runId: string | null }>()

  // Subscribe to settled catalog snapshots for run state notifications
  // NOT on the initial-history notification: wait for ready status
  ctx.remote.$on('automation/changed' as any, () => {
    void manager.onRetry()
  })

  // Subscribe to catalog snapshot changes to detect run state transitions
  manager.hooks.catalog.subscribe(() => {
    const snapshot = manager.hooks.catalog.getSnapshot()
    if (snapshot.status !== 'ready') return
    const currentSnapshot = new Map<string, { state: string; runId: string | null }>()
    for (const task of snapshot.records) {
      const activeRun = task.activeRunId ? task.runs.find(r => r.id === task.activeRunId) : undefined
      const lastRun = task.runs[task.runs.length - 1]
      const run = activeRun ?? lastRun
      if (run) {
        currentSnapshot.set(task.id, { state: run.state, runId: run.id })
      }
    }
    // Report state transitions
    for (const [taskId, current] of currentSnapshot) {
      const previous = lastRunSnapshot.get(taskId)
      if (previous && previous.runId === current.runId && previous.state === current.state) continue
      // New run or state change
      if (current.state === 'succeeded' || current.state === 'failed' || current.state === 'waiting-approval') {
        const kind = current.state === 'succeeded' ? 'runStarted' :
          current.state === 'failed' ? 'error' :
          'runStarted'
        toast.report({ kind, taskId })
      }
    }
    lastRunSnapshot = currentSnapshot
  })

  // Subscribe to account-changed: reset identity so old-account drafts cannot survive
  ctx.remote.$on('automation/account-changed' as any, () => {
    // Clear diff cache for run notifications
    lastRunSnapshot = new Map()
    // Clear toast queue
    toast.clearAll()
    // Reset identity generation - this fences late RPC replies
    manager.resetIdentity()
    // Trigger refresh with new identity
    void manager.onRetry()
  })

  // Subscribe to connection/reset: reset identity and clear caches
  ctx.on('connection/reset', () => {
    lastRunSnapshot = new Map()
    toast.clearAll()
    manager.resetIdentity()
  })

  const refreshCatalog = async (): Promise<void> => {
    await manager.onRetry()
  }

  const reportSuccess = (kind: 'deleted' | 'paused' | 'resumed' | 'runStarted' | 'stopped', taskId: AutomationTaskId): void => {
    toast.report({ kind, taskId })
  }

  const reportError = (): void => {
    toast.report({ kind: 'error', message: t('toast.error') })
  }

  const loadRuns = async (
    id: AutomationTaskId,
    limit: number,
    before?: AutomationRunId,
  ): Promise<{ records: readonly AutomationRun[]; ok: boolean }> => {
    const result = await ctx.remote.automation.runs(before ? { id, limit, before } : { id, limit })
    if (!result.ok) return { records: [], ok: false }
    const page: AutomationRunsPage = result.value
    return { records: page.records, ok: true }
  }

  const openSession = (id: SessionId): void => {
    ctx.uiWorkspace.openSession(id)
  }

  const getChoices = async (): Promise<AutomationChoices> => {
    const result = await ctx.remote.automation.choices()
    if (!result.ok) throw result.error
    return result.value
  }

  const previewDraft = async (draft: AutomationDraft): Promise<AutomationPreview> => {
    const result = await ctx.remote.automation.preview(draft)
    if (!result.ok) throw result.error
    return result.value
  }

  // Detail uses these to prepare operations BEFORE showing confirmation
  const prepareOperationCallback = async (operation: AutomationOperation) => {
    return prepareOperation(ctx, operation)
  }

  // Detail calls this AFTER user confirms, with SAME IDs from prepare
  const commitOperationCallback = async (
    requestId: string,
    confirmationId: string | null,
  ): Promise<ManagementOutcome> => {
    const outcome = await commitOperation(ctx, requestId, confirmationId)
    if (outcome.ok) {
      await refreshCatalog()
    } else {
      reportError()
    }
    return outcome
  }

  const detail: AutomationDetailInjected = {
    hooks: manager.hooks,
    onRetry: manager.onRetry,
    loadRuns,
    onOpenSession: openSession,
    reportSuccess,
    reportError,
    prepareOperation: prepareOperationCallback,
    commitOperation: commitOperationCallback,
    getChoices,
    previewDraft,
  }

  // Main panel
  ctx.get('slots')!.inject('main', () => ctx.get('slots')!.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): AutomationPanelInjected => ({
      ...detail,
    }),
  }, AutomationPanel))

  // Sidebar entry - order 10 directly below Plugins (order 0)
  ctx.get('slots')!.inject('sidebar.panellist', () => ctx.get('slots')!.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 10,
    locale: NS,
    label: () => t('panel'),
  }, AutomationPanelIcon))
}
