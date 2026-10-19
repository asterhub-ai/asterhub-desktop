import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { syntheticConfigPath } from "./dev-config.ts";
import { boundaryWindowUid, episodeUid, sessionContinuationDecisionUid } from "../src/index.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";

type EventKind = "message" | "tool_call" | "tool_result" | "boundary";
type BoundaryType = "checkpoint" | "compact" | "shutdown" | "validation";
type FixtureEvent = { event_uid: string; ingest_sequence: number; kind: EventKind; boundary_type?: BoundaryType; outcome?: "success" | "error"; tool_call_event_uid?: string };
type Fixture = { project_uid: string; session_uid: string; events: FixtureEvent[] };

let config: Neo4jConfig;
let driver: neo4j.Driver;
let database: string;
let store: Neo4jMemoryStore;

function integer(value: unknown): number {
  return neo4j.isInt(value) ? value.toNumber() : Number(value);
}
function normalize(value: unknown): unknown {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)]));
  }
  return value;
}
class LockBarrier {
  enabled = false;
  private waiting = 0;
  private waiters: Array<() => void> = [];

  private beforeRelease?: () => Promise<void>;
  arm(beforeRelease?: () => Promise<void>): void {
    this.enabled = true;
    this.waiting = 0;
    this.waiters = [];
    this.beforeRelease = beforeRelease;
  }

  async wait(): Promise<void> {
    if (!this.enabled) return;
    this.waiting += 1;
    if (this.waiting === 2) {
      const beforeRelease = this.beforeRelease;
      this.beforeRelease = undefined;
      if (beforeRelease !== undefined) await beforeRelease();
      this.enabled = false;
      const waiters = this.waiters.splice(0);
      for (const resolve of waiters) resolve();
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

function withLockBarrier(base: neo4j.Driver, barrier: LockBarrier): neo4j.Driver {
  return {
    verifyConnectivity: () => base.verifyConnectivity(),
    session(options?: { database?: string }) {
      const session = base.session(options);
      return {
        run: session.run.bind(session),
        executeRead: session.executeRead?.bind(session),
        executeWrite<T>(work: (tx: neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
          return session.executeWrite(async (tx) => {
            let held = false;
            const gatedTx = {
              run(query: string, parameters?: Record<string, unknown>) {
                if (!held && barrier.enabled && query.includes("SET w.window_uid = w.window_uid")) {
                  held = true;
                  return barrier.wait().then(() => tx.run(query, parameters));
                }
                return tx.run(query, parameters);
              },
            } as unknown as neo4j.ManagedTransaction;
            return work(gatedTx);
          });
        },
        close: session.close.bind(session),
      } as unknown as neo4j.Session;
    },
    close: () => base.close(),
  } as unknown as neo4j.Driver;
}
const concurrencyBarrier = new LockBarrier();



async function writeGraph(work: (tx: neo4j.ManagedTransaction) => Promise<void>): Promise<void> {
  const session = driver.session({ database });
  try {
    await session.executeWrite(work);
  } finally {
    await session.close();
  }
}

async function readGraph<T>(work: (tx: neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
  const session = driver.session({ database });
  try {
    return await session.executeRead(work);
  } finally {
    await session.close();
  }
}

function fixture(events: Array<Pick<FixtureEvent, "kind" | "boundary_type" | "outcome" | "tool_call_event_uid">>): Fixture {
  return {
    project_uid: randomUUID(),
    session_uid: randomUUID(),
    events: events.map((event, ingest_sequence) => ({ event_uid: randomUUID(), ingest_sequence, ...event })),
  };
}

async function seedAndProcess(data: Fixture): Promise<void> {
  await writeGraph(async (tx) => {
    await tx.run("CREATE (p:Project) SET p = $properties", { properties: { project_uid: data.project_uid } });
    await tx.run("CREATE (s:Session) SET s = $properties", { properties: { session_uid: data.session_uid, project_uid: data.project_uid, next_ingest_sequence: data.events.length } });
    await tx.run("MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)", data);
    for (const event of data.events) {
      const label = event.kind === "boundary" ? "BoundarySignal" : event.kind === "tool_call" ? "ToolCall" : event.kind === "tool_result" ? "ToolResult" : "Message";
      await tx.run(`CREATE (e:RawEvent:${label}) SET e = $properties`, {
        properties: {
          event_uid: event.event_uid,
          project_uid: data.project_uid,
          session_uid: data.session_uid,
          kind: event.kind,
          ingest_sequence: event.ingest_sequence,
          ...(event.boundary_type === undefined ? {} : { boundary_type: event.boundary_type }),
          ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
          ...(event.tool_call_event_uid === undefined ? {} : { tool_call_event_uid: event.tool_call_event_uid }),
        },
      });
      await tx.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e), (e)-[:IN_PROJECT]->(p)", { ...data, event_uid: event.event_uid });
      if (event.kind === "tool_result" && event.tool_call_event_uid !== undefined) {
        await tx.run("MATCH (e:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $tool_call_event_uid}) CREATE (e)-[:RESULT_OF]->(call)", { event_uid: event.event_uid, tool_call_event_uid: event.tool_call_event_uid });
      }
    }
  });
  const result = await store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid });
  expect(result.status).toBe("processed");
}
async function appendAndProcess(data: Fixture, additions: Array<Pick<FixtureEvent, "kind" | "boundary_type" | "outcome" | "tool_call_event_uid">>): Promise<FixtureEvent[]> {
  const start = await readGraph(async (tx) => integer((await tx.run("MATCH (s:Session {session_uid: $session_uid}) RETURN s.next_ingest_sequence AS sequence", data)).records[0]?.get("sequence") ?? 0));
  const events = additions.map((event, index) => ({ event_uid: randomUUID(), ingest_sequence: start + index, ...event }));
  await writeGraph(async (tx) => {
    for (const event of events) {
      const label = event.kind === "boundary" ? "BoundarySignal" : event.kind === "tool_call" ? "ToolCall" : event.kind === "tool_result" ? "ToolResult" : "Message";
      await tx.run(`CREATE (e:RawEvent:${label}) SET e = $properties`, {
        properties: {
          event_uid: event.event_uid,
          project_uid: data.project_uid,
          session_uid: data.session_uid,
          kind: event.kind,
          ingest_sequence: event.ingest_sequence,
          ...(event.boundary_type === undefined ? {} : { boundary_type: event.boundary_type }),
          ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
          ...(event.tool_call_event_uid === undefined ? {} : { tool_call_event_uid: event.tool_call_event_uid }),
        },
      });
      await tx.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e), (e)-[:IN_PROJECT]->(p)", { ...data, event_uid: event.event_uid });
      if (event.kind === "tool_result" && event.tool_call_event_uid !== undefined) {
        await tx.run("MATCH (e:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $tool_call_event_uid}) CREATE (e)-[:RESULT_OF]->(call)", { event_uid: event.event_uid, tool_call_event_uid: event.tool_call_event_uid });
      }
    }
    await tx.run("MATCH (s:Session {session_uid: $session_uid}) SET s.next_ingest_sequence = $next", { session_uid: data.session_uid, next: start + events.length });
  });
  data.events.push(...events);
  const result = await store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid });
  expect(result.status).toBe("processed");
  return events;
}
async function seedAdditionalSession(project_uid: string, session_uid: string, additions: Array<Pick<FixtureEvent, "kind" | "boundary_type" | "outcome" | "tool_call_event_uid">>): Promise<Fixture> {
  const data: Fixture = { project_uid, session_uid, events: additions.map((event, ingest_sequence) => ({ event_uid: randomUUID(), ingest_sequence, ...event })) };
  await writeGraph(async (tx) => {
    await tx.run("CREATE (s:Session) SET s = $properties", { properties: { session_uid, project_uid, next_ingest_sequence: data.events.length } });
    await tx.run("MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)", data);
    for (const event of data.events) {
      const label = event.kind === "boundary" ? "BoundarySignal" : event.kind === "tool_call" ? "ToolCall" : event.kind === "tool_result" ? "ToolResult" : "Message";
      await tx.run(`CREATE (e:RawEvent:${label}) SET e = $properties`, {
        properties: {
          event_uid: event.event_uid,
          project_uid,
          session_uid,
          kind: event.kind,
          ingest_sequence: event.ingest_sequence,
          ...(event.boundary_type === undefined ? {} : { boundary_type: event.boundary_type }),
          ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
        },
      });
      await tx.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e), (e)-[:IN_PROJECT]->(p)", { ...data, event_uid: event.event_uid });
    }
  });
  const result = await store.processSession({ project_uid, session_uid });
  expect(result.status).toBe("processed");
  return data;
}

async function windows(data: Fixture): Promise<Array<Record<string, unknown>>> {
  return readGraph(async (tx) => {
    const result = await tx.run("MATCH (w:BoundaryWindow {project_uid: $project_uid, session_uid: $session_uid}) RETURN properties(w) AS properties ORDER BY w.start_ingest_sequence", data);
    return result.records.map((record) => record.get("properties") as Record<string, unknown>);
  });
}

async function episodeGraph(uid: string): Promise<{ node: Record<string, unknown> | null; projectEdges: Record<string, unknown>[]; windowEdges: Record<string, unknown>[]; evidenceEdges: Record<string, unknown>[] }> {
  return readGraph(async (tx) => {
    const nodeResult = await tx.run("MATCH (e:Episode {episode_uid: $episode_uid}) RETURN properties(e) AS properties", { episode_uid: uid });
    const projectEdges = await tx.run("MATCH (:Project)-[r:HAS_EPISODE]->(e:Episode {episode_uid: $episode_uid}) RETURN properties(r) AS properties", { episode_uid: uid });
    const windowEdges = await tx.run("MATCH (:BoundaryWindow)-[r:IN_EPISODE]->(e:Episode {episode_uid: $episode_uid}) RETURN properties(r) AS properties ORDER BY r.position", { episode_uid: uid });
    const evidenceEdges = await tx.run("MATCH (e:Episode {episode_uid: $episode_uid})-[r:EVIDENCED_BY]->(:RawEvent) RETURN properties(r) AS properties ORDER BY r.role", { episode_uid: uid });
    return {
      node: normalize(nodeResult.records[0]?.get("properties") as Record<string, unknown> | null ?? null) as Record<string, unknown> | null,
      projectEdges: projectEdges.records.map((record) => normalize(record.get("properties")) as Record<string, unknown>),
      windowEdges: windowEdges.records.map((record) => normalize(record.get("properties")) as Record<string, unknown>),
      evidenceEdges: evidenceEdges.records.map((record) => normalize(record.get("properties")) as Record<string, unknown>),
    };
  });
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error("Actual Neo4j configuration is required for Episode tests.");
  config = loaded.config;
  database = config.database;
  driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  const gatedDriver = withLockBarrier(driver, concurrencyBarrier);
  store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), driverFactory: () => gatedDriver });
  const health = await store.initialize();
  if (health.status !== "connected") throw new Error(`Actual Neo4j is required; store is ${health.status}.`);
});

afterAll(async () => {
  await store?.close();
  await driver?.close();
});

describe("concrete Neo4j Episode materialization", () => {
  test("creates one open Episode with exact node and relationship allowlists", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const result = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(result.status).toBe("materialized");
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.node).toMatchObject({ project_uid: data.project_uid, episode_kind: "work", first_window_uid: first.window_uid, last_window_uid: first.window_uid, window_count: 1, revision: 0, state: "open", schema_id: "anima.episode/v1.0", projector_version: "anima.episode-projector/v1" });
    expect(Object.keys(graph.node ?? {}).sort()).toEqual(["creation_decision_uid", "episode_kind", "episode_uid", "first_window_uid", "last_decision_uid", "last_window_uid", "project_uid", "projector_version", "revision", "schema_id", "state", "window_count"].sort());
    expect(graph.projectEdges).toHaveLength(1);
    expect(graph.windowEdges).toHaveLength(1);
    expect(graph.evidenceEdges).toHaveLength(0);
    expect(Object.keys(graph.projectEdges[0] ?? {}).sort()).toEqual(["schema_id", "creation_decision_uid", "decision_revision"].sort());
    expect(Object.keys(graph.windowEdges[0] ?? {}).sort()).toEqual(["schema_id", "position", "decision_uid", "decision_revision"].sort());
    expect(graph.projectEdges[0]).toEqual({ schema_id: "anima.project-episode-link/v1.0", creation_decision_uid: result.status === "materialized" ? result.decision_uid : undefined, decision_revision: 0 });
    expect(graph.windowEdges[0]).toEqual({ schema_id: "anima.episode-window/v1.0", position: 0, decision_uid: result.status === "materialized" ? result.decision_uid : undefined, decision_revision: 0 });
  }, { timeout: 30_000 });

  test("exact replay is duplicate and does not change revision or relationship counts", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "personal" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "personal_explicit" as const, checkpoint_event_uid: String(first.terminal_event_uid) } };
    const firstResult = await store.materializeEpisode(input);
    const before = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    const replay = await store.materializeEpisode(input);
    const after = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(firstResult.status).toBe("materialized");
    expect(replay).toMatchObject({ status: "duplicate", revision: 0, windows_assigned: 0, evidence_links_created: 0 });
    expect(after).toEqual(before);
  }, { timeout: 30_000 });
  test("same-Session contiguous append advances one revision with suffix-only assignment provenance", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const initial = await windows(data);
    const first = initial[0] as Record<string, unknown>;
    await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    await appendAndProcess(data, [{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    const all = await windows(data);
    const outcome = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "work",
      window_uids: all.map((window) => String(window.window_uid)) as [string, string],
      closure: { kind: "none" },
    });
    expect(outcome).toMatchObject({ status: "materialized", revision: 1, windows_assigned: 1 });
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.windowEdges).toHaveLength(2);
    expect(graph.windowEdges[0]).toMatchObject({ position: 0, decision_revision: 0 });
    expect(graph.windowEdges[1]).toMatchObject({ position: 1, decision_revision: 1 });
  }, { timeout: 30_000 });

  test("personal explicit terminal checkpoint creates exactly one checkpoint evidence edge", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const outcome = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "personal", window_uids: [String(first.window_uid)], closure: { kind: "personal_explicit", checkpoint_event_uid: String(first.terminal_event_uid) } });
    expect(outcome).toMatchObject({ status: "materialized", state: "stable_ended", revision: 0, windows_assigned: 1, evidence_links_created: 1 });
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.evidenceEdges).toHaveLength(1);
    expect(graph.evidenceEdges[0]).toMatchObject({ schema_id: "anima.episode-evidence/v1.0", role: "checkpoint", decision_revision: 0 });
    expect(graph.node).not.toHaveProperty("strategy_uid");
    expect(graph.node).not.toHaveProperty("claim_uid");
    expect(graph.node).not.toHaveProperty("project_stage_uid");
  }, { timeout: 30_000 });

  test("stable-ended Episode rejects later same-Session extension", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const initial = await windows(data);
    const first = initial[0] as Record<string, unknown>;
    await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "personal",
      window_uids: [String(first.window_uid)],
      closure: { kind: "personal_explicit", checkpoint_event_uid: String(first.terminal_event_uid) },
    });
    await appendAndProcess(data, [{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    const all = await windows(data);
    const outcome = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "personal",
      window_uids: all.map((window) => String(window.window_uid)) as [string, string],
      closure: { kind: "none" },
    });
    expect(outcome).toMatchObject({ status: "failed", code: "invalid_transition" });
  }, { timeout: 30_000 });

  test("missing requested closure event is not_found before source evidence classification", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const missing = randomUUID();
    const outcome = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "personal",
      window_uids: [String(first.window_uid)],
      closure: { kind: "personal_explicit", checkpoint_event_uid: missing },
    });
    expect(outcome).toEqual({ status: "failed", code: "not_found", message: "Requested Episode source was not found." });
  }, { timeout: 30_000 });

  test("shutdown suspension resumes only through an exact new-Session continuation", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "shutdown" }]);
    await seedAndProcess(data);
    const firstWindows = await windows(data);
    const firstWindow = firstWindows[0] as Record<string, unknown>;
    const suspended = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(firstWindow.window_uid)], closure: { kind: "none" } });
    expect(suspended).toMatchObject({ status: "materialized", state: "suspended", revision: 0 });
    const continued = await seedAdditionalSession(data.project_uid, randomUUID(), [{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    const continuedWindows = await windows(continued);
    const continuedWindow = continuedWindows[0] as Record<string, unknown>;
    const continuation = await store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: continued.session_uid,
      previous_session_uid: data.session_uid,
      checkpoint_event_uid: continued.events[1]!.event_uid,
    });
    expect(continuation.status).toBe("written");
    const resumed = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "work",
      window_uids: [String(firstWindow.window_uid), String(continuedWindow.window_uid)] as [string, string],
      closure: { kind: "none" },
    });
    expect(resumed).toMatchObject({ status: "materialized", state: "open", revision: 1 });
    const graph = await episodeGraph(episodeUid(data.project_uid, String(firstWindow.window_uid)));
    expect(graph.node).not.toHaveProperty("suspension_event_uid");
    expect(graph.evidenceEdges).toHaveLength(1);
    expect(graph.evidenceEdges[0]).toMatchObject({ role: "suspension", decision_revision: 0 });
  }, { timeout: 30_000 });

  test("work closure retains actual RESULT_OF ToolCall provenance and exact evidence edges", async () => {
    const data = fixture([
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success" },
      { kind: "boundary", boundary_type: "validation" },
    ]);
    data.events[2]!.tool_call_event_uid = data.events[1]!.event_uid;
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const second = source[1] as Record<string, unknown>;
    const outcome = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "work",
      window_uids: [String(first.window_uid), String(second.window_uid)] as [string, string],
      closure: {
        kind: "work_validated",
        checkpoint_event_uid: data.events[0]!.event_uid,
        validation_result_event_uid: data.events[2]!.event_uid,
        validation_event_uid: data.events[3]!.event_uid,
      },
    });
    expect(outcome).toMatchObject({ status: "materialized", state: "stable_ended", revision: 0, windows_assigned: 2, evidence_links_created: 3 });
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.evidenceEdges).toHaveLength(3);
    expect(graph.evidenceEdges.map((edge) => edge.role).sort()).toEqual(["checkpoint", "validation", "validation_result"]);
    if (outcome.status === "materialized") {
      expect(graph.node).toEqual({
        episode_uid: episodeUid(data.project_uid, String(first.window_uid)),
        project_uid: data.project_uid,
        episode_kind: "work",
        first_window_uid: first.window_uid,
        last_window_uid: second.window_uid,
        window_count: 2,
        revision: 0,
        state: "stable_ended",
        creation_decision_uid: outcome.decision_uid,
        last_decision_uid: outcome.decision_uid,
        schema_id: "anima.episode/v1.0",
        projector_version: "anima.episode-projector/v1",
        closure_kind: "work_validated",
        checkpoint_event_uid: data.events[0]!.event_uid,
        validation_result_event_uid: data.events[2]!.event_uid,
        validation_event_uid: data.events[3]!.event_uid,
      });
      expect(graph.evidenceEdges.sort((left, right) => String(left.role).localeCompare(String(right.role)))).toEqual([
        { schema_id: "anima.episode-evidence/v1.0", role: "checkpoint", decision_uid: outcome.decision_uid, decision_revision: 0 },
        { schema_id: "anima.episode-evidence/v1.0", role: "validation", decision_uid: outcome.decision_uid, decision_revision: 0 },
        { schema_id: "anima.episode-evidence/v1.0", role: "validation_result", decision_uid: outcome.decision_uid, decision_revision: 0 },
      ].sort((left, right) => left.role.localeCompare(right.role)));
    }
    const provenance = await readGraph(async (tx) => {
      const result = await tx.run(
        "MATCH (result:RawEvent {event_uid: $result_uid})-[:RESULT_OF]->(call:RawEvent) RETURN call.event_uid AS event_uid",
        { result_uid: data.events[2]!.event_uid },
      );
      return result.records[0]?.get("event_uid");
    });
    expect(provenance).toBe(data.events[1]!.event_uid);
  }, { timeout: 30_000 });
  test("multiple RESULT_OF edges are identity_conflict on replay", async () => {
    const data = fixture([
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success" },
      { kind: "boundary", boundary_type: "validation" },
    ]);
    data.events[2]!.tool_call_event_uid = data.events[1]!.event_uid;
    await seedAndProcess(data);
    const source = await windows(data);
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: source.map((window) => String(window.window_uid)) as [string, string], closure: { kind: "work_validated" as const, checkpoint_event_uid: data.events[0]!.event_uid, validation_result_event_uid: data.events[2]!.event_uid, validation_event_uid: data.events[3]!.event_uid } };
    const initial = await store.materializeEpisode(input);
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (result:RawEvent {event_uid: $result_uid})-[:RESULT_OF]->(call:RawEvent {event_uid: $call_uid}) CREATE (result)-[:RESULT_OF]->(call)", { result_uid: data.events[2]!.event_uid, call_uid: data.events[1]!.event_uid }); });
    const replay = await store.materializeEpisode(input);
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("reverse RESULT_OF edge is identity_conflict on replay", async () => {
    const data = fixture([
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success" },
      { kind: "boundary", boundary_type: "validation" },
    ]);
    data.events[2]!.tool_call_event_uid = data.events[1]!.event_uid;
    await seedAndProcess(data);
    const source = await windows(data);
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: source.map((window) => String(window.window_uid)) as [string, string], closure: { kind: "work_validated" as const, checkpoint_event_uid: data.events[0]!.event_uid, validation_result_event_uid: data.events[2]!.event_uid, validation_event_uid: data.events[3]!.event_uid } };
    const initial = await store.materializeEpisode(input);
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (result:RawEvent {event_uid: $result_uid})-[:RESULT_OF]->(call:RawEvent {event_uid: $call_uid}) CREATE (call)-[:RESULT_OF]->(result)", { result_uid: data.events[2]!.event_uid, call_uid: data.events[1]!.event_uid }); });
    const replay = await store.materializeEpisode(input);
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });
  test("wrong work evidence kind/outcome is evidence_invalid and rolls back", async () => {
    const data = fixture([
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "error" },
      { kind: "boundary", boundary_type: "validation" },
    ]);
    data.events[2]!.tool_call_event_uid = data.events[1]!.event_uid;
    await seedAndProcess(data);
    const source = await windows(data);
    const outcome = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "work",
      window_uids: source.map((window) => String(window.window_uid)) as [string, string],
      closure: {
        kind: "work_validated",
        checkpoint_event_uid: data.events[0]!.event_uid,
        validation_result_event_uid: data.events[2]!.event_uid,
        validation_event_uid: data.events[3]!.event_uid,
      },
    });
    expect(outcome).toMatchObject({ status: "failed", code: "evidence_invalid" });
    expect(await episodeGraph(episodeUid(data.project_uid, String(source[0]!.window_uid)))).toMatchObject({ node: null });
  }, { timeout: 30_000 });
  test("missing HAS_EPISODE replay relationship is identity_conflict and rolls back", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "none" as const } };
    const initial = await store.materializeEpisode(input);
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (p:Project {project_uid: $project_uid})-[r:HAS_EPISODE]->(:Episode {episode_uid: $episode_uid}) DELETE r", { project_uid: data.project_uid, episode_uid: episodeUid(data.project_uid, String(first.window_uid)) }); });
    const replay = await store.materializeEpisode(input);
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("mutated IN_EPISODE relationship properties are identity_conflict", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "none" as const } };
    const initial = await store.materializeEpisode(input);
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (:BoundaryWindow {window_uid: $window_uid})-[r:IN_EPISODE]->(:Episode) SET r.schema_id = 'forged'", { window_uid: first.window_uid }); });
    const replay = await store.materializeEpisode(input);
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("terminal structural label corruption is source_incomplete", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    await writeGraph(async (tx) => { await tx.run("MATCH (e:BoundarySignal {event_uid: $event_uid}) REMOVE e:BoundarySignal", { event_uid: first.terminal_event_uid }); });
    const outcome = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(outcome).toMatchObject({ status: "failed", code: "source_incomplete" });
  }, { timeout: 30_000 });

  test("duplicate incoming Window assignment is identity_conflict with no Episode write", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    await writeGraph(async (tx) => {
      await tx.run(
        "MATCH (e:RawEvent {event_uid: $event_uid}), (w:BoundaryWindow {window_uid: $window_uid}) CREATE (e)-[:IN_BOUNDARY_WINDOW {projector_version: $projector_version}]->(w)",
        { event_uid: data.events[0]!.event_uid, window_uid: first.window_uid, projector_version: "anima.boundary-projector/v1" },
      );
    });
    const outcome = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(outcome).toMatchObject({ status: "failed", code: "identity_conflict" });
    expect((await episodeGraph(episodeUid(data.project_uid, String(first.window_uid))).then((graph) => graph.node))).toBeNull();
  }, { timeout: 30_000 });

  test("missing requested Window rolls back without creating an Episode", async () => {
    const project_uid = randomUUID();
    const missing = boundaryWindowUid(project_uid, randomUUID(), 0);
    const outcome = await store.materializeEpisode({ project_uid, episode_kind: "work", window_uids: [missing], closure: { kind: "none" } });
    expect(outcome).toEqual({ status: "failed", code: "not_found", message: "Requested Episode source was not found." });
    const count = await readGraph(async (tx) => integer((await tx.run("MATCH (e:Episode {project_uid: $project_uid}) RETURN count(e) AS count", { project_uid })).records[0]?.get("count") ?? 0));
    expect(count).toBe(0);
  }, { timeout: 30_000 });

  test("out-of-range Window assignment is identity_conflict and rolls back", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const extra = randomUUID();
    await writeGraph(async (tx) => {
      await tx.run(
        "MATCH (w:BoundaryWindow {window_uid: $window_uid}) CREATE (e:RawEvent:Message {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid, ingest_sequence: 99, kind: 'message'}) CREATE (e)-[:IN_BOUNDARY_WINDOW {projector_version: $projector_version}]->(w)",
        { window_uid: first.window_uid, event_uid: extra, project_uid: data.project_uid, session_uid: data.session_uid, projector_version: "anima.boundary-projector/v1" },
      );
    });
    const outcome = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(outcome).toMatchObject({ status: "failed", code: "identity_conflict" });
    expect((await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)))).node).toBeNull();
  }, { timeout: 30_000 });

  test("reverse HAS_EPISODE incident edge is rejected on replay", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "none" as const } };
    const initial = await store.materializeEpisode(input);
    expect(initial).toMatchObject({ status: "materialized" });
    const uid = episodeUid(data.project_uid, String(first.window_uid));
    await writeGraph(async (tx) => {
      await tx.run("MATCH (e:Episode {episode_uid: $episode_uid}), (p:Project {project_uid: $project_uid}) CREATE (e)-[:HAS_EPISODE]->(p)", { episode_uid: uid, project_uid: data.project_uid });
    });
    const replay = await store.materializeEpisode(input);
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("reverse IN_EPISODE incident edge is rejected on replay", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const uid = episodeUid(data.project_uid, String(first.window_uid));
    const initial = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (e:Episode {episode_uid: $episode_uid}), (w:BoundaryWindow {window_uid: $window_uid}) CREATE (e)-[:IN_EPISODE]->(w)", { episode_uid: uid, window_uid: first.window_uid }); });
    const replay = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("reverse EVIDENCED_BY incident edge is rejected on replay", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const uid = episodeUid(data.project_uid, String(first.window_uid));
    const initial = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "personal", window_uids: [String(first.window_uid)], closure: { kind: "personal_explicit", checkpoint_event_uid: data.events[1]!.event_uid } });
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (e:Episode {episode_uid: $episode_uid}), (r:RawEvent {event_uid: $event_uid}) CREATE (r)-[:EVIDENCED_BY]->(e)", { episode_uid: uid, event_uid: data.events[0]!.event_uid }); });
    const replay = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "personal", window_uids: [String(first.window_uid)], closure: { kind: "personal_explicit", checkpoint_event_uid: data.events[1]!.event_uid } });
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("evidence_invalid takes precedence over malformed existing Episode identity", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const uid = episodeUid(data.project_uid, String(first.window_uid));
    const initial = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => { await tx.run("MATCH (e:Episode {episode_uid: $episode_uid}) SET e.schema_id = 'forged'", { episode_uid: uid }); });
    const replay = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "personal", window_uids: [String(first.window_uid)], closure: { kind: "personal_explicit", checkpoint_event_uid: data.events[0]!.event_uid } });
    expect(replay).toMatchObject({ status: "failed", code: "evidence_invalid" });
  }, { timeout: 30_000 });

  test("forged historical decision UID is rejected on exact replay", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "none" as const } };
    const initial = await store.materializeEpisode(input);
    expect(initial).toMatchObject({ status: "materialized" });
    await writeGraph(async (tx) => {
      await tx.run("MATCH (w:BoundaryWindow {window_uid: $window_uid})-[r:IN_EPISODE]->(:Episode) SET r.decision_uid = $decision_uid", { window_uid: first.window_uid, decision_uid: randomUUID() });
    });
    const replay = await store.materializeEpisode(input);
    expect(replay).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("reverse selected-Session continuation edge is rejected", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "checkpoint" }]);
    await seedAndProcess(data);
    const continued = await seedAdditionalSession(data.project_uid, randomUUID(), [
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "message" },
      { kind: "boundary", boundary_type: "compact" },
    ]);
    await expect(store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: continued.session_uid,
      previous_session_uid: data.session_uid,
      checkpoint_event_uid: continued.events[0]!.event_uid,
    })).resolves.toMatchObject({ status: "written" });
    await writeGraph(async (tx) => {
      await tx.run(
        "MATCH (previous:Session {session_uid: $previous_session_uid}), (current:Session {session_uid: $current_session_uid}) CREATE (previous)-[:CONTINUES_FROM {decision_uid: $decision_uid, schema_id: 'anima.session-continuation/v1.0', method: 'explicit_checkpoint', evidence_event_uid: $evidence_event_uid, project_uid: $project_uid}]->(current)",
        { previous_session_uid: data.session_uid, current_session_uid: continued.session_uid, decision_uid: sessionContinuationDecisionUid(data.project_uid, data.session_uid, continued.session_uid, data.events[1]!.event_uid), evidence_event_uid: data.events[1]!.event_uid, project_uid: data.project_uid },
      );
    });
    const firstWindows = await windows(data);
    const continuedWindows = await windows(continued);
    const outcome = await store.materializeEpisode({
      project_uid: data.project_uid,
      episode_kind: "work",
      window_uids: [String((firstWindows[0] as Record<string, unknown>).window_uid), ...continuedWindows.map((window) => String(window.window_uid))] as [string, string, string],
      closure: { kind: "none" },
    });
    expect(outcome).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("malformed stored Window identity is identity_conflict", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    await writeGraph(async (tx) => { await tx.run("MATCH (w:BoundaryWindow {window_uid: $window_uid}) SET w.project_uid = $project_uid", { window_uid: first.window_uid, project_uid: data.project_uid.toUpperCase() }); });
    const outcome = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(outcome).toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("missing selected Event topology is source_incomplete", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    await writeGraph(async (tx) => { await tx.run("MATCH (s:Session {session_uid: $session_uid})-[r:HAS_EVENT]->(e:RawEvent {event_uid: $event_uid}) DELETE r", { session_uid: data.session_uid, event_uid: data.events[0]!.event_uid }); });
    const outcome = await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    expect(outcome).toMatchObject({ status: "failed", code: "source_incomplete" });
  }, { timeout: 30_000 });

  test("source graph is unchanged by materialization", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const snapshot = async () => readGraph(async (tx) => {
      const nodes = await tx.run("MATCH (n) WHERE (n:Project OR n:Session OR n:RawEvent OR n:BoundaryWindow OR n:MemoryCursor) AND (n.project_uid = $project_uid OR n.session_uid = $session_uid) RETURN labels(n) AS labels, properties(n) AS properties ORDER BY labels(n), properties(n).event_uid", data);
      const relations = await tx.run(
        "MATCH (a)-[r]->(b) WHERE (a:Project OR a:Session OR a:RawEvent OR a:BoundaryWindow OR a:MemoryCursor) AND (b:Project OR b:Session OR b:RawEvent OR b:BoundaryWindow OR b:MemoryCursor) AND ((a.project_uid = $project_uid OR a.session_uid = $session_uid) OR (b.project_uid = $project_uid OR b.session_uid = $session_uid)) RETURN type(r) AS type, properties(r) AS properties, labels(a) AS from_labels, labels(b) AS to_labels ORDER BY type(r), from_labels, to_labels",
        data,
      );
      return {
        nodes: nodes.records.map((record) => ({ labels: record.get("labels"), properties: record.get("properties") })),
        relations: relations.records.map((record) => ({ type: record.get("type"), properties: record.get("properties"), from_labels: record.get("from_labels"), to_labels: record.get("to_labels") })),
      };
    });
    const before = await snapshot();
    const source = await windows(data);
    await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String((source[0] as Record<string, unknown>).window_uid)], closure: { kind: "none" } });
    const after = await snapshot();
    expect(after).toEqual(before);
  }, { timeout: 30_000 });

  test("identical concurrent creates converge to one materialized and one duplicate", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "none" as const } };
    concurrencyBarrier.arm();
    const outcomes = await Promise.all([store.materializeEpisode(input), store.materializeEpisode(input)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["duplicate", "materialized"]);
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.windowEdges).toHaveLength(1);
  }, { timeout: 30_000 });
  test("identical concurrent updates converge to one materialized and one duplicate", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const initial = await windows(data);
    const first = initial[0] as Record<string, unknown>;
    await store.materializeEpisode({ project_uid: data.project_uid, episode_kind: "work", window_uids: [String(first.window_uid)], closure: { kind: "none" } });
    await appendAndProcess(data, [{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    const all = await windows(data);
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: all.map((window) => String(window.window_uid)) as [string, string], closure: { kind: "none" as const } };
    concurrencyBarrier.arm();
    const outcomes = await Promise.all([store.materializeEpisode(input), store.materializeEpisode(input)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["duplicate", "materialized"]);
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.node).toMatchObject({ revision: 1, window_count: 2 });
    expect(graph.windowEdges).toHaveLength(2);
  }, { timeout: 30_000 });
  test("concurrent different Episode decisions converge without two revisions", async () => {
    const data = fixture([
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "tool_call" },
      { kind: "tool_result", outcome: "success" },
      { kind: "boundary", boundary_type: "validation" },
    ]);
    data.events[2]!.tool_call_event_uid = data.events[1]!.event_uid;
    await seedAndProcess(data);
    const all = await windows(data);
    const first = all[0] as Record<string, unknown>;
    const workInput = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: all.map((window) => String(window.window_uid)) as [string, string], closure: { kind: "none" as const } };
    const validatedInput = {
      project_uid: data.project_uid,
      episode_kind: "work" as const,
      window_uids: all.map((window) => String(window.window_uid)) as [string, string],
      closure: {
        kind: "work_validated" as const,
        checkpoint_event_uid: data.events[0]!.event_uid,
        validation_result_event_uid: data.events[2]!.event_uid,
        validation_event_uid: data.events[3]!.event_uid,
      },
    };
    concurrencyBarrier.arm();
    const outcomes = await Promise.all([store.materializeEpisode(workInput), store.materializeEpisode(validatedInput)]);
    expect(outcomes.filter((outcome) => outcome.status === "materialized")).toHaveLength(1);
    expect(outcomes.some((outcome) => outcome.status === "failed" && (outcome.code === "identity_conflict" || outcome.code === "invalid_transition"))).toBe(true);
    const graph = await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)));
    expect(graph.node).toMatchObject({ revision: 0, window_count: 2 });
    expect(graph.windowEdges).toHaveLength(2);
  }, { timeout: 30_000 });
  test("concurrent different Episode identities share one overlapping non-first Window", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const continued = await seedAdditionalSession(data.project_uid, randomUUID(), [
      { kind: "boundary", boundary_type: "checkpoint" },
      { kind: "message" },
      { kind: "boundary", boundary_type: "compact" },
      { kind: "message" },
      { kind: "boundary", boundary_type: "compact" },
    ]);
    await expect(store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: continued.session_uid,
      previous_session_uid: data.session_uid,
      checkpoint_event_uid: continued.events[0]!.event_uid,
    })).resolves.toMatchObject({ status: "written" });
    const firstWindows = await windows(data);
    const continuedWindows = await windows(continued);
    const first = firstWindows[0] as Record<string, unknown>;
    const shared = continuedWindows[1] as Record<string, unknown>;
    const left = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid), ...continuedWindows.map((window) => String(window.window_uid))] as [string, string, string], closure: { kind: "none" as const } };
    const right = { project_uid: data.project_uid, episode_kind: "personal" as const, window_uids: continuedWindows.map((window) => String(window.window_uid)) as [string, string], closure: { kind: "none" as const } };
    concurrencyBarrier.arm();
    const outcomes = await Promise.all([store.materializeEpisode(left), store.materializeEpisode(right)]);
    expect(outcomes.filter((outcome) => outcome.status === "materialized")).toHaveLength(1);
    expect(outcomes.some((outcome) => outcome.status === "failed" && outcome.code === "identity_conflict")).toBe(true);
    const assignmentCount = await readGraph(async (tx) => integer((await tx.run("MATCH (w:BoundaryWindow {window_uid: $window_uid})-[r:IN_EPISODE]->(:Episode) RETURN count(r) AS count", { window_uid: shared.window_uid })).records[0]?.get("count") ?? 0));
    expect(assignmentCount).toBe(1);
  }, { timeout: 30_000 });
  test("source drift between locked validation and final verification rolls back", async () => {
    const data = fixture([{ kind: "message" }, { kind: "boundary", boundary_type: "compact" }]);
    await seedAndProcess(data);
    const source = await windows(data);
    const first = source[0] as Record<string, unknown>;
    const input = { project_uid: data.project_uid, episode_kind: "work" as const, window_uids: [String(first.window_uid)] as [string], closure: { kind: "none" as const } };
    concurrencyBarrier.arm(async () => {
      await writeGraph(async (tx) => {
        await tx.run("MATCH (e:RawEvent {event_uid: $event_uid}) SET e.project_uid = $project_uid", { event_uid: data.events[0]!.event_uid, project_uid: data.project_uid.toUpperCase() });
      });
    });
    const outcomes = await Promise.all([store.materializeEpisode(input), store.materializeEpisode(input)]);
    expect(outcomes.every((outcome) => outcome.status === "failed" && outcome.code === "identity_conflict")).toBe(true);
    expect((await episodeGraph(episodeUid(data.project_uid, String(first.window_uid)))).node).toBeNull();
  }, { timeout: 30_000 });
});
