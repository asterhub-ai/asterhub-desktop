/** Main-process ownership and fixed isolation policy for Sidebar webview guests. */
import { randomUUID } from 'node:crypto'
import { app, session, BrowserWindow, type NativeImage, type Session, type WebContents } from 'electron'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
const MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES = 32 * 1024 * 1024
import type {
  DesktopBrowserRequestMessage,
  DesktopBrowserResult,
  DesktopBrowserTabId,
  DesktopBrowserTabInfo,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import type {
  DesktopBrowserAccessibleAction,
  DesktopBrowserCanvasInput,
  DesktopBrowserFrame,
  DesktopBrowserLeaseId,
  DesktopBrowserOpenRequest,
  DesktopBrowserPageState,
  DesktopBrowserRef,
  DesktopBrowserReservation,
  DesktopBrowserSnapshotId,
  DesktopBrowserTabCommandResult,
  DesktopBrowserTabOperation,
  DesktopBrowserViewport,
  TabId,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { AutomationSession } from './browser-automation.ts'
import { DESKTOP_IPC } from './ipc.ts'

interface RendererReply {
  readonly requestId: number
  readonly result: DesktopBrowserTabCommandResult
}

interface GuestLease {
  readonly owner: WebContents
  readonly partition: string
  readonly sessionId?: SessionId | undefined
  readonly tabId?: string | undefined
  readonly lease: DesktopBrowserLeaseId
  attached: boolean
  guest?: WebContents | undefined
  window?: BrowserWindow | undefined
  viewport?: DesktopBrowserViewport | undefined
  latestImage?: NativeImage | undefined
  sequence: number
  sendingFrame: boolean
  releaseInput?: (() => void) | undefined
  generation: DesktopBrowserTargetGeneration
  attachingPromise?: Promise<void> | undefined
  resolveAttaching?: (() => void) | undefined
  automationSession?: AutomationSession | undefined
}

/** Owns workspace storage partitions independently from individual tab guests. */
export class DesktopBrowserGuests {
  private readonly partitions = new Map<string, string>()
  private readonly leases = new Map<DesktopBrowserLeaseId, GuestLease>()
  private readonly frameSubscribers = new Set<DesktopBrowserLeaseId>()
  private nextCommandId = 1
  private readonly pendingRendererCommands = new Map<number, {
    owner: WebContents
    resolve: (reply: RendererReply) => void
    reject: (error: Error) => void
  }>()

  /** @param hostUrl - current authenticated DSH Host, which guests cannot request. */
  constructor(
    private readonly hostUrl: () => string | undefined,
    private readonly createWindow?: (options: Record<string, unknown>) => BrowserWindow,
  ) {}
  /**
   * Reserve one guest in a workspace's process-lifetime partition.
   * @param owner - authenticated primary application WebContents.
   * @param workspace - workspace identity received over IPC.
   * @returns opaque lease and the partition approved for it.
   */
  acquire(owner: WebContents, workspace: unknown, sessionId?: unknown, tabId?: unknown): DesktopBrowserReservation {
    if (typeof workspace !== 'string' || workspace.length === 0 || workspace.length > 4096) {
      throw new Error('desktop browser: a workspace storage identity is required')
    }
    let partition = this.partitions.get(workspace)
    if (partition === undefined) {
      partition = `dsh-sidebar-browser-${randomUUID()}`
      this.configureSession(session.fromPartition(partition))
      this.partitions.set(workspace, partition)
    }
    const lease = randomUUID() as DesktopBrowserLeaseId
    const validSessionId = typeof sessionId === 'string' && sessionId.length > 0 ? (sessionId as SessionId) : undefined
    const validTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : undefined

    const windowFactory = this.createWindow ?? (options =>
      new BrowserWindow(options as ConstructorParameters<typeof BrowserWindow>[0]))
    const guestWindow = windowFactory({
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
        partition,
      },
    })
    const guest = guestWindow.webContents

    const leaseRecord: GuestLease = {
      owner,
      partition,
      sessionId: validSessionId,
      tabId: validTabId,
      lease,
      attached: guest !== undefined,
      guest,
      window: guestWindow,
      sequence: 0,
      sendingFrame: false,
      generation: 1 as DesktopBrowserTargetGeneration,
    }
    this.leases.set(lease, leaseRecord)

    if (guest !== undefined && guestWindow !== undefined) {
      this.setupOffscreenGuest(owner, leaseRecord, guest, guestWindow)
    }

    return { lease, partition }
  }

  /**
   * Release only a lease issued to this application window; workspace storage survives.
   * @param owner - authenticated IPC sender.
   * @param id - lease received over IPC.
   */
  async release(owner: WebContents, id: unknown): Promise<void> {
    if (typeof id !== 'string') throw new Error('desktop browser: invalid guest lease')
    const key = id as DesktopBrowserLeaseId
    const lease = this.leases.get(key)
    if (lease === undefined) return
    if (lease.owner !== owner) throw new Error('desktop browser: guest belongs to another window')
    if (lease.attachingPromise !== undefined && lease.guest === undefined) {
      await lease.attachingPromise
    }
    this.frameSubscribers.delete(key)
    lease.releaseInput?.()
    this.leases.delete(key)
    const win = lease.window
    const guest = lease.guest
    if (win !== undefined && !win.isDestroyed()) {
      const windowClosed = new Promise<void>((resolve) => {
        win.once('closed', () => { resolve() })
      })
      const guestDestroyed = guest !== undefined && !guest.isDestroyed()
        ? new Promise<void>((resolve) => { guest.once('destroyed', () => { resolve() }) })
        : Promise.resolve()
      win.destroy()
      await Promise.all([windowClosed, guestDestroyed])
    } else if (guest !== undefined && !guest.isDestroyed()) {
      const destroyed = new Promise<void>((resolve) => {
        guest.once('destroyed', () => { resolve() })
      })
      guest.close({ waitForBeforeUnload: false })
      await destroyed
    }
  }

  /**
   * Install attachment checks before the application document can create a webview.
   * @param window - primary application window.
   * @param attachInput - attaches native input after guest ownership is verified and returns its disposer.
   */
  bind(window: BrowserWindow, attachInput: (guest: WebContents, name: DesktopBrowserLeaseId) => () => void): void {
    const owner = window.webContents
    owner.on('will-attach-webview', (event, preferences, params) => {
      const id = typeof params.src === 'string' && params.src.startsWith('about:blank#')
        ? params.src.slice('about:blank#'.length) : ''
      const lease = this.leases.get(id as DesktopBrowserLeaseId)
      if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
        event.preventDefault()
        return
      }
      lease.attached = true
      lease.attachingPromise = new Promise<void>((resolve) => {
        lease.resolveAttaching = resolve
      })
      // Keep Electron's allowpopups dispatch flag; the guest handler still denies native windows.
      for (const key of Object.keys(preferences)) {
        if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key)
      }
      Object.assign(preferences, {
        partition: lease.partition,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, plugins: false, navigateOnDragDrop: false, disableDialogs: true,
        devTools: !app.isPackaged,
      })
      params.httpreferrer = ''
    })
    owner.on('did-attach-webview', (_event, guest) => {
      let attachedLease: DesktopBrowserLeaseId | undefined
      // The first document is an inert about:blank carrying the approved lease.
      // Bind on the main-process event before the renderer can navigate the ready guest.
      guest.once('dom-ready', () => {
        const url = guest.getURL()
        const id = (url.startsWith('about:blank#') ? url.slice('about:blank#'.length) : '') as DesktopBrowserLeaseId
        const lease = this.leases.get(id)
        if (lease === undefined || lease.owner !== owner || lease.guest !== undefined) {
          guest.close({ waitForBeforeUnload: false })
          return
        }
        lease.guest = guest
        attachedLease = id
        lease.resolveAttaching?.()
        lease.attachingPromise = undefined
        lease.releaseInput = attachInput(guest, id)
        guest.once('destroyed', () => {
          lease.resolveAttaching?.()
          lease.releaseInput?.()
          this.leases.delete(id)
        })
      })
      guest.setWindowOpenHandler(({ url, postBody }) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease)
        if (attachedLease !== undefined && lease?.guest === guest && lease.owner === owner && !owner.isDestroyed()
          && postBody === undefined && this.allowedNavigation(url)) {
          const request: DesktopBrowserOpenRequest = { lease: attachedLease, url: new URL(url).href }
          owner.send(DESKTOP_IPC.browserOpenRequested, request)
        }
        return { action: 'deny' }
      })
      guest.on('will-frame-navigate', (event) => {
        if (event.isMainFrame) {
          if (!this.allowedNavigation(event.url)) {
            event.preventDefault()
            return
          }
          if (attachedLease !== undefined) {
            const lease = this.leases.get(attachedLease)
            if (lease !== undefined) {
              lease.generation = (Number(lease.generation) + 1) as DesktopBrowserTargetGeneration
            }
          }
        }
      })
      guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
        if (mainFrame) {
          if (!this.allowedNavigation(url)) {
            event.preventDefault()
            return
          }
          if (attachedLease !== undefined) {
            const lease = this.leases.get(attachedLease)
            if (lease !== undefined) {
              lease.generation = (Number(lease.generation) + 1) as DesktopBrowserTargetGeneration
            }
          }
        }
      })
      guest.on('will-attach-webview', (event) => { event.preventDefault() })
      guest.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback() })
    })
    const releaseAll = (): void => {
      for (const [id, lease] of this.leases) {
        if (lease.owner === owner) void this.release(owner, id).catch((error: unknown) => { console.error(error) })
      }
      for (const [id, pending] of this.pendingRendererCommands) {
        if (pending.owner === owner) {
          this.pendingRendererCommands.delete(id)
          pending.reject(new Error('Window was destroyed'))
        }
      }
    }
    owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) releaseAll()
    })
    owner.on('render-process-gone', releaseAll)
    owner.once('destroyed', releaseAll)
  }

  private setupOffscreenGuest(
    owner: WebContents,
    leaseRecord: GuestLease,
    guest: WebContents,
    _guestWindow: BrowserWindow,
  ): void {
    const lease = leaseRecord.lease
    leaseRecord.automationSession = new AutomationSession({
      owner,
      guest,
      lease,
      target: {
        tabId: (leaseRecord.tabId ?? '') as DesktopBrowserTabId,
        generation: leaseRecord.generation,
      },
      get viewport() {
        return leaseRecord.viewport ?? { cssWidth: 800, cssHeight: 600 }
      },
      getLatestImage: () => leaseRecord.latestImage,
      emitAccessibleSnapshot: (snapshot) => {
        if (!owner.isDestroyed()) {
          owner.send(DESKTOP_IPC.browserAccessibleSnapshot, snapshot)
        }
      },
    })

    guest.setWindowOpenHandler(({ url, postBody }) => {
      if (postBody === undefined && this.allowedNavigation(url) && !owner.isDestroyed()) {
        const request: DesktopBrowserOpenRequest = { lease, url: new URL(url).href }
        owner.send(DESKTOP_IPC.browserOpenRequested, request)
      }
      return { action: 'deny' }
    })
    guest.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) {
        if (!this.allowedNavigation(event.url)) {
          event.preventDefault()
          return
        }
        leaseRecord.generation = (Number(leaseRecord.generation) + 1) as DesktopBrowserTargetGeneration
        this.emitPageState(owner, leaseRecord)
      }
    })
    guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
      if (mainFrame) {
        if (!this.allowedNavigation(url)) {
          event.preventDefault()
          return
        }
        leaseRecord.generation = (Number(leaseRecord.generation) + 1) as DesktopBrowserTargetGeneration
      }
    })
    guest.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) {
        this.emitPageState(owner, leaseRecord, { loading: true })
      }
    })
    guest.on('did-finish-load', () => {
      this.emitPageState(owner, leaseRecord, { loading: false })
    })
    guest.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame) {
        console.error('desktop browser main-frame load failure', { errorCode, errorDescription, url: _validatedURL })
      }
      if (isMainFrame && errorCode !== -3) {
        this.emitPageState(owner, leaseRecord, {
          loading: false,
          error: { code: errorCode, description: errorDescription },
        })
      }
    })
    guest.on('page-title-updated', (_event, title) => {
      this.emitPageState(owner, leaseRecord, { title })
    })
    guest.on('paint', (_event, _dirty, image: NativeImage) => {
      leaseRecord.latestImage = image
      leaseRecord.sequence++
      if (this.frameSubscribers.has(lease)) {
        this.sendFrameIfIdle(owner, leaseRecord)
      }
    })
  }

  private emitPageState(
    owner: WebContents,
    lease: GuestLease,
    overrides?: Partial<DesktopBrowserPageState>,
  ): void {
    if (owner.isDestroyed() || lease.guest === undefined || lease.guest.isDestroyed()) return
    const guest = lease.guest
    const state: DesktopBrowserPageState = {
      url: guest.getURL(),
      title: guest.getTitle(),
      loading: typeof guest.isLoading === 'function' ? guest.isLoading() : false,
      canGoBack: guest.navigationHistory.canGoBack(),
      canGoForward: guest.navigationHistory.canGoForward(),
      ...overrides,
    }
    owner.send(DESKTOP_IPC.browserPageState, { lease: lease.lease, state })
  }

  private sendFrameIfIdle(owner: WebContents, lease: GuestLease): void {
    if (lease.sendingFrame || lease.latestImage === undefined || owner.isDestroyed()) return
    lease.sendingFrame = true
    const image = lease.latestImage
    const seq = lease.sequence
    const gen = lease.generation
    const viewport = lease.viewport ?? { cssWidth: 800, cssHeight: 600 }
    try {
      const pngBuffer = image.toPNG()
      if (pngBuffer.byteLength <= MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES) {
        const frame: DesktopBrowserFrame = {
          lease: lease.lease,
          generation: gen,
          sequence: seq,
          png: new Uint8Array(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength),
          pixelSize: image.getSize(),
          viewport,
        }
        owner.send(DESKTOP_IPC.browserFrame, frame)
      }
    } finally {
      lease.sendingFrame = false
      if (lease.sequence > seq && this.frameSubscribers.has(lease.lease)) {
        queueMicrotask(() => { this.sendFrameIfIdle(owner, lease) })
      }
    }
  }

  subscribeFrames(owner: WebContents, leaseId: unknown): void {
    if (typeof leaseId !== 'string') return
    const key = leaseId as DesktopBrowserLeaseId
    const lease = this.leases.get(key)
    if (lease === undefined || lease.owner !== owner) return
    this.frameSubscribers.add(key)
    if (lease.latestImage !== undefined) {
      this.sendFrameIfIdle(owner, lease)
    }
  }

  unsubscribeFrames(_owner: WebContents, leaseId: unknown): void {
    if (typeof leaseId !== 'string') return
    this.frameSubscribers.delete(leaseId as DesktopBrowserLeaseId)
  }

  async navigate(owner: WebContents, leaseId: unknown, url: unknown): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    if (typeof url !== 'string' || !this.allowedNavigation(url)) throw new Error('desktop browser: invalid navigation URL')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (lease.guest === undefined || lease.guest.isDestroyed()) return
    await lease.guest.loadURL(url)
  }

  async goBack(owner: WebContents, leaseId: unknown): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (lease.guest === undefined || lease.guest.isDestroyed()) return
    if (lease.guest.navigationHistory.canGoBack()) {
      lease.guest.navigationHistory.goBack()
    }
    await Promise.resolve()
  }

  async goForward(owner: WebContents, leaseId: unknown): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (lease.guest === undefined || lease.guest.isDestroyed()) return
    if (lease.guest.navigationHistory.canGoForward()) {
      lease.guest.navigationHistory.goForward()
    }
    await Promise.resolve()
  }

  async reload(owner: WebContents, leaseId: unknown): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (lease.guest === undefined || lease.guest.isDestroyed()) return
    lease.guest.reload()
    await Promise.resolve()
  }

  async setViewport(owner: WebContents, leaseId: unknown, viewport: unknown): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (typeof viewport !== 'object' || viewport === null || !('cssWidth' in viewport) || !('cssHeight' in viewport)) {
      throw new Error('desktop browser: invalid viewport dimensions')
    }
    const vp = viewport as DesktopBrowserViewport
    lease.viewport = { cssWidth: vp.cssWidth, cssHeight: vp.cssHeight }
    lease.window?.setSize(Math.round(vp.cssWidth), Math.round(vp.cssHeight))
    await Promise.resolve()
  }

  async dispatchInput(owner: WebContents, leaseId: unknown, input: unknown): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (lease.guest === undefined || lease.guest.isDestroyed()) return

    const action = input as DesktopBrowserCanvasInput
    if (action.kind === 'pointer') {
      if (action.type === 'wheel') {
        lease.guest.sendInputEvent({
          type: 'mouseWheel',
          x: Math.round(action.x),
          y: Math.round(action.y),
          deltaX: action.deltaX,
          deltaY: action.deltaY,
        })
      } else {
        const typeMap = { move: 'mouseMove', down: 'mouseDown', up: 'mouseUp' } as const
        lease.guest.sendInputEvent({
          type: typeMap[action.type],
          x: Math.round(action.x),
          y: Math.round(action.y),
          button: action.button ?? 'left',
          clickCount: action.type === 'down' ? 1 : 0,
        })
      }
    } else if (action.kind === 'key') {
      lease.guest.sendInputEvent({
        type: action.type === 'down' ? 'keyDown' : 'keyUp',
        keyCode: action.key,
        modifiers: [...action.modifiers] as ('shift' | 'control' | 'alt' | 'meta')[],
      })
    } else {
      await lease.guest.insertText(action.text)
    }
    await Promise.resolve()
  }

  resolveGuest(owner: WebContents, sessionId: SessionId, target: DesktopBrowserTarget): WebContents | undefined {
    for (const lease of this.leases.values()) {
      if (
        lease.owner === owner &&
        lease.sessionId === sessionId &&
        lease.tabId === target.tabId &&
        lease.generation === target.generation &&
        lease.guest !== undefined &&
        !lease.guest.isDestroyed()
      ) {
        return lease.guest
      }
    }
    return undefined
  }

  describeSessionTabs(
    owner: WebContents,
    sessionId: SessionId,
    reportedTabs: readonly { readonly tabId: string; readonly active: boolean }[],
  ): DesktopBrowserTabInfo[] {
    const results: DesktopBrowserTabInfo[] = []
    for (const reported of reportedTabs) {
      for (const lease of this.leases.values()) {
        if (
          lease.owner === owner &&
          lease.sessionId === sessionId &&
          lease.tabId === reported.tabId &&
          lease.guest !== undefined &&
          !lease.guest.isDestroyed()
        ) {
          results.push({
            target: {
              tabId: reported.tabId as unknown as DesktopBrowserTabId,
              generation: lease.generation,
            },
            url: lease.guest.getURL(),
            title: lease.guest.getTitle(),
            active: reported.active,
            ownership: 'user',
            attached: lease.attached,
          })
          break
        }
      }
    }
    return results
  }
  private resolveLease(owner: WebContents, sessionId: SessionId, target: DesktopBrowserTarget): GuestLease | undefined {
    for (const lease of this.leases.values()) {
      if (
        lease.owner === owner &&
        lease.sessionId === sessionId &&
        lease.tabId === target.tabId &&
        lease.generation === target.generation &&
        lease.guest !== undefined &&
        !lease.guest.isDestroyed()
      ) {
        return lease
      }
    }
    return undefined
  }

  async accessibleAction(
    owner: WebContents,
    leaseId: unknown,
    snapshotId: unknown,
    ref: unknown,
    action: unknown,
  ): Promise<void> {
    if (typeof leaseId !== 'string') throw new Error('desktop browser: invalid lease')
    const lease = this.leases.get(leaseId as DesktopBrowserLeaseId)
    if (lease === undefined || lease.owner !== owner) throw new Error('desktop browser: lease not found')
    if (lease.automationSession === undefined) throw new Error('desktop browser: automation session unavailable')
    await lease.automationSession.accessibleAction(
      snapshotId as DesktopBrowserSnapshotId,
      ref as DesktopBrowserRef,
      action as DesktopBrowserAccessibleAction,
    )
  }


  resolveRendererReply(owner: WebContents, reply: unknown): void {
    if (
      typeof reply !== 'object' ||
      reply === null ||
      !('requestId' in reply) ||
      typeof reply.requestId !== 'number' ||
      !('result' in reply) ||
      typeof reply.result !== 'object' ||
      reply.result === null
    ) {
      return
    }
    const pending = this.pendingRendererCommands.get(reply.requestId)
    if (pending === undefined || pending.owner !== owner) return
    this.pendingRendererCommands.delete(reply.requestId)
    pending.resolve(reply as RendererReply)
  }

  async handleBrowserRequest(
    owner: WebContents,
    request: DesktopBrowserRequestMessage,
    signal: AbortSignal,
  ): Promise<DesktopBrowserResult> {
    if (signal.aborted) {
      return { status: 'error', code: 'cancelled', message: 'Browser operation was cancelled' }
    }
    if (owner.isDestroyed()) {
      return { status: 'error', code: 'unavailable', message: 'Application window is not available' }
    }

    const sendRendererCommand = (operation: DesktopBrowserTabOperation): Promise<DesktopBrowserTabCommandResult> => {
      const commandId = this.nextCommandId++
      const command = {
        requestId: commandId,
        sessionId: request.caller.sessionId,
        caller: request.caller,
        operation,
      }
      return new Promise<DesktopBrowserTabCommandResult>((resolve, reject) => {
        const onAbort = () => {
          this.pendingRendererCommands.delete(commandId)
          reject(new Error('Browser operation was cancelled'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        this.pendingRendererCommands.set(commandId, {
          owner,
          resolve: (reply) => {
            signal.removeEventListener('abort', onAbort)
            resolve(reply.result)
          },
          reject: (error) => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          },
        })
        owner.send(DESKTOP_IPC.browserAutomation, command)
      })
    }

    try {
      switch (request.operation.kind) {
        case 'tabs.list': {
          const result = await sendRendererCommand({ kind: 'tabs.list', limit: 256 })
          if (result.status === 'error') {
            return { status: 'error', code: 'failed', message: result.message }
          }
          if (result.value.kind === 'tabs') {
            const tabs = this.describeSessionTabs(owner, request.caller.sessionId, result.value.tabs)
            return {
              status: 'success',
              value: {
                kind: 'tabs',
                tabs,
                truncated: result.value.truncated,
              },
            }
          }
          return { status: 'error', code: 'failed', message: 'Invalid renderer tabs result' }
        }
        case 'tabs.open': {
          const result = await sendRendererCommand({
            kind: 'tabs.open',
            url: request.operation.url,
            ...request.operation.newTab !== undefined ? { newTab: request.operation.newTab } : {},
          })
          if (result.status === 'error') {
            return { status: 'error', code: 'failed', message: result.message }
          }
          if (result.value.kind === 'tab') {
            const [tab] = this.describeSessionTabs(owner, request.caller.sessionId, [
              { tabId: result.value.tabId, active: result.value.active },
            ])
            if (tab !== undefined) {
              return { status: 'success', value: { kind: 'tab', tab } }
            }
            return { status: 'error', code: 'failed', message: 'Failed to resolve opened tab guest' }
          }
          return { status: 'error', code: 'failed', message: 'Invalid renderer tab result' }
        }
        case 'tabs.close': {
          const guest = this.resolveGuest(owner, request.caller.sessionId, request.operation.target)
          if (guest === undefined) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          const tabId = request.operation.target.tabId as unknown as TabId
          const result = await sendRendererCommand({
            kind: 'tabs.close',
            tabId,
          })
          if (result.status === 'error') {
            return { status: 'error', code: 'failed', message: result.message }
          }
          return { status: 'success', value: { kind: 'closed', target: request.operation.target, closed: true } }
        }
        case 'page.snapshot': {
          const lease = this.resolveLease(owner, request.caller.sessionId, request.operation.target)
          if (!lease || !lease.automationSession) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          const snapshot = await lease.automationSession.createSnapshot(request.operation.target)
          return { status: 'success', value: { kind: 'snapshot', snapshot } }
        }
        case 'page.read': {
          const lease = this.resolveLease(owner, request.caller.sessionId, request.operation.target)
          if (!lease || !lease.automationSession) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          const result = await lease.automationSession.readProperty(
            request.operation.target,
            request.operation.locator,
            request.operation.property,
            request.operation.maxChars,
            request.operation.attribute,
          )
          return {
            status: 'success',
            value: {
              kind: 'read',
              target: request.operation.target,
              value: result.value,
              truncated: result.truncated,
            },
          }
        }
        case 'page.act': {
          const lease = this.resolveLease(owner, request.caller.sessionId, request.operation.target)
          if (!lease || !lease.automationSession) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          await lease.automationSession.act(
            request.operation.target,
            request.operation.locator,
            request.operation.action,
            {
              text: request.operation.text,
              keys: request.operation.keys,
              values: request.operation.values,
            },
          )
          return {
            status: 'success',
            value: {
              kind: 'action',
              target: request.operation.target,
              delivered: true,
            },
          }
        }
        case 'page.actAt': {
          const lease = this.resolveLease(owner, request.caller.sessionId, request.operation.target)
          if (!lease || !lease.automationSession) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          await lease.automationSession.actAt(
            request.operation.target,
            request.operation.screenshotId,
            request.operation.action,
            {
              x: request.operation.x,
              y: request.operation.y,
              deltaX: request.operation.deltaX,
              deltaY: request.operation.deltaY,
              path: request.operation.path,
            },
          )
          return {
            status: 'success',
            value: {
              kind: 'action',
              target: request.operation.target,
              delivered: true,
            },
          }
        }
        case 'page.wait': {
          const lease = this.resolveLease(owner, request.caller.sessionId, request.operation.target)
          if (!lease || !lease.automationSession) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          await lease.automationSession.waitForCondition(request.operation.target, request.operation.condition)
          return { status: 'success', value: { kind: 'wait', target: request.operation.target, matched: true } }
        }
        case 'page.screenshot': {
          const lease = this.resolveLease(owner, request.caller.sessionId, request.operation.target)
          if (!lease || !lease.automationSession) {
            return { status: 'error', code: 'stale-target', message: 'Browser target is invalid or expired' }
          }
          const screenshot = await lease.automationSession.captureScreenshot(request.operation.target)
          return { status: 'success', value: { kind: 'screenshot', screenshot } }
        }
        default: {
          const operation = request.operation as { kind?: string }
          return { status: 'error', code: 'unavailable', message: `Operation ${operation.kind} not yet supported` }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = message === 'Browser operation was cancelled' ? 'cancelled' : 'failed'
      return { status: 'error', code, message }
    }
  }

  private configureSession(browserSession: Session): void {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
    browserSession.on('will-download', (event) => { event.preventDefault() })
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      callback({ cancel: network
        ? url.username !== '' || url.password !== '' || this.isApplicationHost(url)
        : !['about:', 'data:', 'blob:'].includes(url.protocol) })
    })
  }

  private allowedNavigation(value: string): boolean {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
      && !this.isApplicationHost(url)
  }

  private isApplicationHost(url: URL): boolean {
    const value = this.hostUrl()
    if (value === undefined) return false
    const host = new URL(value)
    return url.port === host.port
      && (url.hostname === host.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  }
}
