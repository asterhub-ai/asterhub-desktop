/**
 * Module-level handle to the account Remote. The registration (index.ts)
 * captures a lazy resolver during apply; components read it through
 * {@link getAccountApi} — resolved lazily so a not-yet-mounted namespace
 * still resolves once the api-remotes assembly finishes, instead of
 * crashing the slot outlet.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

type AccountApi = ClientRemote['accountSub2api']

/** The lazy resolver captured by the registration. */
let resolver: (() => AccountApi | undefined) | undefined

/** Capture the lazy resolver for the account Remote face. */
export function setAccountApiResolver(next: () => AccountApi | undefined): void {
  resolver = next
}

/** Read the account Remote face, or undefined while it is unavailable. */
export function getAccountApi(): AccountApi | undefined {
  try {
    return resolver?.()
  } catch {
    return undefined
  }
}
