// @vitest-environment jsdom
import type { ChangeResult, CuratedPluginCatalog, CuratedPluginInstallRequest } from '@deepseek-ai/dsh-plugin-manager/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CuratedPluginSettingsTab } from '../src/client/CuratedPluginSettingsTab.tsx'
import type { CuratedPluginSettingsTabProps } from '../src/client/CuratedPluginSettingsTab.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: CuratedPluginSettingsTabProps['t'] = key => en[key as keyof typeof en] ?? key

const CATALOG: CuratedPluginCatalog = {
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
      category: 'productivity',
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

function props(
  catalog: CuratedPluginSettingsTabProps['catalog'],
  install: CuratedPluginSettingsTabProps['install'] = async () => ({ changed: true, application: 'applied', stage: 'install', target: '@asterhub/office' }),
): CuratedPluginSettingsTabProps {
  return { catalog, install, t }
}

describe('CuratedPluginSettingsTab', () => {
  it('renders visible catalog entries from the verified server', async () => {
    render(<CuratedPluginSettingsTab {...props(async () => CATALOG)} />)
    expect(await screen.findByRole('heading', { name: 'Server Office' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Server PDF' })).toBeTruthy()
    expect(screen.getByText('productivity')).toBeTruthy()
    expect(screen.getByText(/Version: 1.0.0/)).toBeTruthy()
    expect(screen.getByText(/Version: 2.0.0/)).toBeTruthy()
  })

  it('shows loading state before the catalog resolves', async () => {
    const { promise } = Promise.withResolvers<CuratedPluginCatalog>()
    render(<CuratedPluginSettingsTab {...props(async () => promise)} />)
    expect(screen.getByRole('status').textContent).toBe(en.loading)
  })

  it('shows empty state when the catalog has no plugins', async () => {
    render(<CuratedPluginSettingsTab {...props(async () => ({ revision: 1, generatedAt: '2026-10-01T00:00:00Z', plugins: [] }))} />)
    expect(await screen.findByText('No curated plugins are available.')).toBeTruthy()
  })

  it('shows error state and retry button when the catalog fetch fails', async () => {
    render(<CuratedPluginSettingsTab {...props(async () => { throw new Error('network') })} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en.error)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('retries the catalog fetch when retry is clicked', async () => {
    let calls = 0
    const catalog = async (): Promise<CuratedPluginCatalog> => {
      calls += 1
      if (calls === 1) throw new Error('network')
      return CATALOG
    }
    render(<CuratedPluginSettingsTab {...props(catalog)} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Server Office' })).toBeTruthy()
  })

  it('installs an entry and shows success feedback', async () => {
    const install = vi.fn(async (_request: CuratedPluginInstallRequest): Promise<ChangeResult> =>
      ({ changed: true, application: 'applied', stage: 'install', target: '@asterhub/office' }))
    render(<CuratedPluginSettingsTab {...props(async () => CATALOG, install)} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0]!)
    await waitFor(() => { expect(install).toHaveBeenCalledOnce() })
    expect(install).toHaveBeenCalledWith(expect.objectContaining({
      id: 'server-office',
      revision: 3,
      package: '@asterhub/office',
      version: '1.0.0',
      integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      artifactUrl: 'https://asterhub.xapi.fans/releases/office-1.0.0.tgz',
    }))
    expect(await screen.findByText('Installed')).toBeTruthy()
  })

  it('shows installing state on the clicked entry while busy', async () => {
    const { promise, resolve } = Promise.withResolvers<ChangeResult>()
    render(<CuratedPluginSettingsTab {...props(async () => CATALOG, async () => promise)} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0]!)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Installing…' })).toBeTruthy() })
    resolve({ changed: true, application: 'applied', stage: 'install', target: '@asterhub/office' })
    await screen.findByText('Installed')
  })

  it('shows failure feedback when installation does not apply', async () => {
    render(<CuratedPluginSettingsTab {...props(async () => CATALOG, async () => ({ changed: false, application: 'failed', stage: 'install', target: '@asterhub/office' }))} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0]!)
    expect(await screen.findByText('Installation did not complete. Try again later.')).toBeTruthy()
  })

  it('shows failure feedback when installation throws', async () => {
    render(<CuratedPluginSettingsTab {...props(async () => CATALOG, async () => { throw new Error('install failed') })} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0]!)
    expect(await screen.findByText('Installation did not complete. Try again later.')).toBeTruthy()
  })

  it('shows stale-catalog feedback and refreshes when approval is stale', async () => {
    let catalogCalls = 0
    const catalog = async (): Promise<CuratedPluginCatalog> => {
      catalogCalls += 1
      return CATALOG
    }
    const install = vi.fn(async (): Promise<ChangeResult> => ({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: '@asterhub/office',
      error: { code: 'stale-approval' },
    }))
    render(<CuratedPluginSettingsTab {...props(catalog, install)} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0]!)
    expect(await screen.findByText('The curated list changed. Review it and try again.')).toBeTruthy()
    await waitFor(() => { expect(catalogCalls).toBeGreaterThanOrEqual(2) })
  })

  it('disables install button for already-installed entries', async () => {
    const installedCatalog: CuratedPluginCatalog = {
      ...CATALOG,
      plugins: [{ ...CATALOG.plugins[0]!, installed: true }, CATALOG.plugins[1]!],
    }
    render(<CuratedPluginSettingsTab {...props(async () => installedCatalog)} />)
    expect((await screen.findByRole('button', { name: 'Installed' })).hasAttribute('disabled')).toBe(true)
  })

  it('disables all install buttons while an install is in progress', async () => {
    const { promise } = Promise.withResolvers<ChangeResult>()
    render(<CuratedPluginSettingsTab {...props(async () => CATALOG, async () => promise)} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0]!)
    await waitFor(() => { expect(installButtons[1]!.hasAttribute('disabled')).toBe(true) })
  })
})
