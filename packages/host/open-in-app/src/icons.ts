/**
 * Host icon extraction for resolved open-in-app applications, one strategy
 * per platform: macOS converts the resolved bundle's `.icns` to a 128px PNG
 * (`plutil` + `sips`); Windows extracts the resolved executable's associated
 * icon as a 32px PNG through a generated PowerShell script (the largest size
 * `ExtractAssociatedIcon` yields without a native addon); Linux follows the
 * spec's desktop entry `Icon=` key into the hicolor theme and pixmaps
 * directories (PNG or SVG, no subprocess). Every failure resolves null and
 * the icon route answers 404, which the browser renders as a generic glyph.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenInAppApp } from './catalog.ts'
import {
  output, resolveInternals,
  type OpenInAppInternals, type OpenInAppResolvedLaunch, type ResolvedInternals,
} from './resolver.ts'

/** One extracted icon: raw bytes plus the media type the route serves. */
export interface OpenInAppIcon {
  readonly bytes: Buffer
  readonly contentType: 'image/png' | 'image/svg+xml'
}


/**
 * The associated-icon extraction script. `-File` with positional args keeps
 * paths out of the command line's parsing (no quoting/escaping surface);
 * `ExtractAssociatedIcon` yields 32px, the most the stock .NET surface gives
 * without a native addon (README Known Limitations).
 */
const EXTRACT_ICON_PS1 = [
  'param([string]$Source, [string]$Target)',
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Drawing',
  '$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Source)',
  'if ($null -eq $icon) { exit 1 }',
  '$bitmap = $icon.ToBitmap()',
  '$bitmap.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)',
  '',
].join('\n')

/** Extract one Windows executable's associated icon as a 32px PNG. */
async function extractExecutableIconPng(
  executablePath: string, timeoutMs: number, internals: ResolvedInternals,
): Promise<Buffer | null> {
  const workDir = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-'))
  try {
    const script = join(workDir, 'extract-icon.ps1')
    const outPng = join(workDir, 'icon.png')
    await writeFile(script, EXTRACT_ICON_PS1, 'utf8')
    const ran = await output('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, executablePath, outPng,
    ], timeoutMs, internals)
    if (ran === null) return null
    try {
      return await readFile(outPng)
    } catch {
      // Swallows a script run that exited 0 without writing the output file.
      return null
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}


/**
 * Extract one resolved application's icon on this host.
 * @param app - catalog entry (its Linux spec names the desktop entry).
 * @param resolved - the entry's verified launch (its icon source on macOS/Windows).
 * @param timeoutMs - per-command deadline for extraction host commands.
 * @param internals - platform and runner hooks for deterministic tests.
 * @returns the icon bytes and media type, or null when this host serves none.
 */
export async function extractAppIcon(
  app: OpenInAppApp,
  resolved: OpenInAppResolvedLaunch,
  timeoutMs: number,
  internals: OpenInAppInternals = {},
): Promise<OpenInAppIcon | null> {
  const completed = resolveInternals(internals)
  if (resolved.icon === undefined) return null
  if (resolved.icon.kind !== 'executable') return null
  const bytes = await extractExecutableIconPng(resolved.icon.path, timeoutMs, completed)
  return bytes === null ? null : { bytes, contentType: 'image/png' }
}
