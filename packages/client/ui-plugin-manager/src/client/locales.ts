/** Curated plugin catalogue copy. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  panel: '插件',
  title: '插件',
  loading: '正在读取精选插件…',
  unavailable: '精选插件暂时不可用，请稍后重试。',
  empty: '精选列表暂时为空。',
  installed: '已安装',
  install: '安装',
  installing: '正在安装…',
  installFailed: '安装未完成，请检查权限或在对话中处理依赖脚本审批。',
  catalogChanged: '精选列表已更新，请核对新版本后再次点击安装。',
  installedVersion: '版本',
} as const

/** The locale key union. */
export type PluginManagerLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  panel: 'Plugins',
  title: 'Plugins',
  loading: 'Loading curated plugins…',
  unavailable: 'Curated plugins are temporarily unavailable. Try again later.',
  empty: 'The curated list is empty for now.',
  installed: 'Installed',
  install: 'Install',
  installing: 'Installing…',
  installFailed: 'Installation did not complete. Check permissions or handle dependency script approval in chat.',
  catalogChanged: 'The curated list changed. Review the new version and click Install again.',
  installedVersion: 'Version',
} as const satisfies Record<PluginManagerLocaleKey, string>
