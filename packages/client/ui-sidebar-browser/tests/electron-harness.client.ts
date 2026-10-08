/** Offscreen browser events controlled by each test; canvas presentation and navigation stay real. */
import { vi } from 'vitest'
import type {
  DesktopBrowserBridge,
  DesktopBrowserCanvasInput,
  DesktopBrowserFrame,
  DesktopBrowserLeaseId,
  DesktopBrowserPageState,
  DesktopBrowserReservation,
  DesktopBrowserViewport,
} from '../src/types.ts'
import type { BrowserTabState } from '../src/client/browser/BrowserPersistence.ts'
import { createElectronPage } from '../src/client/electron/pages.ts'
import { OffscreenCanvasPresentation } from '../src/client/electron/OffscreenCanvasPresentation.ts'

let sequence = 0

/** @returns one isolated, explicitly mounted page with offscreen operations replaced by spies. */
export function electronFixture(initial?: BrowserTabState) {
  const opens = new Set<(url: string) => void>()
  const pageStateListeners = new Set<(state: DesktopBrowserPageState) => void>()
  const frameListeners = new Set<(frame: DesktopBrowserFrame) => void>()
  const reservation: DesktopBrowserReservation = {
    lease: `lease-${++sequence}` as DesktopBrowserLeaseId,
    partition: 'partition',
  }

  const bridge = {
    acquire: vi.fn(async (_workspace: string) => reservation),
    release: vi.fn(async (_lease: DesktopBrowserLeaseId) => {}),
    navigate: vi.fn(async (_lease: DesktopBrowserLeaseId, _url: string) => {}),
    goBack: vi.fn(async (_lease: DesktopBrowserLeaseId) => {}),
    goForward: vi.fn(async (_lease: DesktopBrowserLeaseId) => {}),
    reload: vi.fn(async (_lease: DesktopBrowserLeaseId) => {}),
    setViewport: vi.fn(async (_lease: DesktopBrowserLeaseId, _vp: DesktopBrowserViewport) => {}),
    dispatchInput: vi.fn(async (_lease: DesktopBrowserLeaseId, _input: DesktopBrowserCanvasInput) => {}),
    onOpenRequested: vi.fn((_lease: DesktopBrowserLeaseId, listener: (url: string) => void) => {
      opens.add(listener)
      return () => { opens.delete(listener) }
    }),
    onPageState: vi.fn((_lease: DesktopBrowserLeaseId, listener: (state: DesktopBrowserPageState) => void) => {
      pageStateListeners.add(listener)
      return () => { pageStateListeners.delete(listener) }
    }),
    onFrame: vi.fn((_lease: DesktopBrowserLeaseId, listener: (frame: DesktopBrowserFrame) => void) => {
      frameListeners.add(listener)
      return () => { frameListeners.delete(listener) }
    }),
  } satisfies DesktopBrowserBridge

  const workspace = vi.fn(async (_signal: AbortSignal) => 'cwd:/workspace')
  const persist = vi.fn()
  const openRequested = vi.fn()
  const page = createElectronPage({ initial, persist, openRequested }, bridge, workspace)
  const presentation = page.presentation
  if (!(presentation instanceof OffscreenCanvasPresentation)) throw new Error('expected the Offscreen presentation')

  const host = document.createElement('div')
  host.id = `electron-fixture-${sequence}`
  document.body.append(host)

  const emitPageState = (state: DesktopBrowserPageState): void => {
    for (const listener of [...pageStateListeners]) listener(state)
  }

  const emitFrame = (frame: DesktopBrowserFrame): void => {
    for (const listener of [...frameListeners]) listener(frame)
  }

  return {
    ...page,
    presentation,
    bridge,
    workspace,
    persist,
    openRequested,
    opens,
    pageStateListeners,
    frameListeners,
    emitPageState,
    emitFrame,
    host,
    reservation,
    mount: () => presentation.mount(host.id),
    canvas: () => host.querySelector('canvas'),
    async dispose() {
      await page.frame.dispose()
      host.remove()
    },
  }
}
