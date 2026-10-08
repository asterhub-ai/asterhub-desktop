/** Desktop Sidebar Browser capabilities and private Host transport. @module @deepseek-ai/dsh-browser-use-desktop */

import { Config, apply, inject, name, validateConfig } from './provider.ts'

export type * from './types.ts'
export { createDesktopBrowserTransport } from './transport.ts'
export type { DesktopBrowserTransportPort } from './transport.ts'
export {
  isDesktopBrowserCancelMessage,
  isDesktopBrowserOperation,
  isDesktopBrowserRequestMessage,
  isDesktopBrowserResultMessage,
  MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES,
  MAX_DESKTOP_BROWSER_TABS,
  MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS,
} from './protocol.ts'
export {
  createDesktopBrowserTools,
  AgentOwnerTracker,
  SessionOperationQueue,
  assertImageCapableRoute,
  type DesktopBrowserToolConfig,
} from './tools.ts'
export { createDesktopSkillProvider } from './skills.ts'
export {
  name,
  inject,
  Config,
  apply,
  validateConfig,
}
export default {
  name,
  inject,
  Config,
  apply,
}
