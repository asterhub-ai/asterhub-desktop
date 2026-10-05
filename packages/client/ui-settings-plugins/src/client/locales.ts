/** Locale bundles for the curated plugins settings section. */

/** Locale keys the section renders. */
export type PluginsSettingsLocaleKey = 'nav' | 'title' | 'intro' | 'tabs' | 'empty'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Curated plugins',
  title: 'AsterHub curated plugins',
  intro: 'Browse and install plugins selected for AsterHub.',
  tabs: 'Plugin views',
  empty: 'This deployment exposes no plugin views.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '精选插件',
  title: 'AsterHub 精选插件',
  intro: '浏览并安装服务端精选的插件。',
  tabs: '插件视图',
  empty: '本部署没有开放任何插件视图。',
}
