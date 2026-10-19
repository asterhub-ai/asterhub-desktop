import { describe, expect, test } from "vitest";
import {
  CaptureCore,
  SessionQueue,
  type AppendResult,
  type CaptureCoreHealth,
  type CaptureSessionFacts,
  type CanonicalRawEventDraft,
  type ResolvedSessionContext,
  type SourceEventFacts,
  profileIdentity,
  projectIdentity,
  sessionIdentity,
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

function facts(sessionId: string): CaptureSessionFacts {
  return {
    installation_uid: "capture-core-test",
    runtime: { family: "test", version: "1", adapter_version: "test" },
    profile: { method: "derived", anchor: "profile" },
    project: { method: "derived", normalized_identity: "project" },
    session: { method: "source", source_id: sessionId },
    capture_capabilities: capabilities,
  };
}

function event(id: string, sessionId?: string): SourceEventFacts {
  return {
    kind: "message",
    source: { event_name: "message", event_id: id, ...(sessionId === undefined ? {} : { session_id: sessionId }) },
    role: "user",
    message_origin: "external_user",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: id }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { id },
  };
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function connectedStore() {
  let closeCount = 0;
  return {
    get closeCount() { return closeCount; },
    async initialize() {
      return {
        status: "connected" as const,
        database: "neo4j",
        constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
        message: "Neo4j connection is healthy." as const,
      };
    },
    async close() { closeCount += 1; },
  };
}

function writerWith(
  write: (draft: CanonicalRawEventDraft, context: ResolvedSessionContext) => Promise<AppendResult>,
) {
  return { write };
}

async function readyCore(writer: { write: (draft: CanonicalRawEventDraft, context: ResolvedSessionContext) => Promise<AppendResult> }, options: Record<string, unknown> = {}) {
  const store = connectedStore();
  const core = new CaptureCore({ ...options, store, writer } as never);
  await core.initialize();
  return { core, store };
}

function written(draft: CanonicalRawEventDraft): AppendResult {
  return { status: "written", event_uid: draft.event_uid, ingest_sequence: 0 };
}

describe("CaptureCore", () => {
  test("serializes same-session appends and preserves FIFO order", async () => {
    const started: string[] = [];
    const gates: Deferred<AppendResult>[] = [];
    const secondStarted = deferred<void>();
    const { core } = await readyCore(writerWith(async (draft) => {
      started.push(draft.source.event_id ?? "");
      if (started.length === 2) secondStarted.resolve();
      const gate = deferred<AppendResult>();
      gates.push(gate);
      return gate.promise;
    }));
    const session = core.openSession(facts("same"));
    const first = session.append(event("one"));
    const second = session.append(event("two"));
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["one"]);
    gates[0].resolve({ status: "written", event_uid: "one", ingest_sequence: 0 });
    await first;
    await secondStarted.promise;
    expect(started).toEqual(["one", "two"]);
    gates[1].resolve({ status: "written", event_uid: "two", ingest_sequence: 1 });
    await expect(second).resolves.toMatchObject({ status: "written", ingest_sequence: 1 });
    await core.close();
  });

  test("runs different-session appends concurrently", async () => {
    const started: string[] = [];
    const release = deferred<AppendResult>();
    const bothStarted = deferred<void>();
    const { core } = await readyCore(writerWith(async (draft) => {
      started.push(draft.source.session_id ?? "");
      if (started.length === 2) bothStarted.resolve();
      if (started.length === 1) return release.promise;
      return written(draft);
    }));
    const first = core.openSession(facts("one")).append(event("one", "one"));
    const second = core.openSession(facts("two")).append(event("two", "two"));
    await bothStarted.promise;
    expect(started).toEqual(["one", "two"]);
    release.resolve({ status: "written", event_uid: "one", ingest_sequence: 0 });
    await Promise.all([first, second]);
    await core.close();
  });

  test("bounds starting FIFO and reports queue_full", async () => {
    const { core } = await readyCore(writerWith(async (draft) => written(draft)), { max_pending_events: 2 });
    const session = core.openSession(facts("starting"));
    const first = session.append(event("one"));
    const second = session.append(event("two"));
    const third = await session.append(event("three"));
    expect(third).toMatchObject({ status: "failed", code: "queue_full" });
    expect(core.health().pending_events).toBe(2);
    await core.initialize();
    await Promise.all([first, second]);
    expect(core.health().failed_events).toBe(1);
    await core.close();
  });

  test("accepts the default starting capacity before initialize and drains afterward", async () => {
    const initialization = deferred<{
      status: "connected";
      database: string;
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"];
      message: "Neo4j connection is healthy.";
    }>();
    const store = {
      initialize: () => initialization.promise,
      async close() {},
    };
    const writes: string[] = [];
    const core = new CaptureCore({
      store,
      writer: writerWith(async (draft) => {
        writes.push(draft.source.event_id ?? "");
        return written(draft);
      }),
    } as never);
    const session = core.openSession(facts("starting-default"));
    const accepted = Array.from({ length: 256 }, (_, index) => session.append(event(String(index))));
    expect(core.health().pending_events).toBe(256);
    await expect(session.append(event("queue-full"))).resolves.toMatchObject({ status: "failed", code: "queue_full" });
    expect(core.health().failed_events).toBe(1);

    initialization.resolve({
      status: "connected",
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy.",
    });
    await core.initialize();
    await expect(Promise.all(accepted)).resolves.toHaveLength(256);
    expect(writes).toHaveLength(256);
    await core.close();
  });

  test("degradation settles concurrent accepted work without allowing a later success", async () => {
    const firstGate = deferred<void>();
    const secondStarted = deferred<void>();
    const secondGate = deferred<AppendResult>();
    const { core } = await readyCore(writerWith(async (draft) => {
      if (draft.source.event_id === "one") {
        await firstGate.promise;
        return { status: "failed", code: "database_error", message: "Neo4j write failed." };
      }
      secondStarted.resolve();
      return secondGate.promise;
    }));
    const firstSession = core.openSession(facts("degrade-one"));
    const secondSession = core.openSession(facts("degrade-two"));
    const first = firstSession.append(event("one"));
    const second = secondSession.append(event("two"));
    await secondStarted.promise;
    firstGate.resolve();
    await expect(first).resolves.toMatchObject({ status: "failed", code: "database_error" });
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    secondGate.resolve({ status: "written", event_uid: "two", ingest_sequence: 0 });
    await expect(second).resolves.toMatchObject({ status: "written" });
    await core.close();
  });

  test("degraded initialization settles every accepted task", async () => {
    const store = {
      async initialize() { return { status: "error" as const, database: null, constraints: [], message: "Neo4j connection failed." as const }; },
      async close() {},
    };
    const core = new CaptureCore({ store, writer: writerWith(async (draft) => written(draft)) } as never);
    const session = core.openSession(facts("degraded-many"));
    const accepted = [session.append(event("one")), session.append(event("two")), session.append(event("three"))];
    await core.initialize();
    await expect(Promise.all(accepted)).resolves.toEqual([
      { status: "failed", code: "core_degraded", message: "Capture core is degraded." },
      { status: "failed", code: "core_degraded", message: "Capture core is degraded." },
      { status: "failed", code: "core_degraded", message: "Capture core is degraded." },
    ]);
    await core.close();
  });

  test("degraded initialization settles accepted work without fabricating success", async () => {
    const store = {
      async initialize() { return { status: "error" as const, database: null, constraints: [], message: "Neo4j connection failed." as const }; },
      async close() {},
    };
    const core = new CaptureCore({ store, writer: writerWith(async (draft) => written(draft)) } as never);
    const session = core.openSession(facts("degraded"));
    const accepted = session.append(event("one"));
    await core.initialize();
    await expect(accepted).resolves.toMatchObject({ status: "failed", code: "core_degraded" });
    await expect(session.append(event("two"))).resolves.toMatchObject({ status: "failed", code: "core_degraded" });
    expect(core.health().state).toBe("degraded");
    await core.close();
  });

  test("core close waits for writer completion after degraded settlement", async () => {
    const firstGate = deferred<void>();
    const secondGate = deferred<AppendResult>();
    const secondStarted = deferred<void>();
    const { core } = await readyCore(writerWith(async (draft) => {
      if (draft.source.event_id === "one") {
        await firstGate.promise;
        return { status: "failed", code: "database_error", message: "Neo4j write failed." };
      }
      secondStarted.resolve();
      return secondGate.promise;
    }), { shutdown_timeout_ms: 100 });
    const first = core.openSession(facts("close-degraded-one")).append(event("one"));
    const second = core.openSession(facts("close-degraded-two")).append(event("two"));
    await secondStarted.promise;
    firstGate.resolve();
    await expect(first).resolves.toMatchObject({ status: "failed", code: "database_error" });
    let closed = false;
    const closing = core.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    secondGate.resolve({ status: "written", event_uid: "two", ingest_sequence: 0 });
    await closing;
    expect(closed).toBe(true);
  });

  test("initialize after close does not reconnect or change closed health", async () => {
    let initializeCount = 0;
    const store = {
      async initialize() {
        initializeCount += 1;
        return {
          status: "connected" as const,
          database: "neo4j",
          constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] as ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
          message: "Neo4j connection is healthy." as const,
        };
      },
      async close() {},
    };
    const core = new CaptureCore({ store, writer: writerWith(async (draft) => written(draft)) } as never);
    await core.close();
    await core.initialize();
    expect(initializeCount).toBe(0);
    expect(core.health()).toMatchObject({ state: "closed", database: null, constraints: [], message: "Capture core is closed." });
  });

  test("core close without initialize settles accepted work without invoking the writer", async () => {
    let writes = 0;
    const core = new CaptureCore({
      store: { async initialize() { throw new Error("should not initialize"); }, async close() {} },
      writer: writerWith(async (draft) => {
        writes += 1;
        return written(draft);
      }),
    } as never);
    const accepted = core.openSession(facts("close-without-init")).append(event("one"));
    const closing = core.close();
    await expect(accepted).resolves.toMatchObject({ status: "failed", code: "database_error" });
    await closing;
    expect(writes).toBe(0);
  });

  test("close during failed initialize settles accepted work safely", async () => {
    const initialization = deferred<{
      status: "error";
      database: null;
      constraints: [];
      message: "Neo4j connection failed.";
    }>();
    let writes = 0;
    const core = new CaptureCore({
      store: { initialize: () => initialization.promise, async close() {} },
      writer: writerWith(async (draft) => {
        writes += 1;
        return written(draft);
      }),
    } as never);
    const accepted = core.openSession(facts("close-failed-init")).append(event("one"));
    const initializing = core.initialize();
    const closing = core.close();
    initialization.resolve({
      status: "error",
      database: null,
      constraints: [],
      message: "Neo4j connection failed.",
    });
    await initializing;
    await expect(accepted).resolves.toMatchObject({ status: "failed", code: "database_error" });
    await closing;
    expect(writes).toBe(0);
  });

  test("core close does not release starting work before initialize completes", async () => {
    const initialization = deferred<{
      status: "connected";
      database: string;
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"];
      message: "Neo4j connection is healthy.";
    }>();
    const started = deferred<void>();
    const store = { initialize: () => initialization.promise, async close() {} };
    const core = new CaptureCore({
      store,
      writer: writerWith(async (draft) => {
        started.resolve();
        return written(draft);
      }),
    } as never);
    const accepted = core.openSession(facts("close-starting")).append(event("one"));
    const initializing = core.initialize();
    const closing = core.close();
    await Promise.resolve();
    await Promise.resolve();
    let writerStarted = false;
    void started.promise.then(() => { writerStarted = true; });
    await Promise.resolve();
    expect(writerStarted).toBe(false);
    initialization.resolve({
      status: "connected",
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy.",
    });
    await initializing;
    await expect(accepted).resolves.toMatchObject({ status: "written" });
    await closing;
    expect(core.health()).toMatchObject({ state: "closed", database: null, constraints: [], message: "Capture core is closed." });
  });

  test("session close waits for its accepted barrier but leaves other handles open", async () => {
    const gate = deferred<AppendResult>();
    const { core } = await readyCore(writerWith(async () => gate.promise));
    const firstHandle = core.openSession(facts("shared"));
    const secondHandle = core.openSession(facts("shared"));
    const accepted = firstHandle.append(event("one"));
    const secondAccepted = secondHandle.append(event("two"));
    const closing = firstHandle.close();
    expect(firstHandle.close()).toBe(closing);
    await Promise.resolve();
    await expect(firstHandle.append(event("late"))).resolves.toMatchObject({ status: "failed", code: "core_closed" });
    let barrierSettled = false;
    void closing.then(() => { barrierSettled = true; });
    await Promise.resolve();
    expect(barrierSettled).toBe(false);
    gate.resolve({ status: "written", event_uid: "one", ingest_sequence: 0 });
    await accepted;
    await closing;
    await secondAccepted;
    await core.close();
  });

  test("core close settles timed-out accepted work and is idempotent", async () => {
    const gate = deferred<AppendResult>();
    const store = connectedStore();
    const core = new CaptureCore({ store, shutdown_timeout_ms: 10, writer: writerWith(async () => gate.promise) } as never);
    await core.initialize();
    const session = core.openSession(facts("timeout"));
    const accepted = session.append(event("one"));
    const firstClose = core.close();
    await expect(accepted).resolves.toMatchObject({ status: "indeterminate", event_uid: expect.any(String) });
    await firstClose;
    await core.close();
    expect(store.closeCount).toBe(1);
    expect(core.health().state).toBe("closed");
    await expect(session.append(event("late"))).resolves.toMatchObject({ status: "failed", code: "core_closed" });
    gate.resolve({ status: "written", event_uid: "late", ingest_sequence: 0 });
  });

  test("unrecoverable writer failure degrades and settles later work", async () => {
    const { core } = await readyCore(writerWith(async () => ({ status: "failed", code: "database_error", message: "Neo4j write failed." })));
    const session = core.openSession(facts("write-failure"));
    await expect(session.append(event("one"))).resolves.toMatchObject({ status: "failed", code: "database_error" });
    expect(core.health()).toMatchObject({ state: "degraded", pending_events: 0 });
    await expect(session.append(event("two"))).resolves.toMatchObject({ status: "failed", code: "core_degraded" });
    await core.close();
  });
  test("snapshots nested session facts before resolving identity", async () => {
    let observedContext: ResolvedSessionContext | undefined;
    const { core } = await readyCore(writerWith(async (draft, context) => {
      observedContext = context;
      return written(draft);
    }));
    const input = facts("facts-snapshot");
    input.capture_capabilities = structuredClone(capabilities);
    input.runtime.family = "runtime-original";
    input.profile = { method: "derived", anchor: "profile-original", name: "profile-name" };
    input.project = { method: "derived", normalized_identity: "project-original" };
    input.capture_capabilities.extensions = { "anima.capture.test": { nested: ["original"] } };
    const session = core.openSession(input);
    const originalFacts = structuredClone(input);
    const expectedProfile = profileIdentity(originalFacts);
    const expectedProject = projectIdentity(originalFacts);
    const expectedSession = sessionIdentity(originalFacts, expectedProfile.uid);
    input.installation_uid = "mutated-installation";
    input.runtime.family = "runtime-mutated";
    input.runtime.version = "mutated-version";
    input.profile.anchor = "profile-mutated";
    input.profile.name = "mutated-name";
    if (input.session.method !== "source") throw new Error("test fixture must use a source session");
    input.session.source_id = "mutated-session";
    input.capture_capabilities.extensions!["anima.capture.test"] = { nested: ["mutated"] };

    const result = await session.append(event("facts-event", "facts-snapshot"));

    expect(result).toMatchObject({ status: "written", event_uid: expect.any(String) });
    expect(observedContext?.facts).toEqual({
      ...facts("facts-snapshot"),
      runtime: { family: "runtime-original", version: "1", adapter_version: "test" },
      profile: { method: "derived", anchor: "profile-original", name: "profile-name" },
      project: { method: "derived", normalized_identity: "project-original" },
      capture_capabilities: { ...capabilities, extensions: { "anima.capture.test": { nested: ["original"] } } },
    });
    expect(observedContext?.facts.session).toMatchObject({ method: "source", source_id: "facts-snapshot" });
    expect(observedContext?.profile).toEqual(expectedProfile);
    expect(observedContext?.project).toEqual(expectedProject);
    expect(observedContext?.session).toEqual(expectedSession);
    expect(observedContext?.profile_uid).toBe(expectedProfile.uid);
    expect(observedContext?.project_uid).toBe(expectedProject.uid);
    expect(observedContext?.session_uid).toBe(expectedSession.uid);
    expect(observedContext?.facts.runtime.family).toBe("runtime-original");
    expect(observedContext?.facts.capture_capabilities.extensions?.["anima.capture.test"]).toEqual({ nested: ["original"] });
    expect(Object.isFrozen(observedContext?.facts)).toBe(true);
    expect(Object.isFrozen(observedContext?.facts.runtime)).toBe(true);
    await core.close();
  });
  test("freezes session context before queued writes can observe it", async () => {
    let observedContext: ResolvedSessionContext | undefined;
    let observedDraft: CanonicalRawEventDraft | undefined;
    const { core } = await readyCore(writerWith(async (draft, context) => {
      observedDraft = draft;
      observedContext = context;
      return written(draft);
    }));
    const session = core.openSession(facts("context-immutable"));
    const context = session.context;
    if (context === undefined) throw new Error("capture session context was not created");
    const expected = {
      profile: { ...context.profile },
      project: { ...context.project },
      session: { ...context.session },
      profile_uid: context.profile_uid,
      project_uid: context.project_uid,
      session_uid: context.session_uid,
    };
    const replacement = {
      ...context,
      profile: { uid: "replacement-profile", method: "source", fingerprint: "replacement-profile" },
      project: { uid: "replacement-project", method: "source", fingerprint: "replacement-project" },
      session: { uid: "replacement-session", method: "source", fingerprint: "replacement-session" },
      profile_uid: "replacement-profile",
      project_uid: "replacement-project",
      session_uid: "replacement-session",
    } as unknown as ResolvedSessionContext;
    try {
      (session as unknown as { context: ResolvedSessionContext | undefined }).context = replacement;
    } catch {}

    try {
      // @ts-expect-error ResolvedSessionContext intentionally exposes a readonly view.
      context.profile.uid = "mutated-profile";
    } catch {}
    try {
      // @ts-expect-error ResolvedSessionContext intentionally exposes a readonly view.
      context.project.method = "source";
    } catch {}
    try {
      // @ts-expect-error ResolvedSessionContext intentionally exposes a readonly view.
      context.session.fingerprint = "mutated-session";
    } catch {}
    try {
      // @ts-expect-error ResolvedSessionContext intentionally exposes a readonly view.
      context.session_uid = "mutated-session-uid";
    } catch {}
    try {
      // @ts-expect-error ResolvedSessionContext intentionally exposes a readonly view.
      context.profile_uid = "mutated-profile-uid";
    } catch {}

    await expect(session.append(event("context-event", "context-immutable"))).resolves.toMatchObject({ status: "written" });
    expect(observedDraft).toMatchObject({
      session_uid: expected.session_uid,
      project_uid: expected.project_uid,
      project_identity_method: expected.project.method,
      runtime_identity: { profile_uid: expected.profile_uid, profile_identity_method: expected.profile.method },
    });
    expect(observedContext?.profile).toEqual(expected.profile);
    expect(observedContext?.project).toEqual(expected.project);
    expect(observedContext?.session).toEqual(expected.session);
    expect(observedContext?.profile_uid).toBe(expected.profile_uid);
    expect(observedContext?.project_uid).toBe(expected.project_uid);
    expect(observedContext?.session_uid).toBe(expected.session_uid);
    expect(Object.isFrozen(observedContext)).toBe(true);
    expect(Object.isFrozen(observedContext?.facts)).toBe(true);
    expect(Object.isFrozen(observedContext?.profile)).toBe(true);
    expect(Object.isFrozen(observedContext?.project)).toBe(true);
    expect(Object.isFrozen(observedContext?.session)).toBe(true);
    await core.close();
  });

  test("snapshots source event facts before enqueue", async () => {
    const started = deferred<void>();
    const gate = deferred<AppendResult>();
    let observedDraft: CanonicalRawEventDraft | undefined;
    const { core } = await readyCore(writerWith(async (draft) => {
      observedDraft = draft;
      started.resolve();
      return gate.promise;
    }));
    const session = core.openSession(facts("event-snapshot"));
    const source = event("event-original", "event-snapshot");
    source.content_parts[0]!.text = "content-original";
    source.fidelity = { completeness: "partial", missing_fields: ["/role"] };
    source.native_payload = { nested: { value: "native-original" } };
    source.extensions = { "anima.capture.test": { nested: ["extension-original"] } };
    const accepted = session.append(source);
    source.source.event_id = "event-mutated";
    source.source.session_id = "mutated-session";
    source.content_parts[0]!.text = "content-mutated";
    source.fidelity.missing_fields[0] = "/native_payload";
    source.native_payload = { nested: { value: "native-mutated" } };
    source.extensions!["anima.capture.test"] = { nested: ["extension-mutated"] };

    await started.promise;
    expect(observedDraft?.source.event_id).toBe("event-original");
    expect(observedDraft?.source.session_id).toBe("event-snapshot");
    expect(observedDraft?.content_parts[0]?.text).toBe("content-original");
    expect(observedDraft?.fidelity).toEqual({ completeness: "partial", missing_fields: ["/role"] });
    expect(observedDraft?.native_payload_json).toBe('{"nested":{"value":"native-original"}}');
    expect(observedDraft?.extensions).toEqual({ "anima.capture.test": { nested: ["extension-original"] } });
    gate.resolve(written(observedDraft!));
    await accepted;
    await core.close();
  });

  test("rejects invalid session facts before builder identity resolution", async () => {
    let opened = false;
    const builder = {
      openSession() {
        opened = true;
        throw new Error("identity should not resolve");
      },
    };
    const core = new CaptureCore({
      store: connectedStore(),
      builder,
    } as never);
    const invalid = facts("invalid-session");
    invalid.runtime.family = "";
    expect(() => core.openSession(invalid)).toThrow();
    expect(opened).toBe(false);
    await core.close();
  });

  test("removes unique session states after their handles close", async () => {
    const { core } = await readyCore(writerWith(async (draft) => written(draft)));
    for (let index = 0; index < 100; index += 1) {
      const session = core.openSession(facts(`unique-${index}`));
      await session.close();
    }
    expect(core.sessionCountForTesting()).toBe(0);
    await core.close();
  });

  test("shares one session state across handles until the last handle closes", async () => {
    const { core } = await readyCore(writerWith(async (draft) => written(draft)));
    const first = core.openSession(facts("shared-state"));
    const second = core.openSession(facts("shared-state"));
    expect(core.sessionCountForTesting()).toBe(1);
    await first.close();
    expect(core.sessionCountForTesting()).toBe(1);
    await second.close();
    expect(core.sessionCountForTesting()).toBe(0);
    await core.close();
  });


});

describe("SessionQueue", () => {
  test("settles rejected work with a sanitized result and preserves the tail", async () => {
    const queue = new SessionQueue<string>();
    const rejected = queue.enqueue(async () => {
      throw new Error("secret backend detail");
    }, () => "sanitized failure");
    const next = queue.enqueue(async () => "tail result");

    await expect(rejected.promise).resolves.toBe("sanitized failure");
    await expect(next.promise).resolves.toBe("tail result");
    expect(queue.pending).toBe(0);
  });
});

describe("SessionQueue rejection", () => {
  test("settles when the rejection sanitizer itself throws", async () => {
    const queue = new SessionQueue<string>();
    const rejected = queue.enqueue(async () => {
      throw new Error("work failure");
    }, () => {
      throw new Error("sanitizer failure");
    });
    const next = queue.enqueue(async () => "tail result");

    await expect(rejected.promise).rejects.toThrow("sanitizer failure");
    await expect(next.promise).resolves.toBe("tail result");
    expect(queue.pending).toBe(0);
  });
});
