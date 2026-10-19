export type { MaterializeExecutionReviewCandidatesInput, MaterializeExecutionReviewCandidatesResult, MaterializeExecutionUnitsInput, MaterializeExecutionUnitsResult } from "./types.ts";

export type ExecutionRole = "initiator" | "first_tool_call" | "member" | "terminal";
export type ExecutionTerminalReason = "final_reply" | "user_cancelled" | "session_compact" | "session_shutdown";

export type ExecutionSourceEvent = {
  event_uid: string;
  project_uid: string;
  session_uid: string;
  ingest_sequence: number;
  fingerprint: string;
} & (
  | { kind: "message"; role: "user" | "assistant" | "developer" | "system" | "unknown"; message_origin: "external_user" | "runtime_synthetic" | null }
  | { kind: "tool_call" }
  | { kind: "tool_result"; outcome: "success" | "error" | "cancelled" | "unknown"; result_of_event_uid: string | null }
  | { kind: "boundary"; boundary_type: "checkpoint" | "compact" | "shutdown" | "validation" | "unknown" }
  | { kind: "turn_end"; turn_index: number; turn_end_status: "nonterminal" | "final_reply" | "cancelled" }
);

export interface ExecutionUnitSnapshot {
  execution_uid: string;
  project_uid: string;
  session_uid: string;
  initiator_kind: "user_request";
  initiator_event_uid: string;
  first_tool_call_event_uid: string;
  start_ingest_sequence: number;
  end_ingest_sequence: number;
  event_count: number;
  state: "open" | "completed" | "cancelled" | "interrupted";
  source_fingerprint: string;
  ordered_event_uids: string[];
  contains_roles: ExecutionRole[];
  initiated_by_event_uid: string;
  finalized_by_event_uid: string | null;
  terminal_reason: ExecutionTerminalReason | null;
  terminal_event_uid: string | null;
}

export interface ExecutionOwnerLink {
  session_uid: string;
  execution_uid: string;
}
export interface ExecutionInitiatorLink {
  execution_uid: string;
  event_uid: string;
}
export interface ExecutionContainsLink {
  execution_uid: string;
  event_uid: string;
  position: number;
  role: ExecutionRole;
}
export interface ExecutionFinalizerLink {
  execution_uid: string;
  event_uid: string;
  terminal_reason: ExecutionTerminalReason;
}

export type ExecutionUnitPlan =
  | {
      node_action: "create";
      after: ExecutionUnitSnapshot;
      owner_link: ExecutionOwnerLink;
      initiator_link: ExecutionInitiatorLink;
      contains_links: ExecutionContainsLink[];
      finalizer_link: ExecutionFinalizerLink | null;
    }
  | {
      node_action: "update";
      before: ExecutionUnitSnapshot;
      after: ExecutionUnitSnapshot;
      owner_link: null;
      initiator_link: null;
      contains_links: ExecutionContainsLink[];
      finalizer_link: ExecutionFinalizerLink | null;
    }
  | {
      node_action: "verify";
      before: ExecutionUnitSnapshot;
      after: ExecutionUnitSnapshot;
      owner_link: null;
      initiator_link: null;
      contains_links: [];
      finalizer_link: null;
    };

export interface ProjectExecutionUnitsInput {
  project_uid: string;
  session_uid: string;
  events: readonly ExecutionSourceEvent[];
  existing_execution_units: readonly ExecutionUnitSnapshot[];
}

export interface ProjectExecutionUnitsPlan {
  through_ingest_sequence: number;
  unit_plans: ExecutionUnitPlan[];
  execution_units_created: number;
  execution_units_updated: number;
  event_links_created: number;
}

export type ExecutionProjectorErrorCode = "invalid_input" | "source_incomplete" | "identity_conflict";
