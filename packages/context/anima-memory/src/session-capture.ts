import { realpathSync } from 'node:fs'
import { type CaptureSessionFacts, type CanonicalContentPart, type JsonValue, type SourceEventFacts } from '@deepseek-ai/anima-capture'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import { canonicalize } from 'json-canonicalize'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

const CONTENT_SCHEMA_ID = 'anima.content-part/v1.0' as const
const ADAPTER_VERSION = '1.0.0'

/**
 * Maps durable Session content and turn/checkpoint boundaries to Anima source facts. Assistant
 * messages containing only tool calls do not form source messages.
 * @param sessionId - Stable AsterHub Session identifier used in the source event.
 * @param event - Persisted event from the Session log.
 * @returns Canonical source facts, or undefined for empty messages and events outside the capture vocabulary.
 */
export function mapSessionEvent(sessionId: SessionId, event: SessionEvent): SourceEventFacts | undefined {
  const nativePayload = {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data,
    ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }),
    ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }),
  } as JsonValue
  const base = (kind: SourceEventFacts['kind'], eventName: string): SourceEventFacts => ({
    kind,
    source: { event_name: eventName, event_id: String(event.seq), session_id: sessionId },
    source_sequence: event.seq,
    source_timestamp: new Date(event.time).toISOString(),
    content_parts: [],
    fidelity: { completeness: 'full', missing_fields: [] },
    native_payload: nativePayload,
  })

  switch (event.type) {
    case 'user/message': {
      const facts = base('message', 'user_message')
      facts.role = 'user'
      facts.message_origin = event.data.source.kind === 'user' ? 'external_user' : 'runtime_synthetic'
      applyContent(facts, event.data.content)
      return facts
    }
    case 'assistant/message': {
      const retained = event.data.message.content.filter(block => block.type !== 'tool-call')
      if (retained.length === 0) return undefined
      const facts = base('message', 'assistant_message')
      facts.role = 'assistant'
      applyContent(facts, retained)
      return facts
    }
    case 'tool/call': {
      const facts = base('tool_call', 'tool_call')
      facts.source.event_id = `tool-call:${event.data.callId}`
      facts.tool_name = event.data.name
      facts.extensions = { 'anima.tool.source_call_id': event.data.callId }
      const input = parseToolArguments(event.data.arguments)
      facts.content_parts = [{ schema_id: CONTENT_SCHEMA_ID, type: 'json', part_index: 0, value_json: canonicalize(input) }]
      facts.native_payload = {
        type: 'tool_call', toolCallId: event.data.callId, toolName: event.data.name, input, asterhub_event: nativePayload,
      }
      return facts
    }
    case 'tool/ptc-dispatch-start': {
      const facts = base('tool_call', 'tool_call')
      const input = event.data.arguments as JsonValue
      facts.source.event_id = `tool-call:${event.data.subCallId}`
      facts.tool_name = event.data.name
      facts.extensions = { 'anima.tool.source_call_id': event.data.subCallId }
      facts.content_parts = [{ schema_id: CONTENT_SCHEMA_ID, type: 'json', part_index: 0, value_json: canonicalize(input) }]
      facts.native_payload = {
        type: 'tool_call', toolCallId: event.data.subCallId, toolName: event.data.name, input, asterhub_event: nativePayload,
      }
      return facts
    }
    case 'tool/ptc-dispatch': {
      const facts = base('tool_result', 'tool_result')
      facts.tool_name = event.data.name
      facts.outcome = event.data.isError ? 'error' : 'success'
      facts.correlation = { method: 'source', source_tool_call_id: event.data.subCallId }
      applyContent(facts, event.data.content)
      return facts
    }
    case 'tool/result': {
      const facts = base('tool_result', 'tool_result')
      facts.outcome = event.data.message.isError === true ? 'error' : 'success'
      facts.fidelity = { completeness: 'partial', missing_fields: ['/tool_name'] }
      facts.correlation = { method: 'source', source_tool_call_id: event.data.message.toolCallId }
      applyContent(facts, event.data.message.content)
      return facts
    }
    case 'turn/end': {
      const facts = base('turn_end', 'turn_end')
      facts.turn_index = event.data.turn
      facts.turn_end_status = event.data.reason.kind === 'completed' ? 'final_reply' : 'cancelled'
      return facts
    }
    default:
      return undefined
  }
}

/**
 * Maps one durable Session event to every Anima fact it closes. Turn endings emit a turn fact and
 * a checkpoint fact so capture consumers can seal the corresponding processing window.
 * @param sessionId - Stable AsterHub Session identifier used in source facts.
 * @param event - Persisted event from the Session log.
 * @returns Facts in source order; unsupported events return an empty list.
 */
export function mapSessionEvents(sessionId: SessionId, event: SessionEvent): SourceEventFacts[] {
  const mapped = mapSessionEvent(sessionId, event)
  if (mapped === undefined) return []
  if (event.type !== 'turn/end') return [mapped]
  const { turn_index: _turnIndex, turn_end_status: _turnEndStatus, ...checkpoint } = mapped
  return [mapped, {
    ...checkpoint,
    kind: 'boundary',
    source: { ...mapped.source, event_name: 'session_checkpoint', event_id: `${event.seq}:checkpoint` },
    boundary_type: 'checkpoint',
    content_parts: [],
  }]
}

/**
 * Builds stable runtime, profile, project, and Session identity facts for capture initialization.
 * Existing project directories use their resolved real path; Windows paths use lowercase forward
 * slashes so casing and separator differences do not create separate project identities.
 * @param installationUid - Persistent installation identity supplied by the capture owner.
 * @param session - Session whose durable header supplies project and source identity.
 * @param profileName - Active AsterHub profile name.
 * @param cwdOverride - Execution directory that overrides the durable header cwd; callers owning
 *   cwd resolution (workspace adoption) pass the dynamically resolved directory so imported
 *   sessions whose historical cwd no longer exists still capture into the adopted project.
 * @returns Facts consumed by Anima CaptureCore when opening a capture session.
 * @throws If the effective working directory cannot be resolved to a real path.
 */
export function createCaptureFacts(
  installationUid: string,
  session: Session,
  profileName: string,
  cwdOverride?: string,
): CaptureSessionFacts {
  const cwd = cwdOverride ?? session.header.cwd
  const normalizedPath = cwd === undefined ? undefined : normalizeProjectPath(cwd)
  return {
    installation_uid: installationUid,
    runtime: { family: 'asterhub', adapter_version: ADAPTER_VERSION },
    profile: { method: 'source', source_id: profileName, name: profileName },
    project: normalizedPath === undefined ? { method: 'personal' } : { method: 'derived', normalized_identity: normalizedPath },
    session: { method: 'source', source_id: session.id },
    capture_capabilities: {
      schema_id: 'anima.capture-capabilities/v1.0',
      stable_session_id: true,
      stable_event_id: true,
      stable_tool_call_id: true,
      final_assistant_message: true,
      final_tool_result: true,
      developer_messages: false,
      multimodal_content: true,
      source_sequence: true,
      source_timestamp: true,
      compact_event: false,
      shutdown_event: false,
      user_message_origin: true,
      turn_end_event: true,
      extensions: { 'anima.capture.boundary_checkpoint': true },
    },
  }
}

function normalizeProjectPath(path: string): string {
  const canonicalPath = realpathSync.native(path)
  const normalized = canonicalPath.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function applyContent(facts: SourceEventFacts, content: readonly ContentBlock[]): void {
  const missing: string[] = []
  const retained = content.filter(block => block.type !== 'tool-call')
  facts.content_parts = retained.map((block, part_index): CanonicalContentPart => {
    const markPartial = (): void => { missing.push(`/content/${part_index}`) }
    switch (block.type) {
      case 'text':
      case 'reasoning':
        return { schema_id: CONTENT_SCHEMA_ID, type: 'text', part_index, text: block.text }
      case 'image':
        return { schema_id: CONTENT_SCHEMA_ID, type: 'image', part_index, name: 'image', source_ref: JSON.stringify(block.attachment) }
      case 'file': {
        const attachment = block.attachment
        return { schema_id: CONTENT_SCHEMA_ID, type: 'file', part_index, name: attachment.name, source_ref: JSON.stringify(attachment) }
      }
      default:
        markPartial()
        return { schema_id: CONTENT_SCHEMA_ID, type: 'unknown', part_index, native_type: block.type, payload_json: JSON.stringify(block) }
    }
  })
  if (missing.length > 0) facts.fidelity = { completeness: 'partial', missing_fields: missing }
}

function parseToolArguments(raw: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(raw)
    const value = z.json().parse(parsed)
    return value
  } catch (error) {
    if (error instanceof SyntaxError) return { raw }
    throw error
  }
}
