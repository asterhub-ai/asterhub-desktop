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
})
