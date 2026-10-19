import type { MaterializeEpisodeInput, MaterializeEpisodeResult } from "./episode-types.ts";
import type { ExecutionReviewModelAdapter, ExecutionReviewOperationResult, ReviewExecutionCandidateInput } from "./execution-review-types.ts";
import type { ReflectionModelAdapter } from "./reflection-model-types.ts";
import type { TaskDigest } from "./task-digest-types.ts";
import type { RunDueAutomaticReflectionsInput, RunDueAutomaticReflectionsResult } from "./automatic-reflection-types.ts";
import type { ProjectOwnershipScope } from "./project-ownership.ts";

export type GetTaskDigestInput = {
  candidate_uid: string;
};

export type GetTaskDigestResult =
  | { status: "found"; digest: TaskDigest }
  | {
      status: "failed";
      code: "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict" | "core_degraded" | "core_closed" | "database_error";
      message: string;
    };

export type MaterializeExecutionUnitsInput = {
  project_uid: string;
  session_uid: string;
};

export type MaterializeExecutionUnitsResult =
  | {
      status: "materialized";
      project_uid: string;
      session_uid: string;
      through_ingest_sequence: number;
      execution_units_created: number;
      execution_units_updated: number;
      event_links_created: number;
    }
  | {
      status: "up_to_date";
      project_uid: string;
      session_uid: string;
      through_ingest_sequence: number;
    }
  | {
      status: "indeterminate";
      project_uid: string;
      session_uid: string;
      message: string;
    }
  | {
      status: "failed";
      code: "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict" | "core_degraded" | "core_closed" | "database_error";
      message: string;
    };

export type MaterializeExecutionReviewCandidatesInput = {
  project_uid: string;
  session_uid: string;
};

export type MaterializeExecutionReviewCandidatesResult =
  | {
      status: "materialized";
      project_uid: string;
      session_uid: string;
      through_ingest_sequence: number;
      candidates_created: number;
      evidence_links_created: number;
    }
  | {
      status: "up_to_date";
      project_uid: string;
      session_uid: string;
      through_ingest_sequence: number;
    }
  | {
      status: "indeterminate";
      project_uid: string;
      session_uid: string;
      message: string;
    }
  | {
      status: "failed";
      code: "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict" | "core_degraded" | "core_closed" | "database_error";
      message: string;
    };

export type { ExecutionReviewModelAdapter, ExecutionReviewOperationResult, ReviewExecutionCandidateInput, ReflectionModelAdapter };
export interface ReflectManualCandidateInput {
  candidate_uid: string;
  model_ref: string;
  prompt_contract_version: "manual-reflection/v1";
  max_input_bytes: number;
  /** Trusted Project Marker fingerprint rechecked after the model response, before graph mutation. */
  authorize_before_write?: () => Promise<string | undefined>;
}

export type ReflectManualCandidateResult =
  | { status: "materialized" | "up_to_date"; candidate_uid: string; reflection_uid: string }
  | { status: "indeterminate"; candidate_uid: string; message: string }
  | {
      status: "failed";
      code:
        | "invalid_input"
        | "not_found"
        | "source_incomplete"
        | "identity_conflict"
        | "input_too_large"
        | "model_unavailable"
        | "model_failed"
        | "invalid_reflection"
        | "database_error";
      message: string;
    }
  | {
      status: "failed";
      candidate_uid: string;
      code: "core_degraded" | "core_closed";
      message: string;
    };


export type MemoryCoreState = "starting" | "ready" | "degraded" | "closed";


export interface MemoryCoreHealth {
  state: MemoryCoreState;
  database: string | null;
  constraints: readonly string[];
  message:
    | "Memory core is starting."
    | "Memory core is ready."
    | "Memory core is degraded."
    | "Memory core is closed.";
}

export interface ProcessSessionInput {
  project_uid: string;
  session_uid: string;
}

export type ProcessSessionResult =
  | {
      status: "processed";
      project_uid: string;
      session_uid: string;
      from_ingest_sequence: number;
      through_ingest_sequence: number;
      events_assigned: number;
      windows_created: number;
      windows_updated: number;
    }
  | {
      status: "up_to_date";
      project_uid: string;
      session_uid: string;
      through_ingest_sequence: number;
    }
  | {
      status: "indeterminate";
      project_uid: string;
      session_uid: string;
      message: string;
    }
  | {
      status: "failed";
      code:
        | "invalid_input"
        | "not_found"
        | "source_incomplete"
        | "identity_conflict"
        | "core_degraded"
        | "core_closed"
        | "database_error";
      message: string;
    };

export interface CreateExactSpanModelMemoryInput {
  project_uid: string;
  session_uid: string;
  event_uid: string;
  span: {
    text_part_index: number;
    utf8_start: number;
    utf8_end: number;
    sha256: string;
  };
  statement: string;
  decision_uid: string;
  now: string;
  /** Reauthorize the evidence-backed write immediately before graph mutation. */
  authorize_before_write?: () => Promise<boolean>;
}

export type CreateExactSpanModelMemoryResult =
  | { status: "written" | "duplicate"; decision_uid: string; memory_uid: string; revision_uid: string }
  | { status: "indeterminate"; decision_uid: string; message: string }
  | {
      status: "failed";
      code:
        | "invalid_input"
        | "identity_conflict"
        | "source_incomplete"
        | "evidence_invalid"
        | "revision_conflict"
        | "confirmation_required"
        | "core_degraded"
        | "core_closed"
        | "database_error";
      message: string;
    };

export interface CreateToolSaveMemoryInput {
  project_uid: string;
  session_uid: string;
  event_uid: string;
  tool_call_id: string;
  params: unknown;
  decision_uid: string;
  now: string;
  authorize_before_write?: () => Promise<boolean>;
}

export type CreateToolSaveMemoryResult =
  | { status: "written" | "duplicate"; decision_uid: string; memory_uid: string; revision_uid: string }
  | { status: "indeterminate"; decision_uid: string; message: string }
  | {
      status: "failed";
      code:
        | "invalid_input"
        | "identity_conflict"
        | "source_incomplete"
        | "evidence_invalid"
        | "revision_conflict"
        | "confirmation_required"
        | "core_degraded"
        | "core_closed"
        | "database_error";
      message: string;
    };

export interface SearchProjectMemoriesInput {
  project_uid: string;
  query: string;
  top_k: number;
  now: string;
}

export interface ListRecentProjectMemoriesInput {
  project_uid: string;
  limit: number;
  now: string;
}

export type ListRecentProjectMemoriesResult =
  | { status: "completed"; results: ProjectMemorySearchResult[]; count: number }
  | Extract<SearchProjectMemoriesResult, { status: "failed" }>;

export interface ProjectMemorySearchResult {
  id: string;
  /** Revision identity used for compare-and-swap memory edits. */
  revision_uid?: string;
  type: string;
  title: string;
  narrative: string;
  context: string;
  principle: string;
  tags: string[];
  created_at: string;
  epistemic_kind: "hypothesis";
  provenance: "model_authored" | "tool_invocation" | "user_operation";
  applicability: { kind: "project"; project_uid: string };
}

export type SearchProjectMemoriesResult =
  | { status: "completed"; query: string; results: ProjectMemorySearchResult[]; count: number }
  | {
      status: "failed";
      code: "invalid_input" | "identity_conflict" | "source_incomplete" | "evidence_invalid" | "core_degraded" | "core_closed" | "database_error";
      message: string;
    };
export interface ListProjectReflectionsInput {
  project_uid: string;
  limit: number;
  now: string;
}

export interface ProjectReflectionSummary {
  reflection_uid: string;
  kind: "manual" | "daily" | "weekly" | "monthly";
  created_at: string;
  overview: string;
}

export type ListProjectReflectionsResult =
  | { status: "completed"; items: ProjectReflectionSummary[]; count: number }
  | { status: "failed"; code: "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict" | "core_degraded" | "core_closed" | "database_error"; message: string };
export interface ListSessionReviewCandidatesInput {
  project_uid: string;
  session_uid: string;
  limit: number;
}

export type ListSessionReviewCandidatesResult =
  | { status: "completed"; candidates: Array<{ candidate_uid: string; execution_uid: string; created_at: string }>; count: number }
  | { status: "failed"; code: "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict" | "core_degraded" | "core_closed" | "database_error"; message: string };
export interface MemoryOperationInput {
  project_uid: string;
  session_uid: string;
  operation_event_uid: string;
  tool_call_id: string;
  user_event_uid: string;
  user_span: { text_part_index: number; utf8_start: number; utf8_end: number; sha256: string };
  memory_uid: string;
  expected_revision_uid: string;
  action: "revise" | "revoke" | "set_expiry" | "suspend" | "resume";
  statement?: string;
  valid_until?: string;
  decision_uid: string;
  authorize_before_write?: () => Promise<boolean>;
  now: string;
}

export type MemoryOperationResult =
  | { status: "written" | "duplicate"; decision_uid: string; memory_uid: string; revision_uid: string }
  | { status: "indeterminate"; decision_uid: string; message: string }
  | { status: "failed"; code: "invalid_input" | "identity_conflict" | "source_incomplete" | "evidence_invalid" | "revision_conflict" | "confirmation_required" | "core_degraded" | "core_closed" | "database_error"; message: string };



export interface RecordSessionContinuationInput {
  project_uid: string;
  session_uid: string;
  previous_session_uid: string;
  checkpoint_event_uid: string;
}

export type RecordSessionContinuationResult =
  | { status: "written" | "duplicate"; decision_uid: string }
  | { status: "indeterminate"; decision_uid: string; message: string }
  | {
      status: "failed";
      code:
        | "invalid_input"
        | "not_found"
        | "source_incomplete"
        | "evidence_invalid"
        | "identity_conflict"
        | "core_degraded"
        | "core_closed"
        | "database_error";
      message: string;
    };

export type MemoryStoreHealth =
  | {
      status: "connected";
      database: string;
      constraints: readonly string[];
    }
  | {
      status: "disabled" | "error" | "closed";
      database: null;
      constraints: readonly [];
    };

export interface MemoryStore {
  initialize(): Promise<MemoryStoreHealth>;
  processSession(input: ProcessSessionInput): Promise<ProcessSessionResult>;
  recordSessionContinuation(input: RecordSessionContinuationInput): Promise<RecordSessionContinuationResult>;
  materializeEpisode(input: MaterializeEpisodeInput): Promise<MaterializeEpisodeResult>;
  getTaskDigest(input: GetTaskDigestInput): Promise<GetTaskDigestResult>;
  materializeExecutionUnits(input: MaterializeExecutionUnitsInput): Promise<MaterializeExecutionUnitsResult>;
  materializeExecutionReviewCandidates(input: MaterializeExecutionReviewCandidatesInput): Promise<MaterializeExecutionReviewCandidatesResult>;
  reviewExecutionCandidate?(input: ReviewExecutionCandidateInput): Promise<ExecutionReviewOperationResult>;
  reflectManualCandidate?(input: ReflectManualCandidateInput): Promise<ReflectManualCandidateResult>;
  createExactSpanModelMemoryRevision?(input: CreateExactSpanModelMemoryInput): Promise<CreateExactSpanModelMemoryResult>;
  applyMemoryOperation?(input: MemoryOperationInput): Promise<MemoryOperationResult>;
  createToolSaveMemoryRevision?(input: CreateToolSaveMemoryInput): Promise<CreateToolSaveMemoryResult>;
  searchProjectMemories?(input: SearchProjectMemoriesInput): Promise<SearchProjectMemoriesResult>;
  listRecentProjectMemories?(input: ListRecentProjectMemoriesInput): Promise<ListRecentProjectMemoriesResult>;
  listProjectReflections?(input: ListProjectReflectionsInput): Promise<ListProjectReflectionsResult>;
  listSessionReviewCandidates?(input: ListSessionReviewCandidatesInput): Promise<ListSessionReviewCandidatesResult>;
  runDueAutomaticReflections?(input: RunDueAutomaticReflectionsInput): Promise<RunDueAutomaticReflectionsResult>;
  close(timeout_ms: number): Promise<void>;
}

export interface AutomaticReflectionOptions {
  max_input_bytes: number;
}

export type MemoryCoreOptions =
  | {
      configPath?: string;
      shutdown_timeout_ms?: number;
      store?: never;
      projectOwnership?: ProjectOwnershipScope;
      reviewModelAdapter?: ExecutionReviewModelAdapter;
      review_model_adapter?: ExecutionReviewModelAdapter;
      reflectionModelAdapter?: ReflectionModelAdapter;
      reflection_model_adapter?: ReflectionModelAdapter;
      automaticReflection?: AutomaticReflectionOptions;
    }
  | {
      configPath?: never;
      shutdown_timeout_ms?: number;
      store: MemoryStore;
      reviewModelAdapter?: ExecutionReviewModelAdapter;
      review_model_adapter?: ExecutionReviewModelAdapter;
      reflectionModelAdapter?: ReflectionModelAdapter;
      reflection_model_adapter?: ReflectionModelAdapter;
      automaticReflection?: AutomaticReflectionOptions;
      projectOwnership?: never;
    };
