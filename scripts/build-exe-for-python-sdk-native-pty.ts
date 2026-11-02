/** Resolve the native node-pty input used by the Python SDK runtime builder on Windows. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
/**
 * Require both node-pty addons used by the Windows ConPTY backend.
 * @param packageDirectory - staged node-pty package directory.
 * @param arch - Windows target architecture.
 * @returns the existing addon paths in load order.
 */
export function resolveWindowsNodePtyAddons(
  packageDirectory: string,
  arch: 'x64',
): string[] {
  const directory = join(packageDirectory, 'prebuilds', `win32-${arch}`)
  const addons = [
    join(directory, 'conpty.node'),
    join(directory, 'conpty_console_list.node'),
  ]
  const missing = addons.filter(path => !existsSync(path))
  if (missing.length > 0) {
    throw new Error(`build-exe-for-python-sdk: Windows node-pty addons are missing: ${missing.join(', ')}.`)
  }
  return addons
}
