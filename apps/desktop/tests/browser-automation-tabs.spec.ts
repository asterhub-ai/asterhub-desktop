import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { BrowserWindow, WebContents } from 'electron'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DesktopBrowserCaller, DesktopBrowserOwnerGeneration, DesktopBrowserRequestMessage,
  DesktopBrowserTabId, DesktopBrowserTargetGeneration,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import type { DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { DESKTOP_IPC } from '../src/ipc.ts'

const electron = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.hoisted runs before module imports
  const { EventEmitter: EE } = require('node:events')
  const browserSession = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  }
  class MockWindow extends EE {
    webContents: unknown
    options: Record<string, unknown>
    destroyed = false
    size = { width: 800, height: 600 }
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      let url = 'about:blank'
      let title = ''
      const loading = false
      const guest = Object.assign(new EE(), {
        getURL: () => url,
        getTitle: () => title,
        isDestroyed: () => this.destroyed,
        isLoading: () => loading,
        close: vi.fn(() => { this.destroyed = true; queueMicrotask(() => { guest.emit('destroyed') }) }),
        destroy: vi.fn(() => { this.destroyed = true; queueMicrotask(() => { guest.emit('destroyed') }) }),
        loadURL: vi.fn((nextUrl: string) => {
          url = nextUrl
          guest.emit('did-start-navigation', {}, nextUrl, false, true)
          guest.emit('did-finish-load')
          return Promise.resolve()
        }),
        reload: vi.fn(() => {
          guest.emit('did-start-navigation', {}, url, false, true)
          guest.emit('did-finish-load')
        }),
        setWindowOpenHandler: vi.fn(),
        setPage(nextUrl: string, nextTitle: string) { url = nextUrl; title = nextTitle },
        navigationHistory: {
          canGoBack: vi.fn(() => true),
          canGoForward: vi.fn(() => false),
          goBack: vi.fn(),
          goForward: vi.fn(),
        },
        sendInputEvent: vi.fn(),
        insertText: vi.fn(),
      })
      this.webContents = guest
    }
    isDestroyed() { return this.destroyed }
    destroy() {
      this.destroyed = true
      const g = this.webContents as { close: () => void }
      g.close()
      queueMicrotask(() => { this.emit('closed') })
    }
    close() { this.destroy() }
    setSize(w: number, h: number) { this.size = { width: w, height: h } }
    getSize() { return [this.size.width, this.size.height] }
  }
  return {
    app: { isPackaged: true },
    session: { fromPartition: vi.fn(() => browserSession) },
    BrowserWindow: MockWindow,
  }
})
vi.mock('electron', () => electron)
import { DesktopBrowserGuests } from '../src/browser-guests.ts'

const SESSION_A = 'session-a' as SessionId
const SESSION_B = 'session-b' as SessionId
const TAB_A = 'browser-a' as DesktopBrowserTabId
const TAB_B = 'browser-b' as DesktopBrowserTabId

interface GuestContents extends EventEmitter {
  getURL(): string
  getTitle(): string
  isDestroyed(): boolean
  isLoading(): boolean
  close(): void
  loadURL(url: string): void
  reload(): void
  setWindowOpenHandler(handler: unknown): void
  setPage(url: string, title: string): void
  navigationHistory: {
    canGoBack(): boolean
    canGoForward(): boolean
    goBack(): void
    goForward(): void
  }
  sendInputEvent(event: unknown): void
  insertText(text: string): void
}


const releases: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(releases.splice(0).map(release => release())); vi.clearAllMocks() })

function ownerFixture(): { readonly owner: WebContents; readonly window: BrowserWindow; readonly send: ReturnType<typeof vi.fn<WebContents['send']>> } {
  const send = vi.fn<WebContents['send']>()
  const owner: WebContents = Object.assign(Object.create(new EventEmitter()), { isDestroyed: (): boolean => false, send })
  const window: BrowserWindow = Object.assign(Object.create(new EventEmitter()), { webContents: owner })
  return { owner, window, send }
}

function guestFixture(lease: DesktopBrowserLeaseId): GuestContents {
  let url = `about:blank#${lease}`
  let title = ''
  let destroyed = false
  const loading = false
  const guest: GuestContents = Object.assign(new EventEmitter(), {
    getURL: () => url,
    getTitle: () => title,
    isDestroyed: () => destroyed,
    isLoading: () => loading,
    close: vi.fn(() => { destroyed = true; queueMicrotask(() => { guest.emit('destroyed') }) }),
    loadURL: vi.fn((nextUrl: string) => {
      url = nextUrl
      guest.emit('did-start-navigation', {}, nextUrl, false, true)
      guest.emit('did-finish-load')
      return Promise.resolve()
    }),
    reload: vi.fn(() => {
      guest.emit('did-start-navigation', {}, url, false, true)
      guest.emit('did-finish-load')
    }),
    setWindowOpenHandler: vi.fn(),
    setPage(nextUrl: string, nextTitle: string) { url = nextUrl; title = nextTitle },
    navigationHistory: {
      canGoBack: vi.fn(() => true),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    sendInputEvent: vi.fn(),
    insertText: vi.fn(),
  }) as GuestContents
  return guest
}

function mockWindow(options: Record<string, unknown>, guest: GuestContents): BrowserWindow {
  let destroyed = false
  let size = { width: 800, height: 600 }
  const win = Object.assign(new EventEmitter(), {
    webContents: guest,
    options,
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      destroyed = true
      guest.close()
      queueMicrotask(() => { win.emit('closed') })
    }),
    close: vi.fn(() => {
      destroyed = true
      guest.close()
      queueMicrotask(() => { win.emit('closed') })
    }),
    setSize: vi.fn((w: number, h: number) => { size = { width: w, height: h } }),
    getSize: () => [size.width, size.height],
  })
  return win as unknown as BrowserWindow
}


it('intersects correlated renderer tab reports with main-owned Session guests', async () => {
  const registry = new DesktopBrowserGuests(() => undefined)
  const fixture = ownerFixture()
  registry.bind(fixture.window, () => () => {})
  const reservationA = registry.acquire(fixture.owner, 'cwd:/shared', SESSION_A, TAB_A)
  const reservationB = registry.acquire(fixture.owner, 'cwd:/shared', SESSION_B, TAB_B)
  releases.push(() => registry.release(fixture.owner, reservationA.lease), () => registry.release(fixture.owner, reservationB.lease))
  const targetA = { tabId: TAB_A, generation: brandNumber<DesktopBrowserTargetGeneration>(1) }
  const targetB = { tabId: TAB_B, generation: brandNumber<DesktopBrowserTargetGeneration>(1) }
  const guestA = registry.resolveGuest(fixture.owner, SESSION_A, targetA) as unknown as GuestContents
  const guestB = registry.resolveGuest(fixture.owner, SESSION_B, targetB) as unknown as GuestContents
  guestA.setPage('https://a.example/', 'A page')
  guestB.setPage('https://b.example/', 'B page')

  const caller: DesktopBrowserCaller = {
    sessionId: SESSION_A, ownerGeneration: brandNumber<DesktopBrowserOwnerGeneration>(1),
  }
  const request: DesktopBrowserRequestMessage = {
    type: 'browser/request', requestId: 15, caller, operation: { kind: 'tabs.list' },
  }
  const pending = registry.handleBrowserRequest(fixture.owner, request, new AbortController().signal)
  const [channel, command] = fixture.send.mock.calls.at(-1) ?? []
  expect(channel).toBe(DESKTOP_IPC.browserAutomation)
  expect(command).toMatchObject({ sessionId: SESSION_A, operation: { kind: 'tabs.list' } })
  if (typeof command !== 'object' || command === null || !('requestId' in command) || typeof command.requestId !== 'number') {
    throw new Error('expected a correlated renderer command')
  }
  const commandId = command.requestId
  registry.resolveRendererReply(fixture.owner, {
    requestId: commandId,
    result: { status: 'success', value: {
      kind: 'tabs', tabs: [{ tabId: TAB_A, active: true }, { tabId: TAB_B, active: false }], truncated: false,
    } },
  })

  await expect(pending).resolves.toMatchObject({ status: 'success', value: {
    kind: 'tabs', truncated: false, tabs: [{ url: 'https://a.example/', title: 'A page', active: true }],
  } })
})

it('keeps shared-workspace guest targets inside their owning Session and tab', () => {
  const registry = new DesktopBrowserGuests(() => undefined)
  const a = ownerFixture()
  const b = ownerFixture()
  registry.bind(a.window, () => () => {})
  registry.bind(b.window, () => () => {})
  const reservationA = registry.acquire(a.owner, 'cwd:/shared', SESSION_A, TAB_A)
  const reservationB = registry.acquire(b.owner, 'cwd:/shared', SESSION_B, TAB_B)
  releases.push(() => registry.release(a.owner, reservationA.lease), () => registry.release(b.owner, reservationB.lease))
  const targetA = { tabId: TAB_A, generation: brandNumber<DesktopBrowserTargetGeneration>(1) }
  const targetB = { tabId: TAB_B, generation: brandNumber<DesktopBrowserTargetGeneration>(1) }
  const guestA = registry.resolveGuest(a.owner, SESSION_A, targetA) as unknown as GuestContents
  const guestB = registry.resolveGuest(b.owner, SESSION_B, targetB) as unknown as GuestContents
  guestA.setPage('https://a.example/', 'A page')
  guestB.setPage('https://b.example/', 'B page')

  const [tabA] = registry.describeSessionTabs(a.owner, SESSION_A, [{ tabId: TAB_A, active: true }])
  const [tabB] = registry.describeSessionTabs(b.owner, SESSION_B, [{ tabId: TAB_B, active: false }])
  expect(reservationA.partition).toBe(reservationB.partition)
  expect(tabA).toMatchObject({ url: 'https://a.example/', title: 'A page', active: true, ownership: 'user', attached: true })
  expect(tabB).toMatchObject({ url: 'https://b.example/', title: 'B page', active: false, ownership: 'user', attached: true })
  expect(tabA!.target.tabId).not.toBe(tabB!.target.tabId)
  expect(registry.resolveGuest(a.owner, SESSION_A, tabA!.target)).toBe(guestA)
  expect(registry.resolveGuest(a.owner, SESSION_A, tabB!.target)).toBeUndefined()
  expect(registry.resolveGuest(a.owner, SESSION_B, tabB!.target)).toBeUndefined()
  expect(registry.describeSessionTabs(a.owner, SESSION_A, [{ tabId: TAB_B, active: true }])).toEqual([])

  const beforeNavigation = tabA!.target
  guestA.emit('will-frame-navigate', { isMainFrame: true, url: 'https://a.example/next', preventDefault: vi.fn() })
  const [nextA] = registry.describeSessionTabs(a.owner, SESSION_A, [{ tabId: TAB_A, active: true }])
  expect(nextA!.target.generation).not.toBe(beforeNavigation.generation)
  expect(registry.resolveGuest(a.owner, SESSION_A, beforeNavigation)).toBeUndefined()
})

it('release during startup destroys it and settles pending work', async () => {
  const registry = new DesktopBrowserGuests(() => undefined)
  const fixture = ownerFixture()
  registry.bind(fixture.window, () => () => {})
  const reservation = registry.acquire(fixture.owner, 'cwd:/workspace', SESSION_A, TAB_A)
  const target = { tabId: TAB_A, generation: brandNumber<DesktopBrowserTargetGeneration>(1) }
  const guest = registry.resolveGuest(fixture.owner, SESSION_A, target) as unknown as GuestContents
  expect(guest.isDestroyed()).toBe(false)
  await registry.release(fixture.owner, reservation.lease)
  expect(guest.isDestroyed()).toBe(true)
})

it('creates a hidden offscreen BrowserWindow in the workspace partition upon acquire', () => {
  let capturedOptions: Record<string, unknown> | undefined
  const registry = new DesktopBrowserGuests(() => undefined, (opts) => {
    capturedOptions = opts
    return mockWindow(opts, guestFixture('test-lease' as DesktopBrowserLeaseId))
  })
  const fixture = ownerFixture()
  const reservation = registry.acquire(fixture.owner, 'cwd:/workspace', SESSION_A, TAB_A)
  expect(capturedOptions).toMatchObject({
    show: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: true,
      devTools: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      partition: reservation.partition,
    },
  })
})

it('forwards navigation, history, viewport, and input operations to the offscreen guest', async () => {
  let createdGuest!: GuestContents
  const registry = new DesktopBrowserGuests(() => undefined, (opts) => {
    const guest = guestFixture('test-lease' as DesktopBrowserLeaseId)
    createdGuest = guest
    return mockWindow(opts, guest)
  })
  const fixture = ownerFixture()
  const reservation = registry.acquire(fixture.owner, 'cwd:/workspace', SESSION_A, TAB_A)
  releases.push(() => registry.release(fixture.owner, reservation.lease))

  await registry.navigate(fixture.owner, reservation.lease, 'https://example.com/page')
  expect(createdGuest.loadURL).toHaveBeenCalledWith('https://example.com/page')

  await registry.goBack(fixture.owner, reservation.lease)
  expect(createdGuest.navigationHistory.goBack).toHaveBeenCalledOnce()

  await registry.setViewport(fixture.owner, reservation.lease, { cssWidth: 1024, cssHeight: 768 })
  await registry.dispatchInput(fixture.owner, reservation.lease, {
    kind: 'pointer', type: 'down', x: 50, y: 100, button: 'left',
  })
  expect(createdGuest.sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown', x: 50, y: 100 }))

  await registry.dispatchInput(fixture.owner, reservation.lease, { kind: 'text', text: 'query' })
  expect(createdGuest.insertText).toHaveBeenCalledWith('query')
})

it('forwards frames, coalesces rapid paints, and rejects frames over 32 MiB', async () => {
  let createdGuest!: GuestContents
  const registry = new DesktopBrowserGuests(() => undefined, (opts) => {
    const guest = guestFixture('test-lease' as DesktopBrowserLeaseId)
    createdGuest = guest
    return mockWindow(opts, guest)
  })
  const fixture = ownerFixture()
  const reservation = registry.acquire(fixture.owner, 'cwd:/workspace', SESSION_A, TAB_A)
  releases.push(() => registry.release(fixture.owner, reservation.lease))

  registry.subscribeFrames(fixture.owner, reservation.lease)

  const smallImage = {
    toPNG: () => Buffer.from([1, 2, 3]),
    getSize: () => ({ width: 800, height: 600 }),
  }
  createdGuest.emit('paint', {}, {}, smallImage)
  const [, frame] = fixture.send.mock.calls.find(([ch]) => ch === DESKTOP_IPC.browserFrame) ?? []
  expect(frame).toMatchObject({
    lease: reservation.lease,
    sequence: 1,
    png: new Uint8Array([1, 2, 3]),
    pixelSize: { width: 800, height: 600 },
  })

  fixture.send.mockClear()
  const hugeImage = {
    toPNG: () => Buffer.alloc(32 * 1024 * 1024 + 1),
    getSize: () => ({ width: 800, height: 600 }),
  }
  createdGuest.emit('paint', {}, {}, hugeImage)
  expect(fixture.send).not.toHaveBeenCalledWith(DESKTOP_IPC.browserFrame, expect.anything())
})
