import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import AccountSub2apiService from '../src/index.ts'

const roots: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Control plane that signs one account in and reports one reusable group key and a zero balance. */
async function startAccountService(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-account-source-'))
  roots.push(root)
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/v1/auth/login') {
      response.end(JSON.stringify({ code: 0, data: { access_token: 'account-token', user: { id: 26, email: 'user@example.com' } } }))
    } else if (request.url?.startsWith('/api/v1/keys?')) {
      response.end(JSON.stringify({ code: 0, data: { items: [{ id: 3, key: 'account-model-key', group_id: 6 }], pages: 1 } }))
    } else if (request.url === '/api/v1/user/profile') {
      response.end(JSON.stringify({ code: 0, data: { balance: 0 } }))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock Sub2API server did not bind')

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
  await ctx.plugin(AccountSub2apiService, { authBaseUrl: `http://127.0.0.1:${address.port}/api/v1`, groupId: 6 })
  return ctx
}

it('completes sign-in when the launching environment supplies the account preferences read-only and reports them as environment-sourced', async () => {
  vi.stubEnv('ASTERHUB_ACCOUNT_USERNAME', 'env-user@example.com')
  vi.stubEnv('ASTERHUB_ACCOUNT_AUTO_LOGIN_PASSWORD', 'env-password-sentinel')
  vi.stubEnv('ASTERHUB_ACCOUNT_AUTO_LOGIN', 'true')
  vi.stubEnv('SUB2API_API_KEY', 'environment-model-key-sentinel')
  const ctx = await startAccountService()

  const status = await ctx.accountSub2api.login({
    email: 'typed-user@example.com', password: 'typed-password-sentinel', rememberUsername: true, autoLogin: true,
  })
  expect(status.loggedIn).toBe(true)
  expect(status.keyBound).toBe(true)
  expect(status.credentialsFromEnv).toBe(true)
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key')))
    .toEqual({ kind: 'api-key', key: 'account-model-key' })
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'account-model-keys')))
    .toEqual({ kind: 'api-key', key: JSON.stringify({ '26': 'account-model-key' }) })
  // Writable references still persisted the new session.
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_TOKEN')))
    .toEqual({ value: 'account-token', source: 'file' })
  expect((await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_USER')))?.source).toBe('file')
  // Read-only references kept their environment values; typed and model-key secrets did not enter the file.
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_USERNAME')))
    .toEqual({ value: 'env-user@example.com', source: 'env' })
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_AUTO_LOGIN_PASSWORD')))
    .toEqual({ value: 'env-password-sentinel', source: 'env' })
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_AUTO_LOGIN')))
    .toEqual({ value: 'true', source: 'env' })
  const root = roots[0]
  if (root === undefined) throw new Error('test credentials root was not captured')
  const persisted = await readFile(join(root, '.credentials.yaml'), 'utf8')
  expect(persisted).not.toContain('typed-password-sentinel')
  expect(persisted).not.toContain('env-password-sentinel')
  expect(persisted).not.toContain('typed-user@example.com')
  expect(persisted).not.toContain('environment-model-key-sentinel')
  await ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(ctx), 1)
  const restarted = new Context()
  contexts.push(restarted)
  const server = servers[0]
  if (server === undefined) throw new Error('mock Sub2API server stopped before restart')
  await restarted.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock Sub2API server stopped before restart')
  await restarted.plugin(AccountSub2apiService, {
    authBaseUrl: `http://127.0.0.1:${address.port}/api/v1`, groupId: 6,
  })
  const restartedStatus = await restarted.accountSub2api.getStatus()
  expect(restartedStatus.loggedIn).toBe(true)
  expect(restartedStatus.keyBound).toBe(true)
  expect(restartedStatus.credentialsFromEnv).toBe(true)
  expect(await restarted.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key')))
    .toEqual({ kind: 'api-key', key: 'account-model-key' })
}, 20000)

it('still persists account credentials to the writable store when no environment layer supplies them', async () => {
  const ctx = await startAccountService()

  const status = await ctx.accountSub2api.login({
    email: 'user@example.com', password: 'typed-password-sentinel', rememberUsername: true, autoLogin: true,
  })
  expect(status.loggedIn).toBe(true)
  expect(status.user).toEqual({ id: '26', email: 'user@example.com' })
  expect(status.credentialsFromEnv).toBeUndefined()
  expect(status.rememberedUsername).toBe('user@example.com')
  expect(status.autoLogin).toBe(true)
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_TOKEN')))
    .toEqual({ value: 'account-token', source: 'file' })
  expect((await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_USER')))?.source).toBe('file')
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_USERNAME')))
    .toEqual({ value: 'user@example.com', source: 'file' })
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_AUTO_LOGIN_PASSWORD')))
    .toEqual({ value: 'typed-password-sentinel', source: 'file' })
  expect(await ctx.credentials.resolve(credentialRef('ASTERHUB_ACCOUNT_AUTO_LOGIN')))
    .toEqual({ value: 'true', source: 'file' })
}, 20000)
