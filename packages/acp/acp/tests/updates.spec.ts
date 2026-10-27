import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, MessageId } from '@deepseek-ai/dsh-llm'
import ProjectStorage from '@deepseek-ai/dsh-project-storage'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionCwd from '@deepseek-ai/dsh-session/cwd'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assistantUpdates, toolCallUpdate, toolResultUpdate } from '../src/updates.ts'

/** Minimal committed assistant event for pure update projection tests. */
function assistantEvent(
  content: SessionEvent<'assistant/message'>['data']['message']['content'],
  usage?: SessionEvent<'assistant/message'>['data']['usage'],
): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    surfaceOp: 'append',
    seq: SessionSeq(0),
    time: 0,
    data: {
      stream: [],
      turn: 1,
      step: 1,
      message: {
        id: MessageId('message-1'),
        role: 'assistant',
        source: { kind: 'model', provider: 'mock', model: 'mock' },
        content,
      },
      ...usage === undefined ? {} : { usage },
    },
  }
}

describe('standard ACP update projection', () => {
  it('omits empty reasoning, unsupported assistant blocks, and absent usage', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    const session = { requestContext: () => undefined } as unknown as Session
    const event = assistantEvent([
      { type: 'reasoning', text: '' },
      { type: 'tool-call', id: ToolCallId('call-hidden'), name: 'hidden', arguments: '{}' },
    ])

    await expect(assistantUpdates(ctx, session, event, SessionId('update-test'))).resolves.toEqual([])
  })

  it('requires both measured usage and context capacity', async () => {
    const meter = { measure: vi.fn(() => ({ totalTokens: 7 })) }
    const withMeter = { get: (name: string) => name === 'tokenMeter' ? meter : undefined } as unknown as Context
    const withoutMeter = { get: () => undefined } as unknown as Context
    const withCapacity = { requestContext: () => ({ contextWindow: 100 }) } as unknown as Session
    const withoutCapacity = { requestContext: () => undefined } as unknown as Session
    const event = assistantEvent([{ type: 'text', text: 'done' }], { inputTokens: 1, outputTokens: 1 })

    expect((await assistantUpdates(withMeter, withoutCapacity, event, SessionId('update-test'))).map(update => update.sessionUpdate))
      .toEqual(['agent_message_chunk'])
    expect((await assistantUpdates(withoutMeter, withCapacity, event, SessionId('update-test'))).map(update => update.sessionUpdate))
      .toEqual(['agent_message_chunk'])
    expect(meter.measure).not.toHaveBeenCalled()
  })

  it('preserves malformed tool input and projects a failed result without hidden content', async () => {
    const call = toolCallUpdate({
      type: 'tool/call',
      seq: SessionSeq(0),
      time: 0,
      data: { turn: 1, step: 1, callId: ToolCallId('call-bad'), name: 'broken', arguments: '{' },
    })
    const result = await toolResultUpdate({ get: () => undefined } as unknown as Context, SessionId('tool-session'), {
      type: 'tool/result',
      surfaceOp: 'append',
      seq: SessionSeq(0),
      time: 0,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: MessageId('tool-message'),
          role: 'tool',
          toolCallId: ToolCallId('call-bad'),
          isError: true,
          source: { kind: 'tool', callId: ToolCallId('call-bad') },
          content: [{ type: 'reasoning', text: 'hidden' }],
        },
      },
    })

    expect(call).toMatchObject({ rawInput: '{' })
    expect(result).toEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-bad',
      status: 'failed',
      content: [],
    })
  })
  it('reads project-owned assistant image bytes through the trusted bridge SessionId', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-acp-project-image-'))
    const project = join(root, 'project')
    const dshHome = join(root, 'home')
    await mkdir(project)
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionCwd)
      await ctx.plugin(ProjectStorage, {
        sessionMode: 'grouped', locatorPath: join(dshHome, 'projects.json'),
        legacySessionRoot: '', metadataLimitBytes: 1024 * 1024, lockDeadlineMs: 5000,
      })
      await ctx.projectStorage.open({ root: project, mode: 'new' })
      const trustedSessionId = SessionId('bridge-owned-session')
      await ctx.projectStorage.bindSession({
        version: SESSION_FORMAT_VERSION, id: trustedSessionId, createdAt: 1, cwd: project,
        isSeeded: false, delegationDepth: 0,
      })
      await ctx.plugin(LocalAttachmentStore, { dshHome })
      const input = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
        'base64',
      ))
      const attachment = await ctx.attachments.saveImage({ data: input, mediaType: 'image/png' }, { sessionId: trustedSessionId })
      const session = ctx.sessions.create(SessionId('different-durable-session'), { meta: { cwd: project } })
      const event = assistantEvent([{ type: 'image', attachment }])

      const stored = await ctx.attachments.readImage(attachment, undefined, { sessionId: trustedSessionId })
      const updates = await assistantUpdates(ctx, session, event, trustedSessionId)

      expect(updates).toEqual([{
        sessionUpdate: 'agent_message_chunk',
        messageId: event.data.message.id,
        content: { type: 'image', data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType },
      }])
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
  it('keeps ACP assistant image delivery on the global store when no project provider is mounted', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-acp-global-image-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(LocalAttachmentStore, { dshHome })
      const input = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
        'base64',
      ))
      const attachment = await ctx.attachments.saveImage({ data: input, mediaType: 'image/png' })
      const bridgeSessionId = SessionId('global-bridge-session')
      const session = ctx.sessions.create(SessionId('durable-session'), { meta: { cwd: dshHome } })
      const stored = await ctx.attachments.readImage(attachment)
      const updates = await assistantUpdates(ctx, session, assistantEvent([{ type: 'image', attachment }]), bridgeSessionId)

      expect(updates).toMatchObject([{
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType },
      }])
    } finally {
      await ctx.fiber.dispose()
      await rm(dshHome, { recursive: true, force: true })
    }
  })
})
