/**
 * Observable catalog source for automation tasks.
 * Follows ui-schedule catalog-source patterns: subscription disposers,
 * epoch-based stale data rejection, batching, and proper cleanup.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Catalog snapshot with its query status. */
export interface CatalogSnapshot<T> {
  /** Current records. */
  readonly records: readonly T[]
  /** Query status. */
  readonly status: 'loading' | 'ready' | 'error' | 'unauthorized'
  /** Read request identity for retry. */
  readonly readRequest: number
  /** Whether an authoritative list read has ever succeeded. */
  readonly settled: boolean
  /** Ordinal of the read whose result the current records came from, and 0 before any read succeeded. */
  readonly readSettled: number
  /** Identity generation for account/reset fencing; distinct from readRequest. */
  readonly identityGeneration: number
}

/** Catalog source configuration. */
export interface CatalogConfig<T> {
  /**
   * List all records; throws to surface the error state.
   * Receives the read request number for account-change fencing.
   */
  readonly list: (readRequest: number) => Promise<readonly T[]>
  /** Subscribe to change events. */
  readonly subscribeChanged: (listener: () => void) => () => void
  /** Subscribe to reset events. */
  readonly subscribeReset: (listener: () => void) => () => void
}

/** Injected catalog actions. */
export interface CatalogInjected<T> {
  readonly hooks: {
    readonly catalog: HostObservable<CatalogSnapshot<T>>
  }
  readonly clear: () => void
  readonly onRetry: (since?: number) => Promise<void>
  /** Current identity generation for external fencing. */
  readonly getIdentityGeneration: () => number
  /** Advance identity generation, clearing records and fencing late replies. */
  readonly resetIdentity: () => void
}

/**
 * Create a catalog source for automation tasks.
 * @param config - catalog configuration.
 * @returns catalog injected actions.
 */
export function createCatalogSource<T extends { readonly id: string }>(
  config: CatalogConfig<T>,
): CatalogInjected<T> {
  type Snapshot = CatalogSnapshot<T>

  let snapshot: Snapshot = {
    records: [],
    status: 'loading',
    readRequest: 0,
    settled: false,
    readSettled: 0,
    identityGeneration: 0,
  }
  const listeners = new Set<() => void>()
  let disposers: readonly (() => void)[] = []
  let epoch = 0

  const publish = (next: Snapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const read = async (request: number, current: number, generation: number): Promise<void> => {
    let records: readonly T[]
    try {
      records = await config.list(request)
    } catch (error: unknown) {
      if (current !== epoch) return
      const code = (error as { code?: string } | undefined)?.code
      const status: CatalogSnapshot<T>['status'] = code === 'unauthorized' || code === 'not_authenticated' ? 'unauthorized' : 'error'
      publish({ ...snapshot, status })
      return
    }
    if (current !== epoch) return
    if (generation !== snapshot.identityGeneration) return
    publish({ ...snapshot, records, status: 'ready', settled: true, readSettled: request })
  }

  let batching = false
  let inFlight: Promise<void> | undefined
  let inFlightRequest = 0

  /**
   * Refresh the catalog. Requests in the same commit share one read.
   * Supersede=true replaces in-flight reads (for change/reset events).
   * Since parameter allows joining existing reads when appropriate.
   */
  const refresh = (supersede = false, since = 0): Promise<void> => {
    const request = snapshot.readRequest + 1
    publish({ ...snapshot, status: 'loading', readRequest: request })
    if (!supersede && batching && inFlight !== undefined && inFlightRequest > since) return inFlight
    if (!batching) {
      batching = true
      void Promise.resolve().then(() => { batching = false })
    }
    const current = ++epoch
    const pending = read(request, current, snapshot.identityGeneration)
    inFlightRequest = request
    inFlight = pending
    void pending.finally(() => { if (inFlight === pending) inFlight = undefined })
    return pending
  }

  const invalidate = (): void => { void refresh(true) }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    if (listeners.size === 1) {
      disposers = [config.subscribeChanged(invalidate), config.subscribeReset(invalidate)]
      invalidate()
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size !== 0) return
      for (const dispose of disposers) dispose()
      disposers = []
      epoch++
      snapshot = { ...snapshot, records: [] }
    }
  }

  const getSnapshot = (): Snapshot => snapshot

  const clear = (): void => {
    epoch++
    publish({ records: [], status: 'loading', readRequest: snapshot.readRequest + 1, settled: false, readSettled: 0, identityGeneration: snapshot.identityGeneration })
  }

  /**
   * Reset identity generation: advances the generation so late RPC replies
   * from the previous account/connection are fenced out, clears records, and
   * marks the catalog as loading. Distinct from ordinary readRequest bumps:
   * only account-changed and connection/reset unmount sensitive drafts.
   */
  const resetIdentity = (): void => {
    epoch++
    publish({ records: [], status: 'loading', readRequest: snapshot.readRequest + 1, settled: false, readSettled: 0, identityGeneration: snapshot.identityGeneration + 1 })
  }

  return {
    hooks: { catalog: { getSnapshot, subscribe } },
    clear,
    onRetry: (since = 0) => refresh(false, since),
    getIdentityGeneration: () => snapshot.identityGeneration,
    resetIdentity,
  }
}
