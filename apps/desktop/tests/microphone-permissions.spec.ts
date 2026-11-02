/** Desktop media permissions exclude external pages, subframes and camera requests. */
import type { Session, WebContents } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { installMicrophonePermissions } from '../src/microphone-permissions.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })
function fixture(platform: NodeJS.Platform = 'win32') {
  vi.stubGlobal('process', { ...process, platform })
  const setPermissionCheckHandler = vi.fn<Session['setPermissionCheckHandler']>()
  const setPermissionRequestHandler = vi.fn<Session['setPermissionRequestHandler']>()
  const primary = {} as WebContents
  installMicrophonePermissions({ setPermissionCheckHandler, setPermissionRequestHandler }, () => primary)
  return { primary, check: setPermissionCheckHandler.mock.calls[0]![0]!, request: setPermissionRequestHandler.mock.calls[0]![0]! }
}
it('allows only audio checks from the owned primary application frame', () => {
  const f = fixture(), details = { isMainFrame: true, mediaType: 'audio' as const }
  expect(f.check(f.primary, 'media', 'dsh-app://app', details)).toBe(true)
  expect(f.check(null, 'media', 'dsh-app://app', details)).toBe(false)
  expect(f.check({} as WebContents, 'media', 'dsh-app://app', details)).toBe(false)
  expect(f.check(f.primary, 'media', 'https://example.com', details)).toBe(false)
  expect(f.check(f.primary, 'media', 'invalid', details)).toBe(false)
  expect(f.check(f.primary, 'media', 'dsh-app://app', { ...details, isMainFrame: false })).toBe(false)
  expect(f.check(f.primary, 'media', 'dsh-app://app', { ...details, mediaType: 'video' })).toBe(false)
  expect(f.check(f.primary, 'clipboard-sanitized-write', 'dsh-app://app', details)).toBe(true)
})
it('leaves system authorization to Chromium on Windows', () => {
  const f = fixture('win32'), done = vi.fn()
  expect(f.check(f.primary, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'audio' })).toBe(true)
  f.request(f.primary, 'media', done, { isMainFrame: true, requestingUrl: 'dsh-app://app/', mediaTypes: ['audio'] })
  expect(done).toHaveBeenCalledWith(true)
})
