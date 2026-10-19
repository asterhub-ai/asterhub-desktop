import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { executionReviewUid } from "./execution-ids.ts";
import {
  EXECUTION_REVIEW_CANDIDATE_SOURCE_SCHEMA_ID,
  EXECUTION_REVIEW_EVIDENCE_SCHEMA_ID,
  EXECUTION_REVIEW_INPUT_PROJECTION_VERSION,
  EXECUTION_REVIEW_SCHEMA_ID,
  EXECUTION_REVIEW_TARGET_SCHEMA_ID,
  EXECUTION_REVIEW_VERSION,
  ExecutionReviewValidationError,
  type ExecutionReviewCandidateWorkflow,
  type ExecutionReviewEvidencePlan,
  type ExecutionReviewFacts,
  type ExecutionReviewFinding,
  type ExecutionReviewModelInput,
  type ExecutionReviewOutput,
  type ExecutionReviewPlan,
  type ExecutionReviewPractice,
  type ExecutionReviewSkipReason,
} from "./execution-review-types.ts";

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINDING_UID = /^f[1-9][0-9]*$/;
const PRACTICE_UID = /^p[1-9][0-9]*$/;
const HEX64 = /^[0-9a-f]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function fail(message: string): never {
  throw new ExecutionReviewValidationError(message);
}
function text(value: unknown, max: number, name: string): string {
  if (typeof value !== "string" || value.length > max) fail(`${name} is invalid.`);
  return value;
}
function uid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UID.test(value)) fail(`${name} is invalid.`);
  return value;
}
function evidence(value: unknown, allowed: ReadonlyMap<string, number>, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !allowed.has(item))) fail(`${name} is invalid.`);
  const seen = new Set<string>();
  let previous = -1;
  for (const item of value as string[]) {
    const position = allowed.get(item)!;
    if (seen.has(item) || position <= previous) fail(`${name} must be an ordered candidate subset.`);
    seen.add(item);
    previous = position;
  }
  return [...value] as string[];
}
function optionalEvidence(value: unknown, allowed: ReadonlyMap<string, number>, name: string): string[] | null {
  if (value === null) return null;
  return evidence(value, allowed, name);
}
function sameOrSubset(candidate: readonly string[], possible: readonly string[]): boolean {
  const allowed = new Set(possible);
  return candidate.every((item) => allowed.has(item));
}
function canonicalResponse(value: ExecutionReviewOutput): string {
  return canonicalize(value as never);
}
function responseFingerprint(value: ExecutionReviewOutput): string {
  return createHash("sha256").update(canonicalResponse(value), "utf8").digest("hex");
}

export function validateExecutionReviewOutput(
  value: unknown,
  candidateEvidence: readonly { event_uid: string; position: number }[] | ReadonlyMap<string, number>,
): ExecutionReviewOutput {
  const allowed: ReadonlyMap<string, number> = Array.isArray(candidateEvidence)
    ? new Map(candidateEvidence.map((item: { event_uid: string; position: number }) => [item.event_uid, item.position]))
    : candidateEvidence as ReadonlyMap<string, number>;
  if (!exact(value, ["outcome", "outcome_evidence_event_uids", "objective", "process_summary", "findings", "failure_analysis", "failure_analysis_evidence_event_uids", "reusable_practices", "decision"])) fail("Review output must contain exact top-level keys.");
  if (value.outcome !== "completed" && value.outcome !== "partial" && value.outcome !== "failed" && value.outcome !== "cancelled" && value.outcome !== "interrupted") fail("Review outcome is invalid.");
  const outcome_evidence_event_uids = evidence(value.outcome_evidence_event_uids, allowed, "Outcome evidence");
  const objective = text(value.objective, 1000, "Objective");
  const process_summary = text(value.process_summary, 2000, "Process summary");
  if (!Array.isArray(value.findings) || value.findings.length > 32) fail("Findings are invalid.");
  const findings: ExecutionReviewFinding[] = [];
  const findingIds = new Set<string>();
  for (const item of value.findings) {
    if (!exact(item, ["finding_uid", "kind", "statement", "evidence_event_uids"])) fail("Finding shape is invalid.");
    const finding_uid = item.finding_uid;
    if (typeof finding_uid !== "string" || !FINDING_UID.test(finding_uid) || findingIds.has(finding_uid)) fail("Finding UID is invalid.");
    findingIds.add(finding_uid);
    if (item.kind !== "observation" && item.kind !== "inference" && item.kind !== "practice") fail("Finding kind is invalid.");
    findings.push({ finding_uid, kind: item.kind, statement: text(item.statement, 1000, "Finding statement"), evidence_event_uids: evidence(item.evidence_event_uids, allowed, "Finding evidence") });
  }
  const failure_analysis = value.failure_analysis === null ? null : text(value.failure_analysis, 2000, "Failure analysis");
  const failure_analysis_evidence_event_uids = optionalEvidence(value.failure_analysis_evidence_event_uids, allowed, "Failure analysis evidence");
  if ((failure_analysis === null) !== (failure_analysis_evidence_event_uids === null)) fail("Failure analysis evidence must match failure_analysis.");
  if (failure_analysis !== null) {
    const supported = findings.filter((finding) => finding.kind === "observation" || finding.kind === "inference").some((finding) => sameOrSubset(failure_analysis_evidence_event_uids!, finding.evidence_event_uids));
    if (!supported) fail("Failure analysis evidence is unsupported.");
  }
  if (!Array.isArray(value.reusable_practices) || value.reusable_practices.length > 16) fail("Reusable practices are invalid.");
  const reusable_practices: ExecutionReviewPractice[] = [];
  const practiceIds = new Set<string>();
  const supportedPracticeEvidence = findings.filter((finding) => finding.kind === "observation" || finding.kind === "inference").flatMap((finding) => finding.evidence_event_uids);
  for (const item of value.reusable_practices) {
    if (!exact(item, ["practice_uid", "statement", "evidence_event_uids"])) fail("Practice shape is invalid.");
    const practice_uid = item.practice_uid;
    if (typeof practice_uid !== "string" || !PRACTICE_UID.test(practice_uid) || practiceIds.has(practice_uid)) fail("Practice UID is invalid.");
    practiceIds.add(practice_uid);
    const evidence_event_uids = evidence(item.evidence_event_uids, allowed, "Practice evidence");
    if (!sameOrSubset(evidence_event_uids, supportedPracticeEvidence)) fail("Practice evidence is unsupported.");
    reusable_practices.push({ practice_uid, statement: text(item.statement, 1000, "Practice statement"), evidence_event_uids });
  }
  if (!exact(value.decision, ["action", "skip_reason"])) fail("Decision shape is invalid.");
  const action = value.decision.action;
  const skip_reason = value.decision.skip_reason;
  if (action !== "reviewed" && action !== "skipped") fail("Decision action is invalid.");
  if (skip_reason !== null && skip_reason !== "no_reusable_content" && skip_reason !== "duplicate_low_value" && skip_reason !== "insufficient_interpretation") fail("Skip reason is invalid.");
  if (action === "reviewed" && skip_reason !== null) fail("Reviewed decision cannot contain skip_reason.");
  if (action === "skipped" && (skip_reason === null || findings.length !== 0 || reusable_practices.length !== 0 || failure_analysis !== null || failure_analysis_evidence_event_uids !== null)) fail("Skipped decision contains review content.");
  return {
    outcome: value.outcome,
    outcome_evidence_event_uids,
    objective,
    process_summary,
    findings,
    failure_analysis,
    failure_analysis_evidence_event_uids,
    reusable_practices,
    decision: { action, skip_reason },
  };
}

export function buildExecutionReviewPlan(input: {
  candidate: ExecutionReviewCandidateWorkflow;
  model_input: ExecutionReviewModelInput;
  prompt_contract_version: string;
  model_ref: string;
  response: unknown;
}): ExecutionReviewPlan {
  const evidence = new Map(input.model_input.events.map((event) => [event.event_uid, event.position]));
  const output = validateExecutionReviewOutput(input.response, evidence);
  const response_fingerprint = responseFingerprint(output);
  const review_uid = executionReviewUid(input.candidate.candidate_uid, input.prompt_contract_version, response_fingerprint);
  const facts: ExecutionReviewFacts = {
    review_uid,
    schema_id: EXECUTION_REVIEW_SCHEMA_ID,
    review_version: EXECUTION_REVIEW_VERSION,
    candidate_uid: input.candidate.candidate_uid,
    execution_uid: input.candidate.execution_uid,
    project_uid: input.candidate.project_uid,
    session_uid: input.candidate.session_uid,
    source_fingerprint: input.candidate.source_fingerprint,
    input_projection_version: EXECUTION_REVIEW_INPUT_PROJECTION_VERSION,
    input_fingerprint: input.model_input.input_fingerprint,
    prompt_contract_version: input.prompt_contract_version,
    model_ref: input.model_ref,
    response_fingerprint,
    outcome: output.outcome,
    outcome_evidence_event_uids_json: canonicalize(output.outcome_evidence_event_uids as never),
    objective: output.objective,
    process_summary: output.process_summary,
    findings_json: canonicalize(output.findings as never),
    failure_analysis: output.failure_analysis,
    failure_analysis_evidence_event_uids_json: output.failure_analysis_evidence_event_uids === null ? null : canonicalize(output.failure_analysis_evidence_event_uids as never),
    reusable_practices_json: canonicalize(output.reusable_practices as never),
  };
  const links: ExecutionReviewEvidencePlan[] = [];
  const add = (event_uids: readonly string[], evidence_subject_kind: ExecutionReviewEvidencePlan["evidence_subject_kind"], evidence_subject_uid: string) => {
    for (const event_uid of event_uids) links.push({ event_uid, position: evidence.get(event_uid)!, evidence_subject_kind, evidence_subject_uid, evidence_role: "support" });
  };
  add(output.outcome_evidence_event_uids, "outcome", "outcome");
  if (output.failure_analysis_evidence_event_uids !== null) add(output.failure_analysis_evidence_event_uids, "failure_analysis", "failure_analysis");
  for (const finding of output.findings) add(finding.evidence_event_uids, "finding", finding.finding_uid);
  for (const practice of output.reusable_practices) add(practice.evidence_event_uids, "practice", practice.practice_uid);
  return { facts, evidence_links: links, decision: output.decision.action, skip_reason: output.decision.skip_reason as ExecutionReviewSkipReason | null };
}
export const projectExecutionReview = buildExecutionReviewPlan;
export const validateExecutionReviewResponse = validateExecutionReviewOutput;

export { EXECUTION_REVIEW_CANDIDATE_SOURCE_SCHEMA_ID, EXECUTION_REVIEW_EVIDENCE_SCHEMA_ID, EXECUTION_REVIEW_TARGET_SCHEMA_ID };
