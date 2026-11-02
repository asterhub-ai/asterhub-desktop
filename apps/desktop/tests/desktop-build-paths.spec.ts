import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BUILD_ROOT,
  desktopTargetBuildPaths,
  desktopTargetPlatform,
  developmentRuntimeDirectory,
  resolveDesktopBuildRoot,
  resolveDesktopBuildTarget,
  resolveDesktopTargetBuildPaths,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('resolves every mutable build directory for win-x64', () => {
    const windows = desktopTargetBuildPaths('win-x64')
    const mutableKeys = [
      'root',
      'artifacts',
      'unsignedArtifacts',
      'unnotarizedArtifacts',
      'runtime',
      'animaRuntime',
      'packageSet',
      'dsh',
      'dshPnpm',
      'electron',
      'packedDsh',
      'packedVendor',
    ] as const

    for (const key of mutableKeys) {
      expect(windows[key]).toContain(join('targets', 'win-x64'))
    }
    expect(windows.runtime).toContain(join('targets', 'win-x64', 'runtime'))
    expect(windows.animaRuntime).toContain(join('targets', 'win-x64', 'anima-runtime'))
  })

  it('shares only the immutable upstream download cache', () => {
    const paths = desktopTargetBuildPaths('win-x64')
    expect(paths.downloads).not.toContain(`${sep}targets${sep}`)
  })

  it('resolves the development primary runtime from the build target rather than the host architecture', () => {
    expect(developmentRuntimeDirectory({}, 'win32', 'x64'))
      .toContain(join('targets', 'win-x64', 'runtime', 'primary-runtime'))
  })

  it('maps every target to the platform and architecture of the payload it prepares', () => {
    expect(desktopTargetPlatform('win-x64')).toEqual({ platform: 'win32', arch: 'x64' })
    expect(() => desktopTargetPlatform('mac-x64' as 'win-x64')).toThrow(/unsupported target/u)
    expect(() => desktopTargetPlatform('linux-x64' as 'win-x64')).toThrow(/unsupported target/u)
  })

  it('defaults build output inside the repository and rejects external overrides', () => {
    const repository = resolve(import.meta.dirname, '../../..')
    expect(resolveDesktopBuildRoot({}, repository))
      .toBe(resolve(import.meta.dirname, '..', '.desktop-build'))
    expect(resolveDesktopBuildRoot({ DSH_DESKTOP_BUILD_ROOT: join(repository, '.build') }, repository))
      .toBe(resolve(repository, '.build'))
    expect(() => resolveDesktopBuildRoot({ DSH_DESKTOP_BUILD_ROOT: 'C:\\Temp\\AsterHub-build' }, repository))
      .toThrow(/must stay inside the repository/u)
    expect(() => resolveDesktopBuildRoot({ DSH_DESKTOP_BUILD_ROOT: '.build' }, repository))
      .toThrow(/must be absolute/u)
    expect(() => resolveDesktopBuildRoot({ DSH_DESKTOP_BUILD_ROOT: '' }, repository))
      .toThrow(/must not be empty/u)
    expect(desktopTargetBuildPaths('win-x64').root).toContain(join('targets', 'win-x64'))
    expect(DESKTOP_BUILD_ROOT).toBe(resolveDesktopBuildRoot())
  })
  it('resolves compact custom-root paths for script consumers and rejects invalid overrides', () => {
    const repository = resolve(import.meta.dirname, '../../..')
    const env = {
      DSH_DESKTOP_BUILD_ROOT: join(repository, '.short-build'),
      DSH_DESKTOP_BUILD_LAYOUT: 'compact',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
    }
    const paths = resolveDesktopTargetBuildPaths(env, 'win32', 'x64')
    expect(paths.root).toBe(join(repository, '.short-build', 'w64'))
    expect(paths.dsh).toBe(join(repository, '.short-build', 'w64', 'dsh'))
    expect(paths.runtime).toBe(join(repository, '.short-build', 'w64', 'runtime'))
    expect(paths.unsignedArtifacts).toBe(join(repository, '.short-build', 'w64', 'u'))
    expect(paths.artifacts).toBe(join(repository, '.short-build', 'w64', 'a'))
    expect(() => resolveDesktopTargetBuildPaths({
      ...env, DSH_DESKTOP_BUILD_ROOT: join(repository, '..', 'outside'),
    }, 'win32', 'x64')).toThrow(/must stay inside the repository/u)
    expect(() => resolveDesktopTargetBuildPaths({
      ...env, DSH_DESKTOP_BUILD_LAYOUT: 'compressed',
    }, 'win32', 'x64')).toThrow(/must be standard or compact/u)
  })
  it('resolves environment overrides and rejects unsupported targets', () => {
    expect(resolveDesktopBuildTarget({}, 'win32', 'x64')).toBe('win-x64')
    expect(() => resolveDesktopBuildTarget({}, 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopBuildTarget({}, 'darwin', 'arm64')).toThrow(/unsupported target/u)
    expect(() => desktopTargetBuildPaths('linux-x64' as 'win-x64')).toThrow(/unsupported target/u)
  })
})
