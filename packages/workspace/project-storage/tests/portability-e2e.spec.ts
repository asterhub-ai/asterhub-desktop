import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import ProjectStorage, { ensureProjectGitExclusion, resolveProjectAttachmentScope } from '../src/index.ts'
import ProjectSessionPersistence from '../src/persistence.ts'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempDir(prefix = 'portability-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

async function collectFileDigests(dir: string): Promise<Map<string, string>> {
  const digests = new Map<string, string>()
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (entry.isFile()) {
        const bytes = await readFile(fullPath)
        const hash = createHash('sha256').update(bytes).digest('hex')
        const rel = fullPath.slice(dir.length).replace(/^[/\\]+/, '').replace(/\\/g, '/')
        digests.set(rel, hash)
      }
    }
  }
  await visit(dir)
  return digests
}

describe('end-to-end project portability across synthetic machines', () => {
  it('cold resumes historical session, verifies attachments, and executes with current cwd on a second machine', async () => {
    // -------------------------------------------------------------
    // 1. Machine A: Create project X, write session, attachments, manifest mutations
    // -------------------------------------------------------------
    const machineA = await tempDir('machine-a-')
    const locatorA = join(machineA, 'locator.json')
    const projectA = join(machineA, 'project-x')
    await mkdir(projectA, { recursive: true })

    const ctxA = new Context()
    await ctxA.plugin(ProjectStorage, {
      sessionMode: 'project-local',
      locatorPath: locatorA,
      legacySessionRoot: '',
      metadataLimitBytes: 1024 * 1024,
      lockDeadlineMs: 5000,
    })

    // Inspect -> opens as new
    const inspectA = await ctxA.projectStorage.inspect(projectA)
    expect(inspectA.kind).toBe('new')

    const bindingA = await ctxA.projectStorage.open({ root: projectA, mode: 'new' })
    const projectId = bindingA.id

    // Git exclusion verification
    const gitExclusionA = await ensureProjectGitExclusion(projectA)
    expect(gitExclusionA.kind).toBe('not-git')
    const gitignoreContent = await readFile(join(projectA, '.gitignore'), 'utf8')
    expect(gitignoreContent).toContain('.aster/')

    // Mount Session Persistence on Machine A
    await ctxA.plugin(ProjectSessionPersistence, { compression: 'none' })

    const parentSessionId = SessionId('sess-portable-root')
    const headerA = {
      version: SESSION_FORMAT_VERSION,
      id: parentSessionId,
      createdAt: 1000,
      cwd: projectA,
      isSeeded: false,
      delegationDepth: 0,
    }

    const writerA = await ctxA.sessionPersistence.create(headerA)
    await writerA.append([
      { type: 'turn/start', seq: SessionSeq(0), time: 1001, data: { turn: 1 } },
      { type: 'turn/end', seq: SessionSeq(1), time: 1002, data: { turn: 1, reason: 'stop' } },
    ])
    await writerA.flush()
    await writerA.close()

    // Create a subagent session with inherited cut
    const subagentSessionId = SessionId('sess-portable-subagent')
    const subagentHeaderA = {
      version: SESSION_FORMAT_VERSION,
      id: subagentSessionId,
      createdAt: 2000,
      cwd: projectA,
      parentSession: parentSessionId,
      isSeeded: true,
      origin: 'subagent' as const,
      delegationDepth: 1,
    }
    const subWriterA = await ctxA.sessionPersistence.create(subagentHeaderA, {
      inheritedEventCount: SessionLogOffset(0),
    })
    await subWriterA.append([
      { type: 'session/end-seed', seq: SessionSeq(0), time: 2001, data: { inherited: true } },
    ])
    await subWriterA.flush()
    await subWriterA.close()

    // Write an attachment file inside .aster/attachments/v1
    const attachmentScope = resolveProjectAttachmentScope(ctxA, parentSessionId)
    expect(attachmentScope).toEqual({ projectId, sessionId: parentSessionId })

    const attachmentLoc = ctxA.projectStorage.locateSession(parentSessionId)
    expect(attachmentLoc).toBeDefined()
    const attachmentsDir = attachmentLoc!.attachmentsRoot
    await mkdir(attachmentsDir, { recursive: true, mode: 0o700 })

    const sampleAttachmentBytes = Buffer.from('portable attachment content: image-or-file')
    const sampleAttachmentDigest = createHash('sha256').update(sampleAttachmentBytes).digest('hex')
    const sampleAttachmentPath = join(attachmentsDir, `sample-${sampleAttachmentDigest}.bin`)
    await writeFile(sampleAttachmentPath, sampleAttachmentBytes)

    // Manifest metadata mutations: order, pin, title
    await ctxA.projectStorage.setSessionPinned(projectId, parentSessionId, true)
    await ctxA.projectStorage.rename(projectId, 'Ported Workstation Project')

    const manifestA = ctxA.projectStorage.manifest(projectId)
    expect(manifestA.title).toBe('Ported Workstation Project')
    expect(manifestA.pinnedSessionIds).toContain(parentSessionId)

    // Dispose Machine A completely
    await ctxA.fiber.dispose()

    // Record digests of all files in .aster before copying
    const originalDigests = await collectFileDigests(join(projectA, '.aster'))
    expect(originalDigests.size).toBeGreaterThan(0)

    // -------------------------------------------------------------
    // 2. Transport: Copy project X to Machine B, destroy Machine A
    // -------------------------------------------------------------
    const machineB = await tempDir('machine-b-')
    const locatorB = join(machineB, 'locator.json')
    const projectB = join(machineB, 'project-x-moved')

    await mkdir(projectB, { recursive: true })
    await cp(join(projectA, '.aster'), join(projectB, '.aster'), { recursive: true })
    await cp(join(projectA, '.gitignore'), join(projectB, '.gitignore'))

    // Destroy Machine A completely to ensure zero fallback
    await rm(machineA, { recursive: true, force: true })

    // -------------------------------------------------------------
    // 3. Machine B: Discover existing project, confirm open, cold resume
    // -------------------------------------------------------------
    const ctxB = new Context()
    await ctxB.plugin(ProjectStorage, {
      sessionMode: 'project-local',
      locatorPath: locatorB,
      legacySessionRoot: '',
      metadataLimitBytes: 1024 * 1024,
      lockDeadlineMs: 5000,
    })

    // Inspect on Machine B -> must report 'existing'
    const inspectB = await ctxB.projectStorage.inspect(projectB)
    expect(inspectB.kind).toBe('existing')
    if (inspectB.kind !== 'existing') throw new Error('expected existing project inspection on Machine B')

    expect(inspectB.manifest.id).toBe(projectId)
    expect(inspectB.manifest.title).toBe('Ported Workstation Project')
    expect(inspectB.manifest.pinnedSessionIds).toContain(parentSessionId)

    // Confirm open on Machine B
    const bindingB = await ctxB.projectStorage.open({
      root: projectB,
      mode: 'existing',
      expectedId: inspectB.manifest.id,
      expectedDigest: inspectB.digest,
    })
    expect(bindingB.id).toBe(projectId)

    // Mount Session Persistence on Machine B
    await ctxB.plugin(ProjectSessionPersistence, { compression: 'none' })

    // Cold read historical root session on Machine B
    const readerB = await ctxB.sessionPersistence.open(parentSessionId, 'read')
    try {
      expect(readerB.header.id).toBe(parentSessionId)
      expect(readerB.header.createdAt).toBe(1000)
      // Historical header.cwd remains unchanged (projectA) - immutable invariant!
      expect(readerB.header.cwd).toBe(projectA)

      const events = (await readerB.read()).events
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ type: 'turn/start', data: { turn: 1 } })
      expect(events[1]).toMatchObject({ type: 'turn/end', data: { turn: 1, reason: 'stop' } })
    } finally {
      await readerB.close()
    }

    // Verify subagent session cold read with inherited cut
    const subReaderB = await ctxB.sessionPersistence.open(subagentSessionId, 'read')
    try {
      expect(subReaderB.header.id).toBe(subagentSessionId)
      expect(subReaderB.header.parentSession).toBe(parentSessionId)
      expect(subReaderB.inheritedEventCount).toBe(SessionLogOffset(0))
      const subEvents = (await subReaderB.read()).events
      expect(subEvents).toHaveLength(1)
      expect(subEvents[0]).toMatchObject({ type: 'session/end-seed', data: { inherited: true } })
    } finally {
      await subReaderB.close()
    }

    // Current execution cwd on Machine B must resolve to projectB, NOT projectA!
    const execCwdParent = ctxB.projectStorage.executionCwd(headerA)
    expect(execCwdParent).toBe(projectB)

    const execCwdSubagent = ctxB.projectStorage.executionCwd(subagentHeaderA)
    expect(execCwdSubagent).toBe(projectB)

    // Verify attachment bytes preserved on Machine B
    const attachmentScopeB = resolveProjectAttachmentScope(ctxB, parentSessionId)
    expect(attachmentScopeB).toEqual({ projectId, sessionId: parentSessionId })
    const locB = ctxB.projectStorage.locateSession(parentSessionId)
    expect(locB).toBeDefined()
    const targetAttachmentPath = join(locB!.attachmentsRoot, `sample-${sampleAttachmentDigest}.bin`)
    const targetAttachmentBytes = await readFile(targetAttachmentPath)
    expect(targetAttachmentBytes).toEqual(sampleAttachmentBytes)

    // Write a new turn on Machine B (continuing the same session)
    const writerB = await ctxB.sessionPersistence.open(parentSessionId, 'write')
    try {
      await writerB.append([
        { type: 'turn/start', seq: SessionSeq(2), time: 3001, data: { turn: 2 } },
        { type: 'turn/end', seq: SessionSeq(3), time: 3002, data: { turn: 2, reason: 'stop' } },
      ])
      await writerB.flush()
    } finally {
      await writerB.close()
    }

    // Read back all events on Machine B
    const finalReaderB = await ctxB.sessionPersistence.open(parentSessionId, 'read')
    try {
      const allEvents = (await finalReaderB.read()).events
      expect(allEvents).toHaveLength(4)
      expect(allEvents.map(e => e.seq)).toEqual([0, 1, 2, 3])
    } finally {
      await finalReaderB.close()
    }

    await ctxB.fiber.dispose()
  })
})
