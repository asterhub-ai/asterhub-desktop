import { eventFingerprint } from "@deepseek-ai/anima-capture";
import { canonicalize } from "json-canonicalize";
import { MemoryGraphEvidenceError, type RegisteredRawEventGraph } from "./memory-direct-evidence-reader.ts";
import { decodeStoredToolCall } from "./memory-event-decoder.ts";
import type { MemoryOperationInput } from "./types.ts";

function fail(): never { throw new MemoryGraphEvidenceError("evidence_invalid"); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown): string {
  try { return canonicalize(value as never); } catch { return fail(); }
}

/** Verifies an authorized graph event records the exact user-approved memory operation proposal. */
export function verifyMemoryOperationToolCall(
  graph: RegisteredRawEventGraph,
  input: Pick<MemoryOperationInput, "project_uid" | "session_uid" | "operation_event_uid" | "tool_call_id" | "memory_uid" | "expected_revision_uid" | "action" | "statement" | "valid_until">,
): void {
  let decoded: ReturnType<typeof decodeStoredToolCall>;
  try { decoded = decodeStoredToolCall(graph.eventSnapshot); }
  catch { return fail(); }
  const { event, stored_fingerprint } = decoded;
  if (event.event_uid !== input.operation_event_uid || event.project_uid !== input.project_uid ||
      event.session_uid !== input.session_uid || event.kind !== "tool_call" ||
      event.tool_name !== "anima_memory_operation" || event.fidelity.completeness !== "full" ||
      event.fidelity.missing_fields.length !== 0 || eventFingerprint(event) !== stored_fingerprint ||
      event.ingest_sequence >= graph.nextIngestSequence || event.content_parts.length !== 1 ||
      event.content_parts[0]?.type !== "json" || event.content_parts[0].part_index !== 0 ||
      typeof event.content_parts[0].value_json !== "string") fail();
  const part = event.content_parts[0].value_json;
  let payload: unknown;
  let captured: unknown;
  try {
    payload = JSON.parse(event.native_payload_json);
    captured = JSON.parse(part);
  } catch { return fail(); }
  if (!record(payload) || payload.type !== "tool_call" || payload.toolName !== event.tool_name ||
      typeof payload.toolCallId !== "string" || payload.toolCallId.length === 0 ||
      payload.toolCallId !== input.tool_call_id ||
      event.source.event_id !== `tool-call:${payload.toolCallId}` ||
      event.extensions?.["anima.tool.source_call_id"] !== payload.toolCallId ||
      graph.eventSnapshot.properties["anima.tool.source_call_id"] !== payload.toolCallId ||
      !record(captured) || canonical(captured) !== part || canonical(payload.input) !== part) fail();
  const keys = ["memory_uid", "expected_revision_uid", "action",
    ...(input.action === "revise" ? ["statement"] : []),
    ...(input.action === "set_expiry" ? ["valid_until"] : [])];
  if (Object.keys(captured).length !== keys.length || !keys.every((key) => Object.hasOwn(captured, key)) ||
      captured.memory_uid !== input.memory_uid || captured.expected_revision_uid !== input.expected_revision_uid ||
      captured.action !== input.action ||
      (input.action === "revise" && (typeof captured.statement !== "string" ||
        captured.statement.normalize("NFC").trim() !== input.statement?.normalize("NFC").trim())) ||
      (input.action === "set_expiry" && captured.valid_until !== input.valid_until)) fail();
}
