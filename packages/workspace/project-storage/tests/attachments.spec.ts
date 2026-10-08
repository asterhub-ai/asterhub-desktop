import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import ProjectStorage from '../src/index.ts'
import { resolveProjectAttachmentScope } from '../src/attachments.ts'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('project attachment scope', () => {
  it('derives the project owner from registered Session membership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'project-attachment-scope-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project)
    const ctx = new Context()
    await ctx.plugin(ProjectStorage, {
      sessionMode: 'project-local', locatorPath: join(root, 'locator.json'),
      legacySessionRoot: '', metadataLimitBytes: 1024 * 1024, lockDeadlineMs: 5000,
    })
    const binding = await ctx.projectStorage.open({ root: project, mode: 'new' })
    const sessionId = SessionId('scope-session')
    await ctx.projectStorage.bindSession({
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 10, cwd: project, isSeeded: false, delegationDepth: 0,
    })
    try {
      expect(resolveProjectAttachmentScope(ctx, sessionId)).toEqual({ projectId: binding.id, sessionId })
      expect(() => resolveProjectAttachmentScope(ctx, SessionId('unowned-session'))).toThrow(/no registered project attachment owner/i)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
