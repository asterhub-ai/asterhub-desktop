import type {
  DesktopBrowserCancelMessage,
  DesktopBrowserCaller,
  DesktopBrowserOperation,
  DesktopBrowserRequestMessage,
  DesktopBrowserResult,
  DesktopBrowserTarget,
  DesktopBrowserTransport,
} from './types.ts'
import { isDesktopBrowserOperation, isDesktopBrowserResultMessage } from './protocol.ts'

export {
  isDesktopBrowserCancelMessage,
  isDesktopBrowserOperation,
  isDesktopBrowserRequestMessage,
  isDesktopBrowserResultMessage,
} from './protocol.ts'

/** Process-facing send/listen adapter; Electron and Node own their own endpoints. */
export interface DesktopBrowserTransportPort {
  /** @param message - one Host request or cancellation message. */
  send(message: DesktopBrowserRequestMessage | DesktopBrowserCancelMessage): Promise<void>
  /** @param listener - receives parent-process IPC payloads. @returns listener disposer. */
  subscribe(listener: (message: unknown) => void): () => void
  /** @param listener - observes loss of the authenticated Desktop Host parent. @returns listener disposer. */
  onDisconnect(listener: () => void): () => void
  /** @returns whether the authenticated Desktop Host parent is still connected. */
  connected(): boolean
}

interface PendingRequest {
  readonly caller: DesktopBrowserCaller
  readonly operation: DesktopBrowserOperation
  readonly signal: AbortSignal
  readonly resolve: (result: DesktopBrowserResult) => void
  readonly reject: (error: Error) => void
  readonly remote: PromiseWithResolvers<void>
  readonly onAbort: () => void
  sent: boolean
  localSettled: boolean
  cancelRequested: boolean
}

/** Create a correlated transport over the existing private Desktop Host IPC channel. */
export function createDesktopBrowserTransport(port: DesktopBrowserTransportPort): DesktopBrowserTransport {
  const pending = new Map<number, PendingRequest>()
  let nextRequestId = 1
  let disposed = false
  let disconnected = false
  let removeMessageListener: () => void = () => {}
  let removeDisconnectListener: () => void = () => {}

  const settleLocal = (request: PendingRequest, error?: Error, result?: DesktopBrowserResult): void => {
    if (request.localSettled) return
    request.localSettled = true
    request.signal.removeEventListener('abort', request.onAbort)
    if (error !== undefined) request.reject(error)
    else if (result !== undefined) request.resolve(result)
    else request.reject(new Error('Desktop Browser transport received no result'))
  }

  const settleRemote = (requestId: number, request: PendingRequest): void => {
    if (pending.get(requestId) === request) pending.delete(requestId)
    request.remote.resolve()
  }

  const markDisconnected = (error: Error): void => {
    if (disconnected) return
    disconnected = true
    disposed = true
    removeMessageListener()
    removeDisconnectListener()
    for (const [requestId, request] of pending) {
      settleLocal(request, error)
      settleRemote(requestId, request)
    }
  }

  const sendCancel = (requestId: number): void => {
    void port.send({ type: 'browser/cancel', requestId }).catch(() => {
      markDisconnected(new Error('Desktop Browser cancellation IPC failed'))
    })
  }

  const cancelLocal = (requestId: number, request: PendingRequest, error: Error): void => {
    request.cancelRequested = true
    settleLocal(request, error)
    if (request.sent) sendCancel(requestId)
  }

  removeMessageListener = port.subscribe((message) => {
    if (typeof message !== 'object' || message === null || !('type' in message)
      || message.type !== 'browser/result') return
    const requestId = 'requestId' in message ? message.requestId : undefined
    if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 1) {
      markDisconnected(new TypeError('Desktop Browser Host returned an invalid request id'))
      return
    }
    const request = pending.get(requestId)
    if (request === undefined) return
    if (!isDesktopBrowserResultMessage(message)) {
      settleLocal(request, new TypeError('Desktop Browser Host returned an invalid result'))
      settleRemote(requestId, request)
      return
    }
    if (!matchesOperationResult(request.operation, message.result)) {
      settleLocal(request, new TypeError('Desktop Browser Host returned a result for a different browser target'))
      settleRemote(requestId, request)
      return
    }
    settleLocal(request, undefined, message.result)
    settleRemote(requestId, request)
  })
  removeDisconnectListener = port.onDisconnect(() => markDisconnected(new Error('Desktop Browser Host disconnected')))

  const transport: DesktopBrowserTransport = {
    request(caller, operation, signal) {
      if (disposed || disconnected) return Promise.reject(new Error('Desktop Browser transport is disposed'))
      if (signal.aborted) return Promise.reject(abortError(signal.reason))
      if (!port.connected()) return Promise.reject(new Error('Desktop Browser Host is unavailable'))
      if (!isDesktopBrowserOperation(operation)) return Promise.reject(new TypeError('Invalid Desktop Browser operation'))
      if (!Number.isSafeInteger(nextRequestId) || nextRequestId < 1) {
        return Promise.reject(new Error('Desktop Browser request id space is exhausted'))
      }

      const requestId = nextRequestId++
      const { promise, resolve, reject } = Promise.withResolvers<DesktopBrowserResult>()
      const remote = Promise.withResolvers<void>()
      const request: PendingRequest = {
        caller, operation, signal, resolve, reject, remote, sent: false, localSettled: false, cancelRequested: false,
        onAbort: () => cancelLocal(requestId, request, abortError(signal.reason)),
      }
      pending.set(requestId, request)
      signal.addEventListener('abort', request.onAbort, { once: true })
      void port.send({ type: 'browser/request', requestId, caller, operation }).then(() => {
        request.sent = true
        if (request.cancelRequested) sendCancel(requestId)
      }).catch(() => {
        markDisconnected(new Error('Desktop Browser request IPC failed'))
      })
      return promise
    },

    async releaseOwner(caller) {
      const owned = [...pending].filter(([, request]) =>
        request.caller.sessionId === caller.sessionId
        && request.caller.ownerGeneration === caller.ownerGeneration)
      for (const [requestId, request] of owned) {
        cancelLocal(requestId, request, new DOMException('Browser owner was disposed', 'AbortError'))
      }
      await Promise.all(owned.map(([, request]) => request.remote.promise))
    },

    async dispose() {
      if (disposed) return
      disposed = true
      const outstanding = [...pending]
      for (const [requestId, request] of outstanding) {
        cancelLocal(requestId, request, new DOMException('Desktop Browser transport was disposed', 'AbortError'))
      }
      await Promise.all(outstanding.map(([, request]) => request.remote.promise))
      removeMessageListener()
      removeDisconnectListener()
    },
  }
  return transport
}

function abortError(reason: unknown): Error {
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason
  return new DOMException('Desktop Browser operation was aborted', 'AbortError')
}

function sameTarget(expected: DesktopBrowserTarget, actual: DesktopBrowserTarget): boolean {
  return expected.tabId === actual.tabId && expected.generation === actual.generation
}

function matchesOperationResult(operation: DesktopBrowserOperation, result: DesktopBrowserResult): boolean {
  if (result.status === 'error') return true
  const value = result.value
  switch (operation.kind) {
    case 'tabs.list': return value.kind === 'tabs'
    case 'tabs.open': return value.kind === 'tab'
    case 'tabs.close': return value.kind === 'closed' && sameTarget(operation.target, value.target)
    case 'page.snapshot': return value.kind === 'snapshot' && sameTarget(operation.target, value.snapshot.target)
    case 'page.read': return value.kind === 'read' && sameTarget(operation.target, value.target)
    case 'page.act':
    case 'page.actAt': return value.kind === 'action' && sameTarget(operation.target, value.target)
    case 'page.wait': return value.kind === 'wait' && sameTarget(operation.target, value.target)
    case 'page.screenshot': return value.kind === 'screenshot' && sameTarget(operation.target, value.screenshot.target)
  }
  return false
}
