// @vitest-environment jsdom
/** The Subagent page as the Plugins page renders it: both sections on one page with one save. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SubagentCard, type SubagentCardProps } from '../src/client/SubagentCard.tsx'
import type { SubagentLimitsCardState } from '../src/client/subagent-limits-card-controller.ts'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentModelSelectionCardState } from '../src/client/subagent-model-selection-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

/** The Plugins page asks a configuration entry for its one-liner or its form; every page renders as `page` unless a test says otherwise. */
type ConfigView = 'summary' | 'page'

function renderSubagent(
  limitState: Partial<SubagentLimitsCardState> = {},
  modelState: Partial<SubagentModelSelectionCardState> = {},
  view: ConfigView = 'page',
) {
  const limits = createSnapshotStore<SubagentLimitsCardState>({
    ...settled,
    maxDepth: field('3'),
    maxActiveSubagents: field('8'),
    ...limitState,
  })
  const models = createSnapshotStore<SubagentModelSelectionCardState>({
    ...settled,
    enabled: false,
    candidates: [],
    catalogStatus: 'idle',
    catalogPartial: false,
    conflicted: false,
    ...modelState,
  })
  const actions = {
    editLimit: vi.fn(),
    resetLimit: vi.fn(),
    chooseDefaultModel: vi.fn(),
    toggleDelegation: vi.fn(),
    retryCatalog: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  }
  const props = {
    ...actions,
    view,
    t,
    useSubagentLimitsCard: bindSnapshotSelector(limits),
    useSubagentModelSelectionCard: bindSnapshotSelector(models),
  } as SubagentCardProps
  render(<SubagentCard {...props} />)
  return { actions, limits, models }
}

function renderSubagentModelSelection(state: Partial<SubagentModelSelectionCardState> = {}, view: ConfigView = 'page') {
  return renderSubagent({ available: false }, state, view).actions
}

describe('Subagent model selection fields', () => {
  it('offers catalog defaults independently from per-call selection and disables unavailable models', () => {
    const actions = renderSubagentModelSelection({
      defaultModelKey: '',
      delegateComplexTasks: true,
      candidates: [
        { key: 'account\0fast', provider: 'account', model: 'fast', providerName: 'Account', modelName: 'Fast', available: true, selected: false },
        { key: 'account\0old', provider: 'account', model: 'old', providerName: 'Account', modelName: 'Old', available: false, selected: false },
      ],
    })
    expect(screen.getByRole('radio', { name: /Fast/ })).toHaveProperty('checked', false)
    expect(screen.getByRole('radio', { name: /Old/ })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('radio', { name: /Fast/ }))
    expect(actions.chooseDefaultModel).toHaveBeenCalledWith('account\0fast')
    fireEvent.click(screen.getByRole('switch', { name: en.subagentDelegateComplex }))
    expect(actions.toggleDelegation).toHaveBeenCalledOnce()
  })

  it('does not render a per-task model override control', () => {
    renderSubagentModelSelection()
    expect(screen.queryByRole('switch', { name: en.subagentDelegateComplex })).toBeTruthy()
    expect(screen.getByRole('switch', { name: en.subagentDelegateComplex })).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows user-selected model names without exposing adapter route identifiers', () => {
    renderSubagentModelSelection({
      defaultModelKey: 'alpha\0fast',
      candidates: [{
        key: 'alpha\0fast', provider: 'alpha', model: 'gpt-6.1-sol', providerName: 'AsterHub',
        modelName: 'gpt-6.1-sol', available: true, selected: false,
      }],
      catalogStatus: 'ready',
    })

    expect(screen.queryByRole('switch', { name: en.subagentDelegateComplex })).toBeTruthy()
    expect(screen.getByRole('switch', { name: en.subagentDelegateComplex })).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('gpt-6.1-sol · AsterHub')).toBeTruthy()
    expect(screen.queryByText(/sub2api/i)).toBeNull()
    expect(screen.getByRole('radio', { name: /gpt-6.1-sol/ })).toHaveProperty('checked', true)
  })

  it('renders directory progress and failures for the selected default', () => {
    renderSubagentModelSelection({ candidates: [], catalogStatus: 'loading' })
    expect(screen.getByRole('button', { name: en.subagentDefaultLoadModels })).toHaveProperty('disabled', true)
    expect(screen.getAllByText(en.subagentModelSelectionLoading)).toHaveLength(1)

    cleanup()
    const errorActions = renderSubagentModelSelection({ catalogStatus: 'error' })
    fireEvent.click(screen.getByRole('button', { name: en.subagentDefaultLoadModels }))
    expect(errorActions.retryCatalog).toHaveBeenCalledOnce()
  })

  it('distinguishes a stale draft from a rejected save', () => {
    renderSubagentModelSelection({ dirty: true, conflicted: true })

    expect(screen.getByText(en.subagentModelSelectionConflict)).toBeTruthy()
    expect(screen.queryByText(en.saveFailed)).toBeNull()
  })

  it('renders its one-liner in the summary view and says so when unavailable', () => {
    renderSubagentModelSelection({}, 'summary')
    expect(document.body.textContent).toBe(en.subagentDescription)

    cleanup()
    renderSubagentModelSelection({ available: false })
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
  })
})

describe('SubagentCard', () => {
  it('discards both drafts when leaving the page', () => {
    const { actions } = renderSubagent({ dirty: true }, { dirty: true })
    cleanup()
    expect(actions.discard).toHaveBeenCalledOnce()
  })

  it('renders limits without model selection when only limits are served', () => {
    renderSubagent({}, { available: false })
    expect(screen.getByLabelText(en.subagentMaxDepth)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows both sections on one page with one save footer', () => {
    renderSubagent({ dirty: true })

    expect(screen.getByRole('heading', { name: en.subagentLimitsTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.subagentModelSelectionTitle })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.save })).toHaveLength(1)
  })

  it('reveals field rules on demand without changing staged values', () => {
    renderSubagent({ dirty: true, maxDepth: field('2') })
    const depthHelp = screen.getByRole('button', { name: en.subagentDepthHelpLabel })
    const capacityHelp = screen.getByRole('button', { name: en.subagentCapacityHelpLabel })
    expect(depthHelp.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(en.subagentDepthHelp)).toBeNull()
    expect(screen.queryByText(en.subagentCapacityHelp)).toBeNull()

    fireEvent.click(depthHelp)
    expect(depthHelp.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: en.subagentDepthHelpLabel })).toBeTruthy()
    expect(screen.getByText(en.subagentDepthHelp)).toBeTruthy()
    expect(screen.getByRole('table', { name: en.subagentDepthHelpLabel })).toBeTruthy()
    expect(screen.getByRole('row', { name: `0 ${en.subagentDepthZero}` })).toBeTruthy()
    expect(screen.getByRole('row', { name: `1 ${en.subagentDepthOne}` })).toBeTruthy()
    expect(screen.getByText(en.subagentDepthOverride)).toBeTruthy()
    fireEvent.click(capacityHelp)
    expect(screen.getByText(en.subagentCapacityHelp)).toBeTruthy()
    fireEvent.click(depthHelp)
    expect(screen.queryByText(en.subagentDepthHelp)).toBeNull()
    expect(screen.getByLabelText(en.subagentMaxDepth)).toHaveProperty('value', '2')
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
  })

  it('keeps validation visible when the rules are collapsed and links it to the input', () => {
    renderSubagent({ dirty: true, invalid: true, maxDepth: field('1.5', { invalid: true }) })
    const depth = screen.getByLabelText(en.subagentMaxDepth)
    const messageId = depth.getAttribute('aria-describedby')!
    expect(document.getElementById(messageId)?.textContent).toBe(en.subagentDepthInvalid)
    expect(screen.queryByRole('region', { name: en.subagentDepthHelpLabel })).toBeNull()
  })

  it('edits and resets limits through the shared card', () => {
    const { actions, limits } = renderSubagent({
      dirty: true,
      maxDepth: field('3', { overridden: true }),
      maxActiveSubagents: field('8', { overridden: true }),
    })
    fireEvent.change(screen.getByLabelText(en.subagentMaxDepth), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(en.subagentMaxActive), { target: { value: '12' } })
    expect(actions.editLimit.mock.calls).toEqual([['maxDepth', '2'], ['maxActiveSubagents', '12']])
    for (const button of screen.getAllByRole('button', { name: en.reset })) fireEvent.click(button)
    expect(actions.resetLimit.mock.calls).toEqual([['maxDepth'], ['maxActiveSubagents']])
    act(() => { limits.set({ ...limits.getSnapshot(), writable: false }) })
    expect(screen.getByLabelText(en.subagentMaxActive)).toHaveProperty('disabled', true)
  })

  it('blocks saving both sections when a model selection is invalid or conflicted', () => {
    const { models } = renderSubagent({ dirty: true }, { dirty: true, invalid: true })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    act(() => { models.set({ ...models.getSnapshot(), invalid: false, conflicted: true }) })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('locks both sections while either is saving and stays open after both settle', () => {
    const { limits, models } = renderSubagent({ dirty: true }, { dirty: true })
    act(() => {
      limits.set({ ...limits.getSnapshot(), saving: true })
      models.set({ ...models.getSnapshot(), saving: true })
    })
    expect(screen.getByLabelText(en.subagentMaxDepth)).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch', { name: en.subagentDelegateComplex })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    act(() => { limits.set({ ...limits.getSnapshot(), saving: false, dirty: false }) })
    expect(screen.getByRole('switch', { name: en.subagentDelegateComplex })).toHaveProperty('disabled', true)
    act(() => { models.set({ ...models.getSnapshot(), saving: false, dirty: false }) })
    expect(screen.getByRole('switch', { name: en.subagentDelegateComplex })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('keeps a rejected section open after the other section saves', () => {
    const { limits, models } = renderSubagent({ dirty: true }, { dirty: true })
    act(() => {
      limits.set({ ...limits.getSnapshot(), saving: true })
      models.set({ ...models.getSnapshot(), saving: true })
    })
    act(() => {
      limits.set({ ...limits.getSnapshot(), saving: false, dirty: false })
      models.set({ ...models.getSnapshot(), saving: false, failed: true })
    })
    expect(screen.getByRole('radio', { name: en.subagentDefaultInherit })).toBeTruthy()
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
  })

  it('renders model-only deployments without limit controls', () => {
    renderSubagent({ available: false })
    expect(screen.getByRole('radio', { name: en.subagentDefaultInherit })).toBeTruthy()
    expect(screen.queryByLabelText(en.subagentMaxDepth)).toBeNull()
  })
})
