/** Route Desktop tab commands through the calling Session's retained Sidebar Browser controllers. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightOpenTab } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { DesktopBrowserTabAutomationHandler, DesktopBrowserTabCommandResult } from '../../types.ts'
import type { BrowserControllerState, BrowserInjected } from '../browser/BrowserController.ts'
import { BROWSER_KIND } from '../definition.tsx'

interface BrowserAutomationOptions {
  readonly openTabs: HostObservable<readonly SidebarRightOpenTab[]>
  readonly controllers: ReadonlyMap<SessionId, BrowserInjected>
  readonly sessionControllersChanged: HostObservable<number>
  readonly retainSessionView: (sessionId: SessionId, signal: AbortSignal) => Promise<() => void>
  readonly openTab: (sessionId: SessionId, url: string) => void
  readonly closeTab: (sessionId: SessionId, tabId: TabId) => void
}

interface BrowserTabState {
  readonly record: SidebarRightOpenTab
  readonly state: BrowserControllerState
  readonly controller: BrowserInjected
  readonly snapshot: HostObservable<BrowserControllerState>
}

/**
 * Handle main-issued tab discovery, open and close commands in the request's Session.
 * @param options - Sidebar inventory, Session controllers, and Session-bound tab actions.
 * @returns the correlated renderer command handler.
 */
export function createDesktopBrowserAutomationHandler(options: BrowserAutomationOptions): DesktopBrowserTabAutomationHandler {
  return async (command, signal) => {
    // Electron main is the sole command producer and sends the caller's branded SessionId.
    const sessionId = command.sessionId
    try {
      if (signal.aborted) return failure('Browser command was cancelled')
      switch (command.operation.kind) {
        case 'tabs.list': {
          const tabs = browserTabs(options.openTabs, sessionId)
          const visible = tabs.slice(0, command.operation.limit).map(({ tabId }) => ({
            tabId,
            active: options.controllers.get(sessionId)?.keyedHooks.browserState(tabId)?.getSnapshot().visible ?? false,
          }))
          return { status: 'success', value: { kind: 'tabs', tabs: visible, truncated: tabs.length > command.operation.limit } }
        }
        case 'tabs.open':
          return await openTab(options, sessionId, command.operation.url, command.operation.newTab === true, signal)
        case 'tabs.close': {
          const tabId = command.operation.tabId
          const tab = browserTabs(options.openTabs, sessionId).find(row => row.tabId === tabId)
          if (tab === undefined) return failure('Browser tab is not open in this Session')
          options.closeTab(sessionId, tab.tabId)
          if (browserTabs(options.openTabs, sessionId).some(row => row.tabId === tabId)) {
            return failure('Sidebar did not close the requested Browser tab')
          }
          return { status: 'success', value: { kind: 'closed', tabId: command.operation.tabId, closed: true } }
        }
      }
      const exhaustive: never = command.operation
      throw new Error(`Desktop Browser cannot handle ${String(exhaustive)}`)
    } catch {
      return failure(signal.aborted ? 'Browser command was cancelled' : 'Browser tab operation failed')
    }
  }
}

async function openTab(options: BrowserAutomationOptions, sessionId: SessionId, url: string,
  newTab: boolean, signal: AbortSignal): Promise<DesktopBrowserTabCommandResult> {
  const requested = new URL(url)
  const candidates = liveBrowserTabs(options, sessionId)
  if (!newTab) {
    const exact = choose(candidates.filter((candidate) => {
      const targetUrl = candidate.state.frame.target?.url
      return targetUrl !== undefined && normalizedUrl(targetUrl) === requested.href
    }))
    if (exact !== undefined) return opened(exact.record.tabId, exact.state.visible)

    const sameHost = choose(candidates.filter((candidate) => {
      const targetUrl = candidate.state.frame.target?.url
      return targetUrl !== undefined && new URL(targetUrl).hostname === requested.hostname
    }))
    if (sameHost !== undefined) {
      const beforeRevision = sameHost.snapshot.getSnapshot().addressRevision
      sameHost.controller.loadUrl(sameHost.record.tabId, url)
      const state = await waitForObservedPage(sameHost.snapshot, beforeRevision, signal)
      return opened(sameHost.record.tabId, state.visible)
    }
  }

  const releaseView = await options.retainSessionView(sessionId, signal)
  try {
    const existing = new Set(browserTabs(options.openTabs, sessionId).map(tab => tab.tabId))
    options.openTab(sessionId, url)
    const created = browserTabs(options.openTabs, sessionId).find(tab => !existing.has(tab.tabId))
    if (created === undefined) return failure('Sidebar did not create a Browser tab')
    const snapshot = await waitForBrowserState(options, sessionId, created.tabId, signal)
    const state = await waitForObservedPage(snapshot, -1, signal)
    return opened(created.tabId, state.visible)
  } finally {
    releaseView()
  }
}

function browserTabs(openTabs: HostObservable<readonly SidebarRightOpenTab[]>, sessionId: SessionId): readonly SidebarRightOpenTab[] {
  return openTabs.getSnapshot().filter(tab => tab.sessionId === sessionId && tab.kind === BROWSER_KIND)
}

function liveBrowserTabs(options: BrowserAutomationOptions, sessionId: SessionId): BrowserTabState[] {
  const controller = options.controllers.get(sessionId)
  if (controller === undefined) return []
  return browserTabs(options.openTabs, sessionId).flatMap((record) => {
    const snapshot = controller.keyedHooks.browserState(record.tabId)
    if (snapshot === undefined) return []
    const state = snapshot.getSnapshot()
    if (state.frame.address !== 'observed' || state.frame.loading || state.frame.error !== undefined
      || state.frame.target === undefined) return []
    return [{ record, state, controller, snapshot }]
  })
}

function choose<T extends { readonly state: BrowserControllerState }>(candidates: readonly T[]): T | undefined {
  if (candidates.length === 1) return candidates[0]
  const visible = candidates.filter(candidate => candidate.state.visible)
  return visible.length === 1 ? visible[0] : undefined
}

async function waitForBrowserState(options: BrowserAutomationOptions, sessionId: SessionId, tabId: TabId,
  signal: AbortSignal): Promise<HostObservable<BrowserControllerState>> {
  while (true) {
    if (signal.aborted) throw new Error('Browser command was cancelled')
    const controller = options.controllers.get(sessionId)
    const changes = controller?.controllerChanges ?? options.sessionControllersChanged
    const revision = changes.getSnapshot()
    const state = controller?.keyedHooks.browserState(tabId)
    if (controller !== undefined && state !== undefined) return state
    await waitForChange(changes, revision, signal)
  }
}

function waitForObservedPage(source: HostObservable<BrowserControllerState>, previousRevision: number,
  signal: AbortSignal): Promise<BrowserControllerState> {
  const current = (): BrowserControllerState | undefined => {
    const state = source.getSnapshot()
    if (state.frame.error !== undefined) throw new Error('Browser page navigation failed')
    return state.frame.address === 'observed' && !state.frame.loading && state.frame.target !== undefined
      && state.addressRevision > previousRevision ? state : undefined
  }
  try {
    const initial = current()
    if (initial !== undefined) return Promise.resolve(initial)
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  if (signal.aborted) return Promise.reject(new Error('Browser command was cancelled'))
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => {}
    const finish = (state?: BrowserControllerState, error?: Error): void => {
      if (settled) return
      settled = true
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (state !== undefined) resolve(state)
      else reject(error ?? new Error('Browser command was cancelled'))
    }
    const check = (): void => {
      try {
        const state = current()
        if (state !== undefined) finish(state)
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error('Browser page navigation failed'))
      }
    }
    const abort = (): void => { finish(undefined, new Error('Browser command was cancelled')) }
    unsubscribe = source.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else check()
  })
}

function waitForChange(source: HostObservable<number>, revision: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Browser command was cancelled'))
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => {}
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const check = (): void => { if (source.getSnapshot() !== revision) finish() }
    const abort = (): void => { finish(new Error('Browser command was cancelled')) }
    unsubscribe = source.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else check()
  })
}

function normalizedUrl(value: string): string {
  return new URL(value).href
}

function opened(tabId: TabId, active: boolean): DesktopBrowserTabCommandResult {
  return { status: 'success', value: { kind: 'tab', tabId, active } }
}

function failure(message: string): DesktopBrowserTabCommandResult {
  return { status: 'error', message }
}
