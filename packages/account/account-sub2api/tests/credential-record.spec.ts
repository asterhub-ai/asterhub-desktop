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
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('stores the account model key and exposes configured payment methods without an availability flag', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-account-record-'))
  roots.push(root)
  let keyListCalls = 0
  let pricing: Record<string, unknown> = {}
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/v1/auth/login') {
      response.end(JSON.stringify({ code: 0, data: { access_token: 'account-token', user: { id: 7, email: 'user@example.com' } } }))
    } else if (request.url?.startsWith('/api/v1/keys?')) {
      keyListCalls++
      response.end(JSON.stringify({ code: 0, data: { items: [{ id: 3, key: 'account-model-key', group_id: 6 }], pages: 1 } }))
    } else if (request.url === '/api/v1/user/profile') {
      response.end(JSON.stringify({ code: 0, data: { balance: 0 } }))
    } else if (request.url === '/api/v1/payment/checkout-info') {
      response.end(JSON.stringify({ code: 0, data: { ...pricing, methods: {
        alipay: { payment_type: 'alipay', currency: 'CNY', single_min: 0, single_max: 0 },
        wxpay: { available: false, display_name: '微信支付' },
      } } }))
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
  expect(await ctx.accountSub2api.paymentMethods()).toEqual([
    { id: 'alipay', label: 'alipay', currency: 'CNY' },
  ])
  const validPricing = { balance_recharge_multiplier: 2, recharge_bonus_mode: 'bonus',
    recharge_bonus_tiers: [{ min_amount: 10, bonus_percent: 5 }] }
  pricing = validPricing
  expect((await ctx.accountSub2api.paymentMethods())[0]?.pricing).toEqual({
    multiplier: 2, bonusMode: 'bonus', bonusTiers: [{ minAmount: 10, bonusPercent: 5 }],
  })
  for (const invalid of [
    { ...validPricing, balance_recharge_multiplier: -1 },
    { ...validPricing, balance_recharge_multiplier: '2' },
    { ...validPricing, recharge_bonus_mode: 'unknown' },
    { ...validPricing, recharge_bonus_tiers: [{ min_amount: 10, bonus_percent: -1 }] },
    { ...validPricing, recharge_bonus_tiers: [null] },
    { ...validPricing, recharge_bonus_tiers: [{ min_amount: 0, bonus_percent: 1001 }] },
    { ...validPricing, recharge_bonus_tiers: [{ min_amount: 0.001, bonus_percent: 5 }] },
    { ...validPricing, recharge_bonus_tiers: [{ min_amount: 0, bonus_percent: 0.001 }] },
  ]) {
    pricing = invalid
    expect((await ctx.accountSub2api.paymentMethods())[0]?.pricing).toBeUndefined()
  }
  pricing = { ...validPricing, recharge_bonus_tiers: [{ min_amount: 0, bonus_percent: 5 }] }
  expect((await ctx.accountSub2api.paymentMethods())[0]?.pricing?.bonusTiers)
    .toEqual([{ minAmount: 0, bonusPercent: 5 }])
  expect(keyListCalls).toBe(1)
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key')))
    .toEqual({ kind: 'api-key', key: 'account-model-key' })
  expect(await ctx.credentials.resolve(credentialRef(MODEL_KEY_REF))).toMatchObject({
    value: 'process-environment-key-must-not-become-the-model-key', source: 'env',
  })

  await ctx.accountSub2api.logout()
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key'))).toBeUndefined()
  await ctx.accountSub2api.login({ email: 'user@example.com', password: 'test-password', rememberUsername: false, autoLogin: false })
  expect(keyListCalls).toBe(1)
  expect(await ctx.credentials.readRecord(credentialKey('asterhub-account', 'model-api-key')))
    .toEqual({ kind: 'api-key', key: 'account-model-key' })
  expect(await ctx.credentials.resolve(credentialRef(MODEL_KEY_REF))).toMatchObject({
    value: 'process-environment-key-must-not-become-the-model-key', source: 'env',
  })
}, 15000)

it('returns loggedIn: false when stored session token encounters 401 on quota check instead of throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-account-record-'))
  roots.push(root)
  let quotaShouldFail = false
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/v1/auth/login') {
      response.end(JSON.stringify({ code: 0, data: { access_token: 'valid-token', user: { id: 8, email: 'user@example.com' } } }))
    } else if (request.url?.startsWith('/api/v1/keys?')) {
      response.end(JSON.stringify({ code: 0, data: { items: [{ id: 4, key: 'test-key', group_id: 6 }], pages: 1 } }))
    } else if (request.url === '/api/v1/user/profile') {
      if (quotaShouldFail) {
        response.statusCode = 401
        response.end(JSON.stringify({ code: 401, message: 'unauthorized', error_code: 'unauthorized' }))
      } else {
        response.end(JSON.stringify({ code: 0, data: { balance: 10 } }))
      }
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

  const initial = await ctx.accountSub2api.login({ email: 'user@example.com', password: 'password', rememberUsername: false, autoLogin: false })
  expect(initial.loggedIn).toBe(true)

  quotaShouldFail = true
  const status = await ctx.accountSub2api.getStatus()
  expect(status.loggedIn).toBe(false)
})
