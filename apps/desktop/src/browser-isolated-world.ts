/** Fixed script builder for isolated-world page inspection and semantic actions. */
import { PLAYWRIGHT_INJECTED_SOURCE } from './generated/playwright-injected-source.ts'
import type {
  DesktopBrowserAccessibleAction,
  DesktopBrowserAccessibleSnapshot,
  DesktopBrowserLeaseId,
  DesktopBrowserSnapshotId,
  DesktopBrowserTargetGeneration,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import type {
  DesktopBrowserLocator,
  DesktopBrowserReadProperty,
  DesktopBrowserTarget,
} from '@deepseek-ai/dsh-browser-use-desktop/types'

/** Construct the pinned Playwright injected engine in one guest's isolated world. */
export function buildPlaywrightInjectionScript(): string {
  return `(() => {
    const key = '__dshPlaywrightInjected'
    if (Reflect.get(globalThis, key)) return true
    const module = {}
    ${PLAYWRIGHT_INJECTED_SOURCE}
    const options = {
      isUnderTest: false,
      sdkLanguage: 'javascript',
      testIdAttributeName: 'data-testid',
      stableRafCount: 1,
      browserName: 'chromium',
      isUtilityWorld: true,
      customEngines: [],
    }
    const injected = new (module.exports.InjectedScript())(globalThis, options)
    Reflect.set(globalThis, key, injected)
    return true
  })()`
}

const WORLD_ID = 8_101
const MAX_NODES = 10_000
const MAX_CHARS = 1_000_000

export interface IsolatedSnapshotResult {
  readonly snapshot: DesktopBrowserAccessibleSnapshot
  readonly text: string
  readonly textTruncated: boolean
}

export interface IsolatedReadRequest {
  readonly kind: 'read'
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly locator: DesktopBrowserLocator
  readonly property: DesktopBrowserReadProperty
  readonly attribute?: string | undefined
}

export interface IsolatedResolveRequest {
  readonly kind: 'resolve'
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly locator: DesktopBrowserLocator
}

export interface IsolatedActionRequest {
  readonly kind: 'action'
  readonly snapshotId: DesktopBrowserSnapshotId
  readonly ref: string
  readonly action: DesktopBrowserAccessibleAction
}

export type IsolatedPageRequest =
  | {
    readonly kind: 'snapshot'
    readonly lease: DesktopBrowserLeaseId
    readonly snapshotId: DesktopBrowserSnapshotId
    readonly generation: DesktopBrowserTargetGeneration
    readonly target: DesktopBrowserTarget
  }
  | IsolatedReadRequest
  | IsolatedResolveRequest
  | IsolatedActionRequest

/** Build a fixed page operation; page data is always passed as JSON arguments. */
export function buildIsolatedPageScript(request: IsolatedPageRequest): string {
  const serialized = JSON.stringify(request)
  return `(() => {
    const operation = ${serialized};
    const key = '__dshBrowserAutomation';
    const existing = Reflect.get(globalThis, key);
    const state = existing && typeof existing === 'object'
      ? existing
      : { snapshotId: '', generation: 0, nodes: new Map() };
    Reflect.set(globalThis, key, state);

    function roleOf(element) {
      const explicit = element.getAttribute('role');
      if (explicit && explicit.trim()) return explicit.trim().toLowerCase();
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        return type === 'search' ? 'searchbox' : 'textbox';
      }
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img') return 'img';
      if (tag === 'form') return 'form';
      if (tag === 'nav') return 'navigation';
      if (tag === 'main') return 'main';
      if (tag === 'article') return 'article';
      if (tag === 'section') return 'region';
      if (tag === 'aside') return 'complementary';
      if (tag === 'header') return 'banner';
      if (tag === 'footer') return 'contentinfo';
      return 'generic';
    }

    function nameOf(element) {
      const label = element.getAttribute('aria-label');
      if (label && label.trim()) return label.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent?.trim() || '').filter(Boolean).join(' ');
        if (text) return text;
      }
      if (element.labels && element.labels.length) {
        const labels = Array.from(element.labels).map(item => item.textContent?.trim() || '').filter(Boolean).join(' ');
        if (labels) return labels;
      }
      for (const attribute of ['alt', 'title', 'placeholder']) {
        const value = element.getAttribute(attribute);
        if (value && value.trim()) return value.trim();
      }
      return element.children.length === 0 ? (element.textContent || '').trim() : '';
    }

    function visible(element) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true';
    }

    function statesOf(element) {
      const states = [];
      if (element.hasAttribute('disabled') || element.disabled === true) states.push('disabled');
      if (element.hasAttribute('readonly') || element.readOnly === true) states.push('readonly');
      if (element.checked === true) states.push('checked');
      if (element.tabIndex >= 0) states.push('focusable');
      if (visible(element)) states.push('visible');
      return states;
    }

    function resolve(locator) {
      if (!locator || locator.snapshotId !== state.snapshotId) throw new Error('Locator snapshot is expired');
      if (locator.kind === 'ref') {
        const element = state.nodes.get(locator.ref);
        if (!element) throw new Error('Locator ref is not a member of the active snapshot');
        return element;
      }
      if (locator.kind === 'role') {
        const candidates = Array.from(state.nodes.values()).filter(element =>
          roleOf(element) === locator.role && nameOf(element) === locator.name);
        if (candidates.length === 0) throw new Error('No element matches the locator');
        if (candidates.length > 1) throw new Error('Ambiguous locator: multiple elements match');
        return candidates[0];
      }
      throw new Error('Unsupported locator kind');
    }

    if (operation.kind === 'snapshot') {
      state.snapshotId = operation.snapshotId;
      state.generation = operation.generation;
      state.nodes = new Map();
      let visited = 0;
      let chars = 0;
      let truncated = false;
      let sequence = 1;
      const textLines = [];
      const visit = (element, depth) => {
        if (visited >= ${MAX_NODES} || chars >= ${MAX_CHARS}) {
          truncated = true;
          return null;
        }
        visited += 1;
        const role = roleOf(element);
        const name = nameOf(element);
        const states = statesOf(element);
        const text = element.children.length === 0 ? (element.textContent || '').trim() : '';
        const value = 'value' in element ? String(element.value ?? '') : '';
        const ref = 'ref-' + sequence++;
        state.nodes.set(ref, element);
        const node = {
          snapshotId: operation.snapshotId,
          ref,
          role,
          name,
          ...(text ? { text } : {}),
          ...(value ? { value } : {}),
          states,
          children: [],
        };
        chars += role.length + name.length + text.length + value.length;
        textLines.push('  '.repeat(depth) + '- ' + role + (name ? ' "' + name + '"' : '') + ' [' + ref + ']' + (states.length ? ' [' + states.join(', ') + ']' : ''));
        if (chars > ${MAX_CHARS}) {
          truncated = true;
          delete node.ref;
          state.nodes.delete(ref);
          return node;
        }
        for (const child of Array.from(element.children)) {
          const childNode = visit(child, depth + 1);
          if (childNode) node.children.push(childNode);
          if (truncated) break;
        }
        return node;
      };
      const root = document.body || document.documentElement;
      const nodes = root ? [visit(root, 0)].filter(Boolean) : [];
      const injected = Reflect.get(globalThis, '__dshPlaywrightInjected');
      const ariaText = injected && typeof injected.ariaSnapshot === 'function'
        ? injected.ariaSnapshot(root, { mode: 'default' })
        : '';
      const text = typeof ariaText === 'string' ? ariaText : textLines.join('\\n');
      const textTruncated = text.length > ${MAX_CHARS};
      return {
        snapshot: { lease: operation.lease, snapshotId: operation.snapshotId, generation: operation.generation, nodes, truncated },
        text: textTruncated ? text.slice(0, ${MAX_CHARS}) : text,
        textTruncated,
      };
    }

    if (operation.kind === 'read') {
      const element = resolve(operation.locator);
      switch (operation.property) {
        case 'text': return { value: (element.textContent || '').trim() };
        case 'attribute':
          if (!operation.attribute) throw new Error('Attribute property read requires attribute name');
          return { value: operation.attribute === 'value' && 'value' in element
            ? String(element.value ?? '') : element.getAttribute(operation.attribute) };
        case 'visible': return { value: visible(element) };
        case 'enabled': return { value: !element.hasAttribute('disabled') && element.disabled !== true };
        case 'checked': return { value: element.checked === true };
      }
    }

    if (operation.kind === 'resolve') {
      const element = resolve(operation.locator);
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: visible(element) };
    }

    if (operation.kind === 'action') {
      if (operation.snapshotId !== state.snapshotId) throw new Error('Accessible action snapshot is expired');
      const element = state.nodes.get(operation.ref);
      if (!element) throw new Error('Accessible action ref is not a member of the active snapshot');
      switch (operation.action.kind) {
        case 'focus': element.focus(); return { delivered: true };
        case 'fill': {
          if (!('value' in element)) throw new Error('Fill target is not an input element');
          element.focus();
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, delivered: true };
        }
        case 'type': element.focus(); return { x: element.getBoundingClientRect().left, y: element.getBoundingClientRect().top, delivered: true };
        case 'press': element.focus(); return { delivered: true };
        case 'click': return { x: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2, y: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2, delivered: true };
        case 'check':
        case 'uncheck':
          if (!('checked' in element)) throw new Error('Check target is not a checkbox');
          element.checked = operation.action.kind === 'check';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { delivered: true };
        case 'select':
          if (element.tagName.toLowerCase() !== 'select') throw new Error('Select target is not a select element');
          for (const option of Array.from(element.options)) option.selected = operation.action.values.includes(option.value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { delivered: true };
      }
    }
    throw new Error('Unsupported isolated browser operation');
  })()`
}

/** Electron isolated world identifier used exclusively by one offscreen guest. */
export const DESKTOP_BROWSER_ISOLATED_WORLD_ID = WORLD_ID
