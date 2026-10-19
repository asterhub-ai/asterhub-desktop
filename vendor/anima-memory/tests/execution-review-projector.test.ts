import { describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { buildExecutionReviewModelInput, buildExecutionReviewPlan, validateExecutionReviewOutput } from "../src/index.ts";
import type { ExecutionReviewCandidateWorkflow, ReviewCandidateSourceEvent } from "../src/index.ts";

const candidate_uid = randomUUID();
const candidate: ExecutionReviewCandidateWorkflow = {
  candidate_uid,
  execution_uid: randomUUID(),
  project_uid: randomUUID(),
  session_uid: randomUUID(),
  review_contract_version: "v1",
  execution_state: "completed",
  terminal_reason: "final_reply",
  source_fingerprint: "a".repeat(64),
  tool_call_count: 1,
  tool_result_count: 1,
  tool_error_count: 0,
  state: "leased",
  lease_owner: "worker",
  lease_token: randomUUID(),
};
const events: ReviewCandidateSourceEvent[] = [
  {
    event_uid: randomUUID(),
    kind: "message",
    position: 0,
    role: "initiator",
    properties: { content_parts_json: JSON.stringify([{ type: "text", text: "password=hidden Bearer abc123" }]) },
  },
  {
    event_uid: randomUUID(),
    kind: "turn_end",
    position: 1,
    role: "terminal",
    properties: { content_parts_json: "[]" },
  },
];

function output(evidence_event_uids: string[]) {
  return {
    outcome: "completed",
    outcome_evidence_event_uids: evidence_event_uids,
    objective: "objective",
    process_summary: "summary",
    findings: [{ finding_uid: "f1", kind: "observation", statement: "observed", evidence_event_uids }],
    failure_analysis: null,
    failure_analysis_evidence_event_uids: null,
    reusable_practices: [{ practice_uid: "p1", statement: "practice", evidence_event_uids }],
    decision: { action: "reviewed", skip_reason: null },
  };
}

describe("ExecutionReview validator and projection", () => {
  test("redacts deterministic secrets and fingerprints the bounded projection", () => {
    const input = buildExecutionReviewModelInput(candidate, events);
    expect(input.events[0]?.content).toBe("[REDACTED] [REDACTED]");
    expect(input.input_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(buildExecutionReviewModelInput(candidate, events)).toEqual(input);
  });

  test("rejects evidence outside the candidate", () => {
    expect(() => validateExecutionReviewOutput(output([randomUUID()]), events)).toThrow();
  });

  test("plans an exact reviewed response with evidence facts", () => {
    const input = buildExecutionReviewModelInput(candidate, events);
    const response = output([events[0]!.event_uid]);
    const plan = buildExecutionReviewPlan({ candidate, model_input: input, prompt_contract_version: "prompt-v1", model_ref: "fake-v1", response });
    expect(plan.facts.review_uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.facts.response_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.evidence_links).toHaveLength(3);
    expect(plan.decision).toBe("reviewed");
  });

  test("skipped output cannot contain findings", () => {
    const input = buildExecutionReviewModelInput(candidate, events);
    const invalid = { ...output([events[0]!.event_uid]), decision: { action: "skipped", skip_reason: "no_reusable_content" } };
    expect(() => buildExecutionReviewPlan({ candidate, model_input: input, prompt_contract_version: "prompt-v1", model_ref: "fake-v1", response: invalid })).toThrow();
  });
});
