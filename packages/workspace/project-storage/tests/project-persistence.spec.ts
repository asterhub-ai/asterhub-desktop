import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import ProjectStorage from '../src/index.ts'
import ProjectSessionPersistence from '../src/persistence.ts'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function filesUnder(root: string): Promise<string[]> {
  const paths: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else paths.push(path)
    }
  }
  await visit(root)
  return paths.sort()
}

async function mount(_root: string, locatorPath: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ProjectStorage, {
    sessionMode: 'project-local', locatorPath, legacySessionRoot: '', metadataLimitBytes: 1024 * 1024, lockDeadlineMs: 5000,
  })
  return ctx
}

describe('project-routed Session persistence', () => {
  it('resumes the same immutable Session bytes from a copied project root', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-persistence-'))
    roots.push(home)
    const original = join(home, 'project-a'), copied = join(home, 'project-b')
    await mkdir(original)
    const sourceCtx = await mount(original, join(home, 'locator-a.json'))
    await sourceCtx.projectStorage.open({ root: original, mode: 'new' })
    await sourceCtx.plugin(ProjectSessionPersistence, { compression: 'none' })

    const sessionId = SessionId('portable-session')
    const header: SessionHeader = {
      version: 4, id: sessionId, createdAt: 10, cwd: original, isSeeded: false, delegationDepth: 0,
    }
    const writer = await sourceCtx.sessionPersistence.create(header)
    await writer.append([{ type: 'turn/start', seq: SessionSeq(0), time: 11, data: { turn: 1 } }])
    await writer.flush()
    await writer.close()
    const sourceFiles = await filesUnder(join(original, '.aster', 'sessions'))
    expect(sourceFiles.length).toBeGreaterThan(0)
    const sourceBytes = await Promise.all(sourceFiles.map(path => readFile(path)))
    const sourceDigests = sourceBytes.map(bytes => createHash('sha256').update(bytes).digest('hex'))
    await sourceCtx.fiber.dispose()

    await mkdir(copied)
    await cp(join(original, '.aster'), join(copied, '.aster'), { recursive: true })
    const copiedCtx = await mount(copied, join(home, 'locator-b.json'))
    const inspection = await copiedCtx.projectStorage.inspect(copied)
    if (inspection.kind !== 'existing') throw new Error('expected copied project proposal')
    await copiedCtx.projectStorage.open({
      root: copied, mode: 'existing', expectedId: inspection.manifest.id, expectedDigest: inspection.digest,
    })
    await copiedCtx.plugin(ProjectSessionPersistence, { compression: 'none' })
    const reader = await copiedCtx.sessionPersistence.open(sessionId, 'read')
    try {
      expect(reader.header.id).toBe(sessionId)
      expect((await reader.read()).events).toMatchObject([{ type: 'turn/start', data: { turn: 1 } }])
      expect(await copiedCtx.sessionPersistence.stat(sessionId)).toMatchObject({ header: { id: sessionId } })
      expect((await copiedCtx.sessionPersistence.list()).map(snapshot => snapshot.header.id)).toEqual([sessionId])
      await expect(copiedCtx.sessionPersistence.open(SessionId('unknown-owner'), 'read'))
        .rejects.toMatchObject({ name: 'SessionPersistenceNotFoundError' })
    } finally {
      await reader.close()
      await copiedCtx.fiber.dispose()
    }
    const copiedFiles = await filesUnder(join(copied, '.aster', 'sessions'))
    expect(await Promise.all(copiedFiles.map(async path => createHash('sha256').update(await readFile(path)).digest('hex')))).toEqual(sourceDigests)
  })
  it('rebinds a quiescent Session backend after the project root moves', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-rebind-'))
    roots.push(home)
    const original = join(home, 'before-move'), moved = join(home, 'after-move')
    await mkdir(original)
    const ctx = await mount(original, join(home, 'locator.json'))
    await ctx.projectStorage.open({ root: original, mode: 'new' })
    await ctx.plugin(ProjectSessionPersistence, { compression: 'none' })
    const sessionId = SessionId('rebound-session')
    const writer = await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 10, cwd: original, isSeeded: false, delegationDepth: 0,
    })
    await writer.append([{ type: 'turn/start', seq: SessionSeq(0), time: 11, data: { turn: 1 } }])
    await writer.flush()
    await writer.close()
    await rename(original, moved)

    try {
      const inspection = await ctx.projectStorage.inspect(moved)
      if (inspection.kind !== 'existing') throw new Error('expected moved project proposal')
      await ctx.projectStorage.open({
        root: moved, mode: 'existing', expectedId: inspection.manifest.id, expectedDigest: inspection.digest,
      })
      const reader = await ctx.sessionPersistence.open(sessionId, 'read')
      try {
        expect((await reader.read()).events).toMatchObject([{ type: 'turn/start', data: { turn: 1 } }])
      } finally {
        await reader.close()
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('preserves the inherited cut and terminal marker through a project backend', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-inheritance-'))
    roots.push(home)
    const project = join(home, 'project')
    await mkdir(project)
    const ctx = await mount(project, join(home, 'locator.json'))
    await ctx.projectStorage.open({ root: project, mode: 'new' })
    await ctx.plugin(ProjectSessionPersistence, { compression: 'none' })
    const sessionId = SessionId('seeded-project-session')
    const writer = await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 10, cwd: project,
      parentSession: SessionId('seed-parent'), isSeeded: true, origin: 'subagent', delegationDepth: 1,
    }, { inheritedEventCount: SessionLogOffset(0) })
    await writer.append([{ type: 'session/end-seed', seq: SessionSeq(0), time: 11, data: { inherited: true } }])
    await writer.flush()
    await writer.close()
    const reader = await ctx.sessionPersistence.open(sessionId, 'read')
    try {
      expect(reader.inheritedEventCount).toBe(SessionLogOffset(0))
      expect((await reader.read()).events).toMatchObject([{ type: 'session/end-seed', data: { inherited: true } }])
    } finally {
      await reader.close()
      await ctx.fiber.dispose()
    }
  })
})
it('does not publish Session membership when a project is read-only', async () => {
  const home = await mkdtemp(join(tmpdir(), 'project-readonly-'))
  roots.push(home)
  const project = join(home, 'project')
  await mkdir(project)
  const ctx = await mount(project, join(home, 'locator.json'))
  const binding = await ctx.projectStorage.open({ root: project, mode: 'new' })
  await ctx.plugin(ProjectSessionPersistence, { compression: 'none' })
  const manifestPath = join(project, '.aster', 'project.json')
  const before = await readFile(manifestPath)
  await chmod(manifestPath, 0o400)
  try {
    await expect(ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id: SessionId('read-only-session'), createdAt: 10,
      cwd: project, isSeeded: false, delegationDepth: 0,
    })).rejects.toThrow(/read-only/i)
    await expect(ctx.projectStorage.rename(binding.id, 'Read-only mutation'))
      .rejects.toThrow(/read-only/i)
    await expect(readFile(manifestPath)).resolves.toEqual(before)
  } finally {
    await chmod(manifestPath, 0o600)
    await ctx.fiber.dispose()
  }
})
