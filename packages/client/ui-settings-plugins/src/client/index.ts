/**
 * The Plugins settings entry, browser half. The upstream built-in-plugin
 * configuration UI is intentionally not part of this fork — the entry stays
 * and the surface is reserved for the AsterHub plugin system. The
 * `settings.plugins.tab` child declaration keeps the slot contract available
 * for that system to grow into.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
// Re-exported (not a bare `import type {}`) so the dts bundler keeps the
// plugin-manager's SlotMap augmentation in this package's published types.
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
export type { PluginConfigViewProps }
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { PluginsSettingsSection } from './PluginsSettingsSection.tsx'
import { en, zh, type PluginsSettingsLocaleKey } from './locales.ts'

export type { PluginsSettingsSectionProps } from './PluginsSettingsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins settings entry copy. */
    'settings.plugins': PluginsSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Mount the Plugins settings entry with the reserved surface it renders.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugins: section dictionaries')

  // Ordered after Models: the reserved surface grows into the AsterHub plugin
  // system. The child declaration keeps the tab slot contract available.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, PluginsSettingsSection))
}
