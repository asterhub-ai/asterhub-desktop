import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import ProjectStorage from '../src/index.ts'
import ProjectSessionPersistence from '../src/persistence.ts'
import { ProjectId } from '../src/manifest.ts'
import { createLegacyAdopter, projectKey } from '../src/legacy-sessions.ts'
import type { LegacyProjectProposal } from '../src/types.ts'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempDir(prefix = 'legacy-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

describe('createLegacyAdopter', () => {
  it('stages and publishes legacy session generations byte-for-byte while preserving source', async () => {
    const home = await tempDir()
    const sourceRoot = join(home, 'source-sessions')
    const destRoot = join(home, 'dest-project')
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(destRoot, { recursive: true })

    const sessionId = SessionId('legacy-session-1')
    const legacyCwd = '/opt/legacy-work'
    const sessionDir = join(sourceRoot, projectKey(legacyCwd), String(sessionId))
    await mkdir(sessionDir, { recursive: true })

    const headerLine = JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 100,
      cwd: legacyCwd,
      isSeeded: false,
      delegationDepth: 0,
    })
    const eventLine = JSON.stringify({
      type: 'turn/start',
      seq: 0,
      time: 101,
      data: { turn: 1 },
    })
    const logContent = `${headerLine}\n${eventLine}\n`
    const sourceLogPath = join(sessionDir, 'session.v4.jsonl')
    await writeFile(sourceLogPath, logContent, 'utf8')
    const sourceDigest = createHash('sha256').update(logContent).digest('hex')

    const projectId = ProjectId('e2719a2e-650c-49fb-9c98-3c4e0ce61970')
    const proposal: LegacyProjectProposal = {
      projectId,
      title: 'Adopted Legacy Project',
      sourceRoot,
      sessions: [{ id: sessionId, relativeCwd: '.' }],
      sessionOrder: [sessionId],
      pinnedSessionIds: [sessionId],
      archivedSessionIds: [],
    }

    const adopter = createLegacyAdopter()
    const manifest = await adopter(proposal, destRoot)

    expect(manifest.id).toBe(projectId)
    expect(manifest.title).toBe('Adopted Legacy Project')
    expect(manifest.sessions).toEqual(proposal.sessions)
    expect(manifest.pinnedSessionIds).toEqual([sessionId])

    // Verify destination copy
    const destLogPath = join(destRoot, '.aster', 'sessions', projectKey(legacyCwd), String(sessionId), 'session.v4.jsonl')
    const destBytes = await readFile(destLogPath, 'utf8')
    expect(destBytes).toBe(logContent)
    expect(createHash('sha256').update(destBytes).digest('hex')).toBe(sourceDigest)

    // Verify source is untouched
    expect(await readFile(sourceLogPath, 'utf8')).toBe(logContent)

    // Verify no leftover staging directories
    const asterEntries = await readdir(join(destRoot, '.aster'))
    expect(asterEntries.some(entry => entry.startsWith('.stage-'))).toBe(false)
  })

  it('fails loudly without publishing files when a session is missing from source', async () => {
    const home = await tempDir()
    const sourceRoot = join(home, 'empty-source')
    const destRoot = join(home, 'dest-project')
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(destRoot, { recursive: true })

    const missingSession = SessionId('missing-session')
    const proposal: LegacyProjectProposal = {
      projectId: ProjectId('f2719a2e-650c-49fb-9c98-3c4e0ce61970'),
      title: 'Missing Session Project',
      sourceRoot,
      sessions: [{ id: missingSession, relativeCwd: '.' }],
      sessionOrder: [missingSession],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    }

    const adopter = createLegacyAdopter()
    await expect(adopter(proposal, destRoot)).rejects.toThrow(/legacy session.*not found/i)

    // Staging and destination sessions must not exist or be empty
    const asterSessions = join(destRoot, '.aster', 'sessions')
    const exists = await readdir(asterSessions).catch(() => undefined)
    expect(exists).toBeUndefined()
  })

  it('integrates with ProjectStorageService and allows ProjectSessionPersistence to read adopted sessions', async () => {
    const home = await tempDir()
    const sourceRoot = join(home, 'source-sessions')
    const projectRoot = join(home, 'adopted-project')
    const locatorPath = join(home, 'locator.json')
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })

    const sessionId = SessionId('full-cycle-session')
    const origCwd = join(home, 'legacy-orig-work')
    const sessionDir = join(sourceRoot, projectKey(origCwd), String(sessionId))
    await mkdir(sessionDir, { recursive: true })

    const header = {
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 200,
      cwd: origCwd,
      isSeeded: false,
      delegationDepth: 0,
    }
    const event = {
      type: 'turn/start',
      seq: SessionSeq(0),
      time: 201,
      data: { turn: 1 },
    }
    await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify(header)}\n${JSON.stringify(event)}\n`)

    const projectId = ProjectId('b2719a2e-650c-49fb-9c98-3c4e0ce61970')
    const proposal: LegacyProjectProposal = {
      projectId,
      title: 'Full Cycle Project',
      sourceRoot,
      sessions: [{ id: sessionId, relativeCwd: '.' }],
      sessionOrder: [sessionId],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    }

    const ctx = new Context()
    await ctx.plugin(ProjectStorage, {
      sessionMode: 'project-local',
      locatorPath,
      legacySessionRoot: sourceRoot,
      metadataLimitBytes: 1024 * 1024,
      lockDeadlineMs: 5000,
    })

    ctx.projectStorage.registerLegacySource({
      inspect: async () => proposal,
    })
    ctx.projectStorage.registerLegacyAdopter(createLegacyAdopter())

    const inspection = await ctx.projectStorage.inspect(projectRoot)
    expect(inspection.kind).toBe('legacy')
    if (inspection.kind !== 'legacy') throw new Error('expected legacy inspection')

    const binding = await ctx.projectStorage.open({
      root: projectRoot,
      mode: 'legacy',
      expectedId: projectId,
      expectedDigest: inspection.digest,
    })
    expect(binding.id).toBe(projectId)

    // Now mount ProjectSessionPersistence and verify cold read of adopted session
    await ctx.plugin(ProjectSessionPersistence, { compression: 'none' })
    const reader = await ctx.sessionPersistence.open(sessionId, 'read')
    try {
      expect(reader.header.id).toBe(sessionId)
      const readResult = await reader.read()
      expect(readResult.events).toMatchObject([{ type: 'turn/start', data: { turn: 1 } }])
    } finally {
      await reader.close()
      await ctx.fiber.dispose()
    }
  })
})
