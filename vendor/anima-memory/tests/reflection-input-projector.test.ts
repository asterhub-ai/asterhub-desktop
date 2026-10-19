import { describe, expect, test } from "vitest";
import { automaticReflectionSelector } from "../src/reflection-calendar.ts";
import {
  buildAutomaticReflectionInput,
  buildManualCandidateReflectionInput,
} from "../src/reflection-input-projector.ts";
import { TaskDigestProjectorError } from "../src/task-digest-projector.ts";
import type { TaskDigest } from "../src/task-digest-types.ts";

const AUTOMATIC_PROJECT_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function digest(overrides: Partial<TaskDigest> = {}): TaskDigest {
  const events = [
    { event_uid: "event-0", position: 0, kind: "message" as const, role: "user", content: "start" },
    { event_uid: "event-1", position: 1, kind: "tool_call" as const, role: "assistant", content: null, tool_name: "lookup" },
    { event_uid: "event-2", position: 2, kind: "tool_result" as const, role: "tool", content: "ok", result_of_event_uid: "event-1" },
    { event_uid: "event-3", position: 3, kind: "turn_end" as const, role: "assistant", content: "done" },
  ];
  return {
    candidate_uid: "candidate-1",
    execution_uid: "execution-1",
    project_uid: "project-1",
    session_uid: "session-1",
    source_fingerprint: "source-1",
    terminal: { state: "completed", terminal_reason: "final_reply", event_uid: "event-3", position: 3, captured_at: "2026-01-01T00:00:00Z" },
    initiator: { event_uid: "event-0", position: 0, content: "start" },
    events,
    unsettled_tool_calls: [],
    content_omissions: [],
    ...overrides,
  };
}

describe("buildManualCandidateReflectionInput", () => {
  test("is deterministic and emits exact lowercase SHA-256 fingerprints", () => {
    const source = digest();
    const first = buildManualCandidateReflectionInput(source);
    const second = buildManualCandidateReflectionInput(source);

    expect(first).toEqual(second);
    expect(first.input_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.scope_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("returns deep copies of the digest and its collections", () => {
    const source = digest();
    const result = buildManualCandidateReflectionInput(source);
    const projected = result.task_digests[0]!;

    expect(result.selector).not.toBe(source);
    expect(projected).not.toBe(source);
    expect(projected.terminal).not.toBe(source.terminal);
    expect(projected.initiator).not.toBe(source.initiator);
    expect(projected.events).not.toBe(source.events);
    expect(projected.events[0]).not.toBe(source.events[0]);
    expect(projected.unsettled_tool_calls).not.toBe(source.unsettled_tool_calls);
    expect(projected.content_omissions).not.toBe(source.content_omissions);

    projected.events[0]!.content = "changed";
    expect(source.events[0]!.content).toBe("start");
  });

  test("event content changes only the input fingerprint", () => {
    const original = buildManualCandidateReflectionInput(digest());
    const changedDigest = digest({
      events: [
        { event_uid: "event-0", position: 0, kind: "message", role: "user", content: "changed" },
        { event_uid: "event-1", position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-1" },
        { event_uid: "event-3", position: 3, kind: "turn_end", role: "assistant", content: "done" },
      ],
    });
    const changed = buildManualCandidateReflectionInput(changedDigest);

    expect(changed.scope_fingerprint).toBe(original.scope_fingerprint);
    expect(changed.input_fingerprint).not.toBe(original.input_fingerprint);
  });

  test("candidate UID changes both fingerprints", () => {
    const original = buildManualCandidateReflectionInput(digest());
    const changed = buildManualCandidateReflectionInput(digest({ candidate_uid: "candidate-2" }));

    expect(changed.scope_fingerprint).not.toBe(original.scope_fingerprint);
    expect(changed.input_fingerprint).not.toBe(original.input_fingerprint);
  });

  test("rejects an invalid digest through the TaskDigest projector", () => {
    const invalid = digest({
      events: [
        { event_uid: "event-0", position: 0, kind: "message", role: "user", content: "start" },
        { event_uid: "event-1", position: 3, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
        { event_uid: "event-2", position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: "event-1" },
        { event_uid: "event-3", position: 3, kind: "turn_end", role: "assistant", content: "done" },
      ],
    });

    expect(() => buildManualCandidateReflectionInput(invalid)).toThrow(TaskDigestProjectorError);
  });
});
describe("buildAutomaticReflectionInput", () => {
  const selector = automaticReflectionSelector(AUTOMATIC_PROJECT_UID, "daily", "2026-01-01");

  function automaticDigest(
    candidate_uid: string,
    captured_at: string,
    project_uid = AUTOMATIC_PROJECT_UID,
  ): TaskDigest {
    const source = digest({ candidate_uid, project_uid });
    return {
      ...source,
      terminal: { ...source.terminal, captured_at },
    };
  }

  test("sorts by exact terminal instant and candidate UID without rewriting timestamp spelling", () => {
    const early = automaticDigest("candidate-z", "2026-01-01T07:00:00.0001Z");
    const late = automaticDigest("candidate-a", "2026-01-01T07:00:00.0002Z");
    const first = buildAutomaticReflectionInput(selector, [late, early]);
    const second = buildAutomaticReflectionInput(selector, [early, late]);

    expect(first.task_digests.map((item) => item.candidate_uid)).toEqual(["candidate-z", "candidate-a"]);
    expect(first.task_digests[0]!.terminal.captured_at).toBe("2026-01-01T07:00:00.0001Z");
    expect(first.input_fingerprint).toBe(second.input_fingerprint);
    expect(first.scope_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("uses candidate UID only when exact terminal instants are equal", () => {
    const laterUid = automaticDigest("candidate-z", "2026-01-01T07:00:00.0001Z");
    const earlierUid = automaticDigest("candidate-a", "2026-01-01T07:00:00.0001000Z");
    const result = buildAutomaticReflectionInput(selector, [laterUid, earlierUid]);

    expect(result.task_digests.map((item) => item.candidate_uid)).toEqual(["candidate-a", "candidate-z"]);
    expect(result.task_digests[0]!.terminal.captured_at).toBe("2026-01-01T07:00:00.0001000Z");
  });

  test("rejects null, arrays, missing keys, and extra undefined selector keys", () => {
    const first = automaticDigest("candidate-a", "2026-01-01T01:00:00Z");
    expect(() => buildAutomaticReflectionInput(null as never, [first])).toThrow(TypeError);
    expect(() => buildAutomaticReflectionInput([] as never, [first])).toThrow(TypeError);
    const { end_at: _end_at, ...missingEnd } = selector;
    expect(() => buildAutomaticReflectionInput(missingEnd as never, [first])).toThrow(TypeError);
    expect(() => buildAutomaticReflectionInput({ ...selector, unexpected: undefined } as never, [first])).toThrow(TypeError);
  });

  test("rejects duplicate candidates, wrong projects, out-of-window terminals, and tampered selectors", () => {
    const first = automaticDigest("candidate-a", "2026-01-01T01:00:00Z");
    expect(() => buildAutomaticReflectionInput(selector, [first, first])).toThrow("duplicate candidate UID");
    expect(() => buildAutomaticReflectionInput(selector, [
      automaticDigest("candidate-a", "2026-01-01T01:00:00Z", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ])).toThrow("digest project does not match selector");
    expect(() => buildAutomaticReflectionInput(selector, [
      automaticDigest("candidate-a", "2026-01-01T16:00:00Z"),
    ])).toThrow("outside selector window");
    expect(() => buildAutomaticReflectionInput(
      { ...selector, end_at: "2026-01-02T16:00:00.000Z" },
      [first],
    )).toThrow("selector does not match");
  });
});
