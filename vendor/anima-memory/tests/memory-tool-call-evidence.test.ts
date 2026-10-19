import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { canonicalize } from "json-canonicalize";
import {
  CanonicalBuilder,
  eventFingerprint,
  type CanonicalRawEvent,
  type CaptureSessionFacts,
  type SourceEventFacts,
} from "@deepseek-ai/anima-capture";
import {
  MemoryGraphEvidenceError,
  readRegisteredSaveToolCallEvidence,
  registerProjectOwnership,
  type MemoryDirectEvidenceReaderTransaction,
  type ProjectOwnershipScope,
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
  installation_uid: "memory-tool-call-evidence-installation",
  runtime: { family: "omp", version: "1", adapter_version: "memory-tool-call-evidence-test" },
  profile: { method: "source", source_id: "memory-tool-call-evidence-profile" },
  project: { method: "source", normalized_identity: "repo:/memory-tool-call-evidence-test" },
  session: { method: "source", source_id: "memory-tool-call-evidence-session" },
  capture_capabilities: capabilities,
};

const inputArgs = { narrative: "Called save with this text" };
const toolCallId = "tool-call-evidence-id";

function buildToolCall(overrides: Partial<{
  tool_name: string;
  tool_call_id: string;
  native_type: string;
  native_tool_call_id: string;
  native_tool_name: string;
  input: unknown;
}> = {}): CanonicalRawEvent {
  const callId = overrides.tool_call_id ?? toolCallId;
  const input = overrides.input ?? inputArgs;
  const source: SourceEventFacts = {
    kind: "tool_call",
    source: {
      event_name: "tool_call",
      event_id: `tool-call:${callId}`,
      session_id: "memory-tool-call-evidence-session",
    },
    tool_name: overrides.tool_name ?? "anima_save",
    content_parts: [{
      schema_id: "anima.content-part/v1.0",
      type: "json",
      part_index: 0,
      value_json: canonicalize(input as never),
    }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: {
      type: overrides.native_type ?? "tool_call",
      toolCallId: overrides.native_tool_call_id ?? callId,
      toolName: overrides.native_tool_name ?? overrides.tool_name ?? "anima_save",
      input: input as never,
    },
    extensions: { "anima.tool.source_call_id": callId },
  };
  const builder = new CanonicalBuilder({
    core_version: "memory-tool-call-evidence-test",
    now: () => "2026-09-23T00:00:00.000Z",
  });
  return builder.finalize(builder.build(sessionFacts, source), 0);
}

function storedNode(event: CanonicalRawEvent, malformedParts = false): { labels: string[]; properties: Record<string, unknown> } {
  return {
    labels: ["RawEvent", "ToolCall"],
    properties: {
      event_uid: event.event_uid,
      schema_id: event.schema_id,
      event_identity_method: event.event_identity_method,
      session_uid: event.session_uid,
      session_identity_method: event.session_identity_method,
      project_uid: event.project_uid,
      project_identity_method: event.project_identity_method,
      kind: event.kind,
      runtime_identity_json: canonicalize(event.runtime_identity as never),
      capture_capabilities_json: canonicalize(event.capture_capabilities as never),
      source_json: canonicalize(event.source as never),
      ingest_sequence: event.ingest_sequence,
      captured_at: event.captured_at,
      content_parts_json: malformedParts ? "{" : canonicalize(event.content_parts as never),
      fidelity_json: canonicalize(event.fidelity as never),
      native_payload_json: event.native_payload_json,
      fingerprint: eventFingerprint(event),
      tool_name: event.tool_name,
      extensions_json: canonicalize(event.extensions as never),
      "anima.tool.source_call_id": event.extensions?.["anima.tool.source_call_id"],
    },
  };
}

function result(...values: Record<string, unknown>[]) {
  return { records: values.map((value) => ({ get: (key: string) => value[key] })) };
}

function transactionFor(
  event: CanonicalRawEvent,
  options: { missingScopedEvent?: boolean; foreignScopedEventUid?: string; mixedEventOwners?: boolean; malformedParts?: boolean } = {},
): MemoryDirectEvidenceReaderTransaction {
  const node = storedNode(event, options.malformedParts);
  const fingerprint = "a".repeat(64);
  return {
    async run(query, parameters = {}) {
      if (query.includes("MATCH (p:Project {project_uid:") && query.includes("labels(p)")) {
        return result({ labels: ["Project"], properties: { project_uid: event.project_uid, identity_fingerprint: fingerprint } });
      }
      if (query.includes("MATCH (s:Session {session_uid:") && query.includes("labels(s)")) {
        return result({ labels: ["Session"], properties: { session_uid: event.session_uid, project_uid: event.project_uid, next_ingest_sequence: 1 } });
      }
      if (query.includes("RETURN count(s) AS count")) return result({ count: 1 });
      if (query.includes("MATCH (e:RawEvent {") && query.includes("labels(e)")) {
        if (
          options.missingScopedEvent ||
          parameters.event_uid !== event.event_uid ||
          parameters.event_uid === options.foreignScopedEventUid
        ) return { records: [] };
        return result({ labels: node.labels, properties: node.properties });
      }
      if (query.includes("RETURN count(e) AS count")) return result({ count: 1 });
      if (query.includes("RETURN labels(owner) AS owner_labels")) {
        if (options.mixedEventOwners && query.includes("HAS_EVENT")) {
          return result(
            { owner_labels: ["Session"], owner_properties: { session_uid: event.session_uid, project_uid: event.project_uid }, relationship_properties: {} },
            { owner_labels: ["Session"], owner_properties: { session_uid: event.session_uid, project_uid: event.project_uid }, relationship_properties: {} },
          );
        }
        const projectOwner = query.includes("HAS_SESSION") || query.includes("IN_PROJECT");
        return result({
          owner_labels: projectOwner ? ["Project"] : ["Session"],
          owner_properties: projectOwner
            ? { project_uid: event.project_uid }
            : { session_uid: event.session_uid, project_uid: event.project_uid },
          relationship_properties: {},
        });
      }
      return { records: [] };
    },
  };
}

const userDirectoryUid = "b5234567-e89b-4d3a-8456-426614174017";
const scope: ProjectOwnershipScope = {
  users_root: resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/memory-tool-call-evidence-tests/users"),
  directory_id: userDirectoryUid,
  principal_uid: "a5234567-e89b-4d3a-8456-426614174016",
  directory: join(resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/memory-tool-call-evidence-tests/users"), userDirectoryUid),
};
const identityFingerprint = "a".repeat(64);

async function prepareScope(event: CanonicalRawEvent): Promise<void> {
  await mkdir(join(scope.directory, "data"), { recursive: true });
  await registerProjectOwnership(scope, {
    project_uid: event.project_uid,
    identity_fingerprint: identityFingerprint,
  });
}

async function readEvidence(
  event: CanonicalRawEvent,
  params: unknown = { type: "experience", title: "", narrative: inputArgs.narrative, context: "", principle: "", tags: [] },
  options: Parameters<typeof transactionFor>[1] = {},
  uid = event.event_uid,
) {
  await prepareScope(event);
  return readRegisteredSaveToolCallEvidence({
    transaction: transactionFor(event, options),
    scope,
    project_uid: event.project_uid,
    session_uid: event.session_uid,
    event_uid: uid,
    tool_call_id: toolCallId,
    params,
  });
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

describe("registered anima_save ToolCall evidence", () => {
  test("verifies the invocation and hashes normalized legacy defaults", async () => {
    const event = buildToolCall();
    const evidence = await readEvidence(event);
    const normalized = {
      type: "experience",
      title: "",
      narrative: inputArgs.narrative,
      context: "",
      principle: "",
      tags: [],
    };
    expect(evidence).toEqual({
      principal_uid: scope.principal_uid,
      project_uid: event.project_uid,
      session_uid: event.session_uid,
      event_uid: event.event_uid,
      normalized_save_args: normalized,
      normalized_args_sha256: createHash("sha256").update(canonicalize(normalized as never), "utf8").digest("hex"),
      source_kind: "tool_invocation",
    });
  });

  test("accepts title-only input while preserving its raw fields", async () => {
    const args = { title: "  Heading  ", narrative: "" };
    const event = buildToolCall({ input: args });
    const evidence = await readEvidence(event, args);
    expect(evidence.normalized_save_args).toMatchObject({
      type: "experience",
      title: "  Heading  ",
      narrative: "",
      context: "",
      principle: "",
      tags: [],
    });
  });

  test("rejects blank narratives, unknown fields, and malformed legacy values", async () => {
    const event = buildToolCall();
    for (const params of [
      { title: "  ", narrative: " \t " },
      { narrative: "valid", extra: true },
      { narrative: "valid", context: 2 },
      { narrative: "valid", tags: ["ok", 2] },
    ]) {
      await expectCode(() => readEvidence(event, params), "evidence_invalid");
    }
  });

  test("returns the same scoped failure for absent and foreign event UIDs", async () => {
    const event = buildToolCall();
    const absent = await readEvidence(event, undefined, { missingScopedEvent: true }, "b5234567-e89b-4d3a-8456-426614174017").catch((error) => error);
    const foreign = await readEvidence(event, undefined, { foreignScopedEventUid: "c5234567-e89b-4d3a-8456-426614174018" }, "c5234567-e89b-4d3a-8456-426614174018").catch((error) => error);
    expect(absent).toBeInstanceOf(MemoryGraphEvidenceError);
    expect(foreign).toBeInstanceOf(MemoryGraphEvidenceError);
    expect(absent).toMatchObject({ code: "source_incomplete" });
    expect(foreign).toMatchObject({ code: "source_incomplete" });
    expect((foreign as Error).message).toBe((absent as Error).message);
  });

  test("rejects wrong tool names and call IDs", async () => {
    const wrongName = buildToolCall({ tool_name: "anima_search" });
    await expectCode(() => readEvidence(wrongName), "evidence_invalid");

    const event = buildToolCall();
    await expectCode(() => readEvidence(event, undefined, {}, "d5234567-e89b-4d3a-8456-426614174019"), "source_incomplete");
    await prepareScope(event);
    await expectCode(() => readRegisteredSaveToolCallEvidence({
      transaction: transactionFor(event),
      scope,
      project_uid: event.project_uid,
      session_uid: event.session_uid,
      event_uid: event.event_uid,
      tool_call_id: "different-tool-call-id",
      params: { narrative: inputArgs.narrative },
    }), "evidence_invalid");
  });

  test("rejects native payload type, tool ID, or tool name disagreement", async () => {
    for (const overrides of [
      { native_type: "tool_result" },
      { native_tool_call_id: "other-tool-call-id" },
      { native_tool_name: "anima_search" },
    ]) {
      await expectCode(() => readEvidence(buildToolCall(overrides)), "evidence_invalid");
    }
  });

  test("rejects retargeted execute parameters and malformed stored JSON", async () => {
    const event = buildToolCall();
    await expectCode(() => readEvidence(event, { narrative: "retargeted" }), "evidence_invalid");
    await expectCode(() => readEvidence(event, undefined, { malformedParts: true }), "evidence_invalid");
  });

  test("rejects mixed Session ownership of the RawEvent", async () => {
    await expectCode(() => readEvidence(buildToolCall(), undefined, { mixedEventOwners: true }), "identity_conflict");
  });
});
