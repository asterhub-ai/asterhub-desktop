// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopBrowserFrame, DesktopBrowserReservation, DesktopBrowserTargetGeneration } from '../src/types.ts'
import { electronFixture } from './electron-harness.client.ts'

const target = { kind: 'https' as const, url: 'https://example.test/', title: 'Example' }
const fixtures: ReturnType<typeof electronFixture>[] = []
function fixture() {
  const h = electronFixture()
  fixtures.push(h)
  return h
}
afterEach(async () => {
  for (const h of fixtures.splice(0)) await h.dispose()
  vi.restoreAllMocks()
})

it('waits for a mounted container and observes native history, titles and new-tab requests', async () => {
  const h = fixture()
  h.frame.goBack()
  h.frame.goForward()
  h.frame.reload()
  h.frame.loadUrl(target)
  expect(h.bridge.acquire).not.toHaveBeenCalled()
  h.mount()
  await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalled() })
  expect(h.canvas()).not.toBeNull()
  await vi.waitFor(() => { expect(h.bridge.navigate).toHaveBeenCalledWith(h.reservation.lease, target.url) })

  h.emitPageState({ url: target.url, title: 'Title', loading: false, canGoBack: true, canGoForward: true })
  expect(h.frame.getSnapshot()).toMatchObject({ address: 'observed', target: { ...target, title: 'Title' } })

  h.frame.goBack()
  expect(h.bridge.goBack).toHaveBeenCalledWith(h.reservation.lease)

  h.frame.goForward()
  expect(h.bridge.goForward).toHaveBeenCalledWith(h.reservation.lease)

  h.frame.reload()
  expect(h.bridge.reload).toHaveBeenCalledWith(h.reservation.lease)

  const open = h.bridge.onOpenRequested.mock.calls[0]![1]
  open('https://new.example/')
  expect(h.openRequested).toHaveBeenCalledOnce()
  await h.frame.dispose()
  open('https://late.example/')
  expect(h.openRequested).toHaveBeenCalledOnce()
  expect(h.opens.size).toBe(0)
  expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
})

it('releases an acquisition that finishes after attachment cancellation', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<DesktopBrowserReservation>()
  h.bridge.acquire.mockReturnValueOnce(pending.promise)
  const unmount = h.mount()
  h.frame.loadUrl(target)
  try {
    await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledOnce() })
    unmount()
    const disposed = h.frame.dispose()
    expect(h.frame.dispose()).toBe(disposed)
    pending.resolve(h.reservation)
    await disposed
    expect(h.canvas()).toBeNull()
    expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
  } finally {
    pending.resolve(h.reservation)
  }
})

it('does not acquire a guest when Workspace resolution finishes after disposal', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<string>()
  h.workspace.mockReturnValueOnce(pending.promise)
  h.mount()
  h.frame.loadUrl(target)
  try {
    const disposed = h.frame.dispose()
    pending.resolve('cwd:/late')
    await disposed
    expect(h.bridge.acquire).not.toHaveBeenCalled()
  } finally {
    pending.resolve('cwd:/late')
  }
})

it('recreates or updates the canvas presentation across mounts', async () => {
  const h = fixture()
  const unmount = h.mount()
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.canvas()).not.toBeNull() })
  unmount()
  expect(h.canvas()).toBeNull()
  h.mount()
  expect(h.canvas()).not.toBeNull()
  expect(h.workspace).toHaveBeenCalledOnce()
})

it('contains acquisition, native command and release failures and keeps retry available', async () => {
  const h = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.bridge.acquire.mockRejectedValueOnce(new Error('acquire failed'))
  h.mount()
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(error).toHaveBeenCalled() })
  h.bridge.release.mockRejectedValueOnce(new Error('release failed'))
  await h.frame.dispose()
  expect(error).toHaveBeenCalled()
})

it('draws received frames and handles viewport updates', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalled() })
  expect(h.canvas()).not.toBeNull()

  const frame: DesktopBrowserFrame = {
    lease: h.reservation.lease,
    generation: 1 as DesktopBrowserTargetGeneration,
    sequence: 1,
    png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pixelSize: { width: 800, height: 600 },
    viewport: { cssWidth: 800, cssHeight: 600 },
  }
  h.emitFrame(frame)
  expect(h.canvas()).not.toBeNull()
})
