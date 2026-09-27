/**
 * AsterHub account service, Host half: login, model-key provisioning, quota,
 * and top-up against the sub2api control plane. Accounts are hosted and
 * verified by sub2api; this installation only stores the access token and the
 * provisioned model key (as credential records) and never sees deployment
 * secrets such as an admin token.
 *
 * The provisioned key is written to the `SUB2API_API_KEY` credential
 * reference, which the llm-pi-ai `sub2api` route resolves per request — so a
 * successful login is what makes model calls work on this installation.
 * @module @deepseek-ai/dsh-account-sub2api
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {
  AccountStatus, AccountUser, QuotaSnapshot, RedeemResult, TopUpResult,
} from './types.ts'

/** Credential reference holding the sub2api access token. */
const TOKEN_REF = 'ASTERHUB_ACCOUNT_TOKEN'
/** Credential reference holding the JSON account identity. */
const USER_REF = 'ASTERHUB_ACCOUNT_USER'
/** Credential reference the llm-pi-ai sub2api route resolves for model calls. */
export const MODEL_KEY_REF = 'SUB2API_API_KEY'

/** Upstream failure vocabulary the UI maps to copy. */
export type AccountErrorCode =
  | 'invalid_credentials'
  | 'group_binding_forbidden'
  | 'upstream_unavailable'
  | 'invalid_response'

/** Remote failure detail codes are constrained by the protocol; the human message carries the meaning. */
function accountError(message: string): RemoteError {
  return new RemoteError('gateway/bad-request', message, {})
}

/** One sub2api authentication response. */
interface Sub2ApiAuth {
  accessToken: string
  user: AccountUser
}

/** One provisioned model key. */
interface Sub2ApiKey {
  id: string | number
  key: string
}

interface Sub2ApiKeyMetadata {
  id: string | number
  name: string
  key?: string
}

/** Minimal sub2api control-plane client: login, key management, quota, top-up. */
class Sub2ApiClient {
  private readonly baseUrl: URL
  private readonly fetcher: typeof fetch
  private readonly groupId: string | number
  private readonly timeoutMs: number

  constructor(options: { baseUrl: string; fetcher?: typeof fetch; groupId: string | number; requestTimeoutMs?: number }) {
    this.baseUrl = new URL(`${options.baseUrl.replace(/\/$/, '')}/`)
    this.fetcher = options.fetcher ?? fetch
    this.groupId = options.groupId
    this.timeoutMs = options.requestTimeoutMs ?? 15000
  }

  private groupValue(): string | number {
    return typeof this.groupId === 'string' && /^\d+$/u.test(this.groupId) ? Number(this.groupId) : this.groupId
  }

  private async request(path: string, init: RequestInit = {}, accessToken?: string): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers)
    headers.set('content-type', 'application/json')
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
      response = await this.fetcher(new URL(path.replace(/^\//, ''), this.baseUrl), {
        ...init, headers, signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw accountError('认证服务暂时不可用，请稍后再试')
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      const message = typeof body.message === 'string' && body.message ? body.message : undefined
      if (response.status === 401 || body.error_code === 'invalid_credentials' || body.error_code === 'unauthorized')
        throw accountError('邮箱或密码不正确')
      if (response.status === 403 && /not allowed to bind/i.test(message ?? ''))
        throw accountError('该账户未被授权使用 AsterHub 分组，请在 sub2api 中开通分组后重试')
      throw accountError(message ?? '认证服务暂时不可用，请稍后再试')
    }
    const data = body.data
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
    return body
  }

  async login(email: string, password: string): Promise<Sub2ApiAuth> {
    const body = await this.request('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    if (typeof body.access_token !== 'string' || body.access_token === '')
      throw accountError('认证服务返回了无法识别的响应')
    const user = body.user as Record<string, unknown> | undefined
    if (!user || (typeof user.id !== 'string' && typeof user.id !== 'number'))
      throw accountError('认证服务返回了无法识别的响应')
    return {
      accessToken: body.access_token,
      user: {
        id: String(user.id),
        ...(typeof user.email === 'string' ? { email: user.email } : {}),
        ...(typeof user.username === 'string' ? { username: user.username } : {}),
      },
    }
  }

  async findGroupKeysByName(accessToken: string, name: string): Promise<Sub2ApiKeyMetadata[]> {
    const matches: Sub2ApiKeyMetadata[] = []
    const pageSize = 100
    for (let page = 1; page <= 1000; page += 1) {
      const body = await this.request(`keys?page=${page}&page_size=${pageSize}`, {}, accessToken)
      const items = Array.isArray(body.items) ? body.items : Array.isArray(body.keys) ? body.keys : []
      for (const value of items) {
        const item = value as Record<string, unknown>
        if (!item || item.name !== name || (typeof item.id !== 'string' && typeof item.id !== 'number')) continue
        const groupId = typeof item.group_id === 'string' || typeof item.group_id === 'number' ? item.group_id : undefined
        if (groupId !== undefined && String(groupId) !== String(this.groupValue())) continue
        matches.push({
          id: item.id,
          name,
          ...(typeof item.key === 'string' && item.key ? { key: item.key } : {}),
        })
      }
      const pages = Number(body.pages)
      if (Number.isFinite(pages) && pages > 0 ? page >= pages : items.length < pageSize) break
    }
    return matches.sort((left, right) => String(left.id).localeCompare(String(right.id), undefined, { numeric: true }))
  }

  async createGroupKey(accessToken: string, name: string): Promise<Sub2ApiKey> {
    const body = await this.request('keys', { method: 'POST', body: JSON.stringify({ name, group_id: this.groupValue() }) }, accessToken)
    if (typeof body.key !== 'string' || body.key === '')
      throw accountError('认证服务返回了无法识别的响应')
    return {
      id: String(body.id ?? ''),
      key: body.key,
    }
  }

  async deleteGroupKey(accessToken: string, id: string | number): Promise<void> {
    await this.request(`keys/${encodeURIComponent(String(id))}`, { method: 'DELETE' }, accessToken)
  }

  async getQuota(accessToken: string): Promise<QuotaSnapshot> {
    const body = await this.request('user/profile', {}, accessToken)
    const balance = Number(body.balance)
    if (!Number.isFinite(balance)) throw accountError('认证服务返回了无法识别的响应')
    return { balance, ...(typeof body.currency === 'string' ? { currency: body.currency } : {}) }
  }

  async createTopUp(accessToken: string, amount: number): Promise<TopUpResult> {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new RemoteError('gateway/bad-request', '充值金额必须大于零', {})
    const body = await this.request('payment/orders', { method: 'POST', body: JSON.stringify({ amount }) }, accessToken)
    const id = body.id ?? body.order_id
    if (typeof id !== 'string' && typeof id !== 'number')
      throw accountError('认证服务返回了无法识别的响应')
    return {
      id: String(id),
      status: typeof body.status === 'string' ? body.status : 'created',
      ...(typeof body.checkout_url === 'string' ? { checkoutUrl: body.checkout_url } : {}),
    }
  }

  async redeemCode(accessToken: string, code: string): Promise<RedeemResult> {
    const normalized = code.trim()
    if (!normalized) throw new RemoteError('gateway/bad-request', '请输入兑换码', {})
    const body = await this.request('redeem-codes/redeem', { method: 'POST', body: JSON.stringify({ code: normalized }) }, accessToken)
    const balance = body.balance === undefined ? undefined : Number(body.balance)
    return {
      status: typeof body.status === 'string' ? body.status : 'redeemed',
      ...(balance !== undefined && Number.isFinite(balance) ? { balance } : {}),
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** AsterHub account state: sub2api login, key provisioning, quota, top-up. */
    accountSub2apiService: AccountSub2apiService
  }
}

/** Plugin config: where the control plane lives and which group keys bind to. */
export interface Config {
  /** sub2api control-plane base URL. */
  authBaseUrl?: string
  /** The key group new model keys bind to. */
  groupId?: string | number
}

/** A stable per-installation identifier, generated once under the harness home. */
async function installationId(): Promise<string> {
  const file = join(dshHomePath(), 'asterhub-installation')
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing) return existing
  } catch { /* first boot on this installation */ }
  const generated = randomUUID()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, generated, 'utf8')
  return generated
}

/** Account service: login, provisioning, quota, and top-up over sub2api. */
export class AccountSub2apiService extends TypertRemoteService {
  static inject = ['credentials']
  static Config: z<Config> = z.object({
    authBaseUrl: z.string().default('https://xapi.fans/api/v1'),
    groupId: z.any().default(6),
  })

  private readonly credentials: CredentialProvider
  private readonly client: Sub2ApiClient
  private readonly dashboardUrl: string
  private installation: string | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'accountSub2api')
    this.credentials = ctx.credentials
    const resolved = config as Required<Config>
    this.client = new Sub2ApiClient({ baseUrl: resolved.authBaseUrl, groupId: resolved.groupId })
    this.dashboardUrl = new URL(resolved.authBaseUrl).origin
  }

  private async keyName(userId: string): Promise<string> {
    this.installation ??= await installationId()
    return `asterhub:${this.installation}:${userId}`
  }

  private async token(): Promise<string | undefined> {
    return (await this.credentials.resolve(credentialRef(TOKEN_REF)))?.value
  }

  private async storedUser(): Promise<AccountUser | undefined> {
    const raw = (await this.credentials.resolve(credentialRef(USER_REF)))?.value
    if (!raw) return undefined
    try {
      const parsed = JSON.parse(raw) as AccountUser
      return typeof parsed?.id === 'string' ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private async status(): Promise<AccountStatus> {
    const token = await this.token()
    const keyBound = (await this.credentials.resolve(credentialRef(MODEL_KEY_REF))) !== undefined
    if (!token) return { loggedIn: false, keyBound, dashboardUrl: this.dashboardUrl }
    const user = await this.storedUser()
    let balance: number | undefined
    let currency: string | undefined
    try {
      const quota = await this.client.getQuota(token)
      balance = quota.balance
      currency = quota.currency
    } catch { /* a stale or unreachable token must not break the surface */ }
    return {
      loggedIn: true,
      keyBound,
      ...(user !== undefined ? { user } : {}),
      ...(balance !== undefined ? { balance } : {}),
      ...(currency !== undefined ? { currency } : {}),
      dashboardUrl: this.dashboardUrl,
    }
  }

  /** Read the current account state, including a live balance when logged in. */
  @Remote
  async getStatus(): Promise<AccountStatus> {
    return this.status()
  }

  /** Log in with the sub2api account, provision (or recover) the model key, and bind it to this installation. */
  @Remote
  async login(input: { email: string; password: string }): Promise<AccountStatus> {
    const email = input.email.trim().toLowerCase()
    if (!email.includes('@')) throw new RemoteError('gateway/bad-request', '请输入有效的邮箱地址', {})
    if (!input.password) throw new RemoteError('gateway/bad-request', '请输入密码', {})
    const auth = await this.client.login(email, input.password)
    const keyName = await this.keyName(String(auth.user.id))
    const recovered = await this.client.findGroupKeysByName(auth.accessToken, keyName)
    const reusable = recovered.find(item => item.key)
    let key: string | undefined
    if (reusable?.key) {
      key = reusable.key
      for (const duplicate of recovered) {
        if (String(duplicate.id) !== String(reusable.id)) {
          await this.client.deleteGroupKey(auth.accessToken, duplicate.id).catch(() => {})
        }
      }
    } else {
      for (const orphan of recovered) {
        await this.client.deleteGroupKey(auth.accessToken, orphan.id).catch(() => {})
      }
      key = (await this.client.createGroupKey(auth.accessToken, keyName)).key
    }
    await this.credentials.set(credentialRef(MODEL_KEY_REF), key)
    await this.credentials.set(credentialRef(TOKEN_REF), auth.accessToken)
    await this.credentials.set(credentialRef(USER_REF), JSON.stringify(auth.user))
    return this.status()
  }

  /** Forget the stored token and unbind the model key. */
  @Remote
  async logout(): Promise<void> {
    await this.credentials.unset(credentialRef(MODEL_KEY_REF))
    await this.credentials.unset(credentialRef(TOKEN_REF))
    await this.credentials.unset(credentialRef(USER_REF))
  }

  /** Read one live quota snapshot. */
  @Remote
  async quota(): Promise<QuotaSnapshot> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.client.getQuota(token)
  }

  /** Create one top-up order; open the returned checkout URL in a browser to pay. */
  @Remote
  async topUp(input: { amount: number }): Promise<TopUpResult> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.client.createTopUp(token, input.amount)
  }

  /** Redeem one code into the account balance. */
  @Remote
  async redeem(input: { code: string }): Promise<RedeemResult> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.client.redeemCode(token, input.code)
  }
}

export default AccountSub2apiService
