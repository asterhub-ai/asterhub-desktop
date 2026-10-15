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
  restartRequired: '插件已保存，重启 AsterHub 后生效。',
  restartStartup: '插件已保存，当前运行配置需要重启 AsterHub 才能加载。',
  restartPackageMoved: '插件已保存，安装位置或内置依赖发生变化，重启 AsterHub 后生效。',
  restartHostModule: '插件已保存，变更涉及正在运行的主程序模块，重启 AsterHub 后生效。',
  restartUnmanagedPlugin: '插件已保存，变更涉及无法热重载的插件，重启 AsterHub 后生效。',
  restartComparison: '插件已保存，暂时无法确认运行中的代码版本，重启 AsterHub 后生效。',
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
  restartRequired: 'Plugin saved. Restart AsterHub to apply it.',
  restartStartup: 'Plugin saved. This profile loads changes when AsterHub restarts.',
  restartPackageMoved: 'Plugin saved. Its location or a bundled dependency changed. Restart AsterHub to apply it.',
  restartHostModule: 'Plugin saved. The change affects a running host module. Restart AsterHub to apply it.',
  restartUnmanagedPlugin: 'Plugin saved. The change affects a plugin that cannot reload live. Restart AsterHub to apply it.',
  restartComparison: 'Plugin saved. The running code version could not be confirmed. Restart AsterHub to apply it.',
  installing: 'Installing…',
  installFailed: 'Installation did not complete. Try again later.',
  catalogChanged: 'The curated list changed. Review it and try again.',
} satisfies Record<PluginInventoryLocaleKey, string>
