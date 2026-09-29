import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createCatalogServer } from '../server.mjs'
import { validateCatalogPayload } from '../sign-catalog.mjs'

let directory
let server
let base
let symlinkSupported = false
let catalogPayload
let catalogSignature
let catalogPublicKey
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'asterhub-catalog-'))
  await mkdir(join(directory, 'desktop'), { recursive: true })
  await mkdir(join(directory, 'dsh-desk/feeds/win-x64'), { recursive: true })
  catalogPayload = Buffer.from('{"schemaVersion":1,"revision":3,"issuedAt":"2026-09-28T00:00:00.000Z","expiresAt":"2026-10-28T00:00:00.000Z","plugins":[]}')
  await writeFile(join(directory, 'catalog.json'), catalogPayload)
  await writeFile(join(directory, 'desktop/latest.json'), '{"version":null}')
  await writeFile(join(directory, 'dsh-desk/feeds/win-x64/nightly.yml'), 'version: 0.1.7\nfiles: []\n')
  const outside = join(directory, '..', 'asterhub-catalog-outside-secret.txt')
  await writeFile(outside, 'private')
  try {
    await symlink(outside, join(directory, 'catalog-link.json'))
    symlinkSupported = true
  }
  catch (error) {
    if (error?.code !== 'EPERM') throw error
  }
  const pair = generateKeyPairSync('ed25519')
  catalogPublicKey = pair.publicKey
  catalogSignature = sign(null, catalogPayload, pair.privateKey).toString('base64')
  server = createCatalogServer({ directory, signature: catalogSignature }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  server?.close()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
    await rm(join(directory, '..', 'asterhub-catalog-outside-secret.txt'), { force: true })
  }
})

test('serves versioned catalog metadata with public GET-only CORS and caching', async () => {
  const response = await fetch(`${base}/api/v1/catalog.json`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.match(response.headers.get('cache-control'), /max-age=60/)
  const envelope = await response.json()
  assert.deepEqual(envelope, { payload: catalogPayload.toString('base64'), signature: catalogSignature })
  assert.equal(verify(null, Buffer.from(envelope.payload, 'base64'), catalogPublicKey, Buffer.from(envelope.signature, 'base64')), true)
  assert.deepEqual(JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')),
    { schemaVersion: 1, revision: 3, issuedAt: '2026-09-28T00:00:00.000Z', expiresAt: '2026-10-28T00:00:00.000Z', plugins: [] })
})

test('fails closed when a catalog signing signature is not configured', async () => {
  const unsignedServer = createCatalogServer({ directory, signature: '' }).listen(0, '127.0.0.1')
  await new Promise(resolve => unsignedServer.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${unsignedServer.address().port}/api/v1/catalog.json`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'catalog_signature_unconfigured' })
  }
  finally {
    unsignedServer.close()
  }
})

test('loads the public catalog signature beside the exact payload file', async () => {
  await writeFile(join(directory, 'catalog.sig'), catalogSignature)
  const fileSignedServer = createCatalogServer({ directory }).listen(0, '127.0.0.1')
  await new Promise(resolve => fileSignedServer.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${fileSignedServer.address().port}/api/v1/catalog.json`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { payload: catalogPayload.toString('base64'), signature: catalogSignature })
  }
  finally {
    fileSignedServer.close()
  }
})

test('signer requires a safe increasing revision and an unexpired ISO validity window', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z')
  const validPayload = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    revision: 4,
    issuedAt: '2026-09-28T00:00:00.000Z',
    expiresAt: '2026-10-28T00:00:00.000Z',
    plugins: [],
  }))
  assert.equal(validateCatalogPayload(validPayload, 3, now).revision, 4)
  assert.throws(() => validateCatalogPayload(validPayload, 4, now), /increasing revision/)
  assert.throws(() => validateCatalogPayload(Buffer.from(JSON.stringify({
    schemaVersion: 1, revision: 5, issuedAt: '2026-09-28T00:00:00.000Z', expiresAt: '2026-09-28T11:00:00.000Z', plugins: [],
  })), 4, now), /unexpired/)
})

test('serves desktop update metadata and health, and does not fabricate a release', async () => {
  assert.equal((await (await fetch(`${base}/api/v1/desktop/latest.json`)).json()).version, null)
  assert.equal((await fetch(`${base}/healthz`)).status, 200)
})

test('serves the existing mandatory-update contract as safe no-force only', async () => {
  const response = await fetch(`${base}/api/v0/check_client_update?scenario=launch`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { code: 0, data: { biz_code: 0, biz_data: null } })
  const head = await fetch(`${base}/api/v0/check_client_update`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('serves operator-supplied electron-updater feeds from the dedicated feed root', async () => {
  const response = await fetch(`${base}/dsh-desk/feeds/win-x64/nightly.yml`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/yaml; charset=utf-8')
  assert.equal(await response.text(), 'version: 0.1.7\nfiles: []\n')
})

test('restricts the public route surface and prevents path traversal', async () => {
  assert.equal((await fetch(`${base}/secret`)).status, 404)
  assert.equal((await fetch(`${base}/releases/../../secret`)).status, 404)
  assert.equal((await fetch(`${base}/dsh-desk/feeds/win-x64/../../../../secret`)).status, 404)
  if (symlinkSupported) assert.equal((await fetch(`${base}/releases/catalog-link.json`)).status, 404)
  assert.equal((await fetch(base, { method: 'POST' })).status, 405)
  const head = await fetch(`${base}/api/v1/catalog.json`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})
