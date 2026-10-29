import { appendFile, cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ProjectSessionPersistence from '../../project-storage/src/persistence.ts'
import { appendWorkingDirectoryEvent, ProjectAdoptService } from '../src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function start(pool: MemoryMediaPool): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(ProjectSessionPersistence, { compression: 'none' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ProjectAdoptService)
  return ctx
}

function sessionHeader(id: string, cwd: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, cwd, isSeeded: false, delegationDepth: 0 }
}

/** One completed turn, enough to make the stored log a materialized multi-event prefix. */
function turnEvents(startSeq: number): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(startSeq), time: 1001, data: { turn: 1 } },
    { type: 'step/start', seq: SessionSeq(startSeq + 1), time: 1002, data: { turn: 1, step: 1 } },
    {
      type: 'user/message', seq: SessionSeq(startSeq + 2), time: 1003, surfaceOp: 'append',
      data: { id: 'adopt-original-user-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'portable history' }] },
    },
    { type: 'step/end', seq: SessionSeq(startSeq + 3), time: 1004, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(startSeq + 4), time: 1005, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

describe('project adoption', () => {
  it('adopts a Session copied from another machine: membership, one appended event, intact history, idempotent repeats', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-adopt-'))
    roots.push(home)
    const originalRoot = join(home, 'original')
    const movedRoot = join(home, 'moved')
    await mkdir(originalRoot)
    const header = sessionHeader('adopted-session', originalRoot)

    const first = await start(new MemoryMediaPool())
    await first.workspaceRegistry.create(originalRoot)
    const writer = await first.sessionPersistence.create(header)
    const originalEvents = turnEvents(0)
    await writer.append(originalEvents)
    await writer.flush()
    await writer.close()
    await first.fiber.dispose()

    await cp(join(originalRoot, '.aster'), join(movedRoot, '.aster'), { recursive: true })
    await rm(originalRoot, { recursive: true, force: true })

    const second = await start(new MemoryMediaPool())
    const workspace = await second.workspaceRegistry.create(movedRoot)
    await second.projectAdopt.adoptWorkspace(workspace.id)

    const adopted = second.workspaceRegistry.get(workspace.id)
    expect(adopted).toBeDefined()
    expect(adopted!.sessionIds).toEqual([header.id])

    const listed = await second.sessionPersistence.list()
    expect(listed.map(snapshot => snapshot.header.id)).toEqual([header.id])
    const reader = await second.sessionPersistence.open(header.id, 'read')
    const { events } = await reader.read()
    expect(events.slice(0, originalEvents.length)).toEqual(originalEvents)
    const tail = events.at(-1)
    if (tail?.type !== 'working-directory/change') throw new Error('the adoption event is missing from the log tail')
    expect(tail.seq).toBe(SessionSeq(originalEvents.length))
    expect(tail.data).toEqual({ cwd: await realpath(movedRoot) })
    expect(reader.header.cwd).toBe(originalRoot)
    await reader.close()

    await second.projectAdopt.adoptWorkspace(workspace.id)
    await appendWorkingDirectoryEvent(second.sessionPersistence, header.id, await realpath(movedRoot))
    const rereader = await second.sessionPersistence.open(header.id, 'read')
    expect((await rereader.read()).events).toHaveLength(originalEvents.length + 1)
    await rereader.close()
    await second.fiber.dispose()
  })

  it('resolves without work for a Workspace whose directory has no .aster/sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-adopt-'))
    roots.push(home)
    const plain = join(home, 'plain')
    await mkdir(plain)

    const ctx = await start(new MemoryMediaPool())
    const workspace = await ctx.workspaceRegistry.create(plain)
    await expect(ctx.projectAdopt.adoptWorkspace(workspace.id)).resolves.toBeUndefined()
    expect(ctx.workspaceRegistry.get(workspace.id)!.sessionIds).toEqual([])
    await ctx.fiber.dispose()
  })

  it('continues with the remaining sessions when one stored log fails to open', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-adopt-'))
    roots.push(home)
    const project = join(home, 'project')
    await mkdir(project)

    const first = await start(new MemoryMediaPool())
    await first.workspaceRegistry.create(project)
    for (const id of ['a-failing-session', 'b-adopted-session']) {
      const writer = await first.sessionPersistence.create(sessionHeader(id, project))
      await writer.append(turnEvents(0))
      await writer.flush()
      await writer.close()
    }
    const snapshots = await first.sessionPersistence.list()
    const failing = snapshots.find(snapshot => snapshot.header.id === SessionId('a-failing-session'))
    if (failing?.location === undefined) throw new Error('fixture could not locate the failing session artifact')
    // One complete JSONL record of an unknown type without the ignorable marker:
    // header-only listing still discovers the session, every later open refuses it.
    await appendFile(failing.location.path, `${JSON.stringify({ type: 'unknown/mystery', seq: 5, time: 1, data: {} })}\n`)
    await first.fiber.dispose()

    const second = await start(new MemoryMediaPool())
    const workspace = await second.workspaceRegistry.create(project)
    await expect(second.projectAdopt.adoptWorkspace(workspace.id)).resolves.toBeUndefined()
    const record = second.workspaceRegistry.get(workspace.id)
    expect(record!.sessionIds).toContain(SessionId('b-adopted-session'))
    expect(record!.sessionIds).not.toContain(SessionId('a-failing-session'))
    await second.fiber.dispose()
  })
})
