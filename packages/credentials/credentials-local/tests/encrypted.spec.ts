import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef, type CredentialCipher } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

function cipher(): CredentialCipher {
  const key = randomBytes(32)
  return {
    async encrypt(text) {
      const iv = randomBytes(12)
      const encryptor = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([encryptor.update(text, 'utf8'), encryptor.final()])
      return Buffer.concat([iv, encryptor.getAuthTag(), bytes]).toString('base64')
    },
    async decrypt(text) {
      const bytes = Buffer.from(text, 'base64')
      const decryptor = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decryptor.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decryptor.update(bytes.subarray(28)), decryptor.final()]).toString('utf8')
    },
  }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'asterhub-encrypted-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, '.credentials.yaml')
  const encryption = cipher()
  const boot = async (service: CredentialCipher = encryption) => {
    const ctx = new Context()
    ctx.provide('credentialCipher', service)
    const fiber = ctx.plugin(LocalCredentialProvider, { path, encrypted: true, watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    return ctx
  }
  return { path, boot, encryption }
}

it('persists ciphertext and reads references after restart', async () => {
  const { path, boot } = await setup()
  const ref = credentialRef('ASTERHUB_ENCRYPTED_TEST')
  const ctx = await boot()
  await ctx.credentials.set(ref, 'private-test-value')
  const stored = await readFile(path, 'utf8')
  expect(stored).toMatch(/^asterhub-credentials:v1:/)
  expect(stored).not.toContain('private-test-value')
  const restarted = await boot()
  expect(await restarted.credentials.resolve(ref)).toEqual({ value: 'private-test-value', source: 'file' })
  await restarted.credentials.unset(ref)
  expect(await restarted.credentials.resolve(ref)).toBeUndefined()
})

it('refuses plaintext without rewriting it', async () => {
  const { path, boot } = await setup()
  const text = 'version: 1\nrefs:\n  TEST_KEY: secret\n'
  await writeFile(path, text, { mode: 0o600 })
  await expect(boot()).rejects.toThrow('not encrypted')
  expect(await readFile(path, 'utf8')).toBe(text)
})

it('does not publish a document when encryption fails', async () => {
  const { path, boot, encryption } = await setup()
  const ctx = await boot({ ...encryption, async encrypt() { throw new Error('cipher unavailable') } })
  await expect(ctx.credentials.set(credentialRef('ASTERHUB_ENCRYPTED_TEST'), 'secret')).rejects.toThrow('cipher unavailable')
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('refuses corrupted ciphertext at boot without rewriting or disclosing its contents', async () => {
  const { path, boot, encryption } = await setup()
  const ciphertext = await encryption.encrypt('version: 1\nrefs:\n  TEST_KEY: private-test-value\n')
  const damaged = `${ciphertext.slice(0, -2)}${ciphertext.endsWith('A') ? 'B' : 'A'}=`
  const stored = `asterhub-credentials:v1:${damaged}`
  await writeFile(path, stored, { mode: 0o600 })

  await expect(boot()).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe(stored)
  expect(stored).not.toContain('private-test-value')
})

it('refuses encrypted storage when the host has not provided a cipher', async () => {
  const { path } = await setup()
  const ctx = new Context()
  await expect(ctx.plugin(LocalCredentialProvider, { path, encrypted: true, watch: false }))
    .rejects.toThrow('encrypted storage requires the credentialCipher service')
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})
