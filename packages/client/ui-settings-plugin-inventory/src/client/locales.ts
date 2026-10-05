/** Copy dictionaries for the curated plugin catalog Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '精选插件',
  curatedTitle: 'AsterHub 精选插件',
  loading: '正在读取精选插件…',
  error: '暂时无法读取插件。',
  retry: '重试',
  empty: '暂无精选插件。',
  installedVersion: '版本',
  install: '安装',
  installed: '已安装',
  installing: '正在安装…',
  installFailed: '安装未完成，请稍后重试。',
  catalogChanged: '精选列表已更新，请核对后重试。',
} satisfies Record<string, string>

/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Curated plugins',
  curatedTitle: 'AsterHub curated plugins',
  loading: 'Reading curated plugins…',
  error: 'Plugins are temporarily unavailable.',
  retry: 'Retry',
  empty: 'No curated plugins are available.',
  installedVersion: 'Version',
  install: 'Install',
  installed: 'Installed',
  installing: 'Installing…',
  installFailed: 'Installation did not complete. Try again later.',
  catalogChanged: 'The curated list changed. Review it and try again.',
} satisfies Record<PluginInventoryLocaleKey, string>
