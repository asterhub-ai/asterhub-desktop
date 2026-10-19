import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { canonicalize } from "json-canonicalize";
import rawEventSchema from "@deepseek-ai/anima-protocol/schemas/canonical-raw-event.schema.json" with { type: "json" };
import contentPartSchema from "@deepseek-ai/anima-protocol/schemas/canonical-content-part.schema.json" with { type: "json" };
import capabilitiesSchema from "@deepseek-ai/anima-protocol/schemas/capture-capabilities.schema.json" with { type: "json" };
import runtimeSchema from "@deepseek-ai/anima-protocol/schemas/runtime-identity.schema.json" with { type: "json" };
import type { CanonicalRawEvent, CaptureSessionFacts, JsonValue, SourceEventFacts } from "./canonical-types.ts";

const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contentPartSchema);
ajv.addSchema(capabilitiesSchema);
ajv.addSchema(runtimeSchema);
const validateContentPart = ajv.compile(contentPartSchema);
const validateCapabilities = ajv.compile(capabilitiesSchema);
const validateDateTime = ajv.compile({ type: "string", format: "date-time" });
const validateRawEvent = ajv.compile(rawEventSchema);

export interface ValidationResult {
  ok: boolean;
  code?: "invalid_source_facts" | "invalid_canonical_event";
  message?: string;
  errors?: ErrorObject[];
}

function fail(message: string): ValidationResult {
  return { ok: false, code: "invalid_source_facts", message };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function exactKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.keys(value).every((key) => allowed.includes(key));
}
const canonicalUuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isCanonicalUuidV4(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidV4.test(value);
}

function isJsonValue(value: unknown, path = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  if (path.has(value)) return false;
  path.add(value);
  try {
    if (Array.isArray(value)) return value.every((item) => isJsonValue(item, path));
    return Object.values(value).every((item) => isJsonValue(item, path));
  } finally {
    path.delete(value);
  }
}



function validExtensions(value: unknown): value is Record<string, JsonValue> {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  return Object.entries(value).every(([key, item]) => /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(key) && isJsonValue(item));
}

function validRfc3339(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return validateDateTime(value);
}

function validMissingFields(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every((item) => {
    if (typeof item !== "string" || item.length === 0 || !/^(?:\/(?:[^~/]|~[01])*)+$/.test(item) || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

export function validateCaptureSessionFacts(facts: CaptureSessionFacts): ValidationResult {
  if (facts === null || typeof facts !== "object") return fail("source facts must be objects");
  if (!exactKeys(facts, ["installation_uid", "runtime", "profile", "project", "session", "capture_capabilities"])) return fail("source facts contain undeclared fields");
  if (!nonEmpty(facts.installation_uid)) return fail("installation_uid must be non-empty");
  if (!exactKeys(facts.runtime, ["family", "version", "adapter_version"]) || !nonEmpty(facts.runtime.family) || !nonEmpty(facts.runtime.adapter_version)) return fail("installation and runtime identity fields must be non-empty");
  if (facts.runtime.version !== undefined && !nonEmpty(facts.runtime.version)) return fail("runtime version must be non-empty");

  if (!exactKeys(facts.profile, ["method", "source_id", "anchor", "generated_anchor", "generated_uid", "name"]) || !nonEmpty(facts.profile.method)) return fail("profile identity is invalid");
  if (!["source", "derived", "generated"].includes(facts.profile.method)) return fail("profile identity method is invalid");
  if (facts.profile.method === "source" && (!exactKeys(facts.profile, ["method", "source_id", "name"]) || !nonEmpty(facts.profile.source_id))) return fail("profile source id must be non-empty");
  if (facts.profile.method === "derived" && (!exactKeys(facts.profile, ["method", "anchor", "name"]) || !nonEmpty(facts.profile.anchor))) return fail("profile anchor must be non-empty");
  if (
    facts.profile.method === "generated" &&
    (!exactKeys(facts.profile, ["method", "generated_anchor", "generated_uid", "name"]) ||
      (facts.profile.generated_anchor !== undefined && !nonEmpty(facts.profile.generated_anchor)) ||
      (facts.profile.generated_uid !== undefined && !isCanonicalUuidV4(facts.profile.generated_uid)) ||
      (facts.profile.generated_anchor !== undefined && facts.profile.generated_uid !== undefined))
  ) return fail("generated profile identity is invalid");
  if (facts.profile.name !== undefined && !nonEmpty(facts.profile.name)) return fail("profile name must be non-empty");

  if (!exactKeys(facts.project, ["method", "normalized_identity", "generated_anchor"]) || !nonEmpty(facts.project.method)) return fail("project identity is invalid");
  if (!["source", "derived", "generated", "personal"].includes(facts.project.method)) return fail("project identity method is invalid");
  if ((facts.project.method === "source" || facts.project.method === "derived") && (!exactKeys(facts.project, ["method", "normalized_identity"]) || !nonEmpty(facts.project.normalized_identity))) return fail("normalized project identity must be non-empty");
  if (facts.project.method === "generated" && (!exactKeys(facts.project, ["method", "generated_anchor"]) || (facts.project.generated_anchor !== undefined && !nonEmpty(facts.project.generated_anchor)))) return fail("generated project identity must be non-empty");
  if (facts.project.method === "personal" && !exactKeys(facts.project, ["method"])) return fail("personal project identity is invalid");

  if (!exactKeys(facts.session, ["method", "source_id", "anchor"]) || !nonEmpty(facts.session.method)) return fail("session identity is invalid");
  if (!["source", "derived", "generated"].includes(facts.session.method)) return fail("session identity method is invalid");
  if (facts.session.method === "source" && (!exactKeys(facts.session, ["method", "source_id"]) || !nonEmpty(facts.session.source_id))) return fail("session source id must be non-empty");
  if (facts.session.method === "derived" && (!exactKeys(facts.session, ["method", "anchor"]) || !nonEmpty(facts.session.anchor))) return fail("session anchor must be non-empty");
  if (facts.session.method === "generated" && !exactKeys(facts.session, ["method"])) return fail("generated session identity is invalid");

  if (
    !exactKeys(facts.capture_capabilities, [
      "schema_id",
      "stable_session_id",
      "stable_event_id",
      "stable_tool_call_id",
      "final_assistant_message",
      "final_tool_result",
      "developer_messages",
      "multimodal_content",
      "source_sequence",
      "source_timestamp",
      "compact_event",
      "shutdown_event",
      "user_message_origin",
      "turn_end_event",
      "extensions",
    ]) ||
    !validateCapabilities(facts.capture_capabilities) ||
    !validExtensions(facts.capture_capabilities.extensions)
  ) return fail("capture capabilities are invalid");
  if (facts.session.method === "source" && !facts.capture_capabilities.stable_session_id) return fail("stable_session_id capability is required for source session identity");
  return { ok: true };
}

export function validateSourceFacts(facts: CaptureSessionFacts, event: SourceEventFacts): ValidationResult {
  const factsValidation = validateCaptureSessionFacts(facts);
  if (!factsValidation.ok) return factsValidation;
  if (event === null || typeof event !== "object") return fail("source facts must be objects");
  if (
    !exactKeys(event, [
      "kind",
      "source",
      "source_sequence",
      "source_timestamp",
      "role",
      "tool_name",
      "outcome",
      "boundary_type",
      "correlation",
      "content_parts",
      "fidelity",
      "native_payload",
      "message_origin",
      "turn_index",
      "turn_end_status",
      "extensions",
    ])
  ) return fail("source event facts contain undeclared fields");
  if (!nonEmpty(event.kind) || !exactKeys(event.source, ["event_name", "event_id", "session_id"]) || !nonEmpty(event.source.event_name)) return fail("source event fields are invalid");
  if (!["message", "tool_call", "tool_result", "boundary", "turn_end"].includes(event.kind)) return fail("event kind is invalid");
  if (event.source.event_id !== undefined && !nonEmpty(event.source.event_id)) return fail("source event id must be non-empty");
  if (event.source.session_id !== undefined && !nonEmpty(event.source.session_id)) return fail("source session id must be non-empty");
  if (event.source_sequence !== undefined && (!Number.isSafeInteger(event.source_sequence) || event.source_sequence < 0)) return fail("source_sequence must be a non-negative integer");
  if (event.source_timestamp !== undefined && !validRfc3339(event.source_timestamp)) return fail("source_timestamp must be RFC3339 date-time");
  if (facts.session.method === "source" && event.source.session_id !== undefined && event.source.session_id !== facts.session.source_id) return fail("source session id does not match the capture session");
  if (!Array.isArray(event.content_parts) || event.content_parts.some((part) => !validateContentPart(part) || !validExtensions(part.extensions))) return fail("content parts are invalid");
  if (!exactKeys(event.fidelity, ["completeness", "missing_fields"]) || !event.fidelity || (event.fidelity.completeness !== "full" && event.fidelity.completeness !== "partial") || !validMissingFields(event.fidelity.missing_fields)) return fail("fidelity is invalid");
  if (event.fidelity.completeness === "full" && event.fidelity.missing_fields.length !== 0) return fail("full fidelity cannot contain missing fields");
  if (event.fidelity.completeness === "partial" && event.fidelity.missing_fields.length === 0) return fail("partial fidelity requires missing fields");
  if (!isJsonValue(event.native_payload) || !validExtensions(event.extensions)) return fail("native payload or extensions are invalid");
  for (const part of event.content_parts) {
    if (part.value_json !== undefined || part.payload_json !== undefined) {
      for (const jsonText of [part.value_json, part.payload_json]) {
        if (jsonText !== undefined) {
          try {
            const parsed: unknown = JSON.parse(jsonText);
            if (!isJsonValue(parsed) || canonicalize(parsed) !== jsonText) return fail("content JSON values must be valid canonical JSON");
          } catch {
            return fail("content JSON values must be valid canonical JSON");
          }
        }
      }
    }
  }
  if (event.role !== undefined && !["user", "assistant", "developer", "system", "unknown"].includes(event.role)) return fail("role is invalid");
  if (event.outcome !== undefined && !["success", "error", "cancelled", "unknown"].includes(event.outcome)) return fail("outcome is invalid");
  if (event.boundary_type !== undefined && !["checkpoint", "compact", "shutdown", "validation", "unknown"].includes(event.boundary_type)) return fail("boundary_type is invalid");
  if (event.message_origin !== undefined && !["external_user", "runtime_synthetic"].includes(event.message_origin)) return fail("message origin is invalid");
  if (event.turn_index !== undefined && (!Number.isSafeInteger(event.turn_index) || event.turn_index < 0)) return fail("turn_index must be a safe non-negative integer");
  if (event.turn_end_status !== undefined && !["nonterminal", "final_reply", "cancelled"].includes(event.turn_end_status)) return fail("turn_end_status is invalid");
  const finalityBasis = event.extensions?.["anima.omp.finality_basis"];
  if (finalityBasis !== undefined && (typeof finalityBasis !== "string" || !["turn_shape", "agent_end_terminal", "agent_end_continuing", "agent_end_aborted", "forced_flush"].includes(finalityBasis))) return fail("finality basis is invalid");
  if (event.correlation !== undefined) {
    if (!exactKeys(event.correlation, ["method", "source_tool_call_id", "target_event_uid", "reason"]) || !["source", "derived", "missing"].includes(event.correlation.method)) return fail("correlation is invalid");
    if (event.correlation.method === "source" && (!exactKeys(event.correlation, ["method", "source_tool_call_id"]) || !nonEmpty(event.correlation.source_tool_call_id))) return fail("source correlation is invalid");
    if (event.correlation.method === "derived" && (!exactKeys(event.correlation, ["method", "target_event_uid", "source_tool_call_id", "reason"]) || !nonEmpty(event.correlation.target_event_uid) || !nonEmpty(event.correlation.reason) || (event.correlation.source_tool_call_id !== undefined && !nonEmpty(event.correlation.source_tool_call_id)))) return fail("derived correlation is invalid");
    if (event.correlation.method === "missing" && (!exactKeys(event.correlation, ["method", "reason"]) || !nonEmpty(event.correlation.reason))) return fail("missing correlation is invalid");
  }

  const capabilities = facts.capture_capabilities;
  if (facts.session.method === "source" && !capabilities.stable_session_id) return fail("stable_session_id capability is required for source session identity");
  if (event.source.session_id !== undefined && !capabilities.stable_session_id) return fail("stable_session_id capability is required");
  if (event.source_sequence !== undefined && !capabilities.source_sequence) return fail("source_sequence capability is required");
  if (event.source_timestamp !== undefined && !capabilities.source_timestamp) return fail("source_timestamp capability is required");
  if (event.role === "developer" && !capabilities.developer_messages) return fail("developer_messages capability is required");
  if (event.content_parts.some((part) => part.type === "image" || part.type === "file") && !capabilities.multimodal_content) return fail("multimodal_content capability is required");
  if (event.kind === "boundary" && event.boundary_type === "compact" && !capabilities.compact_event) return fail("compact_event capability is required");
  if (event.kind === "boundary" && event.boundary_type === "shutdown" && !capabilities.shutdown_event) return fail("shutdown_event capability is required");

  if (event.kind === "message") {
    if (event.role === undefined) return fail("message events require role");
    if (event.content_parts.length === 0) return fail("message events require content");
    if (event.tool_name !== undefined || event.outcome !== undefined || event.correlation !== undefined || event.boundary_type !== undefined || event.turn_index !== undefined || event.turn_end_status !== undefined) return fail("message events contain fields from another kind");
    if (event.role === "user") {
      if (event.message_origin !== undefined && !capabilities.user_message_origin) return fail("user_message_origin capability is required");
      if (capabilities.user_message_origin && event.message_origin === undefined) return fail("user message origin is required");
    } else if (event.message_origin !== undefined) {
      return fail("message origin is only valid for user messages");
    }
  } else if (event.kind === "tool_call") {
    const anchor = event.extensions?.["anima.tool.source_call_id"];
    const missing = event.fidelity.missing_fields.includes("/extensions/anima.tool.source_call_id");
    if (event.role !== undefined || event.outcome !== undefined || event.correlation !== undefined || event.boundary_type !== undefined || event.message_origin !== undefined || event.turn_index !== undefined || event.turn_end_status !== undefined) return fail("tool call events contain fields from another kind");
    if (event.tool_name !== undefined && !nonEmpty(event.tool_name)) return fail("tool call tool_name must be non-empty");
    if (anchor !== undefined && (!nonEmpty(anchor) || !capabilities.stable_tool_call_id)) return fail("tool call source anchor is invalid");
    if (anchor === undefined && capabilities.stable_tool_call_id && !missing) return fail("stable tool call identity requires source anchor");
    if (event.tool_name === undefined && !event.fidelity.missing_fields.includes("/tool_name")) return fail("tool call tool_name is required");
  } else if (event.kind === "tool_result") {
    if (event.role !== undefined || event.boundary_type !== undefined || event.message_origin !== undefined || event.turn_index !== undefined || event.turn_end_status !== undefined) return fail("tool result events contain fields from another kind");
    if (event.outcome === undefined || event.correlation === undefined) return fail("tool result requires outcome and correlation");
    if (event.tool_name !== undefined && !nonEmpty(event.tool_name)) return fail("tool result tool_name must be non-empty");
    if (event.tool_name === undefined && !event.fidelity.missing_fields.includes("/tool_name")) return fail("tool result tool_name is required");
    if (event.correlation.method === "source" && (!capabilities.stable_tool_call_id || !nonEmpty(event.correlation.source_tool_call_id) || "target_event_uid" in event.correlation)) return fail("source correlation is invalid");
  } else if (event.kind === "boundary") {
    if (event.role !== undefined || event.tool_name !== undefined || event.outcome !== undefined || event.correlation !== undefined || event.message_origin !== undefined || event.turn_index !== undefined || event.turn_end_status !== undefined) return fail("boundary events contain fields from another kind");
    if (event.boundary_type === undefined) return fail("boundary events require boundary_type");
  } else {
    if (event.source.event_name !== "turn_end" || event.turn_index === undefined || event.turn_end_status === undefined || event.content_parts.length !== 0) return fail("turn-end events require exact structural fields");
    if (!capabilities.turn_end_event) return fail("turn_end_event capability is required");
    if (event.role !== undefined || event.message_origin !== undefined || event.tool_name !== undefined || event.outcome !== undefined || event.correlation !== undefined || event.boundary_type !== undefined) return fail("turn-end events contain fields from another kind");
  }
  if (event.kind !== "turn_end" && (event.turn_index !== undefined || event.turn_end_status !== undefined)) return fail("turn fields are only valid for turn_end events");
  if (event.correlation?.method === "derived" && (!nonEmpty(event.correlation.target_event_uid) || !nonEmpty(event.correlation.reason))) return fail("derived correlation is invalid");
  if (event.correlation?.method === "missing" && !nonEmpty(event.correlation.reason)) return fail("missing correlation is invalid");
  return { ok: true };
}

export function validateCanonicalRawEvent(event: CanonicalRawEvent): ValidationResult {
  if (!validateRawEvent(event)) {
    return { ok: false, code: "invalid_canonical_event", message: "canonical event does not satisfy the R2A schema", errors: validateRawEvent.errors ?? [] };
  }
  try {
    if (canonicalize(JSON.parse(event.native_payload_json)) !== event.native_payload_json) {
      return { ok: false, code: "invalid_canonical_event", message: "native_payload_json must be JCS canonical" };
    }
    for (const part of event.content_parts) {
      if (part.value_json !== undefined && canonicalize(JSON.parse(part.value_json)) !== part.value_json) return { ok: false, code: "invalid_canonical_event", message: "content value_json must be JCS canonical" };
      if (part.payload_json !== undefined && canonicalize(JSON.parse(part.payload_json)) !== part.payload_json) return { ok: false, code: "invalid_canonical_event", message: "content payload_json must be JCS canonical" };
    }
  } catch {
    return { ok: false, code: "invalid_canonical_event", message: "canonical JSON fields are invalid" };
  }
  return { ok: true };
}
