/** Isolated-world DOM semantics, accessible snapshot tree, and strict locator resolution. */
import type {
  DesktopBrowserLocator,
  DesktopBrowserReadProperty,
  DesktopBrowserRef,
  DesktopBrowserSnapshotId,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import type {
  DesktopBrowserAccessibleAction,
  DesktopBrowserAccessibleNode,
  DesktopBrowserAccessibleSnapshot,
  DesktopBrowserLeaseId,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'

/** Hard ceilings for the screen-reader accessibility tree mirror. */
export const MAX_ACCESSIBLE_TREE_NODES = 10_000
export const MAX_ACCESSIBLE_TREE_CHARS = 1_000_000

/** Evaluated snapshot state retaining element references for strict locator resolution. */
export interface ActiveSnapshotSession<E = unknown> {
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly lease: DesktopBrowserLeaseId
  readonly generation: DesktopBrowserTargetGeneration
  readonly target: DesktopBrowserTarget
  readonly snapshot: DesktopBrowserAccessibleSnapshot
  readonly formattedText: string
  readonly textTruncated: boolean
  readonly refMap: Map<string, E>
}

/** Determine default ARIA role for an HTML element when role attribute is not explicit. */
export function inferElementRole(element: Element): string {
  const explicit = element.getAttribute('role')
  if (explicit && explicit.trim().length > 0) return explicit.trim().toLowerCase()
  const tag = element.tagName.toUpperCase()
  if (tag === 'BUTTON') return 'button'
  if (tag === 'A' && element.hasAttribute('href')) return 'link'
  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  if (tag === 'TEXTAREA') return 'textbox'
  if (tag === 'SELECT') return 'combobox'
  if (/^H[1-6]$/.test(tag)) return 'heading'
  if (tag === 'IMG') return 'img'
  if (tag === 'FORM') return 'form'
  if (tag === 'NAV') return 'navigation'
  if (tag === 'MAIN') return 'main'
  if (tag === 'ARTICLE') return 'article'
  if (tag === 'SECTION') return 'region'
  if (tag === 'ASIDE') return 'complementary'
  if (tag === 'HEADER') return 'banner'
  if (tag === 'FOOTER') return 'contentinfo'
  if (tag === 'UL' || tag === 'OL') return 'list'
  if (tag === 'LI') return 'listitem'
  if (tag === 'TABLE') return 'table'
  if (tag === 'DIALOG') return 'dialog'
  return 'generic'
}

/** Compute accessible name for an element. */
export function computeAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel && ariaLabel.trim().length > 0) return ariaLabel.trim()

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy && element.ownerDocument) {
    const labels = labelledBy.split(/\s+/).map(id => element.ownerDocument?.getElementById(id)?.textContent?.trim()).filter(Boolean)
    if (labels.length > 0) return labels.join(' ')
  }

  const tag = element.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const placeholder = element.getAttribute('placeholder')
    const nameAttr = element.getAttribute('name')
    const title = element.getAttribute('title')
    const id = element.getAttribute('id')
    if (id && element.ownerDocument) {
      const label = element.ownerDocument.querySelector(`label[for="${id}"]`)
      if (label?.textContent?.trim()) return label.textContent.trim()
    }
    const parentLabel = element.closest('label')
    if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim()
    if (placeholder?.trim()) return placeholder.trim()
    if (title?.trim()) return title.trim()
    if (nameAttr?.trim()) return nameAttr.trim()
  }

  const title = element.getAttribute('title')
  if (title && title.trim().length > 0) return title.trim()

  const alt = element.getAttribute('alt')
  if (alt && alt.trim().length > 0) return alt.trim()

  const text = element.textContent?.trim()
  if (text && text.length > 0 && text.length < 120) return text

  return ''
}

/** Compute element interaction states. */
export function computeElementStates(element: Element): string[] {
  const states: string[] = []
  if (element.hasAttribute('disabled') || (element as { disabled?: boolean }).disabled) states.push('disabled')
  if ((element as { checked?: boolean }).checked) states.push('checked')
  if (element.getAttribute('aria-expanded') === 'true') states.push('expanded')
  if (element.getAttribute('aria-selected') === 'true') states.push('selected')
  if (element.hasAttribute('readonly') || (element as { readOnly?: boolean }).readOnly) states.push('readonly')
  if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden')) states.push('hidden')
  return states
}

/** Build a bounded accessible node tree and formatted snapshot text from DOM elements. */
export function buildAccessibleTree(
  root: Element,
  lease: DesktopBrowserLeaseId,
  snapshotId: DesktopBrowserSnapshotId,
  generation: DesktopBrowserTargetGeneration,
): {
  readonly snapshot: DesktopBrowserAccessibleSnapshot
  readonly formattedText: string
  readonly textTruncated: boolean
  readonly refMap: Map<string, Element>
} {
  let nodeCount = 0
  let totalChars = 0
  let refSeq = 1
  let treeTruncated = false
  const refMap = new Map<string, Element>()
  const textLines: string[] = []

  function visit(element: Element, depth: number): DesktopBrowserAccessibleNode | null {
    if (treeTruncated) return null
    if (nodeCount >= MAX_ACCESSIBLE_TREE_NODES || totalChars >= MAX_ACCESSIBLE_TREE_CHARS) {
      treeTruncated = true
      return null
    }

    nodeCount++
    const role = inferElementRole(element)
    const name = computeAccessibleName(element)
    const states = computeElementStates(element)
    const textContent = (element.firstElementChild === null ? element.textContent?.trim() : undefined) || undefined
    const value = (element as { value?: unknown }).value !== undefined ? String((element as { value?: unknown }).value) : undefined

    totalChars += role.length + name.length + (textContent?.length ?? 0) + (value?.length ?? 0)

    let ref: DesktopBrowserRef | undefined
    if (!treeTruncated) {
      const refStr = `ref-${refSeq++}`
      ref = refStr as DesktopBrowserRef
      refMap.set(refStr, element)
    }

    const indent = '  '.repeat(depth)
    const stateStr = states.length > 0 ? ` [${states.join(', ')}]` : ''
    const refStr = ref ? ` [${ref}]` : ' [truncated]'
    const nameStr = name.length > 0 ? ` "${name}"` : ''
    textLines.push(`${indent}- ${role}${nameStr}${refStr}${stateStr}`)

    const children: DesktopBrowserAccessibleNode[] = []
    let childEl = element.firstElementChild
    while (childEl) {
      if (treeTruncated) break
      const childNode = visit(childEl, depth + 1)
      if (childNode) children.push(childNode)
      childEl = childEl.nextElementSibling
    }

    return {
      snapshotId,
      ...ref ? { ref } : {},
      role,
      name,
      ...textContent ? { text: textContent } : {},
      ...value !== undefined ? { value } : {},
      states,
      children,
    }
  }

  const rootNode = visit(root, 0)
  const nodes = rootNode ? [rootNode] : []
  const fullText = textLines.join('\n')
  const maxTextChars = 1_000_000
  const textTruncated = fullText.length > maxTextChars
  const formattedText = textTruncated ? fullText.slice(0, maxTextChars) : fullText

  const snapshot: DesktopBrowserAccessibleSnapshot = {
    lease,
    snapshotId,
    generation,
    nodes,
    truncated: treeTruncated || textTruncated,
  }

  return { snapshot, formattedText, textTruncated, refMap }
}

/** Strictly resolve an element target using either snapshot ref or role/name uniqueness. */
export function resolveStrictLocator(
  root: Element,
  locator: DesktopBrowserLocator,
  activeSnapshot: ActiveSnapshotSession<Element>,
): Element {
  if (locator.kind === 'ref') {
    if (locator.snapshotId !== activeSnapshot.snapshotId) {
      throw new Error(`Locator snapshot id "${locator.snapshotId}" does not match active snapshot "${activeSnapshot.snapshotId}"`)
    }
    const element = activeSnapshot.refMap.get(locator.ref)
    if (!element || !element.isConnected) {
      throw new Error(`Locator reference "${locator.ref}" is stale or disconnected`)
    }
    return element
  }

  if (locator.kind === 'role') {
    if (locator.snapshotId !== activeSnapshot.snapshotId) {
      throw new Error(`Locator snapshot id "${locator.snapshotId}" does not match active snapshot "${activeSnapshot.snapshotId}"`)
    }
    const matching: Element[] = []
    const all = root.querySelectorAll('*')
    for (let i = 0; i < all.length; i++) {
      const el = all[i]
      if (el && inferElementRole(el) === locator.role.toLowerCase() && computeAccessibleName(el) === locator.name) {
        matching.push(el)
      }
    }
    if (matching.length === 0) {
      throw new Error(`No element found matching role "${locator.role}" and name "${locator.name}"`)
    }
    if (matching.length > 1) {
      throw new Error(`Ambiguous match: found ${matching.length} elements matching role "${locator.role}" and name "${locator.name}"`)
    }
    const element = matching[0]
    if (element === undefined) throw new Error(`No element found matching role "${locator.role}" and name "${locator.name}"`)
    return element
  }

  throw new Error(`Unsupported locator kind: ${(locator as { kind: string }).kind}`)
}

/** Read fixed element property value. */
export function readElementProperty(
  element: Element,
  property: DesktopBrowserReadProperty,
  attributeName?: string,
): string | boolean | null {
  switch (property) {
    case 'text':
      return element.textContent?.trim() ?? ''
    case 'attribute': {
      if (!attributeName || attributeName.trim().length === 0) {
        throw new Error('Attribute property read requires attribute name')
      }
      if (attributeName === 'value' && 'value' in element) {
        return String((element as { value?: unknown }).value ?? '')
      }
      return element.getAttribute(attributeName)
    }
    case 'visible': {
      const style = (element.ownerDocument?.defaultView ?? globalThis).getComputedStyle?.(element)
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false
      return !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true'
    }
    case 'enabled':
      return !element.hasAttribute('disabled') && !(element as { disabled?: boolean }).disabled
    case 'checked':
      return Boolean((element as { checked?: boolean }).checked)
  }
}

/** Execute a semantic accessible action on an element. */
export function executeAccessibleAction(
  element: Element,
  action: DesktopBrowserAccessibleAction,
): void {
  switch (action.kind) {
    case 'focus': {
      const focus = Reflect.get(element, 'focus')
      if (typeof focus === 'function') Reflect.apply(focus, element, [])
      break
    }
    case 'click': {
      const click = Reflect.get(element, 'click')
      if (typeof click === 'function') {
        Reflect.apply(click, element, [])
      } else {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
      break
    }
    case 'check': {
      const input = element as { checked?: boolean }
      input.checked = true
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      break
    }
    case 'uncheck': {
      const input = element as { checked?: boolean }
      input.checked = false
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      break
    }
    case 'fill': {
      const input = element as { value?: string }
      input.value = action.text
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      break
    }
    case 'type': {
      const input = element as { value?: string }
      input.value = (input.value ?? '') + action.text
      element.dispatchEvent(new Event('input', { bubbles: true }))
      break
    }
    case 'press': {
      for (const key of action.keys) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
      }
      break
    }
    case 'select': {
      const select = element as HTMLSelectElement
      if (select.tagName?.toUpperCase() === 'SELECT' && select.options) {
        for (let i = 0; i < select.options.length; i++) {
          const opt = select.options[i]
          if (opt) opt.selected = action.values.includes(opt.value)
        }
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      break
    }
  }
}
