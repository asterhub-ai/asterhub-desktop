/** Create/edit form for automation tasks. */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  AutomationTask, AutomationDraft, AutomationTimingInput, AutomationChoices,
  AutomationPreview, AutomationTaskId, AutomationRunId,
} from '@deepseek-ai/dsh-asterhub-automation/client'
import css from './AutomationPanel.module.css'

/** Form mode. */
export type AutomationFormMode = 'create' | 'edit'

/** Form injected actions. */
export interface AutomationFormInjected {
  readonly getChoices: () => Promise<AutomationChoices>
  readonly previewDraft: (draft: AutomationDraft) => Promise<AutomationPreview>
  readonly prepareCreate: (draft: AutomationDraft) => Promise<{ readonly requestId: string; readonly confirmationId: string | null; readonly summary: string; readonly requiresConfirmation: boolean }>
  readonly prepareUpdate: (id: AutomationTaskId, expectedRevision: number, draft: AutomationDraft) => Promise<{ readonly requestId: string; readonly confirmationId: string | null; readonly summary: string; readonly requiresConfirmation: boolean }>
  readonly commitOperation: (requestId: string, confirmationId: string | null) => Promise<{ readonly taskId: AutomationTaskId; readonly deleted: boolean; readonly runId: AutomationRunId | null }>
}

/** Form props. */
export interface AutomationFormProps extends AutomationFormInjected, PropsLocale<'automation'> {
  readonly task?: AutomationTask
  readonly onCancel: () => void
  /** Called with the persisted task id after a successful save. */
  readonly onSaved: (taskId: AutomationTaskId) => void
}

/** Timing kind options. */
const TIMING_KINDS = ['once', 'delay', 'interval', 'daily', 'weekdays', 'weekly', 'cron'] as const
type TimingKind = typeof TIMING_KINDS[number]

/** Weekday options. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** Weekday label keys. */
const WEEKDAY_LABELS: Record<number, string> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' }

/** Common timezones with UTC offsets for display. */
const COMMON_TIMEZONES = [
  { id: 'Asia/Shanghai', label: 'Asia/Shanghai', offset: 'UTC+08:00' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo', offset: 'UTC+09:00' },
  { id: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong', offset: 'UTC+08:00' },
  { id: 'Asia/Singapore', label: 'Asia/Singapore', offset: 'UTC+08:00' },
  { id: 'Europe/London', label: 'Europe/London', offset: 'UTC+00:00' },
  { id: 'Europe/Paris', label: 'Europe/Paris', offset: 'UTC+01:00' },
  { id: 'Europe/Berlin', label: 'Europe/Berlin', offset: 'UTC+01:00' },
  { id: 'America/New_York', label: 'America/New_York', offset: 'UTC-05:00' },
  { id: 'America/Chicago', label: 'America/Chicago', offset: 'UTC-06:00' },
  { id: 'America/Los_Angeles', label: 'America/Los_Angeles', offset: 'UTC-08:00' },
  { id: 'Australia/Sydney', label: 'Australia/Sydney', offset: 'UTC+10:00' },
  { id: 'UTC', label: 'UTC', offset: 'UTC+00:00' },
]


/** Form state. */
interface FormState {
  name: string
  instruction: string
  workspaceId: string
  modelId: string
  reasoningEffort: string
  timingKind: TimingKind
  onceDate: string
  onceTime: string
  delaySeconds: number
  intervalSeconds: number
  intervalFirstAt: string
  dailyTime: string
  weeklyTime: string
  weeklyWeekdays: number[]
  cronExpression: string
  timeZone: string
}

/** Default form state. */
function defaultFormState(timeZone: string): FormState {
  return {
    name: '',
    instruction: '',
    workspaceId: '',
    modelId: '',
    reasoningEffort: '',
    timingKind: 'daily',
    onceDate: '',
    onceTime: '08:00',
    delaySeconds: 3600,
    intervalSeconds: 3600,
    intervalFirstAt: '',
    dailyTime: '08:00',
    weeklyTime: '08:00',
    weeklyWeekdays: [1, 2, 3, 4, 5],
    cronExpression: '0 9 * * 1-5',
    timeZone,
  }
}

/** Seed form state from existing task. */
function seedFormState(task: AutomationTask, timeZone: string): FormState {
  const timing = task.definition.timing
  const state: FormState = {
    ...defaultFormState(timeZone),
    name: task.definition.name,
    instruction: task.definition.instruction,
    workspaceId: task.definition.workspaceId,
    modelId: task.definition.modelId,
    reasoningEffort: task.definition.reasoningEffort ?? '',
  }
  switch (timing.kind) {
    case 'once': {
      state.timingKind = 'once'
      // Convert stored UTC instant to local date/time for the controls
      const d = new Date(timing.at)
      state.onceDate = toLocalDateInput(d)
      state.onceTime = toLocalTimeInput(d)
      break
    }
    case 'delay':
      state.timingKind = 'delay'
      state.delaySeconds = timing.seconds
      break
    case 'interval': {
      state.timingKind = 'interval'
      state.intervalSeconds = timing.seconds
      // firstAt is stored as UTC instant; convert to datetime-local
      state.intervalFirstAt = toLocalDateTimeInput(new Date(timing.firstAt))
      break
    }
    case 'daily':
      state.timingKind = 'daily'
      state.dailyTime = timing.time
      state.timeZone = timing.timeZone
      break
    case 'weekly':
      state.timingKind = 'weekly'
      state.weeklyTime = timing.time
      state.weeklyWeekdays = [...timing.weekdays]
      state.timeZone = timing.timeZone
      break
    case 'cron':
      state.timingKind = 'cron'
      state.cronExpression = timing.expression
      state.timeZone = timing.timeZone
      break
  }
  return state
}

/** Format a Date as YYYY-MM-DD in local time for <input type="date">. */
function toLocalDateInput(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Format a Date as HH:mm in local time for <input type="time">. */
function toLocalTimeInput(d: Date): string {
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Format a Date as YYYY-MM-DDTHH:mm in local time for <input type="datetime-local">. */
function toLocalDateTimeInput(d: Date): string {
  return `${toLocalDateInput(d)}T${toLocalTimeInput(d)}`
}

/** Build timing input from form state.
 * Daily/weekly times from HTML time inputs are HH:mm, but native timing
 * requires HH:mm:ss (optional fraction). Append :00 when no fraction present,
 * preserve any existing fraction from seed data. */
function buildTimingInput(state: FormState): AutomationTimingInput {
  const appendSeconds = (time: string): string => {
    // Already has seconds (with or without fraction) - preserve
    if (time.includes(':') && /\d{2}:\d{2}:\d+/.test(time)) return time
    // HH:mm format from HTML input - append :00
    if (time.includes(':')) return time + ':00'
    return time
  }
  switch (state.timingKind) {
    case 'once': {
      // Convert local date+time to RFC 3339 with explicit offset
      const localDateTime = `${state.onceDate}T${state.onceTime}:00`
      const offset = getLocalOffsetForDateTime(state.onceDate, state.onceTime)
      const at = `${localDateTime}${offset}`
      return { kind: 'once', at }
    }
    case 'delay':
      return { kind: 'delay', seconds: state.delaySeconds }
    case 'interval': {
      const firstAt = state.intervalFirstAt === ''
        ? undefined
        : (() => {
            // Convert datetime-local to RFC 3339 with explicit offset
            const [date, time] = state.intervalFirstAt.split('T')
            if (!date || !time) return undefined
            const offset = getLocalOffsetForDateTime(date, time.slice(0, 5))
            return `${date}T${time.slice(0, 5)}:00${offset}`
          })()
      return { kind: 'interval', seconds: state.intervalSeconds, ...(firstAt !== undefined ? { firstAt } : {}) }
    }
    case 'daily':
      return { kind: 'daily', time: appendSeconds(state.dailyTime), timeZone: state.timeZone }
    case 'weekdays':
      return { kind: 'weekly', time: appendSeconds(state.dailyTime), timeZone: state.timeZone, weekdays: [1, 2, 3, 4, 5] }
    case 'weekly':
      return { kind: 'weekly', time: appendSeconds(state.weeklyTime), timeZone: state.timeZone, weekdays: state.weeklyWeekdays }
    case 'cron':
      return { kind: 'cron', expression: state.cronExpression, timeZone: state.timeZone }
  }
}

/** Get local timezone offset for a date+time in ±HH:mm format. */
function getLocalOffsetForDateTime(date: string, time: string): string {
  const dt = new Date(`${date}T${time}:00`)
  if (Number.isNaN(dt.getTime())) return '+00:00'
  const offsetMinutes = dt.getTimezoneOffset()
  const sign = offsetMinutes <= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0')
  const minutes = String(absOffset % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

/** Build draft from form state. */
function buildDraft(state: FormState): AutomationDraft {
  return {
    name: state.name.trim(),
    instruction: state.instruction.trim(),
    workspaceId: state.workspaceId as WorkspaceId,
    modelId: state.modelId,
    reasoningEffort: state.reasoningEffort || null,
    timing: buildTimingInput(state),
  }
}

/** Validate form state. */
function validateForm(state: FormState, t: (key: string) => string): Record<string, string> {
  const errors: Record<string, string> = {}
  if (state.name.trim().length === 0) errors.name = t('validation.name.required')
  if (state.name.length > 120) errors.name = t('validation.name.maxLength')
  if (state.instruction.trim().length === 0) errors.instruction = t('validation.instruction.required')
  if (state.workspaceId === '') errors.workspaceId = t('validation.workspace.required')
  if (state.modelId === '') errors.modelId = t('validation.model.required')
  if (state.timingKind === 'once') {
    if (state.onceDate === '') errors.onceDate = t('validation.date.required')
    if (state.onceTime === '') errors.onceTime = t('validation.time.required')
  }
  if (state.timingKind === 'interval' && state.intervalSeconds < 60) {
    errors.intervalSeconds = t('validation.interval.min')
  }
  if (state.timingKind === 'cron' && state.cronExpression.trim() === '') {
    errors.cronExpression = t('validation.cron.invalid')
  }
  return errors
}

/** Check if form has unsaved changes. */
function hasChanges(initial: FormState, current: FormState): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current)
}

/** Prepared operation shape from prepareCreate/prepareUpdate. */
interface PreparedOperation {
  readonly requestId: string
  readonly confirmationId: string | null
  readonly summary: string
  readonly requiresConfirmation: boolean
}

/**
 * Render the create/edit form.
 * @param props - form props.
 * @returns form element.
 */
export function AutomationForm(props: AutomationFormProps) {
  const {
    task, getChoices, previewDraft, prepareCreate, prepareUpdate, commitOperation,
    onCancel, onSaved, t,
  } = props

  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const mode: AutomationFormMode = task !== undefined ? 'edit' : 'create'

  const [choices, setChoices] = useState<AutomationChoices | null>(null)
  const [choicesLoading, setChoicesLoading] = useState(true)
  const [state, setState] = useState<FormState>(() =>
    task ? seedFormState(task, systemTimeZone) : defaultFormState(systemTimeZone)
  )
  const [initialState] = useState<FormState>(() =>
    task ? seedFormState(task, systemTimeZone) : defaultFormState(systemTimeZone)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<AutomationPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [prepared, setPrepared] = useState<PreparedOperation | null>(null)
  const [dirty, setDirty] = useState(false)

  // Per-mode draft retention: store draft when switching timing modes
  const modeDraftsRef = useRef<Partial<Record<TimingKind, Partial<FormState>>>>({})
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const [showTimezoneDropdown, setShowTimezoneDropdown] = useState(false)
  const [timezoneFocusedIndex, setTimezoneFocusedIndex] = useState<number>(-1)
  const timezoneSearchRef = useRef<HTMLInputElement>(null)
  const timezoneDropdownRef = useRef<HTMLUListElement>(null)

  // Filtered timezones for dropdown
  const filteredTimezones = useMemo(() =>
    COMMON_TIMEZONES.filter(tz =>
      tz.id.toLowerCase().includes(timezoneSearch.toLowerCase()) ||
      tz.offset.toLowerCase().includes(timezoneSearch.toLowerCase())
    ),
    [timezoneSearch]
  )
  useEffect(() => {
    let cancelled = false
    setChoicesLoading(true)
    void getChoices().then(c => {
      if (!cancelled) {
        setChoices(c)
        setChoicesLoading(false)
        if (state.workspaceId === '' && c.workspaces.length > 0) {
          setState(s => ({ ...s, workspaceId: c.workspaces[0]!.id }))
        }
        if (state.modelId === '' && c.defaultModelId !== null) {
          setState(s => ({ ...s, modelId: c.defaultModelId ?? '' }))
        }
      }
    }).catch(() => {
      if (!cancelled) setChoicesLoading(false)
    })
    return () => { cancelled = true }
  }, [getChoices])

  useEffect(() => {
    setDirty(hasChanges(initialState, state))
  }, [initialState, state])

  // Preview next occurrences when timing changes
  useEffect(() => {
    if (Object.keys(validateForm(state, t as unknown as (key: string) => string)).length > 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    const draft = buildDraft(state)
    const timer = setTimeout(() => {
      void previewDraft(draft).then(p => {
        if (!cancelled) {
          setPreview(p)
          setPreviewLoading(false)
        }
      }).catch(() => {
        if (!cancelled) {
          setPreview(null)
          setPreviewLoading(false)
        }
      })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [state, previewDraft, t])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setState(s => ({ ...s, [key]: value }))
    setSubmitError(null)
  }

  const updateTimingKind = (kind: TimingKind): void => {
    setState(s => {
      // Save current mode's draft before switching
      const currentKind = s.timingKind
      modeDraftsRef.current[currentKind] = {
        onceDate: s.onceDate,
        onceTime: s.onceTime,
        delaySeconds: s.delaySeconds,
        intervalSeconds: s.intervalSeconds,
        intervalFirstAt: s.intervalFirstAt,
        dailyTime: s.dailyTime,
        weeklyTime: s.weeklyTime,
        weeklyWeekdays: s.weeklyWeekdays,
        cronExpression: s.cronExpression,
        timeZone: s.timeZone,
      }
      // Restore draft from target mode if available, else use defaults
      const saved = modeDraftsRef.current[kind]
      return {
        ...s,
        timingKind: kind,
        onceDate: saved?.onceDate ?? s.onceDate,
        onceTime: saved?.onceTime ?? s.onceTime,
        delaySeconds: saved?.delaySeconds ?? s.delaySeconds,
        intervalSeconds: saved?.intervalSeconds ?? s.intervalSeconds,
        intervalFirstAt: saved?.intervalFirstAt ?? s.intervalFirstAt,
        dailyTime: saved?.dailyTime ?? s.dailyTime,
        weeklyTime: saved?.weeklyTime ?? s.weeklyTime,
        weeklyWeekdays: saved?.weeklyWeekdays ?? s.weeklyWeekdays,
        cronExpression: saved?.cronExpression ?? s.cronExpression,
        timeZone: saved?.timeZone ?? s.timeZone,
      }
    })
    setSubmitError(null)
  }

  const toggleWeekday = (day: number): void => {
    setState(s => ({
      ...s,
      weeklyWeekdays: s.weeklyWeekdays.includes(day)
        ? s.weeklyWeekdays.filter(d => d !== day)
        : [...s.weeklyWeekdays, day].sort((a, b) => a - b),
    }))
  }

  const selectedModel = useMemo(
    () => choices?.models.find(m => m.id === state.modelId),
    [choices, state.modelId]
  )

  const handleSubmit = async (): Promise<void> => {
    const validationErrors = validateForm(state, t as unknown as (key: string) => string)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const draft = buildDraft(state)
      const preparedOp: PreparedOperation = task !== undefined
        ? await prepareUpdate(task.id, task.revision, draft)
        : await prepareCreate(draft)
      setPrepared(preparedOp)
      setConfirming(true)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('toast.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = (): void => {
    if (dirty && !confirming) {
      const confirmed = window.confirm(t('confirm.title'))
      if (!confirmed) return
    }
    onCancel()
  }

  const handleConfirm = async (): Promise<void> => {
    if (prepared === null) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Pass the issued confirmationId through — no forged boolean.
      // The Host issues confirmationId in prepareOperation; the user's
      // explicit "Confirm" click here is the human confirmation channel.
      const result = await commitOperation(prepared.requestId, prepared.confirmationId)
      onSaved(result.taskId)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('toast.error'))
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }

  const formTitle = mode === 'create' ? t('form.title.new') : t('form.title.edit')
  const submitLabel = mode === 'create' ? t('form.actions.create') : t('form.actions.save')

  if (confirming && prepared !== null) {
    return (
      <div className={css.formContainer} data-testid="automation-form-confirm">
        <div className={css.formHeader}>
          <h2 className={css.formTitle}>{t('confirm.title')}</h2>
        </div>
        <div className={css.formBody}>
          <p className={css.confirmDescription}>{prepared.summary}</p>
        </div>
        <div className={css.formActions}>
          <Button
            variant="outline"
            onClick={() => { setConfirming(false); setPrepared(null) }}
            disabled={submitting}
          >
            {t('confirm.no')}
          </Button>
          <Button
            variant="primary"
            onClick={() => { void handleConfirm() }}
            disabled={submitting}
          >
            {submitting ? t('form.actions.saving') : t('confirm.yes')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={css.formContainer} data-testid="automation-form">
      <div className={css.formHeader}>
        <h2 className={css.formTitle}>{formTitle}</h2>
        <Button variant="ghost" size="sm" aria-label={t('form.actions.cancel')} onClick={handleCancel}>
          ✕
        </Button>
      </div>
      <div className={css.formBody}>
        <div className={css.formField}>
          <label className={css.formLabel} htmlFor="automation-form-name">{t('form.name')}</label>
          <Input
            id="automation-form-name"
            type="text"
            value={state.name}
            placeholder={t('form.name.placeholder')}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name ? 'automation-form-name-error' : undefined}
            onChange={(e) => { update('name', e.target.value) }}
          />
          {errors.name && <span className={css.formError} id="automation-form-name-error">{errors.name}</span>}
        </div>

        <div className={css.formField}>
          <label className={css.formLabel} htmlFor="automation-form-instruction">{t('form.instruction')}</label>
          <textarea
            id="automation-form-instruction"
            className={css.formTextarea}
            value={state.instruction}
            placeholder={t('form.instruction.placeholder')}
            rows={4}
            aria-invalid={errors.instruction !== undefined}
            aria-describedby={errors.instruction ? 'automation-form-instruction-error' : undefined}
            onChange={(e) => { update('instruction', e.target.value) }}
          />
          {errors.instruction && <span className={css.formError} id="automation-form-instruction-error">{errors.instruction}</span>}
        </div>

        <div className={css.formField}>
          <label className={css.formLabel}>{t('form.timing')}</label>
          <div className={css.formTimingTabs} role="group">
            {TIMING_KINDS.map(kind => (
              <button
                key={kind}
                type="button"
                className={clsx(css.formTimingTab, state.timingKind === kind && css.formTimingTabActive)}
                aria-pressed={state.timingKind === kind}
                onClick={() => { updateTimingKind(kind) }}
              >
                {t(`form.timing.${kind}`)}
              </button>
            ))}
          </div>
        </div>

        {state.timingKind === 'once' && (
          <div className={css.formRow}>
            <div className={css.formField}>
              <label className={css.formLabel} htmlFor="automation-form-date">{t('form.date')}</label>
              <Input
                id="automation-form-date"
                type="date"
                value={state.onceDate}
                aria-invalid={errors.onceDate !== undefined}
                onChange={(e) => { update('onceDate', e.target.value) }}
              />
              {errors.onceDate && <span className={css.formError}>{errors.onceDate}</span>}
            </div>
            <div className={css.formField}>
              <label className={css.formLabel} htmlFor="automation-form-time">{t('form.time')}</label>
              <Input
                id="automation-form-time"
                type="time"
                value={state.onceTime}
                aria-invalid={errors.onceTime !== undefined}
                onChange={(e) => { update('onceTime', e.target.value) }}
              />
              {errors.onceTime && <span className={css.formError}>{errors.onceTime}</span>}
            </div>
          </div>
        )}

        {state.timingKind === 'delay' && (
          <div className={css.formField}>
            <label className={css.formLabel} htmlFor="automation-form-delay">{t('form.interval')}</label>
            <Input
              id="automation-form-delay"
              type="number"
              min={60}
              value={state.delaySeconds}
              onChange={(e) => { update('delaySeconds', Math.max(60, Number(e.target.value))) }}
            />
          </div>
        )}

        {state.timingKind === 'interval' && (
          <div className={css.formRow}>
            <div className={css.formField}>
              <label className={css.formLabel} htmlFor="automation-form-interval">{t('form.interval')}</label>
              <Input
                id="automation-form-interval"
                type="number"
                min={60}
                value={state.intervalSeconds}
                aria-invalid={errors.intervalSeconds !== undefined}
                onChange={(e) => { update('intervalSeconds', Number(e.target.value)) }}
              />
              {errors.intervalSeconds && <span className={css.formError}>{errors.intervalSeconds}</span>}
            </div>
            <div className={css.formField}>
              <label className={css.formLabel} htmlFor="automation-form-firstat">{t('form.interval.firstAt')}</label>
              <Input
                id="automation-form-firstat"
                type="datetime-local"
                value={state.intervalFirstAt}
                onChange={(e) => { update('intervalFirstAt', e.target.value) }}
              />
            </div>
          </div>
        )}

        {(state.timingKind === 'daily' || state.timingKind === 'weekdays') && (
          <div className={css.formField}>
            <label className={css.formLabel} htmlFor="automation-form-daily-time">{t('form.time')}</label>
            <Input
              id="automation-form-daily-time"
              type="time"
              value={state.dailyTime}
              onChange={(e) => { update('dailyTime', e.target.value) }}
            />
          </div>
        )}

        {state.timingKind === 'weekly' && (
          <>
            <div className={css.formField}>
              <label className={css.formLabel} htmlFor="automation-form-weekly-time">{t('form.time')}</label>
              <Input
                id="automation-form-weekly-time"
                type="time"
                value={state.weeklyTime}
                onChange={(e) => { update('weeklyTime', e.target.value) }}
              />
            </div>
            <div className={css.formField}>
              <label className={css.formLabel}>{t('form.weekdays')}</label>
              <div className={css.formWeekdays} role="group">
                {WEEKDAYS.map(day => (
                  <button
                    key={day}
                    type="button"
                    className={clsx(css.formWeekday, state.weeklyWeekdays.includes(day) && css.formWeekdayActive)}
                    aria-pressed={state.weeklyWeekdays.includes(day)}
                    onClick={() => { toggleWeekday(day) }}
                  >
                    <span className={css.checkboxLabel}>{t(`form.weekday.${WEEKDAY_LABELS[day]!}` as Parameters<typeof t>[0])}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {state.timingKind === 'cron' && (
          <div className={css.formField}>
            <label className={css.formLabel} htmlFor="automation-form-cron">{t('form.timing.cron')}</label>
            <Input
              id="automation-form-cron"
              type="text"
              value={state.cronExpression}
              placeholder="0 9 * * 1-5"
              aria-invalid={errors.cronExpression !== undefined}
              onChange={(e) => { update('cronExpression', e.target.value) }}
            />
            {errors.cronExpression && <span className={css.formError}>{errors.cronExpression}</span>}
          </div>
        )}

        {state.timingKind !== 'once' && state.timingKind !== 'delay' && (
          <div className={css.formField}>
            <label className={css.formLabel} htmlFor="automation-form-timezone">{t('form.timezone')}</label>
            <div className={css.timezoneSearchContainer}>
              <Input
                id="automation-form-timezone-search"
                type="search"
                placeholder={t('form.timezone.search')}
                value={timezoneSearch}
                onChange={(e) => { setTimezoneSearch(e.target.value); setShowTimezoneDropdown(true); setTimezoneFocusedIndex(-1) }}
                onFocus={() => { setShowTimezoneDropdown(true); setTimezoneFocusedIndex(-1) }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowTimezoneDropdown(false)
                    setTimezoneFocusedIndex(-1)
                    e.preventDefault()
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setShowTimezoneDropdown(true)
                    setTimezoneFocusedIndex(prev => {
                      const next = prev + 1
                      return next >= filteredTimezones.length ? 0 : next
                    })
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setShowTimezoneDropdown(true)
                    setTimezoneFocusedIndex(prev => {
                      const next = prev - 1
                      return next < 0 ? filteredTimezones.length - 1 : next
                    })
                  } else if (e.key === 'Enter' && timezoneFocusedIndex >= 0 && filteredTimezones[timezoneFocusedIndex]) {
                    e.preventDefault()
                    const tz = filteredTimezones[timezoneFocusedIndex]
                    update('timeZone', tz.id)
                    setTimezoneSearch('')
                    setShowTimezoneDropdown(false)
                    setTimezoneFocusedIndex(-1)
                  }
                }}
                aria-label={t('form.timezone.search')}
                aria-expanded={showTimezoneDropdown}
                aria-controls="automation-form-timezone-listbox"
                aria-activedescendant={timezoneFocusedIndex >= 0 && filteredTimezones[timezoneFocusedIndex] ? `tz-option-${filteredTimezones[timezoneFocusedIndex].id}` : undefined}
                ref={timezoneSearchRef}
              />
              {showTimezoneDropdown && (
                <ul
                  id="automation-form-timezone-listbox"
                  className={css.timezoneDropdown}
                  role="listbox"
                  aria-label={t('form.timezone')}
                  ref={timezoneDropdownRef}
                  onMouseLeave={() => { setTimezoneFocusedIndex(-1) }}
                >
                  {filteredTimezones.map((tz, index) => (
                    <li
                      key={tz.id}
                      id={`tz-option-${tz.id}`}
                      role="option"
                      aria-selected={state.timeZone === tz.id}
                      className={clsx(
                        css.timezoneOption,
                        state.timeZone === tz.id && css.timezoneOptionSelected,
                        index === timezoneFocusedIndex && css.timezoneOptionFocused
                      )}
                      onClick={() => {
                        update('timeZone', tz.id)
                        setTimezoneSearch('')
                        setShowTimezoneDropdown(false)
                        setTimezoneFocusedIndex(-1)
                        timezoneSearchRef.current?.focus()
                      }}
                      onMouseEnter={() => { setTimezoneFocusedIndex(index) }}
                    >
                      <span className={css.timezoneLabel}>{tz.label}</span>
                      <span className={css.timezoneOffset}>{tz.offset}</span>
                    </li>
                  ))}
                  {filteredTimezones.length === 0 && (
                    <li className={css.timezoneNoResults}>{t('form.timezone.noResults')}</li>
                  )}
                </ul>
              )}
            </div>
            <input type="hidden" id="automation-form-timezone" value={state.timeZone} />
          </div>
        )}
        <div className={css.formField}>
          <label className={css.formLabel} htmlFor="automation-form-workspace">{t('form.workspace')}</label>
          <select
            id="automation-form-workspace"
            className={css.formSelect}
            value={state.workspaceId}
            aria-invalid={errors.workspaceId !== undefined}
            onChange={(e) => { update('workspaceId', e.target.value) }}
            disabled={choicesLoading}
          >
            <option value="">{t('form.workspace.select')}</option>
            {choices?.workspaces.map(ws => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
          {errors.workspaceId && <span className={css.formError}>{errors.workspaceId}</span>}
          {choicesLoading && <span className={css.formHint}>{t('list.loading')}</span>}
          {!choicesLoading && choices?.workspaces.length === 0 && <span className={css.formHint}>{t('form.workspace.none')}</span>}
        </div>

        <div className={css.formField}>
          <label className={css.formLabel} htmlFor="automation-form-model">{t('form.model')}</label>
          <select
            id="automation-form-model"
            className={css.formSelect}
            value={state.modelId}
            aria-invalid={errors.modelId !== undefined}
            onChange={(e) => { update('modelId', e.target.value) }}
            disabled={choicesLoading}
          >
            <option value="">{t('form.model.select')}</option>
            {choices?.models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {errors.modelId && <span className={css.formError}>{errors.modelId}</span>}
          {!choicesLoading && choices?.models.length === 0 && <span className={css.formHint}>{t('form.model.none')}</span>}
        </div>

        {selectedModel && selectedModel.reasoningEfforts.length > 0 && (
          <div className={css.formField}>
            <label className={css.formLabel} htmlFor="automation-form-reasoning">{t('form.reasoning')}</label>
            <select
              id="automation-form-reasoning"
              className={css.formSelect}
              value={state.reasoningEffort}
              onChange={(e) => { update('reasoningEffort', e.target.value) }}
            >
              <option value="">{t('form.reasoning.select')}</option>
              {selectedModel.reasoningEfforts.map(effort => (
                <option key={effort} value={effort}>{effort}</option>
              ))}
            </select>
          </div>
        )}

        {preview !== null && preview.nextOccurrences.length > 0 && (
          <div className={css.formPreview}>
            <label className={css.formLabel}>{t('form.preview')}</label>
            <p className={css.formPreviewDescription}>{t('form.preview.description')}</p>
            <ul className={css.formPreviewList}>
              {preview.nextOccurrences.slice(0, 3).map((occ, i) => (
                <li key={i}>{new Date(occ).toLocaleString()}</li>
              ))}
            </ul>
          </div>
        )}

        {previewLoading && (
          <div className={css.formPreview}>
            <p className={css.formHint}>{t('list.loading')}</p>
          </div>
        )}

        {submitError && (
          <div className={css.formError} role="alert">{submitError}</div>
        )}
      </div>
      <div className={css.formActions}>
        <Button variant="outline" onClick={handleCancel} disabled={submitting}>
          {t('form.actions.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => { void handleSubmit() }}
          disabled={submitting || !dirty}
        >
          {submitting ? t('form.actions.saving') : submitLabel}
        </Button>
      </div>
    </div>
  )
}
