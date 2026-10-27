import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectOwnership, registerProjectOwnership } from '@deepseek-ai/anima-memory'
import { formatCaptureFailure, prepareOwnershipScope } from '../src/host.ts'

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

describe('formatCaptureFailure', () => {
  it('maps known failure codes to bounded, sanitized descriptions without raw errors', () => {
    expect(formatCaptureFailure({
      status: 'failed',
      code: 'database_error',
      message: 'Neo4j transaction failed at bolt://127.0.0.1:7687 MATCH (secret) RETURN secret',
    })).toBe('Anima capture failed: database_error (Database write failed before commit boundary)')

    expect(formatCaptureFailure({
      status: 'failed',
      code: 'core_degraded',
      message: 'Sensitive database connection dropped',
    })).toBe('Anima capture failed: core_degraded (Capture subsystem is degraded due to prior database failure)')

    expect(formatCaptureFailure({
      status: 'failed',
      code: 'invalid_source_facts',
      message: 'Internal path C:/secret/path is invalid',
    })).toBe('Anima capture failed: invalid_source_facts (Source Session event rejected by validation schema)')

    expect(formatCaptureFailure({
      status: 'failed',
      code: 'identity_conflict',
      message: 'Conflicting project identity',
    })).toBe('Anima capture failed: identity_conflict (Session or project identity conflict in graph)')
  })

  it('maps indeterminate outcomes to a safe status message', () => {
    expect(formatCaptureFailure({
      status: 'indeterminate',
      event_uid: 'ev-1',
      message: 'Timeout exceeded in internal Cypher query',
    })).toBe('Anima capture indeterminate: Write outcome is unknown after cancellation or timeout')
  })
})
