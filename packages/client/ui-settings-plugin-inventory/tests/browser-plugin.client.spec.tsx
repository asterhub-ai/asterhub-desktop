// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { CuratedPluginSettingsTab, type CuratedPluginSettingsTabInjected } from '../src/client/CuratedPluginSettingsTab.tsx'
import { en } from '../src/client/locales.ts'

type CatalogInjection = {
  catalog: CuratedPluginSettingsTabInjected['catalog']
  install: CuratedPluginSettingsTabInjected['install']
}

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const CATALOG = {
  revision: 3,
  generatedAt: '2026-10-01T00:00:00Z',
  plugins: [
    {
      id: 'server-office',
      name: 'Server Office',
      description: 'Office package from the signed server catalogue',
      package: '@asterhub/office',
      version: '1.0.0',
      integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      artifactUrl: 'https://asterhub.xapi.fans/releases/office-1.0.0.tgz',
    },
    {
      id: 'server-pdf',
      name: 'Server PDF',
      description: 'PDF processing from the server',
      package: '@asterhub/pdf',
      version: '2.0.0',
      integrity: 'sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      artifactUrl: 'https://asterhub.xapi.fans/releases/pdf-2.0.0.tgz',
    },
  ],
}

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.pluginManager', {
    curatedCatalog: async () => ({ ok: true, value: CATALOG }),
    installCuratedBundle: async () => ({ ok: true, value: { changed: false, application: 'applied', stage: 'install', target: '@asterhub/office' } }),
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('renders catalog entries from the verified server', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject, apply }).await()
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    const injected = entry.inject!() as CatalogInjection
    const Component = entry.component as typeof CuratedPluginSettingsTab
    render(<Component {...injected} t={key => en[key as keyof typeof en]} />)
    expect(await screen.findByRole('heading', { name: 'Server Office' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Server PDF' })).toBeTruthy()
  })

  it('shows loading state while fetching catalog', async () => {
    const b = await bench()
    const { promise: catalogPromise, resolve: resolveCatalog } = Promise.withResolvers<unknown>()
    Object.assign(b.ctx.remote.pluginManager, {
      curatedCatalog: async () => catalogPromise as never,
    })
    declare(b.slots)
    await b.ctx.plugin({ inject, apply }).await()
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    const injected = entry.inject!() as CatalogInjection
    const Component = entry.component as typeof CuratedPluginSettingsTab
    render(<Component {...injected} t={key => en[key as keyof typeof en]} />)
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    resolveCatalog({ ok: true, value: CATALOG })
    await screen.findByRole('heading', { name: 'Server Office' })
  })

  it('shows error state when catalog fetch fails', async () => {
    const b = await bench()
    Object.assign(b.ctx.remote.pluginManager, {
      curatedCatalog: async () => ({ ok: false, error: { code: 'NETWORK_ERROR', message: 'unavailable' } }),
    })
    declare(b.slots)
    await b.ctx.plugin({ inject, apply }).await()
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    const injected = entry.inject!() as CatalogInjection
    const Component = entry.component as typeof CuratedPluginSettingsTab
    render(<Component {...injected} t={key => en[key as keyof typeof en]} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en.error)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('shows empty state when catalog has no plugins', async () => {
    const b = await bench()
    Object.assign(b.ctx.remote.pluginManager, {
      curatedCatalog: async () => ({ ok: true, value: { revision: 1, generatedAt: '2026-10-01T00:00:00Z', plugins: [] } }),
    })
    declare(b.slots)
    await b.ctx.plugin({ inject, apply }).await()
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    const injected = entry.inject!() as CatalogInjection
    const Component = entry.component as typeof CuratedPluginSettingsTab
    render(<Component {...injected} t={key => en[key as keyof typeof en]} />)
    expect(await screen.findByText('No curated plugins are available.')).toBeTruthy()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject, apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Curated plugins')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(CuratedPluginSettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
