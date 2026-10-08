/** Lease-scoped browser operations and one main-process event subscription per window. */
import { ipcRenderer } from 'electron'
import type {
  DesktopBrowserAccessibleAction,
  DesktopBrowserAccessibleSnapshot,
  DesktopBrowserBridge,
  DesktopBrowserCanvasInput,
  DesktopBrowserFrame,
  DesktopBrowserLeaseId,
  DesktopBrowserPageState,
  DesktopBrowserRef,
  DesktopBrowserSnapshotId,
  DesktopBrowserTabAutomationHandler,
  DesktopBrowserTabCommand,
  DesktopBrowserViewport,
  SessionId,
  TabId,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { DESKTOP_IPC } from './ipc.ts'

/** @returns browser operations that expose neither IPC nor Electron objects. */
export function createDesktopBrowserBridge(): DesktopBrowserBridge {
  const openListeners = new Map<DesktopBrowserLeaseId, Set<(url: string) => void>>()
  const pageStateListeners = new Map<DesktopBrowserLeaseId, Set<(state: DesktopBrowserPageState) => void>>()
  const frameListeners = new Map<DesktopBrowserLeaseId, Set<(frame: DesktopBrowserFrame) => void>>()
  const accessibleListeners = new Map<DesktopBrowserLeaseId, Set<(snapshot: DesktopBrowserAccessibleSnapshot) => void>>()

  ipcRenderer.on(DESKTOP_IPC.browserOpenRequested, (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('lease' in request) || !('url' in request)
      || typeof request.lease !== 'string' || typeof request.url !== 'string') return
    const callbacks = openListeners.get(request.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    for (const callback of [...callbacks]) {
      try { callback(request.url) }
      catch (error) { console.error('Desktop browser link handler failed', error) }
    }
  })

  ipcRenderer.on(DESKTOP_IPC.browserPageState, (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || !('lease' in payload) || !('state' in payload)
      || typeof payload.lease !== 'string' || typeof payload.state !== 'object' || payload.state === null) return
    const callbacks = pageStateListeners.get(payload.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    const state = payload.state as DesktopBrowserPageState
    for (const callback of [...callbacks]) {
      try { callback(state) }
      catch (error) { console.error('Desktop browser page-state handler failed', error) }
    }
  })

  ipcRenderer.on(DESKTOP_IPC.browserFrame, (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || !('lease' in payload)
      || typeof payload.lease !== 'string') return
    const callbacks = frameListeners.get(payload.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    const frame = payload as DesktopBrowserFrame
    for (const callback of [...callbacks]) {
      try { callback(frame) }
      catch (error) { console.error('Desktop browser frame handler failed', error) }
    }
  })

  ipcRenderer.on(DESKTOP_IPC.browserAccessibleSnapshot, (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || !('lease' in payload)
      || typeof payload.lease !== 'string') return
    const callbacks = accessibleListeners.get(payload.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    const snapshot = payload as DesktopBrowserAccessibleSnapshot
    for (const callback of [...callbacks]) {
      try { callback(snapshot) }
      catch (error) { console.error('Desktop browser accessible snapshot handler failed', error) }
    }
  })

  return {
    acquire(workspace: string, sessionId?: SessionId, tabId?: TabId) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserAcquire, workspace, sessionId, tabId)
    },
    release(lease: DesktopBrowserLeaseId) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserRelease, lease)
    },
    navigate(lease: DesktopBrowserLeaseId, url: string) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserNavigate, lease, url)
    },
    goBack(lease: DesktopBrowserLeaseId) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserGoBack, lease)
    },
    goForward(lease: DesktopBrowserLeaseId) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserGoForward, lease)
    },
    reload(lease: DesktopBrowserLeaseId) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserReload, lease)
    },
    setViewport(lease: DesktopBrowserLeaseId, viewport: DesktopBrowserViewport) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserSetViewport, lease, viewport)
    },
    dispatchInput(lease: DesktopBrowserLeaseId, input: DesktopBrowserCanvasInput) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserDispatchInput, lease, input)
    },
    onPageState(lease: DesktopBrowserLeaseId, listener: (state: DesktopBrowserPageState) => void) {
      let callbacks = pageStateListeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        pageStateListeners.set(lease, callbacks)
      }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && pageStateListeners.get(lease) === callbacks) pageStateListeners.delete(lease)
      }
    },
    onFrame(lease: DesktopBrowserLeaseId, listener: (frame: DesktopBrowserFrame) => void) {
      let callbacks = frameListeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        frameListeners.set(lease, callbacks)
        ipcRenderer.send(DESKTOP_IPC.browserSubscribeFrames, lease)
      }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && frameListeners.get(lease) === callbacks) {
          frameListeners.delete(lease)
          ipcRenderer.send(DESKTOP_IPC.browserUnsubscribeFrames, lease)
        }
      }
    },
    onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void) {
      let callbacks = openListeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        openListeners.set(lease, callbacks)
      }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && openListeners.get(lease) === callbacks) openListeners.delete(lease)
      }
    },
    onAccessibleSnapshot(lease: DesktopBrowserLeaseId, listener: (snapshot: DesktopBrowserAccessibleSnapshot) => void) {
      let callbacks = accessibleListeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        accessibleListeners.set(lease, callbacks)
      }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && accessibleListeners.get(lease) === callbacks) accessibleListeners.delete(lease)
      }
    },
    accessibleAction(
      lease: DesktopBrowserLeaseId,
      snapshotId: DesktopBrowserSnapshotId,
      ref: DesktopBrowserRef,
      action: DesktopBrowserAccessibleAction,
    ) {
      return ipcRenderer.invoke(DESKTOP_IPC.browserAccessibleAction, lease, snapshotId, ref, action)
    },
    onAutomationRequest(handler: DesktopBrowserTabAutomationHandler) {
      const listener = (_event: Electron.IpcRendererEvent, command: DesktopBrowserTabCommand): void => {
        const controller = new AbortController()
        void handler(command, controller.signal)
          .then((result) => {
            ipcRenderer.send(DESKTOP_IPC.browserAutomationReply, { requestId: command.requestId, result })
          })
          .catch((error: unknown) => {
            ipcRenderer.send(DESKTOP_IPC.browserAutomationReply, {
              requestId: command.requestId,
              result: { status: 'error', message: error instanceof Error ? error.message : String(error) },
            })
          })
      }
      ipcRenderer.on(DESKTOP_IPC.browserAutomation, listener)
      return () => {
        ipcRenderer.off(DESKTOP_IPC.browserAutomation, listener)
      }
    },
  }
}
