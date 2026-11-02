/**
 * Icon extraction per platform over a deterministic command runner and real
 * temp filesystems: macOS `.icns` conversion, Windows PowerShell associated-
 * icon extraction, and Linux desktop-entry/theme lookup. No host application
 * is touched.
 */
import { rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { extractAppIcon } from '../src/icons.ts'
import type { OpenInAppInternals, OpenInAppResolvedLaunch } from '../src/resolver.ts'

const TIMEOUT_MS = 5_000

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Internals baseline every call completes: a rejecting runner and an empty PATH. */
function bare(overrides: OpenInAppInternals): OpenInAppInternals {
  return {
    run: () => Promise.reject(new Error('fixture rejects')),
    resolveExecutable: () => Promise.resolve(null),
    ...overrides,
  }
}


/** A resolved launch whose icon source is the given bundle or executable. */
function withIcon(kind: 'app-bundle' | 'executable', path: string): OpenInAppResolvedLaunch {
  return { launch: { kind: 'argv', command: 'unused', args: [] }, icon: { kind, path } }
}


describe('Windows executable icons', () => {
  /** Runner asserting the PowerShell extraction argv and writing the PNG. */
  function powershellRunner(outs: string[], write: boolean): NativeCommandRunner {
    return async (command, args) => {
      if (command !== 'powershell.exe') throw new Error(`fixture rejects: ${command}`)
      expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
      const script = args[5]
      const out = args[7]
      if (typeof script !== 'string' || typeof out !== 'string') throw new Error('missing script argv')
      // The generated script reached disk before the command ran.
      expect((await stat(script)).isFile()).toBe(true)
      outs.push(out)
      if (write) await writeFile(out, 'png-bytes')
      return { stdout: '', stderr: '' }
    }
  }

  it('extracts through the generated script, passing source and target as positional args', async () => {
    const outs: string[] = []
    const icon = await extractAppIcon(
      withIcon('executable', 'C:\\apps\\Code.exe'), TIMEOUT_MS,
      bare({ platform: 'win32', run: powershellRunner(outs, true) }),
    )
    expect(icon).toEqual({ bytes: Buffer.from('png-bytes'), contentType: 'image/png' })
    expect(outs).toHaveLength(1)
  })

  it('resolves null on a failed extraction and on an exit-0 run that wrote nothing, cleaning up its temp directory', async () => {
    await expect(extractAppIcon(
      withIcon('executable', 'C:\\apps\\Code.exe'), TIMEOUT_MS, bare({ platform: 'win32' }),
    )).resolves.toBeNull()

    const outs: string[] = []
    await expect(extractAppIcon(
      withIcon('executable', 'C:\\apps\\Code.exe'), TIMEOUT_MS,
      bare({ platform: 'win32', run: powershellRunner(outs, false) }),
    )).resolves.toBeNull()
    expect(outs).toHaveLength(1)
    for (const out of outs) {
      await expect(stat(dirname(out))).rejects.toThrow()
    }
  })
})
