// @vitest-environment jsdom
/**
 * Detail action commit regression (D8): a prepared operation with no
 * confirmation challenge commits in the same tick as prepareOperation (the
 * state-held `pending` is not yet visible to a re-render closure there), a
 * confirmation-challenged action commits only through the dialog, and a
 * failed commit reports no success while surfacing its errorCode beside the
 * actions once the dialog context closed.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  AutomationChoices, AutomationDraft, AutomationTask, AutomationTaskId, AutomationRun, AutomationRunId,
} from '@deepseek-ai/dsh-asterhub-automation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AutomationDetail, type AutomationDetailProps, type ManagementOutcome, type PendingOperation, type PrepareResult,
} from '../src/client/AutomationDetail.tsx'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

const t = makeTranslate(en)

/** Build a minimal choices object for tests. */
function makeChoices(): AutomationChoices {
  return {
    accountId: 'account-1',
    workspaces: [
      { id: 'ws-1' as never, name: 'Workspace 1', path: '/tmp/ws1' },
    ],
    models: [
      { id: 'model-a', name: 'Model A', reasoningEfforts: ['low', 'high'] },
    ],
    defaultModelId: 'model-a',
    legacyScheduleStatus: 'none',
  }
}

/** Build a minimal enabled task with no active run. */
function makeTask(overrides: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 'task-1' as AutomationTaskId,
    ownerAccountId: 'account-1',
    revision: 1,
    recordVersion: 1,
    authorizationRevision: 1,
    consentRevision: 1,
    ruleRevision: 1,
    definition: {
      name: 'Daily News',
      instruction: 'Summarize news',
      workspaceId: 'ws-1' as never,
      modelId: 'model-a',
      reasoningEffort: null,
      timing: { kind: 'daily', time: '08:00', timeZone: 'Asia/Shanghai' },
    },
    enabled: true,
    deletedAt: null,
    nextOccurrenceAt: '2026-10-06T00:00:00.000Z',
    occurrenceWatermark: null,
    pendingOccurrence: null,
    activeRunId: null,
    runs: [],
    requestReceipts: [],
    creationRequest: { requestId: 'req-1', digest: 'd-1' },
    historyPruned: false,
    skippedRange: null,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  }
}

/** Build detail props with stubbed hooks and callbacks. */
function makeDetailProps(overrides: Partial<AutomationDetailProps> = {}): AutomationDetailProps {
  return {
    onRetry: vi.fn(async () => {}),
    loadRuns: vi.fn(async () => ({ records: [], ok: true })),
    onOpenSession: vi.fn(),
    reportSuccess: vi.fn(),
    reportError: vi.fn(),
    prepareOperation: vi.fn(async (): Promise<PrepareResult> => ({ ok: false, errorCode: 'not-prepared' })),
    commitOperation: vi.fn(async (): Promise<ManagementOutcome> => ({
      ok: false, taskId: '' as AutomationTaskId, deleted: false, runId: null, errorCode: 'not-committed',
    })),
    getChoices: vi.fn(async () => makeChoices()),
    previewDraft: vi.fn(async () => ({ draft: {} as AutomationDraft, nextOccurrences: [] })),
    useWorkspaces: select => select({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }),
    task: makeTask(),
    id: 'automation-detail-test',
    onDeleted: vi.fn(),
    onClose: vi.fn(),
    tab: 'config',
    onTabChange: vi.fn(),
    t,
    ...overrides,
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AutomationDetail action commit (D8)', () => {
  it('commits a delete immediately when prepare needs no confirmation', async () => {
    const task = makeTask()
    const prepared: PendingOperation = {
      requestId: 'req-delete-1',
      confirmationId: null,
      operation: { action: 'remove', id: task.id, expectedRevision: task.revision },
      summary: 'Delete Daily News',
    }
    const commitOperation = vi.fn<AutomationDetailProps['commitOperation']>(async () => ({
      ok: true, taskId: task.id, deleted: true, runId: null, errorCode: '',
    }))
    const onDeleted = vi.fn()
    const props = makeDetailProps({
      task,
      prepareOperation: vi.fn(async (): Promise<PrepareResult> => ({ ok: true, prepared })),
      commitOperation,
      onDeleted,
    })
    render(<AutomationDetail {...props} />)

    fireEvent.click(screen.getByRole('button', { name: en['action.delete'] }))

    // The old closure bug returned on `pending === null` here and never committed.
    await waitFor(() => {
      expect(commitOperation).toHaveBeenCalledTimes(1)
    })
    expect(commitOperation.mock.calls[0]?.[0]).toBe('req-delete-1')
    expect(props.reportSuccess).toHaveBeenCalledWith('deleted', task.id)
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('commits a confirmation-challenged action only through the dialog', async () => {
    const task = makeTask()
    const prepared: PendingOperation = {
      requestId: 'req-pause-1',
      confirmationId: 'conf-pause-1',
      operation: { action: 'pause', id: task.id, expectedRevision: task.revision },
      summary: 'Pause Daily News',
    }
    const commitOperation = vi.fn<AutomationDetailProps['commitOperation']>(async () => ({
      ok: true, taskId: task.id, deleted: false, runId: null, errorCode: '',
    }))
    const props = makeDetailProps({
      task,
      prepareOperation: vi.fn(async (): Promise<PrepareResult> => ({ ok: true, prepared })),
      commitOperation,
    })
    render(<AutomationDetail {...props} />)

    // Confirm buttons exist only once the prepared operation reached the dialog.
    fireEvent.click(screen.getByRole('button', { name: en['action.pause'] }))
    await screen.findByRole('button', { name: en['confirm.yes'] })
    expect(commitOperation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en['confirm.no'] }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(commitOperation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en['action.pause'] }))
    await screen.findByRole('button', { name: en['confirm.yes'] })
    fireEvent.click(screen.getByRole('button', { name: en['confirm.yes'] }))

    await waitFor(() => {
      expect(commitOperation).toHaveBeenCalledTimes(1)
    })
    expect(commitOperation.mock.calls[0]?.[0]).toBe('req-pause-1')
    expect(commitOperation.mock.calls[0]?.[1]).toBe('conf-pause-1')
    expect(props.reportSuccess).toHaveBeenCalledWith('paused', task.id)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the commit errorCode beside the actions and reports no success when commit fails', async () => {
    const task = makeTask()
    const prepared: PendingOperation = {
      requestId: 'req-delete-2',
      confirmationId: null,
      operation: { action: 'remove', id: task.id, expectedRevision: task.revision },
      summary: 'Delete Daily News',
    }
    const reportSuccess = vi.fn()
    const onDeleted = vi.fn()
    const commitOperation = vi.fn<AutomationDetailProps['commitOperation']>(async () => ({
      ok: false, taskId: task.id, deleted: false, runId: null, errorCode: 'revision-conflict',
    }))
    const props = makeDetailProps({
      task,
      reportSuccess,
      onDeleted,
      prepareOperation: vi.fn(async (): Promise<PrepareResult> => ({ ok: true, prepared })),
      commitOperation,
    })
    render(<AutomationDetail {...props} />)

    fireEvent.click(screen.getByRole('button', { name: en['action.delete'] }))

    await waitFor(() => {
      expect(commitOperation).toHaveBeenCalledTimes(1)
    })
    expect(commitOperation.mock.calls[0]?.[0]).toBe('req-delete-2')
    expect(commitOperation.mock.calls[0]?.[1]).toBeNull()
    expect(reportSuccess).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    // With the dialog context closed, the stored errorCode surfaces beside
    // the action buttons.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await screen.findByRole('alert')).textContent).toBe('revision-conflict')
  })
})

describe('AutomationDetail run history session links', () => {
  const run: AutomationRun = {
    id: 'run-1' as AutomationRunId,
    taskId: 'task-1' as AutomationTaskId,
    trigger: 'manual',
    scheduledAt: null,
    requestedAt: '2026-10-25T10:00:00.000Z',
    requestId: null,
    definitionRevision: 1,
    snapshot: {
      name: 'Daily News', instruction: 'Summarize news', workspaceId: 'ws-1' as never,
      modelId: 'model-a', reasoningEffort: null,
      timing: { kind: 'daily', time: '08:00', timeZone: 'Asia/Shanghai' },
    },
    sessionId: 'session-1' as SessionId,
    sessionCreated: true,
    state: 'succeeded',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: '2026-10-25T10:00:01.000Z',
    reason: null,
    ownerRuntimeId: 'runtime-1',
    inputMessageId: null,
    startLogOffset: null,
    endLogOffset: null,
    terminalTurn: null,
    interactionIds: [],
    humanIntervened: false,
  }

  it('does not offer archived sessions from persisted runs', async () => {
    render(<AutomationDetail {...makeDetailProps({
      tab: 'history',
      loadRuns: vi.fn(async () => ({ records: [run], ok: true })),
      useWorkspaces: select => select({
        items: [], archivedSessionIds: ['session-1' as SessionId],
        pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
    })} />)
    expect(await screen.findByText(t('session.archived'))).not.toBeNull()
    expect(screen.queryByRole('button', { name: t('session.link') })).toBeNull()
  })
})
