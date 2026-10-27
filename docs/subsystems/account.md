# Account Service

English | [中文](account.zh.md)

[`@deepseek-ai/dsh-account-sub2api`](../../packages/account/account-sub2api/README.md) owns the Desktop account Remote. It signs in to the configured control plane, binds the account's existing model key to Host credentials, and returns account, quota, payment and usage data to the Client. Passwords, access tokens and model keys remain in Host credentials.

Source: [`packages/account/account-sub2api/src/types.ts`](../../packages/account/account-sub2api/src/types.ts)

## Public types

```ts type-equiv
/** The sub2api account identity of the logged-in user. */
interface AccountUser {
  readonly id: string
  readonly email?: string
  readonly username?: string
}
```

```ts type-equiv
/** Account login input and local sign-in preferences. */
interface AccountLoginInput {
  readonly email: string
  readonly password: string
  readonly rememberUsername: boolean
  readonly autoLogin: boolean
}
```

```ts type-equiv
/** Everything the 账户 settings surface renders for the current state. */
interface AccountStatus {
  /** Whether a sub2api access token is stored on this installation. */
  readonly loggedIn: boolean
  /** Whether the model-call key is bound to this installation. */
  readonly keyBound: boolean
  /** The account identity; present only when logged in. */
  readonly user?: AccountUser
  /** Compute credits; the upstream balance is multiplied by 100 and rounded to two decimals. */
  readonly balance?: number
  /** Username retained on this installation when requested by the user. */
  readonly rememberedUsername?: string
  /** Whether the Host may use its saved password to renew an expired session. */
  readonly autoLogin?: boolean
  /**
   * Whether part of the account credentials is supplied by the read-only
   * launching environment instead of persisted by this installation. Sign-in
   * succeeds, but writing such references is skipped — the provider rejects a
   * write an environment value would shadow — so their effective values stay
   * the environment's until it stops supplying them.
   */
  readonly credentialsFromEnv?: boolean
}
```

```ts type-equiv
/** One live quota read. */
interface QuotaSnapshot {
  /** Compute credits, scaled from the upstream balance. */
  readonly balance: number
}
```

```ts type-equiv
/** Usage aggregates returned for one time window. */
interface UsagePeriodSnapshot {
  readonly requests: number
  readonly tokens: number
  /** Compute credits, converted from actual upstream cost multiplied by 100 and rounded to two decimals. */
  readonly credits: number
}
```

```ts type-equiv
/** Usage totals across the account's lifetime, recent week, and current day. */
interface AccountUsageSnapshot {
  readonly cumulative: UsagePeriodSnapshot
  readonly last7Days: UsagePeriodSnapshot
  readonly today: UsagePeriodSnapshot
}
```

```ts type-equiv
/** One checkout method returned by the account service. */
interface AccountPaymentMethod {
  readonly id: string
  readonly label: string
  readonly minAmount?: number
  readonly maxAmount?: number
  /** Validated ISO currency code used to round the discounted payment amount. */
  readonly currency?: string
  /** Verified checkout pricing; absent when the upstream response cannot support a preview. */
  readonly pricing?: {
    readonly multiplier: number
    readonly bonusMode: 'bonus' | 'discount'
    readonly bonusTiers: readonly { readonly minAmount: number; readonly bonusPercent: number }[]
  }
}
```

```ts type-equiv
/** One created top-up order: open `checkoutUrl` in a browser to pay. */
interface TopUpResult {
  readonly id: string
  readonly status: string
  readonly checkoutUrl?: string
}
```

```ts type-equiv
/** One redeemed code. */
interface RedeemResult {
  readonly status: string
  readonly balance?: number
}
```

## Automation identity

The account service publishes credential-free account lifetime changes for the native scheduler.

```ts type-equiv
/**
 * Host-only account identity for automation credential isolation.
 * Structurally compatible with @deepseek-ai/dsh-asterhub-automation's AutomationAccountIdentity.
 * Account package remains scheduler-implementation-independent.
 */
interface AccountAutomationIdentity {
  /** Stable account identifier. */
  readonly accountId: string
  /** Monotonically increasing epoch for credential isolation. */
  readonly epoch: number
}
```

## Native service request and result types

These types define public inputs and results used by the native account, workspace, and task services.

```ts type-equiv
/** Public account-creation requirements returned by the authentication service. */
interface AccountAuthSettings {
  readonly registrationEnabled: boolean
  readonly emailVerifyEnabled: boolean
  readonly invitationCodeEnabled: boolean
}
```

```ts type-equiv
/** Sub2API registration fields and local sign-in preferences. */
interface AccountRegisterInput extends AccountLoginInput {
  readonly verifyCode: string
  readonly invitationCode?: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccountsub2api--accountsub2apiservice"></a>

### `ctx.accountSub2api` — `AccountSub2apiService`

Account service: login, provisioning, quota, and top-up over sub2api.

```ts cordis-catalog
/**
 * Host-only: Get current automation account identity.
 * Awaits readiness before returning. If the epoch has been advanced since
 * the identity was issued (e.g., during a concurrent transition), returns null.
 * @returns Current identity with epoch, or null if logged out/stale.
 */
async automationIdentity(): Promise<AccountAutomationIdentity | null>

/**
 * Host-only: Assert identity matches current epoch before model requests.
 * Validates the identity against both the current epoch counter and the active
 * identity (accountId and epoch must match).
 * @param identity - The identity to validate.
 * @throws Error if identity epoch is stale, account mismatch, or epoch does
 * not match active identity.
 */
assertAutomationIdentity(identity: AccountAutomationIdentity): void

/**
 * Host-only: Register a lease for automation execution.
 * Synchronous and rejects stale epochs. Validates the identity against both
 * the current epoch and the active identity (account and epoch).
 * @param identity - The identity to lease under.
 * @param stop - Callback to stop/drain the leased work.
 * @returns Disposer function to unregister the lease.
 * @throws Error if identity epoch is stale or account mismatch.
 */
registerAutomationLease(identity: AccountAutomationIdentity, stop: () => Promise<void>): () => void

/** Read the current account state, including a live balance when logged in.
 * @returns current sign-in state, identity, preferences, and available balance.
 */
@Remote async getStatus(): Promise<AccountStatus>

/** Read the public sign-up requirements from the authentication service.
 * @returns public registration and email verification requirements.
 */
@Remote async authSettings(): Promise<AccountAuthSettings>

/** Send the upstream email verification code for a prospective account.
 * @param email prospective account email address.
 * @returns verification resend countdown in seconds.
 */
@Remote async sendVerifyCode(email: string): Promise<{ countdown: number }>

/** Register directly with the authentication service and bind the returned session to this installation.
 * @param input account details and email verification code.
 * @returns signed-in account state after registration.
 */
@Remote async register(input: AccountRegisterInput): Promise<AccountStatus>

/** Sign in and bind one reusable model key to this account.
 * @param input - account credentials and local sign-in preferences.
 * @returns current account state after the credential transition completes; environment-supplied references are skipped, not stored.
 */
@Remote async login(input: AccountLoginInput): Promise<AccountStatus>

/** Forget the active session and unbind the model key.
 * @returns resolves after active credentials and automatic sign-in are cleared.
 */
@Remote async logout(): Promise<void>

/** Read one live quota snapshot.
 * @returns remaining compute credits.
 */
@Remote async quota(): Promise<QuotaSnapshot>

/** Read account totals, last seven calendar days, and today's usage.
 * @returns request, token, and compute-credit totals for each period.
 */
@Remote async usage(): Promise<AccountUsageSnapshot>

/** List payment methods enabled for this account.
 * @returns available payment methods.
 */
@Remote async paymentMethods(): Promise<AccountPaymentMethod[]>

/** Create one top-up order; open the returned checkout URL in a browser to pay.
 * @param input - requested amount and payment method.
 * @returns created order and its checkout address, when available.
 */
@Remote async topUp(input: { amount: number; paymentType: string }): Promise<TopUpResult>

/** Redeem one code into the account balance.
 * @param input - redemption code.
 * @returns redemption result and updated balance, when reported.
 */
@Remote async redeem(input: { code: string }): Promise<RedeemResult>
```

Source: [`packages/account/account-sub2api/src/index.ts`](../../packages/account/account-sub2api/src/index.ts)

<a id="asterhub-account-events"></a>

### `asterhub-account/*` events

<a id="asterhub-accountchanged--emit"></a>

#### `asterhub-account/changed` — emit

Publish the active account lifetime without credentials.

```ts cordis-catalog
/**
 * Publish the active account lifetime without credentials.
 * @param identity - Active identity, or null when acquisition is unavailable.
 * @mode emit
 */
'asterhub-account/changed'(identity: AccountAutomationIdentity | null): void
```

Source: [`packages/account/account-sub2api/src/index.ts`](../../packages/account/account-sub2api/src/index.ts)
<!-- END GENERATED cordis-surface -->
