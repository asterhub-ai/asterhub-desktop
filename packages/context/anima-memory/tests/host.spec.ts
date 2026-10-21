import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectOwnership, registerProjectOwnership } from '@deepseek-ai/anima-memory'
import { prepareOwnershipScope } from '../src/host.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Anima ownership scope', () => {
  it('creates the ownership base directories required by project registration', async () => {
    const dataRoot = await realpath(await mkdtemp(join(tmpdir(), 'anima-ownership-')))
    roots.push(dataRoot)
    const installationUid = randomUUID()
    const scope = await prepareOwnershipScope(dataRoot, installationUid)
    const project = { project_uid: randomUUID(), identity_fingerprint: 'a'.repeat(64) }

    await registerProjectOwnership(scope, project)

    await expect(listProjectOwnership(scope)).resolves.toEqual([{
      schema_id: 'anima.dev-project-ownership/v1',
      principal_uid: installationUid,
      ...project,
    }])
  })
})
