/** Type-only Electron bridge declarations shared by the desktop shell and browser provider. */
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'

/** Identity of one open tab in the layout. */
export type TabId = Branded<'TabId'>
/** Identity of one live session. */
export type SessionId = Branded<'SessionId'>

/** Snapshot identity for DOM and accessibility trees. */
export type DesktopBrowserSnapshotId = Branded<'DesktopBrowserSnapshotId'>

/** Locator reference for an element emitted by an accessibility snapshot. */
export type DesktopBrowserRef = Branded<'DesktopBrowserRef'>

/** Node in the semantic accessibility tree for screen reader mirror. */
export interface DesktopBrowserAccessibleNode {
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly ref?: DesktopBrowserRef | undefined
  readonly role: string
  readonly name: string
  readonly text?: string | undefined
  readonly value?: string | undefined
  readonly states: readonly string[]
  readonly children: readonly DesktopBrowserAccessibleNode[]
}

/** Structured accessibility snapshot emitted to the renderer. */
export interface DesktopBrowserAccessibleSnapshot {
  readonly lease: DesktopBrowserLeaseId
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly generation: DesktopBrowserTargetGeneration
  readonly nodes: readonly DesktopBrowserAccessibleNode[]
  readonly truncated: boolean
}

/** Semantic actions dispatched from the accessible mirror to the offscreen page. */
export type DesktopBrowserAccessibleAction =
  | { readonly kind: 'focus' | 'click' | 'check' | 'uncheck' }
  | { readonly kind: 'fill' | 'type'; readonly text: string }
  | { readonly kind: 'press'; readonly keys: readonly string[] }
  | { readonly kind: 'select'; readonly values: readonly string[] }

/** Main-issued identity of one guest reservation. */
export type DesktopBrowserLeaseId = Branded<'DesktopBrowserLeaseId'>

/** A guest's approved, process-local storage partition. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** Viewport size in CSS pixels. */
export interface DesktopBrowserViewport {
  readonly cssWidth: number
  readonly cssHeight: number
}

/** Page navigation and document state reported by main to the Sidebar. */
export interface DesktopBrowserPageState {
  readonly url?: string | undefined
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error?: { readonly code?: number; readonly description?: string } | undefined
}

/** Lifetime generation for the guest attached to one Sidebar tab. */
export type DesktopBrowserTargetGeneration = BrandedNumber<'DesktopBrowserTargetGeneration'>

/** Encoded paint frame forwarded to the Sidebar canvas. */
export interface DesktopBrowserFrame {
  readonly lease: DesktopBrowserLeaseId
  readonly generation: DesktopBrowserTargetGeneration
  readonly sequence: number
  readonly png: Uint8Array
  readonly pixelSize: { readonly width: number; readonly height: number }
  readonly viewport: DesktopBrowserViewport
}

/** Canvas-originating input forwarded to the offscreen page. */
export type DesktopBrowserCanvasInput =
  | {
    readonly kind: 'pointer'
    readonly type: 'move' | 'down' | 'up'
    readonly x: number
    readonly y: number
    readonly button?: 'left' | 'middle' | 'right' | undefined
  }
  | {
    readonly kind: 'pointer'
    readonly type: 'wheel'
    readonly x: number
    readonly y: number
    readonly deltaX: number
    readonly deltaY: number
  }
  | {
    readonly kind: 'key'
    readonly type: 'down' | 'up'
    readonly key: string
    readonly code: string
    readonly modifiers: readonly string[]
  }
  | {
    readonly kind: 'text'
    readonly text: string
  }

/** Operations requested by main on the renderer's Sidebar tabs. */
export type DesktopBrowserTabOperation =
  | { readonly kind: 'tabs.list'; readonly limit: number }
  | { readonly kind: 'tabs.open'; readonly url: string; readonly newTab?: boolean }
  | { readonly kind: 'tabs.close'; readonly tabId: TabId }

/** Command sent from main to the renderer automation coordinator. */
export interface DesktopBrowserTabCommand {
  readonly requestId: number
  readonly sessionId: SessionId
  readonly operation: DesktopBrowserTabOperation
}

/** Result value from a successful renderer tab command. */
export type DesktopBrowserTabCommandValue =
  | { readonly kind: 'tabs'; readonly tabs: readonly { readonly tabId: TabId; readonly active: boolean }[]; readonly truncated: boolean }
  | { readonly kind: 'tab'; readonly tabId: TabId; readonly active: boolean }
  | { readonly kind: 'closed'; readonly tabId: TabId; readonly closed: true }

/** Outcome of a renderer tab command. */
export type DesktopBrowserTabCommandResult =
  | { readonly status: 'success'; readonly value: DesktopBrowserTabCommandValue }
  | { readonly status: 'error'; readonly message: string }

/** Handler callback installed in the renderer to process tab commands from main. */
export type DesktopBrowserTabAutomationHandler = (
  command: DesktopBrowserTabCommand,
  signal: AbortSignal,
) => Promise<DesktopBrowserTabCommandResult>

/** Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface. */
export interface DesktopBrowserBridge {
  /**
   * @param workspace - resolved storage account.
   * @param sessionId - requesting Session.
   * @param tabId - requesting tab.
   * @returns one approved guest reservation.
   */
  acquire(workspace: string, sessionId?: SessionId, tabId?: TabId): Promise<DesktopBrowserReservation>
  /** @param lease - the caller's reservation. @returns after its guest has been destroyed. */
  release(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - target page. @param url - destination URL. */
  navigate?(lease: DesktopBrowserLeaseId, url: string): Promise<void>
  /** @param lease - target page. */
  goBack?(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - target page. */
  goForward?(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - target page. */
  reload?(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - target page. @param viewport - committed CSS pixel dimensions. */
  setViewport?(lease: DesktopBrowserLeaseId, viewport: DesktopBrowserViewport): Promise<void>
  /** @param lease - target page. @param input - pointer or keyboard action. */
  dispatchInput?(lease: DesktopBrowserLeaseId, input: DesktopBrowserCanvasInput): Promise<void>
  /** @param lease - target page. @param listener - receives page navigation updates. @returns unsubscribe callback. */
  onPageState?(lease: DesktopBrowserLeaseId, listener: (state: DesktopBrowserPageState) => void): () => void
  /** @param lease - target page. @param listener - receives paint frames. @returns unsubscribe callback. */
  onFrame?(lease: DesktopBrowserLeaseId, listener: (frame: DesktopBrowserFrame) => void): () => void
  /** @param lease - originating guest. @param listener - approved URL consumer. @returns unsubscribe callback. */
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
  /** @param lease - target page. @param listener - receives accessibility tree snapshots. */
  onAccessibleSnapshot?(lease: DesktopBrowserLeaseId, listener: (snapshot: DesktopBrowserAccessibleSnapshot) => void): () => void
  /** @param lease - target page. @param snapshotId - source snapshot. @param ref - target element. @param action - action to run. */
  accessibleAction?(
    lease: DesktopBrowserLeaseId,
    snapshotId: DesktopBrowserSnapshotId,
    ref: DesktopBrowserRef,
    action: DesktopBrowserAccessibleAction,
  ): Promise<void>
  /** @param handler - coordinator handling tab commands from main. @returns listener disposer. */
  onAutomationRequest?(handler: DesktopBrowserTabAutomationHandler): () => void
}
