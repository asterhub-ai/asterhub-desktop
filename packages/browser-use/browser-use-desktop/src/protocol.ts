import type {
  DesktopBrowserCancelMessage,
  DesktopBrowserLocator,
  DesktopBrowserObservation,
  DesktopBrowserOperation,
  DesktopBrowserPoint,
  DesktopBrowserPointerAction,
  DesktopBrowserReadProperty,
  DesktopBrowserRequestMessage,
  DesktopBrowserResult,
  DesktopBrowserResultMessage,
  DesktopBrowserSemanticAction,
  DesktopBrowserTabInfo,
  DesktopBrowserTarget,
  DesktopBrowserValue,
  DesktopBrowserWaitCondition,
} from './types.ts'

/** Fixed IPC ceiling for screenshots, matching the reviewed ZCode browser bridge bound. */
export const MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES = 32 * 1024 * 1024

/** Hard ceiling for one browser text result before it crosses the process boundary. */
export const MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS = 1_000_000

/** Maximum tab inventory returned to one model call; truncation is reported explicitly. */
export const MAX_DESKTOP_BROWSER_TABS = 256

/** Canonical object guard for this package's process-wire validators. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate the public browser operation at the Host IPC boundary. */
export function isDesktopBrowserOperation(value: unknown): value is DesktopBrowserOperation {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'tabs.list':
      return hasOnlyKeys(value, ['kind'])
    case 'tabs.open':
      return hasOnlyKeys(value, ['kind', 'url', 'newTab']) && isHttpUrl(value.url)
        && (value.newTab === undefined || typeof value.newTab === 'boolean')
    case 'tabs.close':
    case 'page.snapshot':
    case 'page.screenshot':
      return hasOnlyKeys(value, ['kind', 'target']) && isTarget(value.target)
    case 'page.read':
      return hasOnlyKeys(value, ['kind', 'target', 'locator', 'property', 'maxChars', 'attribute'])
        && isTarget(value.target) && isLocator(value.locator) && isReadProperty(value.property)
        && isPositiveSafeInteger(value.maxChars) && value.maxChars <= MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS
        && (value.attribute === undefined || isBoundedString(value.attribute, 16_384))
        && (value.property !== 'attribute' || typeof value.attribute === 'string')
    case 'page.act':
      return hasOnlyKeys(value, ['kind', 'target', 'locator', 'action', 'text', 'keys', 'values', 'observe'])
        && isTarget(value.target) && isLocator(value.locator) && isAction(value.action)
        && isSemanticActionPayload(value) && (value.observe === undefined || isObservation(value.observe))
    case 'page.actAt':
      return hasOnlyKeys(value, ['kind', 'target', 'screenshotId', 'action', 'x', 'y', 'deltaX', 'deltaY', 'path', 'observe'])
        && isTarget(value.target) && isNonEmptyString(value.screenshotId) && isPointerAction(value.action)
        && isPointerActionPayload(value) && (value.observe === undefined || isObservation(value.observe))
    case 'page.wait':
      return hasOnlyKeys(value, ['kind', 'target', 'condition'])
        && isTarget(value.target) && isWaitCondition(value.condition)
    default:
      return false
  }
}

/** Validate the child-to-parent browser request message. */
export function isDesktopBrowserRequestMessage(value: unknown): value is DesktopBrowserRequestMessage {
  return isRecord(value) && hasOnlyKeys(value, ['type', 'requestId', 'caller', 'operation'])
    && value.type === 'browser/request' && isRequestId(value.requestId)
    && isCaller(value.caller) && isDesktopBrowserOperation(value.operation)
}

/** Validate the child-to-parent cancellation message. */
export function isDesktopBrowserCancelMessage(value: unknown): value is DesktopBrowserCancelMessage {
  return isRecord(value) && hasOnlyKeys(value, ['type', 'requestId'])
    && value.type === 'browser/cancel' && isRequestId(value.requestId)
}

/** Validate the parent-to-child result message before settling a caller. */
export function isDesktopBrowserResultMessage(value: unknown): value is DesktopBrowserResultMessage {
  return isRecord(value) && hasOnlyKeys(value, ['type', 'requestId', 'result'])
    && value.type === 'browser/result' && isRequestId(value.requestId) && isBrowserResult(value.result)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isCaller(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ['sessionId', 'ownerGeneration'])
    && isNonEmptyString(value.sessionId) && isGeneration(value.ownerGeneration)
}

function isTarget(value: unknown): value is DesktopBrowserTarget {
  return isRecord(value) && hasOnlyKeys(value, ['tabId', 'generation'])
    && isBoundedString(value.tabId, 256) && value.tabId.length > 0 && isGeneration(value.generation)
}

function isLocator(value: unknown): value is DesktopBrowserLocator {
  if (!isRecord(value) || !isBoundedString(value.snapshotId, 256) || value.snapshotId.length === 0) return false
  if (value.kind === 'ref') {
    return hasOnlyKeys(value, ['kind', 'snapshotId', 'ref']) && isBoundedString(value.ref, 256) && value.ref.length > 0
  }
  return value.kind === 'role' && hasOnlyKeys(value, ['kind', 'snapshotId', 'role', 'name', 'exact'])
    && isBoundedString(value.role, 256) && value.role.length > 0 && isBoundedString(value.name, 16_384) && value.exact === true
}

function isReadProperty(value: unknown): value is DesktopBrowserReadProperty {
  return value === 'text' || value === 'attribute' || value === 'visible' || value === 'enabled' || value === 'checked'
}

function isAction(value: unknown): value is DesktopBrowserSemanticAction {
  return value === 'click' || value === 'doubleClick' || value === 'fill' || value === 'type'
    || value === 'press' || value === 'check' || value === 'uncheck' || value === 'select' || value === 'hover'
}

function isSemanticActionPayload(value: Record<string, unknown>): boolean {
  switch (value.action) {
    case 'fill':
    case 'type':
      return isBoundedString(value.text, MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS) && value.keys === undefined && value.values === undefined
    case 'press':
      return Array.isArray(value.keys) && value.keys.length > 0 && value.keys.length <= 64
        && value.keys.every(key => isBoundedString(key, 64))
        && value.text === undefined && value.values === undefined
    case 'select':
      return Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 256
        && value.values.every(option => isBoundedString(option, 16_384))
        && value.text === undefined && value.keys === undefined
    case 'click':
    case 'doubleClick':
    case 'check':
    case 'uncheck':
    case 'hover':
      return value.text === undefined && value.keys === undefined && value.values === undefined
    default:
      return false
  }
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function isPointerAction(value: unknown): value is DesktopBrowserPointerAction {
  return value === 'click' || value === 'doubleClick' || value === 'move' || value === 'scroll' || value === 'drag'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPoint(value: unknown): value is DesktopBrowserPoint {
  return isRecord(value) && hasOnlyKeys(value, ['x', 'y']) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isPointerActionPayload(value: Record<string, unknown>): boolean {
  switch (value.action) {
    case 'click':
    case 'doubleClick':
    case 'move':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y)
        && value.deltaX === undefined && value.deltaY === undefined && value.path === undefined
    case 'scroll':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y)
        && isFiniteNumber(value.deltaX) && isFiniteNumber(value.deltaY) && value.path === undefined
    case 'drag':
      return Array.isArray(value.path) && value.path.length >= 2 && value.path.length <= 256 && value.path.every(isPoint)
        && value.x === undefined && value.y === undefined && value.deltaX === undefined && value.deltaY === undefined
    default:
      return false
  }
}

function isWaitCondition(value: unknown): value is DesktopBrowserWaitCondition {
  if (!isRecord(value)) return false
  if (value.kind === 'load') return hasOnlyKeys(value, ['kind', 'state']) && value.state === 'domcontentloaded'
  if (value.kind === 'url') return hasOnlyKeys(value, ['kind', 'url']) && isHttpUrl(value.url)
  return value.kind === 'element' && hasOnlyKeys(value, ['kind', 'locator', 'state'])
    && isLocator(value.locator) && (value.state === 'visible' || value.state === 'hidden'
      || value.state === 'enabled' || value.state === 'checked')
}

function isObservation(value: unknown): value is DesktopBrowserObservation {
  return isRecord(value) && hasOnlyKeys(value, ['wait', 'screenshot'])
    && (value.wait === undefined || isWaitCondition(value.wait))
    && (value.screenshot === undefined || typeof value.screenshot === 'boolean')
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > 16_384) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function isTabInfo(value: unknown): value is DesktopBrowserTabInfo {
  return isRecord(value) && hasOnlyKeys(value, ['target', 'url', 'title', 'active', 'ownership', 'attached'])
    && isTarget(value.target) && isHttpUrl(value.url) && isBoundedString(value.title, 16_384)
    && typeof value.active === 'boolean' && (value.ownership === 'user' || value.ownership === 'agent')
    && typeof value.attached === 'boolean'
}

function isSnapshot(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ['target', 'snapshotId', 'text', 'truncated'])
    && isTarget(value.target) && isBoundedString(value.snapshotId, 256) && value.snapshotId.length > 0
    && isBoundedString(value.text, MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS) && typeof value.truncated === 'boolean'
}

function isScreenshot(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['target', 'screenshotId', 'bytes', 'viewport'])
    || !isTarget(value.target) || !isBoundedString(value.screenshotId, 256) || value.screenshotId.length === 0
    || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength > MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES
    || !isRecord(value.viewport) || !hasOnlyKeys(value.viewport, ['width', 'height'])) return false
  return isPositiveSafeInteger(value.viewport.width) && isPositiveSafeInteger(value.viewport.height)
}

function isBrowserValue(value: unknown): value is DesktopBrowserValue {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'tabs':
      return hasOnlyKeys(value, ['kind', 'tabs', 'truncated']) && Array.isArray(value.tabs)
        && value.tabs.length <= MAX_DESKTOP_BROWSER_TABS && value.tabs.every(isTabInfo) && typeof value.truncated === 'boolean'
    case 'tab':
      return hasOnlyKeys(value, ['kind', 'tab']) && isTabInfo(value.tab)
    case 'closed':
      return hasOnlyKeys(value, ['kind', 'target', 'closed']) && isTarget(value.target) && value.closed === true
    case 'snapshot':
      return hasOnlyKeys(value, ['kind', 'snapshot']) && isSnapshot(value.snapshot)
    case 'read':
      return hasOnlyKeys(value, ['kind', 'target', 'value', 'truncated']) && isTarget(value.target)
        && (isBoundedString(value.value, MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS) || typeof value.value === 'boolean' || value.value === null)
        && typeof value.truncated === 'boolean'
    case 'action':
      return hasOnlyKeys(value, ['kind', 'target', 'delivered', 'observation', 'screenshot'])
        && isTarget(value.target) && typeof value.delivered === 'boolean'
        && (value.observation === undefined || isSnapshot(value.observation))
        && (value.screenshot === undefined || isScreenshot(value.screenshot))
    case 'wait':
      return hasOnlyKeys(value, ['kind', 'target', 'matched']) && isTarget(value.target) && value.matched === true
    case 'screenshot':
      return hasOnlyKeys(value, ['kind', 'screenshot']) && isScreenshot(value.screenshot)
    default:
      return false
  }
}

function isBrowserResult(value: unknown): value is DesktopBrowserResult {
  if (!isRecord(value)) return false
  if (value.status === 'success') return hasOnlyKeys(value, ['status', 'value']) && isBrowserValue(value.value)
  return value.status === 'error' && hasOnlyKeys(value, ['status', 'code', 'message'])
    && (value.code === 'unavailable' || value.code === 'invalid-request' || value.code === 'invalid-target'
      || value.code === 'stale-target' || value.code === 'unsupported' || value.code === 'timeout'
      || value.code === 'cancelled' || value.code === 'failed')
    && typeof value.message === 'string' && value.message.length <= 4096
}
