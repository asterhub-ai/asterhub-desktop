import { createHash } from "node:crypto";
import { eventFingerprint, validateCanonicalRawEvent, type CanonicalRawEvent } from "@deepseek-ai/anima-capture";

const INPUT_FIELDS = ["event", "stored_fingerprint", "span"] as const;
const SPAN_FIELDS = ["text_part_index", "utf8_start", "utf8_end", "sha256"] as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_CAPTURE_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export type ExternalUserTextEvidenceInput = {
  event: CanonicalRawEvent;
  stored_fingerprint: string;
  span: {
    text_part_index: number;
    utf8_start: number;
    utf8_end: number;
    sha256: string;
  };
};

export type ExternalUserTextEvidence = {
  event_uid: string;
  project_uid: string;
  session_uid: string;
  source_kind: "external_user_message";
  text_part_index: number;
  utf8_start: number;
  utf8_end: number;
  sha256: string;
  text: string;
};

export class MemoryDirectEvidenceError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "MemoryDirectEvidenceError";
  }
}

function fail(message: string): never {
  throw new MemoryDirectEvidenceError(message);
}
function assertCanonicalCaptureUid(value: string, name: string): void {
  if (!CANONICAL_CAPTURE_UID_PATTERN.test(value)) {
    fail(`${name} must be a canonical lowercase UUIDv4 or UUIDv5.`);
  }
}

function assertRecordWithExactFields(
  value: unknown,
  fields: readonly string[],
  name: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${name} must be a plain object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) {
    fail(`${name} must contain exactly: ${fields.join(", ")}.`);
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      fail(`${name}.${field} must be an enumerable data property.`);
    }
  }
}

/** Reject non-JSON graphs and sparse/extended arrays without reproducing Capture's event schema. */
function assertCanonicalData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    fail("event contains a non-finite number.");
  }
  if (typeof value !== "object") fail("event contains a non-JSON value.");
  if (ancestors.has(value)) fail("event contains a cycle.");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail("event contains a non-canonical array.");
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || keys[keys.length - 1] !== "length") {
        fail("event contains an extended or sparse array.");
      }
      for (let index = 0; index < value.length; index += 1) {
        if (keys[index] !== String(index)) fail("event contains an extended or sparse array.");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          fail("event contains a non-canonical array item.");
        }
        assertCanonicalData(descriptor.value, ancestors);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("event contains a non-canonical object.");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail("event contains a symbol property.");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        fail("event contains a non-canonical object property.");
      }
      assertCanonicalData(descriptor.value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertSafeNonnegativeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${name} must be a non-negative safe integer.`);
  }
}

/**
 * Verifies a byte span from a complete externally sourced user message. This proves the
 * event's recorded channel and content integrity only; it does not classify the words as
 * a user assertion or establish Project ownership or memory admission.
 */
export function verifyExternalUserTextEvidence(input: unknown): ExternalUserTextEvidence {
  try {
    assertRecordWithExactFields(input, INPUT_FIELDS, "input");
    assertRecordWithExactFields(input.span, SPAN_FIELDS, "span");
    if (typeof input.stored_fingerprint !== "string" || !SHA256_PATTERN.test(input.stored_fingerprint)) {
      fail("stored_fingerprint must be a lowercase SHA-256 hash.");
    }
    assertSafeNonnegativeInteger(input.span.text_part_index, "span.text_part_index");
    assertSafeNonnegativeInteger(input.span.utf8_start, "span.utf8_start");
    assertSafeNonnegativeInteger(input.span.utf8_end, "span.utf8_end");
    if (input.span.utf8_start >= input.span.utf8_end) fail("span must be nonempty.");
    if (typeof input.span.sha256 !== "string" || !SHA256_PATTERN.test(input.span.sha256)) {
      fail("span.sha256 must be a lowercase SHA-256 hash.");
    }

    assertCanonicalData(input.event);
    const event = input.event as CanonicalRawEvent;
    const validation = validateCanonicalRawEvent(event);
    if (!validation.ok) fail(`event is not a valid Capture canonical event: ${validation.message ?? "invalid event"}`);
    assertCanonicalCaptureUid(event.event_uid, "event_uid");
    assertCanonicalCaptureUid(event.project_uid, "project_uid");
    assertCanonicalCaptureUid(event.session_uid, "session_uid");
    if (
      event.kind !== "message" ||
      event.role !== "user" ||
      event.message_origin !== "external_user" ||
      event.fidelity.completeness !== "full" ||
      event.fidelity.missing_fields.length !== 0
    ) {
      fail("event is not a complete external-user message.");
    }
    if (eventFingerprint(event) !== input.stored_fingerprint) fail("stored event fingerprint does not match the event.");

    for (let index = 0; index < event.content_parts.length; index += 1) {
      if (event.content_parts[index]?.part_index !== index) {
        fail("event content part indices must match their canonical array positions.");
      }
    }

    const part = event.content_parts[input.span.text_part_index];
    if (
      !part ||
      part.schema_id !== "anima.content-part/v1.0" ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      part.text.length === 0
    ) {
      fail("span must select a nonempty canonical text content part.");
    }

    const bytes = encoder.encode(part.text);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    if (decoder.decode(bytes) !== part.text) fail("text part is not a valid round-trippable UTF-8 string.");
    if (input.span.utf8_end > bytes.byteLength) fail("span exceeds the text part UTF-8 byte length.");
    const selectedBytes = bytes.subarray(input.span.utf8_start, input.span.utf8_end);
    let text: string;
    try {
      text = decoder.decode(selectedBytes);
    } catch {
      fail("span boundaries must align to UTF-8 code points.");
    }
    const sha256 = createHash("sha256").update(selectedBytes).digest("hex");
    if (sha256 !== input.span.sha256) fail("span SHA-256 does not match its UTF-8 bytes.");

    return {
      event_uid: event.event_uid,
      project_uid: event.project_uid,
      session_uid: event.session_uid,
      source_kind: "external_user_message",
      text_part_index: input.span.text_part_index,
      utf8_start: input.span.utf8_start,
      utf8_end: input.span.utf8_end,
      sha256,
      text,
    };
  } catch (error) {
    if (error instanceof MemoryDirectEvidenceError) throw error;
    throw new MemoryDirectEvidenceError("direct user text evidence could not be verified.");
  }
}
