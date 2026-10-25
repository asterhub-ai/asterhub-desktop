import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightOpenTab } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { emptyBrowserFrame } from '../src/client/browser/BrowserFrame.ts'
import type { BrowserControllerState, BrowserInjected } from '../src/client/browser/BrowserController.ts'
import type { DesktopBrowserTabCommand } from '../src/types.ts'
import { createDesktopBrowserAutomationHandler } from '../src/client/electron/automation.ts'

const SESSION_A = 'session-a' as SessionId
const SESSION_B = 'session-b' as SessionId
const TAB_A = 'browser-a' as TabId
const TAB_B = 'browser-b' as TabId

function browserState(url: string, title: string, visible: boolean): BrowserControllerState {
  return {
    frame: { ...emptyBrowserFrame(), target: { kind: 'https', url, title }, address: 'observed', loading: false },
    visible,
    restoreTarget: undefined,
    addressFailure: undefined,
    addressRevision: 1,
  }
}

function injected(tabId: TabId, state: BrowserControllerState): BrowserInjected {
  const view = createSnapshotStore(state)
  return {
    keyedHooks: { browserState: key => key === tabId ? view : undefined },
    controllerChanges: createSnapshotStore(0),
    mount: () => () => {},
    dispose: async () => {},
    rebind: () => {},
    loadUrl: vi.fn(),
    restore: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    setVisible: vi.fn(),
    setSandbox: vi.fn(),
  }
}

describe('Desktop Browser Sidebar coordinator', () => {
  it('lists only the requesting Session tabs with their actual visibility', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([
      { sessionId: SESSION_A, tabId: TAB_A, kind: 'browser', contentId: 'sidebar://browser/a' },
      { sessionId: SESSION_B, tabId: TAB_B, kind: 'browser', contentId: 'sidebar://browser/b' },
    ])
    const controllers = new Map<SessionId, BrowserInjected>([
      [SESSION_A, injected(TAB_A, browserState('https://a.example/', 'A page', true))],
      [SESSION_B, injected(TAB_B, browserState('https://b.example/', 'B page', false))],
    ])
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged: createSnapshotStore(0),
      retainSessionView: async () => () => {},
      whenSessionAdopted: async () => {},
      openTab: vi.fn(),
      closeTab: vi.fn(),
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 1, sessionId: SESSION_A, operation: { kind: 'tabs.list', limit: 256 },
    }

    await expect(handler(command, new AbortController().signal)).resolves.toEqual({
      status: 'success',
      value: { kind: 'tabs', tabs: [{ tabId: TAB_A, active: true }], truncated: false },
    })
  })

  it('opens a Browser tab in a background Session only after its store is adopted', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([])
    const controllers = new Map<SessionId, BrowserInjected>()
    const sessionControllersChanged = createSnapshotStore(0)
    let adopt = (): void => {}
    const adopted = new Promise<void>((resolve) => { adopt = resolve })
    const retained = vi.fn(async () => () => {})
    const whenSessionAdopted = vi.fn(() => adopted)
    const openTab = vi.fn((sessionId: SessionId, url: string) => {
      openTabs.set([{ sessionId, tabId: TAB_A, kind: 'browser', contentId: 'sidebar://browser/a' }])
      controllers.set(sessionId, injected(TAB_A, browserState(url, 'Opened page', false)))
      sessionControllersChanged.set(sessionControllersChanged.getSnapshot() + 1)
    })
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged,
      retainSessionView: retained,
      whenSessionAdopted,
      openTab,
      closeTab: vi.fn(),
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 1,
      sessionId: SESSION_A,
      operation: { kind: 'tabs.open', url: 'https://background.example/', newTab: true },
    }

    const result = handler(command, new AbortController().signal)
    await vi.waitFor(() => { expect(retained).toHaveBeenCalledOnce() })
    expect(whenSessionAdopted).toHaveBeenCalledWith(SESSION_A, expect.any(AbortSignal))
    expect(openTab).not.toHaveBeenCalled()

    adopt()
    await expect(result).resolves.toEqual({
      status: 'success',
      value: { kind: 'tab', tabId: TAB_A, active: false },
    })
    expect(openTab).toHaveBeenCalledExactlyOnceWith(SESSION_A, 'https://background.example/')
  })

  it('closes a Browser tab in a background Session only after its store is adopted', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([
      { sessionId: SESSION_A, tabId: TAB_A, kind: 'browser', contentId: 'sidebar://browser/a' },
    ])
    const controllers = new Map<SessionId, BrowserInjected>()
    let adopt = (): void => {}
    const adopted = new Promise<void>((resolve) => { adopt = resolve })
    const release = vi.fn()
    const retained = vi.fn(async () => release)
    const whenSessionAdopted = vi.fn(() => adopted)
    let isAdopted = false
    const closeTab = vi.fn((sessionId: SessionId, tabId: TabId) => {
      if (!isAdopted) return
      openTabs.set(openTabs.getSnapshot().filter(tab => tab.sessionId !== sessionId || tab.tabId !== tabId))
    })
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged: createSnapshotStore(0),
      retainSessionView: retained,
      whenSessionAdopted,
      openTab: vi.fn(),
      closeTab,
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 1,
      sessionId: SESSION_A,
      operation: { kind: 'tabs.close', tabId: TAB_A },
    }

    const result = handler(command, new AbortController().signal)
    await vi.waitFor(() => { expect(retained).toHaveBeenCalledOnce() })
    expect(whenSessionAdopted).toHaveBeenCalledWith(SESSION_A, expect.any(AbortSignal))
    expect(closeTab).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()

    isAdopted = true
    adopt()
    await expect(result).resolves.toEqual({
      status: 'success',
      value: { kind: 'closed', tabId: TAB_A, closed: true },
    })
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(SESSION_A, TAB_A)
    expect(release).toHaveBeenCalledOnce()
  })

  it('cleans up the retained view and reports cancellation when close is aborted during adoption', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([
      { sessionId: SESSION_A, tabId: TAB_A, kind: 'browser', contentId: 'sidebar://browser/a' },
    ])
    const controllers = new Map<SessionId, BrowserInjected>()
    const release = vi.fn()
    const retained = vi.fn(async () => release)
    const abortController = new AbortController()
    const whenSessionAdopted = vi.fn((_sessionId: SessionId, signal: AbortSignal) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('Sidebar Session adoption was cancelled')) })
    }))
    const closeTab = vi.fn()
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged: createSnapshotStore(0),
      retainSessionView: retained,
      whenSessionAdopted,
      openTab: vi.fn(),
      closeTab,
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 1,
      sessionId: SESSION_A,
      operation: { kind: 'tabs.close', tabId: TAB_A },
    }

    const result = handler(command, abortController.signal)
    await vi.waitFor(() => { expect(retained).toHaveBeenCalledOnce() })
    expect(whenSessionAdopted).toHaveBeenCalledWith(SESSION_A, expect.any(AbortSignal))

    abortController.abort()
    await expect(result).resolves.toEqual({
      status: 'error',
      message: 'Browser command was cancelled',
    })
    expect(closeTab).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects closing an unknown tab without retaining a view or waiting for adoption', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([])
    const controllers = new Map<SessionId, BrowserInjected>()
    const retained = vi.fn(async () => () => {})
    const whenSessionAdopted = vi.fn(async () => {})
    const closeTab = vi.fn()
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged: createSnapshotStore(0),
      retainSessionView: retained,
      whenSessionAdopted,
      openTab: vi.fn(),
      closeTab,
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 1,
      sessionId: SESSION_A,
      operation: { kind: 'tabs.close', tabId: TAB_A },
    }

    await expect(handler(command, new AbortController().signal)).resolves.toEqual({
      status: 'error',
      message: 'Browser tab is not open in this Session',
    })
    expect(retained).not.toHaveBeenCalled()
    expect(whenSessionAdopted).not.toHaveBeenCalled()
    expect(closeTab).not.toHaveBeenCalled()
  })

  it('safely reports stage distinction when openTab receives a schemeless URL', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([])
    const controllers = new Map<SessionId, BrowserInjected>()
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged: createSnapshotStore(0),
      retainSessionView: async () => () => {},
      whenSessionAdopted: async () => {},
      openTab: vi.fn(),
      closeTab: vi.fn(),
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 102,
      sessionId: SESSION_A,
      operation: { kind: 'tabs.open', url: 'example.com', newTab: true },
    }
    const result = await handler(command, new AbortController().signal)
    expect(result).toEqual({
      status: 'error',
      message: 'Browser tab operation failed: invalid URL "example.com"',
    })
  })

  it('safely reports stage distinction when page navigation encounters a load failure', async () => {
    const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([])
    const stateStore = createSnapshotStore<BrowserControllerState>({
      frame: { ...emptyBrowserFrame(), address: 'observed', loading: false, error: { code: -105, description: 'ERR_NAME_NOT_RESOLVED' } },
      visible: true,
      restoreTarget: undefined,
      addressFailure: undefined,
      addressRevision: 2,
    })
    const baseInjected = injected(TAB_A, stateStore.getSnapshot())
    const controllers = new Map<SessionId, BrowserInjected>([
      [SESSION_A, {
        ...baseInjected,
        keyedHooks: { browserState: key => (key === TAB_A ? stateStore : undefined) },
      }],
    ])
    const handler = createDesktopBrowserAutomationHandler({
      openTabs,
      controllers,
      sessionControllersChanged: createSnapshotStore(0),
      retainSessionView: async () => () => {},
      whenSessionAdopted: async () => {},
      openTab: vi.fn(() => {
        openTabs.set([{ sessionId: SESSION_A, tabId: TAB_A, kind: 'browser', contentId: 'sidebar://browser/smoke' }])
      }),
      closeTab: vi.fn(),
    })
    const command: DesktopBrowserTabCommand = {
      requestId: 103,
      sessionId: SESSION_A,
      operation: { kind: 'tabs.open', url: 'https://example.com/', newTab: false },
    }
    const result = await handler(command, new AbortController().signal)
    expect(result).toEqual({
      status: 'error',
      message: 'Browser page navigation failed: ERR_NAME_NOT_RESOLVED',
    })
  })
})
