import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import ProjectStorage from '@deepseek-ai/dsh-project-storage'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SessionCwd from '@deepseek-ai/dsh-session/cwd'
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
      await ctx.plugin(SessionCwd)
      await ctx.plugin(ProjectStorage, {
        sessionMode: 'project-local',
        locatorPath: join(dshHome, 'locator.json'),
        legacySessionRoot: '',
        metadataLimitBytes: 1024 * 1024,
        lockDeadlineMs: 5000,
      })
      await ctx.plugin(AttachmentLocal, { dshHome, projectLocal: true })
      await ctx.projectStorage.open({ root: project, mode: 'new' })
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
      const followup = vi.fn<Agent['followup']>((message) => {
        session.append('user/message', message, { surfaceOp: 'append' })
      })
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
      const scope = { sessionId }
      const read = await remote.attachment({ sessionId, attachmentId: admitted.attachment.attachmentId })
      expect(read).toMatchObject({ ok: true, value: { attachment: admitted.attachment } })
      if (!read.ok) throw new Error('Session image RPC rejected a referenced project attachment')
      const stored = await ctx.attachments.readImage(admitted.attachment, undefined, scope)
      expect(Buffer.from(read.value.data, 'base64')).toEqual(Buffer.from(stored.data))
      await expect(remote.attachment({ sessionId, attachmentId: 'unreferenced-image' as never }))
        .resolves.toMatchObject({ ok: false, error: { code: 'session/attachment-invalid' } })
      await expect(remote.attachment({ sessionId: SessionId('unowned-image-session'), attachmentId: admitted.attachment.attachmentId }))
        .resolves.toMatchObject({ ok: false, error: { code: 'session/not-found' } })

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
