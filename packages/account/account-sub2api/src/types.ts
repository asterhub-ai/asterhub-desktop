/**
 * AsterHub account types shared between the Host service and the generated
 * Remote client face.
 * @module @deepseek-ai/dsh-account-sub2api/types
 */

/** The sub2api account identity of the logged-in user. */
export interface AccountUser {
  readonly id: string
  readonly email?: string
  readonly username?: string
}

/** Account login input and local sign-in preferences. */
export interface AccountLoginInput {
  readonly email: string
  readonly password: string
  readonly rememberUsername: boolean
  readonly autoLogin: boolean
}

/** Sub2API registration fields and local sign-in preferences. */
export interface AccountRegisterInput extends AccountLoginInput {
  readonly verifyCode: string
  readonly invitationCode?: string
}

/** Public account-creation requirements returned by the authentication service. */
export interface AccountAuthSettings {
  readonly registrationEnabled: boolean
  readonly emailVerifyEnabled: boolean
  readonly invitationCodeEnabled: boolean
}

/** Everything the 账户 settings surface renders for the current state. */
export interface AccountStatus {
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
}

/** One live quota read. */
export interface QuotaSnapshot {
  /** Compute credits, scaled from the upstream balance. */
  readonly balance: number
}

/** Usage aggregates returned for one time window. */
export interface UsagePeriodSnapshot {
  readonly requests: number
  readonly tokens: number
  /** Compute credits, converted from actual upstream cost at 10 points per unit. */
  readonly credits: number
}

/** Usage totals across the account's lifetime, recent week, and current day. */
export interface AccountUsageSnapshot {
  readonly cumulative: UsagePeriodSnapshot
  readonly last7Days: UsagePeriodSnapshot
  readonly today: UsagePeriodSnapshot
}

/** One checkout method returned by the account service. */
export interface AccountPaymentMethod {
  readonly id: string
  readonly label: string
  readonly minAmount?: number
  readonly maxAmount?: number
}

/** One created top-up order: open `checkoutUrl` in a browser to pay. */
export interface TopUpResult {
  readonly id: string
  readonly status: string
  readonly checkoutUrl?: string
}

/** One redeemed code. */
export interface RedeemResult {
  readonly status: string
  readonly balance?: number
}
