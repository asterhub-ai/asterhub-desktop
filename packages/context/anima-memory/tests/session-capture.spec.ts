import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { mapSessionEvent, mapSessionEvents } from '../src/session-capture.ts'

const sessionId = SessionId('session-1')

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
})
