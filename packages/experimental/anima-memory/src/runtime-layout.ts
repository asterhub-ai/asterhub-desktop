/** Locate the Java home inside supported Temurin archive layouts. */

import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Find the directory containing the Java executable, including nested macOS bundle layouts.
 * @param root - Extracted archive root.
 * @param windows - Whether the archive uses `java.exe`.
 * @returns The Java home directory containing `bin/java` or `bin/java.exe`.
 */
export async function findJavaHome(root: string, windows: boolean): Promise<string> {
  const executable = windows ? 'java.exe' : 'java'
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
