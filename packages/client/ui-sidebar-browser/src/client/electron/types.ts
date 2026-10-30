/** Fork-owned Electron automation types for Sidebar Browser. */
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DesktopBrowserLeaseId } from '../../types.ts'

export type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
export type { SessionId } from '@deepseek-ai/dsh-session/types'
export type {
  DesktopBrowserBridge,
  DesktopBrowserLeaseId,
  DesktopBrowserOpenRequest,
  DesktopBrowserReservation,
} from '../../types.ts'

/** Fork extension of the controller state: tab visibility is tracked by the Electron host. */
export type BrowserControllerStateWithVisibility = {
  readonly visible?: boolean
}

/** Fork extension of the injected controller props: host-side controller change counter. */
export type BrowserInjectedWithControllerChanges = {
  readonly controllerChanges?: HostObservable<number>
}

/** Snapshot identity for DOM and accessibility trees. */
export type DesktopBrowserSnapshotId = Branded<'DesktopBrowserSnapshotId'>

/** Locator reference for an element emitted by an accessibility snapshot. */
export type DesktopBrowserRef = Branded<'DesktopBrowserRef'>

/** Lifetime generation for the guest attached to one Sidebar tab. */
export type DesktopBrowserTargetGeneration = BrandedNumber<'DesktopBrowserTargetGeneration'>

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

declare module '../../types.ts' {
  interface DesktopBrowserBridge {
    navigate?(lease: DesktopBrowserLeaseId, url: string): Promise<void>
    goBack?(lease: DesktopBrowserLeaseId): Promise<void>
    goForward?(lease: DesktopBrowserLeaseId): Promise<void>
    reload?(lease: DesktopBrowserLeaseId): Promise<void>
    setViewport?(lease: DesktopBrowserLeaseId, viewport: DesktopBrowserViewport): Promise<void>
    dispatchInput?(lease: DesktopBrowserLeaseId, input: DesktopBrowserCanvasInput): Promise<void>
    onPageState?(lease: DesktopBrowserLeaseId, listener: (state: DesktopBrowserPageState) => void): () => void
    onFrame?(lease: DesktopBrowserLeaseId, listener: (frame: DesktopBrowserFrame) => void): () => void
    onAccessibleSnapshot?(lease: DesktopBrowserLeaseId, listener: (snapshot: DesktopBrowserAccessibleSnapshot) => void): () => void
    accessibleAction?(
      lease: DesktopBrowserLeaseId,
      snapshotId: DesktopBrowserSnapshotId,
      ref: DesktopBrowserRef,
      action: DesktopBrowserAccessibleAction,
    ): Promise<void>
    onAutomationRequest?(handler: DesktopBrowserTabAutomationRequestHandler): () => void
    onAutomationCancel?(handler: DesktopBrowserTabAutomationCancelHandler): () => void
  }
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

/** Main-issued serializable request callback; cancellation is a separate request-id event. */
export type DesktopBrowserTabAutomationRequestHandler = (
  command: DesktopBrowserTabCommand,
) => Promise<DesktopBrowserTabCommandResult>

/** Renderer callback for Main's serializable cancellation request. */
export type DesktopBrowserTabAutomationCancelHandler = (requestId: number) => void
