import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ProjectSessionPersistence from '../src/persistence.ts'
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
  return ctx
}

describe('project-local Session persistence', () => {
  it('lists project-local Sessions during WorkspaceRegistry startup without a manifest', async () => {
    const home = await mkdtemp(join(tmpdir(), 'project-session-persistence-'))
    roots.push(home)
    const project = join(home, 'project')
    await mkdir(project)
    const pool = new MemoryMediaPool()

    const first = await start(pool)
    const workspace = await first.workspaceRegistry.create(project)
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('project-local-session'),
      createdAt: 1,
      cwd: project,
      isSeeded: false,
      delegationDepth: 0,
    }
    const created = await first.sessionPersistence.create(header)
    await created.flush()
    await created.close()
    expect((await first.sessionPersistence.list()).map(snapshot => snapshot.header.id)).toEqual([header.id])
    await workspace.attachSession(header.id)
    expect((await first.sessionPersistence.list()).map(snapshot => snapshot.header.id)).toEqual([header.id])
    await first.fiber.dispose()

    const restarted = await start(pool)
    expect(restarted.workspaceRegistry.list()[0]!.sessionIds).toEqual([header.id])
    expect(existsSync(join(project, '.aster', 'sessions'))).toBe(true)
    expect(existsSync(join(project, '.aster', 'project.json'))).toBe(false)

    const opened = await restarted.sessionPersistence.open(header.id, 'read')
    expect(opened.header).toEqual(header)
    await opened.close()
    await restarted.fiber.dispose()
  })
})
