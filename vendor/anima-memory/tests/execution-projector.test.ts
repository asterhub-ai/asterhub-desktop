import { describe, expect, test } from "vitest";
import {
  EXECUTION_PROJECTOR_VERSION,
  ExecutionProjectorError,
  executionSourceFingerprint,
  executionUnitUid,
  projectExecutionUnits,
  type ExecutionSourceEvent,
  type ExecutionUnitSnapshot,
  type ProjectExecutionUnitsInput,
} from "../src/index.ts";

const project_uid = "11111111-1111-4111-8111-111111111111";
const session_uid = "22222222-2222-4222-8222-222222222222";
const second_session_uid = "33333333-3333-4333-8333-333333333333";
const other_project_uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function eventUid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function fingerprint(sequence: number): string {
  return sequence.toString(16).padStart(64, "0");
}

type SourceFields = {
  role?: "user" | "assistant" | "developer" | "system" | "unknown";
  message_origin?: "external_user" | "runtime_synthetic" | null;
  outcome?: "success" | "error" | "cancelled" | "unknown";
  result_of_event_uid?: string | null;
  turn_index?: number;
  turn_end_status?: "nonterminal" | "final_reply" | "cancelled";
  boundary_type?: "checkpoint" | "compact" | "shutdown" | "validation" | "unknown";
};

function source(
  ingest_sequence: number,
  kind: ExecutionSourceEvent["kind"],
  fields: SourceFields = {},
  event_uid = eventUid(ingest_sequence),
): ExecutionSourceEvent {
  return {
    event_uid,
    project_uid,
    session_uid,
    ingest_sequence,
    fingerprint: fingerprint(ingest_sequence),
    kind,
    ...(kind === "message" ? { role: fields.role ?? "assistant", message_origin: fields.message_origin ?? null } : {}),
    ...(kind === "tool_result" ? { outcome: fields.outcome ?? "success", result_of_event_uid: fields.result_of_event_uid ?? null } : {}),
    ...(kind === "turn_end" ? { turn_index: fields.turn_index ?? ingest_sequence, turn_end_status: fields.turn_end_status ?? "nonterminal" } : {}),
    ...(kind === "boundary" ? { boundary_type: fields.boundary_type ?? "unknown" } : {}),
  } as ExecutionSourceEvent;
}

function user(sequence: number, origin: "external_user" | "runtime_synthetic" = "external_user"): ExecutionSourceEvent {
  return source(sequence, "message", { role: "user", message_origin: origin });
}
function assistant(sequence: number): ExecutionSourceEvent {
  return source(sequence, "message", { role: "assistant", message_origin: null });
}
function call(sequence: number, event_uid = eventUid(sequence)): ExecutionSourceEvent {
  return source(sequence, "tool_call", {}, event_uid);
}
function result(sequence: number, target: string | null, outcome: "success" | "error" | "cancelled" | "unknown" = "success"): ExecutionSourceEvent {
  return source(sequence, "tool_result", { result_of_event_uid: target, outcome });
}
function turn(sequence: number, status: "nonterminal" | "final_reply" | "cancelled" = "nonterminal"): ExecutionSourceEvent {
  return source(sequence, "turn_end", { turn_index: sequence, turn_end_status: status });
}
function boundary(sequence: number, type: "compact" | "shutdown" | "checkpoint" | "validation" | "unknown"): ExecutionSourceEvent {
  return source(sequence, "boundary", { boundary_type: type });
}

function input(events: ExecutionSourceEvent[], existing_execution_units: ExecutionUnitSnapshot[] = []): ProjectExecutionUnitsInput {
  return { project_uid, session_uid, events, existing_execution_units };
}

function expectCode(action: () => unknown, code: ExecutionProjectorError["code"]): void {
  try {
    action();
    throw new Error("expected execution projector to reject input");
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutionProjectorError);
    expect((error as ExecutionProjectorError).code).toBe(code);
  }
}

function createdSnapshot(events: ExecutionSourceEvent[], terminal?: { reason: "final_reply" | "user_cancelled" | "session_shutdown" | "session_compact"; event: ExecutionSourceEvent }): ExecutionUnitSnapshot {
  const start = events[0]!;
  const firstCall = events.find((event) => event.kind === "tool_call")!;
  const end = events.at(-1)!;
  const terminalEvent = terminal?.event ?? null;
  return {
    execution_uid: executionUnitUid(project_uid, session_uid, start.event_uid, firstCall.event_uid),
    project_uid,
    session_uid,
    initiator_kind: "user_request",
    initiator_event_uid: start.event_uid,
    first_tool_call_event_uid: firstCall.event_uid,
    start_ingest_sequence: start.ingest_sequence,
    end_ingest_sequence: end.ingest_sequence,
    event_count: events.length,
    state: terminal === undefined ? "open" : terminal.reason === "final_reply" ? "completed" : terminal.reason === "user_cancelled" ? "cancelled" : "interrupted",
    source_fingerprint: executionSourceFingerprint(project_uid, session_uid, events),
    ordered_event_uids: events.map((event) => event.event_uid),
    contains_roles: events.map((event, index) => terminalEvent?.event_uid === event.event_uid ? "terminal" : index === 0 ? "initiator" : index === 1 ? "first_tool_call" : "member"),
    initiated_by_event_uid: start.event_uid,
    finalized_by_event_uid: terminalEvent?.event_uid ?? null,
    terminal_reason: terminal?.reason ?? null,
    terminal_event_uid: terminalEvent?.event_uid ?? null,
  };
}

type ExecutionContainsLink = {
  execution_uid: string;
  event_uid: string;
  position: number;
  role: "initiator" | "first_tool_call" | "member" | "terminal";
};

type ExecutionFinalizerLink = {
  execution_uid: string;
  event_uid: string;
  terminal_reason: "final_reply" | "user_cancelled" | "session_shutdown" | "session_compact";
};

type ExecutionPlanUnit = {
  node_action: "create" | "update" | "verify";
  before?: ExecutionUnitSnapshot;
  after: ExecutionUnitSnapshot;
  owner_link: { session_uid: string; execution_uid: string } | null;
  initiator_link: { execution_uid: string; event_uid: string } | null;
  contains_links: ExecutionContainsLink[];
  finalizer_link: ExecutionFinalizerLink | null;
};

type ExecutionPlan = {
  through_ingest_sequence: number;
  unit_plans: ExecutionPlanUnit[];
  execution_units_created: number;
  execution_units_updated: number;
  event_links_created: number;
};

function planFor(events: ExecutionSourceEvent[], existing_execution_units: ExecutionUnitSnapshot[] = []): ExecutionPlan {
  return projectExecutionUnits(input(events, existing_execution_units)) as ExecutionPlan;
}

function onlyPlan(events: ExecutionSourceEvent[], existing_execution_units: ExecutionUnitSnapshot[] = []): ExecutionPlanUnit {
  const plan = planFor(events, existing_execution_units);
  expect(plan.unit_plans).toHaveLength(1);
  return plan.unit_plans[0]!;
}

describe("ExecutionUnit pure projector", () => {
  test("uses deterministic UUID, source fingerprint, and fixed projector version", () => {
    const events = [user(0), call(1)];
    expect(EXECUTION_PROJECTOR_VERSION).toBe("anima.execution-projector/v1");
    const uid = executionUnitUid(project_uid, session_uid, events[0]!.event_uid, events[1]!.event_uid);
    expect(uid).toBe(executionUnitUid(project_uid, session_uid, events[0]!.event_uid, events[1]!.event_uid));
    expect(uid).not.toBe(executionUnitUid(project_uid, second_session_uid, events[0]!.event_uid, events[1]!.event_uid));
    expect(executionSourceFingerprint(project_uid, session_uid, events)).not.toBe(executionSourceFingerprint(project_uid, session_uid, [events[1]!, events[0]!]));
    expect(() => executionUnitUid(other_project_uid.toUpperCase(), session_uid, events[0]!.event_uid, events[1]!.event_uid)).toThrow(TypeError);
    expect(() => executionSourceFingerprint(project_uid, session_uid, [{ ...events[0]!, fingerprint: "A".repeat(64) }])).toThrow(TypeError);
  });

  test("projects text-only turns and synthetic user turns without an ExecutionUnit", () => {
    expect(planFor([])).toMatchObject({ through_ingest_sequence: -1, execution_units_created: 0, execution_units_updated: 0, event_links_created: 0, unit_plans: [] });
    const textOnly = planFor([user(0), turn(1, "final_reply")]);
    expect(textOnly).toMatchObject({ through_ingest_sequence: 1, execution_units_created: 0, execution_units_updated: 0, event_links_created: 0, unit_plans: [] });

    const synthetic = planFor([user(0, "runtime_synthetic"), call(1), result(2, eventUid(1)), turn(3, "final_reply")]);
    expect(synthetic).toMatchObject({ execution_units_created: 0, execution_units_updated: 0, event_links_created: 0, unit_plans: [] });
  });

  test("creates one completed unit for parallel calls, out-of-order results, and a qualified final reply", () => {
    const events = [
      user(0),
      call(1),
      call(2),
      result(3, eventUid(2), "error"),
      result(4, eventUid(1), "success"),
      turn(5),
      turn(6, "final_reply"),
    ];
    const plan = planFor(events);
    const after = createdSnapshot(events, { reason: "final_reply", event: events[6]! });
    expect(plan).toMatchObject({ through_ingest_sequence: 6, execution_units_created: 1, execution_units_updated: 0, event_links_created: 7 });
    expect(plan.unit_plans[0]).toMatchObject({
      node_action: "create",
      after,
      owner_link: { session_uid, execution_uid: after.execution_uid },
      initiator_link: { execution_uid: after.execution_uid, event_uid: events[0]!.event_uid },
      finalizer_link: { execution_uid: after.execution_uid, event_uid: events[6]!.event_uid, terminal_reason: "final_reply" },
    });
    expect(plan.unit_plans[0]!.contains_links).toHaveLength(7);
    expect(plan.unit_plans[0]!.contains_links.map((link) => link.role)).toEqual([
      "initiator", "first_tool_call", "member", "member", "member", "member", "terminal",
    ]);
    expect(JSON.stringify(plan)).not.toContain("content_parts");
    expect(JSON.stringify(plan)).not.toContain("native_payload");
  });

  test("keeps a unit open after results or a final reply with an unmatched call", () => {
    const events = [user(0), call(1), call(2), result(3, eventUid(1)), turn(4, "final_reply")];
    const plan = planFor(events);
    const after = createdSnapshot(events);
    expect(plan.unit_plans[0]).toMatchObject({ node_action: "create", after, finalizer_link: null });
    expect(after.state).toBe("open");

    const missing = planFor([user(0), call(1), result(2, null), turn(3, "final_reply")]);
    expect(missing.unit_plans[0]?.after.state).toBe("open");
  });
  test("cancels an open unit at a cancelled turn end even with an unmatched call", () => {
    const events = [user(0), call(1), turn(2, "cancelled")];
    const plan = planFor(events);
    const after = createdSnapshot(events, { reason: "user_cancelled", event: events[2]! });
    expect(plan).toMatchObject({ through_ingest_sequence: 2, execution_units_created: 1, execution_units_updated: 0, event_links_created: 3 });
    expect(plan.unit_plans[0]).toMatchObject({
      node_action: "create",
      after,
      finalizer_link: { execution_uid: after.execution_uid, event_uid: events[2]!.event_uid, terminal_reason: "user_cancelled" },
    });
    expect(after.state).toBe("cancelled");
    expect(after.terminal_reason).toBe("user_cancelled");
    expect(after.finalized_by_event_uid).toBe(events[2]!.event_uid);
    expect(plan.unit_plans[0]!.contains_links.at(-1)).toMatchObject({ event_uid: events[2]!.event_uid, role: "terminal" });
  });

  test("clears a candidate user at a cancelled turn before an unprompted tool call", () => {
    const plan = planFor([user(0), turn(1, "cancelled"), call(2)]);
    expect(plan).toMatchObject({ through_ingest_sequence: 2, unit_plans: [], execution_units_created: 0, execution_units_updated: 0, event_links_created: 0 });
  });

  test("rejects missing or wrong RESULT_OF provenance without settling calls", () => {
    const missing = planFor([user(0), call(1), result(2, null), turn(3, "final_reply")]);
    expect(missing.unit_plans[0]?.after.state).toBe("open");
    const reverse = source(2, "tool_result", { result_of_event_uid: eventUid(3) });
    expect(planFor([user(0), call(1), reverse, turn(3, "final_reply")]).unit_plans[0]?.after.state).toBe("open");
    expectCode(() => projectExecutionUnits(input([user(0), call(1), result(2, eventUid(1)), result(3, eventUid(1))])), "identity_conflict");
    expectCode(() => projectExecutionUnits(input([user(0), call(1), result(2, eventUid(1), "unknown"), result(3, eventUid(1), "success")])), "identity_conflict");
  });

  test("keeps a second tool turn in the original unit and ignores an unprompted call", () => {
    const events = [user(0), call(1), result(2, eventUid(1)), turn(3), call(4), result(5, eventUid(4)), turn(6, "final_reply")];
    const plan = planFor(events);
    expect(plan.unit_plans[0]?.after.event_count).toBe(7);
    expect(plan.unit_plans[0]?.after.first_tool_call_event_uid).toBe(eventUid(1));

    const later = [call(0), user(1), call(2)];
    const laterPlan = planFor(later);
    expect(laterPlan.unit_plans).toHaveLength(1);
    expect(laterPlan.unit_plans[0]?.after.initiator_event_uid).toBe(eventUid(1));
    expect(laterPlan.unit_plans[0]?.after.start_ingest_sequence).toBe(1);
    expect(laterPlan.unit_plans[0]!.contains_links.map((link) => link.event_uid)).toEqual([eventUid(1), eventUid(2)]);
  });

  test("interrupts open units at compact or shutdown, while boundaries alone never create one", () => {
    for (const [kind, reason] of [["compact", "session_compact"], ["shutdown", "session_shutdown"]] as const) {
      const events = [user(0), call(1), boundary(2, kind as "compact" | "shutdown")];
      const plan = planFor(events);
      const after = createdSnapshot(events, { reason, event: events[2]! });
      expect(plan.unit_plans[0]).toMatchObject({ node_action: "create", after, finalizer_link: { terminal_reason: reason } });
      expect(after.state).toBe("interrupted");
    }
    for (const events of [[boundary(0, "compact")], [boundary(0, "shutdown"), turn(1)]]) {
      expect(planFor(events)).toMatchObject({ unit_plans: [], execution_units_created: 0 });
    }
  });

  test("creates two non-overlapping units for two requests in one session", () => {
    const events = [user(0), call(1), result(2, eventUid(1)), turn(3, "final_reply"), user(4), call(5)];
    const plan = planFor(events);
    expect(plan.unit_plans).toHaveLength(2);
    expect(plan.unit_plans[0]?.after.ordered_event_uids).toEqual([eventUid(0), eventUid(1), eventUid(2), eventUid(3)]);
    expect(plan.unit_plans[1]?.after.ordered_event_uids).toEqual([eventUid(4), eventUid(5)]);
    expect(plan.unit_plans[0]?.after.execution_uid).not.toBe(plan.unit_plans[1]?.after.execution_uid);
  });

  test("replays open growth, terminal transition, and terminal no-op deterministically", () => {
    const prefix = [user(0), call(1)];
    const first = onlyPlan(prefix);
    const open = first.after as ExecutionUnitSnapshot;
    expect(first.node_action).toBe("create");

    const grown = [...prefix, result(2, eventUid(1))];
    const growth = onlyPlan(grown, [open]);
    expect(growth.node_action).toBe("update");
    expect(growth.before).toEqual(open);
    expect(growth.contains_links).toEqual([{ execution_uid: open.execution_uid, event_uid: eventUid(2), position: 2, role: "member" }]);
    expect(growth.after.source_fingerprint).toBe(executionSourceFingerprint(project_uid, session_uid, grown));

    const terminalEvents = [...grown, turn(3, "final_reply")];
    const terminal = onlyPlan(terminalEvents, [growth.after]);
    expect(terminal.node_action).toBe("update");
    expect(terminal.finalizer_link).toMatchObject({ event_uid: eventUid(3), terminal_reason: "final_reply" });

    const replay = onlyPlan(terminalEvents, [terminal.after]);
    expect(replay.node_action).toBe("verify");
    expect(replay.contains_links).toEqual([]);
    expect(planFor(terminalEvents, [terminal.after])).toMatchObject({ execution_units_created: 0, execution_units_updated: 0, event_links_created: 0 });
  });
  test("replays a cancelled unit exactly and rejects an invalid state-reason pairing", () => {
    const events = [user(0), call(1), turn(2, "cancelled")];
    const first = onlyPlan(events);
    const cancelled = first.after;
    const replay = onlyPlan(events, [cancelled]);
    expect(replay.node_action).toBe("verify");
    expect(replay.before).toEqual(cancelled);
    expect(replay.after).toEqual(cancelled);
    expect(replay.contains_links).toEqual([]);
    expect(replay.finalizer_link).toBeNull();

    const mismatch = { ...cancelled, state: "interrupted" as const };
    expectCode(() => projectExecutionUnits(input(events, [{ ...mismatch, terminal_reason: "user_cancelled" }])), "identity_conflict");
  });

  test("rejects terminal extension, overlap, source gaps, ownership conflicts, and malformed source", () => {
    const base = [user(0), call(1), result(2, eventUid(1)), turn(3, "final_reply")];
    const terminal = onlyPlan(base).after as ExecutionUnitSnapshot;
    const terminalExtension = { ...terminal, end_ingest_sequence: 4, event_count: 5, ordered_event_uids: [...terminal.ordered_event_uids, eventUid(4)], contains_roles: [...terminal.contains_roles, "member" as const] };
    expectCode(() => projectExecutionUnits(input([...base, assistant(4)], [terminalExtension])), "identity_conflict");
    expectCode(() => projectExecutionUnits(input(base, [{ ...terminal, ordered_event_uids: [eventUid(1), eventUid(2), eventUid(3), eventUid(0)] }])), "identity_conflict");
    expectCode(() => projectExecutionUnits(input([user(0), call(2)])), "source_incomplete");
    expectCode(() => projectExecutionUnits(input([{ ...user(0), project_uid: other_project_uid }, call(1)] as ExecutionSourceEvent[])), "identity_conflict");
    expectCode(() => projectExecutionUnits(input([{ ...user(0), fingerprint: "A".repeat(64) }, call(1)])), "invalid_input");
    expectCode(() => projectExecutionUnits(input([{ ...user(0), extra: true } as unknown as ExecutionSourceEvent, call(1)])), "invalid_input");
  });
});
