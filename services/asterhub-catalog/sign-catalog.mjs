import { createPrivateKey, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function isoTimestamp(value) {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString() === value ? parsed : undefined
}

/** Validate a payload and require its revision to advance beyond the operator's prior revision. */
export function validateCatalogPayload(payload, previousRevision, now = Date.now()) {
  let value
  try { value = JSON.parse(payload.toString('utf8')) }
  catch { throw new Error('catalog signer requires valid UTF-8 JSON') }
  if (value?.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(previousRevision) || previousRevision < 0 || value.revision <= previousRevision
    || !Array.isArray(value.plugins)) {
    throw new Error('catalog signer requires schemaVersion 1, a safe increasing revision, and a plugins array')
  }
  const issuedAt = isoTimestamp(value.issuedAt)
  const expiresAt = isoTimestamp(value.expiresAt)
  if (issuedAt === undefined || expiresAt === undefined || expiresAt <= issuedAt
    || issuedAt > now || expiresAt <= now) {
    throw new Error('catalog signer requires valid ISO issuedAt/expiresAt, issuedAt no later than now, and an unexpired later expiresAt')
  }
  return value
}

async function main(args) {
  const [payloadArgument, privateKeyArgument, previousRevisionArgument] = args
  if (!payloadArgument || !privateKeyArgument || previousRevisionArgument === undefined) {
    process.stderr.write('Usage: node sign-catalog.mjs <payload.json> <external-ed25519-private-key.pem> <previous-revision>\n')
    process.exitCode = 2
    return
  }
  const previousRevision = Number(previousRevisionArgument)
  const payload = await readFile(resolve(payloadArgument))
  validateCatalogPayload(payload, previousRevision)
  const privateKey = createPrivateKey(await readFile(resolve(privateKeyArgument)))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('catalog signer requires an Ed25519 private key')
  const signature = sign(null, payload, privateKey).toString('base64')
  process.stdout.write(`${signature}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2))
}
