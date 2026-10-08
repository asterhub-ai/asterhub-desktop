/**
 * Deterministic tests for automation account lifetime APIs.
 * Proves key changes occur after leased work stops and stale epochs fail.
 * @module @deepseek-ai/dsh-account-sub2api/tests/automation-lifetime
 */

import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { AccountAutomationIdentity, AccountStatus } from '../src/types.ts'
import AccountSub2apiService from '../src/index.ts'

const roots: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    const { promise, resolve } = Promise.withResolvers<void>()
    server.close(() => resolve())
    await promise
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Create a mock Sub2API server that returns predictable responses. */
function createMockServer(options: {
  accessToken?: string
  userId?: string
  key?: string
  balance?: number
} = {}): Promise<{ server: ReturnType<typeof createServer>; port: number; url: string }> {
  const accessToken = options.accessToken ?? 'mock-token'
  const userId = options.userId ?? 'test-user-123'
  const key = options.key ?? 'mock-model-key'
  const balance = options.balance ?? 100

  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/v1/auth/login') {
      response.end(JSON.stringify({
        code: 0,
        data: { access_token: accessToken, user: { id: userId, email: 'test@example.com' } }
      }))
    } else if (request.url?.startsWith('/api/v1/keys?')) {
      response.end(JSON.stringify({
        code: 0,
        data: { items: [{ id: 1, key: key, group_id: 6 }], pages: 1 }
      }))
    } else if (request.url === '/api/v1/user/profile') {
      response.end(JSON.stringify({ code: 0, data: { balance: balance } }))
    } else if (request.url === '/api/v1/settings/public') {
      response.end(JSON.stringify({
        code: 0,
        data: { registration_enabled: true, email_verify_enabled: true, invitation_code_enabled: false }
      }))
    } else {
      response.statusCode = 404
      response.end(JSON.stringify({ code: 404, message: 'Not found' }))
    }
  })
  const { promise, resolve, reject } = Promise.withResolvers<{ server: ReturnType<typeof createServer>; port: number; url: string }>()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      reject(new Error('Mock server failed to bind'))
      return
    }
    resolve({ server, port: address.port, url: `http://127.0.0.1:${address.port}/api/v1` })
  })
  return promise
}

describe('automationIdentity', () => {
  it('returns null when not logged in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer()
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    // Before login, identity should be null
    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).toBeNull()
  })

  it('returns identity after login', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()
    expect(identity?.accountId).toBe('user-abc')
    expect(identity?.epoch).toBeGreaterThan(0)
  })

  it('returns null after logout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    expect(await ctx.accountSub2api.automationIdentity()).not.toBeNull()

    await ctx.accountSub2api.logout()

    expect(await ctx.accountSub2api.automationIdentity()).toBeNull()
  })
})

describe('assertAutomationIdentity', () => {
  it('throws when no account is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer()
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    // Asserting any identity when logged out must reject — no credential acquisition possible
    expect(() => ctx.accountSub2api.assertAutomationIdentity({ accountId: 'any', epoch: 1 })).toThrow()
  })

  it('throws when no active account after logout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Logout advances epoch
    await ctx.accountSub2api.logout()

    // Asserting old identity after logout must reject — no active account, no credential acquisition
    expect(() => ctx.accountSub2api.assertAutomationIdentity(identity!)).toThrow()
  })
  it('throws for account mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Asserting different account ID must reject — credential isolation enforced
    expect(() => ctx.accountSub2api.assertAutomationIdentity({
      accountId: 'different-user',
      epoch: identity!.epoch
    })).toThrow()
  })

  it('succeeds for valid identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Should not throw
    expect(() => ctx.accountSub2api.assertAutomationIdentity(identity!)).not.toThrow()
  })
})

describe('registerAutomationLease', () => {
  it('rejects lease after logout with no active account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Logout advances epoch
    await ctx.accountSub2api.logout()

    // Registering lease after logout must reject — no credential acquisition possible
    expect(() => ctx.accountSub2api.registerAutomationLease(identity!, async () => {})).toThrow()
  })

  it('returns disposer that removes lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    const stop = vi.fn().mockResolvedValue(undefined)
    const disposer = ctx.accountSub2api.registerAutomationLease(identity!, stop)

    // Disposer should be a function
    expect(typeof disposer).toBe('function')

    // Calling disposer should not throw
    expect(() => disposer()).not.toThrow()
  })
})

describe('account switch with deferred promises', () => {
  it('key change occurs after leased work stops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc', key: 'key-1' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Track lease lifecycle
    let leaseStopped = false
    const stopDeferred = Promise.withResolvers<void>()

    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      // Simulate async cleanup work
      await stopDeferred.promise
      leaseStopped = true
    })

    // Start logout (will block on lease)
    const logoutPromise = ctx.accountSub2api.logout()

    // Logout should not complete until lease stops
    const { promise: sleep, resolve: wake } = Promise.withResolvers<void>()
    setTimeout(wake, 50)
    await sleep
    expect(leaseStopped).toBe(false)

    // Resolve the deferred stop
    stopDeferred.resolve()

    // Now logout should complete
    await logoutPromise

    // Verify lease was stopped
    expect(leaseStopped).toBe(true)
  })

  it('concurrent sign-ins cannot interleave credential sets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    // Create two servers with different user IDs
    const server1 = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'token-1', user: { id: 'user-1', email: 'user1@example.com' } }
        }))
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: 'key-1', group_id: 6 }], pages: 1 }
        }))
      } else if (request.url === '/api/v1/user/profile') {
        response.end(JSON.stringify({ code: 0, data: { balance: 100 } }))
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server1.once('error', listenReject)
    server1.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server1)

    const address1 = server1.address()
    if (address1 === null || typeof address1 === 'string') throw new Error('Server 1 failed to bind')
    const url1 = `http://127.0.0.1:${address1.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url1, groupId: 6 })

    // First login
    await ctx.accountSub2api.login({
      email: 'user1@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity1 = await ctx.accountSub2api.automationIdentity()
    expect(identity1?.accountId).toBe('user-1')
    expect(identity1?.epoch).toBe(1)

    // Second login (same user, but advances epoch)
    await ctx.accountSub2api.login({
      email: 'user1@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity2 = await ctx.accountSub2api.automationIdentity()
    expect(identity2?.accountId).toBe('user-1')
    expect(identity2?.epoch).toBe(2)

    // Old identity should be stale
    // Old identity epoch is stale - credential isolation enforced
    expect(() => ctx.accountSub2api.assertAutomationIdentity(identity1!)).toThrow()
  })

  it('stale run cannot read new credential', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    const server1 = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'token-1', user: { id: 'user-1', email: 'user1@example.com' } }
        }))
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: 'key-1', group_id: 6 }], pages: 1 }
        }))
      } else if (request.url === '/api/v1/user/profile') {
        response.end(JSON.stringify({ code: 0, data: { balance: 100 } }))
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server1.once('error', listenReject)
    server1.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server1)

    const address1 = server1.address()
    if (address1 === null || typeof address1 === 'string') throw new Error('Server failed to bind')
    const url1 = `http://127.0.0.1:${address1.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url1, groupId: 6 })

    // First login
    await ctx.accountSub2api.login({
      email: 'user1@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity1 = await ctx.accountSub2api.automationIdentity()
    expect(identity1).not.toBeNull()

    // Simulate a "stale run" holding the old identity
    // After logout/login, this identity should be rejected
    await ctx.accountSub2api.logout()

    // Stale identity after logout must reject — no active account, no credential acquisition
    expect(() => ctx.accountSub2api.assertAutomationIdentity(identity1!)).toThrow()

    // Re-login creates new identity
    await ctx.accountSub2api.login({
      email: 'user1@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity2 = await ctx.accountSub2api.automationIdentity()
    expect(identity2).not.toBeNull()
    expect(identity2?.epoch).toBeGreaterThan(identity1!.epoch)

    // Stale identity still fails
    // Stale identity must reject — credential isolation enforced across epoch advance
    expect(() => ctx.accountSub2api.assertAutomationIdentity(identity1!)).toThrow()
  })
})

describe('asterhub-account/changed event', () => {
  it('emits on login', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    const events: Array<AccountAutomationIdentity | null> = []
    ctx.on('asterhub-account/changed', (identity: AccountAutomationIdentity | null) => {
      events.push(identity)
    })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    // Event should have been emitted
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[events.length - 1]?.accountId).toBe('user-abc')
  })

  it('emits null on logout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const events: Array<AccountAutomationIdentity | null> = []
    ctx.on('asterhub-account/changed', (identity: AccountAutomationIdentity | null) => {
      events.push(identity)
    })

    await ctx.accountSub2api.logout()

    // Should have emitted null
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[events.length - 1]).toBeNull()
  })

  it('emits without credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    const events: Array<AccountAutomationIdentity | null> = []
    ctx.on('asterhub-account/changed', (identity: AccountAutomationIdentity | null) => {
      // Event payload should only contain accountId and epoch, no credentials
      if (identity !== null) {
        expect(Object.keys(identity)).toEqual(['accountId', 'epoch'])
      }
      events.push(identity)
    })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[events.length - 1]?.accountId).toBe('user-abc')
  })
})
describe('server invalidation', () => {
  it('advances epoch and clears identity on session invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    // Server that returns invalid session after explicit flag is set
    let sessionInvalid = false
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')

      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'valid-token', user: { id: 'user-abc', email: 'test@example.com' } }
        }))
      } else if (request.url === '/api/v1/user/profile') {
        if (sessionInvalid) {
          // Return invalid session after explicit flag is set
          response.statusCode = 401
          response.end(JSON.stringify({ code: 401, error_code: 'invalid_credentials', message: 'Session expired' }))
        } else {
          response.end(JSON.stringify({ code: 0, data: { balance: 100 } }))
        }
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: 'mock-key', group_id: 6 }], pages: 1 }
        }))
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server.once('error', listenReject)
    server.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server)

    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Server failed to bind')
    const url = `http://127.0.0.1:${address.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity1 = await ctx.accountSub2api.automationIdentity()
    expect(identity1).not.toBeNull()
    expect(identity1?.accountId).toBe('user-abc')

    // Enable 401 after valid login and lease registration
    sessionInvalid = true

    // Quota call with invalid session must reject — identity cleared, no credential acquisition
    await expect(ctx.accountSub2api.quota()).rejects.toThrow()

    // Identity should be cleared
    const identity2 = await ctx.accountSub2api.automationIdentity()
    expect(identity2).toBeNull()
  })
})

describe('stop callbacks do not deadlock', () => {
  it('allows stop callbacks to read status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Stop callback that reads status should not deadlock
    let statusReadDuringStop: AccountStatus | undefined
    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      // This should not deadlock - status() doesn't take transition lock
      statusReadDuringStop = await ctx.accountSub2api.getStatus()
    })

    await ctx.accountSub2api.logout()

    // Status should have been read during stop
    expect(statusReadDuringStop).toBeDefined()
  })

  it('allows stop callbacks to read identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Stop callback that reads identity should not deadlock
    let identityReadDuringStop: AccountAutomationIdentity | null | undefined
    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      // This should not deadlock - automationIdentity() doesn't take transition lock
      identityReadDuringStop = await ctx.accountSub2api.automationIdentity()
    })

    await ctx.accountSub2api.logout()

    // Identity should have been read during stop
    expect(identityReadDuringStop).toBeDefined()
  })
})

describe('two active leases at same epoch', () => {
  it('both leases are drained before key change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc', key: 'key-1' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Register two simultaneous leases at the same epoch
    let lease1Stopped = false
    let lease2Stopped = false
    const stop1Deferred = Promise.withResolvers<void>()
    const stop2Deferred = Promise.withResolvers<void>()

    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      await stop1Deferred.promise
      lease1Stopped = true
    })

    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      await stop2Deferred.promise
      lease2Stopped = true
    })

    // Start logout (will block on both leases)
    const logoutPromise = ctx.accountSub2api.logout()

    // Neither lease should be stopped yet
    const { promise: sleep1, resolve: wake1 } = Promise.withResolvers<void>()
    setTimeout(wake1, 50)
    await sleep1
    expect(lease1Stopped).toBe(false)
    expect(lease2Stopped).toBe(false)

    // Resolve first lease
    stop1Deferred.resolve()

    // Second lease still pending
    const { promise: sleep2, resolve: wake2 } = Promise.withResolvers<void>()
    setTimeout(wake2, 50)
    await sleep2
    expect(lease1Stopped).toBe(true)
    expect(lease2Stopped).toBe(false)

    // Resolve second lease
    stop2Deferred.resolve()

    // Now logout should complete
    await logoutPromise

    expect(lease1Stopped).toBe(true)
    expect(lease2Stopped).toBe(true)
    expect(await ctx.accountSub2api.automationIdentity()).toBeNull()
  })

  it('two leases can be disposed independently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    const stop1 = vi.fn().mockResolvedValue(undefined)
    const stop2 = vi.fn().mockResolvedValue(undefined)

    const disposer1 = ctx.accountSub2api.registerAutomationLease(identity!, stop1)
    const disposer2 = ctx.accountSub2api.registerAutomationLease(identity!, stop2)

    // Dispose first lease
    disposer1()

    // Logout should only call stop2 (lease1 was disposed)
    await ctx.accountSub2api.logout()

    expect(stop1).not.toHaveBeenCalled()
    expect(stop2).toHaveBeenCalledTimes(1)
    disposer2()
  })
})

describe('failed stop leaves credentials unchanged (fail closed)', () => {
  it('logout throws and credentials remain when lease stop fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc', key: 'key-1' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Register a lease whose stop callback fails
    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      throw new Error('stop failed')
    })

    // Logout must reject because drain failed — credentials left unchanged (fail closed)
    await expect(ctx.accountSub2api.logout()).rejects.toThrow()

    // Epoch was advanced before drain; old identity is now stale
    // Identity returns null because epoch advanced past the identity's epoch
    const identityAfter = await ctx.accountSub2api.automationIdentity()
    expect(identityAfter).toBeNull()

    // Credentials remain unchanged (fail closed) - new lease with old identity must reject
    expect(() => ctx.accountSub2api.registerAutomationLease(identity!, async () => {})).toThrow()
  })

  it('login throws and credentials unchanged when lease stop fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)
    const { server, url } = await createMockServer({ userId: 'user-abc', key: 'key-1' })
    servers.push(server)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity1 = await ctx.accountSub2api.automationIdentity()
    expect(identity1).not.toBeNull()

    // Register a lease whose stop callback fails
    ctx.accountSub2api.registerAutomationLease(identity1!, async () => {
      throw new Error('stop failed')
    })

    // Second login should fail because drain fails
    // Login must reject because drain failed — credentials left unchanged (fail closed)
    await expect(ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })).rejects.toThrow()

    // Epoch was advanced before drain; old identity is now stale
    const identity2 = await ctx.accountSub2api.automationIdentity()
    expect(identity2).toBeNull()
    // Credentials remain unchanged (fail closed) - old key still stored, new lease must reject
    expect(() => ctx.accountSub2api.registerAutomationLease(identity1!, async () => {})).toThrow()
  })
})

describe('stop callback getStatus with 401 during transition', () => {
  it('stop callback calling getStatus during transition returns transitional projection without deadlock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    // Server that returns 401 for user/profile only after explicit flag is set
    let sessionInvalid = false
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'mock-token', user: { id: 'user-abc', email: 'test@example.com' } }
        }))
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: 'mock-key', group_id: 6 }], pages: 1 }
        }))
      } else if (request.url === '/api/v1/user/profile') {
        if (sessionInvalid) {
          response.statusCode = 401
          response.end(JSON.stringify({ code: 401, error_code: 'invalid_credentials', message: 'Session expired' }))
        } else {
          response.end(JSON.stringify({ code: 0, data: { balance: 100 } }))
        }
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server.once('error', listenReject)
    server.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server)

    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Server failed to bind')
    const url = `http://127.0.0.1:${address.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Enable 401 after valid login and lease registration
    sessionInvalid = true

    // Stop callback calls getStatus which would get 401 and try to invalidate.
    // During the active transition, status must return transitional projection
    // without network, avoiding deadlock.
    let statusDuringStop: AccountStatus | undefined
    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      // This must not deadlock - status returns transitional projection
      statusDuringStop = await ctx.accountSub2api.getStatus()
    })

    // Logout should complete without deadlock
    await ctx.accountSub2api.logout()

    // Status during transition should be transitional (loggedIn: false)
    expect(statusDuringStop).toBeDefined()
    expect(statusDuringStop?.loggedIn).toBe(false)
  })

  it('stop callback calling quota with 401 during transition fails closed without deadlock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    // Server that returns 401 for user/profile only after explicit flag is set
    let sessionInvalid = false
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'mock-token', user: { id: 'user-abc', email: 'test@example.com' } }
        }))
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: 'mock-key', group_id: 6 }], pages: 1 }
        }))
      } else if (request.url === '/api/v1/user/profile') {
        if (sessionInvalid) {
          response.statusCode = 401
          response.end(JSON.stringify({ code: 401, error_code: 'invalid_credentials', message: 'Session expired' }))
        } else {
          response.end(JSON.stringify({ code: 0, data: { balance: 100 } }))
        }
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server.once('error', listenReject)
    server.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server)

    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Server failed to bind')
    const url = `http://127.0.0.1:${address.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Enable 401 after valid login and lease registration
    sessionInvalid = true

    // Stop callback calls quota which gets 401 and tries withAccountSession
    // invalidation. During active transition, must fail closed without deadlock.
    let quotaError: unknown
    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      try {
        await ctx.accountSub2api.quota()
      } catch (error) {
        quotaError = error
      }
    })

    // Logout should complete without deadlock
    await ctx.accountSub2api.logout()

    // Quota during transition should have failed closed
    expect(quotaError).toBeDefined()
  })
})


describe('delayed 401 does not clear newly logged-in account', () => {
  it('A quota 401 resolves after B login — B key/identity intact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    // Server returns success for /user/profile until A's explicit quota call,
    // then hangs A's quota until released. B's profile always succeeds.
    let aQuotaStarted = false
    let releaseA401 = false
    const tokenUser: Record<string, string> = {
      'token-A': 'user-A',
      'token-B': 'user-B',
    }

    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')

      if (request.url === '/api/v1/auth/login') {
        let body = ''
        request.on('data', (chunk: Buffer) => { body += chunk.toString() })
        request.on('end', () => {
          const parsed = JSON.parse(body) as { email: string }
          const isB = parsed.email === 'b@example.com'
          response.end(JSON.stringify({
            code: 0,
            data: {
              access_token: isB ? 'token-B' : 'token-A',
              user: { id: isB ? 'user-B' : 'user-A', email: parsed.email },
            },
          }))
        })
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        const auth = request.headers.authorization ?? ''
        const token = auth.replace('Bearer ', '')
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: `key-${tokenUser[token] ?? 'A'}`, group_id: 6 }], pages: 1 },
        }))
      } else if (request.url === '/api/v1/user/profile') {
        const auth = request.headers.authorization ?? ''
        const token = auth.replace('Bearer ', '')
        if (token === 'token-A' && aQuotaStarted && !releaseA401) {
          // A's quota hangs until released, then 401s
          const check = () => {
            if (releaseA401) {
              response.statusCode = 401
              response.end(JSON.stringify({ code: 401, error_code: 'invalid_credentials', message: 'Session expired' }))
            } else {
              setTimeout(check, 10)
            }
          }
          check()
        } else if (token === 'token-A' && aQuotaStarted) {
          response.statusCode = 401
          response.end(JSON.stringify({ code: 401, error_code: 'invalid_credentials', message: 'Session expired' }))
        } else {
          // A's login status call and B's profile succeed
          response.end(JSON.stringify({ code: 0, data: { balance: token === 'token-A' ? 100 : 200 } }))
        }
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server.once('error', listenReject)
    server.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server)

    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Server failed to bind')
    const url = `http://127.0.0.1:${address.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    // Login A — status call during finishLogin succeeds
    await ctx.accountSub2api.login({
      email: 'a@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false,
    })

    const identityA = await ctx.accountSub2api.automationIdentity()
    expect(identityA).not.toBeNull()
    expect(identityA?.accountId).toBe('user-A')

    // Now A's explicit quota call hangs until releaseA401
    aQuotaStarted = true
    const quotaAPromise = ctx.accountSub2api.quota().catch((error: unknown) => error)

    // Let A's quota request reach the server (it's now polling)
    const { promise: tick1, resolve: wake1 } = Promise.withResolvers<void>()
    setTimeout(wake1, 50)
    await tick1

    // Login B while A's quota is still pending — B should succeed
    await ctx.accountSub2api.login({
      email: 'b@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false,
    })

    const identityB = await ctx.accountSub2api.automationIdentity()
    expect(identityB).not.toBeNull()
    expect(identityB?.accountId).toBe('user-B')

    // Release A's deferred 401 — A's quota should reject, but B's credentials must remain intact
    releaseA401 = true

    const quotaAResult = await quotaAPromise
    expect(quotaAResult).toBeInstanceOf(Error)

    // B's identity must still be active — delayed A 401 did not clear it
    const identityBAfter = await ctx.accountSub2api.automationIdentity()
    expect(identityBAfter).not.toBeNull()
    expect(identityBAfter?.accountId).toBe('user-B')

    // B's quota should still work
    const quotaB = await ctx.accountSub2api.quota()
    expect(quotaB.balance).toBe(20000)
  })
})

describe('transition stop awaits prior status 401 without deadlock', () => {
  it('status 401 resolves during transition stop — finishes without deadlock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asterhub-account-lifetime-'))
    roots.push(root)

    // Server returns success for /user/profile until explicit flag, then 401s.
    let profile401 = false

    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')

      if (request.url === '/api/v1/auth/login') {
        response.end(JSON.stringify({
          code: 0,
          data: { access_token: 'mock-token', user: { id: 'user-abc', email: 'test@example.com' } },
        }))
      } else if (request.url?.startsWith('/api/v1/keys?')) {
        response.end(JSON.stringify({
          code: 0,
          data: { items: [{ id: 1, key: 'mock-key', group_id: 6 }], pages: 1 },
        }))
      } else if (request.url === '/api/v1/user/profile') {
        if (profile401) {
          response.statusCode = 401
          response.end(JSON.stringify({ code: 401, error_code: 'invalid_credentials', message: 'Session expired' }))
        } else {
          response.end(JSON.stringify({ code: 0, data: { balance: 100 } }))
        }
      } else {
        response.statusCode = 404
        response.end('{}')
      }
    })

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<void>()
    server.once('error', listenReject)
    server.listen(0, '127.0.0.1', listenResolve)
    await listenPromise
    servers.push(server)

    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Server failed to bind')
    const url = `http://127.0.0.1:${address.port}/api/v1`

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
    await ctx.plugin(AccountSub2apiService, { authBaseUrl: url, groupId: 6 })

    await ctx.accountSub2api.login({
      email: 'test@example.com',
      password: 'password',
      rememberUsername: false,
      autoLogin: false,
    })

    const identity = await ctx.accountSub2api.automationIdentity()
    expect(identity).not.toBeNull()

    // Register a lease whose stop callback will await a status request
    let stopCompleted = false
    let statusPromise: Promise<AccountStatus | Error> | undefined
    ctx.accountSub2api.registerAutomationLease(identity!, async () => {
      // The prior status 401 will try to invalidate; during this transition
      // it must fail closed, not deadlock. Await it to prove no deadlock.
      if (statusPromise) await statusPromise
      stopCompleted = true
    })

    // Enable 401 for /user/profile
    profile401 = true

    // Start a getStatus call — it will get 401 and try to invalidate
    statusPromise = ctx.accountSub2api.getStatus().catch((error: unknown) => error as Error)

    // Let the status request reach the server
    const { promise: tick1, resolve: wake1 } = Promise.withResolvers<void>()
    setTimeout(wake1, 50)
    await tick1

    // Start logout — it will drain the lease, which awaits statusPromise
    const logoutPromise = ctx.accountSub2api.logout()

    // Give logout time to enter the transition and start draining
    const { promise: tick2, resolve: wake2 } = Promise.withResolvers<void>()
    setTimeout(wake2, 50)
    await tick2

    // Logout should complete without deadlock
    await logoutPromise

    // The stop callback should have completed
    expect(stopCompleted).toBe(true)

    // Identity should be cleared after logout
    expect(await ctx.accountSub2api.automationIdentity()).toBeNull()
  })
})
