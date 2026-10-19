import { describe, expect, test } from "vitest";
import {
  BOUNDARY_PROJECTOR_VERSION,
  BoundaryProjectorError,
  boundaryCursorUid,
  boundaryWindowUid,
  projectBoundary,
  sessionContinuationDecisionUid,
  type BoundaryProjectorEvent,
  type BoundaryProjectorInput,
} from "../src/index.ts";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";

const project_uid = "11111111-1111-4111-8111-111111111111";
const session_uid = "22222222-2222-4222-8222-22222222222a";
const previous_session_uid = "33333333-3333-4333-8333-333333333333";
const checkpoint_event_uid = "44444444-4444-4444-8444-444444444444";
const other_project_uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other_session_uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function eventUid(ingest_sequence: number): string {
  return `00000000-0000-4000-8000-${ingest_sequence.toString(16).padStart(12, "0")}`;
}

type BoundaryEvent = Extract<BoundaryProjectorEvent, { kind: "boundary" }>;
type NonBoundaryEvent = Extract<BoundaryProjectorEvent, { kind: "message" | "tool_call" | "tool_result" | "turn_end" }>;

function event(ingest_sequence: number): NonBoundaryEvent;
function event(ingest_sequence: number, kind: NonBoundaryEvent["kind"]): NonBoundaryEvent;
function event(ingest_sequence: number, kind: "boundary", boundary_type: BoundaryEvent["boundary_type"]): BoundaryEvent;
function event(
  ingest_sequence: number,
  kind: BoundaryProjectorEvent["kind"] = "message",
  boundary_type?: BoundaryEvent["boundary_type"],
): BoundaryProjectorEvent {
  if (kind === "boundary") {
    if (boundary_type === undefined) {
      throw new TypeError("boundary events require boundary_type");
    }
    return {
      event_uid: eventUid(ingest_sequence),
      project_uid,
      session_uid,
      ingest_sequence,
      kind,
      boundary_type,
    };
  }
  return { event_uid: eventUid(ingest_sequence), project_uid, session_uid, ingest_sequence, kind };
}

function input(
  events: BoundaryProjectorEvent[],
  cursor: BoundaryProjectorInput["cursor"] = { last_ingest_sequence: -1 },
): BoundaryProjectorInput {
  return { cursor, project_uid, session_uid, events };
}

function expectInvalid(value: BoundaryProjectorInput, code: BoundaryProjectorError["code"]): void {
  try {
    projectBoundary(value);
    throw new Error("expected projector to reject input");
  } catch (error) {
    expect(error).toBeInstanceOf(BoundaryProjectorError);
    expect((error as BoundaryProjectorError).code).toBe(code);
    expect((error as Error).message).not.toMatch(/payload|secret|message body/i);
  }
}

describe("R3A pure boundary projector", () => {
  test("deterministic IDs are stable, namespaced, and change-sensitive", () => {
    expect(boundaryCursorUid(session_uid)).toBe(
      uuidV5FromParts(["anima.memory-cursor", "v1", BOUNDARY_PROJECTOR_VERSION, session_uid]),
    );
    expect(boundaryWindowUid(project_uid, session_uid, 0)).toBe(
      uuidV5FromParts(["anima.boundary-window", "v1", BOUNDARY_PROJECTOR_VERSION, project_uid, session_uid, 0]),
    );
    expect(sessionContinuationDecisionUid(project_uid, session_uid, previous_session_uid, checkpoint_event_uid)).toBe(
      uuidV5FromParts([
        "anima.session-continuation",
        "v1",
        project_uid,
        session_uid,
        previous_session_uid,
        checkpoint_event_uid,
      ]),
    );
    expect(boundaryCursorUid(session_uid)).toBe(boundaryCursorUid(session_uid));
    expect(boundaryWindowUid(project_uid, session_uid, 0)).toBe(boundaryWindowUid(project_uid, session_uid, 0));
    expect(sessionContinuationDecisionUid(project_uid, session_uid, previous_session_uid, checkpoint_event_uid)).toBe(
      sessionContinuationDecisionUid(project_uid, session_uid, previous_session_uid, checkpoint_event_uid),
    );
    expect(boundaryCursorUid(session_uid)).not.toBe(boundaryCursorUid(other_session_uid));
    expect(boundaryWindowUid(project_uid, session_uid, 0)).not.toBe(boundaryWindowUid(project_uid, session_uid, 1));
    expect(sessionContinuationDecisionUid(project_uid, session_uid, previous_session_uid, checkpoint_event_uid)).not.toBe(
      sessionContinuationDecisionUid(project_uid, session_uid, other_session_uid, checkpoint_event_uid),
    );
    expect(() => boundaryCursorUid(session_uid.toUpperCase())).toThrow(TypeError);
    expect(() => boundaryWindowUid(project_uid, "session-1", 0)).toThrow(TypeError);
    expect(() => sessionContinuationDecisionUid(project_uid, session_uid, "previous", checkpoint_event_uid)).toThrow(TypeError);
  });
  test("validates boundary-window start sequences as non-negative safe integers", () => {
    const accepted = [0, 1, Number.MAX_SAFE_INTEGER];
    for (const start_ingest_sequence of accepted) {
      const first = boundaryWindowUid(project_uid, session_uid, start_ingest_sequence);
      const second = boundaryWindowUid(project_uid, session_uid, start_ingest_sequence);
      expect(first).toBe(second);
    }

    const rejected = [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const start_ingest_sequence of rejected) {
      expect(() => boundaryWindowUid(project_uid, session_uid, start_ingest_sequence)).toThrow(TypeError);
    }
  });

  test("accepts each canonical event kind individually", () => {
    for (const kind of ["message", "tool_call", "tool_result"] as const) {
      const plan = projectBoundary(input([event(0, kind)]));
      expect(plan.events_assigned).toBe(1);
      expect(plan.event_assignments[0]).toMatchObject({
        event_uid: eventUid(0),
        window_uid: boundaryWindowUid(project_uid, session_uid, 0),
      });
    }

    const first = projectBoundary(input([event(0)]));
    const turn = projectBoundary(input([event(1, "turn_end")], first.next_cursor_state));
    expect(turn.events_assigned).toBe(1);
    expect(turn.windows_created).toBe(0);
    expect(turn.open_window_update).toMatchObject({
      before: { end_ingest_sequence: 0, collection_state: "open" },
      after: { end_ingest_sequence: 1, collection_state: "open" },
    });
    const boundaryPlan = projectBoundary(input([event(0, "boundary", "checkpoint")]));
    expect(boundaryPlan.window_creates[0]).toMatchObject({
      start_ingest_sequence: 0,
      end_ingest_sequence: 0,
      collection_state: "sealed",
      terminal_boundary_type: "checkpoint",
    });
  });

  test("rejects unsupported event kinds", () => {
    for (const kind of ["bogus", "Message", ""] as const) {
      expectInvalid(
        input([{ ...event(0), kind } as unknown as BoundaryProjectorEvent]),
        "invalid_input",
      );
    }
    expectInvalid(
      input([{ ...event(0), kind: 42 } as unknown as BoundaryProjectorEvent]),
      "invalid_input",
    );
  });


  test("opens the first window at sequence zero and assigns ordinary events", () => {
    const plan = projectBoundary(input([event(0), event(1), event(2)]));
    expect(plan).toMatchObject({
      from_ingest_sequence: 0,
      through_ingest_sequence: 2,
      events_assigned: 3,
      windows_created: 1,
      windows_updated: 0,
      next_cursor_state: {
        last_ingest_sequence: 2,
        open_window_uid: boundaryWindowUid(project_uid, session_uid, 0),
        open_window_start_sequence: 0,
      },
    });
    expect(plan.window_creates).toHaveLength(1);
    expect(plan.window_creates[0]).toMatchObject({
      window_uid: boundaryWindowUid(project_uid, session_uid, 0),
      project_uid,
      session_uid,
      start_ingest_sequence: 0,
      end_ingest_sequence: 2,
      projector_version: BOUNDARY_PROJECTOR_VERSION,
      collection_state: "open",
    });
    expect(plan.event_assignments.map((assignment) => assignment.event_uid)).toEqual([eventUid(0), eventUid(1), eventUid(2)]);
  });

  test("extends an existing open window across calls with one update", () => {
    const first = projectBoundary(input([event(0), event(1)]));
    const second = projectBoundary(
      input([event(2), event(3)], first.next_cursor_state),
    );
    expect(second.window_creates).toHaveLength(0);
    expect(second.open_window_update).toMatchObject({
      window_uid: boundaryWindowUid(project_uid, session_uid, 0),
      before: { end_ingest_sequence: 1, collection_state: "open" },
      after: { end_ingest_sequence: 3, collection_state: "open" },
    });
    expect(second.windows_updated).toBe(1);
    expect(second.events_assigned).toBe(2);
    expect(second.next_cursor_state).toEqual({
      last_ingest_sequence: 3,
      open_window_uid: boundaryWindowUid(project_uid, session_uid, 0),
      open_window_start_sequence: 0,
    });
  });

  test("seals the existing window with terminal pending state and restarts after boundary", () => {
    const first = projectBoundary(input([event(0), event(1)]));
    const sealed = projectBoundary(
      input([event(2, "boundary", "checkpoint")], first.next_cursor_state),
    );
    expect(sealed.window_creates).toHaveLength(0);
    expect(sealed.open_window_update).toMatchObject({
      before: { end_ingest_sequence: 1, collection_state: "open" },
      after: {
        end_ingest_sequence: 2,
        collection_state: "sealed",
        terminal_event_uid: eventUid(2),
        terminal_boundary_type: "checkpoint",
        decision_status: "pending",
      },
    });
    expect(sealed.windows_updated).toBe(1);
    const restarted = projectBoundary(input([event(3)], sealed.next_cursor_state));
    expect(restarted.window_creates).toHaveLength(1);
    expect(restarted.window_creates[0]).toMatchObject({ start_ingest_sequence: 3, end_ingest_sequence: 3, collection_state: "open" });
    expect(restarted.next_cursor_state.open_window_start_sequence).toBe(3);
  });

  test("consecutive boundary events create one sealed window per event", () => {
    const plan = projectBoundary(input([
      event(0, "boundary", "compact"),
      event(1, "boundary", "shutdown"),
      event(2, "boundary", "validation"),
    ]));
    expect(plan.window_creates).toHaveLength(3);
    expect(plan.windows_created).toBe(3);
    expect(plan.windows_updated).toBe(0);
    expect(plan.window_creates.map((window) => [window.start_ingest_sequence, window.end_ingest_sequence])).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(plan.window_creates.every((window) => window.collection_state === "sealed")).toBe(true);
    expect(plan.next_cursor_state).toEqual({ last_ingest_sequence: 2 });
  });

  test("all canonical boundary types seal pending and carry no semantic fields", () => {
    const types = ["checkpoint", "compact", "shutdown", "validation", "unknown"] as const;
    for (const boundary_type of types) {
      const plan = projectBoundary(input([event(0, "boundary", boundary_type)]));
      expect(plan.window_creates[0]).toMatchObject({ collection_state: "sealed", terminal_boundary_type: boundary_type, decision_status: "pending" });
      expect(plan.window_creates[0]).not.toHaveProperty("episode_uid");
      expect(plan.window_creates[0]).not.toHaveProperty("signal_strength");
      expect(plan.window_creates[0]).not.toHaveProperty("continuation");
    }
  });

  test("empty input returns a no-op plan and leaves cursor unchanged", () => {
    const cursor = { last_ingest_sequence: 4, open_window_uid: boundaryWindowUid(project_uid, session_uid, 2), open_window_start_sequence: 2 };
    const plan = projectBoundary(input([], cursor));
    expect(plan).toEqual({
      window_creates: [],
      event_assignments: [],
      next_cursor_state: cursor,
      from_ingest_sequence: 5,
      through_ingest_sequence: 4,
      events_assigned: 0,
      windows_created: 0,
      windows_updated: 0,
    });
  });

  test("rejects invalid ordering, provenance, boundary records, and cursor state up front", () => {
    expectInvalid(input([event(1)]), "source_incomplete");
    expectInvalid(input([event(0), event(0)]), "source_incomplete");
    expectInvalid(input([{ ...event(0), ingest_sequence: 0.5 }]), "source_incomplete");
    expectInvalid(input([event(0), { ...event(1), project_uid: other_project_uid }]), "identity_conflict");
    expectInvalid(input([{ ...event(0), session_uid: other_session_uid }]), "identity_conflict");
    expectInvalid(input([{ ...event(0), kind: "boundary" } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([{ ...event(0), kind: "message", boundary_type: "checkpoint" } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([], { last_ingest_sequence: -1, open_window_uid: boundaryWindowUid(project_uid, session_uid, 0), open_window_start_sequence: 0 }), "invalid_input");
    expectInvalid(input([], { last_ingest_sequence: 2, open_window_uid: boundaryWindowUid(project_uid, session_uid, 0) } as BoundaryProjectorInput["cursor"]), "invalid_input");
    expectInvalid(input([], { last_ingest_sequence: 1, open_window_uid: boundaryWindowUid(other_project_uid, session_uid, 0), open_window_start_sequence: 0 }), "identity_conflict");
    expectInvalid({ ...input([]), project_uid: "project-1" } as BoundaryProjectorInput, "invalid_input");
    expectInvalid({ ...input([]), session_uid: session_uid.toUpperCase() } as BoundaryProjectorInput, "invalid_input");
    expectInvalid(
      input([{ ...event(0), event_uid: "event-0" } as unknown as BoundaryProjectorEvent]),
      "invalid_input",
    );
    expectInvalid(
      input([], {
        last_ingest_sequence: 0,
        open_window_uid: "window-0",
        open_window_start_sequence: 0,
      }),
      "invalid_input",
    );
  });

  test("rejects each unsupported payload, provenance, runtime, cursor, and input field", () => {
    expectInvalid(input([{ ...event(0), payload: "secret" } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([{ ...event(0), content_parts: [{ text: "secret" }] } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([{ ...event(0), native_payload: { secret: true } } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([{ ...event(0), role: "invalid" } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([{ ...event(0), tool_name: "x" } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(input([{ ...event(0), source: { provider: "test" } } as unknown as BoundaryProjectorEvent]), "invalid_input");
    expectInvalid(
      {
        ...input([]),
        cursor: { last_ingest_sequence: -1, runtime_identity: "secret" },
      } as BoundaryProjectorInput,
      "invalid_input",
    );
    expectInvalid(
      {
        ...input([]),
        cursor: { last_ingest_sequence: -1, unsupported_cursor: true },
      } as BoundaryProjectorInput,
      "invalid_input",
    );
    expectInvalid({ ...input([]), high_water: 0 } as BoundaryProjectorInput, "invalid_input");
  });
});
