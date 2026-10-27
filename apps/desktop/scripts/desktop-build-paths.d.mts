import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'

/** Build output root resolved from `DSH_DESKTOP_BUILD_ROOT` or the repository-local default. */
export const DESKTOP_BUILD_ROOT: string

/** Resolve a repository-contained Desktop build root. */
export function resolveDesktopBuildRoot(
  env?: NodeJS.ProcessEnv,
  repositoryRoot?: string,
): string

/** Mutable target directories plus the shared immutable download cache. */
export interface DesktopTargetBuildPaths {
  readonly root: string
  readonly artifacts: string
  readonly unsignedArtifacts: string
  readonly runtime: string
  readonly animaRuntime: string
  readonly packageSet: string
  readonly dsh: string
  readonly dshPnpm: string
  readonly electron: string
  readonly packedDsh: string
  readonly packedVendor: string
  readonly packedLandlock: string
  readonly downloads: string
}

/**
 * Resolve the fixed build target selected by a packaging environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Supported Desktop target name.
 */
export function resolveDesktopBuildTarget(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopAutoUpdateTarget

/**
 * Resolve the target-directory layout selected by a packaging environment.
 * @param env - Environment that may select a compact layout.
 * @returns Validated build-directory layout.
 */
export function resolveDesktopBuildLayout(env?: NodeJS.ProcessEnv): 'standard' | 'compact'

/**
 * Return the mutable preparation and artifact directories owned by one release target.
 * @param target - Supported Desktop target name.
 * @param layout - Directory layout; defaults to the validated packaging environment.
 * @returns Target paths plus the shared immutable download cache.
 */
export function desktopTargetBuildPaths(target: DesktopAutoUpdateTarget, layout?: 'standard' | 'compact', buildRoot?: string): DesktopTargetBuildPaths

/**
 * Return the platform and architecture of the payload one release target prepares.
 * Windows is prepared as x64 only, so this differs from the build host on an arm64 Windows machine.
 * @param target - Supported Desktop target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopAutoUpdateTarget): {
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
}

/**
 * Resolve the paths owned by the target selected in a packaging environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Selected target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopTargetBuildPaths

/**
 * Resolve the primary-runtime directory an unpackaged development launch uses.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Primary-runtime directory prepared for the selected target.
 */
export function developmentRuntimeDirectory(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): string
