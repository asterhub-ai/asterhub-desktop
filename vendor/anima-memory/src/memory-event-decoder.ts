import neo4j from "neo4j-driver";
import { canonicalize } from "json-canonicalize";
import { validateCanonicalRawEvent, type CanonicalRawEvent } from "@deepseek-ai/anima-capture";

const REQUIRED_PROPERTIES = [
  "event_uid",
  "schema_id",
  "event_identity_method",
  "session_uid",
  "session_identity_method",
  "project_uid",
  "project_identity_method",
  "kind",
  "runtime_identity_json",
  "capture_capabilities_json",
  "source_json",
  "ingest_sequence",
  "captured_at",
  "content_parts_json",
  "fidelity_json",
  "native_payload_json",
  "fingerprint",
  "role",
  "message_origin",
] as const;
const OPTIONAL_PROPERTIES = ["source_sequence", "source_timestamp", "extensions_json"] as const;
const PROPERTY_NAMES = [...REQUIRED_PROPERTIES, ...OPTIONAL_PROPERTIES] as const;
const TOOL_CALL_REQUIRED_PROPERTIES = [
  "event_uid",
  "schema_id",
  "event_identity_method",
  "session_uid",
  "session_identity_method",
  "project_uid",
  "project_identity_method",
  "kind",
  "runtime_identity_json",
  "capture_capabilities_json",
  "source_json",
  "ingest_sequence",
  "captured_at",
  "content_parts_json",
  "fidelity_json",
  "native_payload_json",
  "fingerprint",
  "tool_name",
] as const;
const TOOL_CALL_OPTIONAL_PROPERTIES = ["source_sequence", "source_timestamp", "extensions_json", "anima.tool.source_call_id"] as const;
const TOOL_CALL_PROPERTY_NAMES = [...TOOL_CALL_REQUIRED_PROPERTIES, ...TOOL_CALL_OPTIONAL_PROPERTIES] as const;
const INPUT_NAMES = ["labels", "properties"] as const;
const UUID_V4_OR_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ERROR_MESSAGE = "Stored external user message could not be decoded.";

type DataRecord = Record<string, unknown>;

export class MemoryEventDecodeError extends TypeError {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = "MemoryEventDecodeError";
  }
}

function fail(): never {
  throw new MemoryEventDecodeError();
}

function snapshotRecord(
  value: unknown,
  requiredNames: readonly string[],
  allowedNames: readonly string[],
): DataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowedNames.includes(key))) fail();
  for (const name of requiredNames) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) fail();
  }

  const snapshot: DataRecord = Object.create(null) as DataRecord;
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail();
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotLabels(value: unknown): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 2) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || !keys.includes("0") || !keys.includes("1") || !keys.includes("length")) fail();
  const first = Object.getOwnPropertyDescriptor(value, "0");
  const second = Object.getOwnPropertyDescriptor(value, "1");
  if (!first?.enumerable || !("value" in first) || !second?.enumerable || !("value" in second)) fail();
  if (typeof first.value !== "string" || typeof second.value !== "string") fail();
  return [first.value, second.value];
}

function requiredString(properties: DataRecord, name: string): string {
  const value = properties[name];
  if (typeof value !== "string") fail();
  return value;
}

function nonnegativeSafeInteger(value: unknown): number {
  let number: number;
  if (typeof value === "number") {
    number = value;
  } else if (neo4j.isInt(value)) {
    number = value.toNumber();
  } else {
    return fail();
  }
  if (!Number.isSafeInteger(number) || number < 0) fail();
  return number;
}

function canonicalJsonText(value: unknown): { text: string; parsed: unknown } {
  if (typeof value !== "string") fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
    if (canonicalize(parsed) !== value) fail();
  } catch {
    return fail();
  }
  return { text: value, parsed };
}

/**
 * Decodes the message properties already read by a trusted graph reader. This only reconstructs
 * the Capture event shape; fingerprint verification, graph ownership, and memory admission remain
 * separate responsibilities.
 */
export function decodeStoredExternalUserMessage(input: unknown): {
  event: CanonicalRawEvent;
  stored_fingerprint: string;
} {
  try {
    const outer = snapshotRecord(input, INPUT_NAMES, INPUT_NAMES);
    const labels = snapshotLabels(outer.labels);
    if (labels.length !== 2 || labels[0] === labels[1] || !labels.includes("RawEvent") || !labels.includes("Message")) fail();

    const properties = snapshotRecord(outer.properties, REQUIRED_PROPERTIES, PROPERTY_NAMES);
    const eventUid = requiredString(properties, "event_uid");
    const projectUid = requiredString(properties, "project_uid");
    const sessionUid = requiredString(properties, "session_uid");
    if (!UUID_V4_OR_V5.test(eventUid) || !UUID_V4_OR_V5.test(projectUid) || !UUID_V4_OR_V5.test(sessionUid)) fail();

    const fingerprint = requiredString(properties, "fingerprint");
    if (!SHA256.test(fingerprint)) fail();
    if (properties.kind !== "message" || properties.role !== "user" || properties.message_origin !== "external_user") fail();

    const runtimeIdentity = canonicalJsonText(properties.runtime_identity_json).parsed;
    const captureCapabilities = canonicalJsonText(properties.capture_capabilities_json).parsed;
    const source = canonicalJsonText(properties.source_json).parsed;
    const contentParts = canonicalJsonText(properties.content_parts_json).parsed;
    const fidelity = canonicalJsonText(properties.fidelity_json).parsed;
    const nativePayload = canonicalJsonText(properties.native_payload_json);

    const event: Record<string, unknown> = {
      event_uid: eventUid,
      schema_id: properties.schema_id,
      event_identity_method: properties.event_identity_method,
      session_uid: sessionUid,
      session_identity_method: properties.session_identity_method,
      project_uid: projectUid,
      project_identity_method: properties.project_identity_method,
      kind: properties.kind,
      runtime_identity: runtimeIdentity,
      capture_capabilities: captureCapabilities,
      source,
      ingest_sequence: nonnegativeSafeInteger(properties.ingest_sequence),
      captured_at: properties.captured_at,
      content_parts: contentParts,
      fidelity,
      native_payload_json: nativePayload.text,
      role: properties.role,
      message_origin: properties.message_origin,
    };

    if (Object.prototype.hasOwnProperty.call(properties, "source_sequence")) {
      event.source_sequence = nonnegativeSafeInteger(properties.source_sequence);
    }
    if (Object.prototype.hasOwnProperty.call(properties, "source_timestamp")) {
      event.source_timestamp = properties.source_timestamp;
    }
    if (Object.prototype.hasOwnProperty.call(properties, "extensions_json")) {
      event.extensions = canonicalJsonText(properties.extensions_json).parsed;
    }

    const canonicalEvent = event as unknown as CanonicalRawEvent;
    if (!validateCanonicalRawEvent(canonicalEvent).ok) fail();
    return { event: canonicalEvent, stored_fingerprint: fingerprint };
  } catch {
    throw new MemoryEventDecodeError();
  }
}
/**
 * Reconstructs the ToolCall shape written by Capture. Graph ownership and fingerprint checks
 * remain the responsibility of the trusted evidence reader.
 */
export function decodeStoredToolCall(input: unknown): {
  event: CanonicalRawEvent;
  stored_fingerprint: string;
} {
  try {
    const outer = snapshotRecord(input, INPUT_NAMES, INPUT_NAMES);
    const labels = snapshotLabels(outer.labels);
    if (labels[0] === labels[1] || !labels.includes("RawEvent") || !labels.includes("ToolCall")) fail();

    const properties = snapshotRecord(outer.properties, TOOL_CALL_REQUIRED_PROPERTIES, TOOL_CALL_PROPERTY_NAMES);
    const eventUid = requiredString(properties, "event_uid");
    const projectUid = requiredString(properties, "project_uid");
    const sessionUid = requiredString(properties, "session_uid");
    if (!UUID_V4_OR_V5.test(eventUid) || !UUID_V4_OR_V5.test(projectUid) || !UUID_V4_OR_V5.test(sessionUid)) fail();

    const fingerprint = requiredString(properties, "fingerprint");
    if (!SHA256.test(fingerprint) || properties.kind !== "tool_call") fail();

    const event: Record<string, unknown> = {
      event_uid: eventUid,
      schema_id: properties.schema_id,
      event_identity_method: properties.event_identity_method,
      session_uid: sessionUid,
      session_identity_method: properties.session_identity_method,
      project_uid: projectUid,
      project_identity_method: properties.project_identity_method,
      kind: properties.kind,
      runtime_identity: canonicalJsonText(properties.runtime_identity_json).parsed,
      capture_capabilities: canonicalJsonText(properties.capture_capabilities_json).parsed,
      source: canonicalJsonText(properties.source_json).parsed,
      ingest_sequence: nonnegativeSafeInteger(properties.ingest_sequence),
      captured_at: properties.captured_at,
      content_parts: canonicalJsonText(properties.content_parts_json).parsed,
      fidelity: canonicalJsonText(properties.fidelity_json).parsed,
      native_payload_json: canonicalJsonText(properties.native_payload_json).text,
      tool_name: properties.tool_name,
    };
    if (Object.prototype.hasOwnProperty.call(properties, "source_sequence")) {
      event.source_sequence = nonnegativeSafeInteger(properties.source_sequence);
    }
    if (Object.prototype.hasOwnProperty.call(properties, "source_timestamp")) {
      event.source_timestamp = properties.source_timestamp;
    }
    if (Object.prototype.hasOwnProperty.call(properties, "extensions_json")) {
      event.extensions = canonicalJsonText(properties.extensions_json).parsed;
    }

    const canonicalEvent = event as unknown as CanonicalRawEvent;
    if (!validateCanonicalRawEvent(canonicalEvent).ok) fail();
    return { event: canonicalEvent, stored_fingerprint: fingerprint };
  } catch {
    throw new MemoryEventDecodeError();
  }
}
