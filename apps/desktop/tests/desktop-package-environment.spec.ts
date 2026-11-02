import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { resolveWindowsPackageSettings } from '../scripts/windows-package-settings.mjs'

const WINDOWS = { platform: 'win32', arch: 'x64' } as const
const POLICY = { DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
  DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }) }
const RELEASE = { ...POLICY, DSH_DESKTOP_APP_ID: 'com.example.desktop', DOWNLOAD_TEST_ORIGIN: 'https://updates.example.com',
  DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef' }

async function withDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-env-'))
  try {
    await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Desktop local packaging configuration', () => {
  it('takes cache concurrency from the Windows file and defaults to four without ambient overrides', async () => {
    await withDirectory(async (directory) => {
      const parent = { DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY: '8' }
      await writeFile(join(directory, '.env.windows'), '')
      expect(resolveWindowsPackageSettings(loadDesktopPackageEnvironment('win32', parent, directory)).signatureCacheConcurrency).toBe(4)
      await writeFile(join(directory, '.env.windows'), 'DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY=2\n')
      expect(resolveWindowsPackageSettings(loadDesktopPackageEnvironment('win32', parent, directory)).signatureCacheConcurrency).toBe(2)
    })
  })

  it.each(['1', '2', '4', '8'])('accepts cache concurrency %s', (value) => {
    const settings = resolveWindowsPackageSettings({ DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY: value })
    expect(settings.signatureCacheConcurrency).toBe(Number(value))
  })

  it.each(['', '0', '-1', '9', '1.5', 'Infinity', '01'])('rejects invalid cache concurrency %s', (value) => {
    expect(() => resolveWindowsPackageSettings({ DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY: value })).toThrow('integer from 1 to 8')
    for (const options of [{ unsigned: true }, { prepareOnly: true }]) {
      expect(() => {
        validateDesktopPackageEnvironment({ ...RELEASE, DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY: value }, WINDOWS, options)
      }).toThrow('integer from 1 to 8')
    }
  })

  it('selects the platform file, preserves literal secrets, and excludes stale ambient release settings', async () => {
    await withDirectory(async (directory) => {
      await writeFile(join(directory, '.env.windows'), '\uFEFFDSH_DESKTOP_APP_ID=com.example.windows\r\nDSH_DESKTOP_WINDOWS_TOKEN_PIN=" #!$%&literal "\r\nDSH_DESKTOP_WINDOWS_CER_FILE="keys/public certificate.cer"\r\n')
      const parent = {
        PATH: 'build-tools', DSH_DESKTOP_APP_ID: 'com.stale.desktop',
        DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: '{"origin":"https://stale.example.com"}',
        dsh_desktop_mandatory_update_config: 'stale-policy',
        DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://stale.example.com',
        dsh_desktop_mandatory_update_prod_origin: 'https://stale.example.com',
        DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'stale-pin',
        CSC_LINK: 'stale-certificate', DOWNLOAD_TEST_ORIGIN: 'https://stale.example.com',
        DOWNLOAD_TEST_RELEASE_ID: 'a'.repeat(32), download_test_release_id: 'b'.repeat(32),
        dsh_desktop_windows_key_container: 'case-insensitive-stale-container',
      }
      expect(loadDesktopPackageEnvironment('win32', parent, directory)).toEqual({
        PATH: 'build-tools', DSH_DESKTOP_APP_ID: 'com.example.windows',
        DSH_DESKTOP_WINDOWS_TOKEN_PIN: ' #!$%&literal ',
        DSH_DESKTOP_WINDOWS_CER_FILE: join(directory, 'keys', 'public certificate.cer'),
      })
      expect(parent.DSH_DESKTOP_WINDOWS_TOKEN_PIN).toBe('stale-pin')
      expect(parent.dsh_desktop_mandatory_update_config).toBe('stale-policy')
    })
  })

  it('owns the release ID in its platform file', async () => {
    await withDirectory(async (directory) => {
      const settings = Object.entries(RELEASE).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n'
      const file = join(directory, '.env.windows')
      const parent = { DOWNLOAD_TEST_RELEASE_ID: 'a'.repeat(32) }
      await writeFile(file, settings)
      expect(loadDesktopPackageEnvironment('win32', parent, directory).DOWNLOAD_TEST_RELEASE_ID).toBe(RELEASE.DOWNLOAD_TEST_RELEASE_ID)
      await writeFile(file, settings.replace(`DOWNLOAD_TEST_RELEASE_ID='${RELEASE.DOWNLOAD_TEST_RELEASE_ID}'\n`, ''))
      const missing = loadDesktopPackageEnvironment('win32', parent, directory)
      expect(missing.DOWNLOAD_TEST_RELEASE_ID).toBeUndefined()
      expect(() => {
        validateDesktopPackageEnvironment(missing, WINDOWS)
      }).toThrow(/DOWNLOAD_TEST_RELEASE_ID/u)
      expect(parent.DOWNLOAD_TEST_RELEASE_ID).toBe('a'.repeat(32))
    })
  })

  it('loads mandatory update origins and options only from the platform file without changing its parent', async () => {
    await withDirectory(async (directory) => {
      const windowsPolicy = JSON.stringify({ intervalMs: 5000, allowedPageOrigins: ['https://download.example.invalid'] })
      const origins = { DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://test.example.invalid',
        DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://prod.example.invalid' }
      const lines = Object.entries(origins).map(([key, value]) => `${key}=${value}\n`).join('')
      await writeFile(join(directory, '.env.windows'), `${lines}DSH_DESKTOP_MANDATORY_UPDATE_CONFIG='${windowsPolicy}'\n`)
      const parent = { DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: 'stale-policy' }
      expect(loadDesktopPackageEnvironment('win32', parent, directory)).toEqual({ ...origins, DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: windowsPolicy })
      expect(parent).toEqual({ DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: 'stale-policy' })
    })
  })

  it('requires the local file even when ambient configuration exists and rejects other-platform fields', async () => {
    await withDirectory(async (directory) => {
      expect(() => loadDesktopPackageEnvironment('win32', RELEASE, directory)).toThrow(/copy .*\.env.windows.example/u)
      await writeFile(join(directory, '.env.windows'), 'APPLE_APP_SPECIFIC_PASSWORD=secret-sentinel\n')
      expect(() => loadDesktopPackageEnvironment('win32', {}, directory)).toThrow(/unsupported setting APPLE_APP_SPECIFIC_PASSWORD/u)
      expect(() => loadDesktopPackageEnvironment('win32', {}, directory)).not.toThrow(/secret-sentinel/u)
    })
  })

  it('checks application and update configuration before Windows credentials while preserving unsigned and preparation modes', () => {
    expect(() => {
      validateDesktopPackageEnvironment({}, WINDOWS, { unsigned: true })
    }).toThrow(/DSH_DESKTOP_APP_ID/u)
    expect(() => {
      validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'invalid' }, WINDOWS)
    }).toThrow(/reverse-DNS/u)
    expect(() => {
      validateDesktopPackageEnvironment({ ...POLICY, DSH_DESKTOP_APP_ID: RELEASE.DSH_DESKTOP_APP_ID }, WINDOWS)
    }).toThrow(/DOWNLOAD_TEST_ORIGIN/u)
    expect(() => {
      validateDesktopPackageEnvironment(RELEASE, WINDOWS)
    }).toThrow(/DSH_DESKTOP_WINDOWS_CER_FILE/u)
    expect(() => {
      validateDesktopPackageEnvironment({ ...POLICY, DSH_DESKTOP_APP_ID: RELEASE.DSH_DESKTOP_APP_ID }, WINDOWS, { unsigned: true })
    }).not.toThrow()
    expect(() => {
      validateDesktopPackageEnvironment({ ...POLICY, DSH_DESKTOP_APP_ID: RELEASE.DSH_DESKTOP_APP_ID }, WINDOWS, { prepareOnly: true })
    }).not.toThrow()
  })

  it('accepts one local npm registry mirror and rejects other registry forms', () => {
    const release = { ...POLICY, DSH_DESKTOP_APP_ID: RELEASE.DSH_DESKTOP_APP_ID }
    expect(() => {
      validateDesktopPackageEnvironment({ ...release, DSH_DESKTOP_NPM_REGISTRY: 'https://registry.npmmirror.com/' }, WINDOWS, { unsigned: true })
    }).not.toThrow()
    for (const value of ['http://registry.example.com/', 'https://registry.example.com/path', 'https://user:secret@registry.example.com/', 'not-a-url']) {
      expect(() => {
        validateDesktopPackageEnvironment({ ...release, DSH_DESKTOP_NPM_REGISTRY: value }, WINDOWS, { unsigned: true })
      }).toThrow(/DSH_DESKTOP_NPM_REGISTRY/u)
    }
  })

  it('rejects non-Windows packaging platforms', () => {
    expect(() => loadDesktopPackageEnvironment('darwin' as 'win32')).toThrow(/Windows is the only supported/u)
  })
})
