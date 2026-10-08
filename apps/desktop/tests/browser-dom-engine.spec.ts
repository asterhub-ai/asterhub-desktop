// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  DesktopBrowserRef,
  DesktopBrowserSnapshotId,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import type { DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import {
  buildAccessibleTree,
  executeAccessibleAction,
  readElementProperty,
  resolveStrictLocator,
  MAX_ACCESSIBLE_TREE_NODES,
  type ActiveSnapshotSession,
} from '../src/browser-dom-engine.ts'

const LEASE = brandString<DesktopBrowserLeaseId>('test-lease')
const SNAPSHOT_A = brandString<DesktopBrowserSnapshotId>('snap-a')
const SNAPSHOT_B = brandString<DesktopBrowserSnapshotId>('snap-b')
const GEN = brandNumber<DesktopBrowserTargetGeneration>(1)

describe('browser-dom-engine', () => {
  it('builds a structured accessible tree and assigns valid refs', () => {
    document.body.innerHTML = `
      <div id="container">
        <h1>Page Title</h1>
        <form>
          <label for="username">Username</label>
          <input id="username" name="user" type="text" value="alice" />
          <input id="agree" type="checkbox" checked />
          <button type="submit">Submit</button>
        </form>
      </div>
    `
    const { snapshot, formattedText, refMap } = buildAccessibleTree(document.body, LEASE, SNAPSHOT_A, GEN)

    expect(snapshot.lease).toBe(LEASE)
    expect(snapshot.snapshotId).toBe(SNAPSHOT_A)
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.nodes.length).toBe(1)
    expect(refMap.size).toBeGreaterThan(0)
    expect(formattedText).toContain('- heading "Page Title"')
    expect(formattedText).toContain('- button "Submit"')

    const buttonRef = snapshot.nodes[0]?.children?.[0]?.children?.[1]?.children?.[3]?.ref
    expect(buttonRef).toBeDefined()
    expect(refMap.get(buttonRef!)).toBe(document.querySelector('button'))
  })

  it('caps tree at 10,000 nodes and omits refs from truncated nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span>item</span>'.repeat(MAX_ACCESSIBLE_TREE_NODES + 50)

    const { snapshot, refMap } = buildAccessibleTree(root, LEASE, SNAPSHOT_A, GEN)
    expect(snapshot.truncated).toBe(true)
    expect(refMap.size).toBeLessThanOrEqual(MAX_ACCESSIBLE_TREE_NODES)
  })

  it('resolves valid ref and rejects stale or mismatched snapshotId', () => {
    document.body.innerHTML = '<button id="btn">Click</button>'
    const { snapshot, formattedText, textTruncated, refMap } = buildAccessibleTree(document.body, LEASE, SNAPSHOT_A, GEN)
    const buttonRef = refMap.get('ref-2') ? brandString<DesktopBrowserRef>('ref-2') : brandString<DesktopBrowserRef>('ref-1')

    const activeSession: ActiveSnapshotSession<Element> = {
      snapshotId: SNAPSHOT_A,
      lease: LEASE,
      generation: GEN,
      target: { tabId: brandString('tab-1'), generation: GEN } as unknown as DesktopBrowserTarget,
      snapshot,
      formattedText,
      textTruncated,
      refMap,
    }

    const resolved = resolveStrictLocator(document.body, { kind: 'ref', snapshotId: SNAPSHOT_A, ref: buttonRef }, activeSession)
    expect(resolved).toBe(document.getElementById('btn'))

    expect(() => {
      resolveStrictLocator(document.body, { kind: 'ref', snapshotId: SNAPSHOT_B, ref: buttonRef }, activeSession)
    }).toThrow(/does not match active snapshot/)

    expect(() => {
      resolveStrictLocator(document.body, { kind: 'ref', snapshotId: SNAPSHOT_A, ref: brandString<DesktopBrowserRef>('ref-stale') }, activeSession)
    }).toThrow(/is stale or disconnected/)
  })

  it('resolves unique role and name strictly, rejecting duplicates as ambiguous', () => {
    document.body.innerHTML = `
      <button>Submit</button>
      <button>Cancel</button>
      <button>Duplicate</button>
      <button>Duplicate</button>
    `
    const { snapshot, formattedText, textTruncated, refMap } = buildAccessibleTree(document.body, LEASE, SNAPSHOT_A, GEN)
    const activeSession: ActiveSnapshotSession<Element> = {
      snapshotId: SNAPSHOT_A,
      lease: LEASE,
      generation: GEN,
      target: { tabId: brandString('tab-1'), generation: GEN } as unknown as DesktopBrowserTarget,
      snapshot,
      formattedText,
      textTruncated,
      refMap,
    }

    const submitBtn = resolveStrictLocator(
      document.body,
      { kind: 'role', snapshotId: SNAPSHOT_A, role: 'button', name: 'Submit', exact: true },
      activeSession,
    )
    expect(submitBtn.textContent).toBe('Submit')

    expect(() => {
      resolveStrictLocator(
        document.body,
        { kind: 'role', snapshotId: SNAPSHOT_A, role: 'button', name: 'Duplicate', exact: true },
        activeSession,
      )
    }).toThrow(/Ambiguous match: found 2 elements/)

    expect(() => {
      resolveStrictLocator(
        document.body,
        { kind: 'role', snapshotId: SNAPSHOT_A, role: 'button', name: 'Missing', exact: true },
        activeSession,
      )
    }).toThrow(/No element found matching role/)
  })

  it('reads text, attribute, visible, enabled, and checked properties accurately', () => {
    document.body.innerHTML = `
      <input id="inp" type="checkbox" name="field" data-custom="value123" checked disabled />
      <span id="txt">Hello World</span>
      <div id="hidden-div" hidden>Secret</div>
    `
    const input = document.getElementById('inp')!
    const textSpan = document.getElementById('txt')!
    const hiddenDiv = document.getElementById('hidden-div')!

    expect(readElementProperty(textSpan, 'text')).toBe('Hello World')
    expect(readElementProperty(input, 'attribute', 'data-custom')).toBe('value123')
    expect(readElementProperty(input, 'checked')).toBe(true)
    expect(readElementProperty(input, 'enabled')).toBe(false)
    expect(readElementProperty(hiddenDiv, 'visible')).toBe(false)
    expect(readElementProperty(textSpan, 'visible')).toBe(true)
  })

  it('executes accessible actions (click, fill, type, check, uncheck, select)', () => {
    document.body.innerHTML = `
      <input id="text-input" type="text" value="" />
      <input id="cb" type="checkbox" />
      <select id="sel">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    `
    const textInput = document.getElementById('text-input') as HTMLInputElement
    const checkbox = document.getElementById('cb') as HTMLInputElement
    const select = document.getElementById('sel') as HTMLSelectElement

    executeAccessibleAction(textInput, { kind: 'fill', text: 'new text' })
    expect(textInput.value).toBe('new text')

    executeAccessibleAction(textInput, { kind: 'type', text: '!' })
    expect(textInput.value).toBe('new text!')

    executeAccessibleAction(checkbox, { kind: 'check' })
    expect(checkbox.checked).toBe(true)

    executeAccessibleAction(checkbox, { kind: 'uncheck' })
    expect(checkbox.checked).toBe(false)

    executeAccessibleAction(select, { kind: 'select', values: ['b'] })
    expect(select.value).toBe('b')
  })
})
