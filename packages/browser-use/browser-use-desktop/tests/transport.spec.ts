import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { isDesktopBrowserOperation, isDesktopBrowserResultMessage, MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES } from '../src/protocol.ts'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  DesktopBrowserCaller,
  DesktopBrowserCancelMessage,
  DesktopBrowserOperation,
  DesktopBrowserRequestMessage,
  DesktopBrowserResult,
  DesktopBrowserResultMessage,
  DesktopBrowserSnapshotId,
  DesktopBrowserTabId,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
  DesktopBrowserOwnerGeneration,
} from '../src/types.ts'
import { createDesktopBrowserTransport } from '../src/transport.ts'
import type { DesktopBrowserTransport } from '../src/types.ts'

interface BrowserPortFixture {
  readonly transport: DesktopBrowserTransport
  readonly sent: Array<DesktopBrowserRequestMessage | DesktopBrowserCancelMessage>
  emit(message: unknown): void
  disconnect(): void
  listenerCount(): number
}

function browserPort(): BrowserPortFixture {
  const messages = new EventEmitter()
  const lifecycle = new EventEmitter()
  const sent: Array<DesktopBrowserRequestMessage | DesktopBrowserCancelMessage> = []
  let connected = true
  const transport = createDesktopBrowserTransport({
    async send(message) { sent.push(message) },
    subscribe(listener) {
      const onMessage = (message: unknown): void => { listener(message) }
      messages.on('message', onMessage)
      return () => { messages.off('message', onMessage) }
    },
    onDisconnect(listener) {
      lifecycle.once('disconnect', listener)
      return () => { lifecycle.off('disconnect', listener) }
    },
    connected: () => connected,
  })
  return {
    transport,
    sent,
    emit: message => { messages.emit('message', message) },
    disconnect() { connected = false; lifecycle.emit('disconnect') },
    listenerCount: () => messages.listenerCount('message') + lifecycle.listenerCount('disconnect'),
  }
}

function caller(sessionId: string, ownerGeneration: number): DesktopBrowserCaller {
  return {
    sessionId: SessionId(sessionId),
    ownerGeneration: brandNumber<DesktopBrowserOwnerGeneration>(ownerGeneration),
  }
}

function target(tabId: string, generation: number): DesktopBrowserTarget {
  return {
    tabId: brandString<DesktopBrowserTabId>(tabId),
    generation: brandNumber<DesktopBrowserTargetGeneration>(generation),
  }
}

function readOperation(tab: string, generation: number, snapshot: string): DesktopBrowserOperation {
  return {
    kind: 'page.read',
    target: target(tab, generation),
    locator: {
      kind: 'role',
      snapshotId: brandString<DesktopBrowserSnapshotId>(snapshot),
      role: 'heading',
      name: 'Result',
      exact: true,
    },
    property: 'text',
    maxChars: 50_000,
  }
}

function readResult(tab: string, generation: number, value: string): DesktopBrowserResult {
  return { status: 'success', value: { kind: 'read', target: target(tab, generation), value, truncated: false } }
}

function resultMessage(requestId: number, result: DesktopBrowserResult): DesktopBrowserResultMessage {
  return { type: 'browser/result', requestId, result }
}

function requests(sent: readonly (DesktopBrowserRequestMessage | DesktopBrowserCancelMessage)[]): DesktopBrowserRequestMessage[] {
  return sent.filter((message): message is DesktopBrowserRequestMessage => message.type === 'browser/request')
}

function cancels(sent: readonly (DesktopBrowserRequestMessage | DesktopBrowserCancelMessage)[]): DesktopBrowserCancelMessage[] {
  return sent.filter((message): message is DesktopBrowserCancelMessage => message.type === 'browser/cancel')
}

describe('Desktop Browser transport', () => {

  it('accepts the protocol screenshot byte ceiling and rejects one byte above it', () => {
    const large = new Uint8Array(MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES + 1)
    const screenResult = (bytes: Uint8Array) => ({
      type: 'browser/result',
      requestId: 1,
      result: { status: 'success', value: { kind: 'screenshot', screenshot: {
        target: target('tab-a', 1),
        screenshotId: brandString<DesktopBrowserSnapshotId>('snapshot-a'),
        bytes,
        viewport: { width: 1280, height: 820 },
      } } },
    })
    expect(isDesktopBrowserResultMessage(screenResult(new Uint8Array(large.buffer, 0, MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES)))).toBe(true)
    expect(isDesktopBrowserResultMessage(screenResult(large))).toBe(false)
  })
  it('correlates concurrent responses to their exact caller and target', async () => {
    const port = browserPort()
    const first = port.transport.request(caller('session-a', 1), readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal)
    const second = port.transport.request(caller('session-b', 2), readOperation('tab-b', 2, 'snapshot-b'), new AbortController().signal)
    const [firstRequest, secondRequest] = requests(port.sent)
    expect(firstRequest).toBeDefined()
    expect(secondRequest).toBeDefined()

    port.emit(resultMessage(secondRequest!.requestId, readResult('tab-b', 2, 'second')))
    port.emit(resultMessage(firstRequest!.requestId, readResult('tab-a', 1, 'first')))

    await expect(first).resolves.toEqual(readResult('tab-a', 1, 'first'))
    await expect(second).resolves.toEqual(readResult('tab-b', 2, 'second'))
    await port.transport.dispose()
    expect(port.listenerCount()).toBe(0)
  })

  it('cancels only the disposed owner generation and ignores its late result', async () => {
    const port = browserPort()
    const owner = caller('session-a', 1)
    const nextOwner = caller('session-a', 2)
    const expired = port.transport.request(owner, readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal)
    const live = port.transport.request(nextOwner, readOperation('tab-b', 2, 'snapshot-b'), new AbortController().signal)
    const [expiredRequest, liveRequest] = requests(port.sent)
    expect(expiredRequest).toBeDefined()
    expect(liveRequest).toBeDefined()

    let releaseSettled = false
    const release = port.transport.releaseOwner(owner).then(() => { releaseSettled = true })
    await expect(expired).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancels(port.sent)).toEqual([{ type: 'browser/cancel', requestId: expiredRequest!.requestId }])
    expect(releaseSettled).toBe(false)

    port.emit(resultMessage(expiredRequest!.requestId, { status: 'error', code: 'cancelled', message: 'cancelled' }))
    expect(releaseSettled).toBe(false)
    await release
    expect(releaseSettled).toBe(true)
    port.emit(resultMessage(expiredRequest!.requestId, readResult('tab-a', 1, 'late')))
    port.emit(resultMessage(liveRequest!.requestId, readResult('tab-b', 2, 'current')))
    await expect(live).resolves.toEqual(readResult('tab-b', 2, 'current'))
    await port.transport.dispose()
    expect(port.listenerCount()).toBe(0)
  })

  it('rejects pending calls and detaches its listener on disposal', async () => {
    const port = browserPort()
    const pending = port.transport.request(caller('session-a', 1), readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal)
    expect(requests(port.sent)).toHaveLength(1)

    let disposalSettled = false
    const disposing = port.transport.dispose().then(() => { disposalSettled = true })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const [request] = requests(port.sent)
    expect(request).toBeDefined()
    port.emit(resultMessage(request!.requestId, { status: 'error', code: 'cancelled', message: 'cancelled' }))
    expect(disposalSettled).toBe(false)
    await disposing
    expect(disposalSettled).toBe(true)
    expect(port.listenerCount()).toBe(0)
    await expect(port.transport.request(caller('session-a', 1), readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal))
      .rejects.toThrow('disposed')
  })


  it('settles owner release when the Electron parent disconnects', async () => {
    const port = browserPort()
    const owner = caller('session-a', 1)
    const pending = port.transport.request(owner, readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal)
    const releasing = port.transport.releaseOwner(owner)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    port.disconnect()

    await expect(releasing).resolves.toBeUndefined()
    expect(port.listenerCount()).toBe(0)
  })

  it('rejects a structurally valid result for a different tab generation', async () => {
    const port = browserPort()
    const pending = port.transport.request(caller('session-a', 1), readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal)
    const [request] = requests(port.sent)
    expect(request).toBeDefined()

    port.emit(resultMessage(request!.requestId, readResult('tab-b', 2, 'wrong target')))

    await expect(pending).rejects.toThrow('different browser target')
    await port.transport.dispose()
  })

  it('bounds text results and tab inventories at the IPC boundary', () => {
    const pageTarget = target('tab-a', 1)
    const read = readOperation('tab-a', 1, 'snapshot-a')
    expect(isDesktopBrowserOperation(read)).toBe(true)
    expect(isDesktopBrowserOperation({ ...read, maxChars: 1_000_001 })).toBe(false)
    const textResult = (value: string, truncated: boolean): unknown => ({
      type: 'browser/result', requestId: 1,
      result: { status: 'success', value: { kind: 'read', target: pageTarget, value, truncated } },
    })
    expect(isDesktopBrowserResultMessage(textResult('x'.repeat(1_000_000), false))).toBe(true)
    expect(isDesktopBrowserResultMessage(textResult('x'.repeat(1_000_001), true))).toBe(false)

    const tab = { target: pageTarget, url: 'https://example.test/', title: 'Example', active: false, ownership: 'user', attached: true }
    const tabsResult = (tabs: unknown[], truncated: boolean): unknown => ({
      type: 'browser/result', requestId: 2,
      result: { status: 'success', value: { kind: 'tabs', tabs, truncated } },
    })
    expect(isDesktopBrowserResultMessage(tabsResult(new Array(256).fill(tab), false))).toBe(true)
    expect(isDesktopBrowserResultMessage(tabsResult(new Array(257).fill(tab), true))).toBe(false)
  })

  it('rejects an invalid reply without resolving another request', async () => {
    const port = browserPort()
    const pending = port.transport.request(caller('session-a', 1), readOperation('tab-a', 1, 'snapshot-a'), new AbortController().signal)
    const [request] = requests(port.sent)
    expect(request).toBeDefined()

    port.emit({ type: 'browser/result', requestId: request!.requestId, result: { status: 'success', value: { kind: 'missing' } } })

    await expect(pending).rejects.toThrow('invalid result')
    await port.transport.dispose()
  })
})
