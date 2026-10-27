import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import AccountSub2apiService from '../src/index.ts'

const roots: string[] = []
const servers: Server[] = []
const contexts: Context[] = []

async function createAccountService(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-account-failure-'))
  roots.push(root)
  const server = createServer(handler)
  const { promise, resolve, reject } = Promise.withResolvers<undefined>()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    resolve(undefined)
  })
  await promise
  servers.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock Sub2API server did not bind')

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
  await ctx.plugin(AccountSub2apiService, { authBaseUrl: `http://127.0.0.1:${address.port}/api/v1`, groupId: 6 })
  return ctx
}

async function rejectedLogin(ctx: Context): Promise<Error> {
  try {
    await ctx.accountSub2api.login({
      email: 'private-user@example.com', password: 'private-password-sentinel',
      rememberUsername: false, autoLogin: false,
    })
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error('login rejected with a non-Error value')
  }
  throw new Error('expected account login to fail')
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(body)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    const { promise, resolve } = Promise.withResolvers<undefined>()
    server.close(() => {
      resolve(undefined)
    })
    await promise
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

it('distinguishes an authentication-service timeout from a refused connection without exposing request secrets', async () => {
  const timeout = await createAccountService((_request, _response) => {
    // Let the service's existing request deadline expire; no external network is used.
  })
  const timeoutError = await rejectedLogin(timeout)
  expect(timeoutError.message).toBe('连接认证服务超时，请检查网络后重试')
  expect(timeoutError.message).not.toContain('private-password-sentinel')

  const refused = await createAccountService((request, response) => {
    if (request.url === '/api/v1/auth/login') request.socket.destroy()
    else respond(response, 404, '{}')
  })
  const connectionError = await rejectedLogin(refused)
  expect(connectionError.message).toBe('无法连接认证服务，请检查网络后重试')
  expect(connectionError.message).not.toContain('private-password-sentinel')
  expect(connectionError.message).not.toBe(timeoutError.message)
}, 20000)

it('keeps upstream authentication, permission, service, and malformed-response failures distinct and secret-free', async () => {
  const scenarios = [
    {
      name: 'invalid credentials', status: 401,
      body: JSON.stringify({ error_code: 'invalid_credentials', message: 'private-password-sentinel' }),
      expected: '邮箱或密码不正确',
    },
    {
      name: 'permission denied', status: 403,
      body: JSON.stringify({ error_code: 'permission_denied', message: 'private-token-sentinel' }),
      expected: '当前账户尚未开通工作台使用权限，请联系支持处理',
    },
    {
      name: 'upstream failure', status: 502,
      body: JSON.stringify({ message: 'private-token-sentinel private-password-sentinel' }),
      expected: '认证服务暂不可用，请稍后重试',
    },
    {
      name: 'invalid response', status: 200,
      body: JSON.stringify({ code: 0, data: { access_token: 'private-token-sentinel', user: null } }),
      expected: '认证服务返回了无法识别的响应',
    },
  ]
  const errors: string[] = []
  for (const scenario of scenarios) {
    const ctx = await createAccountService((request, response) => {
      if (request.url === '/api/v1/auth/login') respond(response, scenario.status, scenario.body)
      else respond(response, 404, '{}')
    })
    const error = await rejectedLogin(ctx)
    errors.push(error.message)
    expect(error.message).toBe(scenario.expected)
    expect(error.message).not.toContain('private-password-sentinel')
    expect(error.message).not.toContain('private-token-sentinel')
  }
  expect(new Set(errors).size).toBe(scenarios.length)
})

it('reports local credential persistence failure separately and never returns the provider error', async () => {
  const ctx = await createAccountService((request, response) => {
    if (request.url === '/api/v1/auth/login') {
      respond(response, 200, JSON.stringify({
        code: 0, data: { access_token: 'private-token-sentinel', user: { id: 8, email: 'private-user@example.com' } },
      }))
    } else if (request.url?.startsWith('/api/v1/keys?')) {
      respond(response, 200, JSON.stringify({ code: 0, data: { items: [{ id: 4, key: 'private-model-key-sentinel', group_id: 6 }], pages: 1 } }))
    } else {
      respond(response, 404, '{}')
    }
  })
  vi.spyOn(ctx.credentials, 'set').mockRejectedValueOnce(new Error('private-password-sentinel private-token-sentinel'))

  const error = await rejectedLogin(ctx)
  expect(error.message).toBe('无法安全保存账户凭据，请重试')
  expect(error.message).not.toContain('private-password-sentinel')
  expect(error.message).not.toContain('private-token-sentinel')
  expect(error.message).not.toContain('private-model-key-sentinel')
})
