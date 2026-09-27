/** The Plugins entry copy: the surface is reserved for the AsterHub plugin system. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  panel: '插件',
  title: '插件',
  placeholder: '插件功能即将上线，敬请期待。',
} as const

/** The locale key union. */
export type PluginManagerLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  panel: 'Plugins',
  title: 'Plugins',
  placeholder: 'The plugin system is coming soon. Stay tuned.',
} as const satisfies Record<PluginManagerLocaleKey, string>
