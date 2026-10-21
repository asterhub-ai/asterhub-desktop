/** Real console events reach asynchronous JavaScript shutdown in Electron Node mode. */

import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type Koffi from 'koffi'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
let root: string | undefined
let probe: string
let electron: string
let entry: string

/**
 * Console control event delivery (GenerateConsoleCtrlEvent) requires an interactive
 * user session (Session ID > 0). Windows services running in Session 0 (such as Nomad
 * workers, LocalSystem, or SCM services) lack an interactive console window station
 * and cannot deliver console control signals across processes.
 */
function hasInteractiveConsoleSession(): boolean {
  if (process.platform !== 'win32') return false
  const koffi = require('koffi') as typeof Koffi
  const kernel = koffi.load('kernel32.dll')
  const GetCurrentProcessId = kernel.func('uint32 __stdcall GetCurrentProcessId()')
  const ProcessIdToSessionId = kernel.func('int __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *sessionId)')
  const sessionSlot: [number] = [0]
  if (!ProcessIdToSessionId(GetCurrentProcessId(), sessionSlot)) {
    throw new Error('Windows process session lookup failed')
  }
  return sessionSlot[0] > 0
}

describe.skipIf(process.platform !== 'win32' || !hasInteractiveConsoleSession())('Windows Electron console signals', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-cli-console-'))
    electron = require('electron') as string
    const programFiles = process.env['ProgramFiles(x86)']
    if (programFiles === undefined || process.env.ComSpec === undefined) throw new Error('Windows compiler environment is unavailable')
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    const vs = (await execute(vswhere, ['-latest', '-products', '*', '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { windowsHide: true })).stdout.trim()
    const quote = (value: string) => '"' + value.replaceAll('%', '%%') + '"'
    probe = join(root, 'console-probe.exe')
    const probeSource = join(root, 'console-probe.cpp')
    await copyFile(new URL('fixtures/cli-console-probe.cpp', import.meta.url), probeSource)
    const compile = join(root, 'compile.cmd')
    // cmd reads batch files in the console code page, so the relative source and output names
    // keep non-ASCII checkout and profile paths out of the batch text.
    await writeFile(compile, ['@echo off', 'call ' + quote(join(vs, 'VC/Auxiliary/Build/vcvars64.bat')) + ' >nul',
      'if errorlevel 1 exit /b %errorlevel%',
      'cl /nologo /std:c++17 /EHsc /MT /W4 /WX console-probe.cpp /Foconsole.obj /Feconsole-probe.exe', '',
    ].join('\r\n'))
    try {
      await execute(process.env.ComSpec, ['/d', '/v:off', '/c', compile], { cwd: root, windowsHide: true })
    } catch (error) {
      const compilerOutput = (error as { stdout?: string }).stdout ?? (error as Error).message
      throw new Error(`Windows console probe compilation failed: ${compilerOutput}`)
    }
    // Only TypeScript is erased; the child has no source-loader hook that could change signal handling.
    const source = await readFile(new URL('../../desktop-host/src/windows-cli-signals.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
      .replace(/(['"])koffi\1/u, JSON.stringify(pathToFileURL(require.resolve('koffi')).href))
    await writeFile(join(root, 'signals.mjs'), code)
    entry = join(root, 'entry.mjs')
    await writeFile(entry, [
      "import { writeFileSync } from 'node:fs'",
      "import { writeFile } from 'node:fs/promises'",
      "import { installWindowsCliSignals } from './signals.mjs'",
      'await installWindowsCliSignals()',
      'const [marker, ready] = process.argv.slice(2)',
      "for (const [signal, code] of [['SIGINT',130],['SIGBREAK',131]]) process.on(signal, async () => {",
      '  await writeFile(marker, signal); process.exit(code)',
      '})',
      "writeFileSync(ready, 'ready')",
      'setInterval(() => {}, 1000)', '',
    ].join('\n'))
  }, 120_000)

  afterAll(async () => {
    if (root === undefined) return
    await chmod(root, 0o700)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it.each([['SIGINT', '0'], ['SIGBREAK', '1']] as const)('delivers %s before process exit', async (signal, event) => {
    if (root === undefined) throw new Error('Console fixture is not prepared')
    const marker = join(root, signal + '.txt')
    const ready = join(root, signal + '.ready')
    const report = join(root, signal + '.report')
    let failure: unknown
    try { await execute(probe, [electron, entry, marker, ready, report, event], { windowsHide: true, timeout: 50_000 }) }
    catch (error) { failure = error }
    const observed = existsSync(report) ? await readFile(report, 'utf8') : 'Console probe exited before reporting.'
    expect(failure, observed).toBeUndefined()
    expect(await readFile(marker, 'utf8')).toBe(signal)
  }, 60_000)
})
