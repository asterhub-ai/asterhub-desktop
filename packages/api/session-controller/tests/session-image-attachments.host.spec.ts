import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import ProjectStorage, { resolveProjectAttachmentScope } from '@deepseek-ai/dsh-project-storage'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

describe('Session image attachment ownership', () => {
  it('keeps a prompt image readable through the Session project scope after a text turn', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'session-image-scope-')))
    const project = join(root, 'project')
    const dshHome = join(root, 'home')
    await mkdir(project)
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(ProjectStorage, {
        sessionMode: 'project-local',
        locatorPath: join(dshHome, 'locator.json'),
        legacySessionRoot: '',
        metadataLimitBytes: 1024 * 1024,
        lockDeadlineMs: 5000,
      })
      await ctx.plugin(AttachmentLocal, { dshHome, projectLocal: false })
      const binding = await ctx.projectStorage.open({ root: project, mode: 'new' })
      const sessionId = SessionId('image-scope-session')
      const session = ctx.sessions.create(sessionId, { meta: { cwd: project } })
      await ctx.projectStorage.bindSession({
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 1,
        cwd: project,
        isSeeded: false,
        delegationDepth: 0,
      })
      const followup = vi.fn<Agent['followup']>()
      const steer = vi.fn<Agent['steer']>()
      await ctx.agents.register(Object.assign({
        id: sessionId,
        session,
        status: 'idle' as const,
        ctx,
      } as Agent, {
        inbox: createInboxStub(),
        followup,
        steer,
      }))
      ctx.provide('llm', {
        listModels: async () => [{ id: 'vision-model', name: 'Vision Model' }],
        listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
        resolveModelInfo: async () => ({
          provider: 'fixture', id: 'vision-model', name: 'Vision Model', inputModalities: ['text', 'image'],
        }),
      } as never)
      const remote = createSessionTestRemote(ctx, {
        defaultModelSelection: () => ({ provider: 'fixture', model: 'vision-model' }),
        cwd: project,
      })
      const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'

      await expect(remote.prompt({
        sessionId,
        requestId: 'image-turn' as never,
        mode: 'queue',
        content: [
          { type: 'text', text: 'Inspect this image' },
          { type: 'image', mediaType: 'image/png', data: image },
        ],
      })).resolves.toMatchObject({ ok: true, value: { accepted: true } })
      const admitted = followup.mock.calls[0]?.[0].content.find(part => part.type === 'image')
      if (admitted?.type !== 'image') throw new Error('Session prompt did not admit its image')

      await expect(remote.prompt({
        sessionId,
        requestId: 'text-turn' as never,
        mode: 'queue',
        content: [{ type: 'text', text: 'Continue without a new image' }],
      })).resolves.toMatchObject({ ok: true, value: { accepted: true } })
      const scope = resolveProjectAttachmentScope(ctx, sessionId)
      if (scope === undefined || scope.projectId !== binding.id) throw new Error('Session project scope was not registered')

      await expect(ctx.attachments.readImageRequest(
        admitted.attachment,
        { width: 1, height: 1, maxBytes: 1024 * 1024 },
        undefined,
        scope,
      )).resolves.toMatchObject({ attachment: admitted.attachment })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
