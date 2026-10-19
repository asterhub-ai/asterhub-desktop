import { describe, expect, test } from "vitest";
import {
  EPISODE_PROJECTOR_VERSION,
  EpisodeProjectorError,
  boundaryWindowUid,
  episodeDecisionUid,
  episodeUid,
  projectEpisode,
  sessionContinuationDecisionUid,
  type EpisodeBoundaryEvidenceFact,
  type EpisodeClosureFacts,
  type EpisodeContinuationFact,
  type EpisodeSnapshot,
  type EpisodeSuccessfulResultEvidenceFact,
  type EpisodeWindowFact,
  type ProjectEpisodeInput,
} from "../src/index.ts";

const project_uid = "11111111-1111-4111-8111-111111111111";
const session_a = "22222222-2222-4222-8222-222222222222";
const session_b = "33333333-3333-4333-8333-333333333333";
const session_c = "44444444-4444-4444-8444-444444444444";
const other_project_uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tool_call_uid = "55555555-5555-4555-8555-555555555555";
const result_uid = "66666666-6666-4666-8666-666666666666";
const checkpoint_uid = "77777777-7777-4777-8777-777777777777";
const validation_uid = "88888888-8888-4888-8888-888888888888";
const foreign_episode_uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function eventUid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}
function windowUid(session_uid: string, start: number): string {
  return boundaryWindowUid(project_uid, session_uid, start);
}
function expectCode(thunk: () => unknown, code: EpisodeProjectorError["code"]): void {
  try {
    thunk();
    throw new Error("expected projectEpisode to reject input");
  } catch (error) {
    expect(error).toBeInstanceOf(EpisodeProjectorError);
    expect((error as EpisodeProjectorError).code).toBe(code);
  }
}
function window(session_uid: string, start: number, end = start, terminal_boundary_type: EpisodeWindowFact["terminal_boundary_type"] = "compact", assigned_episode_uid: string | null = null): EpisodeWindowFact {
  return {
    window_uid: windowUid(session_uid, start), project_uid, session_uid,
    start_ingest_sequence: start, end_ingest_sequence: end, collection_state: "sealed",
    terminal_event_uid: terminal_boundary_type === "validation" ? validation_uid : eventUid(end), terminal_boundary_type, decision_status: "pending",
    projector_version: "anima.boundary-projector/v1", assigned_episode_uid,
  };
}
function boundary(session_uid: string, window_uid: string, ingest_sequence: number, boundary_type: "checkpoint" | "validation", event_uid = eventUid(ingest_sequence)): EpisodeBoundaryEvidenceFact {
  return { event_uid, project_uid, session_uid, window_uid, ingest_sequence, kind: "boundary", boundary_type };
}
function result(session_uid: string, window_uid: string, ingest_sequence: number, event_uid?: string, target?: string): EpisodeSuccessfulResultEvidenceFact;
function result(session_uid: string, window_uid: string, ingest_sequence: number, event_uid: string | undefined, target: string | undefined, outcome: "failed"): Omit<EpisodeSuccessfulResultEvidenceFact, "outcome"> & { outcome: "failed" };
function result(session_uid: string, window_uid: string, ingest_sequence: number, event_uid = result_uid, target = tool_call_uid, outcome: "success" | "failed" = "success"): EpisodeSuccessfulResultEvidenceFact | (Omit<EpisodeSuccessfulResultEvidenceFact, "outcome"> & { outcome: "failed" }) {
  return {
    event_uid, project_uid, session_uid, window_uid, ingest_sequence, kind: "tool_result" as const,
    outcome, tool_call_event_uid: target,
    tool_call_window_uid: window_uid, tool_call_ingest_sequence: ingest_sequence - 1,
  };
}
function continuation(current_session_uid: string, previous_session_uid: string, evidence_event_uid = checkpoint_uid): EpisodeContinuationFact {
  return {
    project_uid, current_session_uid, previous_session_uid,
    decision_uid: sessionContinuationDecisionUid(project_uid, current_session_uid, previous_session_uid, evidence_event_uid),
    schema_id: "anima.session-continuation/v1.0", method: "explicit_checkpoint", evidence_event_uid,
  };
}
function input(overrides: Partial<ProjectEpisodeInput> = {}): ProjectEpisodeInput {
  const w = window(session_a, 0, 2, "checkpoint");
  return { project_uid, episode_kind: "work", windows: [w], continuations: [], closure: { kind: "none" }, ...overrides };
}
function clone<T>(value: T): T { return structuredClone(value); }

const episode_vector = "b9959c61-a84c-5edc-9833-e51bf7313f4f";
const decision_vector = "9761f643-a600-57fd-a726-2c89c85dcb1a";

describe("R3B pure Episode contract", () => {
  test("uses fixed deterministic Episode and decision UUID vectors", () => {
    const first = windowUid(session_a, 0);
    expect(EPISODE_PROJECTOR_VERSION).toBe("anima.episode-projector/v1");
    expect(episodeUid(project_uid, first)).toBe(episode_vector);
    expect(episodeDecisionUid({
      episode_uid: episode_vector,
      episode_kind: "work",
      target_revision: 0,
      ordered_window_uids: [first],
      target_state: "open",
      closure_kind_or_null: null,
      checkpoint_event_uid_or_null: null,
      validation_result_event_uid_or_null: null,
      validation_event_uid_or_null: null,
    })).toBe(decision_vector);
    const base: Parameters<typeof episodeDecisionUid>[0] = {
      episode_uid: episode_vector,
      episode_kind: "work",
      target_revision: 0,
      ordered_window_uids: [first],
      target_state: "open",
      closure_kind_or_null: null,
      checkpoint_event_uid_or_null: null,
      validation_result_event_uid_or_null: null,
      validation_event_uid_or_null: null,
    };
    for (const parts of [
      { ...base, episode_kind: "personal" },
      { ...base, target_revision: 1 },
      { ...base, ordered_window_uids: [windowUid(session_a, 0), windowUid(session_a, 1)] },
      { ...base, target_state: "suspended" },
      { ...base, episode_kind: "personal", target_state: "stable_ended", closure_kind_or_null: "personal_explicit", checkpoint_event_uid_or_null: checkpoint_uid },
      { ...base, episode_kind: "personal", target_state: "stable_ended", closure_kind_or_null: "personal_explicit", checkpoint_event_uid_or_null: eventUid(99) },
      { ...base, target_state: "stable_ended", closure_kind_or_null: "work_validated", checkpoint_event_uid_or_null: checkpoint_uid, validation_result_event_uid_or_null: result_uid, validation_event_uid_or_null: validation_uid },
      { ...base, target_state: "stable_ended", closure_kind_or_null: "work_validated", checkpoint_event_uid_or_null: checkpoint_uid, validation_result_event_uid_or_null: result_uid, validation_event_uid_or_null: eventUid(99) },
    ] as const) {
      expect(episodeDecisionUid(parts)).not.toBe(decision_vector);
    }
    expect(episodeUid(project_uid, windowUid(session_a, 0))).not.toBe(episodeUid(other_project_uid, windowUid(session_a, 0)));
    expect(episodeUid(project_uid, windowUid(session_a, 0))).not.toBe(episodeUid(project_uid, windowUid(session_a, 1)));
    expect(() => episodeDecisionUid({ ...base, ordered_window_uids: [first, first] })).toThrow(TypeError);
    expect(() => episodeDecisionUid({ ...base, extra: true } as unknown as Parameters<typeof episodeDecisionUid>[0])).toThrow(TypeError);
    const missingField = { ...base } as Record<string, unknown>;
    delete missingField.validation_event_uid_or_null;
    expect(() => episodeDecisionUid(missingField as unknown as Parameters<typeof episodeDecisionUid>[0])).toThrow(TypeError);
    expect(() => episodeDecisionUid({
      ...base,
      episode_kind: "personal",
      target_state: "stable_ended",
      closure_kind_or_null: "work_validated",
      checkpoint_event_uid_or_null: checkpoint_uid,
      validation_result_event_uid_or_null: result_uid,
      validation_event_uid_or_null: validation_uid,
    })).toThrow(TypeError);
    expect(() => episodeDecisionUid({
      ...base,
      episode_kind: "work",
      target_state: "stable_ended",
      closure_kind_or_null: "personal_explicit",
      checkpoint_event_uid_or_null: checkpoint_uid,
    })).toThrow(TypeError);
  });

  test("runs structural invalid-input validation before source completeness", () => {
    const incompleteWindow = { ...window(session_a, 0, 0) } as Partial<EpisodeWindowFact>;
    delete incompleteWindow.terminal_event_uid;
    expectCode(() => projectEpisode(input({
      windows: [incompleteWindow as EpisodeWindowFact],
      closure: { kind: "none", summary: "forbidden" } as never,
    })), "invalid_input");
    const malformedLaterWindow = { ...window(session_a, 1, 1), terminal_boundary_type: "forbidden" } as unknown as EpisodeWindowFact;
    expectCode(() => projectEpisode(input({
      windows: [incompleteWindow as EpisodeWindowFact, malformedLaterWindow],
    })), "invalid_input");
    const malformedRangeWindow = { ...window(session_a, 1, 1), start_ingest_sequence: 2, end_ingest_sequence: 1 } as unknown as EpisodeWindowFact;
    expectCode(() => projectEpisode(input({
      windows: [incompleteWindow as EpisodeWindowFact, malformedRangeWindow],
    })), "invalid_input");
  });

  test("rejects exact-key, deep semantic, UUID, and nonnegative safe-integer violations", () => {
    const bads: unknown[] = [
      { ...input(), extra: true },
      { ...input(), windows: [{ ...input().windows[0], text: "forbidden" }] },
      { ...input(), windows: [{ ...input().windows[0], window_uid: "WINDOW" }] },
      { ...input(), windows: [{ ...input().windows[0], start_ingest_sequence: -1 }] },
      { ...input(), windows: [{ ...input().windows[0], end_ingest_sequence: Number.MAX_SAFE_INTEGER + 1 }] },
      { ...input(), windows: [{ ...input().windows[0], start_ingest_sequence: 0.5 }] },
      { ...input(), windows: [{ ...input().windows[0], assigned_episode_uid: "foreign" }] },
      { ...input(), continuations: [{ ...continuation(session_b, session_a), extra: "x" }] },
      { ...input(), closure: { kind: "none", summary: "forbidden" } },
    ];
    for (const bad of bads) expectCode(() => projectEpisode(bad as ProjectEpisodeInput), "invalid_input");
    expect(() => episodeUid("UPPER", windowUid(session_a, 0))).toThrow(TypeError);
    expect(() => episodeDecisionUid({
      episode_uid: episode_vector,
      episode_kind: "work",
      target_revision: -1,
      ordered_window_uids: [windowUid(session_a, 0)],
      target_state: "open",
      closure_kind_or_null: null,
      checkpoint_event_uid_or_null: null,
      validation_result_event_uid_or_null: null,
      validation_event_uid_or_null: null,
    })).toThrow(TypeError);
  });

  test("opens valid checkpoint and compact windows, and keeps shutdown suspended with exact evidence", () => {
    const checkpoint = projectEpisode(input({ windows: [window(session_a, 0, 0, "checkpoint")] }));
    expect(checkpoint.episode.after).toMatchObject({ state: "open", revision: 0, window_count: 1 });
    expect(checkpoint.episode.after).not.toHaveProperty("closure_kind");
    expect(checkpoint.episode.after).not.toHaveProperty("suspension_event_uid");
    const compact = projectEpisode(input({ windows: [window(session_a, 0, 0, "compact")] }));
    expect(compact.episode.after?.state).toBe("open");
    const shutdown = projectEpisode(input({ windows: [window(session_a, 0, 2, "shutdown")] }));
    expect(shutdown.episode.after).toMatchObject({ state: "suspended", suspension_event_uid: eventUid(2) });
    expect(shutdown.new_evidence_links).toEqual([{ episode_uid: episode_vector, event_uid: eventUid(2), role: "suspension", decision_uid: shutdown.decision_uid, decision_revision: 0 }]);
  });

  test("classifies a sealed Window missing terminal source evidence as source incomplete", () => {
    const incompleteWindow = { ...window(session_a, 0, 0) } as Partial<EpisodeWindowFact>;
    delete incompleteWindow.terminal_event_uid;
    expectCode(() => projectEpisode(input({ windows: [incompleteWindow as EpisodeWindowFact] })), "source_incomplete");
  });

  test("closes valid work with exact three evidence links and personal with one terminal checkpoint", () => {
    const w = window(session_a, 0, 3, "validation");
    const workClosure: EpisodeClosureFacts = { kind: "work_validated", checkpoint: boundary(session_a, w.window_uid, 0, "checkpoint", checkpoint_uid), validation_result: result(session_a, w.window_uid, 2), validation: boundary(session_a, w.window_uid, 3, "validation", validation_uid) };
    const work = projectEpisode(input({ windows: [w], closure: workClosure }));
    expect(work.episode.after).toMatchObject({ state: "stable_ended", closure_kind: "work_validated", checkpoint_event_uid: checkpoint_uid, validation_result_event_uid: result_uid, validation_event_uid: validation_uid });
    expect(work.new_evidence_links.map((x) => x.role)).toEqual(["checkpoint", "validation_result", "validation"]);
    const p = { ...window(session_a, 0, 3, "checkpoint"), terminal_event_uid: checkpoint_uid };
    const personal = projectEpisode(input({ episode_kind: "personal", windows: [p], closure: { kind: "personal_explicit", checkpoint: boundary(session_a, p.window_uid, 3, "checkpoint", checkpoint_uid) } }));
    expect(personal.episode.after).toMatchObject({ state: "stable_ended", closure_kind: "personal_explicit", checkpoint_event_uid: checkpoint_uid });
    expect(personal.new_evidence_links.map((x) => x.role)).toEqual(["checkpoint"]);
  });
  test("accepts a ToolCall in an earlier contiguous Window than the final validation Window", () => {
    const earlier = window(session_a, 0, 1);
    const final = window(session_a, 2, 3, "validation");
    const workClosure: EpisodeClosureFacts = {
      kind: "work_validated",
      checkpoint: boundary(session_a, earlier.window_uid, 0, "checkpoint", checkpoint_uid),
      validation_result: {
        ...result(session_a, final.window_uid, 2),
        tool_call_window_uid: earlier.window_uid,
        tool_call_ingest_sequence: 1,
      },
      validation: boundary(session_a, final.window_uid, 3, "validation", validation_uid),
    };
    const work = projectEpisode(input({ windows: [earlier, final], closure: workClosure }));
    expect(work.episode.after).toMatchObject({
      state: "stable_ended",
      closure_kind: "work_validated",
      checkpoint_event_uid: checkpoint_uid,
      validation_result_event_uid: result_uid,
      validation_event_uid: validation_uid,
    });
  });

  test("distinguishes invalid work evidence and source incompleteness", () => {
    const w = window(session_a, 0, 3, "validation");
    const valid = { kind: "work_validated" as const, checkpoint: boundary(session_a, w.window_uid, 0, "checkpoint", checkpoint_uid), validation_result: result(session_a, w.window_uid, 2), validation: boundary(session_a, w.window_uid, 3, "validation", validation_uid) };
    const cases: [EpisodeClosureFacts, EpisodeProjectorError["code"]][] = [
      [{ ...valid, checkpoint: boundary(session_a, w.window_uid, 0, "validation", checkpoint_uid) }, "evidence_invalid"],
      [{ ...valid, validation_result: { ...result(session_a, w.window_uid, 2, undefined, undefined, "failed") } } as unknown as EpisodeClosureFacts, "evidence_invalid"],
      [{ ...valid, validation_result: undefined as never }, "source_incomplete"],
      [{ ...valid, validation_result: { ...result(session_a, w.window_uid, 2), tool_call_event_uid: undefined as never } }, "source_incomplete"],
      [{ ...valid, validation_result: { ...result(session_a, w.window_uid, 1) }, validation: boundary(session_a, w.window_uid, 3, "validation", validation_uid) }, "evidence_invalid"],
      [{ ...valid, validation: boundary(session_a, w.window_uid, 1, "validation", validation_uid) }, "evidence_invalid"],
      [{ ...valid, validation_result: { ...result(session_a, w.window_uid, 2), tool_call_window_uid: windowUid(session_b, 0) } }, "evidence_invalid"],
      [{ ...valid, checkpoint: boundary(session_b, w.window_uid, 0, "checkpoint", checkpoint_uid) }, "evidence_invalid"],
    ];
    for (const [closure, code] of cases) expectCode(() => projectEpisode(input({ windows: [w], closure })), code);
  });

  test("enforces same-session ranges, exact continuation, and rejects session-chain anomalies", () => {
    expectCode(() => projectEpisode(input({ windows: [window(session_a, 0, 2), window(session_a, 4, 4)] })), "identity_conflict");
    const w1 = window(session_a, 0, 2, "shutdown");
    const w2 = window(session_b, 0, 1, "compact");
    expectCode(() => projectEpisode(input({ windows: [w1, w2] })), "source_incomplete");
    expectCode(() => projectEpisode(input({ windows: [w1, w2], continuations: [continuation(session_b, session_a), continuation(session_b, session_a)] })), "identity_conflict");
    expectCode(() => projectEpisode(input({ windows: [w1, w2], continuations: [continuation(session_a, session_b)] })), "identity_conflict");
    expectCode(() => projectEpisode(input({ windows: [w1, w2], continuations: [continuation(session_b, session_a), continuation(session_c, session_b)] })), "identity_conflict");
    const w3 = window(session_a, 2, 2);
    expectCode(() => projectEpisode(input({ windows: [w1, w2, w3], continuations: [continuation(session_b, session_a)] })), "identity_conflict");
  });

  test("requires a fresh continued session to resume suspension", () => {
    const first = projectEpisode(input({ windows: [window(session_a, 0, 1, "shutdown")] }));
    const suspended = first.episode.after!;
    expectCode(() => projectEpisode(input({ windows: [window(session_a, 0, 1, "shutdown"), window(session_a, 2)], existing_episode: suspended })), "invalid_transition");
    const next = window(session_b, 0, 1, "compact");
    const resumed = projectEpisode(input({ windows: [window(session_a, 0, 1, "shutdown"), next], continuations: [continuation(session_b, session_a)], existing_episode: suspended }));
    expect(resumed.episode.after).toMatchObject({ state: "open", revision: 1, window_count: 2 });
    expect(resumed.episode.after).not.toHaveProperty("suspension_event_uid");
    expect(resumed.episode.after?.decision_history).toHaveLength(2);
  });

  test("rejects exact replay of a forged same-session historical resume", () => {
    const suspendedWindow = window(session_a, 0, 1, "shutdown");
    const resumedWindow = window(session_a, 2, 2, "compact");
    const episode_uid = episodeUid(project_uid, suspendedWindow.window_uid);
    const suspendedDecision = episodeDecisionUid({
      episode_uid,
      episode_kind: "work",
      target_revision: 0,
      ordered_window_uids: [suspendedWindow.window_uid],
      target_state: "suspended",
      closure_kind_or_null: null,
      checkpoint_event_uid_or_null: null,
      validation_result_event_uid_or_null: null,
      validation_event_uid_or_null: null,
    });
    const resumedDecision = episodeDecisionUid({
      episode_uid,
      episode_kind: "work",
      target_revision: 1,
      ordered_window_uids: [suspendedWindow.window_uid, resumedWindow.window_uid],
      target_state: "open",
      closure_kind_or_null: null,
      checkpoint_event_uid_or_null: null,
      validation_result_event_uid_or_null: null,
      validation_event_uid_or_null: null,
    });
    const forged: EpisodeSnapshot = {
      episode_uid,
      project_uid,
      episode_kind: "work",
      first_window_uid: suspendedWindow.window_uid,
      last_window_uid: resumedWindow.window_uid,
      window_count: 2,
      revision: 1,
      state: "open",
      creation_decision_uid: suspendedDecision,
      last_decision_uid: resumedDecision,
      schema_id: "anima.episode/v1.0",
      projector_version: EPISODE_PROJECTOR_VERSION,
      assigned_window_uids: [suspendedWindow.window_uid, resumedWindow.window_uid],
      assigned_window_decision_uids: [suspendedDecision, resumedDecision],
      assigned_window_decision_revisions: [0, 1],
      decision_history: [
        {
          revision: 0,
          decision_uid: suspendedDecision,
          window_count: 1,
          state: "suspended",
          suspension_event_uid: suspendedWindow.terminal_event_uid,
        },
        {
          revision: 1,
          decision_uid: resumedDecision,
          window_count: 2,
          state: "open",
        },
      ],
    };
    expectCode(() => projectEpisode({
      ...input({ windows: [suspendedWindow, resumedWindow] }),
      existing_episode: forged,
    }), "identity_conflict");
  });

  test("produces exact snapshots, replay duplicates, stable immutability, and never mutates input", () => {
    const source = input({ windows: [window(session_a, 0, 0, "checkpoint")] });
    const before = clone(source);
    const plan = projectEpisode(source);
    expect(source).toEqual(before);
    expect(plan.episode.after).toEqual({
      episode_uid: episode_vector, project_uid, episode_kind: "work", first_window_uid: windowUid(session_a, 0), last_window_uid: windowUid(session_a, 0),
      window_count: 1, revision: 0, state: "open", creation_decision_uid: plan.decision_uid, last_decision_uid: plan.decision_uid,
      schema_id: "anima.episode/v1.0", projector_version: EPISODE_PROJECTOR_VERSION,
      assigned_window_uids: [windowUid(session_a, 0)], assigned_window_decision_uids: [plan.decision_uid], assigned_window_decision_revisions: [0],
      decision_history: [{ revision: 0, decision_uid: plan.decision_uid, window_count: 1, state: "open" }],
    });
    const replay = projectEpisode({ ...source, existing_episode: plan.episode.after });
    expect(replay.episode.action).toBe("verify");
    expect(replay.result).toMatchObject({ status: "duplicate", revision: 0, windows_assigned: 0, evidence_links_created: 0 });
    expectCode(() => projectEpisode({ ...source, existing_episode: { ...plan.episode.after!, state: "stable_ended", closure_kind: "personal_explicit" } as EpisodeSnapshot }), "identity_conflict");
  });

  test("rejects foreign assignments and provenance/forged historical snapshots", () => {
    expectCode(() => projectEpisode(input({ windows: [window(session_a, 0, 0, "compact", foreign_episode_uid)] })), "identity_conflict");
    const plan = projectEpisode(input({ windows: [window(session_a, 0, 0)] }));
    const snapshot = plan.episode.after!;
    expectCode(() => projectEpisode({ ...input(), existing_episode: { ...snapshot, creation_decision_uid: tool_call_uid } }), "identity_conflict");
    expectCode(() => projectEpisode({ ...input(), existing_episode: { ...snapshot, assigned_window_decision_uids: [foreign_episode_uid] } }), "identity_conflict");
    expectCode(() => projectEpisode({ ...input(), existing_episode: { ...snapshot, decision_history: [{ ...snapshot.decision_history[0], decision_uid: foreign_episode_uid }] } }), "identity_conflict");
    expectCode(() => projectEpisode({ ...input(), existing_episode: { ...snapshot, assigned_window_decision_revisions: [1] } }), "identity_conflict");
  });

  test("requires assignments and evidence to be introduced by their exact decision provenance", () => {
    const first = projectEpisode(input({ windows: [window(session_a, 0, 0)] }));
    const second_window = window(session_a, 1, 1);
    const updated = projectEpisode({ ...input({ windows: [window(session_a, 0, 0), second_window], existing_episode: first.episode.after }), existing_episode: first.episode.after });
    expect(updated.episode.after?.assigned_window_decision_uids).toEqual([first.decision_uid, updated.decision_uid]);
    expect(updated.episode.after?.assigned_window_decision_revisions).toEqual([0, 1]);
    expectCode(() => projectEpisode({ ...input({ windows: [window(session_a, 0, 0), second_window], existing_episode: { ...updated.episode.after!, assigned_window_decision_uids: [first.decision_uid, first.decision_uid] } }), existing_episode: { ...updated.episode.after!, assigned_window_decision_uids: [first.decision_uid, first.decision_uid] } }), "identity_conflict");
  });

  test("applies frozen error precedence", () => {
    const w = window(session_a, 0, 3, "validation");
    const w_next = window(session_b, 0, 0, "compact");
    const incomplete = input({ windows: [w, w_next], closure: { kind: "work_validated", checkpoint: boundary(session_a, w.window_uid, 0, "checkpoint", checkpoint_uid), validation_result: undefined as never, validation: boundary(session_a, w.window_uid, 3, "validation", validation_uid) } });
    expectCode(() => projectEpisode({ ...incomplete, unknown: true } as ProjectEpisodeInput), "invalid_input");
    expectCode(() => projectEpisode(incomplete), "source_incomplete");
    const evidenceInvalid = { ...incomplete, continuations: [continuation(session_b, session_a)], closure: { kind: "work_validated", checkpoint: boundary(session_a, w.window_uid, 0, "validation", checkpoint_uid), validation_result: result(session_a, w.window_uid, 2), validation: boundary(session_a, w.window_uid, 3, "validation", validation_uid) } as EpisodeClosureFacts };
    expectCode(() => projectEpisode({ ...evidenceInvalid, existing_episode: { ...projectEpisode(input()).episode.after!, episode_uid: foreign_episode_uid } }), "evidence_invalid");
    expectCode(() => projectEpisode({ ...evidenceInvalid, existing_episode: { ...projectEpisode(input()).episode.after!, episode_uid: foreign_episode_uid } }), "evidence_invalid");
    const corrupt = projectEpisode(input()).episode.after!;
    expectCode(() => projectEpisode({ ...input(), existing_episode: { ...corrupt, last_decision_uid: foreign_episode_uid } }), "identity_conflict");
    const ownershipConflict = window(session_a, 0, 3, "validation", foreign_episode_uid);
    const invalidClosureOnOwnershipConflict: EpisodeClosureFacts = {
      kind: "work_validated",
      checkpoint: boundary(session_a, ownershipConflict.window_uid, 0, "validation", checkpoint_uid),
      validation_result: result(session_a, ownershipConflict.window_uid, 2),
      validation: boundary(session_a, ownershipConflict.window_uid, 3, "validation", validation_uid),
    };
    expectCode(() => projectEpisode(input({ windows: [ownershipConflict], closure: invalidClosureOnOwnershipConflict })), "evidence_invalid");
    const ownershipConflictOnTransition = { ...window(session_b, 0, 0), project_uid: other_project_uid };
    expectCode(() => projectEpisode(input({ windows: [window(session_a, 0, 1, "shutdown"), ownershipConflictOnTransition] })), "source_incomplete");
  });

  test("preserves historical suspension evidence and enforces shutdown-prefix coherency", () => {
    const first = projectEpisode(input({ windows: [window(session_a, 0, 1, "shutdown")] }));
    const next = window(session_b, 0, 0, "compact");
    const resumed = projectEpisode({ ...input({ windows: [window(session_a, 0, 1, "shutdown"), next], continuations: [continuation(session_b, session_a)], existing_episode: first.episode.after }), existing_episode: first.episode.after });
    expect(resumed.episode.after).not.toHaveProperty("suspension_event_uid");
    expect(resumed.episode.after?.decision_history[0]).toMatchObject({ state: "suspended", suspension_event_uid: eventUid(1) });
    const forged = { ...first.episode.after!, last_decision_uid: episodeDecisionUid({
      episode_uid: first.episode.after!.episode_uid,
      episode_kind: "work",
      target_revision: 0,
      ordered_window_uids: [first.episode.after!.first_window_uid],
      target_state: "open",
      closure_kind_or_null: null,
      checkpoint_event_uid_or_null: null,
      validation_result_event_uid_or_null: null,
      validation_event_uid_or_null: null,
    }) };
    expectCode(() => projectEpisode({ ...input(), existing_episode: forged }), "identity_conflict");
  });

  test("rejects fabricated continuation identity, cycles, re-entry, and non-derived window identity", () => {
    const first = window(session_a, 0, 0, "shutdown");
    const second = window(session_b, 0, 0);
    expectCode(() => projectEpisode(input({ windows: [first, second], continuations: [{ ...continuation(session_b, session_a), decision_uid: eventUid(42) }] })), "identity_conflict");
    expectCode(() => projectEpisode(input({ windows: [first, second, window(session_a, 1, 1)], continuations: [continuation(session_b, session_a), continuation(session_a, session_b)] })), "identity_conflict");
    expectCode(() => projectEpisode(input({ windows: [{ ...first, window_uid: eventUid(0) }] })), "identity_conflict");
    expectCode(() => projectEpisode(input({ windows: [{ ...first, start_ingest_sequence: 2, end_ingest_sequence: 1 }] })), "invalid_input");
  });

  test("applies source/evidence/snapshot/transition precedence in order", () => {
    const w = window(session_a, 0, 2, "validation");
    const next = window(session_b, 0, 0);
    const suspended = projectEpisode(input({ windows: [w] })).episode.after!;
    const corrupt = { ...suspended, last_decision_uid: foreign_episode_uid };
    const invalidClosure: EpisodeClosureFacts = {
      kind: "work_validated",
      checkpoint: boundary(session_a, w.window_uid, 0, "validation", checkpoint_uid),
      validation_result: result(session_a, w.window_uid, 1),
      validation: boundary(session_a, w.window_uid, 2, "validation", validation_uid),
    };
    expectCode(() => projectEpisode({ ...input({ windows: [w, next], closure: { ...invalidClosure, validation_result: undefined as never }, existing_episode: corrupt }), existing_episode: corrupt }), "source_incomplete");
    expectCode(() => projectEpisode({ ...input({ windows: [w, next], closure: invalidClosure, existing_episode: corrupt }), continuations: [continuation(session_b, session_a)], existing_episode: corrupt }), "evidence_invalid");
    expectCode(() => projectEpisode({ ...input({ windows: [w, next], continuations: [continuation(session_b, session_a)], existing_episode: corrupt }), existing_episode: corrupt }), "identity_conflict");
    const stable = projectEpisode({ ...input({ windows: [window(session_a, 0, 3, "validation")], closure: { kind: "work_validated", checkpoint: boundary(session_a, windowUid(session_a, 0), 0, "checkpoint", checkpoint_uid), validation_result: result(session_a, windowUid(session_a, 0), 2), validation: boundary(session_a, windowUid(session_a, 0), 3, "validation", validation_uid) } }) }).episode.after!;
    expectCode(() => projectEpisode({ ...input({ windows: [window(session_a, 0, 3, "validation"), next], continuations: [continuation(session_b, session_a)], existing_episode: stable }), existing_episode: stable }), "invalid_transition");
  });

});
