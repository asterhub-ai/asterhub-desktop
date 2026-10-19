import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import {
  DAILY_REFLECTION_PROMPT_CONTRACT,
  MANUAL_REFLECTION_PROMPT_CONTRACT,
  MONTHLY_REFLECTION_PROMPT_CONTRACT,
  REFLECTION_CONTRACT_VERSION,
  REFLECTION_EVIDENCE_SCHEMA_ID,
  REFLECTION_INPUT_PROJECTION_VERSION,
  REFLECTION_SCHEMA_ID,
  REFLECTION_TARGET_SCHEMA_ID,
  REFLECTION_VERSION,
  WEEKLY_REFLECTION_PROMPT_CONTRACT,
  automaticReflectionSelector,
  buildAutomaticReflectionInput,
  buildAutomaticReflectionPlan,
  buildManualCandidateReflectionInput,
  buildManualReflectionPlan,
  reflectionUid,
  ReflectionPlanError,
} from "../src/index.ts";
import { projectAutomaticReflectionModelPlan } from "../src/reflection-plan-projector.ts";
import type { TaskDigest } from "../src/task-digest-types.ts";

const CANDIDATE_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_0 = "00000000-0000-4000-8000-000000000000";
const EVENT_1 = "11111111-1111-4111-8111-111111111111";
const EVENT_2 = "22222222-2222-4222-8222-222222222222";
const TOOL_RESULT_EVENT = "33333333-3333-4333-8333-333333333333";

function digest(overrides: Partial<TaskDigest> = {}): TaskDigest {
  return {
    candidate_uid: CANDIDATE_UID,
    execution_uid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    project_uid: PROJECT_UID,
    session_uid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    source_fingerprint: "source-fingerprint",
    terminal: {
      state: "completed",
      terminal_reason: "final_reply",
      event_uid: EVENT_2,
      position: 3,
      captured_at: "2026-01-01T00:00:00Z",
    },
    initiator: { event_uid: EVENT_0, position: 0, content: "start" },
    events: [
      { event_uid: EVENT_0, position: 0, kind: "message", role: "user", content: "start" },
      { event_uid: EVENT_1, position: 1, kind: "tool_call", role: "assistant", content: null, tool_name: "lookup" },
      { event_uid: TOOL_RESULT_EVENT, position: 2, kind: "tool_result", role: "tool", content: "ok", result_of_event_uid: EVENT_1 },
      { event_uid: EVENT_2, position: 3, kind: "turn_end", role: "assistant", content: "done" },
    ],
    unsettled_tool_calls: [],
    content_omissions: [],
    ...overrides,
  };
}

function response(overviewText = "overview") {
  return {
    overview: {
      text: overviewText,
      evidence: [
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0 },
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_2 },
      ],
    },
    observations: [
      {
        observation_uid: "o1",
        kind: "theme",
        text: "pattern",
        evidence: [{ candidate_uid: CANDIDATE_UID, event_uid: EVENT_1 }],
      },
    ],
    open_questions: [
      {
        question_uid: "q1",
        text: "next",
        evidence: [{ candidate_uid: CANDIDATE_UID, event_uid: EVENT_2 }],
      },
    ],
  };
}

function sourceInput() {

  return buildManualCandidateReflectionInput(digest());
}
const SECOND_CANDIDATE_UID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function automaticInput(kind: "daily" | "weekly" | "monthly") {
  const period_key = kind === "monthly" ? "2026-01" : kind === "weekly" ? "2025-12-29" : "2026-01-01";
  const selector = automaticReflectionSelector(PROJECT_UID, kind, period_key);
  const first = digest({
    terminal: { ...digest().terminal, captured_at: "2026-01-01T00:00:00Z" },
  });
  const second = digest({
    candidate_uid: SECOND_CANDIDATE_UID,
    terminal: { ...digest().terminal, captured_at: "2026-01-01T00:00:00+00:00" },
  });
  return buildAutomaticReflectionInput(selector, [second, first]);
}

function automaticResponse() {
  return {
    overview: {
      text: "overview",
      evidence: [
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0 },
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_2 },
        { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_0 },
        { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_2 },
      ],
    },
    observations: [{
      observation_uid: "o1",
      kind: "theme" as const,
      text: "pattern",
      evidence: [
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_1 },
        { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_1 },
      ],
    }],
    open_questions: [{
      question_uid: "q1",
      text: "next",
      evidence: [{ candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_2 }],
    }],
  };
}

function responseFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value as never), "utf8").digest("hex");
}

describe("buildManualReflectionPlan", () => {
  test("builds exact immutable facts, target, and evidence paths", () => {
    const model_input = sourceInput();
    const output = response();
    const plan = buildManualReflectionPlan({
      model_input,
      prompt_contract_version: "manual-reflection/v1",
      model_ref: "model-v1",
      response: output,
    });
    const expectedResponseFingerprint = responseFingerprint(output);

    expect(plan.facts).toEqual({
      reflection_uid: reflectionUid(
        "manual",
        model_input.scope_fingerprint,
        model_input.input_fingerprint,
        REFLECTION_CONTRACT_VERSION,
        expectedResponseFingerprint,
      ),
      schema_id: REFLECTION_SCHEMA_ID,
      reflection_version: REFLECTION_VERSION,
      kind: "manual",
      project_uid: PROJECT_UID,
      scope_json: canonicalize(model_input.selector as never),
      scope_fingerprint: model_input.scope_fingerprint,
      input_projection_version: REFLECTION_INPUT_PROJECTION_VERSION,
      input_fingerprint: model_input.input_fingerprint,
      reflection_contract_version: REFLECTION_CONTRACT_VERSION,
      prompt_contract_version: "manual-reflection/v1",
      model_ref: "model-v1",
      response_fingerprint: expectedResponseFingerprint,
      overview_json: canonicalize(plan.output.overview as never),
      observations_json: canonicalize(plan.output.observations as never),
      open_questions_json: canonicalize(plan.output.open_questions as never),
    });
    expect(Object.keys(plan.facts)).not.toContain("created_at");
    expect(plan.target_candidate_uids).toEqual([CANDIDATE_UID]);
    expect(plan.evidence_links).toEqual([
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0, candidate_position: 0, subject_path: "overview", evidence_index: 0 },
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_2, candidate_position: 3, subject_path: "overview", evidence_index: 1 },
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_1, candidate_position: 1, subject_path: "observations/o1", evidence_index: 0 },
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_2, candidate_position: 3, subject_path: "open_questions/q1", evidence_index: 0 },
    ]);
    expect(REFLECTION_TARGET_SCHEMA_ID).toBe("anima.reflection-target/v1.0");
    expect(REFLECTION_EVIDENCE_SCHEMA_ID).toBe("anima.reflection-evidence/v1.0");
  });

  test("is deterministic and returns independent copies", () => {
    const model_input = sourceInput();
    const responseValue = response();
    const inputBefore = JSON.stringify(model_input);
    const first = buildManualReflectionPlan({ model_input, prompt_contract_version: "manual-reflection/v1", model_ref: "model", response: responseValue });
    const second = buildManualReflectionPlan({ model_input, prompt_contract_version: "manual-reflection/v1", model_ref: "model", response: responseValue });

    expect(first).toEqual(second);
    expect(first.target_candidate_uids).not.toBe(model_input.task_digests);
    expect(first.evidence_links).not.toBe(second.evidence_links);
    expect(JSON.stringify(model_input)).toBe(inputBefore);
    (first.target_candidate_uids as string[])[0] = "changed";
    expect(model_input.selector.candidate_uid).toBe(CANDIDATE_UID);
  });

  test("changes response fingerprint and UID for a changed valid response", () => {
    const model_input = sourceInput();
    const first = buildManualReflectionPlan({ model_input, prompt_contract_version: "manual-reflection/v1", model_ref: "model", response: response() });
    const changed = buildManualReflectionPlan({ model_input, prompt_contract_version: "manual-reflection/v1", model_ref: "model", response: response("changed") });

    expect(changed.facts.response_fingerprint).not.toBe(first.facts.response_fingerprint);
    expect(changed.facts.reflection_uid).not.toBe(first.facts.reflection_uid);
  });

  test("rejects invalid response and tampered model input", () => {
    const model_input = sourceInput();
    expect(() => buildManualReflectionPlan({ model_input, prompt_contract_version: "manual-reflection/v1", model_ref: "model", response: { ...response(), overview: { ...response().overview, evidence: [] } } })).toThrow(ReflectionPlanError);
    expect(() => buildManualReflectionPlan({ model_input: { ...model_input, input_fingerprint: "f".repeat(64) }, prompt_contract_version: "manual-reflection/v1", model_ref: "model", response: response() })).toThrow(ReflectionPlanError);
  });

  test("rejects empty prompt contract and model references", () => {
    const model_input = sourceInput();
    expect(() => buildManualReflectionPlan({ model_input, prompt_contract_version: "", model_ref: "model", response: response() })).toThrow(ReflectionPlanError);
    expect(() => buildManualReflectionPlan({ model_input, prompt_contract_version: "manual-reflection/v1", model_ref: "", response: response() })).toThrow(ReflectionPlanError);
  });

  test("rejects automatic input through the manual compatibility wrapper", () => {
    expect(() => buildManualReflectionPlan({
      model_input: automaticInput("daily") as never,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: automaticResponse(),
    })).toThrow(ReflectionPlanError);
  });
});

describe("buildAutomaticReflectionPlan", () => {
  test("builds daily, weekly, and monthly plans with exact kind contracts", () => {
    const cases = [
      ["daily", DAILY_REFLECTION_PROMPT_CONTRACT],
      ["weekly", WEEKLY_REFLECTION_PROMPT_CONTRACT],
      ["monthly", MONTHLY_REFLECTION_PROMPT_CONTRACT],
    ] as const;
    for (const [kind, prompt_contract_version] of cases) {
      const model_input = automaticInput(kind);
      const plan = buildAutomaticReflectionPlan({
        model_input,
        prompt_contract_version,
        model_ref: "model-v1",
        response: automaticResponse(),
      });
      expect(plan.facts.kind).toBe(kind);
      expect(plan.facts.project_uid).toBe(PROJECT_UID);
      expect(plan.facts.prompt_contract_version).toBe(prompt_contract_version);
      expect(plan.target_candidate_uids).toEqual([CANDIDATE_UID, SECOND_CANDIDATE_UID]);
    }
  });

  test("uses source event positions for persistence evidence and validates model evidence order", () => {
    const model_input = automaticInput("daily");
    const plan = buildAutomaticReflectionPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: automaticResponse(),
    });
    expect(plan.evidence_links).toEqual([
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0, candidate_position: 0, subject_path: "overview", evidence_index: 0 },
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_2, candidate_position: 3, subject_path: "overview", evidence_index: 1 },
      { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_0, candidate_position: 0, subject_path: "overview", evidence_index: 2 },
      { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_2, candidate_position: 3, subject_path: "overview", evidence_index: 3 },
      { candidate_uid: CANDIDATE_UID, event_uid: EVENT_1, candidate_position: 1, subject_path: "observations/o1", evidence_index: 0 },
      { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_1, candidate_position: 1, subject_path: "observations/o1", evidence_index: 1 },
      { candidate_uid: SECOND_CANDIDATE_UID, event_uid: EVENT_2, candidate_position: 3, subject_path: "open_questions/q1", evidence_index: 0 },
    ]);

    const wrongPrompt = { ...automaticResponse(), overview: { ...automaticResponse().overview, evidence: [...automaticResponse().overview.evidence].reverse() } };
    expect(() => buildAutomaticReflectionPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: wrongPrompt,
    })).toThrow(ReflectionPlanError);
    expect(() => buildAutomaticReflectionPlan({
      model_input,
      prompt_contract_version: WEEKLY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: automaticResponse(),
    })).toThrow(ReflectionPlanError);
    expect(() => buildAutomaticReflectionPlan({
      model_input: {
        ...model_input,
        selector: { ...model_input.selector, period_key: "2026-01-02" },
      },
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: automaticResponse(),
    })).toThrow(ReflectionPlanError);
  });

  test("rejects manual input through the automatic compatibility wrapper", () => {
    const model_input = sourceInput();
    expect(() => buildAutomaticReflectionPlan({
      model_input: model_input as never,
      prompt_contract_version: MANUAL_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: response(),
    })).toThrow(ReflectionPlanError);
  });
});

describe("projectAutomaticReflectionModelPlan", () => {
  test("canonicalizes only producer evidence order using scope candidate and numeric event positions", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "daily", "2026-01-01");
    const events = Array.from({ length: 12 }, (_, position) => ({
      event_uid: `00000000-0000-4000-8000-${String(11 - position).padStart(12, "0")}`,
      position,
      kind: position === 11 ? "turn_end" as const : "message" as const,
      role: position === 0 ? "user" : "assistant",
      content: `event ${position}`,
    }));
    const earlierTerminal = digest({
      candidate_uid: SECOND_CANDIDATE_UID,
      terminal: { ...digest().terminal, event_uid: events[11]!.event_uid, position: 11, captured_at: "2026-01-01T01:00:00Z" },
      initiator: { event_uid: events[0]!.event_uid, position: 0, content: "start" },
      events,
    });
    const laterTerminal = digest({
      terminal: { ...digest().terminal, event_uid: events[11]!.event_uid, position: 11, captured_at: "2026-01-01T02:00:00Z" },
      initiator: { event_uid: events[0]!.event_uid, position: 0, content: "start" },
      events,
    });
    const model_input = buildAutomaticReflectionInput(selector, [laterTerminal, earlierTerminal]);
    expect(model_input.task_digests.map((item) => item.candidate_uid)).toEqual([SECOND_CANDIDATE_UID, CANDIDATE_UID]);

    const canonicalEvidence = model_input.task_digests.flatMap((item) =>
      item.events.map((event) => ({ candidate_uid: item.candidate_uid, event_uid: event.event_uid })),
    );
    const ordered = {
      overview: { text: "keep overview", evidence: canonicalEvidence },
      observations: [{ observation_uid: "o1", kind: "theme" as const, text: "keep observation", evidence: canonicalEvidence }],
      open_questions: [{ question_uid: "q1", text: "keep question", evidence: canonicalEvidence }],
    };
    const freezeDeep = (value: unknown): void => {
      if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) freezeDeep(child);
      }
    };
    const raw = {
      overview: { ...ordered.overview, evidence: [...canonicalEvidence].reverse() },
      observations: [{ ...ordered.observations[0]!, evidence: [...canonicalEvidence].reverse() }],
      open_questions: [{ ...ordered.open_questions[0]!, evidence: [...canonicalEvidence].reverse() }],
    };
    const rawBefore = JSON.stringify(raw);
    freezeDeep(raw);

    const expected = buildAutomaticReflectionPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: ordered,
    });
    const projected = projectAutomaticReflectionModelPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: raw,
    });
    expect(projected).toEqual(expected);
    expect(projected.facts.response_fingerprint).toBe(expected.facts.response_fingerprint);
    expect(projected.facts.reflection_uid).toBe(expected.facts.reflection_uid);
    expect(projected.output.overview.text).toBe("keep overview");
    expect(projected.output.observations[0]?.text).toBe("keep observation");
    expect(projected.output.open_questions[0]?.text).toBe("keep question");
    expect(projected.output.overview.evidence).toEqual(canonicalEvidence);
    expect(JSON.stringify(raw)).toBe(rawBefore);

    const canonicalAgain = projectAutomaticReflectionModelPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: ordered,
    });
    expect(canonicalAgain).toEqual(buildAutomaticReflectionPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: ordered,
    }));
  });

  test("preserves strict rejection for invalid or out-of-scope evidence and unknown keys", () => {
    const model_input = automaticInput("daily");
    const base = automaticResponse();
    const invoke = (responseValue: unknown) => projectAutomaticReflectionModelPlan({
      model_input,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: responseValue,
    });
    const reversed = () => ({
      ...base,
      overview: { ...base.overview, evidence: [...base.overview.evidence].reverse() },
    });
    const candidateOnlyEvent = "44444444-4444-4444-8444-444444444444";
    const mismatchedInput = buildAutomaticReflectionInput(model_input.selector, [
      digest(),
      digest({
        candidate_uid: SECOND_CANDIDATE_UID,
        terminal: { ...digest().terminal, event_uid: candidateOnlyEvent },
        events: digest().events.map((event) => event.event_uid === EVENT_2
          ? { ...event, event_uid: candidateOnlyEvent }
          : event),
      }),
    ]);
    expect(() => projectAutomaticReflectionModelPlan({
      model_input: mismatchedInput,
      prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
      model_ref: "model-v1",
      response: {
        ...base,
        overview: { ...base.overview, evidence: [
          { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0 },
          { candidate_uid: CANDIDATE_UID, event_uid: candidateOnlyEvent },
        ] },
      },
    })).toThrow(ReflectionPlanError);
    expect(() => invoke({ ...base, overview: { ...base.overview, evidence: [] } })).toThrow(ReflectionPlanError);
    expect(() => invoke({
      ...base,
      overview: { ...base.overview, evidence: [{ candidate_uid: "not-a-uuid", event_uid: EVENT_0 }] },
    })).toThrow(ReflectionPlanError);
    expect(() => invoke({
      ...base,
      overview: { ...base.overview, evidence: [
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0 },
        { candidate_uid: CANDIDATE_UID, event_uid: EVENT_0 },
      ] },
    })).toThrow(ReflectionPlanError);
    expect(() => invoke({ ...reversed(), unknown_root: true })).toThrow(ReflectionPlanError);
    expect(() => invoke({
      ...base,
      overview: { ...base.overview, unknown_holder: true, evidence: [...base.overview.evidence].reverse() },
    })).toThrow(ReflectionPlanError);
    expect(() => invoke({
      ...base,
      overview: { ...base.overview, evidence: [
        { ...base.overview.evidence[0]!, unknown_reference: true },
        ...base.overview.evidence.slice(1),
      ].reverse() },
    })).toThrow(ReflectionPlanError);
  });
});
