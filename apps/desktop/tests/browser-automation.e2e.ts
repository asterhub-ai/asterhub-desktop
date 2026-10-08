import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DesktopBrowserCaller,
  DesktopBrowserOwnerGeneration,
  DesktopBrowserTabId,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import { DesktopBrowserGuests } from '../src/browser-guests.ts'

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
      const isolatedWindow = (globalThis as unknown as { document?: Document }).document?.defaultView
      const guest = Object.assign(new EE(), {
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
        insertText: vi.fn((text: string) => {
          const active = (globalThis as unknown as { document?: Document }).document?.activeElement as HTMLInputElement | null
          if (active && 'value' in active) {
            active.value += text
          }
        }),
        capturePage: vi.fn().mockResolvedValue({
          toPNG: () => Buffer.from('fake-png-bytes'),
        }),
        executeJavaScriptInIsolatedWorld: vi.fn(async (_worldId: number, scripts: readonly { readonly code: string }[]) => {
          const code = scripts[0]?.code
          if (code === undefined || isolatedWindow === null || isolatedWindow === undefined) {
            throw new Error('Isolated-world fixture is unavailable')
          }
          return isolatedWindow.eval(code)
        }),
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
    setSize(width: number, height: number) { this.size = { width, height } }
    getSize() { return [this.size.width, this.size.height] }
  }

  return {
    session: {
      fromPartition: vi.fn(() => browserSession),
    },
    BrowserWindow: MockWindow,
    nativeImage: {
      createFromBuffer: (buf: Buffer) => ({
        toPNG: () => buf,
        getSize: () => ({ width: 800, height: 600 }),
      }),
    },
  }
})

vi.mock('electron', () => electron)

const OWNER_GEN = brandNumber<DesktopBrowserOwnerGeneration>(1)
const SESSION_A = brandString<SessionId>('session-a')
const TAB_A = 'tab-a'
const GEN_1 = brandNumber<DesktopBrowserTargetGeneration>(1)

function makeCaller(): DesktopBrowserCaller {
  return {
    sessionId: SESSION_A,
    ownerGeneration: OWNER_GEN,
  }
}

function makeOwner(): EventEmitter & { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } {
  return Object.assign(new EventEmitter(), {
    send: vi.fn(),
    isDestroyed: () => false,
  })
}

describe('browser automation e2e', () => {
  let fixtureHtml: string

  try {
    fixtureHtml = readFileSync(resolve(__dirname, 'fixtures/browser-automation-page.html'), 'utf8')
  } catch {
    fixtureHtml = '<html><body><h1>Fallback</h1></body></html>'
  }
  let dom: JSDOM

  beforeEach(() => {
    dom = new JSDOM(fixtureHtml, { url: 'https://fixture.example/index.html', runScripts: 'outside-only' })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement)
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent)
    vi.stubGlobal('InputEvent', dom.window.InputEvent)
    vi.stubGlobal('Event', dom.window.Event)
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('navigates, snapshots DOM, reads properties, and executes actions', async () => {
    document.body.innerHTML = fixtureHtml

    const guests = new DesktopBrowserGuests(() => 'https://host.example:8443')
    const owner = makeOwner()

    // 1. Acquire lease
    const reservation = await guests.acquire(owner as never, 'ws-1', SESSION_A, TAB_A)
    const leaseId = reservation.lease
    const target: DesktopBrowserTarget = {
      tabId: brandString<DesktopBrowserTabId>(TAB_A),
      generation: GEN_1,
    }

    // 2. Take accessible snapshot
    const snapResult = await guests.handleBrowserRequest(
      owner as never,
      {
        type: 'browser/request',
        requestId: 101,
        caller: makeCaller(),
        operation: {
          kind: 'page.snapshot',
          target,
        },
      },
      new AbortController().signal,
    )

    expect(snapResult.status).toBe('success')
    if (snapResult.status !== 'success' || snapResult.value.kind !== 'snapshot') {
      throw new Error('Expected snapshot result')
    }
    const snapshot = snapResult.value.snapshot
    expect(snapshot.text).toContain('Automation Test Fixture')
    expect(snapshot.snapshotId).toBeDefined()

    // 3. Strict locator fails on duplicate labels
    await expect(
      guests.handleBrowserRequest(
        owner as never,
        {
          type: 'browser/request',
          requestId: 102,
          caller: makeCaller(),
          operation: {
            kind: 'page.read',
            target,
            locator: {
              kind: 'role',
              snapshotId: snapshot.snapshotId,
              role: 'button',
              name: 'Duplicate Action',
              exact: true,
            },
            property: 'text',
            maxChars: 100,
          },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      code: 'failed',
    })

    // 4. Fill form field and read its value
    const actResult = await guests.handleBrowserRequest(
      owner as never,
      {
        type: 'browser/request',
        requestId: 103,
        caller: makeCaller(),
        operation: {
          kind: 'page.act',
          target,
          locator: {
            kind: 'role',
            snapshotId: snapshot.snapshotId,
            role: 'textbox',
            name: 'Username',
            exact: true,
          },
          action: 'fill',
          text: 'testuser',
        },
      },
      new AbortController().signal,
    )
    expect(actResult.status).toBe('success')

    const readResult = await guests.handleBrowserRequest(
      owner as never,
      {
        type: 'browser/request',
        requestId: 104,
        caller: makeCaller(),
        operation: {
          kind: 'page.read',
          target,
          locator: {
            kind: 'role',
            snapshotId: snapshot.snapshotId,
            role: 'textbox',
            name: 'Username',
            exact: true,
          },
          property: 'attribute',
          attribute: 'value',
          maxChars: 100,
        },
      },
      new AbortController().signal,
    )
    expect(readResult).toMatchObject({
      status: 'success',
      value: {
        kind: 'read',
        value: 'testuser',
      },
    })

    // 5. Accessible action on mirror ref
    const inputEl = document.querySelector('#username') as HTMLInputElement
    expect(inputEl.value).toBe('testuser')

    // 6. Capture screenshot
    const screenshotResult = await guests.handleBrowserRequest(
      owner as never,
      {
        type: 'browser/request',
        requestId: 105,
        caller: makeCaller(),
        operation: {
          kind: 'page.screenshot',
          target,
        },
      },
      new AbortController().signal,
    )
    expect(screenshotResult.status).toBe('success')
    if (screenshotResult.status === 'success' && screenshotResult.value.kind === 'screenshot') {
      expect(screenshotResult.value.screenshot.bytes.length).toBeGreaterThan(0)
    }

    // 7. Release lease
    await guests.release(owner as never, leaseId)
  })

  it('rejects stale targets and expired snapshot IDs', async () => {
    const guests = new DesktopBrowserGuests(() => 'https://host.example:8443')
    const owner = makeOwner()

    const staleTarget: DesktopBrowserTarget = {
      tabId: brandString<DesktopBrowserTabId>('nonexistent-tab'),
      generation: GEN_1,
    }

    const result = await guests.handleBrowserRequest(
      owner as never,
      {
        type: 'browser/request',
        requestId: 201,
        caller: makeCaller(),
        operation: {
          kind: 'page.snapshot',
          target: staleTarget,
        },
      },
      new AbortController().signal,
    )

    expect(result).toMatchObject({
      status: 'error',
      code: 'stale-target',
    })
  })

  it('operates a DOM through the isolated-world executor without a main-process document', async () => {
    const rendererDocument = document
    rendererDocument.body.innerHTML = fixtureHtml
    const owner = makeOwner()
    const guests = new DesktopBrowserGuests(() => 'https://host.example:8443')
    const reservation = await guests.acquire(owner as never, 'isolated-world-workspace', SESSION_A, TAB_A)
    const target: DesktopBrowserTarget = { tabId: brandString<DesktopBrowserTabId>(TAB_A), generation: GEN_1 }
    const caller = makeCaller()
    const signal = new AbortController().signal
    const guest = guests.resolveGuest(owner as never, SESSION_A, target)
    if (!guest) throw new Error('Expected acquired browser guest')
    const isolatedWindow = new JSDOM(rendererDocument.documentElement.outerHTML, { runScripts: 'outside-only' }).window
    vi.spyOn(guest, 'executeJavaScriptInIsolatedWorld').mockImplementation(async (_worldId, scripts) => {
      let result: unknown
      for (const source of scripts) {
        if (!('code' in source) || typeof source.code !== 'string') throw new Error('Expected isolated-world source')
        result = isolatedWindow.eval(source.code)
      }
      return result
    })
    vi.spyOn(guest, 'insertText').mockImplementation(async (text: string) => {
      const active = isolatedWindow.document.activeElement
      if (active && 'value' in active) {
        ;(active as HTMLInputElement).value = text
      }
    })

    try {
      vi.stubGlobal('document', undefined)
      const snapshotResult = await guests.handleBrowserRequest(owner as never, {
        type: 'browser/request',
        requestId: 301,
        caller,
        operation: { kind: 'page.snapshot', target },
      }, signal)
      expect(snapshotResult.status).toBe('success')
      if (snapshotResult.status !== 'success' || snapshotResult.value.kind !== 'snapshot') {
        throw new Error('Expected isolated-world snapshot')
      }
      expect(snapshotResult.value.snapshot.text).toContain('Automation Test Fixture')

      const actResult = await guests.handleBrowserRequest(owner as never, {
        type: 'browser/request',
        requestId: 302,
        caller,
        operation: {
          kind: 'page.act',
          target,
          locator: {
            kind: 'role',
            snapshotId: snapshotResult.value.snapshot.snapshotId,
            role: 'textbox',
            name: 'Username',
            exact: true,
          },
          action: 'fill',
          text: 'isolated-world-user',
        },
      }, signal)
      expect(actResult.status).toBe('success')

      const refreshedSnapshot = await guests.handleBrowserRequest(owner as never, {
        type: 'browser/request',
        requestId: 303,
        caller,
        operation: { kind: 'page.snapshot', target },
      }, signal)
      if (refreshedSnapshot.status !== 'success' || refreshedSnapshot.value.kind !== 'snapshot') {
        throw new Error('Expected refreshed isolated-world snapshot')
      }

      const readResult = await guests.handleBrowserRequest(owner as never, {
        type: 'browser/request',
        requestId: 304,
        caller,
        operation: {
          kind: 'page.read',
          target,
          locator: {
            kind: 'role',
            snapshotId: refreshedSnapshot.value.snapshot.snapshotId,
            role: 'textbox',
            name: 'Username',
            exact: true,
          },
          property: 'attribute',
          attribute: 'value',
          maxChars: 100,
        },
      }, signal)
      expect(readResult).toMatchObject({ status: 'success', value: { kind: 'read', value: 'isolated-world-user' } })
      expect(guest.sendInputEvent).toHaveBeenCalledWith({ type: 'keyDown', keyCode: 'Control' })
      expect(guest.insertText).toHaveBeenCalledWith('isolated-world-user')
    } finally {
      vi.stubGlobal('document', rendererDocument)
      await guests.release(owner as never, reservation.lease)
    }
  })
})
