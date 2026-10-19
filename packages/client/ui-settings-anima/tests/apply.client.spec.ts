/** The Anima section follows the Host-served namespace and its own slot. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'

function view(ns: string, revision = 0) { return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision } }

async function bench(served: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const modelCatalog: ModelCatalog = { default: { provider: '', model: '' }, routableProviders: [], groups: [], failures: [] }
  const catalog: Pick<ModelDirectoryResolver['catalog'], 'store' | 'load'> = {
    store: createSnapshotStore<ReturnType<ModelDirectoryResolver['catalog']['store']['getSnapshot']>>({ value: modelCatalog, status: 'ready', error: null }),
    load: async () => modelCatalog,
  }
  ctx.provide('modelDirectories', { catalog })
  const describeSettings = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) },
  }))
  const remote = new TestRemote(ctx, { settings: { describe: describeSettings } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, remote }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
}

describe('ui-settings-anima apply', () => {
  it('keeps the Host Loader entry inert and declares its services', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'configForms', 'modelDirectories'])
  })

  it('registers a localized dedicated settings section while anima is served', async () => {
    const { ctx, slots } = await bench(['anima'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const entry = slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'anima', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Anima')
    expect(entry.locale).toBe('settings.anima')
  })

  it('registers nothing when the namespace is absent and removes the section on teardown', async () => {
    const { ctx, slots } = await bench([])
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
