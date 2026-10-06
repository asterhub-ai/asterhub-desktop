/** Desktop Sidebar Browser capabilities and private Host transport. @module @deepseek-ai/dsh-browser-use-desktop */

export type * from './types.ts'
export { createDesktopBrowserTransport } from './transport.ts'
export type { DesktopBrowserTransportPort } from './transport.ts'
export {
  isDesktopBrowserCancelMessage,
  isDesktopBrowserOperation,
  isDesktopBrowserRequestMessage,
  isDesktopBrowserResultMessage,
} from './protocol.ts'
