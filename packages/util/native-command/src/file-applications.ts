/** Native file associations queried from the desktop that owns the path. */
import { runNativeCommand } from './runner.ts'
import { windowsFileApplications } from './file-applications-windows.ts'
import { nativeFileManager } from './path-opener.ts'
import type { PathOpenerInternals } from './path-opener.ts'
import { parseNativeFileApplications, type NativeFileApplication } from './types.ts'

/**
 * List registered handlers in OS preference order, including the current default and application icons.
 * @param path - verified absolute local file path.
 * @param signal - caller lifetime, propagated to the OS query.
 * @param internals - platform and command adapter for deterministic tests.
 * @returns current file handlers; an empty list when the platform has no association query.
 */
export async function nativeFileApplications(
  path: string, signal: AbortSignal, internals: PathOpenerInternals = {},
): Promise<readonly NativeFileApplication[]> {
  signal.throwIfAborted()
  const target = await desktopTarget(path, signal, internals)
  const run = internals.run ?? runNativeCommand
  if (target.platform !== 'win32') return []
  const stdout = await windowsFileApplications(target.path, null, signal, run)
  return parseNativeFileApplications(JSON.parse(stdout))
}

/**
 * Open a file in a currently registered handler.
 * @param path - verified absolute local file path.
 * @param application - identifier returned by the file association query.
 * @param signal - caller lifetime, propagated to query and launch.
 * @param internals - platform and command adapter for deterministic tests.
 * @returns after the system launcher accepts the file.
 */
export async function openNativeFileApplication(
  path: string, application: string, signal: AbortSignal, internals: PathOpenerInternals = {},
): Promise<void> {
  const target = await desktopTarget(path, signal, internals)
  const run = internals.run ?? runNativeCommand
  if (target.platform === 'win32') {
    await windowsFileApplications(target.path, application, signal, run)
    return
  }
  throw new Error(`native application launching is unsupported on ${target.platform}`)
}

/** Resolve the desktop that owns the file, including Windows applications reached from WSL. */
async function desktopTarget(
  path: string, signal: AbortSignal, internals: PathOpenerInternals,
): Promise<{ platform: NodeJS.Platform; path: string }> {
  signal.throwIfAborted()
  const platform = internals.platform ?? process.platform
  if (platform === 'linux' && nativeFileManager(internals) === 'explorer') {
    const translated = await (internals.run ?? runNativeCommand)('wslpath', ['-w', path], signal, 'hidden')
    signal.throwIfAborted()
    const windowsPath = translated.stdout.replace(/[\r\n]+$/, '')
    if (windowsPath === '') throw new Error('wslpath returned no Windows path')
    return { platform: 'win32', path: windowsPath }
  }
  return { platform, path }
}
