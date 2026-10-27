import { describe, expect, it } from 'vitest'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SessionId, SessionSeq, Session, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createMessage, createUserMessage, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createCaptureFacts, mapSessionEvent, mapSessionEvents } from '../src/session-capture.ts'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '../src/extraction.ts'

const sessionId = SessionId('session-1')

describe('createCaptureFacts', () => {
  it('captures into the cwd override when an imported session header cwd no longer exists', () => {
    const override = realpathSync.native(tmpdir())
    const session = Session.create(SessionId('session-imported'), undefined, {
      id: SessionId('session-imported'),
      version: SESSION_FORMAT_VERSION,
      createdAt: 1_750_000_000_123,
      cwd: 'C:\\t16-legacy-root\\does-not-exist',
      isSeeded: false,
    })
    const facts = createCaptureFacts('installation-1', session, 'asterhub', override)
    expect(facts.project).toEqual({
      method: 'derived',
      normalized_identity: override.replaceAll('\\', '/').toLowerCase(),
    })
  })

  it('keeps the durable header cwd as the project identity without an override', () => {
    const headerCwd = realpathSync.native(tmpdir())
    const session = Session.create(SessionId('session-header-cwd'), undefined, {
      id: SessionId('session-header-cwd'),
      version: SESSION_FORMAT_VERSION,
      createdAt: 1_750_000_000_123,
      cwd: headerCwd,
      isSeeded: false,
    })
    const facts = createCaptureFacts('installation-1', session, 'asterhub')
    expect(facts.project).toEqual({
      method: 'derived',
      normalized_identity: headerCwd.replaceAll('\\', '/').toLowerCase(),
    })
  })
})

describe('mapSessionEvent', () => {
  it('preserves user content, source, timestamp, and sequence identity', () => {
    const event = {
      type: 'user/message',
      seq: SessionSeq(4),
      time: 1_750_000_000_123,
      data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
      surfaceOp: 'append',
    } satisfies SessionEvent<'user/message'>

    const facts = mapSessionEvent(sessionId, event)

    expect(facts).toMatchObject({
      kind: 'message',
      source: { event_name: 'user_message', event_id: '4', session_id: sessionId },
      source_sequence: 4,
      source_timestamp: new Date(event.time).toISOString(),
      role: 'user',
      message_origin: 'external_user',
      content_parts: [{ type: 'text', text: 'hello' }],
      fidelity: { completeness: 'full', missing_fields: [] },
    })
    expect(facts?.native_payload).toMatchObject({ type: event.type, seq: 4, data: event.data, surfaceOp: 'append' })
  })

  it('keeps tool arguments as a JSON content part and correlates results by call id', () => {
    const call = {
      type: 'tool/call', seq: SessionSeq(5), time: 10,
      data: { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'search', arguments: '{"query":"x"}' },
    } satisfies SessionEvent<'tool/call'>
    const result = {
      type: 'tool/result', seq: SessionSeq(6), time: 11,
      data: { turn: 1, step: 1,
        message: { role: 'tool', id: MessageId('message-1'), source: { kind: 'tool', callId: ToolCallId('call-1') }, toolCallId: ToolCallId('call-1'), content: [{ type: 'text', text: 'found' }] } },
      surfaceOp: 'append',
    } satisfies SessionEvent<'tool/result'>

    expect(mapSessionEvent(sessionId, call)).toMatchObject({
      kind: 'tool_call', tool_name: 'search', extensions: { 'anima.tool.source_call_id': 'call-1' },
      content_parts: [{ type: 'json', value_json: '{"query":"x"}' }],
    })
    expect(mapSessionEvent(sessionId, result)).toMatchObject({
      kind: 'tool_result', outcome: 'success', correlation: { method: 'source', source_tool_call_id: 'call-1' },
      content_parts: [{ type: 'text', text: 'found' }],
    })
  })

  it('maps durable turn checkpoints without inventing facts for other events', () => {
    const turnEnd = {
      type: 'turn/end', seq: SessionSeq(9), time: 12, data: { turn: 3, reason: { kind: 'completed' } },
    } satisfies SessionEvent<'turn/end'>
    const stepEnd = { type: 'step/end', seq: SessionSeq(11), time: 14, data: { turn: 3, step: 1 } } satisfies SessionEvent<'step/end'>

    expect(mapSessionEvents(sessionId, turnEnd)).toMatchObject([
      { kind: 'turn_end', turn_index: 3, turn_end_status: 'final_reply' },
      { kind: 'boundary', boundary_type: 'checkpoint', source: { event_id: '9:checkpoint' } },
    ])
    expect(mapSessionEvent(sessionId, stepEnd)).toBeUndefined()
  })
  it('omits tool-only assistant messages without filtering user messages', () => {
    const assistant = {
      type: 'assistant/message', seq: SessionSeq(12), time: 15, surfaceOp: 'append',
      data: { turn: 3, step: 2, stream: [],
        message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' },
          content: [{ type: 'tool-call', id: ToolCallId('call-2'), name: 'search', arguments: '{}' }] }) },
    } satisfies SessionEvent<'assistant/message'>
    const synthetic = {
      type: 'user/message', seq: SessionSeq(13), time: 16, surfaceOp: 'append',
      data: createUserMessage({ source: { kind: 'anima' }, content: [{ type: 'text', text: 'context' }] }),
    } satisfies SessionEvent<'user/message'>

    expect(mapSessionEvent(sessionId, assistant)).toBeUndefined()
    expect(mapSessionEvent(sessionId, synthetic)).toMatchObject({
      role: 'user', message_origin: 'runtime_synthetic', content_parts: [{ type: 'text', text: 'context' }],
    })

  })
})
