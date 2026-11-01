/** File association results and explicit handler authorization on Windows. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import * as runner from '../src/runner.ts'
import { nativeFileApplications, openNativeFileApplication } from '../src/file-applications.ts'

const application = { id: 'C:\\apps\\Music.exe', name: 'Music', default: true, icon: null }
const signal = new AbortController().signal

describe('native file associations', () => {
  it('does not query after cancellation or on unsupported platforms', async () => {
    const run = vi.fn()
    await expect(nativeFileApplications('/file.mp3', signal, { platform: 'freebsd', run })).resolves.toEqual([])
    await expect(nativeFileApplications('/file.mp3', AbortSignal.abort(), { platform: 'win32', run })).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('encodes Windows query and invocation data separately from native adapter source', async () => {
    const scripts: string[] = []
    const run = vi.fn<runner.NativeCommandRunner>(async (_command, args) => {
      scripts.push(await readFile(args.at(-1)!, 'utf8'))
      return { stdout: JSON.stringify([application]), stderr: '' }
    })
    const path = "C:\\测试\\a'; write-host nope.mp3"
    expect(await nativeFileApplications(path, signal, { platform: 'win32', run })).toEqual([application])
    expect(scripts[0]!).toContain(Buffer.from(path).toString('base64'))
    expect(scripts[0]!).not.toContain(path)
    expect(scripts[0]!).toContain('::List($path)')
    await openNativeFileApplication(path, application.id, signal, { platform: 'win32', run })
    expect(scripts[1]!).toContain('::Open($path, $application)')
    expect(run.mock.calls[1]![0]).toBe('powershell.exe')
    expect(run.mock.calls[1]![1]).toEqual(['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', expect.any(String)])
    // PowerShell 5.1 reads a -File script as ANSI without the BOM.
    expect(scripts[1]!).toMatch(/^\uFEFF/)
  })

  it('keeps the complete Windows command line below the CreateProcess limit for long multibyte paths', async () => {
    const run = vi.fn<runner.NativeCommandRunner>(async () => ({ stdout: '[]', stderr: '' }))
    const paths = [
      `C:\\work\\${'测'.repeat(210)}.txt`,
      `C:\\work\\${'测'.repeat(3000)}.txt`,
    ]
    for (const path of paths) await nativeFileApplications(path, signal, { platform: 'win32', run })
    const commandLines = run.mock.calls.map(call => [call[0], ...call[1]].join(' '))
    expect(commandLines).toHaveLength(paths.length)
    commandLines.forEach((line, index) => {
      const path = paths[index]!
      expect(line.length).toBeLessThan(1_000)
      expect(line).toContain('powershell.exe')
      expect(line).toContain('-File')
      expect(line).not.toContain(path)
      expect(line).not.toContain(Buffer.from(path).toString('base64'))
    })
  })

  it('uses the Windows desktop for WSL paths and rejects an empty translation', async () => {
    const run = vi.fn<runner.NativeCommandRunner>(async command => ({
      stdout: command === 'wslpath' ? 'C:\\音频.mp3\n' : JSON.stringify([application]), stderr: '',
    }))
    const facts = { platform: 'linux' as const, osRelease: 'microsoft', env: {}, run }
    expect(await nativeFileApplications('/mnt/c/音频.mp3', signal, facts)).toEqual([application])
    await openNativeFileApplication('/mnt/c/音频.mp3', application.id, signal, facts)
    expect(run).toHaveBeenCalledWith('wslpath', ['-w', '/mnt/c/音频.mp3'], signal, 'hidden')
    const empty = async () => ({ stdout: '', stderr: '' })
    await expect(nativeFileApplications('/a', signal, { ...facts, run: empty })).rejects.toThrow('no Windows path')
  })
})
