import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveSessionRoot } from '../session-root.mjs'

test('uses the current project binding instead of immutable historical cwd', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'genoffice-root-'))
  const oldRoot = join(temp, 'old-project')
  const currentRoot = join(temp, 'moved-project')
  await mkdir(oldRoot)
  await mkdir(currentRoot)
  try {
    const root = await resolveSessionRoot({
      sessionCwd: { resolve: () => currentRoot },
    }, {
      agent: { session: { header: { cwd: oldRoot }, id: 'session' }, options: { cwd: currentRoot } },
    })
    assert.equal(root, currentRoot)
  }
  finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('uses the current project binding when the historical project directory is absent', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'genoffice-root-'))
  const currentRoot = join(temp, 'moved-project')
  await mkdir(currentRoot)
  try {
    const root = await resolveSessionRoot({
      sessionCwd: { resolve: () => currentRoot },
    }, {
      agent: { session: { header: { cwd: join(temp, 'removed-old-project') }, id: 'session' }, options: { cwd: temp } },
    })
    assert.equal(root, currentRoot)
  }
  finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('rejects an unbound project instead of falling back to profile cwd', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'genoffice-root-'))
  const profile = join(temp, 'profile')
  await mkdir(profile)
  try {
    await assert.rejects(() => resolveSessionRoot({
      profileContext: { cwd: profile },
      sessionCwd: { resolve: () => undefined },
    }, {
      agent: { session: { header: { cwd: join(temp, 'offline-old-project') }, id: 'session' }, options: { cwd: profile } },
    }), /no registered project execution directory/)
  }
  finally {
    await rm(temp, { recursive: true, force: true })
  }
})
