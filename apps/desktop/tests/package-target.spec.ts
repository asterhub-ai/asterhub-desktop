import { describe, expect, it } from 'vitest'
import {
  desktopElectronBuilderArguments,
  desktopElectronBuilderEnvironment,
  parseDesktopPackageInvocation,
  resolveDesktopPackageTarget,
  withoutDesktopUploadCredentials,
  withoutWindowsSigningEnvironment,
} from '../scripts/package-target.ts'

describe('desktop package target', () => {
  it('selects matching runtime and electron-builder architectures', () => {
    expect(resolveDesktopPackageTarget('win-x64', 'win32', 'x64')).toMatchObject({
      platform: 'win32', arch: 'x64', builderPlatform: '--win', builderArch: '--x64',
    })
  })

  it('rejects unsupported targets and hosts before building', () => {
    expect(() => resolveDesktopPackageTarget('linux-x64', 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('mac-x64', 'darwin', 'x64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('win-x64', 'darwin', 'arm64')).toThrow(/Windows x64/u)
  })

  it('parses installer and unpacked-directory invocations', () => {
    expect(parseDesktopPackageInvocation(['win-x64'], 'win32', 'x64').directory).toBe(false)
    expect(parseDesktopPackageInvocation(['win-x64', '--dir'], 'win32', 'x64').directory).toBe(true)
    expect(parseDesktopPackageInvocation([], 'win32', 'x64').target.name).toBe('win-x64')
    expect(parseDesktopPackageInvocation(['--prepare-only'], 'win32', 'x64').prepareOnly).toBe(true)
    expect(parseDesktopPackageInvocation(['--check'], 'win32', 'x64').check).toBe(true)
    expect(parseDesktopPackageInvocation(['win-x64', '--check', '--unsigned'], 'win32', 'x64')).toMatchObject({ check: true, unsigned: true })
    expect(() => parseDesktopPackageInvocation(['win-x64', 'extra'], 'win32', 'x64'))
      .toThrow(/at most one target/u)
  })

  it('parses a build version, including the separator a pnpm run script forwards', () => {
    expect(parseDesktopPackageInvocation(['win-x64'], 'win32', 'x64').requestedBuildVersion).toBeUndefined()
    expect(parseDesktopPackageInvocation(['win-x64', '--build-version', '0.1.6-alpha.2.20260921.1'], 'win32', 'x64')
      .requestedBuildVersion).toBe('0.1.6-alpha.2.20260921.1')
    expect(parseDesktopPackageInvocation(['win-x64', '--build-version', 'auto'], 'win32', 'x64')
      .requestedBuildVersion).toBe('auto')
    expect(parseDesktopPackageInvocation(['win-x64', '--', '--build-version', 'auto'], 'win32', 'x64'))
      .toMatchObject({ requestedBuildVersion: 'auto', target: { name: 'win-x64' } })
    expect(parseDesktopPackageInvocation(['--', '--check'], 'win32', 'x64').check).toBe(true)
    expect(() => parseDesktopPackageInvocation(['win-x64', '--build-version', '  '], 'win32', 'x64'))
      .toThrow(/--build-version requires a value/u)
  })

  it('keeps electron-builder publishing disabled for the separate validated upload', () => {
    const target = resolveDesktopPackageTarget('win-x64', 'win32', 'x64')
    expect(desktopElectronBuilderArguments(target, false)).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'electron-builder.config.mjs',
      '--win',
      '--x64',
      '--publish',
      'never',
    ])
    expect(desktopElectronBuilderArguments(target, true)).toContain('--dir')
  })

  it('accepts unsigned Windows artifacts and rejects other targets or preparation-only use', () => {
    expect(parseDesktopPackageInvocation(['win-x64', '--unsigned'], 'win32', 'x64').unsigned).toBe(true)
    expect(parseDesktopPackageInvocation(['win-x64'], 'win32', 'x64').unsigned).toBe(false)
    expect(parseDesktopPackageInvocation(['--unsigned', '--dir'], 'win32', 'x64')).toMatchObject({
      unsigned: true, directory: true,
    })
    expect(() => parseDesktopPackageInvocation(['--unsigned', '--prepare-only'], 'win32', 'x64'))
      .toThrow(/cannot use --prepare-only/u)
  })

  it('removes ambient certificate inputs for unsigned builds and overrides an inherited signing mode', () => {
    const environment = {
      DSH_DESKTOP_APP_ID: 'com.example.desktop',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'token-secret',
      CSC_LINK: 'private.pfx',
      CSC_KEY_PASSWORD: 'secret',
      WIN_CSC_LINK: 'windows.pfx',
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
      DSH_DESKTOP_UNSIGNED: '1',
    }
    expect(desktopElectronBuilderEnvironment(environment, true)).toEqual({
      DSH_DESKTOP_APP_ID: 'com.example.desktop',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      DSH_DESKTOP_UNSIGNED: '1',
    })
    expect(desktopElectronBuilderEnvironment(environment, false)).toEqual({ ...environment, DSH_DESKTOP_UNSIGNED: '0' })
  })

  it.each([false, true])('pins the Windows archive filter for the NSIS decoder (unsigned: %s)', (unsigned) => {
    expect(desktopElectronBuilderEnvironment({
      DSH_DESKTOP_TARGET_PLATFORM: 'win32', ELECTRON_BUILDER_7Z_FILTER: 'ARM64',
    }, unsigned).ELECTRON_BUILDER_7Z_FILTER).toBe('BCJ')
  })

  it('keeps Windows signing fields out of build and runtime preparation subprocesses', () => {
    expect(withoutWindowsSigningEnvironment({
      DSH_DESKTOP_WINDOWS_CER_FILE: 'C:\\release\\server.cer',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'token-secret',
      DSH_DESKTOP_WINDOWS_KEY_CONTAINER: 'container',
      DSH_DESKTOP_WINDOWS_SIGNTOOL: 'C:\\tools\\signtool.exe',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })).toEqual({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' })
  })

  it('keeps COS credentials out of every packaging subprocess', () => {
    expect(withoutDesktopUploadCredentials({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
      DOWNLOAD_TEST_COS_SECRET_ID: 'test-id',
      DOWNLOAD_TEST_COS_SECRET_KEY: 'test-key',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
      DOWNLOAD_PROD_COS_SECRET_ID: 'production-id',
      DOWNLOAD_PROD_COS_SECRET_KEY: 'production-key',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })).toEqual({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })
  })
})
