import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { defaultWorkspaceDirectory, validateDocumentsDirectory } from '../src/default-directory.ts'

describe('system Documents directory', () => {
  it('uses the win32 account directory and preserves spaces and Unicode', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: 'D:\\Redirected Documents\r\n', stderr: '' }))
    const signal = new AbortController().signal
    await expect(defaultWorkspaceDirectory(undefined, signal, { platform: 'win32', run })).resolves.toBe('D:\\Redirected Documents\\AsterHub\\default-workspace')
    expect(run).toHaveBeenCalledWith('powershell.exe', expect.any(Array), signal, 'hidden')
  })

  it('uses the configured directory without a system lookup', async () => {
    const run = vi.fn<NativeCommandRunner>()
    await expect(defaultWorkspaceDirectory('C:\\documents', new AbortController().signal, { platform: 'win32', run }))
      .resolves.toBe('C:\\documents\\AsterHub\\default-workspace')
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['', '\r\n'])('rejects an empty directory output %j', async (stdout) => {
    const run: NativeCommandRunner = async () => ({ stdout, stderr: '' })
    await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'win32', run }))
      .rejects.toThrow('unavailable')
  })

  it('propagates lookup failure and cancellation', async () => {
    const run: NativeCommandRunner = async () => { throw new Error('lookup denied') }
    await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'win32', run }))
      .rejects.toThrow('lookup denied')
    await expect(defaultWorkspaceDirectory('C:\\documents', AbortSignal.abort(), { platform: 'win32' }))
      .rejects.toThrow()
    await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'linux' }))
      .rejects.toThrow('unavailable')
  })

  it.each(['relative', 'C:relative', '\\rooted'])('rejects a Windows path without a fully qualified root: %s', (path) => {
    expect(() => validateDocumentsDirectory(path, 'win32')).toThrow('fully qualified')
  })

  it('accepts redirected UNC Documents directories', () => {
    expect(validateDocumentsDirectory('\\\\server\\share\\Documents', 'win32')).toBe('\\\\server\\share\\Documents')
    expect(() => validateDocumentsDirectory('relative', 'win32')).toThrow('fully qualified')
  })
})
