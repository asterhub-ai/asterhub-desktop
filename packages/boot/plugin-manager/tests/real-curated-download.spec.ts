import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import { boot, initProfile, readProfileManifest, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import PluginManager from '../src/index.ts'
import { ASTERHUB_CATALOG_PUBLIC_KEY } from '../../../../apps/desktop-host/src/catalog-trust.ts'

describe('real curated plugin download and installation', () => {
  it('downloads, verifies integrity, unpacks, and enables GenOffice from live server', async () => {
    const temporaryHome = mkdtempSync(join(tmpdir(), 'asterhub-curated-download-'))
    let owner: Context | undefined
    onTestFinished(async () => {
      await owner?.fiber.dispose()
      rmSync(temporaryHome, { recursive: true, force: true })
    })

    const home = await realpath(temporaryHome)
    const dir = join(home, 'profiles', 'test')
    const anchor = join(home, 'package.json')
    writeFileSync(anchor, '{"name":"installation","dependencies":{}}\n')
    initProfile(dir, ['core'])

    const bundle = (name: string, rows: unknown[]) => {
      const path = join(dir, 'node_modules', name)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      writeFileSync(join(path, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]))
      writeFileSync(join(path, 'plugin.mjs'), 'export function apply(ctx) { ctx.provide("coreProbe", true) }\n')
    }
    bundle('core', [{ id: 'manager', name: 'cordis:manager' }])
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')

    const pnpmBin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm')

    const profile: ProfileContext = {
      name: 'test',
      packageManager: {
        command: pnpmBin,
        args: [],
        env: {},
      },
      startedBundles: ['core'],
      dir,
      patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: anchor,
      cwd: home,
      home,
      overlays: [],
      telemetryDisabledEnv: undefined,
    }

    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (setupCtx) => {
      owner = setupCtx
      setupCtx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      setupCtx.provide('profileContext', profile)
      setupCtx.provide('applicationCatalogPublicKey', ASTERHUB_CATALOG_PUBLIC_KEY)
      setupCtx.loader.builtins.manager = PluginManager
    })

    const manager = ctx.get('pluginManager') as PluginManager
    expect(manager).toBeDefined()

    // 1. Fetch real signed catalog from live HTTPS endpoint
    const catalog = await manager.curatedCatalog()
    expect(catalog.revision).toBeGreaterThanOrEqual(3)
    const genoffice = catalog.plugins.find(p => p.id === 'genoffice')
    expect(genoffice).toBeDefined()
    expect(genoffice!.package).toBe('@asterhub/genoffice-cli')
    expect(genoffice!.artifactUrl).toMatch(/^https:\/\/asterhub\.xapi\.fans\/releases\//)

    // 2. Perform live install: downloads real tarball, checks integrity and lockfile
    const installResult = await manager.installCuratedBundle({
      id: genoffice!.id,
      revision: catalog.revision,
      package: genoffice!.package,
      version: genoffice!.version,
      integrity: genoffice!.integrity,
      artifactUrl: genoffice!.artifactUrl,
    })
    expect(['applied', 'restart-required']).toContain(installResult.application)
    expect(installResult).toMatchObject({
      bundle: genoffice!.package,
      packageResult: { exitCode: 0 },
    })

    // 4. Also test Aster IM download and installation in the same real profile
    const asterIm = catalog.plugins.find(p => p.id === 'aster-im')
    expect(asterIm).toBeDefined()
    const imResult = await manager.installCuratedBundle({
      id: asterIm!.id,
      revision: catalog.revision,
      package: asterIm!.package,
      version: asterIm!.version,
      integrity: asterIm!.integrity,
      artifactUrl: asterIm!.artifactUrl,
    })
    if (imResult.application === 'failed') console.error('ASTER IM RESULT:', JSON.stringify(imResult, null, 2))
    expect(['applied', 'restart-required']).toContain(imResult.application)
    expect(imResult).toMatchObject({
      bundle: asterIm!.package,
      packageResult: { exitCode: 0 },
    })
    const manifestWithBoth = readProfileManifest('test', dir)
    expect(manifestWithBoth.dsh?.profile?.bundles).toContain(asterIm!.package)
    expect(manifestWithBoth.dependencies?.[asterIm!.package]).toBe(asterIm!.artifactUrl)
    expect(existsSync(join(dir, 'node_modules', '@asterhub', 'aster-im', 'package.json'))).toBe(true)

    // 3. Verify profile manifest and files on disk
    const manifest = readProfileManifest('test', dir)
    expect(manifest.dsh?.profile?.bundles).toContain(genoffice!.package)
    expect(manifest.dependencies?.[genoffice!.package]).toBe(genoffice!.artifactUrl)
    expect(existsSync(join(dir, 'node_modules', '@asterhub', 'genoffice-cli', 'package.json'))).toBe(true)
    expect(existsSync(join(dir, 'node_modules', '@asterhub', 'genoffice-cli', 'cordis.patch.yml'))).toBe(true)
  }, 180_000)
})
