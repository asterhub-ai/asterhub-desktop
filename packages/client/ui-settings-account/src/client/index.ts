/**
 * The Account settings entry, browser half: replaces the upstream Models
 * section. Login is sub2api-backed; the Host service provisions the model key
 * this installation uses, so the surface shows account state instead of
 * provider plumbing.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge (the account remote namespace).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AccountSection } from './AccountSection.tsx'
import { AccountMenuButton } from './AccountMenuButton.tsx'
import { setAccountApiResolver } from './account-api.ts'
import { en, zh, type AccountLocaleKey } from './locales.ts'

export type { AccountSectionProps } from './AccountSection.tsx'
export type { AccountLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account entry copy. */
    'settings.account': AccountLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.account'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote']

/**
 * Mount the Account section: the settings entry that owns login state,
 * quota, and the top-up actions.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-account: dictionaries')
  const t = ctx.locale.bind(NS)

  // Capture the account Remote once; components read it through the shared
  // module handle, so a not-yet-mounted namespace degrades to a quiet
  // "service unavailable" state instead of crashing the slot outlet.
  setAccountApiResolver(() => ctx.remote.accountSub2api)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 10,
    label: () => t('nav'),
    locale: NS,
  }, AccountSection))

  // The top-left account menu on the sidebar brand row. The seat is declared
  // by ui-sidebar's contract; the cross-package project reference is not
  // wired into this package's tsconfig yet, so the slot names are asserted
  // here and type-checked against the sidebar contract by review.
  ctx.slots.inject('sidebar.brand.trailing' as never, () => ctx.slots.register({
    name: 'sidebar.brand.trailing',
    locale: NS,
  } as never, AccountMenuButton))
}
