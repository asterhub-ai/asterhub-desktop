import { describe, expect, it, vi } from 'vitest'
import { createCatalogSource } from '../src/client/catalog-source.ts'

type RecordItem = { readonly id: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function createSource(list: () => Promise<readonly RecordItem[]>) {
  let resetListener = () => {}
  const manager = createCatalogSource<RecordItem>({
    list,
    subscribeChanged: () => () => {},
    subscribeReset: (listener) => { resetListener = listener; return () => {} },
  })
  return {
    manager,
    subscribe: () => manager.hooks.catalog.subscribe(() => {}),
    emitReset: () => resetListener(),
  }
}

describe('automation catalog identity reset', () => {
  it('does not reuse the pre-reset read for a same-tick identity refresh', async () => {
    const oldRead = deferred<readonly RecordItem[]>()
    const newRead = deferred<readonly RecordItem[]>()
    const list = vi.fn<() => Promise<readonly RecordItem[]>>()
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise)
    const { manager, subscribe } = createSource(list)
    const unsubscribe = subscribe()

    manager.resetIdentity()
    const refresh = manager.onRetry()


    oldRead.resolve([{ id: 'old-account' }])
    newRead.resolve([{ id: 'new-account' }])
    await refresh
    expect(manager.hooks.catalog.getSnapshot()).toMatchObject({
      records: [{ id: 'new-account' }],
      status: 'ready',
      identityGeneration: 1,
    })
    unsubscribe()
  })

  it('does not let an earlier identity response overwrite the refreshed identity', async () => {
    const oldRead = deferred<readonly RecordItem[]>()
    const newRead = deferred<readonly RecordItem[]>()
    const list = vi.fn<() => Promise<readonly RecordItem[]>>()
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise)
    const { manager, subscribe } = createSource(list)
    const unsubscribe = subscribe()

    await Promise.resolve()
    manager.resetIdentity()
    const refresh = manager.onRetry()
    newRead.resolve([{ id: 'new-account' }])
    await refresh
    oldRead.resolve([{ id: 'old-account' }])
    await Promise.resolve()

    expect(manager.hooks.catalog.getSnapshot()).toMatchObject({
      records: [{ id: 'new-account' }],
      status: 'ready',
      identityGeneration: 1,
    })
    unsubscribe()
  })

  it('starts a new-identity read when the connection reset subscription runs after identity reset', async () => {
    const oldRead = deferred<readonly RecordItem[]>()
    const newRead = deferred<readonly RecordItem[]>()
    const list = vi.fn<() => Promise<readonly RecordItem[]>>()
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise)
    const { manager, subscribe, emitReset } = createSource(list)
    const unsubscribe = subscribe()

    manager.resetIdentity()
    emitReset()

    oldRead.resolve([{ id: 'old-connection' }])
    newRead.resolve([{ id: 'current-connection' }])
    await Promise.resolve()
    expect(manager.hooks.catalog.getSnapshot()).toMatchObject({
      records: [{ id: 'current-connection' }],
      status: 'ready',
      identityGeneration: 1,
    })
    unsubscribe()
  })
})
