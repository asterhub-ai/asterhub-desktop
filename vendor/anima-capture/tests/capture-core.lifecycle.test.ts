import { expect, test } from "vitest";
import { CaptureCore, type AppendResult, type CaptureSessionFacts, type CanonicalRawEventDraft, type ResolvedSessionContext, type SourceEventFacts } from "../src/index.ts";

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

function facts(sessionId: string): CaptureSessionFacts {
  return {
    installation_uid: "capture-lifecycle-installation",
    runtime: { family: "capture-lifecycle", adapter_version: "test" },
    profile: { method: "derived", anchor: "profile" },
    project: { method: "derived", normalized_identity: "project" },
    session: { method: "source", source_id: sessionId },
    capture_capabilities: capabilities,
  };
}

function event(sessionId: string): SourceEventFacts {
  return {
    kind: "message",
    source: { event_name: "message", event_id: "event-1", session_id: sessionId },
    role: "user",
    message_origin: "external_user",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "hello" }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { ok: true },
  };
}

test("session close waits for completion after core timeout settles an indeterminate result", async () => {
  let release!: (result: AppendResult) => void;
  const writeResult = new Promise<AppendResult>((resolve) => {
    release = resolve;
  });
  const store = {
    initialize: async () => ({
      status: "connected" as const,
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy." as const,
    }),
    close: async () => {},
  };
  const writer = {
    write: async (_draft: CanonicalRawEventDraft, _context: ResolvedSessionContext) => writeResult,
  };
  const core = new CaptureCore({ store, writer, shutdown_timeout_ms: 10 } as never);
  await core.initialize();
  const session = core.openSession(facts("completion-barrier"));
  const accepted = session.append(event("completion-barrier"));
  const coreClosing = core.close();
  const sessionClosing = session.close();
  const result = await accepted;
  expect(result).toMatchObject({ status: "indeterminate" });
  expect(core.sessionCountForTesting()).toBe(1);
  let sessionClosed = false;
  void sessionClosing.then(() => { sessionClosed = true; });
  expect(sessionClosed).toBe(false);
  release({ status: "written", event_uid: "late", ingest_sequence: 0 });
  await Promise.all([coreClosing, sessionClosing]);
  expect(sessionClosed).toBe(true);
  expect(core.sessionCountForTesting()).toBe(0);
});

test("core close budget ignores wall-clock jumps", async () => {
  const originalDateNow = Date.now;
  let dateNowCalls = 0;
  Date.now = () => {
    dateNowCalls += 1;
    return dateNowCalls === 1 ? 1_000 : 1_000_000_000;
  };
  let storeTimeout = -1;
  const store = {
    initialize: async () => ({
      status: "connected" as const,
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy." as const,
    }),
    close: async (timeoutMs?: number) => {
      storeTimeout = timeoutMs ?? -1;
    },
  };
  try {
    const core = new CaptureCore({ store, shutdown_timeout_ms: 50 } as never);
    await core.close();
    expect(storeTimeout).toBeGreaterThan(10);
  } finally {
    Date.now = originalDateNow;
  }
});

test("close uses the tighter budget and preserves accepted-write outcomes", async () => {
  let release!: (result: AppendResult) => void;
  let storeTimeout = -1;
  const writeResult = new Promise<AppendResult>((resolve) => { release = resolve; });
  const store = {
    initialize: async () => ({
      status: "connected" as const,
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy." as const,
    }),
    close: async (timeoutMs?: number) => { storeTimeout = timeoutMs ?? -1; },
  };
  const writer = { write: async (_draft: CanonicalRawEventDraft, _context: ResolvedSessionContext) => writeResult };
  const core = new CaptureCore({ store, writer, shutdown_timeout_ms: 1000 });
  await core.initialize();
  const session = core.openSession(facts("tight-budget"));
  const accepted = session.append(event("tight-budget"));
  const closing = core.close(0);
  expect(core.close(500)).toBe(closing);
  const result = await accepted;
  await closing;
  expect(result).toMatchObject({ status: "indeterminate" });
  expect(storeTimeout).toBe(0);
  release({ status: "written", event_uid: "late", ingest_sequence: 0 });
});

test("close clamps oversized budget to configured shutdown timeout", async () => {
  let storeTimeout = -1;
  const store = {
    initialize: async () => ({
      status: "connected" as const,
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy." as const,
    }),
    close: async (timeoutMs?: number) => { storeTimeout = timeoutMs ?? -1; },
  };
  const core = new CaptureCore({ store, shutdown_timeout_ms: 20 });
  const closing = core.close(100_000);
  expect(core.close(0)).toBe(closing);
  await closing;
  expect(storeTimeout).toBeGreaterThanOrEqual(0);
  expect(storeTimeout).toBeLessThanOrEqual(20);
});

test("invalid close budgets do not change healthy core state", async () => {
  const store = {
    initialize: async () => ({
      status: "connected" as const,
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy." as const,
    }),
    close: async () => {},
  };
  const core = new CaptureCore({ store });
  await core.initialize();
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, "5"]) {
    expect(() => core.close(invalid as number)).toThrow(RangeError);
    expect(core.health().state).toBe("ready");
  }
});
