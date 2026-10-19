import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { syntheticConfigPath } from "./dev-config.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";

type ExecutionFixtureEvent = {
  event_uid: string;
  ingest_sequence: number;
  kind: "message" | "tool_call" | "tool_result" | "turn_end" | "boundary";
  role?: "user" | "assistant";
  message_origin?: "external_user" | "runtime_synthetic";
  outcome?: "success" | "error" | "cancelled" | "unknown";
  result_of_event_uid?: string | null;
  turn_index?: number;
  turn_end_status?: "nonterminal" | "final_reply" | "cancelled";
  boundary_type?: "compact" | "shutdown";
};

type ExecutionFixture = {
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  events: ExecutionFixtureEvent[];
};

type GraphSnapshot = {
  units: Array<Record<string, unknown>>;
  contains: Array<Record<string, unknown>>;
  finalizers: Array<Record<string, unknown>>;
  owners: number;
  initiators: number;
};

const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath() });
let config: Neo4jConfig | undefined;
let database: string | undefined;
const eventSeed = randomUUID().split("-");
const [eventPrefixA, eventPrefixB, eventPrefixC, eventPrefixD] = eventSeed;
let driver: neo4j.Driver | undefined;
function eventUid(sequence: number): string {
  return `${eventPrefixA}-${eventPrefixB}-${eventPrefixC}-${eventPrefixD}-${sequence.toString(16).padStart(12, "0")}`;
}


function fingerprint(sequence: number): string {
  return sequence.toString(16).padStart(64, "0");
}

function fixture(events: Array<Omit<ExecutionFixtureEvent, "event_uid" | "ingest_sequence">> = []): ExecutionFixture {
  const project_uid = randomUUID();
  const session_uid = randomUUID();
  return {
    fixture_run_id: randomUUID(),
    project_uid,
    session_uid,
    events: events.map((event, ingest_sequence) => ({ ...event, event_uid: eventUid(ingest_sequence), ingest_sequence })),
  };
}

function properties(fixtureData: ExecutionFixture, event: ExecutionFixtureEvent): Record<string, unknown> {
  return {
    event_uid: event.event_uid,
    schema_id: "anima.raw-event/v1.0",
    event_identity_method: "source",
    session_uid: fixtureData.session_uid,
    session_identity_method: "source",
    project_uid: fixtureData.project_uid,
    project_identity_method: "derived",
    kind: event.kind,
    runtime_identity_json: JSON.stringify({ schema_id: "anima.runtime-identity/v1.0", installation_uid: fixtureData.fixture_run_id, runtime_family: "execution-test", adapter_version: "execution-test", core_version: "capture-test", profile_uid: fixtureData.fixture_run_id, profile_identity_method: "derived" }),
    capture_capabilities_json: JSON.stringify({ schema_id: "anima.capture-capabilities/v1.0", stable_session_id: true, stable_event_id: true, stable_tool_call_id: true, final_assistant_message: true, final_tool_result: true, developer_messages: true, multimodal_content: true, source_sequence: false, source_timestamp: true, compact_event: true, shutdown_event: true, user_message_origin: true, turn_end_event: true }),
    source_json: JSON.stringify({ event_name: event.kind === "turn_end" ? "turn_end" : event.kind, event_id: event.event_uid, session_id: fixtureData.session_uid }),
    ingest_sequence: event.ingest_sequence,
    captured_at: "2026-09-21T00:00:00.000Z",
    content_parts_json: "[]",
    fidelity_json: JSON.stringify({ completeness: "full", missing_fields: [] }),
    native_payload_json: JSON.stringify({ fixture_run_id: fixtureData.fixture_run_id, event_uid: event.event_uid }),
    fingerprint: fingerprint(event.ingest_sequence),
    fixture_run_id: fixtureData.fixture_run_id,
    ...(event.role === undefined ? {} : { role: event.role }),
    ...(event.message_origin === undefined ? {} : { message_origin: event.message_origin }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    ...(event.turn_index === undefined ? {} : { turn_index: event.turn_index }),
    ...(event.turn_end_status === undefined ? {} : { turn_end_status: event.turn_end_status }),
    ...(event.boundary_type === undefined ? {} : { boundary_type: event.boundary_type }),
    ...(event.result_of_event_uid === undefined || event.result_of_event_uid === null ? {} : { correlation_json: JSON.stringify({ method: "source", source_tool_call_id: event.result_of_event_uid }) }),
  };
}

function structuralLabel(kind: ExecutionFixtureEvent["kind"]): string {
  if (kind === "message") return "Message";
  if (kind === "tool_call") return "ToolCall";
  if (kind === "tool_result") return "ToolResult";
  if (kind === "turn_end") return "TurnEnd";
  return "BoundarySignal";
}

async function withSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  if (config === undefined || database === undefined) throw new Error("Neo4j execution fixture is not initialized.");
  driver ??= neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  const session = driver.session({ database });
  try {
    return await work(session);
  } finally {
    await session.close();
    // Bun returns the closed Neo4j session to the pool on the next timer turn.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function writeFixture(fixtureData: ExecutionFixture): Promise<void> {
  await withSession((session) => session.executeWrite(async (transaction) => {
    await transaction.run("CREATE (p:Project) SET p = $properties", { properties: { project_uid: fixtureData.project_uid, identity_fingerprint: fixtureData.project_uid, fixture_run_id: fixtureData.fixture_run_id } });
    await transaction.run("CREATE (s:Session) SET s = $properties", { properties: { session_uid: fixtureData.session_uid, project_uid: fixtureData.project_uid, next_ingest_sequence: fixtureData.events.length, fixture_run_id: fixtureData.fixture_run_id } });
    await transaction.run("MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)", fixtureData);
    for (const event of fixtureData.events) {
      await transaction.run(`CREATE (e:RawEvent:${structuralLabel(event.kind)}) SET e = $properties`, { properties: properties(fixtureData, event) });
      await transaction.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)", { ...fixtureData, event_uid: event.event_uid });
      if (event.result_of_event_uid !== undefined && event.result_of_event_uid !== null) {
        await transaction.run("MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)", { event_uid: event.event_uid, target_uid: event.result_of_event_uid });
      }
    }
  }));
}

async function appendFixture(fixtureData: ExecutionFixture, events: Array<Omit<ExecutionFixtureEvent, "event_uid" | "ingest_sequence">>): Promise<void> {
  const additions = events.map((event, offset) => ({ ...event, event_uid: eventUid(fixtureData.events.length + offset), ingest_sequence: fixtureData.events.length + offset }));
  await withSession((session) => session.executeWrite(async (transaction) => {
    for (const event of additions) {
      await transaction.run(`CREATE (e:RawEvent:${structuralLabel(event.kind)}) SET e = $properties`, { properties: properties(fixtureData, event) });
      await transaction.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)", { ...fixtureData, event_uid: event.event_uid });
      if (event.result_of_event_uid !== undefined && event.result_of_event_uid !== null) {
        await transaction.run("MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)", { event_uid: event.event_uid, target_uid: event.result_of_event_uid });
      }
    }
    await transaction.run("MATCH (s:Session {session_uid: $session_uid}) SET s.next_ingest_sequence = $next_ingest_sequence", { session_uid: fixtureData.session_uid, next_ingest_sequence: fixtureData.events.length + additions.length });
  }));
  fixtureData.events.push(...additions);
}

function driverAppendingAfterSourceIdentity(
  realDriver: neo4j.Driver,
  fixtureData: ExecutionFixture,
): neo4j.Driver {
  let appendStarted = false;
  const wrapTransaction = <T extends Pick<neo4j.ManagedTransaction, "run">>(transaction: T): T => new Proxy(transaction, {
    get(target, property) {
      if (property === "run") {
        return async (...args: Parameters<neo4j.ManagedTransaction["run"]>) => {
          const result = await target.run(...args);
          const query = args[0];
          if (!appendStarted && typeof query === "string" && query.includes("RETURN p AS p, s AS s, has_session AS has_session")) {
            appendStarted = true;
            await appendFixture(fixtureData, [
              { kind: "tool_result", outcome: "success", result_of_event_uid: eventUid(1) },
              { kind: "turn_end", turn_index: 0, turn_end_status: "final_reply" },
            ]);
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const wrapSession = (session: neo4j.Session): neo4j.Session => new Proxy(session, {
    get(target, property) {
      if (property === "executeWrite") {
        return (...args: Parameters<neo4j.Session["executeWrite"]>) => {
          const [work, transactionConfig] = args;
          return target.executeWrite(
            (transaction) => work(wrapTransaction(transaction)),
            transactionConfig,
          );
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(realDriver, {
    get(target, property) {
      if (property === "session") {
        return (...args: Parameters<neo4j.Driver["session"]>) => wrapSession(target.session(...args));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function snapshot(fixtureData: ExecutionFixture): Promise<GraphSnapshot> {
  return withSession((session) => session.executeRead(async (transaction) => {
    const units = await transaction.run("MATCH (e:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid}) RETURN properties(e) AS properties ORDER BY e.start_ingest_sequence", fixtureData);
    const contains = await transaction.run("MATCH (e:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:CONTAINS]->(raw:RawEvent) RETURN properties(r) AS properties ORDER BY r.position", fixtureData);
    const finalizers = await transaction.run("MATCH (e:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:FINALIZED_BY]->(raw:RawEvent) RETURN properties(r) AS properties", fixtureData);
    const owners = await transaction.run("MATCH (:Session {session_uid: $session_uid})-[:HAS_EXECUTION]->(:ExecutionUnit {project_uid: $project_uid}) RETURN count(*) AS count", fixtureData);
    const initiators = await transaction.run("MATCH (:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[:INITIATED_BY]->(:RawEvent) RETURN count(*) AS count", fixtureData);
    const number = (value: unknown): number => neo4j.isInt(value) ? value.toNumber() : Number(value);
    return {
      units: units.records.map((record) => record.get("properties") as Record<string, unknown>),
      contains: contains.records.map((record) => record.get("properties") as Record<string, unknown>),
      finalizers: finalizers.records.map((record) => record.get("properties") as Record<string, unknown>),
      owners: number(owners.records[0]?.get("count") ?? 0),
      initiators: number(initiators.records[0]?.get("count") ?? 0),
    };
  }));
}

async function cleanup(fixtureData: ExecutionFixture): Promise<void> {
  await withSession((session) => session.executeWrite(async (transaction) => {
    await transaction.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE c", fixtureData);
    await transaction.run("MATCH (e:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE e", fixtureData);
    await transaction.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", fixtureData);
  }));
}


beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error(`Neo4j execution fixture requires config: ${loaded.kind}`);
  config = loaded.config;
  database = config.database;
  const health = await store.initialize();
  if (health.status !== "connected") throw new Error(`Neo4j execution fixture requires a connected store: ${health.status}`);
});

afterAll(async () => {
  await store.close();
  if (driver !== undefined) await driver.close();
});

describe("Neo4j ExecutionUnit materialization", () => {
  test("creates exact open topology, then updates the same node to completed", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
    ]);
    try {
      await writeFixture(fixtureData);
      const first = await store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid });
      expect(first).toMatchObject({ status: "materialized", execution_units_created: 1, execution_units_updated: 0, event_links_created: 2, through_ingest_sequence: 1 });
      const open = await snapshot(fixtureData);
      expect(open.units).toHaveLength(1);
      expect(open.units[0]).toMatchObject({ schema_id: "anima.execution-unit/v1.0", projector_version: "anima.execution-projector/v1", project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid, initiator_kind: "user_request", state: "open", start_ingest_sequence: 0, end_ingest_sequence: 1, event_count: 2 });
      expect(Object.keys(open.units[0]!).sort()).toEqual(["end_ingest_sequence", "event_count", "execution_uid", "first_tool_call_event_uid", "initiator_event_uid", "initiator_kind", "project_uid", "projector_version", "schema_id", "session_uid", "source_fingerprint", "start_ingest_sequence", "state"]);
      expect(open.contains).toHaveLength(2);
      expect(open.contains.map((link) => link.position)).toEqual([0, 1]);
      expect(open.owners).toBe(1);
      expect(open.initiators).toBe(1);

      await appendFixture(fixtureData, [
        { kind: "tool_result", outcome: "success", result_of_event_uid: eventUid(1) },
        { kind: "turn_end", turn_index: 3, turn_end_status: "final_reply" },
      ]);
      const second = await store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid });
      expect(second).toMatchObject({ status: "materialized", execution_units_created: 0, execution_units_updated: 1, event_links_created: 2, through_ingest_sequence: 3 });
      const completed = await snapshot(fixtureData);
      expect(completed.units[0]).toMatchObject({ state: "completed", terminal_reason: "final_reply", terminal_event_uid: eventUid(3), end_ingest_sequence: 3, event_count: 4 });
      expect(completed.contains).toHaveLength(4);
      expect(completed.contains.at(-1)).toMatchObject({ position: 3, role: "terminal", schema_id: "anima.execution-event/v1.0" });
      expect(completed.finalizers).toEqual([{ schema_id: "anima.execution-terminal/v1.0", terminal_reason: "final_reply" }]);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });
  test("serializes materialization behind a Session lock without losing the committed counter", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success", result_of_event_uid: eventUid(1) },
      { kind: "message", role: "assistant" },
      { kind: "turn_end", turn_index: 0, turn_end_status: "final_reply" },
    ]);
    let releaseHolder!: () => void;
    let signalReady!: () => void;
    const held = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const ready = new Promise<void>((resolve) => { signalReady = resolve; });
    let holder: Promise<void> | undefined;
    let materializing: Promise<Awaited<ReturnType<Neo4jMemoryStore["materializeExecutionUnits"]>>> | undefined;
    try {
      await writeFixture(fixtureData);
      holder = withSession(async (session) => session.executeWrite(async (transaction) => {
        await transaction.run(
          "MATCH (s:Session {session_uid: $session_uid}) SET s._anima_session_lock = true REMOVE s._anima_session_lock",
          { session_uid: fixtureData.session_uid },
        );
        signalReady();
        await held;
        const shutdown = { kind: "boundary" as const, boundary_type: "shutdown" as const, event_uid: eventUid(5), ingest_sequence: 5 };
        await transaction.run(`CREATE (e:RawEvent:${structuralLabel(shutdown.kind)}) SET e = $properties`, { properties: properties(fixtureData, shutdown) });
        await transaction.run(
          "MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p) SET s.next_ingest_sequence = 6",
          { ...fixtureData, event_uid: shutdown.event_uid },
        );
      })).then(() => undefined);
      await ready;
      materializing = store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid });
      let blocked = false;
      const deadline = Date.now() + 5_000;
      while (!blocked && Date.now() < deadline) {
        const observed = await withSession((session) => session.executeRead((transaction) => transaction.run(
          "SHOW TRANSACTIONS YIELD parameters, status RETURN parameters, status",
        )));
        blocked = observed.records.some((record) => {
          const parameters = record.get("parameters") as Record<string, unknown>;
          return parameters.session_uid === fixtureData.session_uid && String(record.get("status")).startsWith("Blocked");
        });
      }
      expect(blocked).toBe(true);
      releaseHolder();
      await Promise.allSettled([holder, materializing]);
      expect(await materializing).toMatchObject({ status: "materialized" });
      const graph = await snapshot(fixtureData);
      expect(graph.units).toHaveLength(1);
      expect(graph.units[0]).toMatchObject({ state: "completed", terminal_reason: "final_reply", event_count: 5, start_ingest_sequence: 0, end_ingest_sequence: 4 });
      expect(graph.contains.map((link) => link.position)).toEqual([0, 1, 2, 3, 4]);
      const raw = await withSession((session) => session.executeRead((transaction) => transaction.run(
        "MATCH (:Session {session_uid: $session_uid})-[:HAS_EVENT]->(event:RawEvent) RETURN event.ingest_sequence AS sequence ORDER BY sequence",
        { session_uid: fixtureData.session_uid },
      )));
      expect(raw.records.map((record) => Number(record.get("sequence")))).toEqual([0, 1, 2, 3, 4, 5]);
      const state = await withSession((session) => session.executeRead((transaction) => transaction.run(
        "MATCH (s:Session {session_uid: $session_uid}) RETURN s.next_ingest_sequence AS counter, s._anima_session_lock AS lock",
        { session_uid: fixtureData.session_uid },
      )));
      expect(Number(state.records[0]?.get("counter"))).toBe(6);
      expect(state.records[0]?.get("lock")).toBeNull();
    } finally {
      releaseHolder();
      if (holder !== undefined) await Promise.allSettled([holder, materializing]);
      else if (materializing !== undefined) await Promise.allSettled([materializing]);
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });
  test("updates the same open node to cancelled without a tool result, then replays exactly", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
    ]);
    try {
      await writeFixture(fixtureData);
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({
        status: "materialized",
        execution_units_created: 1,
        execution_units_updated: 0,
        event_links_created: 2,
        through_ingest_sequence: 1,
      });
      const open = await snapshot(fixtureData);
      expect(open.units[0]).toMatchObject({ state: "open", end_ingest_sequence: 1, event_count: 2 });

      await appendFixture(fixtureData, [{ kind: "turn_end", turn_index: 2, turn_end_status: "cancelled" }]);
      const cancelled = await store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid });
      expect(cancelled).toMatchObject({
        status: "materialized",
        execution_units_created: 0,
        execution_units_updated: 1,
        event_links_created: 1,
        through_ingest_sequence: 2,
      });
      const terminal = await snapshot(fixtureData);
      expect(terminal.units).toHaveLength(1);
      expect(terminal.units[0]).toMatchObject({
        state: "cancelled",
        terminal_reason: "user_cancelled",
        terminal_event_uid: eventUid(2),
        end_ingest_sequence: 2,
        event_count: 3,
      });
      expect(terminal.contains).toHaveLength(3);
      expect(terminal.contains.at(-1)).toMatchObject({ position: 2, role: "terminal", schema_id: "anima.execution-event/v1.0" });
      expect(terminal.finalizers).toEqual([{ schema_id: "anima.execution-terminal/v1.0", terminal_reason: "user_cancelled" }]);

      const replayBefore = await snapshot(fixtureData);
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toEqual({
        status: "up_to_date",
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        through_ingest_sequence: 2,
      });
      await expect(snapshot(fixtureData)).resolves.toEqual(replayBefore);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });

  test("persists compact as interrupted at the graph boundary", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
      { kind: "boundary", boundary_type: "compact" },
    ]);
    try {
      await writeFixture(fixtureData);
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({
        status: "materialized",
        execution_units_created: 1,
        execution_units_updated: 0,
        event_links_created: 3,
        through_ingest_sequence: 2,
      });
      const compacted = await snapshot(fixtureData);
      expect(compacted.units).toHaveLength(1);
      expect(compacted.units[0]).toMatchObject({
        state: "interrupted",
        terminal_reason: "session_compact",
        terminal_event_uid: eventUid(2),
      });
      expect(compacted.contains.at(-1)).toMatchObject({ position: 2, role: "terminal", schema_id: "anima.execution-event/v1.0" });
      expect(compacted.finalizers).toEqual([{ schema_id: "anima.execution-terminal/v1.0", terminal_reason: "session_compact" }]);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });
  test("replays exactly and creates two non-overlapping units in one Session", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "error", result_of_event_uid: eventUid(1) },
      { kind: "turn_end", turn_index: 3, turn_end_status: "final_reply" },
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
    ]);
    try {
      await writeFixture(fixtureData);
      const first = await store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid });
      expect(first).toMatchObject({ status: "materialized", execution_units_created: 2 });
      const before = await snapshot(fixtureData);
      const replay = await store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid });
      expect(replay).toEqual({ status: "up_to_date", project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid, through_ingest_sequence: 5 });
      await expect(snapshot(fixtureData)).resolves.toEqual(before);
      expect(before.units).toHaveLength(2);
      expect(before.contains.filter((link) => link.position === 0)).toHaveLength(2);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });

  test("rejects corrupted ownership, labels, fingerprints, RESULT_OF, and relationship topology without mutation", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success", result_of_event_uid: eventUid(1) },
    ]);
    try {
      await writeFixture(fixtureData);
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "materialized" });
      const before = await snapshot(fixtureData);
      const execution_uid = String(before.units[0]?.execution_uid);
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (e:ExecutionUnit {execution_uid: $execution_uid}) SET e.project_uid = $other_project_uid", { execution_uid, other_project_uid: randomUUID() })));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (e:ExecutionUnit {execution_uid: $execution_uid}) SET e.project_uid = $project_uid", { ...fixtureData, execution_uid })));
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (e:ExecutionUnit {execution_uid: $execution_uid}) REMOVE e:ExecutionUnit", { execution_uid })));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (e {execution_uid: $execution_uid}) SET e:ExecutionUnit", { execution_uid })));
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (raw:RawEvent {event_uid: $event_uid}) SET raw.fingerprint = $fingerprint", { event_uid: eventUid(2), fingerprint: "f".repeat(64) })));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (raw:RawEvent {event_uid: $event_uid}) SET raw.fingerprint = $fingerprint", { event_uid: eventUid(2), fingerprint: fingerprint(2) })));
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (result:RawEvent {event_uid: $event_uid})-[r:RESULT_OF]->() DELETE r", { event_uid: eventUid(2) })));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)", { event_uid: eventUid(2), target_uid: eventUid(1) })));
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:CONTAINS]->() SET r.extra = true", fixtureData)));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:CONTAINS]->() REMOVE r.extra", fixtureData)));
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (e:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:CONTAINS]->(raw:RawEvent {event_uid: $event_uid}) CREATE (e)-[:CONTAINS {schema_id: r.schema_id, position: r.position, role: r.role}]->(raw)", { ...fixtureData, event_uid: eventUid(1) })));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await withSession((session) => session.executeWrite((transaction) => transaction.run("MATCH (e:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:CONTAINS]->(raw:RawEvent {event_uid: $event_uid}) WITH collect(r) AS rels UNWIND rels[1..] AS duplicate DELETE duplicate", { ...fixtureData, event_uid: eventUid(1) })));
      await expect(snapshot(fixtureData)).resolves.toEqual(before);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });
  test("materializes a completed review candidate with exact evidence topology, then replays", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "error", result_of_event_uid: eventUid(1) },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success", result_of_event_uid: eventUid(3) },
      { kind: "turn_end", turn_index: 3, turn_end_status: "final_reply" },
    ]);
    const readCandidateGraph = async () => withSession((session) => session.executeRead(async (transaction) => {
      const number = (value: unknown): number => neo4j.isInt(value) ? value.toNumber() : Number(value);
      const candidates = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid})
         RETURN {candidate_uid: c.candidate_uid, execution_uid: c.execution_uid,
                 project_uid: c.project_uid, session_uid: c.session_uid,
                 review_contract_version: c.review_contract_version,
                 execution_state: c.execution_state, terminal_reason: c.terminal_reason,
                 source_fingerprint: c.source_fingerprint,
                 tool_call_count: c.tool_call_count, tool_result_count: c.tool_result_count,
                 tool_error_count: c.tool_error_count, state: c.state,
                 created_at: toString(c.created_at)} AS candidate
         ORDER BY c.candidate_uid`,
        fixtureData,
      );
      const candidateRecord = candidates.records[0]?.get("candidate");
      const candidate: Record<string, unknown> | null = candidateRecord === undefined || candidateRecord === null ? null : (() => {
        const value = candidateRecord as Record<string, unknown>;
        return {
          ...value,
          tool_call_count: number(value.tool_call_count),
          tool_result_count: number(value.tool_result_count),
          tool_error_count: number(value.tool_error_count),
        };
      })();
      const containsResult = await transaction.run(
        `MATCH (u:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:CONTAINS]->(event:RawEvent)
         RETURN event.event_uid AS event_uid, properties(r) AS relation
         ORDER BY r.position`,
        fixtureData,
      );
      const contains = containsResult.records.map((record) => {
        const relation = record.get("relation") as Record<string, unknown>;
        return {
          event_uid: String(record.get("event_uid")),
          position: number(relation.position),
          role: String(relation.role),
          schema_id: String(relation.schema_id),
        };
      });
      const evidenceResult = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid})-[r:EVIDENCED_BY]->(event:RawEvent)
         RETURN event.event_uid AS event_uid, properties(r) AS relation
         ORDER BY r.position`,
        fixtureData,
      );
      const evidence = evidenceResult.records.map((record) => {
        const relation = record.get("relation") as Record<string, unknown>;
        return {
          event_uid: String(record.get("event_uid")),
          position: number(relation.position),
          role: String(relation.role),
          schema_id: String(relation.schema_id),
        };
      });
      const candidateCount = await transaction.run(
        "MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) RETURN count(c) AS count",
        fixtureData,
      );
      const hasLinkCount = await transaction.run(
        `MATCH (:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:HAS_REVIEW_CANDIDATE]->(:ExecutionReviewCandidate)
         RETURN count(r) AS count`,
        fixtureData,
      );
      const reviewsCount = await transaction.run(
        `MATCH (:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid})-[r:REVIEWS]->(:ExecutionUnit)
         RETURN count(r) AS count`,
        fixtureData,
      );
      const evidenceCount = await transaction.run(
        `MATCH (:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid})-[r:EVIDENCED_BY]->(:RawEvent)
         RETURN count(r) AS count`,
        fixtureData,
      );
      const count = (result: neo4j.QueryResult): number => number(result.records[0]?.get("count") ?? 0);
      const links = await transaction.run(
        `MATCH (u:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[has:HAS_REVIEW_CANDIDATE]->(c:ExecutionReviewCandidate)-[reviews:REVIEWS]->(target:ExecutionUnit)
         RETURN u.execution_uid AS owner_execution_uid, target.execution_uid AS target_execution_uid,
                properties(has) AS has, properties(reviews) AS reviews`,
        fixtureData,
      );
      const link = links.records[0];
      return {
        candidate,
        contains,
        evidence,
        candidate_count: count(candidateCount),
        has_link_count: count(hasLinkCount),
        reviews_count: count(reviewsCount),
        evidence_count: count(evidenceCount),
        links: link === undefined ? null : {
          owner_execution_uid: String(link.get("owner_execution_uid")),
          target_execution_uid: String(link.get("target_execution_uid")),
          has: link.get("has") as Record<string, unknown>,
          reviews: link.get("reviews") as Record<string, unknown>,
        },
      };
    }));
    try {
      await writeFixture(fixtureData);
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({
        status: "materialized",
        execution_units_created: 1,
        execution_units_updated: 0,
        event_links_created: 6,
        through_ingest_sequence: 5,
      });
      const units = await snapshot(fixtureData);
      const unit = units.units[0];
      expect(unit).toBeDefined();
      const execution_uid = String(unit?.execution_uid);
      await expect(store.materializeExecutionReviewCandidates({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toEqual({
        status: "materialized",
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        through_ingest_sequence: 5,
        candidates_created: 1,
        evidence_links_created: 6,
      });
      const firstGraph = await readCandidateGraph();
      expect(firstGraph.candidate_count).toBe(1);
      expect(firstGraph.has_link_count).toBe(1);
      expect(firstGraph.reviews_count).toBe(1);
      expect(firstGraph.evidence_count).toBe(6);
      expect(firstGraph.candidate).not.toBeNull();
      expect(Object.keys(firstGraph.candidate ?? {}).sort()).toEqual([
        "candidate_uid",
        "created_at",
        "execution_state",
        "execution_uid",
        "project_uid",
        "review_contract_version",
        "session_uid",
        "source_fingerprint",
        "state",
        "terminal_reason",
        "tool_call_count",
        "tool_error_count",
        "tool_result_count",
      ]);
      expect(firstGraph.candidate).toEqual({
        candidate_uid: expect.any(String),
        execution_uid,
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        review_contract_version: "v1",
        execution_state: "completed",
        terminal_reason: "final_reply",
        source_fingerprint: String(unit?.source_fingerprint),
        tool_call_count: 2,
        tool_result_count: 2,
        tool_error_count: 1,
        state: "ready",
        created_at: expect.any(String),
      });
      expect(firstGraph.links).toEqual({
        owner_execution_uid: execution_uid,
        target_execution_uid: execution_uid,
        has: { schema_id: "anima.execution-review-candidate-link/v1.0" },
        reviews: { schema_id: "anima.execution-review-target/v1.0" },
      });
      expect(firstGraph.contains).toEqual(fixtureData.events.map((event, position) => ({
        event_uid: event.event_uid,
        position,
        role: position === 0 ? "initiator" : position === 1 ? "first_tool_call" : position === fixtureData.events.length - 1 ? "terminal" : "member",
        schema_id: "anima.execution-event/v1.0",
      })));
      expect(firstGraph.evidence).toEqual(firstGraph.contains.map(({ event_uid, position, role }) => ({
        event_uid,
        position,
        role,
        schema_id: "anima.execution-review-evidence/v1.0",
      })));

      await expect(store.materializeExecutionReviewCandidates({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toEqual({
        status: "up_to_date",
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        through_ingest_sequence: 5,
      });
      await expect(readCandidateGraph()).resolves.toEqual(firstGraph);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });

  test("keeps candidate materialization on its captured prefix during a concurrent append", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
    ]);
    let candidateStore: Neo4jMemoryStore | undefined;
    try {
      await writeFixture(fixtureData);
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({
        status: "materialized",
        execution_units_created: 1,
        execution_units_updated: 0,
        event_links_created: 2,
        through_ingest_sequence: 1,
      });
      const open = await snapshot(fixtureData);
      expect(open.units).toHaveLength(1);
      expect(open.units[0]).toMatchObject({ state: "open", start_ingest_sequence: 0, end_ingest_sequence: 1, event_count: 2 });
      const executionUid = open.units[0]?.execution_uid;
      if (typeof executionUid !== "string") throw new Error("Open fixture unit has no execution UID.");

      const raceStore = new Neo4jMemoryStore({
        configPath: syntheticConfigPath(),
        driverFactory: (candidateConfig) => driverAppendingAfterSourceIdentity(
          neo4j.driver(candidateConfig.uri, neo4j.auth.basic(candidateConfig.username, candidateConfig.password)),
          fixtureData,
        ),
      });
      candidateStore = raceStore;
      expect((await raceStore.initialize()).status).toBe("connected");
      await expect(raceStore.materializeExecutionReviewCandidates({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toEqual({
        status: "up_to_date",
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        through_ingest_sequence: 1,
      });

      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({
        status: "materialized",
        execution_units_created: 0,
        execution_units_updated: 1,
        event_links_created: 2,
        through_ingest_sequence: 3,
      });
      const completed = await snapshot(fixtureData);
      expect(completed.units).toHaveLength(1);
      expect(completed.units[0]).toMatchObject({
        execution_uid: executionUid,
        state: "completed",
        terminal_reason: "final_reply",
        terminal_event_uid: eventUid(3),
        end_ingest_sequence: 3,
        event_count: 4,
      });
      const finalizedBy = await withSession((session) => session.executeRead((transaction) => transaction.run(
        `MATCH (:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:FINALIZED_BY]->(terminal:RawEvent)
         RETURN terminal.event_uid AS terminal_event_uid, properties(r) AS properties`,
        fixtureData,
      )));
      expect(finalizedBy.records).toHaveLength(1);
      expect(finalizedBy.records[0]?.get("terminal_event_uid")).toBe(eventUid(3));
      expect(finalizedBy.records[0]?.get("properties")).toEqual({
        schema_id: "anima.execution-terminal/v1.0",
        terminal_reason: "final_reply",
      });

      await expect(store.materializeExecutionReviewCandidates({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toEqual({
        status: "materialized",
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        through_ingest_sequence: 3,
        candidates_created: 1,
        evidence_links_created: 4,
      });
      const candidates = await withSession((session) => session.executeRead((transaction) => transaction.run(
        `MATCH (candidate:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid})
         RETURN candidate.execution_uid AS execution_uid, candidate.execution_state AS execution_state,
                candidate.terminal_reason AS terminal_reason`,
        fixtureData,
      )));
      expect(candidates.records).toHaveLength(1);
      expect(candidates.records[0]?.toObject()).toMatchObject({
        execution_uid: executionUid,
        execution_state: "completed",
        terminal_reason: "final_reply",
      });
    } finally {
      try {
        await candidateStore?.close();
      } finally {
        await cleanup(fixtureData);
      }
    }
  }, { timeout: 30_000 });

  test("rejects duplicate sequences inside the captured prefix without writing a unit", async () => {
    const fixtureData = fixture([
      { kind: "message", role: "user", message_origin: "external_user" },
      { kind: "tool_call" },
    ]);
    try {
      await writeFixture(fixtureData);
      await withSession((session) => session.executeWrite((transaction) => transaction.run(
        "MATCH (event:RawEvent {event_uid: $event_uid}) SET event.ingest_sequence = 0",
        { event_uid: eventUid(1) },
      )));
      await expect(store.materializeExecutionUnits({ project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid })).resolves.toMatchObject({
        status: "failed",
        code: "source_incomplete",
      });
      const graph = await snapshot(fixtureData);
      expect(graph.units).toEqual([]);
      expect(graph.contains).toEqual([]);
    } finally {
      await cleanup(fixtureData);
    }
  }, { timeout: 30_000 });
});
