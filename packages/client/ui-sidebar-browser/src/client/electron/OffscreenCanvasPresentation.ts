/** Canvas DOM inside a Sidebar-owned, stable content container for offscreen browser frames. */
import type { BrowserPresentation } from '../view/BrowserPresentation.ts'
import css from '../view/Browser.module.css'

/** Physical attachment and resize notifications for the offscreen canvas. */
export interface OffscreenPresentationEvents {
  readonly mounted: (canvas: HTMLCanvasElement, viewport: { readonly cssWidth: number; readonly cssHeight: number }) => void
  readonly resized: (viewport: { readonly cssWidth: number; readonly cssHeight: number }) => void
  readonly unmounted: () => void
}

/** Owns canvas creation and placement in the viewport container. */
export class OffscreenCanvasPresentation implements BrowserPresentation {
  private canvas: HTMLCanvasElement | undefined
  private host: HTMLElement | undefined
  private observer: ResizeObserver | undefined

  constructor(private readonly events: OffscreenPresentationEvents) {}

  /** @param viewportId - committed content container. @returns ends attachment and detaches the canvas. */
  mount(viewportId: string): () => void {
    const host = document.getElementById(viewportId)
    if (host === null) throw new Error('Offscreen presentation: content container is not mounted')
    if (this.host !== undefined) this.clear()
    this.host = host

    const canvas = document.createElement('canvas')
    canvas.className = css.canvas ?? ''
    canvas.setAttribute('aria-hidden', 'true')
    canvas.tabIndex = 0
    this.canvas = canvas
    host.append(canvas)

    const rect = host.getBoundingClientRect()
    const initialWidth = Math.max(1, Math.round(rect.width || 800))
    const initialHeight = Math.max(1, Math.round(rect.height || 600))
    const initialViewport = { cssWidth: initialWidth, cssHeight: initialHeight }

    this.observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      const width = Math.max(1, Math.round(entry.contentRect.width))
      const height = Math.max(1, Math.round(entry.contentRect.height))
      this.events.resized({ cssWidth: width, cssHeight: height })
    })
    this.observer.observe(host)

    this.events.mounted(canvas, initialViewport)

    return () => {
      if (this.host !== host) return
      this.clear()
    }
  }

  /** Current canvas element if mounted. */
  getCanvas(): HTMLCanvasElement | undefined {
    return this.canvas
  }

  /** Destroy only the canvas DOM; a replacement may use the same mounted container. */
  clear(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.canvas?.remove()
    this.canvas = undefined
    this.events.unmounted()
    this.host = undefined
  }

  /** Destroy the canvas DOM and release its content container. */
  dispose(): void {
    this.clear()
  }
}
