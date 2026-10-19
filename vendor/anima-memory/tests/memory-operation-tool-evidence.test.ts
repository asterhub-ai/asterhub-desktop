import { describe, expect, test } from "vitest";
import { canonicalize } from "json-canonicalize";
import { CanonicalBuilder, eventFingerprint, type CaptureSessionFacts, type SourceEventFacts } from "@deepseek-ai/anima-capture";
import { verifyMemoryOperationToolCall } from "../src/memory-operation-tool-evidence.ts";
import { MemoryGraphEvidenceError, type RegisteredRawEventGraph } from "../src/memory-direct-evidence-reader.ts";
import type { MemoryOperationInput } from "../src/types.ts";

const params = {
  memory_uid: "11111111-1111-4111-8111-111111111111",
  expected_revision_uid: "22222222-2222-4222-8222-222222222222",
  action: "revise" as const, statement: "用户的新内容",
};
const session: CaptureSessionFacts = {
  installation_uid: "synthetic-operation-installation",
  runtime: { family: "omp", version: "1", adapter_version: "synthetic-operation-test" },
  profile: { method: "source", source_id: "synthetic-operation-profile" },
  project: { method: "source", normalized_identity: "repo:/synthetic-operation" },
  session: { method: "source", source_id: "synthetic-session" },
  capture_capabilities: {
    schema_id: "anima.capture-capabilities/v1.0", stable_session_id: true, stable_event_id: true,
    stable_tool_call_id: true, final_assistant_message: true, final_tool_result: true,
    developer_messages: true, multimodal_content: true, source_sequence: true, source_timestamp: true,
    compact_event: true, shutdown_event: true, user_message_origin: true, turn_end_event: true,
  },
};
function operationGraph(overrides: { toolName?: string; args?: object; nativeArgs?: object; corruptFingerprint?: boolean } = {}): RegisteredRawEventGraph {
  const input = overrides.args ?? params;
  const source: SourceEventFacts = {
    kind: "tool_call",
    source: { event_name: "tool_call", event_id: "tool-call:edit-1", session_id: "synthetic-session" },
    tool_name: overrides.toolName ?? "anima_memory_operation",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "json", part_index: 0, value_json: canonicalize(input as never) }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { type: "tool_call", toolCallId: "edit-1", toolName: overrides.toolName ?? "anima_memory_operation", input: (overrides.nativeArgs ?? input) as never },
    extensions: { "anima.tool.source_call_id": "edit-1" },
  };
  const builder = new CanonicalBuilder({ core_version: "synthetic-operation-test", now: () => "2026-09-23T00:00:00.000Z" });
  const event = builder.finalize(builder.build(session, source), 0);
  return {
    registeredProject: {} as RegisteredRawEventGraph["registeredProject"],
    nextIngestSequence: 1,
    eventSnapshot: {
      labels: ["RawEvent", "ToolCall"],
      properties: {
        event_uid: event.event_uid, schema_id: event.schema_id, event_identity_method: event.event_identity_method,
        session_uid: event.session_uid, session_identity_method: event.session_identity_method,
        project_uid: event.project_uid, project_identity_method: event.project_identity_method,
        kind: event.kind, runtime_identity_json: canonicalize(event.runtime_identity as never),
        capture_capabilities_json: canonicalize(event.capture_capabilities as never),
        source_json: canonicalize(event.source as never), ingest_sequence: event.ingest_sequence,
        captured_at: event.captured_at, content_parts_json: canonicalize(event.content_parts as never),
        fidelity_json: canonicalize(event.fidelity as never), native_payload_json: event.native_payload_json,
        fingerprint: overrides.corruptFingerprint ? "0".repeat(64) : eventFingerprint(event),
        tool_name: event.tool_name, extensions_json: canonicalize(event.extensions as never),
        "anima.tool.source_call_id": "edit-1",
      },
    },
  };
}
function proposal(graph: RegisteredRawEventGraph) {
  return {
    project_uid: graph.eventSnapshot.properties.project_uid as string,
    session_uid: graph.eventSnapshot.properties.session_uid as string,
    operation_event_uid: graph.eventSnapshot.properties.event_uid as string,
    tool_call_id: "edit-1",
    ...params,
  } satisfies Pick<MemoryOperationInput, "project_uid" | "session_uid" | "operation_event_uid" | "tool_call_id" | "memory_uid" | "expected_revision_uid" | "action" | "statement">;
}

describe("memory operation tool evidence", () => {
  test("accepts only the exact registered user-approved operation proposal", () => {
    const graph = operationGraph();
    expect(() => verifyMemoryOperationToolCall(graph, proposal(graph))).not.toThrow();
    expect(() => verifyMemoryOperationToolCall(graph, { ...proposal(graph), action: "revoke" })).toThrow();
    let error: unknown;
    try {
      verifyMemoryOperationToolCall(graph, { ...proposal(graph), tool_call_id: "edit-2" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MemoryGraphEvidenceError);
    expect(error).toMatchObject({ code: "evidence_invalid" });
    expect(() => verifyMemoryOperationToolCall(graph, { ...proposal(graph), memory_uid: "33333333-3333-4333-8333-333333333333" })).toThrow();
  });
  test("rejects other tools, changed native input and changed event fingerprint", () => {
    for (const graph of [
      operationGraph({ toolName: "anima_save" }),
      operationGraph({ nativeArgs: { ...params, action: "revoke" } }),
      operationGraph({ corruptFingerprint: true }),
    ]) expect(() => verifyMemoryOperationToolCall(graph, proposal(graph))).toThrow();
  });
});
