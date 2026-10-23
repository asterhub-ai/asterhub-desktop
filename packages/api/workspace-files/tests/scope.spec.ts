import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import SessionCwd from '@deepseek-ai/dsh-session/cwd'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceFiles from '../src/index.ts'

const CAPS = {
  maxBytes: 1024,
  maxFileBytes: 1024,
  maxLines: 100,
  maxEntries: 100,
}

function header(id: SessionId, cwd?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1,
    isSeeded: false,
    origin: 'subagent',
    ...cwd === undefined ? {} : { cwd },
  }
}

describe('Workspace Files Session scope lookup', () => {
  it('uses live or stored headers without an Agent and leaves with its plugin', async () => {
    const liveId = SessionId('live-subagent')
    const coldId = SessionId('cold-subagent')
    const fallbackId = SessionId('cold-without-cwd')
    const missingId = SessionId('missing')
    const oldPresentRoot = resolve('old-project-present')
    const oldAbsentRoot = resolve('old-project-removed')
    const movedRoot = resolve('moved-project')
    const fallbackRoot = resolve('fallback-workspace')
    const stat = vi.fn(async (id: SessionId) => {
      if (id === coldId) return { header: header(coldId, oldAbsentRoot) }
      if (id === fallbackId) return { header: header(fallbackId) }
      return undefined
    })
    const ctx = new Context()
    const cwd = await ctx.plugin(SessionCwd)
    const disposeCwd = ctx.sessionCwd.registerResolver(session =>
      session.id === liveId || session.id === coldId ? movedRoot : session.cwd)
    ctx.provide('fs', {} as never)
    ctx.provide('sandboxPolicy', { workspaceRoot: fallbackRoot } as never)
    ctx.provide('sessionPersistence', { stat } as never)
    const sessions = await ctx.plugin(SessionStore)
    const typert = await ctx.plugin(TypertRegistry)
    const workspaceFiles = await ctx.plugin(WorkspaceFiles, CAPS)

    try {
      ctx.sessions.create(liveId, { meta: { cwd: oldPresentRoot, origin: 'subagent' } })
      expect(ctx.get('agents')).toBeUndefined()
      const lookup = ctx.typert.lookups.get('workspaceFileScope')
      expect(lookup).toMatchObject({
        parameter: 'workspaceFileScope',
        wire: 'workspaceFileScopeId',
        hostTypeSymbol: '@deepseek-ai/dsh-api-workspace-files#WorkspaceFileScope',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      })
      if (lookup === undefined) throw new Error('workspaceFileScope lookup did not register')

      await expect(lookup.resolve(liveId)).resolves.toEqual({ sessionId: liveId, workspaceRoot: movedRoot })
      expect(stat).not.toHaveBeenCalled()
      await expect(lookup.resolve(coldId)).resolves.toEqual({ sessionId: coldId, workspaceRoot: movedRoot })
      await expect(lookup.resolve(missingId)).resolves.toBeUndefined()
      await expect(lookup.resolve(fallbackId)).resolves.toEqual({ sessionId: fallbackId, workspaceRoot: fallbackRoot })
      expect(stat.mock.calls.map(([id]) => id)).toEqual([coldId, fallbackId, missingId])

      await workspaceFiles.dispose()
      expect(ctx.typert.lookups.get('workspaceFileScope')).toBeUndefined()
    } finally {
      await workspaceFiles.dispose()
      await sessions.dispose()
      disposeCwd()
      await cwd.dispose()
      await typert.dispose()
    }
  })
})
