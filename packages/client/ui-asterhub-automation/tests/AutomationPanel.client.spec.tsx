// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AutomationRun, AutomationTask } from '@deepseek-ai/dsh-asterhub-automation/client'
import { AutomationPanel, type AutomationPanelProps } from '../src/client/AutomationPanel.tsx'
import { AutomationToast, type AutomationToastProps } from '../src/client/AutomationToast.tsx'
import { runStateToastKind, type ToastSnapshot } from '../src/client/toast-source.ts'
import { en } from '../src/client/locales.ts'
import type { CatalogSnapshot } from '../src/client/catalog-source.ts'

vi.mock('../src/client/AutomationDetail.tsx', () => ({
  AutomationDetail: ({ task }: { task: AutomationTask }) => <div data-testid="automation-detail">{task.definition.name}</div>,
}))
vi.mock('../src/client/AutomationForm.tsx', () => ({ AutomationForm: () => null }))

const t = makeTranslate(en)

function task(name: string, enabled: boolean, deletedAt: string | null): AutomationTask {
  return {
    id: name as never,
    ownerAccountId: 'fixture-account',
    revision: 1,
    recordVersion: 1,
    authorizationRevision: 1,
    consentRevision: 1,
    ruleRevision: 1,
    definition: {
      name,
      instruction: `Synthetic ${name}`,
      workspaceId: 'fixture-workspace' as never,
      modelId: 'fixture-model',
      reasoningEffort: null,
      timing: { kind: 'daily', time: '08:00:00', timeZone: 'UTC' },
    },
    enabled,
    deletedAt,
    nextOccurrenceAt: deletedAt === null ? '2026-10-25T08:00:00.000Z' : null,
    occurrenceWatermark: null,
    pendingOccurrence: null,
    activeRunId: null,
    runs: [],
    requestReceipts: [],
    creationRequest: { requestId: 'fixture-request', digest: 'fixture-digest' },
    historyPruned: false,
    skippedRange: null,
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  }
}

function snapshot(records: readonly AutomationTask[]): CatalogSnapshot<AutomationTask> {
  return { records, status: 'ready', readRequest: 0, settled: true, readSettled: 1, identityGeneration: 0 }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AutomationPanel soft-deleted tasks', () => {
  it('hides deleted records in every normal filter and drops a selected detail after catalog refresh', async () => {
    let current = snapshot([
      task('active-fixture', true, null),
      task('paused-fixture', false, null),
      task('deleted-fixture', false, '2026-10-24T12:00:00.000Z'),
    ])
    const props = {
      useCatalog: <T,>(select: (value: CatalogSnapshot<AutomationTask>) => T): T => select(current),
      onRetry: vi.fn(async () => {}),
      loadRuns: vi.fn(async () => ({ records: [], ok: true })),
      onOpenSession: vi.fn(),
      reportSuccess: vi.fn(),
      reportError: vi.fn(),
      prepareOperation: vi.fn(async () => ({ ok: false, errorCode: 'unused' })),
      commitOperation: vi.fn(async () => ({ ok: false, taskId: '' as never, deleted: false, runId: null, errorCode: 'unused' })),
      getChoices: vi.fn(async () => ({ accountId: 'fixture-account', workspaces: [], models: [], defaultModelId: null, legacyScheduleStatus: 'none' })),
      previewDraft: vi.fn(async () => ({ draft: {}, nextOccurrences: [] })),
      useSessions: (select: (value: never) => unknown) => select({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} } as never),
      useWorkspaces: (select: (value: never) => unknown) => select({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready', error: null } as never),
      hooks: { catalog: {} },
      t,
    } as never
    const view = render(<AutomationPanel {...(props as AutomationPanelProps)} />)

    expect(screen.getByRole('button', { name: 'active-fixture' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'paused-fixture' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'deleted-fixture' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }))
    expect(screen.getByRole('button', { name: 'active-fixture' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'deleted-fixture' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Paused' }))
    expect(screen.getByRole('button', { name: 'paused-fixture' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'deleted-fixture' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('button', { name: 'active-fixture' }))
    expect(screen.getByTestId('automation-detail').textContent).toBe('active-fixture')
    current = snapshot([
      task('active-fixture', true, '2026-10-24T12:01:00.000Z'),
      task('paused-fixture', false, null),
    ])
    view.rerender(<AutomationPanel {...(props as AutomationPanelProps)} />)
    await waitFor(() => { expect(screen.queryByTestId('automation-detail')).toBeNull() })
    expect(screen.queryByRole('button', { name: 'active-fixture' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'deleted-fixture' })).toBeNull()
  })
})

/** Build a minimal run record for row and notification fixtures. */
function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1' as never,
    taskId: 'task-1' as never,
    trigger: 'scheduled',
    scheduledAt: '2026-10-24T08:00:00.000Z',
    requestedAt: '2026-10-24T08:00:00.000Z',
    requestId: null,
    definitionRevision: 1,
    snapshot: {
      name: 'Daily News',
      instruction: 'Summarize news',
      workspaceId: 'ws-1' as never,
      modelId: 'model-a',
      reasoningEffort: null,
      timing: { kind: 'daily', time: '08:00:00', timeZone: 'UTC' },
    },
    sessionId: null,
    sessionCreated: false,
    state: 'succeeded',
    startedAt: '2026-10-24T08:00:05.000Z',
    finishedAt: '2026-10-24T08:00:35.000Z',
    reason: null,
    ownerRuntimeId: 'runtime-1',
    inputMessageId: null,
    startLogOffset: null,
    endLogOffset: null,
    terminalTurn: null,
    interactionIds: [],
    humanIntervened: false,
    ...overrides,
  }
}

describe('automation run notifications', () => {
  it('maps a succeeded run to the run-succeeded kind, never to runStarted', () => {
    expect(runStateToastKind('succeeded')).toBe('runSucceeded')
    expect(runStateToastKind('failed')).toBe('error')
    expect(runStateToastKind('waiting-approval')).toBe('runStarted')
    expect(runStateToastKind('running')).toBeNull()
    expect(runStateToastKind('reserved')).toBeNull()
    expect(runStateToastKind('canceled')).toBeNull()
  })

  it('renders the run-succeeded toast copy from the runSucceeded kind', () => {
    const snapshot: ToastSnapshot = { toasts: [{ id: 1, kind: 'runSucceeded' }] }
    const props: AutomationToastProps = {
      useToasts: <S,>(select: (value: ToastSnapshot) => S): S => select(snapshot),
      dismiss: vi.fn(),
      t,
    }
    render(<AutomationToast {...props} />)
    expect(screen.getByText('Task run succeeded.')).toBeTruthy()
    expect(screen.queryByText('Task started.')).toBeNull()
  })
})

describe('AutomationPanel recent-run row state', () => {
  /**
   * Build panel props with stubbed actions and a snapshot-backed catalog hook.
   * The stub omits the merged global standard props, so it asserts to the
   * component's props type once, here, instead of at every render site.
   */
  function panelProps(records: readonly AutomationTask[]): AutomationPanelProps {
    return {
      useCatalog: <T,>(select: (value: CatalogSnapshot<AutomationTask>) => T): T => select(snapshot(records)),
      onRetry: vi.fn(async () => {}),
      loadRuns: vi.fn(async () => ({ records: [], ok: true })),
      onOpenSession: vi.fn(),
      reportSuccess: vi.fn(),
      reportError: vi.fn(),
      prepareOperation: vi.fn(async () => ({ ok: false, errorCode: 'unused' })),
      commitOperation: vi.fn(async () => ({ ok: false, taskId: '' as never, deleted: false, runId: null, errorCode: 'unused' })),
      getChoices: vi.fn(async () => ({ accountId: 'fixture-account', workspaces: [], models: [], defaultModelId: null, legacyScheduleStatus: 'none' })),
      previewDraft: vi.fn(async () => ({ draft: {}, nextOccurrences: [] })),
      useSessions: (select: (value: never) => unknown) => select({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} } as never),
      useWorkspaces: (select: (value: never) => unknown) => select({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready', error: null } as never),
      t,
    } as never
  }

  it('renders the recent run state and relative finished time on one line', () => {
    const finishedAt = new Date(Date.now() - 30_000).toISOString()
    const record = task('news-fixture', true, null)
    render(<AutomationPanel {...panelProps([{ ...record, runs: [makeRun({ finishedAt })] }])} />)
    const recent = screen.getByText(/Last run: Succeeded/)
    expect(recent.querySelector('time')?.getAttribute('dateTime')).toBe(finishedAt)
    expect(recent.textContent).toContain('ago')
  })

  it('prefers the active run over the last history entry for the recent-run line', () => {
    const record = task('news-fixture', true, null)
    render(<AutomationPanel {...panelProps([{
      ...record,
      activeRunId: 'run-2' as never,
      runs: [
        makeRun({ id: 'run-1' as never, state: 'succeeded' }),
        makeRun({ id: 'run-2' as never, state: 'running', finishedAt: null }),
      ],
    }])} />)
    expect(screen.getByText(/Last run: Running/)).toBeTruthy()
  })

  it('opens the recent run session from the row entry', () => {
    const record = task('news-fixture', true, null)
    const onOpenSession = vi.fn()
    render(<AutomationPanel {...panelProps([{ ...record, runs: [makeRun({ sessionId: 'session-run-1' as never })] }])} onOpenSession={onOpenSession} />)
    fireEvent.click(screen.getByRole('button', { name: /View session/ }))
    expect(onOpenSession).toHaveBeenCalledWith('session-run-1')
  })

  it('falls back to the origin session for a bound task without runs', () => {
    const record = task('bound-fixture', true, null)
    const onOpenSession = vi.fn()
    render(<AutomationPanel {...panelProps([{ ...record, originSessionId: 'session-origin-1' as never }])} onOpenSession={onOpenSession} />)
    fireEvent.click(screen.getByRole('button', { name: /View session/ }))
    expect(onOpenSession).toHaveBeenCalledWith('session-origin-1')
  })

  it('offers no session entry when no run session and no origin binding exist', () => {
    const record = task('unbound-fixture', true, null)
    render(<AutomationPanel {...panelProps([{ ...record, runs: [makeRun({ sessionId: null })] }])} />)
    expect(screen.queryByRole('button', { name: /View session/ })).toBeNull()
  })
})
