import { describe, expect, test } from "vitest";
import {
  ReflectionValidationError,
  validateReflectionOutput,
} from "../src/index.ts";
import type {
  ReflectionEvidenceScopeEvent,
  ReflectionObservationKind,
} from "../src/index.ts";
type TestEvidence = { candidate_uid: string; event_uid: string };
type TestObservation = {
  observation_uid: string;
  kind: ReflectionObservationKind;
  text: string;
  evidence: TestEvidence[];
};
type TestQuestion = {
  question_uid: string;
  text: string;
  evidence: TestEvidence[];
};
type TestOutput = {
  overview: { text: string; evidence: TestEvidence[] };
  observations: TestObservation[];
  open_questions: TestQuestion[];
};


const CANDIDATE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANDIDATE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_A1 = "11111111-1111-4111-8111-111111111111";
const EVENT_A2 = "22222222-2222-4222-8222-222222222222";
const EVENT_B1 = "33333333-3333-4333-8333-333333333333";

const scope: readonly ReflectionEvidenceScopeEvent[] = [
  { candidate_uid: CANDIDATE_A, event_uid: EVENT_A1, candidate_order: 0, event_position: 0 },
  { candidate_uid: CANDIDATE_A, event_uid: EVENT_A2, candidate_order: 0, event_position: 2 },
  { candidate_uid: CANDIDATE_B, event_uid: EVENT_B1, candidate_order: 1, event_position: 1 },
];

function evidence(candidate_uid: string, event_uid: string) {
  return { candidate_uid, event_uid };
}

function validOutput(): TestOutput {
  return {
    overview: {
      text: "A multi-candidate overview",
      evidence: [evidence(CANDIDATE_A, EVENT_A1), evidence(CANDIDATE_B, EVENT_B1)],
    },
    observations: [
      {
        observation_uid: "o1",
        kind: "theme",
        text: "A recurring theme",
        evidence: [evidence(CANDIDATE_A, EVENT_A2)],
      },
    ],
    open_questions: [
      {
        question_uid: "q1",
        text: "What should be explored next?",
        evidence: [evidence(CANDIDATE_B, EVENT_B1)],
      },
    ],
  };
}

function rejects(value: unknown, inputScope = scope): void {
  expect(() => validateReflectionOutput(value, inputScope)).toThrow(ReflectionValidationError);
}

describe("validateReflectionOutput", () => {
  test("returns new objects and arrays for valid multi-candidate output", () => {
    const input = validOutput();
    const output = validateReflectionOutput(input, scope);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.overview).not.toBe(input.overview);
    expect(output.overview.evidence).not.toBe(input.overview.evidence);
    expect(output.observations).not.toBe(input.observations);
    expect(output.observations[0]).not.toBe(input.observations[0]);
    expect(output.observations[0]!.evidence).not.toBe(input.observations[0]!.evidence);
    expect(output.open_questions).not.toBe(input.open_questions);
  });

  test("rejects an extra top-level key", () => {
    rejects({ ...validOutput(), extra: true });
  });

  test("rejects an out-of-scope composite pair even when each UID exists", () => {
    const value = validOutput();
    value.overview.evidence = [evidence(CANDIDATE_A, EVENT_B1)];
    rejects(value);
  });

  test("rejects reversed evidence order", () => {
    const value = validOutput();
    value.overview.evidence = [evidence(CANDIDATE_B, EVENT_B1), evidence(CANDIDATE_A, EVENT_A1)];
    rejects(value);
  });

  test("rejects duplicate evidence", () => {
    const value = validOutput();
    value.overview.evidence = [evidence(CANDIDATE_A, EVENT_A1), evidence(CANDIDATE_A, EVENT_A1)];
    rejects(value);
  });

  test("rejects duplicate observation UID", () => {
    const value = validOutput();
    value.observations = [
      value.observations[0]!,
      { ...value.observations[0]!, text: "another observation" },
    ];
    rejects(value);
  });

  test("rejects an invalid observation kind", () => {
    const value = validOutput();
    rejects({
      ...value,
      observations: [{ ...value.observations[0]!, kind: "summary" }],
    });
  });

  test("rejects empty overview evidence", () => {
    const value = validOutput();
    value.overview.evidence = [];
    rejects(value);
  });

  test("rejects invalid and ambiguous scopes", () => {
    rejects(validOutput(), []);
    rejects(validOutput(), [
      { ...scope[0]!, candidate_uid: CANDIDATE_A.toUpperCase() },
    ]);
    rejects(validOutput(), [
      scope[0]!,
      { ...scope[1]!, candidate_order: 1 },
    ]);
    rejects(validOutput(), [
      scope[0]!,
      { ...scope[2]!, candidate_order: scope[0]!.candidate_order },
    ]);
  });
});
