/** Signed server catalogue and curated installation page in Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CuratedPluginSettingsTab, type CuratedPluginSettingsTabInjected } from './CuratedPluginSettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { CuratedPluginSettingsTabInjected, CuratedPluginSettingsTabProps } from './CuratedPluginSettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Curated plugin catalog settings tab copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager']

/** Contribute the lazy curated catalogue tab to Settings.
 * @param ctx - Client context owning the catalogue RPCs and slots.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const catalog: CuratedPluginSettingsTabInjected['catalog'] = async () => {
    const result = await ctx.remote.pluginManager.curatedCatalog()
    if (!result.ok) throw new Error('curated catalogue is unavailable')
    return result.value
  }
  const install: CuratedPluginSettingsTabInjected['install'] = async (request) => {
    const result = await ctx.remote.pluginManager.installCuratedBundle(request)
    if (!result.ok) throw new Error('curated installation failed')
    return result.value
  }
  const inject = (): CuratedPluginSettingsTabInjected => ({ catalog, install })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'curated',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject,
  }, CuratedPluginSettingsTab))
}
