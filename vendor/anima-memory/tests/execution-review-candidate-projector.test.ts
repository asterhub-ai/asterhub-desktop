import { describe, expect, test } from "vitest";
import {
  ExecutionReviewCandidateProjectorError,
  executionReviewCandidateUid,
  executionSourceFingerprint,
  executionUnitUid,
  projectExecutionReviewCandidates,
  type ExecutionReviewCandidateSnapshot,
  type ExecutionSourceEvent,
  type ExecutionUnitSnapshot,
} from "../src/index.ts";

const project_uid = "11111111-1111-4111-8111-111111111111";
const session_uid = "22222222-2222-4222-8222-222222222222";

function uid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}
function fingerprint(sequence: number): string {
  return sequence.toString(16).padStart(64, "0");
}
function source(sequence: number, kind: ExecutionSourceEvent["kind"], fields: Record<string, unknown> = {}): ExecutionSourceEvent {
  return {
    event_uid: uid(sequence),
    project_uid,
    session_uid,
    ingest_sequence: sequence,
    fingerprint: fingerprint(sequence),
    kind,
    ...(kind === "message" ? { role: "user", message_origin: "external_user" } : {}),
    ...(kind === "tool_result" ? { outcome: "success", result_of_event_uid: uid(sequence - 1) } : {}),
    ...(kind === "turn_end" ? { turn_index: sequence, turn_end_status: "final_reply" } : {}),
    ...fields,
  } as ExecutionSourceEvent;
}
function unit(events: ExecutionSourceEvent[], state: ExecutionUnitSnapshot["state"] = "completed"): ExecutionUnitSnapshot {
  const first = events[0]!;
  const call = events.find((event) => event.kind === "tool_call")!;
  const terminal = state === "open" ? undefined : events.at(-1)!;
  const reason = state === "completed" ? "final_reply" : state === "cancelled" ? "user_cancelled" : state === "interrupted" ? "session_shutdown" : null;
  return {
    execution_uid: executionUnitUid(project_uid, session_uid, first.event_uid, call.event_uid),
    project_uid,
    session_uid,
    initiator_kind: "user_request",
    initiator_event_uid: first.event_uid,
    first_tool_call_event_uid: call.event_uid,
    start_ingest_sequence: first.ingest_sequence,
    end_ingest_sequence: events.at(-1)!.ingest_sequence,
    event_count: events.length,
    state,
    source_fingerprint: executionSourceFingerprint(project_uid, session_uid, events),
    ordered_event_uids: events.map((event) => event.event_uid),
    contains_roles: events.map((_, index) => index === 0 ? "initiator" : index === 1 ? "first_tool_call" : terminal !== undefined && index === events.length - 1 ? "terminal" : "member"),
    initiated_by_event_uid: first.event_uid,
    finalized_by_event_uid: terminal?.event_uid ?? null,
    terminal_reason: reason,
    terminal_event_uid: terminal?.event_uid ?? null,
  } as ExecutionUnitSnapshot;
}
function plan(events: ExecutionSourceEvent[], execution: ExecutionUnitSnapshot, existing_candidates: ExecutionReviewCandidateSnapshot[] = []) {
  return projectExecutionReviewCandidates({ project_uid, session_uid, events, execution_units: [execution], existing_candidates });
}
function expectCode(action: () => unknown, code: ExecutionReviewCandidateProjectorError["code"]): void {
  try {
    action();
    throw new Error("expected candidate projector rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutionReviewCandidateProjectorError);
    expect((error as ExecutionReviewCandidateProjectorError).code).toBe(code);
  }
}

describe("ExecutionReviewCandidate pure projector", () => {
  test("creates a completed candidate with all retry and error counts", () => {
    const events = [
      source(0, "message"),
      source(1, "tool_call"),
      source(2, "tool_result", { outcome: "error", result_of_event_uid: uid(1) }),
      source(3, "tool_call"),
      source(4, "tool_result", { outcome: "success", result_of_event_uid: uid(3) }),
      source(5, "turn_end"),
    ];
    const result = plan(events, unit(events));
    expect(result).toMatchObject({ candidates_created: 1, evidence_links_created: 6 });
    expect(result.candidate_plans[0]).toMatchObject({ node_action: "create", after: { state: "ready", execution_state: "completed", terminal_reason: "final_reply", tool_call_count: 2, tool_result_count: 2, tool_error_count: 1 } });
    expect(result.candidate_plans[0]?.evidence_links.map((link) => link.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("accepts cancellation with an unmatched call", () => {
    const events = [source(0, "message"), source(1, "tool_call"), source(2, "turn_end", { turn_end_status: "cancelled" })];
    const execution = unit(events, "cancelled");
    expect(plan(events, execution).candidate_plans[0]?.after).toMatchObject({ state: "ready", execution_state: "cancelled", terminal_reason: "user_cancelled", tool_call_count: 1, tool_result_count: 0 });
  });

  test("preserves every existing workflow state during replay", () => {
    const events = [source(0, "message"), source(1, "tool_call"), source(2, "tool_result"), source(3, "turn_end")];
    const execution = unit(events);
    const created = plan(events, execution).candidate_plans[0]!.after;
    for (const state of ["ready", "leased", "reviewed", "skipped", "rejected"] as const) {
      const existing = { ...created, state };
      const replay = plan(events, execution, [existing]);
      expect(replay).toMatchObject({ candidates_created: 0, evidence_links_created: 0, candidate_plans: [{ node_action: "verify", after: { state } }] });
    }
  });

  test("returns an empty up-to-date plan for open or absent terminal units", () => {
    const events = [source(0, "message"), source(1, "tool_call")];
    expect(plan(events, unit(events, "open"))).toMatchObject({ candidates_created: 0, candidate_plans: [] });
    expect(projectExecutionReviewCandidates({ project_uid, session_uid, events, execution_units: [], existing_candidates: [] })).toMatchObject({ candidates_created: 0, candidate_plans: [] });
  });
  test("accepts shutdown interruption with an unmatched call", () => {
    const events = [source(0, "message"), source(1, "tool_call"), source(2, "boundary", { boundary_type: "shutdown" })];
    expect(plan(events, unit(events, "interrupted")).candidate_plans[0]?.after).toMatchObject({ state: "ready", execution_state: "interrupted", terminal_reason: "session_shutdown", tool_call_count: 1, tool_result_count: 0 });
  });

  test("rejects fingerprint and duplicate correlation conflicts", () => {
    const events = [source(0, "message"), source(1, "tool_call"), source(2, "tool_result"), source(3, "turn_end")];
    const execution = unit(events);
    expectCode(() => plan(events.map((event, index) => index === 2 ? { ...event, fingerprint: "f".repeat(64) } : event), execution), "identity_conflict");
    const duplicate = [...events.slice(0, 2), source(2, "tool_result"), source(3, "tool_result", { result_of_event_uid: uid(1) }), source(4, "turn_end")];
    expectCode(() => plan(duplicate, unit(duplicate)), "identity_conflict");
  });

  test("derives the documented candidate identity", () => {
    const events = [source(0, "message"), source(1, "tool_call"), source(2, "turn_end", { turn_end_status: "cancelled" })];
    const execution = unit(events, "cancelled");
    const candidate = plan(events, execution).candidate_plans[0]!.after;
    expect(candidate.candidate_uid).toBe(executionReviewCandidateUid(execution.execution_uid, execution.source_fingerprint));
  });
});
