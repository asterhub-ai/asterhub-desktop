/** Task detail with config, history, edit form, and actions. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseOutlineRegular, IconEditOutlineRegular, IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  AutomationTask, AutomationTaskId, AutomationRun, AutomationRunId,
  AutomationDraft, AutomationChoices, AutomationPreview,
  AutomationOperation,
} from '@deepseek-ai/dsh-asterhub-automation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CatalogSnapshot } from './catalog-source.ts'
import { AutomationForm } from './AutomationForm.tsx'
import css from './AutomationPanel.module.css'

/** Detail tab. */
export type AutomationDetailTab = 'config' | 'history'

/** Management outcome from commit. */
export interface ManagementOutcome {
  readonly ok: boolean
  readonly taskId: AutomationTaskId
  readonly deleted: boolean
  readonly runId: AutomationRunId | null
  readonly errorCode: string
}

/** Pending operation awaiting user confirmation. */
export interface PendingOperation {
  readonly requestId: string
  readonly confirmationId: string | null
  readonly operation: AutomationOperation
  readonly summary: string
}

/** Result of prepareOperation. */
export type PrepareResult =
  | { ok: true; prepared: PendingOperation }
  | { ok: false; errorCode: string }

/** Detail actions called by the detail. */
export interface AutomationDetailInjected {
  readonly hooks: { readonly catalog: HostObservable<CatalogSnapshot<AutomationTask>> }
  readonly onRetry: (readRequest: number) => Promise<void>
  readonly loadRuns: (id: AutomationTaskId, limit: number, before?: AutomationRunId) => Promise<{ records: readonly AutomationRun[]; ok: boolean }>
  readonly onOpenSession: (id: SessionId) => void
  readonly reportSuccess: (kind: 'deleted' | 'paused' | 'resumed' | 'runStarted' | 'stopped', taskId: AutomationTaskId) => void
  readonly reportError: () => void
  /** Prepare an operation BEFORE showing confirmation dialog. */
  readonly prepareOperation: (operation: AutomationOperation) => Promise<PrepareResult>
  /** Commit a prepared operation AFTER user confirms, with SAME requestId + confirmationId. */
  readonly commitOperation: (requestId: string, confirmationId: string | null) => Promise<ManagementOutcome>
  readonly getChoices: () => Promise<AutomationChoices>
  readonly previewDraft: (draft: AutomationDraft) => Promise<AutomationPreview>
}

/** Detail props. */
export type AutomationDetailProps = AutomationDetailInjected
  & PropsLocale<'automation'>
  & Pick<PropsRuntime<'main'>, 'useSessions' | 'useWorkspaces'>
  & {
    readonly task: AutomationTask
    readonly id: string
    readonly onDeleted: () => void
    readonly onClose: () => void
    readonly tab: AutomationDetailTab
    readonly onTabChange: (tab: AutomationDetailTab) => void
  }

/** Format run state for display. */
function runStateLabel(state: AutomationRun['state'], t: (key: string) => string): string {
  return t(`run.state.${state}`)
}

/** Format run trigger for display. */
function runTriggerLabel(trigger: AutomationRun['trigger'], t: (key: string) => string): string {
  return t(`run.trigger.${trigger}`)
}

/** Format duration. */
function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return ''
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return ''
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Format timing for display with full frequency + timezone. */
function formatTimingFull(task: AutomationTask, t: (key: string) => string): string {
  const timing = task.definition.timing
  switch (timing.kind) {
    case 'once':
      return `${t('form.timing.once')} ${new Date(timing.at).toLocaleString()}`
    case 'delay':
      return `${t('form.timing.delay')} ${timing.seconds}s`
    case 'interval': {
      const hours = Math.floor(timing.seconds / 3600)
      const minutes = Math.floor((timing.seconds % 3600) / 60)
      const unit = hours > 0 ? `${hours}${t('form.interval.unit.hour')}` : `${minutes}${t('form.interval.unit.minute')}`
      return `${t('form.timing.interval')} ${unit}`
    }
    case 'daily':
      return `${t('form.timing.daily')} ${timing.time} ${timing.timeZone}`
    case 'weekly': {
      const days = timing.weekdays.map(d => t(`form.weekday.${['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][d]!}`)).join(', ')
      return `${t('form.timing.weekly')} ${timing.time} ${days} ${timing.timeZone}`
    }
    case 'cron':
      return `${t('form.timing.cron')} ${timing.expression} ${timing.timeZone}`
    default:
      return ''
  }
}

/** Recent run state label. */
function recentRunState(task: AutomationTask, t: (key: string) => string): string {
  if (task.activeRunId !== null) {
    const activeRun = task.runs.find(r => r.id === task.activeRunId)
    if (activeRun !== undefined) return runStateLabel(activeRun.state, t)
  }
  if (task.runs.length > 0) {
    return runStateLabel(task.runs[task.runs.length - 1]!.state, t)
  }
  return ''
}

/** Confirm dialog kind. */
type ConfirmKind = 'delete' | 'pause' | 'resume' | 'run' | 'stop' | null

/**
 * Render one task's detail with config, history, edit, and actions.
 * @param props - detail props.
 * @returns detail element.
 */
export function AutomationDetail(props: AutomationDetailProps) {
  const {
    task, id, tab, onTabChange,
    loadRuns, onOpenSession,
    reportSuccess, reportError,
    prepareOperation, commitOperation,
    getChoices, previewDraft,
    onDeleted, onClose, t,
    useSessions, useWorkspaces,
  } = props

  const sessions = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)

  const [editing, setEditing] = useState(false)
  const [runs, setRuns] = useState<readonly AutomationRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsOk, setRunsOk] = useState(true)
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null)
  const [pending, setPending] = useState<PendingOperation | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab !== 'history') return
    let cancelled = false
    setRunsLoading(true)
    setRunsOk(true)
    void loadRuns(task.id, 50).then(result => {
      if (!cancelled) {
        // Retain prior rows on failure: only replace on success
        if (result.ok) {
          setRuns(result.records)
        } else {
          setRunsOk(false)
        }
        setRunsLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setRunsOk(false)
        setRunsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [tab, task.id, loadRuns])

  if (task === undefined || !task.id) {
    return (
      <aside className={css.detail} id={id} tabIndex={-1} aria-label={t('detail.label')}>
        <div className={css.empty}>
          <p>{t('error.notFound')}</p>
        </div>
      </aside>
    )
  }

  if (editing) {
    return (
      <aside className={css.detail} id={id} tabIndex={-1} aria-label={t('detail.label')}>
        <AutomationForm
          task={task}
          getChoices={getChoices}
          previewDraft={previewDraft}
          prepareCreate={async (draft: AutomationDraft) => {
            const result = await prepareOperation({ action: 'create', draft })
            if (!result.ok) throw new Error(result.errorCode)
            return {
              requestId: result.prepared.requestId,
              confirmationId: result.prepared.confirmationId,
              summary: result.prepared.summary,
              requiresConfirmation: result.prepared.confirmationId !== null,
            }
          }}
          prepareUpdate={async (taskId: AutomationTaskId, expectedRevision: number, draft: AutomationDraft) => {
            const result = await prepareOperation({ action: 'update', id: taskId, expectedRevision, draft })
            if (!result.ok) throw new Error(result.errorCode)
            return {
              requestId: result.prepared.requestId,
              confirmationId: result.prepared.confirmationId,
              summary: result.prepared.summary,
              requiresConfirmation: result.prepared.confirmationId !== null,
            }
          }}
          commitOperation={async (requestId: string, confirmationId: string | null) => {
            const outcome = await commitOperation(requestId, confirmationId)
            if (!outcome.ok) throw new Error(outcome.errorCode)
            return { taskId: outcome.taskId, deleted: outcome.deleted, runId: outcome.runId }
          }}
          onCancel={() => { setEditing(false) }}
          onSaved={() => { setEditing(false) }}
          t={t}
        />
      </aside>
    )
  }

  const startAction = async (kind: ConfirmKind, operation: AutomationOperation): Promise<void> => {
    setConfirmKind(kind)
    setPreparing(true)
    setActionError(null)
    setPending(null)
    try {
      const result = await prepareOperation(operation)
      if (!result.ok) {
        setActionError(result.errorCode)
        setConfirmKind(null)
        reportError()
        return
      }
      setPending(result.prepared)
      // If no confirmation required, commit immediately
      if (result.prepared.confirmationId === null && !result.prepared.operation.action.includes('create') && !result.prepared.operation.action.includes('update')) {
        await doCommit()
      }
    } catch {
      setActionError(t('toast.error'))
      setConfirmKind(null)
    } finally {
      setPreparing(false)
    }
  }

  const doCommit = async (): Promise<void> => {
    if (pending === null) return
    setCommitting(true)
    setActionError(null)
    try {
      const outcome = await commitOperation(pending.requestId, pending.confirmationId)
      if (outcome.ok) {
        const kind = pending.operation.action
        if (kind === 'remove') reportSuccess('deleted', task.id)
        else if (kind === 'pause') reportSuccess('paused', task.id)
        else if (kind === 'resume') reportSuccess('resumed', task.id)
        else if (kind === 'run') reportSuccess('runStarted', task.id)
        else if (kind === 'stop') reportSuccess('stopped', task.id)
        if (kind === 'remove') {
          onDeleted()
        }
      } else {
        setActionError(outcome.errorCode)
      }
    } catch {
      setActionError(t('toast.error'))
    } finally {
      setCommitting(false)
      setConfirmKind(null)
      setPending(null)
    }
  }

  const cancelConfirm = (): void => {
    setConfirmKind(null)
    setPending(null)
    setActionError(null)
  }

  const confirmTitle = confirmKind === 'delete' ? t('confirm.delete')
    : confirmKind === 'pause' ? t('confirm.pause')
    : confirmKind === 'resume' ? t('confirm.resume')
    : confirmKind === 'run' ? t('confirm.run')
    : confirmKind === 'stop' ? t('confirm.run')
    : ''

  const confirmDescription = confirmKind === 'delete' 
    ? `${task.definition.name}\n${t('confirm.delete.description')}`
    : confirmKind === 'pause' ? t('confirm.pause.description')
    : confirmKind === 'resume' ? t('confirm.resume.description')
    : confirmKind === 'run' ? t('confirm.run.description')
    : ''

  return (
    <aside className={css.detail} id={id} tabIndex={-1} aria-label={t('detail.label')} ref={detailRef}>
      <div className={css.detailTabsBar}>
        <div className={css.detailTabs} role="tablist" aria-label={t('detail.tabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'config'}
            className={css.detailTab}
            onClick={() => { onTabChange('config') }}
          >
            {t('detail.config')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={css.detailTab}
            onClick={() => { onTabChange('history') }}
          >
            {t('detail.history')}
          </button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('detail.close')}
          onClick={onClose}
        >
          <IconCloseOutlineRegular size={16} />
        </Button>
      </div>
      <div className={css.detailScroll}>
        <div className={css.detailHeader}>
          <h2 className={css.detailTitle}>{task.definition.name}</h2>
          <p className={css.detailSubtitle}>
            {task.enabled ? t('status.enabled') : t('status.paused')}
            {task.nextOccurrenceAt && ` · ${t('detail.nextRun')}: ${new Date(task.nextOccurrenceAt).toLocaleString()}`}
          </p>
          <p className={css.detailSubtitle}>{formatTimingFull(task, t as unknown as (key: string) => string)}</p>
          <p className={css.detailSubtitle}>{task.definition.instruction}</p>
          {recentRunState(task, t as unknown as (key: string) => string) && (
            <p className={css.detailSubtitle}>{t('run.state.running')}: {recentRunState(task, t as unknown as (key: string) => string)}</p>
          )}
        </div>
        {tab === 'config' && (
          <div>
            <div className={css.detailRow}>
              <span className={css.detailRowLabel}>{t('config.name')}</span>
              <span className={css.detailRowValue}>{task.definition.name}</span>
            </div>
            <div className={css.detailRow}>
              <span className={css.detailRowLabel}>{t('config.instruction')}</span>
              <span className={css.detailRowValue}>{task.definition.instruction}</span>
            </div>
            <div className={css.detailRow}>
              <span className={css.detailRowLabel}>{t('config.workspace')}</span>
              <span className={css.detailRowValue}>{task.definition.workspaceId}</span>
            </div>
            <div className={css.detailRow}>
              <span className={css.detailRowLabel}>{t('config.model')}</span>
              <span className={css.detailRowValue}>{task.definition.modelId}</span>
            </div>
            {task.definition.reasoningEffort && (
              <div className={css.detailRow}>
                <span className={css.detailRowLabel}>{t('config.reasoning')}</span>
                <span className={css.detailRowValue}>{task.definition.reasoningEffort}</span>
              </div>
            )}
            <div className={css.detailRow}>
              <span className={css.detailRowLabel}>{t('config.timezone')}</span>
              <span className={css.detailRowValue}>
                {task.definition.timing.kind === 'daily' || task.definition.timing.kind === 'weekly' || task.definition.timing.kind === 'cron'
                  ? task.definition.timing.timeZone
                  : Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </div>
          </div>
        )}
        {tab === 'history' && (
          <div>
            {runsLoading && runs.length === 0 && <p>{t('history.loading')}</p>}
            {!runsLoading && !runsOk && runs.length === 0 && <p>{t('history.error')}</p>}
            {!runsLoading && runsOk && runs.length === 0 && <p>{t('history.empty')}</p>}
            {!runsOk && runs.length > 0 && (
              <p style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{t('history.error')}</p>
            )}
            {runs.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {runs.map(run => (
                  <li key={run.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ font: '500 14px/20px var(--dsw-font-family)' }}>
                        {runStateLabel(run.state, t as unknown as (key: string) => string)}
                      </span>
                      <span style={{ font: '400 12px/16px var(--dsw-font-family)', color: 'var(--dsw-alias-label-tertiary)' }}>
                        {runTriggerLabel(run.trigger, t as unknown as (key: string) => string)}
                      </span>
                    </div>
                    <div style={{ font: '400 13px/20px var(--dsw-font-family)', color: 'var(--dsw-alias-label-secondary)', marginTop: '4px' }}>
                      {run.scheduledAt && (
                        <div>{t('run.scheduledAt')}: {new Date(run.scheduledAt).toLocaleString()}</div>
                      )}
                      {run.startedAt && (
                        <div>{t('run.startedAt')}: {new Date(run.startedAt).toLocaleString()}</div>
                      )}
                      {run.finishedAt && (
                        <div>{t('run.finishedAt')}: {new Date(run.finishedAt).toLocaleString()}</div>
                      )}
                      {run.startedAt && run.finishedAt && (
                        <div>{t('run.duration')}: {formatDuration(run.startedAt, run.finishedAt)}</div>
                      )}
                      {run.reason && (
                        <div style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
                          {t('run.reason')}: {run.reason.message}
                        </div>
                      )}
                      {run.sessionId && (() => {
                        const sid = run.sessionId
                        if (workspaces.archivedSessionIds.includes(sid)) {
                          return <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('session.archived')}</span>
                        }
                        if (sessions.ids.includes(sid)) {
                          return (
                            <button
                              type="button"
                              style={{ background: 'none', border: 'none', color: 'var(--dsw-alias-state-business-primary)', cursor: 'pointer', padding: 0, font: 'inherit' }}
                              onClick={() => { onOpenSession(sid) }}
                            >
                              {t('session.link')}
                            </button>
                          )
                        }
                        return <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('session.unavailable')}</span>
                      })()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className={css.detailActions}>
        <Button
          variant="outline"
          size="sm"
          className={css.actionButton}
          icon={<IconEditOutlineRegular size={14} />}
          onClick={() => { setEditing(true) }}
        >
          {t('action.edit')}
        </Button>
        {task.enabled && task.activeRunId === null && (
          <Button
            variant="outline"
            size="sm"
            className={css.actionButton}
            disabled={preparing || committing}
            onClick={() => { void startAction('pause', { action: 'pause', id: task.id, expectedRevision: task.revision }) }}
          >
            {t('action.pause')}
          </Button>
        )}
        {!task.enabled && (
          <Button
            variant="outline"
            size="sm"
            className={css.actionButton}
            disabled={preparing || committing}
            onClick={() => { void startAction('resume', { action: 'resume', id: task.id, expectedRevision: task.revision }) }}
          >
            {t('action.resume')}
          </Button>
        )}
        {task.enabled && (
          <Button
            variant="outline"
            size="sm"
            className={css.actionButton}
            disabled={preparing || committing}
            onClick={() => { void startAction('run', { action: 'run', id: task.id, expectedRevision: task.revision }) }}
          >
            {t('action.run')}
          </Button>
        )}
        {task.activeRunId !== null && (
          <Button
            variant="outline"
            size="sm"
            className={css.actionButton}
            disabled={preparing || committing}
            onClick={() => { void startAction('stop', { action: 'stop', id: task.id, runId: task.activeRunId! }) }}
          >
            {t('action.stop')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={clsx(css.actionButton, css.deleteButton)}
          icon={<IconTrashOutlineRegular size={14} />}
          disabled={preparing || committing}
          onClick={() => { void startAction('delete', { action: 'remove', id: task.id, expectedRevision: task.revision }) }}
        >
          {t('action.delete')}
        </Button>
      </div>
      {confirmKind !== null && pending !== null && (
        <div className={css.confirmDialog} role="dialog" aria-modal="true" aria-label={confirmTitle}>
          <div className={css.confirmContent}>
            <h3 className={css.confirmTitle}>{confirmTitle}</h3>
            <p className={css.confirmDescription}>{confirmDescription}</p>
            {pending.summary && <p className={css.confirmDescription}>{pending.summary}</p>}
            {actionError && <p className={css.formError} role="alert">{actionError}</p>}
            <div className={css.confirmActions}>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelConfirm}
                disabled={committing}
              >
                {t('confirm.no')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => { void doCommit() }}
                disabled={committing}
              >
                {committing ? t('form.actions.saving') : t('confirm.yes')}
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmKind !== null && pending === null && preparing && (
        <div className={css.confirmDialog} role="dialog" aria-modal="true" aria-label={confirmTitle}>
          <div className={css.confirmContent}>
            <h3 className={css.confirmTitle}>{confirmTitle}</h3>
            <p className={css.confirmDescription}>{t('list.loading')}</p>
          </div>
        </div>
      )}
    </aside>
  )
}
