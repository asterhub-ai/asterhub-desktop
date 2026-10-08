// Keyless browser regression over the shipped AsterHub Settings composition.
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const catalogUrl = 'https://asterhub.xapi.fans/api/v1/catalog.json'
const expected = fileURLToPath(new URL('./expected/asterhub-settings/catalog.expected.md', import.meta.url))

describe('AsterHub Settings server catalogue', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let root: string
  let unavailable = false
  let fetcher: MockInstance<typeof globalThis.fetch>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'asterhub-settings-'))
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 1, revision: 1,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      plugins: [{
        id: 'server-office', name: 'Server Office', description: 'Office tools from the signed server catalogue',
        category: '办公', package: '@asterhub/server-office', version: '1.0.0',
        integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
        artifactUrl: 'https://asterhub.xapi.fans/releases/server-office-1.0.0.tgz',
      }],
    }))
    const envelope = JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64') })
    const originalFetch = globalThis.fetch
    fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== catalogUrl) return originalFetch(input, init)
      return Promise.resolve(new Response(unavailable ? 'temporarily unavailable' : envelope, {
        status: unavailable ? 503 : 200, headers: { 'content-type': 'application/json' },
      }))
    })
    const overlay = join(root, 'catalog.overlay.yml')
    // Account authentication is independently qualified; this case owns only Settings and the signed catalogue.
    await writeFile(overlay, `- id: plugin-manager\n  config:\n    curatedCatalogUrl: ${JSON.stringify(catalogUrl)}\n    curatedCatalogPublicKey: ${JSON.stringify(publicKey.export({ type: 'spki', format: 'pem' }))}\n- id: ui-settings-account\n  disabled: true\n`)
    scaffold = await launchWebScaffold({ developerTools: false,
      extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay] })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ locale: ZH_BROWSER_LOCALE, viewport: { width: 1280, height: 900 } })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    fetcher?.mockRestore()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('omits configuration access and displays only signed server entries', async () => {
    await openSettings(page, 'zh')
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    expect(await dialog.getByRole('button', { name: '打开配置文件' }).count()).toBe(0)
    await dialog.getByRole('button', { name: '精选插件', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Server Office', exact: true }).waitFor()
    expect(await dialog.locator('[data-plugin-entry]').count()).toBe(0)
    const section = dialog.getByRole('region', { name: 'AsterHub 精选插件', exact: true })
    await compareOrRefreshGolden(expected, await captureStableAria(page, '[aria-label="AsterHub 精选插件"]', scaffold.workspaceCwd), webSnapshotMode())
    expect(await section.getByRole('button', { name: '安装', exact: true }).isEnabled()).toBe(true)
  })

  it('reports a failed catalog read without a built-in fallback and recovers on retry', async () => {
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    unavailable = true
    await page.reload({ waitUntil: 'load' })
    await openSettings(page, 'zh')
    await dialog.getByRole('button', { name: '精选插件', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    expect(await dialog.locator('[data-plugin-entry]').count()).toBe(0)
    expect(await dialog.getByRole('heading', { name: 'Server Office', exact: true }).count()).toBe(0)
    unavailable = false
    await dialog.getByRole('button', { name: '重试', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Server Office', exact: true }).waitFor()
    expect(await dialog.getByRole('alert').count()).toBe(0)
  })
})
