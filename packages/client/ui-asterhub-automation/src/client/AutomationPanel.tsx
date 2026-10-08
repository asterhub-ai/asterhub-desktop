/** Native automation task management panel. */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconClockOutlineRegular, IconCloseOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AutomationTask, AutomationTaskId, AutomationChoices } from '@deepseek-ai/dsh-asterhub-automation/client'
import type { CatalogSnapshot } from './catalog-source.ts'
import { AutomationFeedback } from './AutomationFeedback.tsx'
import { AutomationDetail, type AutomationDetailInjected, type AutomationDetailTab } from './AutomationDetail.tsx'
import { AutomationForm } from './AutomationForm.tsx'
import css from './AutomationPanel.module.css'

/** Injected catalog and task actions for the management panel. */
export interface AutomationPanelInjected extends AutomationDetailInjected {
  readonly hooks: { readonly catalog: HostObservable<CatalogSnapshot<AutomationTask>> }
}

/** Root-scoped task catalog props. */
export type AutomationPanelProps = PropsRuntime<'main'>
  & InjectFace<AutomationPanelInjected>
  & PropsLocale<'automation'>

type StatusFilter = 'all' | 'enabled' | 'paused'

/** Format timing for list row: full frequency + timezone. */
function formatTiming(task: AutomationTask, t: (key: string) => string): string {
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

/** Format next occurrence. */
function formatNextOccurrence(task: AutomationTask): string {
  if (!task.enabled || task.deletedAt !== null) return ''
  if (task.nextOccurrenceAt === null) return ''
  return new Date(task.nextOccurrenceAt).toLocaleString()
}

/** Recent run state label for row. */
function recentRunState(task: AutomationTask, t: (key: string) => string): string {
  if (task.activeRunId !== null) {
    const activeRun = task.runs.find(r => r.id === task.activeRunId)
    if (activeRun !== undefined) return t(`run.state.${activeRun.state}`)
  }
  if (task.runs.length > 0) {
    return t(`run.state.${task.runs[task.runs.length - 1]!.state}`)
  }
  return ''
}

/**
 * Render the automation task management panel.
 * @param props - framework catalog snapshot, localized copy, and action callbacks.
 * @returns the searchable task list beside the selected task's detail.
 */
export function AutomationPanel(props: AutomationPanelProps) {
  const { useCatalog, onRetry, t, ...detailProps } = props
  const catalog = useCatalog(snapshot => snapshot)
  const { records, status, identityGeneration } = catalog
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState<AutomationTaskId | null>(null)
  const [tab, setTab] = useState<AutomationDetailTab>('config')
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [legacyStatus, setLegacyStatus] = useState<'none' | 'present' | 'unreadable'>('none')

  // Track identity generation to unmount sensitive drafts on account/reset.
  // When identityGeneration changes (account-changed or connection/reset),
  // close any open form/detail so old-account instruction drafts cannot
  // survive or save into the new account.
  const identityKey = identityGeneration
  useEffect(() => {
    // On identity change: drop creating form, selected detail, and filters.
    setCreating(false)
    setSelectedId(null)
    setSearch('')
    setStatusFilter('all')
    setTab('config')
  }, [identityKey])

  // Listen for automation/select-task events from the toolview card
  // to navigate to a task without sending model input
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ taskId: AutomationTaskId }>).detail
      if (detail && typeof detail.taskId === 'string') {
        setSelectedId(detail.taskId)
        setTab('config')
        setCreating(false)
      }
    }
    window.addEventListener('automation/select-task', handler)
    return () => { window.removeEventListener('automation/select-task', handler) }
  }, [])
  // Fetch choices to detect legacy schedule status (epoch-fenced by index.ts)
  useEffect(() => {
    let cancelled = false
    void detailProps.getChoices().then((choices: AutomationChoices) => {
      if (!cancelled) {
        setLegacyStatus(choices.legacyScheduleStatus)
      }
    }).catch(() => {
      if (!cancelled) setLegacyStatus('none')
    })
    return () => { cancelled = true }
  }, [detailProps.getChoices, identityKey])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return records.filter(record => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'enabled' && record.enabled && record.deletedAt === null)
        || (statusFilter === 'paused' && !record.enabled && record.deletedAt === null)
      const matchesSearch = record.definition.name.toLowerCase().includes(query)
        || record.definition.instruction.toLowerCase().includes(query)
      return matchesStatus && matchesSearch
    }).toSorted((left, right) => {
      const leftNext = left.nextOccurrenceAt ?? ''
      const rightNext = right.nextOccurrenceAt ?? ''
      return leftNext.localeCompare(rightNext)
    })
  }, [records, search, statusFilter])

  const emptyTitle = statusFilter === 'paused' && search.trim() === ''
    ? 'list.emptyInactive'
    : records.length === 0 ? 'list.empty' : 'list.noMatches'

  const selected = useMemo(() =>
    records.find(item => item.id === selectedId),
    [records, selectedId]
  )

  useEffect(() => {
    if (selectedId !== null) return
    if (rowRef.current !== null) {
      const target = rowRef.current.isConnected ? rowRef.current : headingRef.current
      target?.focus()
      rowRef.current = null
    }
  }, [selectedId])

  useEffect(() => {
    if (status !== 'ready') return
    if (selectedId !== null && selected === undefined) setSelectedId(null)
  }, [status, selectedId, selected])

  const closeDetails = (): void => {
    setSelectedId(null)
  }

  const detailId = `automation-detail-${selectedId ?? 'none'}`

  return (
    <section
      className={clsx(css.page, selected !== undefined && css.hasDetails)}
      aria-label={t('title')}
      data-testid="automation-panel"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || selectedId === null) return
        event.preventDefault()
        event.stopPropagation()
        closeDetails()
      }}
    >
      <div className={css.listPane}>
        <div className={css.pageScroll}>
          <div className={css.pageContent}>
            <div className={css.pageHeading}>
              <h1 ref={headingRef} tabIndex={-1}>{t('title')}</h1>
              <div className={css.creationActions}>
                <Button
                  variant="primary"
                  size="sm"
                  className={css.newButton}
                  icon={<IconPlusOutlineRegular size={13} />}
                  onClick={() => { setCreating(true) }}
                >
                  {t('new.action')}
                </Button>
              </div>
            </div>
            {legacyStatus !== 'none' && (
              <div className={css.banner} role="alert">
                <span>{t(legacyStatus === 'present' ? 'banner.legacy.present' : 'banner.legacy.unreadable')}</span>
              </div>
            )}
            <div className={css.filters}>
              <div className={css.filterTabs} role="group" aria-label={t('statusFilter.label')}>
                {(['all', 'enabled', 'paused'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    className={clsx(css.filterTab, statusFilter === value && css.filterTabActive)}
                    aria-pressed={statusFilter === value}
                    onClick={() => { setStatusFilter(value) }}
                  >
                    {t(value === 'all' ? 'statusFilter.all' : `status.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.searchField}>
              <Input
                type="search"
                icon={<IconSearchOutlineRegular />}
                aria-label={t('search.label')}
                placeholder={t('search.placeholder')}
                value={search}
                onChange={(event) => { setSearch(event.target.value) }}
              />
              {search !== '' && (
                <Button
                  size="sm"
                  className={css.searchClear}
                  aria-label={t('search.clear')}
                  onClick={() => { setSearch('') }}
                >
                  <IconCloseOutlineRegular />
                </Button>
              )}
            </div>
            <div className={css.list}>
              {selected === undefined && (
                <AutomationFeedback
                  status={status}
                  populated={rows.length > 0}
                  onRetry={onRetry}
                  t={t}
                />
              )}
              {status === 'ready' && rows.length === 0 && (
                <div className={css.empty} role="status">
                  <IconClockOutlineRegular size={24} className={css.emptyGlyph} />
                  <h2>{t(emptyTitle)}</h2>
                  <Button variant="outline" className={css.emptyAction} onClick={() => { setCreating(true) }}>
                    {t('empty.action')}
                  </Button>
                </div>
              )}
              <ul className={css.listRows} aria-label={t('list.label')} aria-busy={status === 'loading'}>
                {rows.map((record) => {
                  const nextRun = formatNextOccurrence(record)
                  const isPaused = !record.enabled || record.deletedAt !== null
                  const recentState = recentRunState(record, t as unknown as (key: string) => string)
                  return (
                    <li key={record.id}>
                      <Button
                        className={clsx(
                          css.row,
                          selectedId === record.id && css.selectedRow,
                          isPaused && css.pausedRow
                        )}
                        aria-label={record.definition.name}
                        aria-describedby={`${detailId}-metadata-${record.id}`}
                        aria-expanded={selectedId === record.id}
                        aria-controls={selectedId === record.id ? detailId : undefined}
                        onClick={(event) => {
                          rowRef.current = event.currentTarget
                          setSelectedId(record.id)
                          setTab('config')
                        }}
                      >
                        <IconClockOutlineRegular className={css.rowGlyph} />
                        <span className={css.rowContent}>
                          <span className={css.rowTitle}>{record.definition.name}</span>
                          <span className={css.rowSummary} id={`${detailId}-metadata-${record.id}`}>
                            {isPaused && <span className={css.metadata}>{t('status.paused')}</span>}
                            <span className={css.metadata}>{formatTiming(record, t as unknown as (key: string) => string)}</span>
                            {!isPaused && nextRun && (
                              <span className={css.metadata}>
                                {t('list.nextPrefix')}
                                <time dateTime={record.nextOccurrenceAt ?? undefined}>
                                  {nextRun}
                                </time>
                              </span>
                            )}
                            {recentState && (
                              <span className={css.metadata}>{recentState}</span>
                            )}
                          </span>
                          <span className={css.rowInstruction}>{record.definition.instruction}</span>
                        </span>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {creating && (
        <AutomationForm
          key={identityKey}
          getChoices={detailProps.getChoices}
          previewDraft={detailProps.previewDraft}
          prepareCreate={async (draft) => {
            const result = await detailProps.prepareOperation({ action: 'create', draft })
            if (!result.ok) throw new Error(result.errorCode)
            return {
              requestId: result.prepared.requestId,
              confirmationId: result.prepared.confirmationId,
              summary: result.prepared.summary,
              requiresConfirmation: result.prepared.confirmationId !== null,
            }
          }}
          prepareUpdate={async (id, expectedRevision, draft) => {
            const result = await detailProps.prepareOperation({ action: 'update', id, expectedRevision, draft })
            if (!result.ok) throw new Error(result.errorCode)
            return {
              requestId: result.prepared.requestId,
              confirmationId: result.prepared.confirmationId,
              summary: result.prepared.summary,
              requiresConfirmation: result.prepared.confirmationId !== null,
            }
          }}
          commitOperation={async (requestId, confirmationId) => {
            const outcome = await detailProps.commitOperation(requestId, confirmationId)
            if (!outcome.ok) throw new Error(outcome.errorCode)
            return { taskId: outcome.taskId, deleted: outcome.deleted, runId: outcome.runId }
          }}
          onCancel={() => { setCreating(false) }}
          onSaved={(taskId) => { setCreating(false); setSelectedId(taskId); void onRetry(0) }}
          t={t}
        />
      )}
      {selected !== undefined && !creating && (
        <AutomationDetail
          key={identityKey}
          {...(detailProps as unknown as AutomationDetailInjected & Pick<PropsRuntime<'main'>, 'useSessions' | 'useWorkspaces'>)}
          onRetry={onRetry}
          task={selected}
          id={detailId}
          onDeleted={closeDetails}
          onClose={closeDetails}
          tab={tab}
          onTabChange={setTab}
          t={t as any}
        />


      )}
    </section>
  )
}
