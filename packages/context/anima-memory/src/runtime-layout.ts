/** Locate the Java home inside supported Windows Temurin archive layouts. */

import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Find the directory containing the Windows Java executable below an extracted archive root.
 * @param root - Extracted archive root.
 * @param _windows - Optional compatibility parameter (Windows java.exe is always sought).
 * @returns The Java home directory containing `bin/java.exe`.
 */
export async function findJavaHome(root: string, _windows = true): Promise<string> {
  const executable = 'java.exe'
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined) continue
    try {
      const executableInfo = await lstat(join(directory, 'bin', executable))
      if (executableInfo.isFile() && !executableInfo.isSymbolicLink()) return directory
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(join(directory, entry.name))
    }
  }
  throw new Error('The verified Java archive did not contain its expected executable.')
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
