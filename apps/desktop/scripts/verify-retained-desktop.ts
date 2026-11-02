/** Recheck distribution signatures on retained installers without signing credentials. */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { DesktopRetainedManifest } from './desktop-release-store.ts'
import type { DesktopPublishConfig } from './desktop-publish-config.ts'

/**
 * Verify Windows Authenticode on the original platform.
 * @param directory Retained attempt whose file hashes were already checked.
 * @param manifest Validated inventory and packaging mode.
 * @param config Public expected signer configuration.
 * @returns Resolves after platform verification.
 */
export async function verifyRetainedDesktopSignatures(
  directory: string, manifest: DesktopRetainedManifest, config: DesktopPublishConfig,
): Promise<void> {
  const { source } = manifest
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(key)))
  const run = (command: string, args: string[]) => execFileSync(command, args, { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
  if (source.target === 'win-x64') {
    if (process.platform !== 'win32' || source.qualification !== 'signed' || !config.windows) throw new Error('desktop publish: signed Windows package and signer configuration required on Windows')
    const installer = manifest.files.find(file => file.name.endsWith('.exe'))
    if (!installer) throw new Error('desktop publish: installer missing')
    run('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(import.meta.dirname, 'verify-published-windows.ps1'),
      '-Installer', join(directory, installer.name), '-Thumbprint', config.windows.certificateThumbprint])
    return
  }
  throw new Error(`desktop publish: unsupported target ${source.target}`)
}
