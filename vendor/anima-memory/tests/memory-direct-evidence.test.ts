import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  CanonicalBuilder,
  eventFingerprint,
  validateCanonicalRawEvent,
  type CanonicalRawEvent,
  type CaptureSessionFacts,
  type SourceEventFacts,
} from "@deepseek-ai/anima-capture";
import { MemoryDirectEvidenceError, verifyExternalUserTextEvidence } from "../src/index.ts";

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
  installation_uid: "direct-evidence-installation",
  runtime: { family: "omp", version: "1", adapter_version: "direct-evidence-test" },
  profile: { method: "source", source_id: "direct-evidence-profile" },
  project: { method: "source", normalized_identity: "repo:/direct-evidence-test" },
  session: { method: "source", source_id: "direct-evidence-session" },
  capture_capabilities: capabilities,
};

function textPart(part_index: number, text: string) {
  return { schema_id: "anima.content-part/v1.0" as const, type: "text" as const, part_index, text };
}

function sourceMessage(overrides: Partial<SourceEventFacts> = {}): SourceEventFacts {
  return {
    kind: "message",
    source: { event_name: "message.created", event_id: "direct-evidence-event", session_id: "direct-evidence-session" },
    role: "user",
    message_origin: "external_user",
    content_parts: [textPart(0, "前缀你好后缀")],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { text: "fixture" },
    ...overrides,
  };
}

function buildEvent(source: SourceEventFacts = sourceMessage()): CanonicalRawEvent {
  const builder = new CanonicalBuilder({
    core_version: "direct-evidence-test",
    now: () => "2026-09-23T00:00:00.000Z",
  });
  return builder.finalize(builder.build(sessionFacts, source), 0);
}

function spanFor(event: CanonicalRawEvent, overrides: Partial<{
  text_part_index: number;
  utf8_start: number;
  utf8_end: number;
  sha256: string;
}> = {}) {
  const part = event.content_parts[0];
  const bytes = Buffer.from(part?.type === "text" ? part.text ?? "" : "", "utf8");
  const start = 0;
  const end = bytes.byteLength;
  return {
    text_part_index: 0,
    utf8_start: start,
    utf8_end: end,
    sha256: createHash("sha256").update(bytes.subarray(start, end)).digest("hex"),
    ...overrides,
  };
}

function evidenceFor(
  event: CanonicalRawEvent,
  span = spanFor(event),
  stored_fingerprint = eventFingerprint(event),
) {
  return { event, stored_fingerprint, span };
}

function expectRejected(input: unknown): void {
  expect(() => verifyExternalUserTextEvidence(input)).toThrow(MemoryDirectEvidenceError);
}

describe("verifyExternalUserTextEvidence", () => {
  test("verifies an interior UTF-8 span from a real canonical builder event", () => {
    const event = buildEvent();
    const text = "前缀你好后缀";
    const start = Buffer.byteLength("前缀", "utf8");
    const end = Buffer.byteLength("前缀你好", "utf8");
    const bytes = Buffer.from(text, "utf8");
    const sha256 = createHash("sha256").update(bytes.subarray(start, end)).digest("hex");

    expect(verifyExternalUserTextEvidence(evidenceFor(event, {
      text_part_index: 0,
      utf8_start: start,
      utf8_end: end,
      sha256,
    }))).toEqual({
      event_uid: event.event_uid,
      project_uid: event.project_uid,
      session_uid: event.session_uid,
      source_kind: "external_user_message",
      text_part_index: 0,
      utf8_start: start,
      utf8_end: end,
      sha256,
      text: "你好",
    });
  });

  test("rejects valid Capture events whose part indices are shuffled or duplicated", () => {
    for (const indices of [[1, 0], [0, 0]]) {
      const event = buildEvent(sourceMessage({
        content_parts: [textPart(indices[0]!, "first"), textPart(indices[1]!, "second")],
      }));
      expect(validateCanonicalRawEvent(event).ok).toBe(true);
      expectRejected(evidenceFor(event));
    }
  });

  test("rejects content tampering when the stored fingerprint is unchanged", () => {
    const event = buildEvent();
    const storedFingerprint = eventFingerprint(event);
    event.content_parts[0]!.text = "tampered content";
    expect(validateCanonicalRawEvent(event).ok).toBe(true);
    expectRejected(evidenceFor(event, spanFor(event), storedFingerprint));
  });

  test("rejects partial fidelity and messages with no text part", () => {
    const partial = buildEvent(sourceMessage({
      fidelity: { completeness: "partial", missing_fields: ["/content_parts"] },
    }));
    expect(validateCanonicalRawEvent(partial).ok).toBe(true);
    expectRejected(evidenceFor(partial));

    const noText = buildEvent(sourceMessage({
      content_parts: [{
        schema_id: "anima.content-part/v1.0",
        type: "json",
        part_index: 0,
        value_json: "{\"ok\":true}",
      }],
    }));
    expect(validateCanonicalRawEvent(noText).ok).toBe(true);
    expectRejected(evidenceFor(noText));
  });

  test("rejects synthetic user-channel and assistant messages", () => {
    const synthetic = buildEvent(sourceMessage({ message_origin: "runtime_synthetic" }));
    expect(validateCanonicalRawEvent(synthetic).ok).toBe(true);
    expectRejected(evidenceFor(synthetic));

    const assistant = buildEvent(sourceMessage({ role: "assistant", message_origin: undefined }));
    expect(validateCanonicalRawEvent(assistant).ok).toBe(true);
    expectRejected(evidenceFor(assistant));
  });

  test("rejects invalid exact input and span shapes", () => {
    const base = evidenceFor(buildEvent());
    expectRejected(null);
    expectRejected({ ...base, extra: true });
    expectRejected({ event: base.event, stored_fingerprint: base.stored_fingerprint });
    expectRejected({ ...base, span: { ...base.span, extra: true } });
    expectRejected({ ...base, span: { ...base.span, text_part_index: -1 } });
    expectRejected({ ...base, span: { ...base.span, text_part_index: 1 } });
    expectRejected({ ...base, span: { ...base.span, text_part_index: 0.5 } });
    expectRejected({ ...base, span: { ...base.span, utf8_start: -1 } });
    expectRejected({ ...base, span: { ...base.span, utf8_end: Number.MAX_SAFE_INTEGER + 1 } });
    expectRejected({ ...base, span: { ...base.span, utf8_start: 2, utf8_end: 2 } });
    expectRejected({ ...base, span: { ...base.span, utf8_end: Buffer.byteLength("前缀你好后缀", "utf8") + 1 } });
    expectRejected({ ...base, stored_fingerprint: "A".repeat(64) });
    expectRejected({ ...base, span: { ...base.span, sha256: "a".repeat(63) } });
    expectRejected({ ...base, span: { ...base.span, sha256: "0".repeat(64) } });
    expectRejected(Object.assign(Object.create({ inherited: true }), base));
  });

  test("rejects a span that starts or ends inside a multibyte code point", () => {
    const event = buildEvent();
    const bytes = Buffer.from("前缀你好后缀", "utf8");
    const start = Buffer.byteLength("前缀", "utf8") + 1;
    const end = start + 1;
    const sha256 = createHash("sha256").update(bytes.subarray(start, end)).digest("hex");
    expectRejected(evidenceFor(event, { text_part_index: 0, utf8_start: start, utf8_end: end, sha256 }));
  });

  test("rejects invalid Capture events and sparse content arrays", () => {
    const invalid = buildEvent();
    invalid.event_uid = "not-a-uuid";
    expectRejected(evidenceFor(invalid));

    const sparse = buildEvent();
    sparse.content_parts = new Array(1) as CanonicalRawEvent["content_parts"];
    expectRejected(evidenceFor(sparse));
  });
});
