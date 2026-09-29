import { generateKeyPairSync, sign } from 'node:crypto'
import { expect, it } from 'vitest'
import { isExactCuratedInstallation, resolveCuratedInstallRequest, verifyCuratedCatalogEnvelope } from '../src/index.ts'

const catalogUrl = 'https://asterhub.xapi.fans/api/v1/catalog.json'

function envelope(payload: object) {
  const bytes = Buffer.from(JSON.stringify(payload))
  const keys = generateKeyPairSync('ed25519')
  return {
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    envelope: { payload: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64') },
  }
}

const payload = {
  schemaVersion: 1,
  revision: 3,
  issuedAt: '2026-09-28T00:00:00.000Z',
  expiresAt: '2026-10-28T00:00:00.000Z',
  plugins: [{
    id: 'office-tools', name: 'Office tools', description: 'Read office documents.',
    package: '@asterhub/office-tools', version: '1.2.3', integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    artifactUrl: 'https://asterhub.xapi.fans/releases/office-tools-1.2.3.tgz',
    iconUrl: 'https://evil.example/icon.png',
  }],
}

it('verifies the raw signed payload and accepts only well-formed exact package identities', () => {
  const signed = envelope(payload)
  expect(verifyCuratedCatalogEnvelope(signed.envelope, signed.publicKey, catalogUrl, Date.parse('2026-10-01T00:00:00.000Z')))
    .toEqual({
      revision: 3,
      generatedAt: payload.issuedAt,
      plugins: [{
        id: 'office-tools', name: 'Office tools', description: 'Read office documents.',
        package: '@asterhub/office-tools', version: '1.2.3', integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        artifactUrl: 'https://asterhub.xapi.fans/releases/office-tools-1.2.3.tgz',
      }],
    })
})

it('rejects altered signatures, expired payloads, duplicate package identities and non-registry specs', () => {
  const signed = envelope(payload)
  expect(() => verifyCuratedCatalogEnvelope({ ...signed.envelope, signature: Buffer.alloc(64).toString('base64') }, signed.publicKey, catalogUrl, Date.parse('2026-10-01T00:00:00.000Z')))
    .toThrow(/signature verification/u)
  const expired = envelope({ ...payload, expiresAt: '2026-09-28T00:00:00.000Z' })
  expect(() => verifyCuratedCatalogEnvelope(expired.envelope, expired.publicKey, catalogUrl, Date.parse('2026-10-01T00:00:00.000Z')))
    .toThrow(/not currently valid/u)
  const duplicated = envelope({ ...payload, plugins: [payload.plugins[0], payload.plugins[0]] })
  expect(() => verifyCuratedCatalogEnvelope(duplicated.envelope, duplicated.publicKey, catalogUrl, Date.parse('2026-10-01T00:00:00.000Z')))
    .toThrow(/identity/u)
  const path = envelope({ ...payload, plugins: [{ ...payload.plugins[0], package: 'file:../../evil' }] })
  expect(() => verifyCuratedCatalogEnvelope(path.envelope, path.publicKey, catalogUrl, Date.parse('2026-10-01T00:00:00.000Z')))
    .toThrow(/identity/u)
})

it('rejects a page click after its displayed catalogue revision or signed package facts change', () => {
  const signed = envelope(payload)
  const catalog = verifyCuratedCatalogEnvelope(signed.envelope, signed.publicKey, catalogUrl, Date.parse('2026-10-01T00:00:00.000Z'))
  const request = { id: 'office-tools', revision: 3, package: '@asterhub/office-tools', version: '1.2.3', integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', artifactUrl: 'https://asterhub.xapi.fans/releases/office-tools-1.2.3.tgz' }
  expect(resolveCuratedInstallRequest(catalog, request)).toMatchObject({ package: request.package, version: request.version })
  expect(() => resolveCuratedInstallRequest(catalog, { ...request, revision: 2 })).toThrow(/stale-approval/u)
  expect(() => resolveCuratedInstallRequest(catalog, { ...request, version: '1.2.4' })).toThrow(/stale-approval/u)
})

it('requires a matching root importer resolution and integrity for curated installed state', () => {
  const entry = {
    id: 'office-tools', name: 'Office tools', description: 'Read office documents.',
    package: '@asterhub/office-tools', version: '1.2.3', integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    artifactUrl: 'https://asterhub.xapi.fans/releases/office-tools-1.2.3.tgz',
  }
  const lockfile = {
    importers: { '.': { dependencies: { [entry.package]: { specifier: entry.artifactUrl, version: '1.2.3(peer@4.0.0)' } } } },
    packages: { [`${entry.package}@${entry.artifactUrl}(peer@4.0.0)`]: { resolution: { integrity: entry.integrity, tarball: entry.artifactUrl } } },
  }
  const exactBundle = [{
    name: entry.package, version: entry.version, enabled: true, installed: true, optional: false, removable: true, rows: [], overrides: [],
  }]
  expect(isExactCuratedInstallation(entry, exactBundle, lockfile)).toBe(true)
  expect(isExactCuratedInstallation(entry, [{ ...exactBundle[0]!, version: '1.2.2' }], lockfile)).toBe(false)
  expect(isExactCuratedInstallation(entry, [], lockfile)).toBe(false)

  const transitiveOnly = {
    importers: { '.': { dependencies: { unrelated: { specifier: '1.0.0', version: '1.0.0' } } } },
    packages: { '@asterhub/office-tools@1.2.3': { resolution: { integrity: entry.integrity } } },
  }
  expect(isExactCuratedInstallation(entry, exactBundle, transitiveOnly)).toBe(false)
  expect(isExactCuratedInstallation(entry, exactBundle, { packages: transitiveOnly.packages })).toBe(false)

  const wrongSpecifier = {
    importers: { '.': { dependencies: { [entry.package]: { specifier: '^1.2.3', version: '1.2.3' } } } },
    packages: { '@asterhub/office-tools@1.2.3': { resolution: { integrity: entry.integrity } } },
  }
  expect(isExactCuratedInstallation(entry, exactBundle, wrongSpecifier)).toBe(false)

  const localDirectDependency = {
    importers: { '.': { dependencies: { [entry.package]: { specifier: entry.artifactUrl, version: 'link:../office-tools' } } } },
    packages: { '@asterhub/office-tools@1.2.3': { resolution: { integrity: entry.integrity } } },
  }
  expect(isExactCuratedInstallation(entry, exactBundle, localDirectDependency)).toBe(false)

  const wrongIntegrity = {
    ...lockfile,
    packages: { [`${entry.package}@${entry.artifactUrl}(peer@4.0.0)`]: { resolution: { integrity: 'sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=' } } },
  }
  expect(isExactCuratedInstallation(entry, exactBundle, wrongIntegrity)).toBe(false)
})
