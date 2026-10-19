import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { canonicalize } from "json-canonicalize";
import { randomUUID } from "node:crypto";
import {
  CanonicalBuilder,
  CaptureCore,
  Neo4jStore,
  RawEventWriter,
  type AppendResult,
  type CaptureSessionFacts,
  type JsonValue,
  type ResolvedSessionContext,
  type SourceEventFacts,
} from "../src/index.ts";
import { syntheticConfigPath } from "./dev-config.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const suffix = randomUUID();
const store = new Neo4jStore({ configPath: syntheticConfigPath() });
const builder = new CanonicalBuilder({ core_version: "capture-core-test" });
const writer = new RawEventWriter(store, builder);
const contexts: ResolvedSessionContext[] = [];
const eventUids = new Set<string>();
const missingCorrelationEventUids = new Set<string>();
let healthStatus = "";

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

type FactOverrides = {
  runtime?: CaptureSessionFacts["runtime"];
  profile?: CaptureSessionFacts["profile"];
  project?: CaptureSessionFacts["project"];
};

function facts(sessionId: string, overrides: FactOverrides = {}): CaptureSessionFacts {
  return {
    installation_uid: `writer-installation-${suffix}`,
    runtime: overrides.runtime ?? { family: "writer-test", version: "1", adapter_version: "test" },
    profile: overrides.profile ?? { method: "derived", anchor: "profile" },
    project: overrides.project ?? { method: "derived", normalized_identity: "project" },
    session: { method: "source", source_id: sessionId },
    capture_capabilities: capabilities,
  };
}
function message(sessionId: string, eventId: string, payload: JsonValue, message_origin: "external_user" | "runtime_synthetic" = "external_user"): SourceEventFacts {
  return {
    kind: "message",
    source: { event_name: "message", event_id: eventId, session_id: sessionId },
    role: "user",
    message_origin,
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "hello" }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: payload,
  };
}

function toolCall(sessionId: string, eventId: string, sourceCallId: string): SourceEventFacts {
  return {
    kind: "tool_call",
    source: { event_name: "tool.call", event_id: eventId, session_id: sessionId },
    tool_name: "lookup",
    content_parts: [],
    fidelity: { completeness: "full", missing_fields: [] },
    extensions: { "anima.tool.source_call_id": sourceCallId },
    native_payload: { query: "one" },
  };
}

function toolResult(sessionId: string, eventId: string, sourceCallId: string): SourceEventFacts {
  return {
    kind: "tool_result",
    source: { event_name: "tool.result", event_id: eventId, session_id: sessionId },
    outcome: "success",
    tool_name: "lookup",
    correlation: { method: "source", source_tool_call_id: sourceCallId },
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "json", part_index: 0, value_json: "{\"ok\":true}" }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { ok: true },
  };
}

async function openContext(sessionId: string, overrides: FactOverrides = {}, sessionBuilder = builder): Promise<ResolvedSessionContext> {
  const context = sessionBuilder.openSession(facts(sessionId, overrides));
  contexts.push(context);
  return context;
}

function remember(context: ResolvedSessionContext, eventUid: string): void {
  eventUids.add(eventUid);
  void context;
}

function rememberMissingCorrelation(context: ResolvedSessionContext, eventUid: string): void {
  missingCorrelationEventUids.add(eventUid);
  remember(context, eventUid);
}

type FixtureSession = {
  session: CaptureSessionFacts["session"];
  profile?: CaptureSessionFacts["profile"];
  project?: CaptureSessionFacts["project"];
};

type FixtureExpectedEvent = {
  status: "written" | "duplicate" | "failed";
  ingest_sequence?: number;
  kind: SourceEventFacts["kind"];
  event_identity_method: "source" | "derived" | "generated";
};

type FixtureCase = {
  id: string;
  session?: CaptureSessionFacts["session"];
  sessions?: FixtureSession[];
  events: SourceEventFacts[];
  expected: {
    events: FixtureExpectedEvent[];
    project_nodes?: number;
    session_nodes?: number;
    event_statuses?: string[];
    profile_uids_distinct?: boolean;
    profile_nodes?: number;
    result_of_relationships?: number;
    cleanup_remaining_events?: number;
  };
};

type FixtureBundle = {
  schema_id: string;
  installation_uid: string;
  runtime: CaptureSessionFacts["runtime"];
  profile: CaptureSessionFacts["profile"];
  project: CaptureSessionFacts["project"];
  capture_capabilities: CaptureSessionFacts["capture_capabilities"];
  cases: FixtureCase[];
};

function fixtureRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function fixtureString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;

}
async function loadSourceFactsFixtures(): Promise<FixtureBundle> {
  const root = new URL("../fixtures/source-facts/", import.meta.url);
  const manifest = fixtureRecord(JSON.parse(await Bun.file(new URL("manifest.json", root)).text()), "source-facts manifest");
  if (manifest.schema_id !== "anima.capture-source-facts-manifest/v1.0") throw new Error("source-facts manifest schema is invalid");
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 1) throw new Error("source-facts manifest entries are invalid");
  const manifestEntry = fixtureRecord(manifest.fixtures[0], "source-facts manifest entry");
  if (
    manifestEntry.id !== "writer-cases" ||
    manifestEntry.path !== "writer-cases.json" ||
    manifestEntry.scope !== "R2B-2" ||
    !Array.isArray(manifestEntry.covers) ||
    manifestEntry.covers.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new Error("source-facts manifest entry is invalid");
  }

  const fixturePath = fixtureString(manifestEntry.path, "manifest fixture path");
  const raw = fixtureRecord(JSON.parse(await Bun.file(new URL(fixturePath, root)).text()), "writer-cases");
  if (raw.schema_id !== "anima.capture-source-facts-writer-fixtures/v1.0") throw new Error("writer-cases schema is invalid");
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error("writer-cases are missing");
  const cases = raw.cases as FixtureCase[];
  const caseIds = cases.map((item) => fixtureString(fixtureRecord(item, "writer case").id, "writer case id"));
  const coveredIds = (manifestEntry.covers as unknown[]).map((id) => fixtureString(id, "manifest covered case id"));
  if (new Set(caseIds).size !== caseIds.length || caseIds.some((id) => !coveredIds.includes(id)) || coveredIds.some((id) => !caseIds.includes(id))) {
    throw new Error("source-facts manifest does not declare every writer case");
  }
  for (const item of cases) {
    const value = fixtureRecord(item, "writer case");
    if (!Array.isArray(value.events) || value.events.length === 0 || !value.expected || (value.session === undefined && !Array.isArray(value.sessions))) {
      throw new Error(`writer case ${String(value.id)} is invalid`);
    }
    const expected = fixtureRecord(value.expected, `writer case ${String(value.id)} expected`);
    if (!Array.isArray(expected.events) || expected.events.length !== value.events.length) {
      throw new Error(`writer case ${String(value.id)} expected events are invalid`);
    }
  }
  return raw as unknown as FixtureBundle;
}

function fixtureUid(value: string, caseId: string): string {
  return `${value}-${suffix}-${caseId}`;
}

function fixtureSourceEvent(source: SourceEventFacts, caseId: string, sessionIds: Map<string, string>, callIds: Map<string, string>): SourceEventFacts {
  const event = structuredClone(source);
  const sourceSessionId = event.source.session_id;
  if (sourceSessionId !== undefined) event.source.session_id = sessionIds.get(sourceSessionId);
  if (event.source.event_id !== undefined) event.source.event_id = fixtureUid(event.source.event_id, caseId);
  const sourceCallId = event.extensions?.["anima.tool.source_call_id"];
  if (typeof sourceCallId === "string") {
    event.extensions = { ...event.extensions, "anima.tool.source_call_id": callIds.get(sourceCallId) ?? fixtureUid(sourceCallId, caseId) };
  }
  if (event.correlation?.method === "source" || event.correlation?.method === "derived") {
    const sourceCorrelation = event.correlation.source_tool_call_id;
    event.correlation = {
      ...event.correlation,
      ...(sourceCorrelation === undefined ? {} : { source_tool_call_id: callIds.get(sourceCorrelation) ?? fixtureUid(sourceCorrelation, caseId) }),
    };
  }
  return event;
}

async function runSourceFactsCase(bundle: FixtureBundle, fixtureCase: FixtureCase): Promise<void> {
  const entries = fixtureCase.sessions ?? (fixtureCase.session === undefined ? [] : [{ session: fixtureCase.session }]);
  const sessionIds = new Map(entries.map((entry, index) => {
    const sourceId = entry.session.method === "source" ? entry.session.source_id : `${entry.session.method}-${index}`;
    return [sourceId, fixtureUid(sourceId, fixtureCase.id)] as const;
  }));
  const callIds = new Map<string, string>();
  for (const event of fixtureCase.events) {
    const sourceCallId = event.extensions?.["anima.tool.source_call_id"];
    if (typeof sourceCallId === "string") callIds.set(sourceCallId, fixtureUid(sourceCallId, fixtureCase.id));
  }
  const contextsBySession = new Map<string, ResolvedSessionContext>();
  for (const [index, entry] of entries.entries()) {
    const sourceId = entry.session.method === "source" ? entry.session.source_id : `${entry.session.method}-${index}`;
    const actualSessionId = sessionIds.get(sourceId) ?? fixtureUid(sourceId, fixtureCase.id);
    const context = builder.openSession({
      installation_uid: fixtureUid(bundle.installation_uid, fixtureCase.id),
      runtime: bundle.runtime,
      profile: entry.profile ?? bundle.profile,
      project: entry.project ?? bundle.project,
      session: { method: "source", source_id: actualSessionId },
      capture_capabilities: bundle.capture_capabilities,
    });
    contexts.push(context);
    contextsBySession.set(sourceId, context);
  }
  const actualStatuses: string[] = [];
  for (const [index, source] of fixtureCase.events.entries()) {
    const sourceSessionId = source.source.session_id ?? "";
    const context = contextsBySession.get(sourceSessionId);
    if (context === undefined) throw new Error(`writer case ${fixtureCase.id} references an undeclared session`);
    const draft = builder.build(context, fixtureSourceEvent(source, fixtureCase.id, sessionIds, callIds));
    remember(context, draft.event_uid);
    if (source.correlation?.method === "missing") rememberMissingCorrelation(context, draft.event_uid);
    const result = await writer.write(draft, context);
    actualStatuses.push(result.status);
    const expected = fixtureCase.expected.events[index];
    expect(result.status).toBe(expected.status);
    if ((result.status === "written" || result.status === "duplicate") && (expected.status === "written" || expected.status === "duplicate")) {
      expect(result.ingest_sequence).toBe(expected.ingest_sequence ?? -1);
    }
    expect(draft.kind).toBe(expected.kind);
    expect(draft.event_identity_method).toBe(expected.event_identity_method);
    if (result.status === "written" || result.status === "duplicate") {
      const observed = await store.executeWrite(async (transaction) => transaction.run(
        "MATCH (e:RawEvent {event_uid: $event_uid}) RETURN e.kind AS kind, e.event_identity_method AS event_identity_method, e.ingest_sequence AS ingest_sequence",
        { event_uid: draft.event_uid },
      ));
      const row = observed.records[0];
      expect(row.get("kind")).toBe(expected.kind);
      expect(Number(row.get("ingest_sequence"))).toBe(expected.ingest_sequence ?? -1);
    }
  }
  if (fixtureCase.expected.event_statuses !== undefined) expect(actualStatuses).toEqual(fixtureCase.expected.event_statuses);
  if (fixtureCase.expected.project_nodes !== undefined) {
    const projectResult = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (p:Project {project_uid: $project_uid}) RETURN count(p) AS count",
      { project_uid: [...contextsBySession.values()][0]?.project_uid },
    ));
    expect(Number(projectResult.records[0].get("count"))).toBe(fixtureCase.expected.project_nodes);
  }
  if (fixtureCase.expected.session_nodes !== undefined) {
    const sessionResult = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (s:Session) WHERE s.session_uid IN $session_uids RETURN count(s) AS count",
      { session_uids: [...contextsBySession.values()].map((context) => context.session_uid) },
    ));
    expect(Number(sessionResult.records[0].get("count"))).toBe(fixtureCase.expected.session_nodes);
  }
  if (fixtureCase.expected.profile_uids_distinct !== undefined && entries.length === 2) {
    const profiles = [...contextsBySession.values()].map((context) => context.profile_uid);
    expect(new Set(profiles).size === profiles.length).toBe(fixtureCase.expected.profile_uids_distinct);
  }
  if (fixtureCase.expected.profile_nodes !== undefined) {
    const profiles = await store.executeWrite(async (transaction) => transaction.run("MATCH (p:Profile) RETURN count(p) AS count"));
    expect(Number(profiles.records[0].get("count"))).toBe(fixtureCase.expected.profile_nodes);
  }
  const caseEventUids = new Set<string>();
  for (const context of contextsBySession.values()) {
    for (const eventUid of eventUids) {
      const event = await store.executeWrite(async (transaction) => transaction.run(
        "MATCH (e:RawEvent {event_uid: $event_uid}) RETURN e.session_uid AS session_uid",
        { event_uid: eventUid },
      ));
      if (event.records[0]?.get("session_uid") === context.session_uid) caseEventUids.add(eventUid);
    }
  }
  if (fixtureCase.expected.result_of_relationships !== undefined) {
    const relation = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (:RawEvent)-[r:RESULT_OF]->(:RawEvent) WHERE startNode(r).event_uid IN $event_uids OR endNode(r).event_uid IN $event_uids RETURN count(r) AS count",
      { event_uids: [...caseEventUids] },
    ));
    expect(Number(relation.records[0].get("count"))).toBe(fixtureCase.expected.result_of_relationships);
  }
  if (fixtureCase.expected.cleanup_remaining_events !== undefined) {
    const cleanup = await store.executeWrite(async (transaction) => {
      const ids = [...caseEventUids];
      await transaction.run("MATCH (e:RawEvent) WHERE e.event_uid IN $event_uids DETACH DELETE e", { event_uids: ids });
      const remaining = await transaction.run("MATCH (e:RawEvent) WHERE e.event_uid IN $event_uids RETURN count(e) AS count", { event_uids: ids });
      return Number(remaining.records[0].get("count"));
    });
    expect(cleanup).toBe(fixtureCase.expected.cleanup_remaining_events);
  }
}

beforeAll(async () => {
  const health = await store.initialize();
  healthStatus = health.status;
  if (health.status !== "connected") throw new Error(`actual Neo4j is unavailable: ${health.message}`);
});

afterAll(async () => {
  if (healthStatus === "connected") {
    await store.executeWrite(async (transaction) => {
      const cleanupEventUids = [...new Set([...eventUids, ...missingCorrelationEventUids])];
      if (cleanupEventUids.length > 0) {
        await transaction.run("MATCH (e:RawEvent) WHERE e.event_uid IN $event_uids DETACH DELETE e", { event_uids: cleanupEventUids });
      }
      const sessionUids = [...new Set(contexts.map((context) => context.session_uid))];
      const projectUids = [...new Set(contexts.map((context) => context.project_uid))];
      if (sessionUids.length > 0) {
        await transaction.run("MATCH (s:Session) WHERE s.session_uid IN $session_uids DETACH DELETE s", { session_uids: sessionUids });
      }
      if (projectUids.length > 0) {
        await transaction.run("MATCH (p:Project) WHERE p.project_uid IN $project_uids DETACH DELETE p", { project_uids: projectUids });
      }
      const cleanup = await transaction.run(
        `MATCH (e:RawEvent) WHERE e.event_uid IN $event_uids
         WITH count(e) AS events
         OPTIONAL MATCH (s:Session) WHERE s.session_uid IN $session_uids
         WITH events, count(s) AS sessions
         OPTIONAL MATCH (p:Project) WHERE p.project_uid IN $project_uids
         WITH events, sessions, count(p) AS projects
         OPTIONAL MATCH (missing:RawEvent) WHERE missing.event_uid IN $missing_event_uids
         RETURN events, sessions, projects, count(missing) AS missing_correlation_events`,
        {
          event_uids: cleanupEventUids,
          missing_event_uids: [...missingCorrelationEventUids],
          session_uids: sessionUids,
          project_uids: projectUids,
        },
      );
      const cleanupRecord = cleanup.records[0];
      expect(Number(cleanupRecord.get("events"))).toBe(0);
      expect(Number(cleanupRecord.get("sessions"))).toBe(0);
      expect(Number(cleanupRecord.get("projects"))).toBe(0);
      expect(Number(cleanupRecord.get("missing_correlation_events"))).toBe(0);
    });
  }
  await store.close();
});

describe("RawEventWriter against the configured Neo4j", () => {
  test("executes declared source-facts writer cases against Neo4j", async () => {
    const bundle = await loadSourceFactsFixtures();
    for (const fixtureCase of bundle.cases) await runSourceFactsCase(bundle, fixtureCase);
  });
  test("serializes nested writes without losing a session sequence", async () => {
    const sessionId = `sequence-lock-session-${suffix}`;
    const context = await openContext(sessionId, {
      project: { method: "derived", normalized_identity: `sequence-lock-project-${suffix}` },
    });
    const drafts = ["sequence-lock-zero", "sequence-lock-one", "sequence-lock-two"].map((id) =>
      builder.build(context, message(sessionId, `${id}-${suffix}`, { id })),
    );
    for (const draft of drafts) remember(context, draft.event_uid);

    const initial = await writer.write(drafts[0], context);
    expect(initial).toMatchObject({ status: "written", ingest_sequence: 0 });

    const holderReady = deferred<void>();
    const releaseHolder = deferred<void>();
    const holder = store.executeWrite(async (transaction) => {
      try {
        const nestedWriter = new RawEventWriter({
          executeWrite: (work) => work(transaction),
        }, builder);
        const result = await nestedWriter.write(drafts[1], context);
        holderReady.resolve();
        await releaseHolder.promise;
        return result;
      } catch (error: unknown) {
        holderReady.resolve();
        throw error;
      }
    });
    let waiterStarted = false;
    let waiter: Promise<AppendResult> | undefined;

    const waitForBlockedTransaction = async (): Promise<boolean> => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const result = await store.executeRead((transaction) => transaction.run(
          "SHOW TRANSACTIONS YIELD parameters, status RETURN parameters, status",
        ));
        if (result.records.some((record) => {
          const parameters = record.get("parameters") as Record<string, unknown>;
          return parameters.session_uid === context.session_uid && String(record.get("status")).startsWith("Blocked");
        })) return true;
      }
      return false;
    };

    try {
      await holderReady.promise;
      waiter = writer.write(drafts[2], context);
      waiterStarted = true;
      const blocked = await waitForBlockedTransaction();
      expect(blocked).toBe(true);
      releaseHolder.resolve();
      await expect(holder).resolves.toMatchObject({ status: "written", ingest_sequence: 1 });
      await expect(waiter).resolves.toMatchObject({ status: "written", ingest_sequence: 2 });
      const observed = await store.executeRead((transaction) => transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})
         OPTIONAL MATCH (e:RawEvent {session_uid: $session_uid})
         RETURN s.next_ingest_sequence AS counter,
                collect(e.ingest_sequence) AS sequences,
                s._anima_session_lock AS lock`,
        { session_uid: context.session_uid },
      ));
      const record = observed.records[0];
      expect((record.get("sequences") as unknown[]).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2]);
      expect(Number(record.get("counter"))).toBe(3);
      expect(record.get("lock")).toBeNull();
    } finally {
      releaseHolder.resolve();
      if (waiterStarted) await waiter?.catch(() => undefined);
      await holder.catch(() => undefined);
    }
  });

  test("times out before the real writer transaction and cannot late-commit", async () => {
    const sessionId = `timeout-session-${suffix}`;
    const sourceEvent = message(sessionId, `timeout-event-${suffix}`, { timeout: true });
    const coreStore = new Neo4jStore({ configPath: syntheticConfigPath() });
    const coreBuilder = new CanonicalBuilder({ core_version: "capture-core-timeout-test" });
    const realWriter = new RawEventWriter(coreStore, coreBuilder);
    const writerStarted = deferred<void>();
    const releaseWriter = deferred<void>();
    const actualResult = deferred<AppendResult>();
    let writerInvocationStarted = false;
    const delayedWriter = {
      async write(
        draft: Parameters<RawEventWriter["write"]>[0],
        context: Parameters<RawEventWriter["write"]>[1],
      ): Promise<AppendResult> {
        writerInvocationStarted = true;
        writerStarted.resolve();
        await releaseWriter.promise;
        try {
          const result = await realWriter.write(draft, context);
          actualResult.resolve(result);
          return result;
        } catch (error: unknown) {
          actualResult.reject(error);
          throw error;
        }
      },
    };
    const core = new CaptureCore({
      store: coreStore,
      builder: coreBuilder,
      writer: delayedWriter,
      shutdown_timeout_ms: 20,
    });
    const session = core.openSession(facts(sessionId));
    const context = session.context;
    if (context === undefined) throw new Error("capture session context was not created");
    const draft = coreBuilder.build(context, sourceEvent);
    contexts.push(context);
    eventUids.add(draft.event_uid);

    try {
      await core.initialize();
      expect(core.health().state).toBe("ready");
      const accepted = session.append(sourceEvent);
      await writerStarted.promise;

      const closing = core.close();
      await expect(accepted).resolves.toEqual({
        status: "indeterminate",
        event_uid: draft.event_uid,
        message: "Capture shutdown exceeded its completion budget.",
      });
      await closing;

      releaseWriter.resolve();
      await expect(actualResult.promise).resolves.toMatchObject({
        status: "failed",
        code: "database_error",
      });
      await session.close();

      const observed = await store.executeWrite(async (transaction) => {
        const event = await transaction.run(
          "MATCH (e:RawEvent {event_uid: $event_uid}) RETURN count(e) AS count",
          { event_uid: draft.event_uid },
        );
        const sessionNode = await transaction.run(
          "MATCH (s:Session {session_uid: $session_uid}) RETURN count(s) AS count",
          { session_uid: context.session_uid },
        );
        const project = await transaction.run(
          "MATCH (p:Project {project_uid: $project_uid}) RETURN count(p) AS count",
          { project_uid: context.project_uid },
        );
        return {
          events: Number(event.records[0].get("count")),
          sessions: Number(sessionNode.records[0].get("count")),
          projects: Number(project.records[0].get("count")),
        };
      });
      expect(observed).toEqual({ events: 0, sessions: 0, projects: 0 });
    } finally {
      releaseWriter.resolve();
      if (writerInvocationStarted) await actualResult.promise.catch(() => undefined);
      await core.close();
      await store.executeWrite(async (transaction) => {
        await transaction.run(
          "MATCH (e:RawEvent {event_uid: $event_uid}) DETACH DELETE e",
          { event_uid: draft.event_uid },
        );
        await transaction.run(
          "MATCH (s:Session {session_uid: $session_uid}) DETACH DELETE s",
          { session_uid: context.session_uid },
        );
        await transaction.run(
          "MATCH (p:Project {project_uid: $project_uid}) DETACH DELETE p",
          { project_uid: context.project_uid },
        );
      });
    }
  });
  test("creates exact structural graph, complete JCS properties, and idempotent replay", async () => {
    const context = await openContext(`session-${suffix}-one`);
    const draft = builder.build(context, message(`session-${suffix}-one`, "event-one", { z: 1, a: [true, null] }));
    remember(context, draft.event_uid);

    const first = await writer.write(draft, context);
    const duplicate = await writer.write(draft, context);
    expect(first).toEqual({ status: "written", event_uid: draft.event_uid, ingest_sequence: 0 });
    expect(duplicate).toEqual({ status: "duplicate", event_uid: draft.event_uid, ingest_sequence: 0 });

    const result = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (e:RawEvent {event_uid: $event_uid})
       OPTIONAL MATCH (s:Session {session_uid: $session_uid})
       RETURN labels(e) AS labels, properties(e) AS event, s.next_ingest_sequence AS next_sequence`,
      { event_uid: draft.event_uid, session_uid: context.session_uid },
    ));
    const record = result.records[0];
    expect(record.get("labels").sort()).toEqual(["Message", "RawEvent"]);
    const properties = record.get("event") as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      "capture_capabilities_json",
      "captured_at",
      "content_parts_json",
      "event_identity_method",
      "event_uid",
      "fidelity_json",
      "fingerprint",
      "ingest_sequence",
      "kind",
      "message_origin",
      "native_payload_json",
      "project_identity_method",
      "project_uid",
      "role",
      "runtime_identity_json",
      "schema_id",
      "session_identity_method",
      "session_uid",
      "source_json",
    ]);
    expect(properties.schema_id).toBe(draft.schema_id);
    expect(properties.native_payload_json).toBe(canonicalize({ a: [true, null], z: 1 }));
    expect(JSON.parse(properties.runtime_identity_json as string).profile_uid).toBe(context.profile_uid);
    expect(properties.correlation_json).toBeUndefined();
    expect(properties.outcome).toBeUndefined();
    expect(Number(record.get("next_sequence"))).toBe(1);

    const relationshipResult = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})-[r1:HAS_SESSION]->(s:Session {session_uid: $session_uid})
       MATCH (s)-[r2:HAS_EVENT]->(e:RawEvent {event_uid: $event_uid})
       MATCH (e)-[r3:IN_PROJECT]->(p)
       RETURN count(r1) AS has_session, count(r2) AS has_event, count(r3) AS in_project`,
      { project_uid: context.project_uid, session_uid: context.session_uid, event_uid: draft.event_uid },
    ));
    expect(Number(relationshipResult.records[0].get("has_session"))).toBe(1);
    expect(Number(relationshipResult.records[0].get("has_event"))).toBe(1);
    expect(Number(relationshipResult.records[0].get("in_project"))).toBe(1);
    const constraints = await store.executeWrite(async (transaction) => transaction.run(
      `SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties
       WHERE name IN $names
       RETURN name, type, entityType, labelsOrTypes, properties`,
      { names: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"] },
    ));
    const definitions = constraints.records.map((row) => ({
      name: row.get("name"),
      type: row.get("type"),
      entityType: row.get("entityType"),
      labelsOrTypes: row.get("labelsOrTypes"),
      properties: row.get("properties"),
    })).sort((left, right) => String(left.name).localeCompare(String(right.name)));
    expect(definitions).toEqual([
      { name: "anima_project_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Project"], properties: ["project_uid"] },
      { name: "anima_raw_event_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["RawEvent"], properties: ["event_uid"] },
      { name: "anima_session_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Session"], properties: ["session_uid"] },
    ]);
  });
  test("writes cancelled TurnEnd scalar properties with aborted native payload", async () => {
    const sourceSessionId = `session-${suffix}-turn-end`;
    const context = await openContext(sourceSessionId);
    const source: SourceEventFacts = {
      kind: "turn_end",
      source: { event_name: "turn_end", event_id: "turn-end:response-1", session_id: sourceSessionId },
      turn_index: 9,
      turn_end_status: "cancelled",
      content_parts: [],
      fidelity: { completeness: "full", missing_fields: [] },
      extensions: { "anima.omp.finality_basis": "agent_end_aborted" },
      native_payload: { type: "turn_end", turnIndex: 9, message: { role: "assistant", stopReason: "aborted" }, private: "must stay raw" },
    };
    const draft = builder.build(context, source);
    const expectedFingerprint = builder.fingerprint(builder.finalize(draft, 0));
    remember(context, draft.event_uid);
    const first = await writer.write(draft, context);
    const duplicate = await writer.write(draft, context);
    expect(first).toMatchObject({ status: "written", event_uid: draft.event_uid, ingest_sequence: 0 });
    expect(duplicate).toEqual({ status: "duplicate", event_uid: draft.event_uid, ingest_sequence: 0 });

    const observed = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (e:RawEvent {event_uid: $event_uid})
       RETURN labels(e) AS labels, properties(e) AS properties`,
      { event_uid: draft.event_uid },
    ));
    const record = observed.records[0];
    const properties = record.get("properties") as Record<string, unknown>;
    expect(properties.turn_index).toBe(9);
    expect(properties.kind).toBe("turn_end");
    expect((record.get("labels") as string[]).sort()).toEqual(["RawEvent", "TurnEnd"]);
    expect(properties.turn_end_status).toBe("cancelled");
    expect(properties.extensions_json).toBe(canonicalize({ "anima.omp.finality_basis": "agent_end_aborted" }));
    expect(properties.native_payload_json).toBe(canonicalize(source.native_payload));
    expect(JSON.parse(properties.native_payload_json as string).message.stopReason).toBe("aborted");
    expect(properties.fingerprint).toBe(expectedFingerprint);
    expect(Object.keys(properties)).not.toContain("content_parts");
    expect(properties.message_origin).toBeUndefined();
  });
  test("round-trips synthetic user origin as an immutable RawEvent scalar", async () => {
    const context = await openContext(`session-${suffix}-synthetic-origin`);
    const draft = builder.build(context, message(`session-${suffix}-synthetic-origin`, "synthetic-origin", { synthetic: true }, "runtime_synthetic"));
    const expectedFingerprint = builder.fingerprint(builder.finalize(draft, 0));
    remember(context, draft.event_uid);
    await expect(writer.write(draft, context)).resolves.toMatchObject({ status: "written", event_uid: draft.event_uid });
    const observed = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (e:RawEvent {event_uid: $event_uid}) RETURN e.message_origin AS origin, e.fingerprint AS fingerprint",
      { event_uid: draft.event_uid },
    ));
    expect(observed.records[0]?.get("origin")).toBe("runtime_synthetic");
    expect(observed.records[0]?.get("fingerprint")).toBe(expectedFingerprint);
  });

  test("rejects cross-session correlation targets and keeps one shared Project", async () => {
    const sourceContext = await openContext(`session-${suffix}-cross-source`);
    const targetContext = await openContext(`session-${suffix}-cross-target`);
    const callDraft = builder.build(sourceContext, toolCall(`session-${suffix}-cross-source`, "cross-call", "cross-anchor"));
    remember(sourceContext, callDraft.event_uid);
    expect(await writer.write(callDraft, sourceContext)).toMatchObject({ status: "written", ingest_sequence: 0 });

    const resultDraft = builder.build(targetContext, {
      ...toolResult(`session-${suffix}-cross-target`, "cross-result", "cross-anchor"),
      correlation: {
        method: "derived",
        target_event_uid: callDraft.event_uid,
        source_tool_call_id: "cross-anchor",
        reason: "runtime supplied an explicit target",
      },
    });
    remember(targetContext, resultDraft.event_uid);
    expect(await writer.write(resultDraft, targetContext)).toMatchObject({ status: "failed", code: "identity_conflict" });

    const projectResult = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (p:Project {project_uid: $project_uid}) RETURN count(p) AS count",
      { project_uid: sourceContext.project_uid },
    ));
    expect(Number(projectResult.records[0].get("count"))).toBe(1);
  });

  test("rolls back conflicts and resolves same-session RESULT_OF", async () => {
    const context = await openContext(`session-${suffix}-two`);
    const callDraft = builder.build(context, toolCall(`session-${suffix}-two`, "call-one", "call-anchor"));
    const resultDraft = builder.build(context, toolResult(`session-${suffix}-two`, "result-one", "call-anchor"));
    remember(context, callDraft.event_uid);
    remember(context, resultDraft.event_uid);
    expect(await writer.write(callDraft, context)).toMatchObject({ status: "written", ingest_sequence: 0 });
    expect(await writer.write(resultDraft, context)).toMatchObject({ status: "written", ingest_sequence: 1 });

    const relationResult = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (result:RawEvent {event_uid: $result_uid})-[r:RESULT_OF]->(call:RawEvent {event_uid: $call_uid}) RETURN count(r) AS count`,
      { result_uid: resultDraft.event_uid, call_uid: callDraft.event_uid },
    ));
    expect(Number(relationResult.records[0].get("count"))).toBe(1);

    const conflictingSource = builder.build(context, message(`session-${suffix}-two`, "event-conflict", { changed: true }));
    const conflictDraft = { ...conflictingSource, event_uid: callDraft.event_uid };
    const conflict = await writer.write(conflictDraft, context);
    expect(conflict).toMatchObject({ status: "failed", code: "identity_conflict" });

    const missing = builder.build(context, {
      ...toolResult(`session-${suffix}-two`, "result-missing", "missing-anchor"),
      correlation: { method: "missing", reason: "runtime did not expose a call id" },
    });
    rememberMissingCorrelation(context, missing.event_uid);
    void relationResult;
    expect(await writer.write(missing, context)).toMatchObject({ status: "written", ingest_sequence: 2 });
  });

  test("concurrent identical replay reserves one sequence", async () => {
    const context = await openContext(`session-${suffix}-three`);
    const draft = builder.build(context, message(`session-${suffix}-three`, "concurrent", { concurrent: true }));
    remember(context, draft.event_uid);
    const results = await Promise.all([writer.write(draft, context), writer.write(draft, context)]);
    expect(results.map((result) => result.status).sort()).toEqual(["duplicate", "written"]);
    expect(results.every((result) => result.status === "failed" || "ingest_sequence" in result && result.ingest_sequence === 0)).toBe(true);
  });

  test("concurrently separates derived and anchored-generated profiles without Profile nodes", async () => {
    const sessionA = `session-${suffix}-profile-derived`;
    const sessionB = `session-${suffix}-profile-generated`;
    const derivedContext = await openContext(sessionA, {
      profile: { method: "derived", anchor: "x" },
      project: { method: "source", normalized_identity: "shared-project" },
    });
    const generatedContext = await openContext(sessionB, {
      profile: { method: "generated", generated_anchor: "x" },
      project: { method: "derived", normalized_identity: "shared-project" },
    });
    const derivedDraft = builder.build(derivedContext, message(sessionA, "profile-derived-event", { profile: "derived" }));
    const generatedDraft = builder.build(generatedContext, message(sessionB, "profile-generated-event", { profile: "generated" }));
    remember(derivedContext, derivedDraft.event_uid);
    remember(generatedContext, generatedDraft.event_uid);

    const results = await Promise.all([
      writer.write(derivedDraft, derivedContext),
      writer.write(generatedDraft, generatedContext),
    ]);
    expect(results).toEqual([
      { status: "written", event_uid: derivedDraft.event_uid, ingest_sequence: 0 },
      { status: "written", event_uid: generatedDraft.event_uid, ingest_sequence: 0 },
    ]);
    expect(derivedContext.profile_uid).not.toBe(generatedContext.profile_uid);
    expect(derivedContext.project_uid).toBe(generatedContext.project_uid);

    const graph = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})
       MATCH (s:Session) WHERE s.session_uid IN $session_uids
       MATCH (e:RawEvent) WHERE e.event_uid IN $event_uids
       OPTIONAL MATCH (profile:Profile)
       RETURN count(DISTINCT p) AS projects, count(DISTINCT s) AS sessions,
              count(DISTINCT e) AS events, count(profile) AS profiles,
              collect(DISTINCT labels(p)) AS project_labels,
              collect(DISTINCT labels(s)) AS session_labels,
              collect(DISTINCT labels(e)) AS event_labels`,
      {
        project_uid: derivedContext.project_uid,
        session_uids: [derivedContext.session_uid, generatedContext.session_uid],
        event_uids: [derivedDraft.event_uid, generatedDraft.event_uid],
      },
    ));
    const row = graph.records[0];
    expect(Number(row.get("projects"))).toBe(1);
    expect(Number(row.get("sessions"))).toBe(2);
    expect(Number(row.get("events"))).toBe(2);
    expect(Number(row.get("profiles"))).toBe(0);
    expect(row.get("project_labels")).toEqual([["Project"]]);
    expect(row.get("session_labels")).toEqual([["Session"]]);
    const eventLabels = row.get("event_labels") as string[][];
    expect(eventLabels.map((labels) => labels.sort())).toEqual([["Message", "RawEvent"]]);
  });

  test("concurrently merges first source and derived Sessions into one normalized Project", async () => {
    const sessionA = `session-${suffix}-project-source`;
    const sessionB = `session-${suffix}-project-derived`;
    const sourceContext = await openContext(sessionA, {
      profile: { method: "source", source_id: "source-profile" },
      project: { method: "source", normalized_identity: "concurrent-project" },
    });
    const derivedContext = await openContext(sessionB, {
      profile: { method: "source", source_id: "derived-profile" },
      project: { method: "derived", normalized_identity: "concurrent-project" },
    });
    const sourceDraft = builder.build(sourceContext, message(sessionA, "project-source-event", { project: "source" }));
    const derivedDraft = builder.build(derivedContext, message(sessionB, "project-derived-event", { project: "derived" }));
    remember(sourceContext, sourceDraft.event_uid);
    remember(derivedContext, derivedDraft.event_uid);

    const results = await Promise.all([
      writer.write(sourceDraft, sourceContext),
      writer.write(derivedDraft, derivedContext),
    ]);
    expect(results.every((result) => result.status === "written")).toBe(true);

    const projectResult = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (p:Project {project_uid: $project_uid}) RETURN count(p) AS count",
      { project_uid: sourceContext.project_uid },
    ));
    expect(Number(projectResult.records[0].get("count"))).toBe(1);
    expect(sourceContext.project_uid).toBe(derivedContext.project_uid);
  });

  test("keeps Session provenance stable across runtime upgrades without storing versions", async () => {
    const sessionId = `session-${suffix}-runtime-upgrade`;
    const firstContext = await openContext(sessionId, {
      runtime: { family: "writer-test", version: "1.0", adapter_version: "adapter-a" },
    });
    const upgradedContext = await openContext(sessionId, {
      runtime: { family: "writer-test", version: "2.0", adapter_version: "adapter-b" },
    });

    expect(upgradedContext.session_uid).toBe(firstContext.session_uid);

    const firstDraft = builder.build(firstContext, message(sessionId, "runtime-before", { version: "before" }));
    const upgradedDraft = builder.build(upgradedContext, message(sessionId, "runtime-after", { version: "after" }));
    remember(firstContext, firstDraft.event_uid);
    remember(upgradedContext, upgradedDraft.event_uid);
    expect(await writer.write(firstDraft, firstContext)).toMatchObject({ status: "written", ingest_sequence: 0 });
    expect(await writer.write(upgradedDraft, upgradedContext)).toMatchObject({ status: "written", ingest_sequence: 1 });

    const provenance = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (s:Session {session_uid: $session_uid})
       MATCH (e:RawEvent {event_uid: $event_uid})
       RETURN properties(s) AS session, e.runtime_identity_json AS runtime`,
      { session_uid: firstContext.session_uid, event_uid: upgradedDraft.event_uid },
    ));
    const row = provenance.records[0];
    const sessionProperties = row.get("session") as Record<string, unknown>;
    expect(sessionProperties.runtime_family).toBe("writer-test");
    expect(sessionProperties.adapter_version).toBeUndefined();
    expect(sessionProperties.runtime_version).toBeUndefined();
    expect(JSON.parse(row.get("runtime")).adapter_version).toBe("adapter-b");
    expect(JSON.parse(row.get("runtime")).runtime_version).toBe("2.0");
  });
  test("rejects Session provenance conflicts without overwriting existing properties", async () => {
    const sessionId = `session-${suffix}-provenance-conflict`;
    const sourceContext = await openContext(sessionId, {
      project: { method: "source", normalized_identity: "provenance-project" },
    });
    const derivedContext = await openContext(sessionId, {
      project: { method: "derived", normalized_identity: "provenance-project" },
    });
    expect(derivedContext.session_uid).toBe(sourceContext.session_uid);
    const sourceDraft = builder.build(sourceContext, message(sessionId, "provenance-source", { method: "source" }));
    const derivedDraft = builder.build(derivedContext, message(sessionId, "provenance-derived", { method: "derived" }));
    remember(sourceContext, sourceDraft.event_uid);
    remember(derivedContext, derivedDraft.event_uid);
    expect(await writer.write(sourceDraft, sourceContext)).toMatchObject({ status: "written", ingest_sequence: 0 });
    expect(await writer.write(derivedDraft, derivedContext)).toMatchObject({ status: "failed", code: "identity_conflict" });

    const sessionResult = await store.executeWrite(async (transaction) => transaction.run(
      "MATCH (s:Session {session_uid: $session_uid}) RETURN s.project_identity_method AS project_identity_method, s.next_ingest_sequence AS next_sequence",
      { session_uid: sourceContext.session_uid },
    ));
    expect(sessionResult.records[0].get("project_identity_method")).toBe("source");
    expect(Number(sessionResult.records[0].get("next_sequence"))).toBe(1);
  });

  test("resolves a ToolCall anchor after a fresh Builder and Writer context", async () => {
    const sessionId = `session-${suffix}-fresh-context`;
    const context = await openContext(sessionId);
    const callDraft = builder.build(context, toolCall(sessionId, "fresh-call", "fresh-anchor"));
    remember(context, callDraft.event_uid);
    expect(await writer.write(callDraft, context)).toMatchObject({ status: "written", ingest_sequence: 0 });

    const freshBuilder = new CanonicalBuilder({ core_version: "capture-core-test" });
    const freshWriter = new RawEventWriter(store, freshBuilder);
    const freshContext = await openContext(sessionId, {}, freshBuilder);
    const resultDraft = freshBuilder.build(freshContext, toolResult(sessionId, "fresh-result", "fresh-anchor"));
    remember(freshContext, resultDraft.event_uid);
    expect(await freshWriter.write(resultDraft, freshContext)).toMatchObject({ status: "written", ingest_sequence: 1 });

    const relation = await store.executeWrite(async (transaction) => transaction.run(
      `MATCH (result:RawEvent {event_uid: $result_uid})-[r:RESULT_OF]->(call:RawEvent {event_uid: $call_uid})
       RETURN count(r) AS count`,
      { result_uid: resultDraft.event_uid, call_uid: callDraft.event_uid },
    ));
    expect(Number(relation.records[0].get("count"))).toBe(1);
  });
});
