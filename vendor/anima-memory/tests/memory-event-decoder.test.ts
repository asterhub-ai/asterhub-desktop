import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import neo4j from "neo4j-driver";
import { canonicalize } from "json-canonicalize";
import {
  CanonicalBuilder,
  eventFingerprint,
  type CanonicalRawEvent,
  type CaptureSessionFacts,
  type SourceEventFacts,
} from "@deepseek-ai/anima-capture";
import {
  MemoryEventDecodeError,
  decodeStoredExternalUserMessage,
  verifyExternalUserTextEvidence,
} from "../src/index.ts";

const capabilities = {
  schema_id: "anima.capture-capabilities/v1.0" as const,
  stable_session_id: true,
  stable_event_id: true,
  stable_tool_call_id: true,
  final_assistant_message: true,
  final_tool_result: true,
  developer_messages: true,
  multimodal_content: true,
  source_sequence: true,
  source_timestamp: true,
  compact_event: true,
  shutdown_event: true,
  user_message_origin: true,
  turn_end_event: true,
};

const sessionFacts: CaptureSessionFacts = {
  installation_uid: "memory-event-decoder-installation",
  runtime: { family: "omp", version: "1", adapter_version: "memory-event-decoder-test" },
  profile: { method: "source", source_id: "memory-event-decoder-profile" },
  project: { method: "source", normalized_identity: "repo:/memory-event-decoder-test" },
  session: { method: "source", source_id: "memory-event-decoder-session" },
  capture_capabilities: capabilities,
};

function buildMessage(): CanonicalRawEvent {
  const builder = new CanonicalBuilder({
    core_version: "memory-event-decoder-test",
    now: () => "2026-09-23T00:00:00.000Z",
  });
  const source: SourceEventFacts = {
    kind: "message",
    source: { event_name: "message.created", event_id: "memory-event-decoder-event", session_id: "memory-event-decoder-session" },
    source_sequence: 7,
    source_timestamp: "2026-09-22T23:59:59.000Z",
    role: "user",
    message_origin: "external_user",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "前缀你好后缀" }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { message: "前缀你好后缀", nested: { ok: true } },
    extensions: { "anima.test.capture": { note: "preserved" } },
  };
  return builder.finalize(builder.build(sessionFacts, source), 0);
}

function storedNode(event: CanonicalRawEvent): { labels: string[]; properties: Record<string, unknown> } {
  return {
    labels: ["Message", "RawEvent"],
    properties: {
      event_uid: event.event_uid,
      schema_id: event.schema_id,
      event_identity_method: event.event_identity_method,
      session_uid: event.session_uid,
      session_identity_method: event.session_identity_method,
      project_uid: event.project_uid,
      project_identity_method: event.project_identity_method,
      kind: event.kind,
      runtime_identity_json: canonicalize(event.runtime_identity),
      capture_capabilities_json: canonicalize(event.capture_capabilities),
      source_json: canonicalize(event.source),
      ingest_sequence: event.ingest_sequence,
      captured_at: event.captured_at,
      content_parts_json: canonicalize(event.content_parts),
      fidelity_json: canonicalize(event.fidelity),
      native_payload_json: event.native_payload_json,
      fingerprint: eventFingerprint(event),
      role: event.role,
      message_origin: event.message_origin,
      ...(event.source_sequence === undefined ? {} : { source_sequence: event.source_sequence }),
      ...(event.source_timestamp === undefined ? {} : { source_timestamp: event.source_timestamp }),
      ...(event.extensions === undefined ? {} : { extensions_json: canonicalize(event.extensions) }),
    },
  };
}

function spanFor(event: CanonicalRawEvent) {
  const text = event.content_parts[0]?.type === "text" ? event.content_parts[0].text ?? "" : "";
  const bytes = Buffer.from(text, "utf8");
  const utf8Start = Buffer.byteLength("前缀", "utf8");
  const utf8End = Buffer.byteLength("前缀你好", "utf8");
  return {
    text_part_index: 0,
    utf8_start: utf8Start,
    utf8_end: utf8End,
    sha256: createHash("sha256").update(bytes.subarray(utf8Start, utf8End)).digest("hex"),
  };
}

function expectRejected(input: unknown): void {
  expect(() => decodeStoredExternalUserMessage(input)).toThrow(MemoryEventDecodeError);
}

describe("decodeStoredExternalUserMessage", () => {
  test("round-trips a CanonicalBuilder event through writer-shaped properties and UTF-8 evidence", () => {
    const original = buildMessage();
    const stored = storedNode(original);
    stored.properties.ingest_sequence = neo4j.int(0);
    stored.properties.source_sequence = neo4j.int(7);

    const decoded = decodeStoredExternalUserMessage(stored);
    expect(decoded).toEqual({ event: original, stored_fingerprint: eventFingerprint(original) });
    const evidence = verifyExternalUserTextEvidence({
      ...decoded,
      span: spanFor(decoded.event),
    });
    expect(evidence.text).toBe("你好");
    expect(evidence.event_uid).toBe(original.event_uid);
  });

  test("rejects malformed or noncanonical property JSON without including its contents in errors", () => {
    const base = storedNode(buildMessage());
    const malformed = structuredClone(base);
    malformed.properties.runtime_identity_json = "{private message content";
    expect(() => decodeStoredExternalUserMessage(malformed)).toThrow(MemoryEventDecodeError);
    try {
      decodeStoredExternalUserMessage(malformed);
    } catch (error) {
      expect((error as Error).message).not.toContain("private message content");
    }

    const noncanonical = structuredClone(base);
    noncanonical.properties.native_payload_json = `${String(noncanonical.properties.native_payload_json)} `;
    expectRejected(noncanonical);
  });

  test("rejects missing and extra graph properties and malformed label sets", () => {
    const base = storedNode(buildMessage());
    const missing = structuredClone(base);
    delete missing.properties.fidelity_json;
    expectRejected(missing);

    const extra = structuredClone(base);
    extra.properties.unrecognized = true;
    expectRejected(extra);
    expectRejected({ ...base, extra: true });
    expectRejected({ ...base, labels: ["RawEvent", "RawEvent"] });
    expectRejected({ ...base, labels: ["Message", "RawEvent", "Project"] });
    expectRejected({ ...base, labels: ["Message"] });
  });

  test("rejects unsafe ingest sequences, absent external-user source, and invalid UUIDs", () => {
    const base = storedNode(buildMessage());
    for (const sequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, neo4j.int("9223372036854775807")]) {
      const invalid = structuredClone(base);
      invalid.properties.ingest_sequence = sequence;
      expectRejected(invalid);
    }
    const badSourceSequence = structuredClone(base);
    badSourceSequence.properties.source_sequence = neo4j.int("9223372036854775807");
    expectRejected(badSourceSequence);

    const missingOrigin = structuredClone(base);
    delete missingOrigin.properties.message_origin;
    expectRejected(missingOrigin);
    const syntheticOrigin = structuredClone(base);
    syntheticOrigin.properties.message_origin = "runtime_synthetic";
    expectRejected(syntheticOrigin);

    const invalidUid = structuredClone(base);
    invalidUid.properties.project_uid = "00000000-0000-1000-8000-000000000000";
    expectRejected(invalidUid);
  });
});
