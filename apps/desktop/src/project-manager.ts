/** Desktop profile initialization and native recovery. */

import {
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import type { DesktopRelease } from './release.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  initProfile, loadOverlayPatches, PROFILE_TEMPLATES, readProfileManifest, removeLinkProjections, sanitizeProfile, type ProfileManifest, type ProfileTemplate,
} from '@deepseek-ai/dsh-app-boot'

/** Write a value as formatted JSON with the project-manager convention. */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

const PROJECT_NAME = '@deepseek-ai/dsh-desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const WEB_PROFILE = PROFILE_TEMPLATES.web as ProfileTemplate
/** Desktop-only native composition bundle; appended after the shared Web composition. */
export const DESKTOP_NATIVE_BUNDLE = '@deepseek-ai/dsh-asterhub-desktop-native'
/** Old optional bundle excluded from Desktop selection by the native cutover. */
const OLD_SCHEDULE_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\n'

/**
 * The Desktop-owned built-in bundle list: the shared Web composition followed
 * by the native AsterHub automation bundle. The native bundle is appended only
 * for the Desktop product; the shared web/headless/SDK templates and the
 * global OPTIONAL_BUNDLES list are not modified.
 */
const DESKTOP_BUNDLES: readonly string[] = [...WEB_PROFILE.bundles, DESKTOP_NATIVE_BUNDLE]

/** Cutover marker version for native automation migration. */
const AUTOMATION_CUTOVER_VERSION = 1


/** Legacy row ids that conflict with the native automation Host. */
const CONFLICTING_SCHEDULE_ROW_IDS = ['schedule', 'ui-schedule'] as const

/** Legacy row id that conflicts with the native time context. */
const CONFLICTING_TIME_CONTEXT_ID = 'time-context' as const

/** One loaded Cordis entry from a patch file. */
interface PatchEntry {
  readonly id?: string
  readonly name?: string
  readonly disabled?: boolean
  readonly insert?: readonly unknown[]
  readonly group?: boolean
  readonly config?: unknown
}

/**
 * Detect conflicting old schedule/ui-schedule rows in parsed patch entries.
 * @param entries - Parsed patch entry list from a YAML file.
 * @returns The first conflicting row id found, or undefined when none.
 */
function findConflictingScheduleEntry(entries: readonly unknown[], hasNativeTimeContext: boolean): string | undefined {
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as PatchEntry
    if (row.disabled === true) continue
    if (Array.isArray(row.insert)) {
      const conflict = findConflictingScheduleEntry(row.insert, hasNativeTimeContext)
      if (conflict !== undefined) return conflict
    }
    if (typeof row.id === 'string' && CONFLICTING_SCHEDULE_ROW_IDS.some(id => id === row.id)) return row.id
    if (row.name === '@deepseek-ai/dsh-schedule' || row.name === '@deepseek-ai/dsh-client-ui-schedule'
      || row.name === OLD_SCHEDULE_BUNDLE) return row.id ?? row.name
    if (hasNativeTimeContext && (row.id === CONFLICTING_TIME_CONTEXT_ID
      || (row.name === '@deepseek-ai/dsh-time-context' && row.id !== 'asterhub-time-context'))) return row.id ?? row.name
    if ((row.group === true || row.name === 'cordis:group' || row.name === '@deepseek-ai/cordis-plugin-group') && Array.isArray(row.config)) {
      const conflict = findConflictingScheduleEntry(row.config, hasNativeTimeContext)
      if (conflict !== undefined) return conflict
    }
  }
  return undefined
}


/**
 * Reject conflicting old schedule/ui-schedule rows and duplicate time-context
 * in the profile patch before any automatic dispatch. The Desktop cutover removes
 * the optional Schedule Bundle from the product selection, but a user patch may
 * still try to mount the old `schedule` or `ui-schedule` rows. Two schedulers
 * must never be active at once. A separate time-context registration conflicts
 * with the native clock row.
 * @param projectDir - Profile directory whose user patch is inspected.
 * @param hasNativeTimeContext - Whether the native bundle already provides time-context.
 * @throws {Error} when the patch declares a conflicting old schedule row or duplicate time-context.
 */
export function rejectConflictingSchedulePatch(projectDir: string, hasNativeTimeContext: boolean): void {
  const homeDir = dirname(dirname(projectDir))
  for (const patchPath of [join(projectDir, 'cordis.patch.yml'), join(homeDir, 'cordis.patch.yml')]) {
    if (!existsSync(patchPath)) continue
    const conflictingId = findConflictingScheduleEntry(loadOverlayPatches('dsh', patchPath), hasNativeTimeContext)
    if (conflictingId !== undefined) {
      if (conflictingId === 'time-context') {
        throw new Error(`desktop automation cutover: user patch declares duplicate time-context row; the native bundle already provides the clock service`)
      }
      throw new Error(`desktop automation cutover: user patch declares conflicting old row '${conflictingId}'; remove it before the native scheduler can start`)
    }
  }
}
/**
 * Desktop-owned profile manifest: the shared `ProfileManifest` plus a local
 * cutover marker. The field `asterhubAutomationCutover` is a Desktop-only
 * top-level key (not a generic DshProfileManifest addition) that records the
 * native automation migration version. It is read from unknown with strict
 * safe-integer validation and preserved alongside all other manifest fields.
 */
interface DesktopProfileManifest extends ProfileManifest {
  asterhubAutomationCutover?: number
}

/**
 * Read the Desktop-owned cutover marker from a profile manifest.
 * @param manifest - Parsed manifest with unknown shape.
 * @returns The cutover version when present and a valid safe integer, or undefined.
 */
function readCutoverFromManifest(manifest: unknown): number | undefined {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return undefined
  if (!('asterhubAutomationCutover' in manifest)) return undefined
  const value = manifest.asterhubAutomationCutover
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('desktop automation cutover: invalid profile marker; repair the profile before starting')
  return value
}

/**
 * Reconcile the Desktop-owned bundle list on an existing profile: replace the
 * old optional Schedule Bundle selection with the native composition while
 * preserving every other bundle (user plugins, other built-ins). The native
 * bundle is appended after the shared Web composition when absent. The cutover
 * marker `asterhubAutomationCutover` is written atomically with the bundle list
 * in the same manifest document using `writeFileAtomic`.
 * @param projectDir - Profile directory whose manifest is reconciled.
 * @returns The reconciled bundle list and whether the native time-context is present.
 */
export async function reconcileDesktopBundles(projectDir: string): Promise<{ bundles: readonly string[]; hasNativeTimeContext: boolean }> {
  const manifestPath = join(projectDir, 'package.json')
  if (!existsSync(manifestPath)) {
    return { bundles: DESKTOP_BUNDLES, hasNativeTimeContext: true }
  }
  const manifest = readProfileManifest('dsh', projectDir) as DesktopProfileManifest
  const current = manifest.dsh?.profile?.bundles ?? []
  const filtered = current.filter(name => name !== OLD_SCHEDULE_BUNDLE)
  const bundles = filtered.includes(DESKTOP_NATIVE_BUNDLE)
    ? filtered
    : [...filtered, DESKTOP_NATIVE_BUNDLE]
  const hasNativeTimeContext = bundles.includes(DESKTOP_NATIVE_BUNDLE)
  const cutover = readCutoverFromManifest(manifest)
  // A future cutover version means the profile was touched by a newer build;
  // this build must refuse to run rather than silently downgrade.
  if (cutover !== undefined && cutover > AUTOMATION_CUTOVER_VERSION) {
    throw new Error(`desktop automation cutover: profile marker version ${String(cutover)} is newer than this build supports (${String(AUTOMATION_CUTOVER_VERSION)}); refuse to downgrade`)
  }
  const needsCutover = cutover === undefined || cutover < AUTOMATION_CUTOVER_VERSION
  const needsWrite = bundles.length !== current.length
    || bundles.some((name, index) => name !== current[index])
    || needsCutover
  if (needsWrite) {
    const updated: DesktopProfileManifest = {
      ...manifest,
      dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles] } },
      asterhubAutomationCutover: AUTOMATION_CUTOVER_VERSION,
    }
    await writeFileAtomic(manifestPath, `${JSON.stringify(updated, undefined, 2)}\n`, { mode: 0o600 })
  }
  return { bundles, hasNativeTimeContext }
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  if (entries.length === 0) return `packages:\n  - .\n\n${WORKSPACE_SETTINGS}`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function migrateProfileSettings(projectDir: string): void {
  const path = join(projectDir, 'pnpm-workspace.yaml')
  if (!existsSync(path)) return
  const legacy = `packages:\n  - .\n\n${WORKSPACE_SETTINGS}strictDepBuilds: true\nallowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  "${CORE_BUILD_PACKAGE}": true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
  if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') === legacy) {
    writeFileSync(path, workspaceFile())
  }
}

/** Initializes the Desktop profile and disables third-party bundles during recovery. */
export class DesktopProjectManager {
  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - location of the bundled application runtime.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: { readonly dsh: string },
  ) {}

  /**
   * Back up the profile patch and disable third-party bundles without loading application resources.
   * The caller must stop the Host first. Recovery retains the Desktop-owned native composition.
   * @returns Backup path after the locked profile write, or undefined if the patch was absent.
   */
  async disableAllPlugins(): Promise<string | undefined> {
    return this.withLock(() => sanitizeProfile('dsh', this.paths.profile, DESKTOP_BUNDLES))
  }

  /**
   * Load application metadata and prepare the external plugin profile without installing packages.
   * Rejects conflicting old schedule rows before the native scheduler starts.
   */
  async applyRelease(): Promise<void> {
    await this.withLock(async () => {
      // Validation only: an unreadable or mismatched runtime descriptor stops preparation before the Host starts.
      readDesktopRuntime(this.runtime.dsh)
      migrateProfileSettings(this.paths.profile)
      createPluginProfile(this.paths.profile)
      // Reconcile the bundle list: replace old Schedule Bundle with native composition.
      // The cutover marker is written atomically with the bundle list in the same manifest.
      const { hasNativeTimeContext } = await reconcileDesktopBundles(this.paths.profile)
      // Fail closed before any scheduler dispatch: a user patch that re-declares
      // the old schedule/ui-schedule rows must not coexist with the native
      // automation Host, and a duplicate time-context conflicts with the native
      // clock row. The patch is preserved for manual repair.
      rejectConflictingSchedulePatch(this.paths.profile, hasNativeTimeContext)
      removeLinkProjections(this.paths.profile)
    })
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    mkdirSync(this.paths.profile, { recursive: true, mode: 0o700 })
    const lockPath = join(realpathSync(this.paths.profile), 'lock')
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(lockPath)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: profile lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another profile operation is active')
        unlinkSync(lockPath)
        descriptor = openSync(lockPath, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      writeSync(descriptor, `${String(process.pid)}\n`)
      fsyncSync(descriptor)
      return await operation()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
}

/** Create build-only project metadata for materializing the signed runtime. */
export function createRuntimeProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(projectDir, release.version)
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...DESKTOP_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...DESKTOP_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}

/** Create the first external plugin profile without running a package manager. */
export function createPluginProfile(projectDir: string): void {
  initProfile(projectDir, DESKTOP_BUNDLES)
}
