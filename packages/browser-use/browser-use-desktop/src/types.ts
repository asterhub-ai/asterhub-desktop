import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopBrowserTransport: DesktopBrowserTransport
  }
}

/** Main-issued identity for one attached Sidebar Browser tab. */
export type DesktopBrowserTabId = Branded<'DesktopBrowserTabId'>

/** Snapshot identity; locators are valid only for the snapshot and target generation that issued them. */
export type DesktopBrowserSnapshotId = Branded<'DesktopBrowserSnapshotId'>

/** Locator reference emitted by a DOM snapshot. */
export type DesktopBrowserRef = Branded<'DesktopBrowserRef'>

/** Lifetime generation for one live browser-owning agent. */
export type DesktopBrowserOwnerGeneration = BrandedNumber<'DesktopBrowserOwnerGeneration'>

/** Lifetime generation for the guest attached to one Sidebar tab. */
export type DesktopBrowserTargetGeneration = BrandedNumber<'DesktopBrowserTargetGeneration'>

/** Trusted identity derived from the live Host agent, never from tool arguments. */
export interface DesktopBrowserCaller {
  readonly sessionId: SessionId
  readonly ownerGeneration: DesktopBrowserOwnerGeneration
}

/** Exact guest identity; both fields become stale when the guest is replaced. */
export interface DesktopBrowserTarget {
  readonly tabId: DesktopBrowserTabId
  readonly generation: DesktopBrowserTargetGeneration
}

/** A verified Sidebar Browser guest shown in the caller's Session. */
export interface DesktopBrowserTabInfo {
  readonly target: DesktopBrowserTarget
  readonly url: string
  readonly title: string
  readonly active: boolean
  readonly ownership: 'user' | 'agent'
  readonly attached: boolean
}

/** A semantic locator derived from one current snapshot. */
export type DesktopBrowserLocator =
  | { readonly kind: 'ref'; readonly snapshotId: DesktopBrowserSnapshotId; readonly ref: DesktopBrowserRef }
  | { readonly kind: 'role'; readonly snapshotId: DesktopBrowserSnapshotId; readonly role: string; readonly name: string; readonly exact: true }

/** Page state to await after navigation or a user-visible action. */
export type DesktopBrowserWaitCondition =
  | { readonly kind: 'load'; readonly state: 'domcontentloaded' }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'element'; readonly locator: DesktopBrowserLocator; readonly state: 'visible' | 'hidden' | 'enabled' | 'checked' }

/** Optional observation performed after one browser action. */
export interface DesktopBrowserObservation {
  readonly wait?: DesktopBrowserWaitCondition
  readonly screenshot?: boolean
}

/** One point in a visual drag path, in CSS pixels of the matching screenshot. */
export interface DesktopBrowserPoint {
  readonly x: number
  readonly y: number
}

/** Page property exposed by the fixed read operation. */
export type DesktopBrowserReadProperty = 'text' | 'attribute' | 'visible' | 'enabled' | 'checked'

/** Semantic frontend actions exposed to the model. */
export type DesktopBrowserSemanticAction = 'click' | 'doubleClick' | 'fill' | 'type' | 'press' | 'check' | 'uncheck' | 'select' | 'hover'

/** Screenshot-grounded pointer actions exposed to the model. */
export type DesktopBrowserPointerAction = 'click' | 'doubleClick' | 'move' | 'scroll' | 'drag'

/** Fixed browser interaction actions supported by the Desktop provider. */
export type DesktopBrowserAction = DesktopBrowserSemanticAction | DesktopBrowserPointerAction

/** Host-admitted operations; `page.read.maxChars` is bounded by `MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS`. */
export type DesktopBrowserOperation =
  | { readonly kind: 'tabs.list' }
  | { readonly kind: 'tabs.open'; readonly url: string; readonly newTab?: boolean }
  | { readonly kind: 'tabs.close'; readonly target: DesktopBrowserTarget }
  | { readonly kind: 'page.snapshot'; readonly target: DesktopBrowserTarget }
  | { readonly kind: 'page.read'; readonly target: DesktopBrowserTarget; readonly locator: DesktopBrowserLocator; readonly property: DesktopBrowserReadProperty; readonly maxChars: number; readonly attribute?: string }
  | { readonly kind: 'page.act'; readonly target: DesktopBrowserTarget; readonly locator: DesktopBrowserLocator; readonly action: DesktopBrowserSemanticAction; readonly text?: string; readonly keys?: readonly string[]; readonly values?: readonly string[]; readonly observe?: DesktopBrowserObservation }
  | { readonly kind: 'page.actAt'; readonly target: DesktopBrowserTarget; readonly screenshotId: DesktopBrowserSnapshotId; readonly action: DesktopBrowserPointerAction; readonly x?: number; readonly y?: number; readonly deltaX?: number; readonly deltaY?: number; readonly path?: readonly DesktopBrowserPoint[]; readonly observe?: DesktopBrowserObservation }
  | { readonly kind: 'page.wait'; readonly target: DesktopBrowserTarget; readonly condition: DesktopBrowserWaitCondition }
  | { readonly kind: 'page.screenshot'; readonly target: DesktopBrowserTarget }

/** Accessible tree for one document; the text result is bounded and reports truncation. */
export interface DesktopBrowserSnapshot {
  readonly target: DesktopBrowserTarget
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly text: string
  readonly truncated: boolean
}

/** Image bytes and viewport facts captured from one exact target generation. */
export interface DesktopBrowserScreenshot {
  readonly target: DesktopBrowserTarget
  readonly screenshotId: DesktopBrowserSnapshotId
  readonly bytes: Uint8Array
  readonly viewport: { readonly width: number; readonly height: number }
}

/** Successful operation value; text reads and tab inventories report truncation explicitly when capped. */
export type DesktopBrowserValue =
  | { readonly kind: 'tabs'; readonly tabs: readonly DesktopBrowserTabInfo[]; readonly truncated: boolean }
  | { readonly kind: 'tab'; readonly tab: DesktopBrowserTabInfo }
  | { readonly kind: 'closed'; readonly target: DesktopBrowserTarget; readonly closed: true }
  | { readonly kind: 'snapshot'; readonly snapshot: DesktopBrowserSnapshot }
  | { readonly kind: 'read'; readonly target: DesktopBrowserTarget; readonly value: string | boolean | null; readonly truncated: boolean }
  | { readonly kind: 'action'; readonly target: DesktopBrowserTarget; readonly delivered: boolean; readonly observation?: DesktopBrowserSnapshot; readonly screenshot?: DesktopBrowserScreenshot }
  | { readonly kind: 'wait'; readonly target: DesktopBrowserTarget; readonly matched: true }
  | { readonly kind: 'screenshot'; readonly screenshot: DesktopBrowserScreenshot }

/** Stable transport error categories returned without exposing page or Host internals. */
export type DesktopBrowserErrorCode = 'unavailable' | 'invalid-request' | 'invalid-target' | 'stale-target' | 'unsupported' | 'timeout' | 'cancelled' | 'failed'

/** One normalized browser-operation outcome. */
export type DesktopBrowserResult =
  | { readonly status: 'success'; readonly value: DesktopBrowserValue }
  | { readonly status: 'error'; readonly code: DesktopBrowserErrorCode; readonly message: string }

/** Child-to-parent browser operation request. */
export interface DesktopBrowserRequestMessage {
  readonly type: 'browser/request'
  readonly requestId: number
  readonly caller: DesktopBrowserCaller
  readonly operation: DesktopBrowserOperation
}

/** Child-to-parent cancellation for one outstanding browser operation. */
export interface DesktopBrowserCancelMessage {
  readonly type: 'browser/cancel'
  readonly requestId: number
}

/** Parent-to-child terminal response to one browser operation request. */
export interface DesktopBrowserResultMessage {
  readonly type: 'browser/result'
  readonly requestId: number
  readonly result: DesktopBrowserResult
}

/** Main-process callback that operates the exact Session-owned Sidebar guest. */
export type DesktopBrowserRequestHandler = (
  request: DesktopBrowserRequestMessage,
  signal: AbortSignal,
) => Promise<DesktopBrowserResult>

/** Host-provided bridge for model tools to operate Desktop's Sidebar Browser. */
export interface DesktopBrowserTransport {
  /**
   * @param caller - exact live agent and owner generation.
   * @param operation - one validated browser operation.
   * @param signal - tool-call cancellation.
   * @returns the correlated operation outcome.
   */
  request(caller: DesktopBrowserCaller, operation: DesktopBrowserOperation, signal: AbortSignal): Promise<DesktopBrowserResult>
  /**
   * @param caller - exact live browser owner to cancel and release.
   * @returns after every owned request settles or the parent disconnects.
   */
  releaseOwner(caller: DesktopBrowserCaller): Promise<void>
  /** Stop admitting requests, cancel pending operations, await remote settlement, and detach process listeners. */
  dispose(): Promise<void>
}
