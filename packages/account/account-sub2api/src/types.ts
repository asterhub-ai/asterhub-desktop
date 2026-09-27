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

/** Everything the 账户 settings surface renders for the current state. */
export interface AccountStatus {
  /** Whether a sub2api access token is stored on this installation. */
  readonly loggedIn: boolean
  /** Whether the model-call key is bound to this installation. */
  readonly keyBound: boolean
  /** The account identity; present only when logged in. */
  readonly user?: AccountUser
  /** Live balance from the sub2api profile; absent when the query failed. */
  readonly balance?: number
  /** Balance currency, when the deployment reports one. */
  readonly currency?: string
  /** The sub2api web root, for entries that live in the dashboard. */
  readonly dashboardUrl: string
}

/** One live quota read. */
export interface QuotaSnapshot {
  readonly balance: number
  readonly currency?: string
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
