/** Personality edits are staged; model routes come only from the shared catalog. */

import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { AnimaSettingsForm, type AnimaSettings } from '../src/client/anima-settings-form.ts'

function setup(overrides: Partial<AnimaSettings> = {}, catalogStatus: 'ready' | 'error' = 'ready') {
  const value: AnimaSettings = {
    nickname: 'Anima', tone: 'balanced', responseDetail: 'balanced', initiative: 'balanced',
    humor: 'light', emotionalSupport: 'balanced', familiarity: 'balanced', jokeStyle: 'restrained',
    reflectionEnabled: true, modelProvider: '', model: '', ...overrides,
  }
  const snapshot = { status: 'ready' as const, value, base: { ...value }, user: { ...overrides }, writable: true, revision: 1 }
  const mutate = vi.fn(async (_ops: readonly { op: string; path: readonly string[]; value?: unknown }[]) => true)
  const scope: SettingsFormScope<AnimaSettings> = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate }
  const modelCatalog: ModelCatalog = { default: { provider: 'p1', model: 'm1' }, routableProviders: ['p1'],
    groups: [{ id: 'p1', name: 'Provider', models: [{ id: 'm1', name: 'Model One' }] }], failures: [] }
  const store = createSnapshotStore<ReturnType<ModelDirectoryResolver['catalog']['store']['getSnapshot']>>({ value: modelCatalog,
    status: catalogStatus, error: catalogStatus === 'error' ? 'offline' : null })
  const load = vi.fn(async () => modelCatalog)
  const catalog: Pick<ModelDirectoryResolver['catalog'], 'store' | 'load'> = { store, load }
  const form = new AnimaSettingsForm(scope, catalog)
  return { form, face: form.inject(), mutate, load }
}

describe('AnimaSettingsForm', () => {
  it('stages personality edits, saves them, and can discard staged edits', async () => {
    const { form, face, mutate } = setup()
    face.edit('nickname', 'Nova')
    face.edit('tone', 'warm')
    face.edit('humor', 'playful')
    expect(face.hooks.animaForm.getSnapshot().dirty).toBe(true)
    face.discard()
    expect(face.hooks.animaForm.getSnapshot().fields.nickname.text).toBe('Anima')
    face.edit('nickname', 'Nova')
    face.save()
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toContainEqual({ op: 'set', path: ['nickname'], value: 'Nova' })
    form.dispose()
  })

  it('selects an advertised catalog model and saves its exact provider/model pair', async () => {
    const { form, face, mutate } = setup()
    const state = face.hooks.animaForm.getSnapshot()
    expect(state.models).toEqual([{ id: '["p1","m1"]', label: 'Model One', provider: 'p1', model: 'm1' }])
    face.selectModel(state.models[0]!.id)
    face.save()
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toContainEqual({ op: 'set', path: ['modelProvider'], value: 'p1' })
    expect(mutate.mock.calls[0]?.[0]).toContainEqual({ op: 'set', path: ['model'], value: 'm1' })
    form.dispose()
  })

  it('follows the Session route and keeps provider/model out of typed edits', async () => {
    const { form, face, mutate } = setup({ modelProvider: 'p1', model: 'm1' })
    face.edit('modelProvider', 'attacker')
    face.edit('model', 'typed')
    expect(face.hooks.animaForm.getSnapshot().fields.modelProvider.text).toBe('p1')
    face.selectModel('session')
    face.save()
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toEqual([{ op: 'unset', path: ['modelProvider'] }, { op: 'unset', path: ['model'] }])
    form.dispose()
  })

  it('rejects unavailable models and invalid nicknames without writing', () => {
    const unavailable = setup({ modelProvider: 'missing', model: 'model' })
    expect(unavailable.face.hooks.animaForm.getSnapshot().invalid).toBe(true)
    unavailable.face.save()
    expect(unavailable.mutate).not.toHaveBeenCalled()
    unavailable.form.dispose()

    const invalidNickname = setup()
    invalidNickname.face.edit('nickname', '   ')
    expect(invalidNickname.face.hooks.animaForm.getSnapshot().invalid).toBe(true)
    invalidNickname.face.save()
    expect(invalidNickname.mutate).not.toHaveBeenCalled()
    invalidNickname.form.dispose()
  })

  it('blocks an explicit model while its retained catalog is unavailable and exposes a retry', () => {
    const { form, face, mutate, load } = setup({ modelProvider: 'p1', model: 'm1' }, 'error')
    face.save()
    expect(face.hooks.animaForm.getSnapshot().modelStatus).toBe('error')
    expect(mutate).not.toHaveBeenCalled()
    face.loadModels()
    expect(load).toHaveBeenCalledOnce()
    form.dispose()
  })
})
