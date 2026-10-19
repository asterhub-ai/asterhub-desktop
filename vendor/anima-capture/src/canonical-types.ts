export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Recursively readonly view used for values retained by an opened capture session. */
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
  T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
  T;

export type IdentityMethod = "source" | "derived" | "generated";
export type IdentitySource =
  | { method: "source"; source_id: string }
  | { method: "derived"; anchor: string }
  | { method: "generated" };

type GeneratedProfileIdentity =
  | { method: "generated"; generated_anchor: string; generated_uid?: never }
  | { method: "generated"; generated_anchor?: never; generated_uid?: string };

export interface CaptureCapabilities {
  schema_id: "anima.capture-capabilities/v1.0";
  stable_session_id: boolean;
  stable_event_id: boolean;
  stable_tool_call_id: boolean;
  final_assistant_message: boolean;
  final_tool_result: boolean;
  developer_messages: boolean;
  multimodal_content: boolean;
  source_sequence: boolean;
  source_timestamp: boolean;
  compact_event: boolean;
  shutdown_event: boolean;
  user_message_origin: boolean;
  turn_end_event: boolean;
  extensions?: Record<string, JsonValue>;
}
export interface CaptureSessionFacts {
  installation_uid: string;
  runtime: { family: string; version?: string; adapter_version: string };
  profile: ({ method: "source"; source_id: string } | { method: "derived"; anchor: string } | GeneratedProfileIdentity) & { name?: string };
  project:
    | { method: "source" | "derived"; normalized_identity: string }
    | { method: "generated"; generated_anchor?: string }
    | { method: "personal" };
  session: IdentitySource;
  capture_capabilities: CaptureCapabilities;
}
export type ReadonlyJsonValue = DeepReadonly<JsonValue>;
export type ReadonlyCaptureSessionFacts = DeepReadonly<CaptureSessionFacts>;

export interface CanonicalContentPart {
  schema_id: "anima.content-part/v1.0";
  type: "text" | "json" | "image" | "file" | "unknown";
  part_index: number;
  text?: string;
  value_json?: string;
  mime_type?: string;
  name?: string;
  source_ref?: string;
  native_type?: string;
  payload_json?: string;
  extensions?: Record<string, JsonValue>;
}

/** Source facts retain the unresolved source tool-call anchor. Writer resolves it to a target event UID. */
export type SourceCorrelation =
  | { method: "source"; source_tool_call_id: string }
  | { method: "derived"; target_event_uid: string; source_tool_call_id?: string; reason: string }
  | { method: "missing"; reason: string };

/** Canonical protocol correlation after Writer resolution. */
export type CanonicalCorrelation =
  | { method: "source"; target_event_uid: string; source_tool_call_id: string }
  | { method: "derived"; target_event_uid: string; source_tool_call_id?: string; reason: string }
  | { method: "missing"; reason: string };

export interface SourceEventFacts {
  kind: "message" | "tool_call" | "tool_result" | "boundary" | "turn_end";
  source: { event_name: string; event_id?: string; session_id?: string };
  source_sequence?: number;
  source_timestamp?: string;
  role?: "user" | "assistant" | "developer" | "system" | "unknown";
  tool_name?: string;
  outcome?: "success" | "error" | "cancelled" | "unknown";
  boundary_type?: "checkpoint" | "compact" | "shutdown" | "validation" | "unknown";
  correlation?: SourceCorrelation;
  content_parts: CanonicalContentPart[];
  fidelity: { completeness: "full" | "partial"; missing_fields: string[] };
  native_payload: JsonValue;
  message_origin?: "external_user" | "runtime_synthetic";
  turn_index?: number;
  turn_end_status?: "nonterminal" | "final_reply" | "cancelled";
  extensions?: Record<string, JsonValue>;
}

export interface RuntimeIdentity {
  schema_id: "anima.runtime-identity/v1.0";
  installation_uid: string;
  runtime_family: string;
  adapter_version: string;
  core_version: string;
  profile_uid: string;
  profile_identity_method: IdentityMethod;
  runtime_version?: string;
  profile_name?: string;
  extensions?: Record<string, JsonValue>;
}

export interface CanonicalRawEvent {
  schema_id: "anima.raw-event/v1.0";
  event_uid: string;
  event_identity_method: IdentityMethod;
  session_uid: string;
  session_identity_method: IdentityMethod;
  project_uid: string;
  project_identity_method: IdentityMethod;
  kind: SourceEventFacts["kind"];
  runtime_identity: RuntimeIdentity;
  capture_capabilities: CaptureCapabilities;
  source: SourceEventFacts["source"];
  ingest_sequence: number;
  captured_at: string;
  content_parts: CanonicalContentPart[];
  fidelity: SourceEventFacts["fidelity"];
  native_payload_json: string;
  source_sequence?: number;
  source_timestamp?: string;
  role?: SourceEventFacts["role"];
  tool_name?: string;
  outcome?: SourceEventFacts["outcome"];
  correlation?: CanonicalCorrelation;
  boundary_type?: SourceEventFacts["boundary_type"];
  message_origin?: "external_user" | "runtime_synthetic";
  turn_index?: number;
  turn_end_status?: "nonterminal" | "final_reply" | "cancelled";
  extensions?: Record<string, JsonValue>;
}

/** A Builder draft may still contain unresolved source correlation for Writer. */
export type CanonicalRawEventDraft = Omit<CanonicalRawEvent, "ingest_sequence" | "correlation"> & {
  ingest_sequence?: never;
  correlation?: SourceCorrelation | CanonicalCorrelation;
};

export interface Identity {
  readonly uid: string;
  readonly method: IdentityMethod;
  readonly fingerprint: string;
}

/** Identities resolved once for one opened CaptureSession and reused for every event. */
export interface ResolvedSessionContext {
  readonly facts: ReadonlyCaptureSessionFacts;
  readonly profile: Readonly<Identity>;
  readonly project: Readonly<Identity>;
  readonly session: Readonly<Identity>;
  readonly profile_uid: string;
  readonly project_uid: string;
  readonly session_uid: string;
}
