// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AutomationTask, AutomationTaskId, AutomationDraft, AutomationChoices, AutomationPreview } from '@deepseek-ai/dsh-asterhub-automation/client'
import { AutomationForm, type AutomationFormProps } from '../src/client/AutomationForm.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

/** Build a minimal choices object for tests. */
function makeChoices(): AutomationChoices {
  return {
    accountId: 'account-1',
    workspaces: [
      { id: 'ws-1' as never, name: 'Workspace 1', path: '/tmp/ws1' },
      { id: 'ws-2' as never, name: 'Workspace 2', path: '/tmp/ws2' },
    ],
    models: [
      { id: 'model-a', name: 'Model A', reasoningEfforts: ['low', 'high'] },
      { id: 'model-b', name: 'Model B', reasoningEfforts: [] },
    ],
    defaultModelId: 'model-a',
    legacyScheduleStatus: 'none',
  }
}

/** Build a minimal task for edit mode. */
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

/** Build form props with stubbed callbacks. */
function makeFormProps(overrides: Partial<AutomationFormProps> = {}): AutomationFormProps {
  return {
    getChoices: vi.fn(async () => makeChoices()),
    previewDraft: vi.fn(async () => ({ draft: {} as AutomationDraft, nextOccurrences: ['2026-10-06T00:00:00.000Z'] } as AutomationPreview)),
    prepareCreate: vi.fn(async () => ({ requestId: 'req-1', confirmationId: null, summary: 'summary', requiresConfirmation: false })),
    prepareUpdate: vi.fn(async () => ({ requestId: 'req-2', confirmationId: null, summary: 'summary', requiresConfirmation: false })),
    commitOperation: vi.fn(async () => ({ taskId: 'task-1' as AutomationTaskId, deleted: false, runId: null })),
    onCancel: vi.fn(),
    onSaved: vi.fn(),
    t: t as any,
    ...overrides,
  } as unknown as AutomationFormProps
}

afterEach(() => { cleanup() })

describe('AutomationForm mode correctness', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders create mode with empty fields and create button label', () => {
    const props = makeFormProps()
    render(<AutomationForm {...props} />)
    expect(screen.getByRole('heading', { name: 'Create Task' })).toBeTruthy()
  })

  it('renders edit mode with prefilled fields and save button label', async () => {
    const task = makeTask()
    const props = makeFormProps({ task })
    render(<AutomationForm {...props} />)
    expect(screen.getByText('Edit Task')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByDisplayValue('Daily News')).toBeTruthy()
    })
  })

  it('shows conditional fields only for the selected timing kind', () => {
    const props = makeFormProps()
    render(<AutomationForm {...props} />)
    // Daily mode should show time field but not cron expression
    expect(screen.queryByLabelText('Time')).toBeTruthy()
    expect(screen.queryByDisplayValue('0 9 * * 1-5')).toBeNull()
  })

  it('switches timing kind and shows cron field only for cron mode', () => {
    const props = makeFormProps()
    render(<AutomationForm {...props} />)
    const cronTab = screen.getByText('Custom')
    fireEvent.click(cronTab)
    expect(screen.queryByDisplayValue('0 9 * * 1-5')).toBeTruthy()
  })

  it('preserves draft after preview failure', async () => {
    const props = makeFormProps({
      previewDraft: vi.fn(async () => { throw new Error('preview failed') }),
    })
    render(<AutomationForm {...props} />)
    const nameInput = screen.getByPlaceholderText('e.g., Daily news summary')
    fireEvent.change(nameInput, { target: { value: 'My Task' } })
    await waitFor(() => {
      expect(screen.getByDisplayValue('My Task')).toBeTruthy()
    })
    expect(screen.getByDisplayValue('My Task')).toBeTruthy()
  })
})

describe('AutomationForm preservation of draft after failure/conflict', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('preserves form input after prepareCreate failure', async () => {
    const props = makeFormProps({
      prepareCreate: vi.fn(async () => { throw new Error('prepare failed') }),
    })
    render(<AutomationForm {...props} />)
    const nameInput = screen.getByPlaceholderText('e.g., Daily news summary')
    fireEvent.change(nameInput, { target: { value: 'Test Task' } })
    const instructionInput = screen.getByPlaceholderText('Describe what this task should do…')
    fireEvent.change(instructionInput, { target: { value: 'Test instruction' } })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Task')).toBeTruthy()
    })

    const submitButton = screen.getByRole('button', { name: 'Create Task' })
    expect(submitButton).toBeTruthy()
    fireEvent.click(submitButton!)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Task')).toBeTruthy()
      expect(screen.getByDisplayValue('Test instruction')).toBeTruthy()
    })
  })

  it('preserves form input after commitOperation failure', async () => {
    const props = makeFormProps({
      commitOperation: vi.fn(async () => { throw new Error('commit failed') }),
    })
    render(<AutomationForm {...props} />)
    const nameInput = screen.getByPlaceholderText('e.g., Daily news summary')
    fireEvent.change(nameInput, { target: { value: 'Persist Task' } })
    const instructionInput = screen.getByPlaceholderText('Describe what this task should do…')
    fireEvent.change(instructionInput, { target: { value: 'Persist instruction' } })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Persist Task')).toBeTruthy()
      expect(screen.getByDisplayValue('Persist instruction')).toBeTruthy()
    })

    const submitButton = screen.getByRole('button', { name: 'Create Task' })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy()
    })

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    fireEvent.click(confirmButton)
    await waitFor(() => {
      expect(screen.getByDisplayValue('Persist Task')).toBeTruthy()
    })
  })
})

describe('AutomationForm no duplicate save', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('disables submit button while submitting to prevent duplicate save', async () => {
    const { promise, resolve } = Promise.withResolvers<{ requestId: string; confirmationId: string | null; summary: string; requiresConfirmation: boolean }>()
    const prepareCreate = vi.fn(() => promise)
    const props = makeFormProps({ prepareCreate })
    render(<AutomationForm {...props} />)

    const nameInput = screen.getByPlaceholderText('e.g., Daily news summary')
    fireEvent.change(nameInput, { target: { value: 'Task' } })
    const instructionInput = screen.getByPlaceholderText('Describe what this task should do…')
    fireEvent.change(instructionInput, { target: { value: 'Task instruction' } })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Task')).toBeTruthy()
      expect(screen.getByDisplayValue('Task instruction')).toBeTruthy()
    })

    const submitButton = screen.getByRole('button', { name: 'Create Task' })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Saving…')).toBeTruthy()
    })

    expect(prepareCreate).toHaveBeenCalledTimes(1)

    resolve({ requestId: 'req-1', confirmationId: null, summary: 'summary', requiresConfirmation: false })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy()
    })
  })
})
