/** Create a small Windows entry point for an unsigned portable directory build. */

import { execFileSync } from 'node:child_process'
import { existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const RUNTIME_NAME = 'AsterHub.Runtime.exe'

function csharpCompiler(): string {
  const windows = process.env.SystemRoot ?? 'C:\\Windows'
  const compiler = [
    join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    join(windows, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ].find(existsSync)
  if (compiler === undefined) throw new Error('desktop package: .NET Framework C# compiler is required for the portable launcher')
  return compiler
}

/**
 * Replace one Electron executable with a small branded launcher and its renamed runtime.
 * @param applicationDirectory - Electron-builder's `win-unpacked` directory.
 * @returns The launcher and Electron runtime sizes in bytes.
 */
export function prepareWindowsPortableLauncher(applicationDirectory: string): { launcherBytes: number; runtimeBytes: number } {
  if (process.platform !== 'win32') throw new Error('desktop package: portable launcher requires Windows')
  const directory = resolve(applicationDirectory)
  const launcherPath = join(directory, 'AsterHub.exe')
  const runtimePath = join(directory, RUNTIME_NAME)
  const stagingLauncherPath = join(directory, '.AsterHub.Launcher.tmp.exe')
  const iconPath = join(directory, '.AsterHub.Launcher.tmp.ico')
  const sourceExecutable = join(APP_ROOT, 'scripts', 'portable-launcher.cs')
  const iconSource = join(APP_ROOT, 'resources', 'icon-windows.png')
  const iconScript = join(APP_ROOT, 'scripts', 'prepare-portable-launcher-icon.ps1')
  if (!existsSync(launcherPath) || existsSync(runtimePath)) {
    throw new Error('desktop package: portable launcher requires one untouched AsterHub.exe')
  }

  let runtimeMoved = false
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', iconScript,
      '-Source', iconSource, '-Destination', iconPath,
    ], { windowsHide: true, stdio: 'pipe', timeout: 30_000 })
    execFileSync(csharpCompiler(), [
      '/nologo', '/target:winexe', '/platform:anycpu', `/out:${stagingLauncherPath}`,
      `/win32icon:${iconPath}`, '/reference:System.Windows.Forms.dll', sourceExecutable,
    ], { cwd: directory, windowsHide: true, stdio: 'pipe', timeout: 30_000 })

    renameSync(launcherPath, runtimePath)
    runtimeMoved = true
    execFileSync(stagingLauncherPath, ['--asterhub-launcher-check'], {
      cwd: directory, windowsHide: true, stdio: 'pipe', timeout: 5_000,
    })
    renameSync(stagingLauncherPath, launcherPath)
    const launcherBytes = statSync(launcherPath).size
    const runtimeBytes = statSync(runtimePath).size
    if (launcherBytes >= 1_000_000 || runtimeBytes <= 100_000_000) {
      throw new Error('desktop package: portable launcher size check failed')
    }
    return { launcherBytes, runtimeBytes }
  } catch (error) {
    if (runtimeMoved && existsSync(runtimePath)) {
      if (existsSync(launcherPath)) rmSync(launcherPath, { force: true })
      renameSync(runtimePath, launcherPath)
    }
    throw error
  } finally {
    rmSync(stagingLauncherPath, { force: true })
    rmSync(iconPath, { force: true })
  }
}
