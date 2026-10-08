/** Desktop browser automation coordinator implementing page operations for offscreen guests. */
import type { NativeImage, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  DesktopBrowserLocator,
  DesktopBrowserPointerAction,
  DesktopBrowserReadProperty,
  DesktopBrowserScreenshot,
  DesktopBrowserSemanticAction,
  DesktopBrowserSnapshot,
  DesktopBrowserSnapshotId,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
  DesktopBrowserWaitCondition,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import type {
  DesktopBrowserAccessibleAction,
  DesktopBrowserAccessibleNode,
  DesktopBrowserAccessibleSnapshot,
  DesktopBrowserLeaseId,
  DesktopBrowserRef,
  DesktopBrowserViewport,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import {
  buildIsolatedPageScript,
  buildPlaywrightInjectionScript,
  DESKTOP_BROWSER_ISOLATED_WORLD_ID,
  type IsolatedPageRequest,
  type IsolatedSnapshotResult,
} from './browser-isolated-world.ts'
import {
  buildAccessibleTree,
  executeAccessibleAction,
  readElementProperty,
  resolveStrictLocator,
  type ActiveSnapshotSession,
} from './browser-dom-engine.ts'
import {
  dispatchPageKeys,
  dispatchPointerAction,
  insertPageText,
  replacePageText,
} from './browser-input.ts'

export interface AutomationGuestContext {
  readonly owner: WebContents
  readonly guest: WebContents
  readonly lease: DesktopBrowserLeaseId
  readonly target: DesktopBrowserTarget
  readonly viewport: DesktopBrowserViewport
  readonly getLatestImage: () => NativeImage | undefined
  readonly emitAccessibleSnapshot: (snapshot: DesktopBrowserAccessibleSnapshot) => void
}

/** State for one active document automation session on a lease. */
export class AutomationSession {
  private activeSnapshot: ActiveSnapshotSession<Element> | undefined
  private playwrightGeneration: DesktopBrowserTargetGeneration | undefined
  private latestScreenshot: { readonly screenshotId: DesktopBrowserSnapshotId; readonly target: DesktopBrowserTarget } | undefined

  constructor(private readonly ctx: AutomationGuestContext) {}

  private getRoot(): Element | undefined {
    const documentValue = Reflect.get(this.ctx.guest, 'ownerDocument') ?? Reflect.get(globalThis, 'document')
    if (typeof documentValue !== 'object' || documentValue === null) return undefined
    const body = Reflect.get(documentValue, 'body')
    if (this.isElement(body)) return body
    const documentElement = Reflect.get(documentValue, 'documentElement')
    return this.isElement(documentElement) ? documentElement : undefined
  }

  private isElement(value: unknown): value is Element {
    if (typeof value !== 'object' || value === null || !('tagName' in value) || !('getAttribute' in value)) return false
    return typeof value.getAttribute === 'function'
  }
  private async runIsolated(request: IsolatedPageRequest, initializePlaywright = false): Promise<unknown> {
    const scripts: Array<{ code: string }> = []
    if (initializePlaywright) scripts.push({ code: buildPlaywrightInjectionScript() })
    scripts.push({ code: buildIsolatedPageScript(request) })
    return await this.ctx.guest.executeJavaScriptInIsolatedWorld(DESKTOP_BROWSER_ISOLATED_WORLD_ID, scripts)
  }

  private isIsolatedSnapshot(value: unknown): value is IsolatedSnapshotResult {
    return typeof value === 'object' && value !== null
      && 'snapshot' in value && 'text' in value && 'textTruncated' in value
      && typeof value.text === 'string' && typeof value.textTruncated === 'boolean'
      && typeof value.snapshot === 'object' && value.snapshot !== null
      && 'nodes' in value.snapshot && Array.isArray(value.snapshot.nodes)
  }

  /** Create an accessible snapshot and update the renderer mirror. */
  async createSnapshot(target: DesktopBrowserTarget): Promise<DesktopBrowserSnapshot> {
    const snapshotId = randomUUID() as DesktopBrowserSnapshotId
    const root = this.getRoot()
    if (!root) {

      const initializePlaywright = this.playwrightGeneration !== target.generation
      const remote = await this.runIsolated({
        kind: 'snapshot',
        lease: this.ctx.lease,
        snapshotId,
        generation: target.generation,
        target,
      }, initializePlaywright)
      if (!this.isIsolatedSnapshot(remote)) throw new Error('Isolated browser snapshot returned an invalid result')
      this.playwrightGeneration = target.generation
      this.activeSnapshot = {
        snapshotId,
        lease: this.ctx.lease,
        generation: target.generation,
        target,
        snapshot: remote.snapshot,
        formattedText: remote.text,
        textTruncated: remote.textTruncated,
        refMap: new Map(),
      }
      this.ctx.emitAccessibleSnapshot(remote.snapshot)
      return { target, snapshotId, text: remote.text, truncated: remote.textTruncated || remote.snapshot.truncated }
    }

    const { snapshot, formattedText, textTruncated, refMap } = buildAccessibleTree(
      root,
      this.ctx.lease,
      snapshotId,
      target.generation,
    )

    this.activeSnapshot = {
      snapshotId,
      lease: this.ctx.lease,
      generation: target.generation,
      target,
      snapshot,
      formattedText,
      textTruncated,
      refMap,
    }

    this.ctx.emitAccessibleSnapshot(snapshot)
    return {
      target,
      snapshotId,
      text: formattedText,
      truncated: textTruncated || snapshot.truncated,
    }
  }

  /** Read an element property via locator. */
  async readProperty(
    target: DesktopBrowserTarget,
    locator: DesktopBrowserLocator,
    property: DesktopBrowserReadProperty,
    maxChars: number,
    attributeName?: string,
  ): Promise<{ readonly target: DesktopBrowserTarget; readonly value: string | boolean | null; readonly truncated: boolean }> {
    if (!this.activeSnapshot || this.activeSnapshot.snapshotId !== locator.snapshotId
      || this.activeSnapshot.generation !== target.generation) {
      await this.createSnapshot(target)
    }
    const root = this.getRoot()
    if (!root) {
      const remote = await this.runIsolated({
        kind: 'read',
        snapshotId: locator.snapshotId,
        locator,
        property,
        ...attributeName !== undefined ? { attribute: attributeName } : {},
      })
      if (typeof remote !== 'object' || remote === null || !('value' in remote)) {
        throw new Error('Isolated browser read returned an invalid result')
      }
      const raw = remote.value
      if (typeof raw === 'string') {
        const truncated = raw.length > maxChars
        return { target, value: truncated ? raw.slice(0, maxChars) : raw, truncated }
      }
      if (typeof raw !== 'boolean' && raw !== null) throw new Error('Isolated browser read returned an invalid value')
      return { target, value: raw, truncated: false }
    }
    if (!this.activeSnapshot) throw new Error('No active snapshot for read')

    const element = resolveStrictLocator(root, locator, this.activeSnapshot)
    const raw = readElementProperty(element, property, attributeName)
    if (typeof raw === 'string') {
      const truncated = raw.length > maxChars
      const value = truncated ? raw.slice(0, maxChars) : raw
      return { target, value, truncated }
    }
    return { target, value: raw, truncated: false }
  }

  /** Execute a semantic action on an element. */
  async act(
    target: DesktopBrowserTarget,
    locator: DesktopBrowserLocator,
    action: DesktopBrowserSemanticAction,
    options: {
      readonly text?: string | undefined
      readonly keys?: readonly string[] | undefined
      readonly values?: readonly string[] | undefined
    },
  ): Promise<void> {
    if (!this.activeSnapshot || this.activeSnapshot.snapshotId !== locator.snapshotId
      || this.activeSnapshot.generation !== target.generation) {
      await this.createSnapshot(target)
    }
    const root = this.getRoot()
    if (!this.activeSnapshot) throw new Error('No active snapshot for action')
    if (!root) {
      const refs: DesktopBrowserRef[] = []
      const collect = (nodes: readonly DesktopBrowserAccessibleNode[]): void => {
        for (const node of nodes) {
          if (locator.kind === 'ref' && node.ref === locator.ref) refs.push(node.ref)
          if (locator.kind === 'role' && node.role === locator.role && node.name === locator.name && node.ref) refs.push(node.ref)
          collect(node.children)
        }
      }
      collect(this.activeSnapshot.snapshot.nodes)
      if (refs.length === 0) throw new Error('No element matches the locator')
      if (refs.length > 1) throw new Error('Ambiguous locator: multiple elements match')
      const matchedRef = locator.kind === 'ref' ? locator.ref : refs[0]
      if (matchedRef === undefined) throw new Error('No element matches the locator')
      const ref = matchedRef
      if (action === 'fill' && options.text === undefined) throw new Error('Action fill requires text')
      if (action === 'type' && options.text === undefined) throw new Error('Action type requires text')
      if (action === 'press' && (!options.keys || options.keys.length === 0)) throw new Error('Action press requires keys')
      if (action === 'select' && !options.values) throw new Error('Action select requires values')
      if (action === 'click' || action === 'doubleClick' || action === 'hover') {
        const point = await this.runIsolated({ kind: 'resolve', snapshotId: locator.snapshotId, locator })
        if (typeof point !== 'object' || point === null || !('x' in point) || !('y' in point)
          || typeof point.x !== 'number' || typeof point.y !== 'number') {
          throw new Error('Isolated browser locator returned invalid coordinates')
        }
        await dispatchPointerAction(this.ctx.guest, this.ctx.viewport, action === 'hover' ? 'move' : action, { x: point.x, y: point.y })
        await this.createSnapshot(target)
        return
      }
      const remote = await this.runIsolated({
        kind: 'action', snapshotId: locator.snapshotId, ref,
        action: action === 'fill' || action === 'type'
          ? { kind: action, text: options.text ?? '' }
          : action === 'press'
            ? { kind: 'press', keys: options.keys ?? [] }
            : action === 'select'
              ? { kind: 'select', values: options.values ?? [] }
              : { kind: action },
      })
      if (typeof remote !== 'object' || remote === null || !('delivered' in remote) || remote.delivered !== true) {
        throw new Error('Isolated browser action returned an invalid result')
      }
      if (action === 'fill') await replacePageText(this.ctx.guest, options.text ?? '')
      if (action === 'type') await insertPageText(this.ctx.guest, options.text ?? '')
      if (action === 'press') dispatchPageKeys(this.ctx.guest, options.keys ?? [])
      await this.createSnapshot(target)
      return
    }
    const element = resolveStrictLocator(root, locator, this.activeSnapshot)

    switch (action) {
      case 'click':
      case 'doubleClick':
      case 'hover': {
        const rect = element.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 10, height: 10 }
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        await dispatchPointerAction(this.ctx.guest, this.ctx.viewport, action === 'hover' ? 'move' : action, { x, y })
        break
      }
      case 'fill': {
        if (options.text === undefined) throw new Error('Action fill requires text')
        executeAccessibleAction(element, { kind: 'fill', text: options.text })
        break
      }
      case 'type': {
        if (options.text === undefined) throw new Error('Action type requires text')
        await insertPageText(this.ctx.guest, options.text)
        break
      }
      case 'press': {
        if (!options.keys || options.keys.length === 0) throw new Error('Action press requires keys')
        dispatchPageKeys(this.ctx.guest, options.keys)
        break
      }
      case 'check':
      case 'uncheck': {
        executeAccessibleAction(element, { kind: action })
        break
      }
      case 'select': {
        if (!options.values) throw new Error('Action select requires values')
        executeAccessibleAction(element, { kind: 'select', values: options.values })
        break
      }
    }
  }

  /** Execute coordinate-grounded pointer action. */
  async actAt(
    target: DesktopBrowserTarget,
    screenshotId: DesktopBrowserSnapshotId,
    action: DesktopBrowserPointerAction,
    options: {
      readonly x?: number | undefined
      readonly y?: number | undefined
      readonly deltaX?: number | undefined
      readonly deltaY?: number | undefined
      readonly path?: readonly { readonly x: number; readonly y: number }[] | undefined
    },
  ): Promise<void> {
    if (this.latestScreenshot?.screenshotId !== screenshotId
      || this.latestScreenshot.target.tabId !== target.tabId
      || this.latestScreenshot.target.generation !== target.generation) {
      throw new Error(`Screenshot ID "${screenshotId}" is not the latest screenshot for this target`)
    }
    await dispatchPointerAction(this.ctx.guest, this.ctx.viewport, action, options)
  }

  /** Execute accessible screen-reader action. */
  async accessibleAction(
    snapshotId: DesktopBrowserSnapshotId,
    ref: DesktopBrowserRef,
    action: DesktopBrowserAccessibleAction,
  ): Promise<void> {
    if (!this.activeSnapshot || this.activeSnapshot.snapshotId !== snapshotId) {
      throw new Error(`Accessible action snapshotId "${snapshotId}" is expired`)
    }
    const root = this.getRoot()
    if (!root) {
      const remote = await this.runIsolated({ kind: 'action', snapshotId, ref, action })
      if (typeof remote !== 'object' || remote === null || !('delivered' in remote) || remote.delivered !== true) {
        throw new Error('Isolated accessible action returned an invalid result')
      }
      if ('x' in remote && 'y' in remote && typeof remote.x === 'number' && typeof remote.y === 'number') {
        if (action.kind === 'click') await dispatchPointerAction(this.ctx.guest, this.ctx.viewport, 'click', { x: remote.x, y: remote.y })
        else if (action.kind === 'fill') await replacePageText(this.ctx.guest, action.text)
        else if (action.kind === 'type') await insertPageText(this.ctx.guest, action.text)
        else if (action.kind === 'press') dispatchPageKeys(this.ctx.guest, action.keys)
      }
      await this.createSnapshot(this.ctx.target)
      return
    }
    const element = resolveStrictLocator(root, { kind: 'ref', snapshotId, ref }, this.activeSnapshot)
    executeAccessibleAction(element, action)
    await this.createSnapshot(this.ctx.target)
  }

  /** Capture current page screenshot. */
  async captureScreenshot(target: DesktopBrowserTarget): Promise<DesktopBrowserScreenshot> {
    const image = this.ctx.getLatestImage() ?? (await this.ctx.guest.capturePage())
    const pngBuffer = image.toPNG()
    const screenshotId = randomUUID() as DesktopBrowserSnapshotId
    this.latestScreenshot = { screenshotId, target }
    return {
      target,
      screenshotId,
      bytes: new Uint8Array(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength),
      viewport: {
        width: this.ctx.viewport.cssWidth,
        height: this.ctx.viewport.cssHeight,
      },
    }
  }

  /** Await concrete condition. */
  async waitForCondition(target: DesktopBrowserTarget, condition: DesktopBrowserWaitCondition): Promise<void> {
    switch (condition.kind) {
      case 'load': {
        if (!this.ctx.guest.isLoading()) return
        await new Promise<void>((resolve) => {
          this.ctx.guest.once('did-finish-load', () => { resolve() })
        })
        break
      }
      case 'url': {
        if (this.ctx.guest.getURL() === condition.url) return
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.ctx.guest.removeListener('did-finish-load', check)
            reject(new Error(`Timeout waiting for URL: ${condition.url}`))
          }, 10_000)
          const check = () => {
            if (this.ctx.guest.getURL() === condition.url) {
              clearTimeout(timer)
              this.ctx.guest.removeListener('did-finish-load', check)
              resolve()
            }
          }
          this.ctx.guest.on('did-finish-load', check)
        })
        break
      }
      case 'element': {
        const { locator, state } = condition
        const checkState = async (): Promise<boolean> => {
          try {
            const res = await this.readProperty(target, locator, state === 'hidden' ? 'visible' : state, 100)
            if (state === 'hidden') return res.value === false
            if (state === 'visible') return res.value === true
            if (state === 'enabled') return res.value === true
            if (state === 'checked') return res.value === true
            return false
          } catch {
            return state === 'hidden'
          }
        }
        if (await checkState()) return
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            clearInterval(poll)
            reject(new Error(`Timeout waiting for element ${JSON.stringify(locator)} to be ${state}`))
          }, 10_000)
          const poll = setInterval(async () => {
            if (await checkState()) {
              clearTimeout(timeout)
              clearInterval(poll)
              resolve()
            }
          }, 100)
        })
        break
      }
    }
  }
}
