import { describe, expect, test } from "vitest";
import { encodeAutomaticReflectionModelInput, decodeAutomaticReflectionModelOutput } from "../src/automatic-reflection-wire.ts";
import { ReflectionModelContractError } from "../src/reflection-model-types.ts";
import { validateReflectionOutput } from "../src/reflection-projector.ts";
import type { AutomaticReflectionInput } from "../src/reflection-input-types.ts";

const CANDIDATE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANDIDATE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_A = "11111111-1111-4111-8111-111111111111";
const EVENT_B = "22222222-2222-4222-8222-222222222222";

function input(): AutomaticReflectionInput {
  const event = { event_uid: EVENT_A, position: 0, kind: "message" as const, role: "user", content: `UUID mention: ${EVENT_B}` };
  const digest = {
    candidate_uid: CANDIDATE_A, execution_uid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", project_uid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    session_uid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", source_fingerprint: "source", terminal: { state: "completed" as const, terminal_reason: "final_reply" as const, event_uid: EVENT_A, position: 0, captured_at: "2026-01-01T00:00:00Z" },
    initiator: { event_uid: EVENT_A, position: 0 as const, content: "start" }, events: [event], unsettled_tool_calls: [], content_omissions: [],
  };
  return Object.freeze({ reflection_kind: "daily", input_projection_version: "v1", input_fingerprint: "input-hash", scope_fingerprint: "scope-hash", selector: Object.freeze({ kind: "daily", project_uid: digest.project_uid, timezone: "Asia/Shanghai", period_key: "2026-01-01", start_at: "2025-12-31T16:00:00.000Z", end_at: "2026-01-01T16:00:00.000Z" }), task_digests: Object.freeze([Object.freeze(digest), Object.freeze({ ...digest, candidate_uid: CANDIDATE_B })] as const) });
}

const validOutput = () => ({ overview: { text: "summary", evidence: ["e2", "e1"] }, observations: [{ observation_uid: "o1", kind: "theme", text: "fact", evidence: ["e1", "e2"] }], open_questions: [{ question_uid: "q1", text: "question", evidence: ["e1"] }] });
const validationScope = [{ candidate_uid: CANDIDATE_A, event_uid: EVENT_A, candidate_order: 0, event_position: 0 }, { candidate_uid: CANDIDATE_B, event_uid: EVENT_A, candidate_order: 1, event_position: 0 }];

describe("automatic reflection wire codec", () => {
  test("uses unique ordered aliases and preserves source material", () => {
    const original = input();
    const { payload, evidenceReferences } = encodeAutomaticReflectionModelInput(original);
    expect(evidenceReferences.get("e1")).toEqual({ candidate_uid: CANDIDATE_A, event_uid: EVENT_A });
    expect(evidenceReferences.get("e2")).toEqual({ candidate_uid: CANDIDATE_B, event_uid: EVENT_A });
    const digests = payload.task_digests.map(({ events, ...digest }) => ({ ...digest, events: events.map(({ evidence_ref: _ref, ...event }) => event) }));
    const restored: AutomaticReflectionInput = { reflection_kind: payload.reflection_kind, input_projection_version: payload.source_input_projection_version, input_fingerprint: payload.source_input_fingerprint, scope_fingerprint: payload.source_scope_fingerprint, selector: payload.selector, task_digests: [digests[0]!, digests[1]!] };
    expect(restored).toEqual(original);
    expect(original.task_digests[0]!.events[0]).not.toHaveProperty("evidence_ref");
  });

  test("decodes holder aliases in order without deduplication", () => {
    const { evidenceReferences } = encodeAutomaticReflectionModelInput(input());
    const decoded = decodeAutomaticReflectionModelOutput(validOutput(), evidenceReferences);
    expect(decoded).toEqual({ overview: { text: "summary", evidence: [{ candidate_uid: CANDIDATE_B, event_uid: EVENT_A }, { candidate_uid: CANDIDATE_A, event_uid: EVENT_A }] }, observations: [{ observation_uid: "o1", kind: "theme", text: "fact", evidence: [{ candidate_uid: CANDIDATE_A, event_uid: EVENT_A }, { candidate_uid: CANDIDATE_B, event_uid: EVENT_A }] }], open_questions: [{ question_uid: "q1", text: "question", evidence: [{ candidate_uid: CANDIDATE_A, event_uid: EVENT_A }] }] });
    expect(decodeAutomaticReflectionModelOutput({ overview: { text: "x", evidence: ["e1", "e1"] }, observations: [], open_questions: [] }, evidenceReferences)).toEqual({ overview: { text: "x", evidence: [{ candidate_uid: CANDIDATE_A, event_uid: EVENT_A }, { candidate_uid: CANDIDATE_A, event_uid: EVENT_A }] }, observations: [], open_questions: [] });
  });

  test("rejects unknown, case-changed, zero, legacy object, and non-string evidence safely", () => {
    const { evidenceReferences } = encodeAutomaticReflectionModelInput(input());
    for (const bad of ["E1", "e0", EVENT_A, { candidate_uid: CANDIDATE_A, event_uid: EVENT_A }, 1]) {
      expect(() => decodeAutomaticReflectionModelOutput({ overview: { text: "x", evidence: [bad] } }, evidenceReferences)).toThrow(ReflectionModelContractError);
      try { decodeAutomaticReflectionModelOutput({ overview: { text: "x", evidence: [bad] } }, evidenceReferences); } catch (error) {
        expect((error as Error).message).not.toContain(EVENT_A);
      }
    }
  });

  test("leaves invalid roots and holders for the canonical validator", () => {
    const { evidenceReferences } = encodeAutomaticReflectionModelInput(input());
    const base = validOutput();
    const withExtra = decodeAutomaticReflectionModelOutput({ ...base, extra_root: true, observations: [{ ...base.observations[0], extra: true }] }, evidenceReferences);
    expect(withExtra).toHaveProperty("extra_root", true);
    expect(() => validateReflectionOutput(withExtra, validationScope)).toThrow();
    const duplicate = decodeAutomaticReflectionModelOutput({ overview: { text: "x", evidence: ["e1", "e1"] }, observations: [], open_questions: [] }, evidenceReferences);
    expect(() => validateReflectionOutput(duplicate, validationScope)).toThrow();
    const empty = decodeAutomaticReflectionModelOutput({ overview: { text: "x", evidence: [] }, observations: [], open_questions: [] }, evidenceReferences);
    expect(() => validateReflectionOutput(empty, validationScope)).toThrow();
  });
});
