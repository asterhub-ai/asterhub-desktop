import { copyFile, mkdir, mkdtemp, readFile, rm, chmod, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { ProjectId, createManifest } from '../src/manifest.ts'
import { ProjectMigrationUnavailableError, createProjectStorage } from '../src/registry.ts'
import type { LegacyProjectProposal, PortableProjectManifest } from '../src/types.ts'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'project-storage-'))
  roots.push(path)
  return path
}
afterEach(async () => {
  const paths = roots.splice(0)
  for (const path of paths) await chmod(path, 0o700).catch(() => {})
  await Promise.all(paths.map(path => rm(path, { recursive: true, force: true })))
})
function header(id: string, cwd: string, parentSession?: string): SessionHeader {
  return {
    version: 4,
    id: SessionId(id),
    createdAt: 1,
    cwd,
    isSeeded: parentSession !== undefined,
    ...(parentSession === undefined ? {} : { parentSession: SessionId(parentSession) }),
  }
}
function storageOptions(locatorPath: string) {
  return {
    sessionMode: 'project-local' as const,
    locatorPath,
    legacySessionRoot: '',
    metadataLimitBytes: 1024 * 1024,
    lockDeadlineMs: 5000,
  }
}

describe('project locator and local membership', () => {
  it('inspection is read-only, confirmed opening is idempotent, and unregister preserves local files', async () => {
    const project = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    expect(await storage.inspect(project)).toEqual({ kind: 'new', root: project })
    await expect(access(join(project, '.aster'))).rejects.toThrow()
    const binding = await storage.open({ root: project, mode: 'new' })
    const inspected = await storage.inspect(project)
    expect(inspected.kind).toBe('registered')
    if (inspected.kind !== 'registered') throw new Error('expected registered project')
    await expect(storage.open({ root: project, mode: 'existing', expectedId: binding.id, expectedDigest: inspected.digest })).resolves.toEqual(binding)
    const local = join(project, '.aster', 'project.json')
    const bytes = await readFile(local)
    await storage.unregister(binding.id)
    expect(await readFile(local)).toEqual(bytes)
  })

  it('revalidates confirmation digests and refuses a second root claiming an ID', async () => {
    const a = await root(), b = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    const binding = await storage.open({ root: a, mode: 'new' })
    const inspected = await storage.inspect(a)
    if (inspected.kind !== 'registered') throw new Error('expected registered project')
    await expect(storage.open({ root: a, mode: 'existing', expectedId: binding.id, expectedDigest: 'stale' })).rejects.toThrow(/digest/i)
    const raw: unknown = JSON.parse(await readFile(join(a, '.aster', 'project.json'), 'utf8'))
    if (typeof raw !== 'object' || raw === null || !('id' in raw)) throw new Error('manifest fixture invalid')
    const duplicate = { ...raw, id: binding.id }
    await writeFile(join(b, '.aster', 'project.json'), JSON.stringify(duplicate))
    await expect(storage.open({ root: b, mode: 'existing', expectedId: binding.id })).rejects.toThrow(/conflict/i)
  })

  it('keeps membership authoritative and rejects duplicate Session owners and traversal', async () => {
    const a = await root(), b = await root(), outside = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    const bindingA = await storage.open({ root: a, mode: 'new' })
    const bindingB = await storage.open({ root: b, mode: 'new' })
    const sessionId = 'session-a'
    await storage.bindSession(header(sessionId, a))
    expect(storage.locateSession(SessionId(sessionId))).toMatchObject({ projectId: bindingA.id, relativeCwd: '.' })
    await expect(storage.bindSession(header(sessionId, b))).rejects.toThrow(/owner|duplicate/i)
    await expect(storage.bindSession(header('session-b', outside))).rejects.toThrow(/inside/i)
    expect(storage.manifest(bindingB.id).sessions).toEqual([])
  })

  it('reports missing and read-only roots while retaining validated local metadata', async () => {
    const project = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    const binding = await storage.open({ root: project, mode: 'new' })
    const restarted = await createProjectStorage(storageOptions(locator))
    expect(restarted.manifest(binding.id).id).toBe(ProjectId(String(binding.id)))
    await chmod(project, 0o555)
    await expect(restarted.status(binding.id)).resolves.toBe('read-only')
    await chmod(project, 0o700)
    await rm(project, { recursive: true })
    await expect(restarted.status(binding.id)).resolves.toBe('missing')
  })

  it('binds restored and forked Sessions through local membership after the former root disappears', async () => {
    const original = await root(), copied = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    const opened = await storage.open({ root: original, mode: 'new' })
    const parentId = 'parent-session'
    await storage.bindSession(header(parentId, original))
    await mkdir(join(copied, '.aster'))
    await copyFile(join(original, '.aster', 'project.json'), join(copied, '.aster', 'project.json'))
    await rm(original, { recursive: true })
    const proposal = await storage.inspect(copied)
    if (proposal.kind !== 'existing') throw new Error('expected copied project proposal')
    await expect(access(join(copied, '.gitignore'))).rejects.toThrow()
    const binding = await storage.open({ root: copied, mode: 'existing', expectedId: opened.id, expectedDigest: proposal.digest })
    const restored = await storage.bindSession(header(parentId, original))
    expect(restored.projectRoot).toBe(copied)
    const forkId = 'fork-session'
    await storage.bindSession(header(forkId, original, parentId))
    expect(storage.executionCwd(header(forkId, original, parentId))).toBe(copied)
    expect(storage.locateSession(SessionId(parentId))?.bindingRevision).toBe(binding.revision)
  })

  it('durably changes project-owned order, pin/archive state, and title before notifying', async () => {
    const project = await root(), storage = await createProjectStorage(storageOptions(join(await root(), 'locator.json')))
    const binding = await storage.open({ root: project, mode: 'new' })
    const a = SessionId('a'), b = SessionId('b')
    await storage.bindSession(header(String(a), project))
    await storage.bindSession(header(String(b), project))
    const notifications: string[] = []
    storage.onChanged(() => { notifications.push(JSON.stringify(storage.manifest(binding.id))) })
    await storage.reorderSessions(binding.id, [b, a])
    await storage.setSessionPinned(binding.id, a, true)
    await storage.setSessionArchived(binding.id, a, true)
    await storage.rename(binding.id, 'Renamed')
    const manifest = storage.manifest(binding.id)
    expect(manifest.sessionOrder).toEqual([b, a])
    expect(manifest.pinnedSessionIds).toEqual([])
    expect(manifest.archivedSessionIds).toEqual([a])
    expect(manifest.title).toBe('Renamed')
    expect(notifications).toHaveLength(4)
    expect(notifications.every(value => JSON.parse(value).schemaVersion === 1)).toBe(true)
  })
  it('requires one registered adopter and revalidates legacy proposals before durable publication', async () => {
    const project = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    const session = SessionId('legacy-session')
    const projectId = ProjectId('d2719a2e-650c-49fb-9c98-3c4e0ce61970')
    const sourceProposal: LegacyProjectProposal = {
      projectId, title: 'Legacy project', sourceRoot: await root(),
      sessions: [{ id: session, relativeCwd: '.' }], sessionOrder: [session], pinnedSessionIds: [], archivedSessionIds: [],
    }
    let currentProposal = sourceProposal
    let changeProposalAfterNextInspection = false
    const changedProposal: LegacyProjectProposal = { ...sourceProposal, title: 'Changed after inspection' }
    storage.registerLegacySource({ inspect: async () => {
      const result = currentProposal
      if (changeProposalAfterNextInspection) {
        changeProposalAfterNextInspection = false
        currentProposal = changedProposal
      }
      return result
    } })
    const inspection = await storage.inspect(project)
    if (inspection.kind !== 'legacy') throw new Error('expected a legacy project proposal')
    const request = { root: project, mode: 'legacy' as const, expectedId: projectId, expectedDigest: inspection.digest }
    await expect(storage.open(request)).rejects.toBeInstanceOf(ProjectMigrationUnavailableError)
    await expect(access(join(project, '.aster'))).rejects.toThrow()

    const adopter = async (proposal: LegacyProjectProposal, destination: string): Promise<PortableProjectManifest> => {
      await mkdir(join(destination, '.aster', 'sessions'), { recursive: true })
      await writeFile(join(destination, '.aster', 'sessions', 'legacy.jsonl'), 'preserved history')
      const empty = createManifest({ id: proposal.projectId, title: proposal.title, createdAt: 1 })
      return {
        ...empty,
        sessions: proposal.sessions,
        sessionOrder: proposal.sessionOrder,
        pinnedSessionIds: proposal.pinnedSessionIds,
        archivedSessionIds: proposal.archivedSessionIds,
      }
    }
    const dispose = storage.registerLegacyAdopter(adopter)
    expect(() => storage.registerLegacyAdopter(adopter)).toThrow(/already registered/i)
    changeProposalAfterNextInspection = true
    await expect(storage.open(request)).rejects.toThrow(/changed after inspection/i)
    await expect(access(join(project, '.aster'))).rejects.toThrow()

    currentProposal = sourceProposal
    const binding = await storage.open(request)
    expect(binding.id).toBe(projectId)
    expect(storage.manifest(projectId).sessions).toEqual(sourceProposal.sessions)
    await expect(readFile(join(project, '.aster', 'sessions', 'legacy.jsonl'), 'utf8')).resolves.toBe('preserved history')
    dispose()
  })
  it('leaves a legacy root inspectable after an adopter fails', async () => {
    const project = await root(), locator = join(await root(), 'locator.json')
    const storage = await createProjectStorage(storageOptions(locator))
    const session = SessionId('legacy-retry-session')
    const projectId = ProjectId('a2719a2e-650c-49fb-9c98-3c4e0ce61970')
    const proposal: LegacyProjectProposal = {
      projectId, title: 'Retry project', sourceRoot: await root(),
      sessions: [{ id: session, relativeCwd: '.' }], sessionOrder: [session], pinnedSessionIds: [], archivedSessionIds: [],
    }
    storage.registerLegacySource({ inspect: async () => proposal })
    const inspection = await storage.inspect(project)
    if (inspection.kind !== 'legacy') throw new Error('expected a legacy project proposal')
    const request = { root: project, mode: 'legacy' as const, expectedId: projectId, expectedDigest: inspection.digest }
    storage.registerLegacyAdopter(async () => { throw new Error('temporary adoption failure') })
    await expect(storage.open(request)).rejects.toThrow('temporary adoption failure')
    expect(await storage.inspect(project)).toMatchObject({ kind: 'legacy', digest: inspection.digest })
  })
})
