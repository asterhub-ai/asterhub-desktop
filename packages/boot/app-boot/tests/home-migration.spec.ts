import type * as FsPromises from 'node:fs/promises'
import { lstat, link, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeMigrationConflictError, prepareAsterHubHome } from '../src/index.ts'

const stageBarrier = vi.hoisted(() => ({
  current: undefined as { created: () => void; wait: Promise<void> } | undefined,
  afterRemovingEmptyDestination: undefined as (() => Promise<void>) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    async mkdtemp(prefix: string): Promise<string> {
      const path = await actual.mkdtemp(prefix)
      const barrier = stageBarrier.current
      if (barrier !== undefined && prefix.includes('.asterhub-migration-stage-')) {
        barrier.created()
        await barrier.wait
      }
      return path
    },
    async rmdir(path: FsPromises.PathLike): Promise<void> {
      const afterRemoval = stageBarrier.afterRemovingEmptyDestination
      const removed = await actual.rmdir(path)
      if (afterRemoval !== undefined && typeof path === 'string' && path.endsWith('.asterhub')) {
        stageBarrier.afterRemovingEmptyDestination = undefined
        await afterRemoval()
      }
      return removed
    },
  }
})

function blockMigrationStage(): { ready: Promise<void>; release: () => void } {
  let notifyCreated!: () => void
  const ready = new Promise<void>(resolve => { notifyCreated = resolve })
  let releaseStage!: () => void
  const wait = new Promise<void>(resolve => { releaseStage = resolve })
  stageBarrier.current = { created: notifyCreated, wait }
  return {
    ready,
    release: () => {
      releaseStage()
      stageBarrier.current = undefined
    },
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; oldHome: string; newHome: string }> {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-home-migration-'))

  roots.push(root)
  return { root, oldHome: join(root, '.dsh'), newHome: join(root, '.asterhub') }
}

describe('prepareAsterHubHome', () => {
  it('copies an old-only home without removing its source', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(join(oldHome, 'profiles'), { recursive: true })
    await writeFile(join(oldHome, 'profiles', 'config.yml'), 'profile: local\n')

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).resolves.toEqual({ home: newHome, migration: 'copied' })
    await expect(readFile(join(newHome, 'profiles', 'config.yml'), 'utf8')).resolves.toBe('profile: local\n')
    await expect(readFile(join(oldHome, 'profiles', 'config.yml'), 'utf8')).resolves.toBe('profile: local\n')
    await expect(readdir(root)).resolves.not.toEqual(expect.arrayContaining([expect.stringMatching(/^\.asterhub-migration-stage-/)]))
  })
  it('copies hard-linked source files as independent destination files', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(oldHome)
    const original = join(oldHome, 'profile.json')
    const alias = join(oldHome, 'profile-copy.json')
    await writeFile(original, '{"profile":"local"}\n')
    await link(original, alias)

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).resolves.toEqual({ home: newHome, migration: 'copied' })
    await expect(readFile(join(newHome, 'profile.json'), 'utf8')).resolves.toBe('{"profile":"local"}\n')
    await expect(readFile(join(newHome, 'profile-copy.json'), 'utf8')).resolves.toBe('{"profile":"local"}\n')
    await writeFile(join(newHome, 'profile.json'), '{"profile":"destination-only"}\n')
    await expect(readFile(join(newHome, 'profile-copy.json'), 'utf8')).resolves.toBe('{"profile":"local"}\n')
    await expect(readFile(original, 'utf8')).resolves.toBe('{"profile":"local"}\n')
    await expect(readFile(alias, 'utf8')).resolves.toBe('{"profile":"local"}\n')
  })


  it('keeps an independently populated new-only home without importing a legacy root', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(newHome)
    await writeFile(join(newHome, 'settings.json'), '{"source":"new"}')

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).resolves.toEqual({ home: newHome, migration: 'none' })
    await expect(readdir(oldHome)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not recopy or overwrite a destination after a completed migration', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(oldHome)
    await writeFile(join(oldHome, 'source.txt'), 'copied')
    await prepareAsterHubHome({ userHome: root, env: {} })
    await writeFile(join(oldHome, 'source.txt'), 'changed later')
    await writeFile(join(newHome, 'destination.txt'), 'destination-owned')

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).resolves.toEqual({ home: newHome, migration: 'none' })
    await expect(readFile(join(newHome, 'source.txt'), 'utf8')).resolves.toBe('copied')
    await expect(readFile(join(newHome, 'destination.txt'), 'utf8')).resolves.toBe('destination-owned')
  })

  it('reports two populated roots as a conflict rather than merging', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(oldHome)
    await mkdir(newHome)
    await writeFile(join(oldHome, 'legacy.txt'), 'legacy')
    await writeFile(join(newHome, 'new.txt'), 'new')

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).rejects.toBeInstanceOf(HomeMigrationConflictError)
    await expect(readdir(oldHome)).resolves.toContain('legacy.txt')
    await expect(readdir(newHome)).resolves.toContain('new.txt')
  })
  it('never displaces destination data created immediately before publication', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(oldHome)
    await writeFile(join(oldHome, 'legacy.txt'), 'legacy')
    await mkdir(newHome)
    const racerFile = join(newHome, 'concurrent.txt')
    stageBarrier.afterRemovingEmptyDestination = async () => {
      await mkdir(newHome)
      await writeFile(racerFile, 'concurrent destination data')
    }

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).rejects.toBeInstanceOf(HomeMigrationConflictError)
    await expect(readFile(racerFile, 'utf8')).resolves.toBe('concurrent destination data')
    await expect(readFile(join(oldHome, 'legacy.txt'), 'utf8')).resolves.toBe('legacy')
  })

  it('retains staging evidence when a source mutation interrupts the copy', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(oldHome)
    const source = join(oldHome, 'changing.txt')
    await writeFile(source, 'initial source bytes')
    const barrier = blockMigrationStage()
    const migration = prepareAsterHubHome({ userHome: root, env: {} })
    const rejected = expect(migration).rejects.toMatchObject({ message: expect.stringMatching(/staging\/recovery evidence/) })
    try {
      await barrier.ready
      await writeFile(source, 'changed while staging')
      barrier.release()
      await rejected
      await expect(readFile(source, 'utf8')).resolves.toBe('changed while staging')
      await expect(lstat(newHome)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readdir(root)).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/^\.asterhub-migration-stage-/)]))
    } finally {
      barrier.release()
      await migration.catch(() => undefined)
    }
  })

  it('retains source and staging evidence when cancelled during staging', async () => {
    const { root, oldHome, newHome } = await fixture()
    await mkdir(oldHome)
    await writeFile(join(oldHome, 'stable.txt'), 'preserve me')
    const barrier = blockMigrationStage()
    const controller = new AbortController()
    const migration = prepareAsterHubHome({ userHome: root, env: {}, signal: controller.signal })
    const rejected = expect(migration).rejects.toMatchObject({ message: expect.stringMatching(/staging\/recovery evidence/) })
    try {
      await barrier.ready
      controller.abort(new Error('cancelled by caller'))
      barrier.release()
      await rejected
      await expect(readFile(join(oldHome, 'stable.txt'), 'utf8')).resolves.toBe('preserve me')
      await expect(lstat(newHome)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readdir(root)).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/^\.asterhub-migration-stage-/)]))
    } finally {
      barrier.release()
      await migration.catch(() => undefined)
    }
  })



  it('returns an explicit configured home before consulting either default root', async () => {
    const { root, oldHome } = await fixture()
    await mkdir(oldHome)
    await writeFile(join(oldHome, 'legacy.txt'), 'untouched')
    const configuredHome = join(root, 'configured')

    await expect(prepareAsterHubHome({ userHome: root, configuredHome, env: { DSH_HOME: join(root, 'env') } }))
      .resolves.toEqual({ home: configuredHome, migration: 'explicit' })
    await expect(readdir(oldHome)).resolves.toContain('legacy.txt')
    await expect(prepareAsterHubHome({ userHome: root, env: { DSH_HOME: join(root, 'env') } }))
      .resolves.toEqual({ home: join(root, 'env'), migration: 'explicit' })
  })

  it('rewrites an absolute internal symlink target when publishing to the new root', async () => {
    const { root, oldHome, newHome } = await fixture()
    const targetDirectory = join(oldHome, 'target')
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(join(targetDirectory, 'data.txt'), 'target')
    await symlink(targetDirectory, join(oldHome, 'link'), process.platform === 'win32' ? 'junction' : 'dir')

    await prepareAsterHubHome({ userHome: root, env: {} })

    const linkTarget = await readlink(join(newHome, 'link'))
    expect(resolve(dirname(join(newHome, 'link')), linkTarget)).toBe(join(newHome, 'target'))
  })

  it('refuses external symlink targets instead of copying outside the legacy home', async () => {
    const { root, oldHome } = await fixture()
    const external = join(root, 'external')
    await mkdir(oldHome)
    await mkdir(external)
    await writeFile(join(external, 'secret.txt'), 'not part of the home')
    await symlink(external, join(oldHome, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(prepareAsterHubHome({ userHome: root, env: {} })).rejects.toThrow(/external|outside|link/i)
    await expect(readFile(join(external, 'secret.txt'), 'utf8')).resolves.toBe('not part of the home')
  })
})
