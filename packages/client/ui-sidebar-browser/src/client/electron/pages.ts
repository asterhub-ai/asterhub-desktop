/** Assemble Electron offscreen navigation and canvas presentation behind BrowserPage. */
import type { DesktopBrowserBridge, SessionId } from '../../types.ts'
import type { BrowserPage, BrowserPageOptions } from '../browser/BrowserPage.ts'
import { OffscreenBrowserImpl } from './OffscreenBrowserImpl.ts'
import { OffscreenCanvasPresentation } from './OffscreenCanvasPresentation.ts'

/**
 * Assemble an idle Electron provider; offscreen guest creation waits for mounting and navigation.
 * @param options - checkpoint, tabId, and source-tab callbacks.
 * @param bridge - desktop-only transport.
 * @param workspace - storage account resolver.
 * @param sessionId - optional requesting Session.
 * @returns separate navigation and presentation faces.
 */
export function createElectronPage(
  options: BrowserPageOptions,
  bridge: DesktopBrowserBridge,
  workspace: (signal: AbortSignal) => Promise<string>,
  sessionId?: SessionId,
): BrowserPage {
  const presentation = new OffscreenCanvasPresentation({
    mounted: (canvas, viewport) => {
      frame.attach(canvas, viewport)
    },
    resized: (viewport) => {
      frame.resize(viewport)
    },
    unmounted: () => {
      frame.detach()
    },
  })
  const frame = new OffscreenBrowserImpl(options, bridge, workspace, presentation, sessionId)
  return { frame, presentation }
}
