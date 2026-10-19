import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { eventFingerprint, type CanonicalRawEvent } from "@deepseek-ai/anima-capture";
import type { ProjectOwnershipScope } from "./project-ownership.ts";
import {
  isRecord,
  MemoryGraphEvidenceError,
  readRegisteredRawEventGraph,
  type MemoryDirectEvidenceReaderTransaction,
} from "./memory-direct-evidence-reader.ts";
import { decodeStoredToolCall } from "./memory-event-decoder.ts";

const SAVE_FIELDS = ["type", "title", "narrative", "context", "principle", "tags"] as const;

type SaveField = typeof SAVE_FIELDS[number];
export type NormalizedSaveArgs = {
  type: string;
  title: string;
  narrative: string;
  context: string;
  principle: string;
  tags: string[];
};

export interface ReadRegisteredSaveToolCallEvidenceInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  project_uid: string;
  session_uid: string;
  event_uid: string;
  tool_call_id: string;
  params: unknown;
}

export interface RegisteredSaveToolCallEvidence {
  principal_uid: string;
  project_uid: string;
  session_uid: string;
  event_uid: string;
  normalized_save_args: NormalizedSaveArgs;
  normalized_args_sha256: string;
  source_kind: "tool_invocation";
}

function fail(): never {
  throw new MemoryGraphEvidenceError("evidence_invalid");
}



function snapshotObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !SAVE_FIELDS.includes(key as SaveField)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail();
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotTags(value: unknown): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) fail();
  const tags: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") fail();
    tags.push(descriptor.value);
  }
  return tags;
}

/** Applies only the legacy anima_save defaults; field values remain untouched for comparison and hashing. */
export function normalizeSaveToolArgs(value: unknown): NormalizedSaveArgs {
  const input = snapshotObject(value);
  if (!Object.hasOwn(input, "narrative") || typeof input.narrative !== "string") fail();
  for (const key of ["type", "title", "context", "principle"] as const) {
    if (Object.hasOwn(input, key) && typeof input[key] !== "string") fail();
  }
  const tags = Object.hasOwn(input, "tags") ? snapshotTags(input.tags) : [];
  const normalized: NormalizedSaveArgs = {
    type: (input.type as string | undefined) ?? "experience",
    title: (input.title as string | undefined) ?? "",
    narrative: input.narrative,
    context: (input.context as string | undefined) ?? "",
    principle: (input.principle as string | undefined) ?? "",
    tags,
  };
  if (normalized.title.trim().length === 0 && normalized.narrative.trim().length === 0) fail();
  return normalized;
}

function canonicalJson(value: unknown): string {
  try {
    return canonicalize(value as never);
  } catch {
    return fail();
  }
}

function nativeToolInput(event: CanonicalRawEvent, tool_call_id: string): unknown {
  try {
    const payload: unknown = JSON.parse(event.native_payload_json);
    if (
      !isRecord(payload) ||
      payload.type !== "tool_call" ||
      payload.toolCallId !== tool_call_id ||
      payload.toolName !== event.tool_name ||
      !Object.hasOwn(payload, "input")
    ) fail();
    return payload.input;
  } catch {
    return fail();
  }
}

/**
 * Verifies that this registered graph contains the exact anima_save ToolCall represented by the
 * current execution parameters. The evidence proves a tool invocation only, never authorship.
 */
export async function readRegisteredSaveToolCallEvidence(
  input: ReadRegisteredSaveToolCallEvidenceInput,
): Promise<RegisteredSaveToolCallEvidence> {
  if (
    !isRecord(input) ||
    typeof input.transaction?.run !== "function" ||
    typeof input.tool_call_id !== "string" || input.tool_call_id.length === 0
  ) fail();
  const { transaction, scope, project_uid, session_uid, event_uid, tool_call_id, params } = input;
  const graph = await readRegisteredRawEventGraph(transaction, scope, project_uid, session_uid, event_uid);

  let decoded: { event: CanonicalRawEvent; stored_fingerprint: string };
  try {
    decoded = decodeStoredToolCall({
      labels: graph.eventSnapshot.labels,
      properties: graph.eventSnapshot.properties,
    });
  } catch {
    return fail();
  }
  const event = decoded.event;
  if (
    event.event_uid !== event_uid ||
    event.project_uid !== project_uid ||
    event.session_uid !== session_uid
  ) throw new MemoryGraphEvidenceError("identity_conflict");
  if (event.ingest_sequence >= graph.nextIngestSequence) throw new MemoryGraphEvidenceError("identity_conflict");
  const part = event.content_parts.length === 1 ? event.content_parts[0] : undefined;
  if (
    event.kind !== "tool_call" ||
    event.tool_name !== "anima_save" ||
    event.source.event_id !== `tool-call:${tool_call_id}` ||
    event.extensions?.["anima.tool.source_call_id"] !== tool_call_id ||
    graph.eventSnapshot.properties["anima.tool.source_call_id"] !== tool_call_id ||
    event.fidelity.completeness !== "full" ||
    event.fidelity.missing_fields.length !== 0 ||
    part?.type !== "json" ||
    part.part_index !== 0 ||
    typeof part.value_json !== "string"
  ) fail();

  let capturedArgs: NormalizedSaveArgs;
  let executeArgs: NormalizedSaveArgs;
  let partValue: unknown;
  try {
    partValue = JSON.parse(part.value_json);
    capturedArgs = normalizeSaveToolArgs(partValue);
    executeArgs = normalizeSaveToolArgs(params);
  } catch {
    return fail();
  }
  const nativeInput = nativeToolInput(event, tool_call_id);
  if (canonicalJson(nativeInput) !== part.value_json) fail();
  if (canonicalJson(capturedArgs) !== canonicalJson(executeArgs)) fail();

  const normalizedArgsJson = canonicalJson(executeArgs);
  const normalized_args_sha256 = createHash("sha256").update(normalizedArgsJson, "utf8").digest("hex");
  if (eventFingerprint(event) !== decoded.stored_fingerprint) fail();

  const registered = graph.registeredProject;
  return {
    principal_uid: registered.principal_uid,
    project_uid,
    session_uid,
    event_uid,
    normalized_save_args: executeArgs,
    normalized_args_sha256,
    source_kind: "tool_invocation",
  };
}
