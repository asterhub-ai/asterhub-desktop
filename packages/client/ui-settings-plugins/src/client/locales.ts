/** Locale bundles for the curated plugins settings section.
 * AsterHub fork copy: the section hosts the curated catalogue tab; strings
 * restored from the pre-merge layout. */

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

/** Japanese copy, checked against the English keys. */
export const ja = {
  'nav': '厳選プラグイン',
  'title': 'AsterHub 厳選プラグイン',
  'intro': 'AsterHub が厳選したプラグインを閲覧・インストールします。',
  'tabs': 'プラグインビュー',
  'empty': 'このデプロイメントにはプラグインビューがありません。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  nav: 'Plugins seleccionados',
  title: 'Plugins seleccionados de AsterHub',
  intro: 'Explora e instala plugins seleccionados para AsterHub.',
  tabs: 'Vistas de complementos',
  empty: 'Esta implementación no expone vistas de complementos.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  nav: 'Plugins sélectionnés',
  title: 'Plugins sélectionnés AsterHub',
  intro: 'Parcourez et installez les plugins sélectionnés pour AsterHub.',
  tabs: 'Vues des plugins',
  empty: "Ce déploiement n'expose aucune vue de plugin.",
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  nav: 'Ausgewählte Plugins',
  title: 'AsterHub ausgewählte Plugins',
  intro: 'Durchsuchen und installieren Sie die für AsterHub ausgewählten Plugins.',
  tabs: 'Plugin-Ansichten',
  empty: 'Diese Bereitstellung stellt keine Plugin-Ansichten bereit.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  nav: 'Отобранные плагины',
  title: 'Отобранные плагины AsterHub',
  intro: 'Просматривайте и устанавливайте плагины, отобранные для AsterHub.',
  tabs: 'Просмотры плагинов',
  empty: 'Это развертывание не предоставляет никаких представлений плагинов.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  nav: 'Plugins selecionados',
  title: 'Plugins selecionados do AsterHub',
  intro: 'Navegue e instale plugins selecionados para o AsterHub.',
  tabs: 'Visualizações de plug-in',
  empty: 'Esta implantação não expõe visualizações de plug-ins.',
} satisfies Record<keyof typeof en, string>
