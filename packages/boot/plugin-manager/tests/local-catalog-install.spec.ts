import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import Hmr from '@deepseek-ai/dsh-hmr'
import { execa } from 'execa'
import { expect, it, onTestFinished } from 'vitest'
import { boot, initProfile, readProfileManifest, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import PluginManager from '../src/index.ts'

const testCert = process.env.ASTERHUB_LOCAL_CATALOG_CERT
const testKey = process.env.ASTERHUB_LOCAL_CATALOG_KEY
if (!testCert || !testKey || !process.env.NODE_EXTRA_CA_CERTS) {
  throw new Error('Run with tests/run-local-catalog-proof.mjs; its isolated OpenSSL CA and NODE_EXTRA_CA_CERTS are required')
}

it('installs a valid local signed artifact with real pnpm and rejects tampering/failure without profile mutation', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'asterhub-local-catalog-'))
  const home = await realpath(temp)
  let owner: Context | undefined
  let failArtifact = false
  let badSignature = false
  let tarball = Buffer.alloc(0)
  let integrity = ''
  let artifactUrl = ''
  let artifactPath = '/releases/curated-probe-1.0.0.tgz'
  const keys = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const isCandidateMode = typeof process.env.ASTERHUB_TEST_CANDIDATE_TARBALL === 'string' && process.env.ASTERHUB_TEST_CANDIDATE_TARBALL.trim().length > 0
  const candidatePath = isCandidateMode ? process.env.ASTERHUB_TEST_CANDIDATE_TARBALL!.trim() : ''
  if (isCandidateMode && !existsSync(candidatePath)) {
    throw new Error(`Declared candidate artifact does not exist: ${candidatePath}. Refusing fallback fake pass in candidate-artifact mode.`)
  }
  const bundle = isCandidateMode
    ? (process.env.ASTERHUB_TEST_CANDIDATE_PACKAGE ?? '@asterhub/office-tools')
    : '@test/curated-probe'
  const pluginId = isCandidateMode ? (process.env.ASTERHUB_TEST_CANDIDATE_ID ?? 'office-tools') : 'curated-probe'
  const version = isCandidateMode ? (process.env.ASTERHUB_TEST_CANDIDATE_VERSION ?? '0.11.0') : '1.0.0'
  const issuedAt = new Date(Date.now() - 60_000).toISOString()
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
  const server = createServer({ key: readFileSync(testKey), cert: readFileSync(testCert) }, (request, response) => {
    if (request.url === '/api/v1/catalog.json') {
      const payload = Buffer.from(JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        issuedAt,
        expiresAt,
        plugins: [{ id: pluginId, name: 'Curated probe', description: 'Local deterministic proof package', package: bundle,
          version, integrity, artifactUrl },
        ],
      }))
      const signature = sign(null, payload, keys.privateKey)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ payload: payload.toString('base64'), signature: (badSignature ? Buffer.alloc(signature.length) : signature).toString('base64') }))
      return
    }
    if (request.url === artifactPath) {
      // Avoid spending pnpm's 10-second/one-minute retry backoff on this deliberate failure case.
      response.writeHead(failArtifact ? 404 : 200, { 'content-type': 'application/octet-stream' })
      response.end(failArtifact ? 'temporary fixture failure' : tarball)
      return
    }
    response.writeHead(404).end()
  })
  onTestFinished(async () => {
    await owner?.fiber.dispose()
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
    rmSync(temp, { recursive: true, force: true })
  })
  const pnpmProcess = process.platform === 'win32'
    ? join(process.cwd(), 'node_modules', '.bin', 'pnpm.CMD')
    : join(process.cwd(), 'node_modules', '.bin', 'pnpm')
  if (isCandidateMode) {
    tarball = readFileSync(candidatePath)
    integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
    artifactPath = `/releases/${join(candidatePath).split(/[\\/]/).pop()!}`
  } else {
    const packageDir = join(home, 'package')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: bundle, version: '1.0.0', type: 'module',
      dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(packageDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'curatedProbe', name: './plugin.mjs' }] }]))
    writeFileSync(join(packageDir, 'plugin.mjs'), 'export function apply(ctx) { ctx.provide("localCatalogProbe", "installed") }\n')
    const packed = await execa(pnpmProcess, ['pack', '--pack-destination', home], { cwd: packageDir, reject: false })
    if (packed.exitCode !== 0) throw new Error(`actual pnpm pack prerequisite failed (${packed.exitCode}): ${packed.stderr}`)
    const archive = join(home, 'test-curated-probe-1.0.0.tgz')
    if (!existsSync(archive)) throw new Error(`pnpm pack did not produce expected artifact: ${packed.stdout}`)
    tarball = readFileSync(archive)
    integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  }
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('local HTTPS server did not bind a TCP port')
  artifactUrl = `https://127.0.0.1:${address.port}${artifactPath}`
  const catalogUrl = `https://127.0.0.1:${address.port}/api/v1/catalog.json`
  const dir = join(home, 'profiles', 'test')
  const anchor = join(home, 'install-anchor.json')
  writeFileSync(anchor, '{"name":"installation","dependencies":{}}\n')
  initProfile(dir, ['core'])
  const core = join(dir, 'node_modules', 'core')
  mkdirSync(core, { recursive: true })
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: 'core', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(core, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'manager', name: 'cordis:manager', config: { curatedCatalogUrl: catalogUrl } }] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', packageManager: { command: pnpmProcess, args: [], env: { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS! } },
    startedBundles: ['core'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor,
    cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (setupCtx) => {
    owner = setupCtx
    setupCtx.provide('appReady', { onReady: (listener) => { listener(); return () => {} } })
    setupCtx.provide('profileContext', profile)
    setupCtx.provide('applicationCatalogPublicKey', publicKey)
    setupCtx.loader.builtins.manager = PluginManager
  })
  const manager = ctx.get('pluginManager') as PluginManager
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await ctx.hmr.runExclusive(async () => {})
  const request = { id: pluginId, revision: 1, package: bundle, version, integrity, artifactUrl }
  const before = readFileSync(join(dir, 'package.json'), 'utf8')
  const installedModuleDir = join(dir, 'node_modules', ...bundle.split('/'))

  const staleApproval = await manager.installCuratedBundle({ ...request, revision: 999 })
  expect(staleApproval).toMatchObject({ application: 'failed', changed: false, error: { code: 'stale-approval' } })
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)

  badSignature = true
  await expect(manager.installCuratedBundle(request)).rejects.toThrow(/signature verification failed/)
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
  expect(existsSync(installedModuleDir)).toBe(false)
  badSignature = false

  failArtifact = true
  expect((await manager.installCuratedBundle(request)).application).toBe('failed')
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
  failArtifact = false

  const installed = await manager.installCuratedBundle(request)
  expect(installed).toMatchObject({ application: 'applied', changed: true, bundle, packageResult: { exitCode: 0 } })
  if (!isCandidateMode) expect(ctx.get('localCatalogProbe')).toBe('installed')
  expect(readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8')).toContain(artifactUrl)
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain(artifactUrl)
  expect(existsSync(join(installedModuleDir, 'package.json'))).toBe(true)

  expect(await manager.setBundleEnabled(bundle, false)).toMatchObject({ changed: true, application: 'applied' })
  expect((await manager.listBundles()).find(row => row.name === bundle)?.enabled).toBe(false)
  expect(await manager.removeBundle(bundle)).toMatchObject({ changed: true, application: 'applied', packageResult: { exitCode: 0 } })
  expect(readProfileManifest('test', dir).dependencies?.[bundle]).toBeUndefined()
  expect(existsSync(installedModuleDir)).toBe(false)
}, 180_000)
