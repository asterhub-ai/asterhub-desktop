import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import AccountSub2apiService from '../src/index.ts'

const roots: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    const { promise, resolve, reject } = Promise.withResolvers<undefined>()
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve(undefined)
    })
    await promise
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('usage credits', () => {
  it('converts upstream actual cost and quota balance with unified x100 scaling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-usage-'))
    roots.push(root)
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'usage-token', user: { id: 'usage-user', email: 'usage@example.com' } },
        }))
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({ code: 0, data: { items: [{ id: 1, key: 'model-key', group_id: 6 }], pages: 1 } }))
      } else if (request.url === '/api/v1/user/profile') {
        response.end(JSON.stringify({ code: 0, data: { balance: 20 } }))
      } else if (request.url?.startsWith('/api/v1/usage/stats?') || request.url === '/api/v1/usage/dashboard/stats') {
        response.end(JSON.stringify({
          code: 0,
          data: { total_requests: 3, total_tokens: 1200, total_actual_cost: 2 },
        }))
      } else {
        response.statusCode = 404
        response.end(JSON.stringify({ code: 404, message: 'Not found' }))
      }
    })
    const { promise, resolve, reject } = Promise.withResolvers<{ url: string }>()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Mock server failed to bind'))
        return
      }
      resolve({ url: `http://127.0.0.1:${address.port}/api/v1` })
    })
    const { url } = await promise
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })
    await ctx.accountSub2api.login({
      email: 'usage@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false,
    })

    expect(await ctx.accountSub2api.quota()).toEqual({ balance: 2000 })
    expect(await ctx.accountSub2api.usage()).toEqual({
      cumulative: { requests: 3, tokens: 1200, credits: 200 },
      last7Days: { requests: 3, tokens: 1200, credits: 200 },
      today: { requests: 3, tokens: 1200, credits: 200 },
    })
  })
})
