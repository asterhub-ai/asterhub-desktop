import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import AccountSub2apiService, { MODEL_KEY_REF } from '../src/index.ts'

const roots: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('stores the account model key only in the Host record and clears it on logout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-account-record-'))
  roots.push(root)
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/v1/auth/login') {
      response.end(JSON.stringify({ code: 0, data: { access_token: 'account-token', user: { id: 7, email: 'user@example.com' } } }))
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

  vi.stubEnv(MODEL_KEY_REF, 'process-environment-key-must-not-become-the-model-key')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
  await ctx.plugin(AccountSub2apiService, { authBaseUrl: `http://127.0.0.1:${address.port}/api/v1`, groupId: 6 })

  const status = await ctx.accountSub2api.login({ email: 'user@example.com', password: 'test-password', rememberUsername: false, autoLogin: false })
  expect(status.loggedIn).toBe(true)
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key')))
    .toEqual({ kind: 'api-key', key: 'account-model-key' })
  expect(await ctx.credentials.resolve(credentialRef(MODEL_KEY_REF))).toMatchObject({
    value: 'process-environment-key-must-not-become-the-model-key', source: 'env',
  })

  await ctx.accountSub2api.logout()
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key'))).toBeUndefined()
})
