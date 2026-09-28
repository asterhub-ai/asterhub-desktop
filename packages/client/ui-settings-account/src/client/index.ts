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
import { UsageSection } from './UsageSection.tsx'
import type { AccountSectionActions, AccountUsageActions } from './account-api.ts'
import { ACCOUNT_COMMAND_EVENT } from './account-api.ts'
import { AccountGate } from './AccountGate.tsx'
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
export const inject = ['slots', 'locale', 'remote', 'remote.accountSub2api']

/**
 * Mount the Account section: the settings entry that owns login state,
 * quota, and the top-up actions.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-account: dictionaries')
  const t = ctx.locale.bind(NS)

  // Keep the Remote in this plugin instance and resolve it when an action runs.
  // Only narrow callbacks cross the slot boundary; the components never receive
  // the Client Remote service or shared module state.
  const accountSectionActions: AccountSectionActions = {
    getStatus: () => ctx.remote.accountSub2api.getStatus(),
    login: input => ctx.remote.accountSub2api.login(input),
    logout: () => ctx.remote.accountSub2api.logout(),
    quota: () => ctx.remote.accountSub2api.quota(),
    paymentMethods: () => ctx.remote.accountSub2api.paymentMethods(),
    topUp: input => ctx.remote.accountSub2api.topUp(input),
    redeem: input => ctx.remote.accountSub2api.redeem(input),
  }
  const accountUsageActions: AccountUsageActions = {
    usage: () => ctx.remote.accountSub2api.usage(),
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 10,
    label: () => t('nav'),
    locale: NS,
    inject: () => accountSectionActions,
  }, AccountSection))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account-usage',
    order: 20,
    label: () => t('usageNav'),
    locale: NS,
    inject: () => accountUsageActions,
  }, UsageSection))

  ctx.slots.inject('shell.overlay' as never, () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'account-gate',
    order: 0,
    locale: NS,
    inject: () => accountSectionActions,
  } as never, AccountGate))

  const desktop = (globalThis as typeof globalThis & {
    dshDesktop?: {
      account?: {
        subscribeCommand(listener: (command: 'open' | 'logout') => void): () => void
      }
    }
  }).dshDesktop
  ctx.effect(() => {
    const dispose = desktop?.account?.subscribeCommand((command) => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_COMMAND_EVENT, { detail: command }))
    })
    return () => { dispose?.() }
  }, 'ui-settings-account: application menu')
}
