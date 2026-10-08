import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DSH_HOME_DISPLAY,
  DSH_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultDshHome,
  dshCachePath,
  dshHomeDisplay,
  dshHomePath,
  expandHomePath,
  resolveDshHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default AsterHub home directory name', () => {
    expect(DSH_HOME_DIR_NAME).toBe('.asterhub')
    expect(DEFAULT_DSH_HOME_DISPLAY).toBe('~/.asterhub')
    expect(defaultDshHome()).toBe(join(homedir(), '.asterhub'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.asterhub')).toBe(join(homedir(), '.asterhub'))
    expect(expandHomePath('~\\.asterhub')).toBe(join(homedir(), '.asterhub'))
    expect(expandHomePath('/tmp/.asterhub')).toBe('/tmp/.asterhub')
    expect(expandHomePath('~other/.asterhub')).toBe('~other/.asterhub')
  })

  it('resolves explicit path before DSH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-asterhub')

    expect(resolveDshHome('/tmp/explicit-asterhub', { DSH_HOME: '~/env-asterhub' })).toBe(resolve('/tmp/explicit-asterhub'))
    expect(resolveDshHome(undefined, { DSH_HOME: '~/env-asterhub' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only DSH_HOME as unset', () => {
    expect(resolveDshHome(undefined, { DSH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { DSH_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved DSH_HOME', () => {
    vi.stubEnv('DSH_HOME', '~/env-asterhub')
    expect(dshHomePath()).toBe(join(homedir(), 'env-asterhub'))
    expect(dshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-asterhub', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.asterhub')
    expect(dshHomeDisplay('/some/other/root')).toBe('$DSH_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.asterhub')],
    ['', join(homedir(), '.asterhub')],
    ['   ', join(homedir(), '.asterhub')],
    ['~/env-asterhub', join(homedir(), 'env-asterhub')],
    ['./relative-asterhub', resolve('./relative-asterhub')],
  ] as const)('resolves cache paths with DSH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('DSH_HOME', home)
    try {
      expect(dshCachePath()).toBe(join(expectedHome, 'cache'))
      expect(dshCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('DSH_HOME', '~/env-dsh')
    try {
      expect(dshCachePath({ dshHome: '~/explicit-dsh' })).toBe(join(homedir(), 'explicit-dsh', 'cache'))
      expect(dshCachePath({ dshHome: './explicit-dsh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-dsh/cache/attachments/request-images'))
      expect(dshCachePath({}, 'attachments')).toBe(join(homedir(), 'env-dsh', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
