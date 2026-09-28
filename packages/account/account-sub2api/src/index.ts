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

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  AccountLoginInput, AccountPaymentMethod, AccountStatus, AccountUsageSnapshot, AccountUser, QuotaSnapshot,
  RedeemResult, TopUpResult, UsagePeriodSnapshot,
} from './types.ts'

/** Credential reference holding the sub2api access token. */
const TOKEN_REF = 'ASTERHUB_ACCOUNT_TOKEN'
/** Credential reference holding the JSON account identity. */
const USER_REF = 'ASTERHUB_ACCOUNT_USER'
/** Remembered account identifier, when the user opts in. */
const REMEMBERED_USERNAME_REF = 'ASTERHUB_ACCOUNT_USERNAME'
/** Saved password used only when automatic sign-in is enabled. */
const AUTO_LOGIN_PASSWORD_REF = 'ASTERHUB_ACCOUNT_AUTO_LOGIN_PASSWORD'
/** Sign-in preference flag. */
const AUTO_LOGIN_REF = 'ASTERHUB_ACCOUNT_AUTO_LOGIN'
/** Credential reference the llm-pi-ai sub2api route resolves for model calls. */
export const MODEL_KEY_REF = 'SUB2API_API_KEY'
/** Retained while logged out so signing back into the same account can reuse its one key. */
const BOUND_KEY_REF = 'ASTERHUB_ACCOUNT_BOUND_MODEL_KEY'
/** Legacy owner field used to safely migrate previously retained keys. */
const BOUND_KEY_USER_REF = 'ASTERHUB_ACCOUNT_BOUND_MODEL_KEY_USER'
/** JSON map from account id to its retained, Host-only model key. */
const BOUND_KEYS_REF = 'ASTERHUB_ACCOUNT_BOUND_MODEL_KEYS'

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

/** An upstream account session expired; this class never crosses the Remote boundary. */
class InvalidAccountSessionError extends Error {
  constructor() {
    super('Sub2API account session is invalid')
    this.name = 'InvalidAccountSessionError'
  }
}

/** A non-authentication failure safe to expose to the account UI. */
function accountServiceUnavailable(): RemoteError {
  return new RemoteError('gateway/internal', '认证服务暂不可用，请稍后重试', {})
}

/** Safe error copy for checkout failures. */
function paymentServiceUnavailable(): RemoteError {
  return new RemoteError('gateway/internal', '支付暂不可用，请稍后重试', {})
}

/** Convert the upstream balance to two-decimal compute credits. */
function computeCredits(balance: number): number {
  return Number((balance * 100).toFixed(2))
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
  status?: string
  group_id?: string | number
}

interface Sub2ApiUsageResponse {
  total_requests?: number
  total_tokens?: number
  total_actual_cost?: number
}

interface Sub2ApiDashboardStats extends Sub2ApiUsageResponse {
  today_requests?: number
  today_tokens?: number
  today_actual_cost?: number
}

interface Sub2ApiCheckoutInfo {
  methods?: Record<string, {
    available?: boolean
    display_name?: string
    currency?: string
    single_min?: number
    single_max?: number
  }>
}

interface Sub2ApiOrder {
  order_id?: string | number
  pay_url?: string
  status?: string
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
      throw accountServiceUnavailable()
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      const message = typeof body.message === 'string' && body.message ? body.message : undefined
      if (response.status === 401 || body.error_code === 'invalid_credentials' || body.error_code === 'unauthorized')
        throw new InvalidAccountSessionError()
      if (response.status === 403 && (
        body.error_code === 'group_binding_forbidden' || /not allowed to bind/i.test(message ?? '')
      ))
        throw accountError('当前账户尚未开通工作台使用权限，请联系支持处理')
      throw accountServiceUnavailable()
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

  async listGroupKeys(accessToken: string): Promise<Sub2ApiKeyMetadata[]> {
    const matches: Sub2ApiKeyMetadata[] = []
    const pageSize = 100
    for (let page = 1; page <= 1000; page += 1) {
      const body = await this.request(`keys?page=${page}&page_size=${pageSize}`, {}, accessToken)
      const items = Array.isArray(body.items) ? body.items : Array.isArray(body.keys) ? body.keys : []
      for (const value of items) {
        const item = value as Record<string, unknown>
        if (!item || (typeof item.id !== 'string' && typeof item.id !== 'number')) continue
        const groupId = typeof item.group_id === 'string' || typeof item.group_id === 'number' ? item.group_id : undefined
        if (groupId !== undefined && String(groupId) !== String(this.groupValue())) continue
        if (item.status === 'inactive' || item.status === 'disabled' || item.status === 'revoked') continue
        matches.push({
          id: item.id,
          name: typeof item.name === 'string' ? item.name : '',
          ...(typeof item.key === 'string' && item.key ? { key: item.key } : {}),
          ...(typeof item.status === 'string' ? { status: item.status } : {}),
          ...(groupId !== undefined ? { group_id: groupId } : {}),
        })
      }
      const pages = Number(body.pages)
      if (Number.isFinite(pages) && pages > 0 ? page >= pages : items.length < pageSize) break
    }
    return matches.sort((left, right) => String(left.id).localeCompare(String(right.id), undefined, { numeric: true }))
  }

  async getGroupKey(accessToken: string, id: string | number): Promise<Sub2ApiKeyMetadata> {
    const body = await this.request(`keys/${encodeURIComponent(String(id))}`, {}, accessToken)
    const raw = body.key
    return {
      id,
      name: typeof body.name === 'string' ? body.name : '',
      ...(typeof raw === 'string' && raw ? { key: raw } : {}),
    }
  }

  async getUsage(accessToken: string, startDate: string, endDate = startDate): Promise<UsagePeriodSnapshot> {
    const query = new URLSearchParams({ start_date: startDate, end_date: endDate, timezone: 'Asia/Shanghai' })
    const body = await this.request(`usage/stats?${query}`, {}, accessToken) as Sub2ApiUsageResponse
    const requests = Number(body.total_requests)
    const tokens = Number(body.total_tokens)
    const actualCost = Number(body.total_actual_cost)
    if (![requests, tokens, actualCost].every(Number.isFinite)) throw accountServiceUnavailable()
    return { requests, tokens, credits: Number((actualCost * 10).toFixed(2)) }
  }

  async getDashboardStats(accessToken: string): Promise<Sub2ApiDashboardStats> {
    return await this.request('usage/dashboard/stats', {}, accessToken) as Sub2ApiDashboardStats
  }

  usageDateRange(now = new Date()): { today: string; last7DaysStart: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
    const partValue = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(part => part.type === type)?.value)
    const year = partValue('year')
    const month = partValue('month')
    const day = partValue('day')
    if (![year, month, day].every(Number.isFinite)) throw accountServiceUnavailable()
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const start = new Date(Date.UTC(year, month - 1, day - 6))
    const startDate = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`
    return { today: date, last7DaysStart: startDate }
  }

  async createGroupKey(accessToken: string, name: string): Promise<Sub2ApiKey> {
    const body = await this.request('keys', { method: 'POST', body: JSON.stringify({ name, group_id: this.groupValue() }) }, accessToken)
    if (typeof body.key !== 'string' || body.key === '')
      throw accountServiceUnavailable()
    return {
      id: String(body.id ?? ''),
      key: body.key,
    }
  }

  async getQuota(accessToken: string): Promise<QuotaSnapshot> {
    const body = await this.request('user/profile', {}, accessToken)
    const balance = Number(body.balance)
    if (!Number.isFinite(balance)) throw accountServiceUnavailable()
    return { balance }
  }

  async createTopUp(accessToken: string, amount: number, paymentType: string): Promise<TopUpResult> {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new RemoteError('gateway/bad-request', '充值金额必须大于零', {})
    let body: Sub2ApiOrder
    try {
      body = await this.request('payment/orders', {
        method: 'POST',
        body: JSON.stringify({ amount, payment_type: paymentType, order_type: 'balance' }),
      }, accessToken) as Sub2ApiOrder
    } catch (error) {
      if (error instanceof InvalidAccountSessionError) throw error
      throw paymentServiceUnavailable()
    }
    const id = body.order_id
    if (typeof id !== 'string' && typeof id !== 'number')
      throw paymentServiceUnavailable()
    return {
      id: String(id),
      status: typeof body.status === 'string' ? body.status : 'created',
      ...(typeof body.pay_url === 'string' ? { checkoutUrl: body.pay_url } : {}),
    }
  }

  async getPaymentMethods(accessToken: string): Promise<AccountPaymentMethod[]> {
    const body = await this.request('payment/checkout-info', {}, accessToken) as Sub2ApiCheckoutInfo
    return Object.entries(body.methods ?? {})
      .filter(([, method]) => method?.available === true)
      .map(([id, method]) => ({
        id,
        label: typeof method.display_name === 'string' && method.display_name.trim()
          ? method.display_name.trim()
          : id,
        ...(typeof method.currency === 'string' ? { currency: method.currency } : {}),
        ...(typeof method.single_min === 'number' && Number.isFinite(method.single_min)
          ? { minAmount: method.single_min } : {}),
        ...(typeof method.single_max === 'number' && Number.isFinite(method.single_max)
          ? { maxAmount: method.single_max } : {}),
      }))
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

/** Account service: login, provisioning, quota, and top-up over sub2api. */
export class AccountSub2apiService extends TypertRemoteService {
  static inject = ['credentials']
  static Config: z<Config> = z.object({
    authBaseUrl: z.string().default('https://xapi.fans/api/v1'),
    groupId: z.any().default(6),
  })

  private readonly credentials: CredentialProvider
  private readonly client: Sub2ApiClient
  private keyProvisioning: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'accountSub2api')
    this.credentials = ctx.credentials
    const resolved = config as Required<Config>
    this.client = new Sub2ApiClient({ baseUrl: resolved.authBaseUrl, groupId: resolved.groupId })
  }

  private keyName(userId: string): string {
    return `asterhub:${userId}`
  }

  private async withKeyProvisioning<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.keyProvisioning
    let release!: () => void
    this.keyProvisioning = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  /** Return a locally retained key only when its saved owner matches the account. */
  private async retainedKeyFor(userId: string): Promise<string | undefined> {
    const serialized = (await this.credentials.resolve(credentialRef(BOUND_KEYS_REF)))?.value
    if (serialized) {
      try {
        const mapping = JSON.parse(serialized) as Record<string, unknown>
        const key = mapping[userId]
        if (typeof key === 'string' && key) return key
      } catch { /* recover the legacy single-account binding below */ }
    }
    const legacyOwner = (await this.credentials.resolve(credentialRef(BOUND_KEY_USER_REF)))?.value
    return legacyOwner === userId ? (await this.credentials.resolve(credentialRef(BOUND_KEY_REF)))?.value : undefined
  }

  private async retainKey(userId: string, key: string): Promise<void> {
    const serialized = (await this.credentials.resolve(credentialRef(BOUND_KEYS_REF)))?.value
    let mapping: Record<string, string> = {}
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized) as Record<string, unknown>
        mapping = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      } catch { /* replace malformed local cache with the newly validated binding */ }
    }
    mapping[userId] = key
    await this.credentials.set(credentialRef(BOUND_KEYS_REF), JSON.stringify(mapping))
  }

  private async token(): Promise<string | undefined> {
    return (await this.credentials.resolve(credentialRef(TOKEN_REF)))?.value
  }

  /** Remove the active account and model credentials. */
  private async clearSessionCredentials(): Promise<void> {
    const results = await Promise.allSettled([
      this.credentials.unset(credentialRef(MODEL_KEY_REF)),
      this.credentials.unset(credentialRef(TOKEN_REF)),
      this.credentials.unset(credentialRef(USER_REF)),
    ])
    if (results.some(result => result.status === 'rejected')) throw accountServiceUnavailable()
  }

  /** Remove the saved password and automatic sign-in preference. */
  private async clearAutoLogin(): Promise<void> {
    const results = await Promise.allSettled([
      this.credentials.unset(credentialRef(AUTO_LOGIN_PASSWORD_REF)),
      this.credentials.unset(credentialRef(AUTO_LOGIN_REF)),
    ])
    if (results.some(result => result.status === 'rejected')) throw accountServiceUnavailable()
  }

  private async clearRememberedUsername(): Promise<void> {
    await this.credentials.unset(credentialRef(REMEMBERED_USERNAME_REF))
  }

  private async rememberedUsername(): Promise<string | undefined> {
    return (await this.credentials.resolve(credentialRef(REMEMBERED_USERNAME_REF)))?.value
  }

  private async autoLoginEnabled(): Promise<boolean> {
    return (await this.credentials.resolve(credentialRef(AUTO_LOGIN_REF)))?.value === 'true'
  }

  private async signInPreferences(): Promise<Pick<AccountStatus, 'rememberedUsername' | 'autoLogin'>> {
    const [rememberedUsername, autoLogin] = await Promise.all([
      this.rememberedUsername(),
      this.autoLoginEnabled(),
    ])
    return {
      ...(rememberedUsername !== undefined ? { rememberedUsername } : {}),
      autoLogin,
    }
  }

  private async automaticSignIn(): Promise<AccountStatus | undefined> {
    if (!(await this.autoLoginEnabled())) return undefined
    const email = await this.rememberedUsername()
    const password = (await this.credentials.resolve(credentialRef(AUTO_LOGIN_PASSWORD_REF)))?.value
    if (!email || !password) {
      await this.clearAutoLogin()
      return undefined
    }
    try {
      return await this.login({ email, password, rememberUsername: true, autoLogin: true })
    } catch (error) {
      if (error instanceof RemoteError && error.message === '邮箱或密码不正确') {
        await this.clearAutoLogin()
        return undefined
      }
      throw error
    }
  }

  /** Clear an expired account before returning a safe Remote failure. */
  private async withAccountSession<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof InvalidAccountSessionError) {
        await this.clearSessionCredentials()
        throw accountError('登录已失效，请重新登录')
      }
      throw error
    }
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
    if (!token) {
      const signedIn = await this.automaticSignIn()
      if (signedIn !== undefined) return signedIn
      return {
        loggedIn: false,
        keyBound,
        ...(await this.signInPreferences()),
      }
    }
    const user = await this.storedUser()
    let balance: number | undefined
    try {
      const quota = await this.client.getQuota(token)
      balance = computeCredits(quota.balance)
    } catch (error) {
      if (error instanceof InvalidAccountSessionError) {
        await this.clearSessionCredentials()
        const signedIn = await this.automaticSignIn()
        if (signedIn !== undefined) return signedIn
        return {
          loggedIn: false,
          keyBound: false,
          ...(await this.signInPreferences()),
        }
      }
      // A transient outage keeps the locally stored account available for retry.
    }
    return {
      loggedIn: true,
      keyBound,
      ...(user !== undefined ? { user } : {}),
      ...(balance !== undefined ? { balance } : {}),
      ...(await this.signInPreferences()),
    }
  }

  /** Read the current account state, including a live balance when logged in.
   * @returns current sign-in state, identity, preferences, and available balance.
   */
  @Remote
  async getStatus(): Promise<AccountStatus> {
    return this.status()
  }

  /** Sign in and bind one reusable model key to this account.
   * @param input - account credentials and local sign-in preferences.
   * @returns current account state after credentials are stored.
   */
  @Remote
  async login(input: AccountLoginInput): Promise<AccountStatus> {
    const email = input.email.trim().toLowerCase()
    if (!email.includes('@')) throw new RemoteError('gateway/bad-request', '请输入有效的邮箱地址', {})
    if (!input.password) throw new RemoteError('gateway/bad-request', '请输入密码', {})
    let auth: Sub2ApiAuth
    try {
      auth = await this.client.login(email, input.password)
    } catch (error) {
      if (error instanceof InvalidAccountSessionError) throw accountError('邮箱或密码不正确')
      throw error
    }
    const userId = String(auth.user.id)
    const keyName = this.keyName(userId)
    const key = await this.withKeyProvisioning(async () => {
      const previousUser = await this.storedUser()
      const activeKey = (await this.credentials.resolve(credentialRef(MODEL_KEY_REF)))?.value
      const locallyBoundKey = previousUser?.id === userId ? activeKey : await this.retainedKeyFor(userId)
      if (locallyBoundKey) return locallyBoundKey

      const keys = await this.client.listGroupKeys(auth.accessToken)
      const accountKeys = keys
      for (const candidate of accountKeys) {
        if (candidate.key && !candidate.key.includes('*')) return candidate.key
        try {
          const detail = await this.client.getGroupKey(auth.accessToken, candidate.id)
          if (detail.key && !detail.key.includes('*')) return detail.key
        } catch { /* Some deployments do not expose key details; never rotate an existing key. */ }
      }
      if (accountKeys.length > 0) {
        throw accountError('该账户已有可用密钥，但当前设备无法读取，请在原设备恢复登录')
      }
      return (await this.client.createGroupKey(auth.accessToken, keyName)).key
    })
    // Replace the prior account only after the new upstream key is ready, and
    // clear all three refs before writing so a partial storage failure cannot
    // pair one account token with another account's model key.
    await this.clearSessionCredentials()
    try {
      await this.credentials.set(credentialRef(TOKEN_REF), auth.accessToken)
      await this.credentials.set(credentialRef(USER_REF), JSON.stringify(auth.user))
      await this.credentials.set(credentialRef(MODEL_KEY_REF), key)
      await this.retainKey(userId, key)
      if (input.rememberUsername || input.autoLogin) {
        await this.credentials.set(credentialRef(REMEMBERED_USERNAME_REF), email)
      } else {
        await this.clearRememberedUsername()
      }
      if (input.autoLogin) {
        await this.credentials.set(credentialRef(AUTO_LOGIN_PASSWORD_REF), input.password)
        await this.credentials.set(credentialRef(AUTO_LOGIN_REF), 'true')
      } else {
        await this.clearAutoLogin()
      }
    } catch {
      const cleanup = await Promise.allSettled([
        this.credentials.unset(credentialRef(MODEL_KEY_REF)),
        this.credentials.unset(credentialRef(TOKEN_REF)),
        this.credentials.unset(credentialRef(USER_REF)),
        this.credentials.unset(credentialRef(REMEMBERED_USERNAME_REF)),
        this.credentials.unset(credentialRef(AUTO_LOGIN_PASSWORD_REF)),
        this.credentials.unset(credentialRef(AUTO_LOGIN_REF)),
      ])
      if (cleanup.some(result => result.status === 'rejected')) {
        throw new RemoteError('gateway/internal', '无法安全保存账户凭据，请重试', {})
      }
      throw accountServiceUnavailable()
    }
    return this.status()
  }

  /** Forget the active session and unbind the model key.
   * @returns resolves after active credentials and automatic sign-in are cleared.
   */
  @Remote
  async logout(): Promise<void> {
    await this.clearSessionCredentials()
    await this.clearAutoLogin()
  }

  /** Read one live quota snapshot.
   * @returns remaining compute credits.
   */
  @Remote
  async quota(): Promise<QuotaSnapshot> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.withAccountSession(async () => {
      const quota = await this.client.getQuota(token)
      return { balance: computeCredits(quota.balance) }
    })
  }

  /** Read account totals, last seven calendar days, and today's usage.
   * @returns request, token, and compute-credit totals for each period.
   */
  @Remote
  async usage(): Promise<AccountUsageSnapshot> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.withAccountSession(async () => {
      const { today: todayDate, last7DaysStart } = this.client.usageDateRange()
      const [dashboard, last7Days, today] = await Promise.all([
        this.client.getDashboardStats(token),
        this.client.getUsage(token, last7DaysStart, todayDate),
        this.client.getUsage(token, todayDate),
      ])
      const requests = Number(dashboard.total_requests)
      const tokens = Number(dashboard.total_tokens)
      const actualCost = Number(dashboard.total_actual_cost)
      if (![requests, tokens, actualCost].every(Number.isFinite)) throw accountServiceUnavailable()
      const cumulative: UsagePeriodSnapshot = {
        requests,
        tokens,
        credits: Number((actualCost * 10).toFixed(2)),
      }
      return { cumulative, last7Days, today }
    })
  }

  /** List payment methods enabled for this account.
   * @returns available payment methods.
   */
  @Remote
  async paymentMethods(): Promise<AccountPaymentMethod[]> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.withAccountSession(() => this.client.getPaymentMethods(token))
  }

  /** Create one top-up order; open the returned checkout URL in a browser to pay.
   * @param input - requested amount and payment method.
   * @returns created order and its checkout address, when available.
   */
  @Remote
  async topUp(input: { amount: number; paymentType: string }): Promise<TopUpResult> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.withAccountSession(async () => {
      const methods = await this.client.getPaymentMethods(token)
      const method = methods.find(entry => entry.id === input.paymentType)
      if (method === undefined) throw accountError('该支付方式暂不可用，请更换后重试')
      if (method.minAmount !== undefined && method.minAmount > 0 && input.amount < method.minAmount)
        throw accountError('充值金额低于该支付方式的最低金额')
      if (method.maxAmount !== undefined && method.maxAmount > 0 && input.amount > method.maxAmount)
        throw accountError('充值金额超过该支付方式的最高金额')
      return this.client.createTopUp(token, input.amount, input.paymentType)
    })
  }

  /** Redeem one code into the account balance.
   * @param input - redemption code.
   * @returns redemption result and updated balance, when reported.
   */
  @Remote
  async redeem(input: { code: string }): Promise<RedeemResult> {
    const token = await this.token()
    if (!token) throw new RemoteError('gateway/bad-request', '尚未登录', {})
    return this.withAccountSession(() => this.client.redeemCode(token, input.code))
  }
}

export default AccountSub2apiService
