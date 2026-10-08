/** Electron offscreen navigation and canvas rendering, independent from DOM placement. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  DesktopBrowserAccessibleAction,
  DesktopBrowserBridge,
  DesktopBrowserCanvasInput,
  DesktopBrowserLeaseId,
  DesktopBrowserPageState,
  DesktopBrowserRef,
  DesktopBrowserSnapshotId,
  DesktopBrowserViewport,
  SessionId,
} from '../../types.ts'
import type { OffscreenCanvasPresentation } from './OffscreenCanvasPresentation.ts'
import {
  emptyBrowserFrame,
  type BrowserFrame,
  type BrowserFrameState,
} from '../browser/BrowserFrame.ts'
import type { BrowserPageOptions } from '../browser/BrowserPage.ts'
import { browserAddressCheckpoint, currentBrowserTarget } from '../browser/BrowserPersistence.ts'
import type { BrowserTarget } from '../browser/url.ts'

/** Owns offscreen browser commands, frame rendering onto canvas, and input forwarding. */
export class OffscreenBrowserImpl implements BrowserFrame {
  private readonly store: SnapshotStore<BrowserFrameState>
  private readonly lifetime = new AbortController()
  private lease: DesktopBrowserLeaseId | undefined
  private workspaceKey: string | undefined
  private initializing: Promise<void> | undefined
  private ready = false
  private disposal: Promise<void> | undefined
  private disposed = false
  private canvas: HTMLCanvasElement | undefined
  private inputDisposers: (() => void)[] = []
  private readonly cleanupDisposers: (() => void)[] = []
  private pendingTarget: BrowserTarget | undefined
  private revision = 0
  private currentViewport: DesktopBrowserViewport = { cssWidth: 800, cssHeight: 600 }

  constructor(
    private readonly options: BrowserPageOptions,
    private readonly bridge: DesktopBrowserBridge,
    private readonly workspace: (signal: AbortSignal) => Promise<string>,
    private readonly presentation: OffscreenCanvasPresentation,
    private readonly sessionId?: SessionId,
  ) {
    const initialTarget = currentBrowserTarget(options.initial)
    this.pendingTarget = initialTarget
    this.store = createSnapshotStore(emptyBrowserFrame())
  }

  getSnapshot = (): BrowserFrameState => this.store.getSnapshot()
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** Attach offscreen canvas rendering when mounted in the DOM. */
  attach(canvas: HTMLCanvasElement, viewport: DesktopBrowserViewport): void {
    if (this.disposed) return
    this.canvas = canvas
    this.currentViewport = viewport
    this.installInputForwarding(canvas)
    if (this.lease !== undefined && typeof this.bridge.setViewport === 'function') {
      void this.bridge.setViewport(this.lease, viewport).catch((error: unknown) => {
        console.error('Desktop browser: viewport update failed', error)
      })
    } else {
      this.initialize()
    }
  }

  /** Handle container resize. */
  resize(viewport: DesktopBrowserViewport): void {
    if (this.disposed) return
    this.currentViewport = viewport
    if (this.lease !== undefined && typeof this.bridge.setViewport === 'function') {
      void this.bridge.setViewport(this.lease, viewport).catch((error: unknown) => {
        console.error('Desktop browser: viewport update failed', error)
      })
    }
  }

  /** Detach canvas rendering without destroying navigation state. */
  detach(): void {
    for (const dispose of this.inputDisposers) dispose()
    this.inputDisposers = []
    this.canvas = undefined
  }

  loadUrl(target: BrowserTarget): void {
    if (this.disposed) return
    this.pendingTarget = target
    this.revision++
    this.options.persist(browserAddressCheckpoint(target, this.revision))
    this.store.set({
      ...this.store.getSnapshot(),
      target,
      address: 'requested',
      loading: true,
      error: undefined,
    })
    if (this.ready && this.lease !== undefined) {
      if (typeof this.bridge.navigate === 'function') {
        void this.bridge.navigate(this.lease, target.url).catch((error: unknown) => {
          console.error('Desktop browser: navigation failed', error)
        })
      }
    } else {
      this.initialize()
    }
  }

  goBack(): void {
    if (this.disposed || this.lease === undefined || typeof this.bridge.goBack !== 'function') return
    void this.bridge.goBack(this.lease).catch((error: unknown) => {
      console.error('Desktop browser: back navigation failed', error)
    })
  }

  goForward(): void {
    if (this.disposed || this.lease === undefined || typeof this.bridge.goForward !== 'function') return
    void this.bridge.goForward(this.lease).catch((error: unknown) => {
      console.error('Desktop browser: forward navigation failed', error)
    })
  }

  reload(): void {
    if (this.disposed || this.lease === undefined || typeof this.bridge.reload !== 'function') return
    void this.bridge.reload(this.lease).catch((error: unknown) => {
      console.error('Desktop browser: reload failed', error)
    })
  }

  accessibleAction = (
    snapshotId: DesktopBrowserSnapshotId,
    ref: DesktopBrowserRef,
    action: DesktopBrowserAccessibleAction,
  ): Promise<void> => {
    if (this.disposed || this.lease === undefined || typeof this.bridge.accessibleAction !== 'function') {
      return Promise.resolve()
    }
    return this.bridge.accessibleAction(this.lease, snapshotId, ref, action)
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.lifetime.abort()
    this.detach()
    for (const dispose of this.cleanupDisposers) dispose()
    this.cleanupDisposers.length = 0
    this.presentation.dispose()
    this.disposal = (async () => {
      if (this.initializing !== undefined) {
        await this.initializing.catch(() => {})
      }
      if (this.lease !== undefined) {
        const leaseId = this.lease
        this.lease = undefined
        await this.bridge.release(leaseId).catch((error: unknown) => {
          console.error('Desktop browser: release failed', error)
        })
      }
    })()
    return this.disposal
  }

  private initialize(): void {
    if (this.initializing !== undefined || this.lease !== undefined || this.disposed) return
    this.initializing = this.createGuest()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        console.error('Desktop browser: guest creation failed', error)
        this.store.set({
          ...this.store.getSnapshot(),
          loading: false,
          error: { code: undefined, description: `Guest creation failed: ${message}` },
        })
      })
      .finally(() => {
        this.initializing = undefined
      })
  }

  private async createGuest(): Promise<void> {
    this.workspaceKey ??= await this.workspace(this.lifetime.signal)
    if (this.lifetime.signal.aborted) return
    const reservation = await this.bridge.acquire(this.workspaceKey, this.sessionId, this.options.tabId)
    if (this.lifetime.signal.aborted) {
      await this.bridge.release(reservation.lease)
      return
    }
    this.lease = reservation.lease
    this.ready = true

    if (typeof this.bridge.onOpenRequested === 'function') {
      const unsubscribeOpen = this.bridge.onOpenRequested(reservation.lease, (url) => {
        if (!this.disposed) this.options.openRequested(url)
      })
      this.cleanupDisposers.push(unsubscribeOpen)
    }

    if (typeof this.bridge.onPageState === 'function') {
      const unsubscribeState = this.bridge.onPageState(reservation.lease, (state) => {
        this.handlePageState(state)
      })
      this.cleanupDisposers.push(unsubscribeState)
    }

    if (typeof this.bridge.onFrame === 'function') {
      const unsubscribeFrame = this.bridge.onFrame(reservation.lease, (frame) => {
        this.renderFrame(frame.png, frame.pixelSize)
      })
      this.cleanupDisposers.push(unsubscribeFrame)
    }

    if (typeof this.bridge.setViewport === 'function') {
      void this.bridge.setViewport(reservation.lease, this.currentViewport).catch((error: unknown) => {
        console.error('Desktop browser: initial viewport failed', error)
      })
    }
    if (typeof this.bridge.onAccessibleSnapshot === 'function') {
      const unsubscribeAccessible = this.bridge.onAccessibleSnapshot(reservation.lease, (snapshot) => {
        if (!this.disposed) {
          this.store.set({
            ...this.store.getSnapshot(),
            accessibleSnapshot: snapshot,
          })
        }
      })
      this.cleanupDisposers.push(unsubscribeAccessible)
    }
    if (this.pendingTarget !== undefined && typeof this.bridge.navigate === 'function') {
      const target = this.pendingTarget
      void this.bridge.navigate(reservation.lease, target.url).catch((error: unknown) => {
        console.error('Desktop browser: initial navigation failed', error)
      })
    }
  }

  private handlePageState(state: DesktopBrowserPageState): void {
    if (this.disposed) return
    const current = this.store.getSnapshot()
    const target: BrowserTarget | undefined = state.url !== undefined && state.url.length > 0
      ? { kind: 'https', url: state.url, title: state.title }
      : current.target
    this.store.set({
      ...current,
      target,
      address: target !== undefined ? 'observed' : current.address,
      loading: state.loading,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      error: state.error !== undefined
        ? { code: state.error.code ?? -1, description: state.error.description ?? 'Failed' }
        : undefined,
    })
    if (target !== undefined && !state.loading && state.error === undefined) {
      this.revision++
      this.options.persist(browserAddressCheckpoint(target, this.revision))
    }
  }

  private renderFrame(pngBytes: Uint8Array, pixelSize: { readonly width: number; readonly height: number }): void {
    if (this.disposed || this.canvas === undefined) return
    const canvas = this.canvas
    // DOM lib ArrayBufferLike vs ArrayBuffer BlobPart boundary
    const blobPart = pngBytes as unknown as BlobPart
    const blob = new Blob([blobPart], { type: 'image/png' })
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(blob)
        .then((bitmap) => {
          if (this.disposed || this.canvas !== canvas) {
            bitmap.close()
            return
          }
          canvas.width = pixelSize.width
          canvas.height = pixelSize.height
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(bitmap, 0, 0)
          bitmap.close()
        })
        .catch((error: unknown) => {
          console.error('Desktop browser: frame rendering failed', error)
        })
    } else {
      const img = new Image()
      img.onload = () => {
        if (this.disposed || this.canvas !== canvas) return
        canvas.width = pixelSize.width
        canvas.height = pixelSize.height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0)
      }
      img.src = URL.createObjectURL(blob)
    }
  }

  private installInputForwarding(canvas: HTMLCanvasElement): void {
    const onPointerDown = (event: PointerEvent): void => {
      if (this.disposed || this.lease === undefined) return
      const buttonMap: Record<number, 'left' | 'middle' | 'right'> = { 0: 'left', 1: 'middle', 2: 'right' }
      const input: DesktopBrowserCanvasInput = {
        kind: 'pointer',
        type: 'down',
        x: event.offsetX,
        y: event.offsetY,
        button: buttonMap[event.button] ?? 'left',
      }
      void this.bridge.dispatchInput?.(this.lease, input)
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (this.disposed || this.lease === undefined) return
      const buttonMap: Record<number, 'left' | 'middle' | 'right'> = { 0: 'left', 1: 'middle', 2: 'right' }
      const input: DesktopBrowserCanvasInput = {
        kind: 'pointer',
        type: 'up',
        x: event.offsetX,
        y: event.offsetY,
        button: buttonMap[event.button] ?? 'left',
      }
      void this.bridge.dispatchInput?.(this.lease, input)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (this.disposed || this.lease === undefined) return
      const input: DesktopBrowserCanvasInput = {
        kind: 'pointer',
        type: 'move',
        x: event.offsetX,
        y: event.offsetY,
      }
      void this.bridge.dispatchInput?.(this.lease, input)
    }

    const onWheel = (event: WheelEvent): void => {
      if (this.disposed || this.lease === undefined) return
      const input: DesktopBrowserCanvasInput = {
        kind: 'pointer',
        type: 'wheel',
        x: event.offsetX,
        y: event.offsetY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      }
      void this.bridge.dispatchInput?.(this.lease, input)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.disposed || this.lease === undefined) return
      const modifiers: string[] = []
      if (event.shiftKey) modifiers.push('shift')
      if (event.ctrlKey) modifiers.push('control')
      if (event.altKey) modifiers.push('alt')
      if (event.metaKey) modifiers.push('meta')
      const input: DesktopBrowserCanvasInput = {
        kind: 'key',
        type: 'down',
        key: event.key,
        code: event.code,
        modifiers,
      }
      void this.bridge.dispatchInput?.(this.lease, input)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (this.disposed || this.lease === undefined) return
      const modifiers: string[] = []
      if (event.shiftKey) modifiers.push('shift')
      if (event.ctrlKey) modifiers.push('control')
      if (event.altKey) modifiers.push('alt')
      if (event.metaKey) modifiers.push('meta')
      const input: DesktopBrowserCanvasInput = {
        kind: 'key',
        type: 'up',
        key: event.key,
        code: event.code,
        modifiers,
      }
      void this.bridge.dispatchInput?.(this.lease, input)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('wheel', onWheel, { passive: true })
    canvas.addEventListener('keydown', onKeyDown)
    canvas.addEventListener('keyup', onKeyUp)

    this.inputDisposers.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('keyup', onKeyUp)
    })
  }
}
