export type EpisodeKind = "work" | "personal";
export type EpisodeState = "open" | "suspended" | "stable_ended";

export type MaterializeEpisodeClosureInput =
  | { kind: "none" }
  | {
      kind: "work_validated";
      checkpoint_event_uid: string;
      validation_result_event_uid: string;
      validation_event_uid: string;
    }
  | {
      kind: "personal_explicit";
      checkpoint_event_uid: string;
    };

export interface MaterializeEpisodeInput {
  project_uid: string;
  episode_kind: EpisodeKind;
  window_uids: readonly [string, ...string[]];
  closure: MaterializeEpisodeClosureInput;
}

export type MaterializeEpisodeResult =
  | {
      status: "materialized" | "duplicate";
      decision_uid: string;
      episode_uid: string;
      state: EpisodeState;
      revision: number;
      windows_assigned: number;
      evidence_links_created: number;
    }
  | {
      status: "indeterminate";
      decision_uid: string;
      episode_uid: string;
      message: string;
    }
  | {
      status: "failed";
      code:
        | "invalid_input"
        | "not_found"
        | "source_incomplete"
        | "evidence_invalid"
        | "identity_conflict"
        | "invalid_transition"
        | "core_degraded"
        | "core_closed"
        | "database_error";
      message: string;
    };

export interface EpisodeWindowFact {
  window_uid: string;
  project_uid: string;
  session_uid: string;
  start_ingest_sequence: number;
  end_ingest_sequence: number;
  collection_state: "sealed";
  terminal_event_uid: string;
  terminal_boundary_type: "checkpoint" | "compact" | "shutdown" | "validation" | "unknown";
  decision_status: "pending";
  projector_version: "anima.boundary-projector/v1";
  assigned_episode_uid: string | null;
}

export interface EpisodeBoundaryEvidenceFact {
  event_uid: string;
  project_uid: string;
  session_uid: string;
  window_uid: string;
  ingest_sequence: number;
  kind: "boundary";
  boundary_type: "checkpoint" | "validation";
}

export interface EpisodeSuccessfulResultEvidenceFact {
  event_uid: string;
  project_uid: string;
  session_uid: string;
  window_uid: string;
  ingest_sequence: number;
  kind: "tool_result";
  outcome: "success";
  tool_call_event_uid: string;
  tool_call_window_uid: string;
  tool_call_ingest_sequence: number;
}

export interface EpisodeContinuationFact {
  project_uid: string;
  current_session_uid: string;
  previous_session_uid: string;
  decision_uid: string;
  schema_id: "anima.session-continuation/v1.0";
  method: "explicit_checkpoint";
  evidence_event_uid: string;
}

export type EpisodeDecisionHistoryEntry =
  | {
      revision: number;
      decision_uid: string;
      window_count: number;
      state: "open";
    }
  | {
      revision: number;
      decision_uid: string;
      window_count: number;
      state: "suspended";
      suspension_event_uid: string;
    }
  | {
      revision: number;
      decision_uid: string;
      window_count: number;
      state: "stable_ended";
      closure_kind: "work_validated";
      checkpoint_event_uid: string;
      validation_result_event_uid: string;
      validation_event_uid: string;
    }
  | {
      revision: number;
      decision_uid: string;
      window_count: number;
      state: "stable_ended";
      closure_kind: "personal_explicit";
      checkpoint_event_uid: string;
    };

export interface EpisodeSnapshot {
  episode_uid: string;
  project_uid: string;
  episode_kind: EpisodeKind;
  first_window_uid: string;
  last_window_uid: string;
  window_count: number;
  revision: number;
  state: EpisodeState;
  creation_decision_uid: string;
  last_decision_uid: string;
  schema_id: "anima.episode/v1.0";
  projector_version: "anima.episode-projector/v1";
  assigned_window_uids: readonly string[];
  assigned_window_decision_uids: readonly string[];
  assigned_window_decision_revisions: readonly number[];
  decision_history: readonly [EpisodeDecisionHistoryEntry, ...EpisodeDecisionHistoryEntry[]];
  closure_kind?: "work_validated" | "personal_explicit";
  checkpoint_event_uid?: string;
  validation_result_event_uid?: string;
  validation_event_uid?: string;
  suspension_event_uid?: string;
}

export type EpisodeClosureFacts =
  | { kind: "none" }
  | {
      kind: "work_validated";
      checkpoint: EpisodeBoundaryEvidenceFact;
      validation_result: EpisodeSuccessfulResultEvidenceFact;
      validation: EpisodeBoundaryEvidenceFact;
    }
  | {
      kind: "personal_explicit";
      checkpoint: EpisodeBoundaryEvidenceFact;
    };

export interface ProjectEpisodeInput {
  project_uid: string;
  episode_kind: EpisodeKind;
  windows: readonly [EpisodeWindowFact, ...EpisodeWindowFact[]];
  continuations: readonly EpisodeContinuationFact[];
  closure: EpisodeClosureFacts;
  existing_episode?: EpisodeSnapshot;
}

export interface EpisodeWindowAssignmentPlan {
  window_uid: string;
  episode_uid: string;
  position: number;
  decision_uid: string;
  decision_revision: number;
}

export interface EpisodeEvidenceLinkPlan {
  episode_uid: string;
  event_uid: string;
  role: "suspension" | "checkpoint" | "validation_result" | "validation";
  decision_uid: string;
  decision_revision: number;
}

export interface ProjectEpisodePlan {
  decision_uid: string;
  episode: {
    action: "create" | "update" | "verify";
    before?: EpisodeSnapshot;
    after: EpisodeSnapshot;
  };
  new_window_assignments: readonly EpisodeWindowAssignmentPlan[];
  new_evidence_links: readonly EpisodeEvidenceLinkPlan[];
  result: {
    status: "materialized" | "duplicate";
    decision_uid: string;
    episode_uid: string;
    state: EpisodeState;
    revision: number;
    windows_assigned: number;
    evidence_links_created: number;
  };
}

export class EpisodeProjectorError extends Error {
  readonly code: "invalid_input" | "source_incomplete" | "evidence_invalid" | "identity_conflict" | "invalid_transition";

  constructor(
    message: string,
    code: "invalid_input" | "source_incomplete" | "evidence_invalid" | "identity_conflict" | "invalid_transition",
  ) {
    super(message);
    this.name = "EpisodeProjectorError";
    this.code = code;
  }
}
