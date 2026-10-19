import { parseInstant } from "./reflection-calendar.ts";
import type {
  TaskDigest,
  TaskDigestContentOmission,
  TaskDigestEvent,
  TaskDigestInitiator,
  TaskDigestTerminal,
  TaskDigestUnsettledToolCall,
} from "./task-digest-types.ts";

export class TaskDigestProjectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskDigestProjectorError";
  }
}

export interface TaskDigestProjectionInput {
  candidate_uid: string;
  execution_uid: string;
  project_uid: string;
  session_uid: string;
  source_fingerprint: string;
  terminal: TaskDigestTerminal;
  initiator: TaskDigestInitiator;
  events: TaskDigestEvent[];
  unsettled_tool_calls: TaskDigestUnsettledToolCall[];
  content_omissions: TaskDigestContentOmission[];
}

function fail(message: string): never {
  throw new TaskDigestProjectorError(message);
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${name} must be a nonempty string`);
  }
  return value;
}

export function projectTaskDigest(input: TaskDigestProjectionInput): TaskDigest {
  if (input === null || typeof input !== "object") {
    return fail("input must be an object");
  }

  nonempty(input.candidate_uid, "candidate_uid");
  nonempty(input.execution_uid, "execution_uid");
  nonempty(input.project_uid, "project_uid");
  nonempty(input.session_uid, "session_uid");
  nonempty(input.source_fingerprint, "source_fingerprint");

  if (input.initiator.position !== 0) {
    return fail("initiator position must be zero");
  }
  if (!Array.isArray(input.events) || input.events.length === 0) {
    return fail("events must be nonempty");
  }

  const eventByUid = new Map<string, TaskDigestEvent>();
  const toolCallPositionByUid = new Map<string, number>();
  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index]!;
    if (event.position !== index) {
      return fail("event positions must be contiguous and zero-based");
    }
    const eventUid = nonempty(event.event_uid, `events[${index}].event_uid`);
    nonempty(event.role, `events[${index}].role`);
    if (eventByUid.has(eventUid)) {
      return fail(`duplicate event UID: ${eventUid}`);
    }
    eventByUid.set(eventUid, event);
    if (event.kind === "tool_call") {
      toolCallPositionByUid.set(eventUid, index);
    }
  }

  const initiatorUid = nonempty(input.initiator.event_uid, "initiator.event_uid");
  if (input.events[0]!.event_uid !== initiatorUid) {
    return fail("event zero UID must equal initiator UID");
  }
  const terminalUid = nonempty(input.terminal.event_uid, "terminal.event_uid");

  const capturedAt = nonempty(input.terminal.captured_at, "terminal.captured_at");
  try {
    parseInstant(capturedAt);
  } catch {
    return fail("terminal.captured_at must be a valid offset-bearing instant");
  }
  const terminalEvents = input.events.filter((event) => event.event_uid === terminalUid);
  if (terminalEvents.length !== 1) {
    return fail("terminal event UID must occur exactly once");
  }
  if (input.terminal.position !== terminalEvents[0]!.position) {
    return fail("terminal position must equal its event position");
  }
  if (terminalEvents[0]!.position !== input.events.length - 1) {
    return fail("terminal event must be last");
  }

  const settledToolCallUids = new Set<string>();
  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index]!;
    if (event.kind !== "tool_result" || event.result_of_event_uid === undefined) {
      continue;
    }
    const resultTargetUid = nonempty(event.result_of_event_uid, `events[${index}].result_of_event_uid`);
    const toolCallPosition = toolCallPositionByUid.get(resultTargetUid);
    if (toolCallPosition === undefined || toolCallPosition >= index) {
      return fail("tool result correlation must target an earlier tool_call event");
    }
    if (settledToolCallUids.has(resultTargetUid)) {
      return fail("tool result correlation settles a tool call more than once");
    }
    settledToolCallUids.add(resultTargetUid);
  }

  const expectedUnsettledToolCalls = input.events
    .filter((event) => event.kind === "tool_call" && !settledToolCallUids.has(event.event_uid))
    .map((event) => ({ tool_call_event_uid: event.event_uid, terminal_event_uid: terminalUid }));

  if (!Array.isArray(input.unsettled_tool_calls)) {
    return fail("unsettled_tool_calls must be an array");
  }
  const unsettledToolCallUids = new Set<string>();
  for (const item of input.unsettled_tool_calls) {
    const toolCallUid = nonempty(item.tool_call_event_uid, "unsettled tool call UID");
    if (unsettledToolCallUids.has(toolCallUid)) {
      return fail("unsettled tool calls must be distinct");
    }
    unsettledToolCallUids.add(toolCallUid);
    const toolCall = eventByUid.get(toolCallUid);
    if (toolCall?.kind !== "tool_call") {
      return fail("unsettled item must point to a tool_call event");
    }
    if (item.terminal_event_uid !== terminalUid) {
      return fail("unsettled item must point to the terminal event");
    }
  }
  if (input.unsettled_tool_calls.length !== expectedUnsettledToolCalls.length) {
    return fail("unsettled tool calls must exactly match unresolved tool calls");
  }
  for (let index = 0; index < expectedUnsettledToolCalls.length; index += 1) {
    const actual = input.unsettled_tool_calls[index]!;
    const expected = expectedUnsettledToolCalls[index]!;
    if (actual.tool_call_event_uid !== expected.tool_call_event_uid || actual.terminal_event_uid !== expected.terminal_event_uid) {
      return fail("unsettled tool calls must follow event order");
    }
  }

  if (!Array.isArray(input.content_omissions)) {
    return fail("content_omissions must be an array");
  }
  const omissionUids = new Set<string>();
  for (const omission of input.content_omissions) {
    const eventUid = nonempty(omission.event_uid, "omission event UID");
    if (omissionUids.has(eventUid)) {
      return fail("omission event UIDs must be unique");
    }
    omissionUids.add(eventUid);
    if (!eventByUid.has(eventUid)) {
      return fail("omission event UID must exist in events");
    }
  }

  return {
    candidate_uid: input.candidate_uid,
    execution_uid: input.execution_uid,
    project_uid: input.project_uid,
    session_uid: input.session_uid,
    source_fingerprint: input.source_fingerprint,
    terminal: { ...input.terminal },
    initiator: { ...input.initiator },
    events: input.events.map((event) => ({ ...event })),
    unsettled_tool_calls: input.unsettled_tool_calls.map((item) => ({ ...item })),
    content_omissions: input.content_omissions.map((omission) => ({ ...omission })),
  };
}
