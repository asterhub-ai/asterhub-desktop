import { expect, test } from "vitest";
import { CanonicalBuilder, RawEventWriter, type ResolvedSessionContext } from "../src/index.ts";
import type { CanonicalRawEventDraft } from "../src/canonical-types.ts";

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

function contextFacts(sessionId: string) {
  return {
    installation_uid: "writer-lifecycle-installation",
    runtime: { family: "writer-lifecycle", adapter_version: "test" },
    profile: { method: "derived" as const, anchor: "profile" },
    project: { method: "derived" as const, normalized_identity: "project" },
    session: { method: "source" as const, source_id: sessionId },
    capture_capabilities: capabilities,
  };
}


test("reports indeterminate when Neo4j errors at the event CREATE boundary", async () => {
  const builder = new CanonicalBuilder({ core_version: "writer-lifecycle" });
  const context: ResolvedSessionContext = builder.openSession(contextFacts("session-1"));
  const draft = builder.build(context, {
    kind: "message",
    source: { event_name: "message", event_id: "event-1", session_id: "session-1" },
    message_origin: "external_user",
    role: "user",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "hello" }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { ok: true },
  });
  const sessionProperties = {
    session_identity_method: context.session.method,
    identity_fingerprint: context.session.fingerprint,
    project_uid: context.project_uid,
    project_identity_method: context.project.method,
    profile_uid: context.profile_uid,
    profile_identity_method: context.profile.method,
    profile_identity_fingerprint: context.profile.fingerprint,
    runtime_family: context.facts.runtime.family,
    source_session_id: "session-1",
  };
  const record = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });
  const transaction = {
    run: async (query: string) => {
      if (query.includes("MERGE (p:Project")) {
        return { records: [record({ p: { properties: { identity_fingerprint: context.project.fingerprint } } })] };
      }
      if (query.includes("MERGE (s:Session")) {
        return { records: [record({ s: { properties: sessionProperties } })] };
      }
      if (query.includes("next_ingest_sequence + 1")) return { records: [record({ ingest_sequence: 0 })] };
      if (query.includes("s.next_ingest_sequence = s.next_ingest_sequence")) return { records: [] };
      if (query.includes("CREATE (e:RawEvent")) throw new Error("commit acknowledgement lost");
      return { records: [] };
    },
  };
  const store = {
    executeWrite: async <T>(work: (tx: typeof transaction) => Promise<T>) => work(transaction),
  };
  const writerBuilder = {
    finalize: (value: CanonicalRawEventDraft, ingest_sequence: number) => ({ ...value, ingest_sequence }),
  };
  const result = await new RawEventWriter(store as never, writerBuilder as never).write(draft, context);
  expect(result).toEqual({
    status: "indeterminate",
    event_uid: draft.event_uid,
    message: "Neo4j write outcome is unknown.",
  });
});
