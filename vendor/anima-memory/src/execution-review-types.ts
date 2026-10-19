import type { ExecutionReviewCandidateSnapshot, ExecutionReviewCandidateState } from "./execution-review-candidate-types.ts";

export const EXECUTION_REVIEW_VERSION = "v1" as const;
export const EXECUTION_REVIEW_SCHEMA_ID = "anima.execution-review/v1.0" as const;
export const EXECUTION_REVIEW_TARGET_SCHEMA_ID = "anima.execution-review-target/v1.0" as const;
export const EXECUTION_REVIEW_CANDIDATE_SOURCE_SCHEMA_ID = "anima.execution-review-candidate-source/v1.0" as const;
export const EXECUTION_REVIEW_EVIDENCE_SCHEMA_ID = "anima.execution-review-evidence/v1.0" as const;
export const EXECUTION_REVIEW_INPUT_PROJECTION_VERSION = "v1" as const;

export type ExecutionReviewOutcome = "completed" | "partial" | "failed" | "cancelled" | "interrupted";
export type ExecutionReviewFindingKind = "observation" | "inference" | "practice";
export type ExecutionReviewDecisionAction = "reviewed" | "skipped";
export type ExecutionReviewSkipReason = "no_reusable_content" | "duplicate_low_value" | "insufficient_interpretation";

export interface ExecutionReviewModelAdapter {
  review(input: ExecutionReviewModelInput): Promise<unknown>;
}

export interface ExecutionReviewModelEvent {
  event_uid: string;
  kind: string;
  position: number;
  role: string;
  outcome?: string;
  message_origin?: string | null;
  tool_name?: string;
  result_of_event_uid?: string | null;
  boundary_type?: string;
  turn_index?: number;
  turn_end_status?: string;
  content?: string;
  content_omitted?: boolean;
}

export interface ExecutionReviewModelInput {
  input_projection_version: typeof EXECUTION_REVIEW_INPUT_PROJECTION_VERSION;
  input_fingerprint: string;
  candidate_uid: string;
  execution_uid: string;
  project_uid: string;
  session_uid: string;
  review_contract_version: "v1";
  execution_state: "completed" | "cancelled" | "interrupted";
  terminal_reason: string;
  source_fingerprint: string;
  tool_call_count: number;
  tool_result_count: number;
  tool_error_count: number;
  events: readonly ExecutionReviewModelEvent[];
}

export interface ExecutionReviewFinding {
  finding_uid: string;
  kind: ExecutionReviewFindingKind;
  statement: string;
  evidence_event_uids: string[];
}

export interface ExecutionReviewPractice {
  practice_uid: string;
  statement: string;
  evidence_event_uids: string[];
}

export interface ExecutionReviewOutput {
  outcome: ExecutionReviewOutcome;
  outcome_evidence_event_uids: string[];
  objective: string;
  process_summary: string;
  findings: ExecutionReviewFinding[];
  failure_analysis: string | null;
  failure_analysis_evidence_event_uids: string[] | null;
  reusable_practices: ExecutionReviewPractice[];
  decision: {
    action: ExecutionReviewDecisionAction;
    skip_reason: ExecutionReviewSkipReason | null;
  };
}

export interface ExecutionReviewEvidencePlan {
  event_uid: string;
  position: number;
  evidence_subject_kind: "outcome" | "failure_analysis" | "finding" | "practice";
  evidence_subject_uid: "outcome" | "failure_analysis" | string;
  evidence_role: "support";
}

export interface ExecutionReviewFacts {
  review_uid: string;
  schema_id: typeof EXECUTION_REVIEW_SCHEMA_ID;
  review_version: typeof EXECUTION_REVIEW_VERSION;
  candidate_uid: string;
  execution_uid: string;
  project_uid: string;
  session_uid: string;
  source_fingerprint: string;
  input_projection_version: typeof EXECUTION_REVIEW_INPUT_PROJECTION_VERSION;
  input_fingerprint: string;
  prompt_contract_version: string;
  model_ref: string;
  response_fingerprint: string;
  outcome: ExecutionReviewOutcome;
  outcome_evidence_event_uids_json: string;
  objective: string;
  process_summary: string;
  findings_json: string;
  failure_analysis: string | null;
  failure_analysis_evidence_event_uids_json: string | null;
  reusable_practices_json: string;
}

export interface ExecutionReviewPlan {
  facts: ExecutionReviewFacts;
  evidence_links: readonly ExecutionReviewEvidencePlan[];
  decision: ExecutionReviewDecisionAction;
  skip_reason: ExecutionReviewSkipReason | null;
}

export type ExecutionReviewValidationErrorCode = "invalid_review";

export class ExecutionReviewValidationError extends Error {
  readonly code: ExecutionReviewValidationErrorCode = "invalid_review";
  constructor(message: string) {
    super(message);
    this.name = "ExecutionReviewValidationError";
  }
}

export interface ExecutionReviewCandidateWorkflow extends ExecutionReviewCandidateSnapshot {
  lease_owner?: string;
  lease_token?: string;
  lease_until?: string;
  leased_at?: string;
  reviewed_at?: string;
  skip_reason?: ExecutionReviewSkipReason;
  rejection_reason?: string;
}

export type ExecutionReviewOperationResult =
  | { status: "reviewed"; review_uid: string; candidate_uid: string }
  | { status: "skipped"; candidate_uid: string; skip_reason: string }
  | { status: "busy"; candidate_uid: string }
  | { status: "indeterminate"; candidate_uid: string; message: string }
  | {
      status: "failed";
      code: "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict" | "model_unavailable" | "model_failed" | "invalid_review" | "core_degraded" | "core_closed" | "database_error";
      message: string;
    };

export interface ReviewExecutionCandidateInput {
  candidate_uid: string;
  lease_owner: string;
  lease_ttl_ms: number;
  prompt_contract_version: string;
  model_ref: string;
}

export type ReviewCandidateSourceEvent = ExecutionReviewModelEvent & {
  properties: Record<string, unknown>;
};
