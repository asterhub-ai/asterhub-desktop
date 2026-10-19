import type { ExecutionSourceEvent, ExecutionUnitSnapshot, ExecutionRole, ExecutionTerminalReason } from "./execution-types.ts";

export const REVIEW_CONTRACT_VERSION = "v1" as const;
export const REVIEW_CANDIDATE_SCHEMA_ID = "anima.execution-review-candidate/v1.0" as const;
export const REVIEW_CANDIDATE_LINK_SCHEMA_ID = "anima.execution-review-candidate-link/v1.0" as const;
export const REVIEW_TARGET_SCHEMA_ID = "anima.execution-review-target/v1.0" as const;
export const REVIEW_EVIDENCE_SCHEMA_ID = "anima.execution-review-evidence/v1.0" as const;

export type ExecutionReviewCandidateState = "ready" | "leased" | "reviewed" | "skipped" | "rejected";

export interface ExecutionReviewCandidateSnapshot {
  candidate_uid: string;
  execution_uid: string;
  project_uid: string;
  session_uid: string;
  review_contract_version: typeof REVIEW_CONTRACT_VERSION;
  execution_state: "completed" | "cancelled" | "interrupted";
  terminal_reason: ExecutionTerminalReason;
  source_fingerprint: string;
  tool_call_count: number;
  tool_result_count: number;
  tool_error_count: number;
  state: ExecutionReviewCandidateState;
  /** Set by Neo4j only; excluded from pure projection equality. */
  created_at?: string;
  lease_owner?: string;
  lease_token?: string;
  lease_until?: string;
  leased_at?: string;
  reviewed_at?: string;
  skip_reason?: "no_reusable_content" | "duplicate_low_value" | "insufficient_interpretation";
  rejection_reason?: string;
}

export interface ExecutionReviewEvidenceLinkPlan {
  candidate_uid: string;
  event_uid: string;
  position: number;
  role: ExecutionRole;
}

export interface ExecutionReviewCandidatePlan {
  node_action: "create" | "verify";
  before?: ExecutionReviewCandidateSnapshot;
  after: ExecutionReviewCandidateSnapshot;
  has_review_candidate_link: {
    candidate_uid: string;
    execution_uid: string;
  } | null;
  reviews_link: {
    candidate_uid: string;
    execution_uid: string;
  } | null;
  evidence_links: readonly ExecutionReviewEvidenceLinkPlan[];
}

export interface ProjectExecutionReviewCandidatesInput {
  project_uid: string;
  session_uid: string;
  events: readonly ExecutionSourceEvent[];
  execution_units: readonly ExecutionUnitSnapshot[];
  existing_candidates: readonly ExecutionReviewCandidateSnapshot[];
}

export interface ProjectExecutionReviewCandidatesPlan {
  through_ingest_sequence: number;
  candidate_plans: readonly ExecutionReviewCandidatePlan[];
  candidates_created: number;
  evidence_links_created: number;
}

export type ExecutionReviewCandidateProjectorErrorCode = "invalid_input" | "source_incomplete" | "identity_conflict";

export class ExecutionReviewCandidateProjectorError extends Error {
  readonly code: ExecutionReviewCandidateProjectorErrorCode;
  constructor(code: ExecutionReviewCandidateProjectorErrorCode, message: string) {
    super(message);
    this.name = "ExecutionReviewCandidateProjectorError";
    this.code = code;
  }
}
