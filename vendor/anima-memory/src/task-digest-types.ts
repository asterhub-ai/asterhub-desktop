export const TASK_DIGEST_VERSION = "v1" as const;

export interface TaskDigestTerminal {
  state: "completed" | "cancelled" | "interrupted";
  terminal_reason:
    | "final_reply"
    | "user_cancelled"
    | "session_shutdown"
    | "session_compact";
  event_uid: string;
  position: number;
  captured_at: string;
}

export interface TaskDigestInitiator {
  event_uid: string;
  position: 0;
  content: string | null;
}

export interface TaskDigestEvent {
  event_uid: string;
  position: number;
  kind:
    | "message"
    | "tool_call"
    | "tool_result"
    | "turn_end"
    | "boundary";
  role: string;
  content: string | null;
  tool_name?: string;
  outcome?: "success" | "error";
  result_of_event_uid?: string;
}

export interface TaskDigestUnsettledToolCall {
  tool_call_event_uid: string;
  terminal_event_uid: string;
}

export interface TaskDigestContentOmission {
  event_uid: string;
  reason: "truncated" | "omitted";
}

export interface TaskDigest {
  candidate_uid: string;
  execution_uid: string;
  project_uid: string;
  session_uid: string;
  source_fingerprint: string;
  terminal: TaskDigestTerminal;
  initiator: TaskDigestInitiator;
  readonly events: readonly TaskDigestEvent[];
  readonly unsettled_tool_calls: readonly TaskDigestUnsettledToolCall[];
  readonly content_omissions: readonly TaskDigestContentOmission[];
}
