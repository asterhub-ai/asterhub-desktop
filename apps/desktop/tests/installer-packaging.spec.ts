import type * as ChildProcess from 'node:child_process'
import { promisify } from 'node:util'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { execute } = vi.hoisted(() => ({ execute: vi.fn(async () => undefined) }))
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcess>()
  return { ...original, execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) }
})

describe('Windows installer release policy', () => {
  it('rejects a mismatched production policy before signing on Windows', () => {
    expect(() => createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.installer',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://wrong.example.com',
    }, 'win32', 'x64')).toThrow('must match the selected auto-update origin')
  })

  it('writes the NSIS include under the explicit environment root without changing process.env', async () => {
    const repository = resolve(import.meta.dirname, '../../..')
    const buildRoot = await mkdtemp(join(repository, '.installer-env-'))
    try {
      const config = createElectronBuilderConfig({
        DSH_DESKTOP_APP_ID: 'com.example.installer',
        DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
        DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
        DSH_DESKTOP_TARGET_PLATFORM: 'win32',
        DSH_DESKTOP_TARGET_ARCH: 'x64',
        DSH_DESKTOP_UNSIGNED: '1',
        DSH_DESKTOP_BUILD_ROOT: buildRoot,
        DSH_DESKTOP_BUILD_LAYOUT: 'compact',
      }, 'win32', 'x64')
      await config.beforeBuild()
      const installerUi = join(buildRoot, 'w64', 'installer-ui')
      const include = await readFile(join(installerUi, 'installer-custom.nsh'), 'utf8')
      expect(include).toContain(`!define INSTALLER_BUILD_DIR "${installerUi}"`)
    } finally {
      await rm(buildRoot, { recursive: true, force: true })
    }
  })

  it('names unsigned Windows artifacts so they cannot pass for release builds', () => {
    const config = createElectronBuilderConfig({
      DSH_DESKTOP_APP_ID: 'com.example.installer',
      DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
      DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
      DSH_DESKTOP_UNSIGNED: '1',
    }, 'win32', 'x64')
    expect(config.artifactName).toBe('asterhub-${version}-${os}-${arch}-unsigned.${ext}')
  })

})
