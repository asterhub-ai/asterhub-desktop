import type {
  DesktopBrowserCaller,
  DesktopBrowserOperation,
  DesktopBrowserRequestHandler,
  DesktopBrowserResult,
  DesktopBrowserTarget,
} from '@deepseek-ai/dsh-browser-use-desktop/types'

export {
  isDesktopBrowserCancelMessage,
  isDesktopBrowserRequestMessage,
  isDesktopBrowserResultMessage,
} from '@deepseek-ai/dsh-browser-use-desktop/protocol'
export type {
  DesktopBrowserCancelMessage,
  DesktopBrowserErrorCode,
  DesktopBrowserRequestHandler,
  DesktopBrowserRequestMessage,
  DesktopBrowserResult,
} from '@deepseek-ai/dsh-browser-use-desktop/types'

/** Main-to-renderer command for one verified Session browser operation. */
export interface DesktopBrowserAutomationCommand {
  readonly requestId: number
  readonly caller: DesktopBrowserCaller
  readonly operation: DesktopBrowserOperation
}

/** Renderer-to-main terminal outcome for a browser operation. */
export interface DesktopBrowserAutomationReply {
  readonly requestId: number
  readonly result: DesktopBrowserResult
}

/** The exact live target accepted by the Sidebar Browser coordinator. */
export type DesktopBrowserAutomationTarget = DesktopBrowserTarget

/** Renderer callback shape installed by the Desktop main process. */
export type DesktopBrowserAutomationHandler = DesktopBrowserRequestHandler
