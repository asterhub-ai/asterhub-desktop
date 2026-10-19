import { describe, expect, test } from "vitest";
import { projectTaskDigest, TaskDigestProjectorError } from "../src/index.ts";
import type { TaskDigestProjectionInput } from "../src/index.ts";

function digest(overrides: Partial<TaskDigestProjectionInput> = {}): TaskDigestProjectionInput {
  const initiator_uid = "event-0";
  const terminal_uid = "event-3";
  return {
    candidate_uid: "candidate-1",
    execution_uid: "execution-1",
    project_uid: "project-1",
    session_uid: "session-1",
    source_fingerprint: "fingerprint-1",
    initiator: { event_uid: initiator_uid, position: 0, content: "start" },
    events: [
      { event_uid: initiator_uid, position: 0, kind: "message", role: "user", content: "start" },
      { event_uid: "event-1", position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
      { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-1" },
      { event_uid: terminal_uid, position: 3, kind: "turn_end", role: "assistant", content: "done" },
    ],
    terminal: { state: "completed", terminal_reason: "final_reply", event_uid: terminal_uid, position: 3, captured_at: "2026-01-01T00:00:00Z" },
    unsettled_tool_calls: [],
    content_omissions: [],
    ...overrides,
  };
}

function digestWithTwoCalls(overrides: Partial<TaskDigestProjectionInput> = {}): TaskDigestProjectionInput {
  return digest({
    events: [
      { event_uid: "event-0", position: 0, kind: "message", role: "user", content: "start" },
      { event_uid: "event-1", position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
      { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-1" },
      { event_uid: "event-3", position: 3, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
      { event_uid: "event-4", position: 4, kind: "turn_end", role: "assistant", content: "done" },
    ],
    terminal: { state: "completed", terminal_reason: "final_reply", event_uid: "event-4", position: 4, captured_at: "2026-01-01T00:00:00Z" },
    unsettled_tool_calls: [{ tool_call_event_uid: "event-3", terminal_event_uid: "event-4" }],
    ...overrides,
  });
}

function rejects(input: TaskDigestProjectionInput): void {
  expect(() => projectTaskDigest(input)).toThrow(TaskDigestProjectorError);
}

describe("projectTaskDigest", () => {
  test("returns a new object and arrays for a valid complete digest", () => {
    const input = digest();
    const output = projectTaskDigest(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.events).not.toBe(input.events);
    expect(output.unsettled_tool_calls).not.toBe(input.unsettled_tool_calls);
    expect(output.content_omissions).not.toBe(input.content_omissions);
  });

  test("accepts cancelled and interrupted digests with the exact derived unresolved list", () => {
    const variants = [
      { state: "cancelled" as const, terminal_reason: "user_cancelled" as const },
      { state: "interrupted" as const, terminal_reason: "session_shutdown" as const },
    ];
    for (const variant of variants) {
      const base = digestWithTwoCalls();
      const input = digestWithTwoCalls({ terminal: { ...base.terminal, ...variant } });
      expect(projectTaskDigest(input).unsettled_tool_calls).toEqual([
        { tool_call_event_uid: "event-3", terminal_event_uid: "event-4" },
      ]);
    }
  });

  test("rejects duplicate event UID", () => {
    const base = digest();
    rejects(digest({
      events: [base.events[0]!, { ...base.events[1]!, event_uid: "event-0" }, base.events[2]!, base.events[3]!],
    }));
  });

  test("rejects terminal event that is not last", () => {
    const base = digest();
    rejects(digest({
      terminal: { ...base.terminal, position: 1 },
      events: [
        base.events[0]!,
        { ...base.events[3]!, position: 1 },
        { ...base.events[1]!, position: 2 },
        { ...base.events[2]!, position: 3 },
      ],
    }));
  });

  test("rejects a settled call marked unsettled", () => {
    rejects(digest({ unsettled_tool_calls: [{ tool_call_event_uid: "event-1", terminal_event_uid: "event-3" }] }));
  });

  test("rejects an omitted unresolved call", () => {
    rejects(digestWithTwoCalls({ unsettled_tool_calls: [] }));
  });

  test("rejects an extra unresolved call", () => {
    rejects(digestWithTwoCalls({
      unsettled_tool_calls: [
        { tool_call_event_uid: "event-3", terminal_event_uid: "event-4" },
        { tool_call_event_uid: "event-1", terminal_event_uid: "event-4" },
      ],
    }));
  });

  test("rejects a result targeting an event outside the digest", () => {
    const base = digest();
    rejects(digest({
      events: [base.events[0]!, base.events[1]!, { ...base.events[2]!, result_of_event_uid: "missing" }, base.events[3]!],
    }));
  });

  test("rejects a result targeting a non-call event", () => {
    const base = digest();
    rejects(digest({
      events: [base.events[0]!, base.events[1]!, { ...base.events[2]!, result_of_event_uid: "event-0" }, base.events[3]!],
    }));
  });

  test("rejects duplicate settlement of one tool call", () => {
    rejects(digest({
      events: [
        { event_uid: "event-0", position: 0, kind: "message", role: "user", content: "start" },
        { event_uid: "event-1", position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-1" },
        { event_uid: "event-3", position: 3, kind: "tool_result", role: "tool", content: "again", result_of_event_uid: "event-1" },
        { event_uid: "event-4", position: 4, kind: "turn_end", role: "assistant", content: "done" },
      ],
      terminal: { state: "completed", terminal_reason: "final_reply", event_uid: "event-4", position: 4, captured_at: "2026-01-01T00:00:00Z" },
    }));
  });

  test("rejects a result targeting a later tool call", () => {
    rejects(digest({
      events: [
        { event_uid: "event-0", position: 0, kind: "message", role: "user", content: "start" },
        { event_uid: "event-1", position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-3" },
        { event_uid: "event-3", position: 3, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-4", position: 4, kind: "turn_end", role: "assistant", content: "done" },
      ],
      terminal: { state: "completed", terminal_reason: "final_reply", event_uid: "event-4", position: 4, captured_at: "2026-01-01T00:00:00Z" },
      unsettled_tool_calls: [
        { tool_call_event_uid: "event-1", terminal_event_uid: "event-4" },
        { tool_call_event_uid: "event-3", terminal_event_uid: "event-4" },
      ],
    }));
  });

  test("rejects unresolved calls in the wrong event order", () => {
    rejects(digest({
      events: [
        { event_uid: "event-0", position: 0, kind: "message", role: "user", content: "start" },
        { event_uid: "event-1", position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-1" },
        { event_uid: "event-3", position: 3, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-4", position: 4, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-5", position: 5, kind: "turn_end", role: "assistant", content: "done" },
      ],
      terminal: { state: "completed", terminal_reason: "final_reply", event_uid: "event-5", position: 5, captured_at: "2026-01-01T00:00:00Z" },
      unsettled_tool_calls: [
        { tool_call_event_uid: "event-4", terminal_event_uid: "event-5" },
        { tool_call_event_uid: "event-3", terminal_event_uid: "event-5" },
      ],
    }));
  });

  test("rejects malformed or offset-free terminal timestamps", () => {
    for (const captured_at of ["2026-01-01T00:00:00", "2026-02-30T00:00:00Z", "2026-01-01T00:00:00+25:00"]) {
      rejects(digest({ terminal: { ...digest().terminal, captured_at } }));
    }
  });

  test("rejects omission outside events", () => {
    rejects(digest({ content_omissions: [{ event_uid: "missing", reason: "omitted" }] }));
  });
});
