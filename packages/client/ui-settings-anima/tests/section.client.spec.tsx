// @vitest-environment jsdom
/** User-visible personality settings and catalog-backed model selection. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AnimaSettingsSection, type AnimaSettingsSectionProps } from '../src/client/AnimaSettingsSection.tsx'
import type { AnimaFormState } from '../src/client/anima-settings-form.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
const field = (text: string, overridden = false): SettingsFieldState => ({ text, overridden, invalid: false })

// Global standard kit stubs: the section consumes none of these hooks.
const unusedHook = (() => { throw new Error('unused by the anima settings section') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook, useSessionRetainInfo: () => undefined,
  usePanelInfo: unusedHook, useResource: unusedHook, useWorkspaces: unusedHook,
  ...allowAllAccess,
}

function renderSection(locale: typeof en = en, overrides: Partial<AnimaFormState> = {}) {
  const state: AnimaFormState = {
    ...settled,
    fields: {
      nickname: field('小琦'), tone: field('balanced'), responseDetail: field('balanced'), initiative: field('balanced'),
      humor: field('light'), emotionalSupport: field('balanced'), familiarity: field('balanced'), jokeStyle: field('restrained'),
      reflectionEnabled: field('true'), modelProvider: field(''), model: field(''),
    },
    models: [{ id: '["p1","m1"]', label: 'Model One', provider: 'p1', model: 'm1' }],
    selectedModel: 'session', modelStatus: 'ready',
    ...overrides,
  }
  const store = createSnapshotStore(state)
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(), selectModel: vi.fn(), loadModels: vi.fn() }
  const messages: Readonly<Record<string, string>> = locale
  const t: PropsLocale<'settings.anima'>['t'] = key => messages[key] ?? key
  const props: AnimaSettingsSectionProps = {
    ...kit, ...actions, t, close: vi.fn(), useAnimaForm: bindSnapshotSelector(store),
  }
  render(<AnimaSettingsSection {...props} />)
  return actions
}

describe('AnimaSettingsSection', () => {
  it('renders localized personality fields, a catalog model selector, and only the reflection switch', () => {
    renderSection(zh)
    expect(screen.getByRole('heading', { name: zh.title })).toBeTruthy()
    for (const key of ['nickname', 'tone', 'responseDetail', 'initiative', 'humor', 'emotionalSupport', 'familiarity', 'jokeStyle'] as const) {
      expect(screen.getByLabelText(zh[key])).toBeTruthy()
    }
    expect(screen.getByRole('switch', { name: zh.reflectionEnabled })).toHaveProperty('checked', true)
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(screen.getByLabelText(zh.model)).toBeTruthy()
  })

  it('stages personality edits and reflection, then saves explicitly', () => {
    const actions = renderSection(en, { dirty: true })
    fireEvent.change(screen.getByLabelText(en.nickname), { target: { value: 'Nova' } })
    fireEvent.change(screen.getByLabelText(en.tone), { target: { value: 'warm' } })
    fireEvent.click(screen.getByRole('switch', { name: en.reflectionEnabled }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(actions.edit).toHaveBeenCalledWith('nickname', 'Nova')
    expect(actions.edit).toHaveBeenCalledWith('tone', 'warm')
    expect(actions.edit).toHaveBeenCalledWith('reflectionEnabled', 'false')
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('selects an advertised model or the Session route through the form action', () => {
    const actions = renderSection(en)
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: '["p1","m1"]' } })
    expect(actions.selectModel).toHaveBeenCalledWith('["p1","m1"]')
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: 'session' } })
    expect(actions.selectModel).toHaveBeenCalledWith('session')
  })

  it('disables controls for read-only and saving states', () => {
    renderSection(en, { writable: false })
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByLabelText(en.nickname)).toHaveProperty('disabled', true)
    cleanup()
    renderSection(en, { dirty: true, saving: true })
    expect(screen.getByRole('switch', { name: en.reflectionEnabled })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.model)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.discard })).toHaveProperty('disabled', true)
  })

  it('offers retry for a failed model catalog load', () => {
    const actions = renderSection(en, { modelStatus: 'error', models: [] })
    actions.loadModels.mockClear()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(actions.loadModels).toHaveBeenCalledOnce()
  })
})
