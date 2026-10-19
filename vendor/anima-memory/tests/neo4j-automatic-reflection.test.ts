import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import neo4j from "neo4j-driver";
import { canonicalize } from "json-canonicalize";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { syntheticConfigPath } from "./dev-config.ts";
import { automaticReflectionScheduleCursorUid } from "../src/automatic-reflection-ids.ts";
import { buildAutomaticReflectionInput } from "../src/reflection-input-projector.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";
import { automaticReflectionSelector, parseInstant, selectorDueAt } from "../src/reflection-calendar.ts";
import type { AutomaticReflectionInput, ReflectionModelInput } from "../src/reflection-input-types.ts";
import { ReflectionModelContractError, type ReflectionModelAdapter } from "../src/reflection-model-types.ts";
import type { ProjectOwnershipScope } from "../src/project-ownership.ts";
import { validateReflectionOutput } from "../src/reflection-projector.ts";
interface FixtureEvent {
  event_uid: string;
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  kind: "message" | "tool_call" | "tool_result" | "turn_end";
  ingest_sequence: number;
  [key: string]: unknown;
}

interface Fixture {
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  identity_fingerprint: string;
  projectOwnership: ProjectOwnershipScope;
  events: FixtureEvent[];
}

let config: Neo4jConfig | undefined;
let database: string | undefined;
let driver: neo4j.Driver | undefined;

function event(fixture: Fixture, kind: FixtureEvent["kind"], extra: Record<string, unknown> = {}): FixtureEvent {
  const event_uid = randomUUID();
  return {
    event_uid,
    fixture_run_id: fixture.fixture_run_id,
    project_uid: fixture.project_uid,
    session_uid: fixture.session_uid,
    kind,
    ingest_sequence: fixture.events.length,
    schema_id: "anima.raw-event/v1.0",
    event_identity_method: "source",
    session_identity_method: "source",
    project_identity_method: "derived",
    runtime_identity_json: "{}",
    capture_capabilities_json: "{}",
    source_json: JSON.stringify({ event_name: kind, event_id: event_uid }),
    captured_at: "2026-09-20T03:00:00.000Z",
    content_parts_json: JSON.stringify(kind === "message" ? [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "task evidence" }] : []),
    fidelity_json: JSON.stringify({ completeness: "full", missing_fields: [] }),
    native_payload_json: "{}",
    fingerprint: event_uid.replaceAll("-", "").padStart(64, "0").slice(0, 64),
    ...extra,
  };
}
function newOwnershipScope(): ProjectOwnershipScope {
  const principal_uid = randomUUID();
  let directory_id = randomUUID();
  while (directory_id === principal_uid) directory_id = randomUUID();
  const users_root = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/neo4j-automatic-reflection-tests/users");
  return {
    users_root,
    directory_id,
    directory: resolve(users_root, directory_id),
    principal_uid,
  };
}

function identityFingerprint(): string {
  const compact = randomUUID().replaceAll("-", "");
  return compact + compact;
}

async function createScopeData(scope: ProjectOwnershipScope): Promise<void> {
  await mkdir(resolve(scope.directory, "data"), { recursive: true });
}

async function registerProject(scope: ProjectOwnershipScope, project_uid: string, identity_fingerprint: string): Promise<void> {
  const projectsDirectory = resolve(scope.directory, "data", "projects");
  await mkdir(projectsDirectory, { recursive: true });
  const record = {
    identity_fingerprint,
    principal_uid: scope.principal_uid,
    project_uid,
    schema_id: "anima.dev-project-ownership/v1",
  };
  await writeFile(resolve(projectsDirectory, `${project_uid}.json`), JSON.stringify(record), { flag: "wx" });
}

function fixture(projectOwnership = newOwnershipScope()): Fixture {
  const value: Fixture = {
    fixture_run_id: randomUUID(),
    project_uid: randomUUID(),
    session_uid: randomUUID(),
    identity_fingerprint: identityFingerprint(),
    projectOwnership,
    events: [],
  };
  const push = (kind: FixtureEvent["kind"], extra: Record<string, unknown> = {}): void => {
    value.events.push(event(value, kind, extra));
  };
  push("message", { role: "user", message_origin: "external_user" });
  const call = event(value, "tool_call", { tool_name: "lookup" });
  value.events.push(call);
  push("tool_result", { outcome: "success", correlation_json: JSON.stringify({ method: "source", source_tool_call_id: call.event_uid }) });
  push("message", { role: "assistant" });
  push("turn_end", { turn_index: 0, turn_end_status: "final_reply" });
  return value;
}
function appendFixtureTurn(value: Fixture, turn_index: number, text?: string): void {
  value.events.push(event(value, "message", {
    role: "user",
    message_origin: "external_user",
    turn_index,
    ...(text === undefined ? {} : {
      content_parts_json: JSON.stringify([{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text }]),
    }),
  }));
  const call = event(value, "tool_call", { tool_name: "lookup", turn_index });
  value.events.push(call);
  value.events.push(event(value, "tool_result", {
    outcome: "success",
    turn_index,
    correlation_json: JSON.stringify({ method: "source", source_tool_call_id: call.event_uid }),
  }));
  value.events.push(event(value, "message", { role: "assistant", turn_index }));
  value.events.push(event(value, "turn_end", { turn_index, turn_end_status: "final_reply" }));
}

async function seedAdditionalFixtureEvents(value: Fixture): Promise<void> {
  await withSession((session) => session.executeWrite(async (tx) => {
    for (const item of value.events.slice(5)) {
      const label = item.kind === "message" ? "Message" : item.kind === "tool_call" ? "ToolCall" : item.kind === "tool_result" ? "ToolResult" : "TurnEnd";
      await tx.run(`CREATE (e:RawEvent:${label}) SET e = $properties`, { properties: item });
      await tx.run(
        "MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)",
        { ...value, event_uid: item.event_uid },
      );
      if (item.kind === "tool_result") {
        const correlation = JSON.parse(String(item.correlation_json)) as { source_tool_call_id: string };
        await tx.run(
          "MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)",
          { event_uid: item.event_uid, target_uid: correlation.source_tool_call_id },
        );
      }
    }
    await tx.run("MATCH (s:Session {session_uid: $session_uid}) SET s.next_ingest_sequence = $next", {
      session_uid: value.session_uid,
      next: value.events.length,
    });
  }));
}
async function singletonBatchBudget(value: Fixture, store: Neo4jMemoryStore): Promise<number> {
  const candidates = await withSession((session) => session.executeRead((tx) => tx.run(
    "MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) RETURN c.candidate_uid AS candidate_uid ORDER BY c.candidate_uid",
    value,
  )));
  const selector = automaticReflectionSelector(value.project_uid, "daily", "2026-09-20");
  let maxBytes = 0;
  for (const record of candidates.records) {
    const candidate_uid = record.get("candidate_uid");
    if (typeof candidate_uid !== "string") throw new Error("fixture candidate UID is malformed");
    const result = await store.getTaskDigest({ candidate_uid });
    if (result.status === "failed") throw new Error(result.message);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(canonicalize(buildAutomaticReflectionInput(selector, [result.digest])), "utf8"));
  }
  return maxBytes;
}

async function withSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  if (config === undefined || database === undefined) throw new Error("automatic reflection fixture is not initialized");
  driver ??= neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  const session = driver.session({ database });
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

async function seedGraph(value: Fixture): Promise<void> {
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run("CREATE (p:Project) SET p = $properties", {
      properties: {
        project_uid: value.project_uid,
        identity_fingerprint: value.identity_fingerprint,
        fixture_run_id: value.fixture_run_id,
      },
    });
    await tx.run("CREATE (s:Session) SET s = $properties", { properties: { session_uid: value.session_uid, project_uid: value.project_uid, next_ingest_sequence: value.events.length, fixture_run_id: value.fixture_run_id } });
    await tx.run("MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)", value);
    for (const item of value.events) {
      const label = item.kind === "message" ? "Message" : item.kind === "tool_call" ? "ToolCall" : item.kind === "tool_result" ? "ToolResult" : "TurnEnd";
      await tx.run(`CREATE (e:RawEvent:${label}) SET e = $properties`, { properties: item });
      await tx.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)", { ...value, event_uid: item.event_uid });
      if (item.kind === "tool_result") {
        const correlation = JSON.parse(String(item.correlation_json)) as { source_tool_call_id: string };
        await tx.run("MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)", { event_uid: item.event_uid, target_uid: correlation.source_tool_call_id });
      }
    }
  }));
}
async function seed(value: Fixture): Promise<void> {
  await registerProject(value.projectOwnership, value.project_uid, value.identity_fingerprint);
  await seedGraph(value);
}
async function prepare(value: Fixture, adapter: ReflectionModelAdapter): Promise<Neo4jMemoryStore> {
  await seed(value);
  const store = new Neo4jMemoryStore({
    configPath: syntheticConfigPath(),
    reflectionModelAdapter: adapter,
    projectOwnership: value.projectOwnership,
  });
  if ((await store.initialize()).status !== "connected") throw new Error("automatic reflection store failed to initialize");
  if ((await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid })).status !== "materialized") throw new Error("execution fixture failed");
  if ((await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid })).status !== "materialized") throw new Error("candidate fixture failed");
  return store;
}

async function cleanup(value: Fixture, store: Neo4jMemoryStore): Promise<void> {
  await store.close();
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
    await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
    await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
    await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
    await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
  }));
}
async function cleanupFixtureRun(fixture_run_id: string): Promise<void> {
  await withSession((session) => session.executeWrite((tx) => tx.run(
    "MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n",
    { fixture_run_id },
  )));
}

async function createCursorFixture(
  scope: ProjectOwnershipScope,
  project_uid: string,
  identity_fingerprint: string,
  fixture_run_id: string,
  periods: { next_daily_period: string; next_weekly_period: string; next_monthly_period: string },
): Promise<string> {
  await registerProject(scope, project_uid, identity_fingerprint);
  const cursor_uid = automaticReflectionScheduleCursorUid(project_uid);
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run("CREATE (p:Project) SET p = $properties", {
      properties: { project_uid, identity_fingerprint, fixture_run_id },
    });
    await tx.run("CREATE (c:ReflectionScheduleCursor) SET c = $properties", {
      properties: {
        cursor_uid,
        project_uid,
        schedule_version: "v1",
        timezone: "Asia/Shanghai",
        ...periods,
      },
    });
    await tx.run(
      "MATCH (p:Project {project_uid: $project_uid}), (c:ReflectionScheduleCursor {cursor_uid: $cursor_uid}) CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(c)",
      { project_uid, cursor_uid },
    );
  }));
  return cursor_uid;
}

async function cursorProperties(project_uid: string): Promise<Record<string, unknown> | null> {
  const result = await withSession((session) => session.executeRead(async (tx) => tx.run(
    "MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) RETURN properties(c) AS properties",
    { project_uid },
  )));
  return result.records.length === 0 ? null : result.records[0]!.get("properties") as Record<string, unknown>;
}
async function reflectionCount(project_uid: string): Promise<number> {
  const result = await withSession((session) => session.executeRead(async (tx) => tx.run(
    "MATCH (r:Reflection {project_uid: $project_uid}) RETURN count(r) AS count",
    { project_uid },
  )));
  const count = result.records[0]?.get("count");
  return neo4j.isInt(count) ? count.toNumber() : Number(count ?? 0);
}

async function reflectionFingerprints(project_uid: string): Promise<string[]> {
  const result = await withSession((session) => session.executeRead((tx) => tx.run(
    "MATCH (r:Reflection {project_uid: $project_uid}) RETURN r.input_fingerprint AS fingerprint ORDER BY fingerprint",
    { project_uid },
  )));
  return result.records.map((record) => String(record.get("fingerprint")));
}

class FakeAdapter implements ReflectionModelAdapter {
  readonly model_ref = "test/automatic-reflection";
  readonly inputs: AutomaticReflectionInput[] = [];
  async reflect(input: ReflectionModelInput): Promise<unknown> {
    if (input.reflection_kind === "manual") throw new Error("unexpected manual input");
    this.inputs.push(input);
    const evidence = { candidate_uid: input.task_digests[0]!.candidate_uid, event_uid: input.task_digests[0]!.events[0]!.event_uid };
    return {
      overview: { text: "Observed work", evidence: [evidence] },
      observations: [],
      open_questions: [],
    };
  }
}
class HeldAdapter extends FakeAdapter {
  private started!: () => void;
  private resume!: () => void;
  private readonly held = new Promise<void>((resolve) => { this.resume = resolve; });
  readonly modelStarted = new Promise<void>((resolve) => { this.started = resolve; });

  override async reflect(input: ReflectionModelInput): Promise<unknown> {
    this.started();
    await this.held;
    return super.reflect(input);
  }

  release(): void {
    this.resume();
  }
}
class ProjectLaneAdapter extends FakeAdapter {
  readonly startedProjects: string[] = [];
  private readonly gates = new Map<string, { promise: Promise<void>; release: () => void }>();
  private startedCount = 0;
  private readonly startedWaiters: { count: number; resolve: () => void }[] = [];
  private active = 0;
  peak = 0;
  private readonly perProjectActive = new Map<string, number>();
  peakPerProject = 0;
  private readonly projectWaiters = new Map<string, (() => void)[]>();

  constructor(projectUids: readonly string[]) {
    super();
    for (const uid of projectUids) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      this.gates.set(uid, { promise, release });
    }
  }

  override async reflect(input: ReflectionModelInput): Promise<unknown> {
    if (input.reflection_kind === "manual") throw new Error("unexpected manual input");
    const project_uid = input.selector.project_uid;
    const gate = this.gates.get(project_uid);
    if (gate === undefined) throw new Error("unexpected project in lane adapter");
    this.startedProjects.push(project_uid);
    this.startedCount += 1;
    for (const resolve of this.projectWaiters.get(project_uid) ?? []) resolve();
    this.projectWaiters.delete(project_uid);
    for (const waiter of this.startedWaiters.splice(0)) {
      if (this.startedCount >= waiter.count) waiter.resolve();
      else this.startedWaiters.push(waiter);
    }
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    const activeForProject = (this.perProjectActive.get(project_uid) ?? 0) + 1;
    this.perProjectActive.set(project_uid, activeForProject);
    this.peakPerProject = Math.max(this.peakPerProject, activeForProject);
    try {
      await gate.promise;
      return await super.reflect(input);
    } finally {
      this.active -= 1;
      this.perProjectActive.set(project_uid, this.perProjectActive.get(project_uid)! - 1);
    }
  }

  waitForStarted(count: number): Promise<void> {
    if (this.startedCount >= count) return Promise.resolve();
    return new Promise<void>((resolve) => { this.startedWaiters.push({ count, resolve }); });
  }
  waitForProject(project_uid: string): Promise<void> {
    if (this.startedProjects.includes(project_uid)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.projectWaiters.get(project_uid) ?? [];
      waiters.push(resolve);
      this.projectWaiters.set(project_uid, waiters);
    });
  }

  release(project_uid: string): void {
    this.gates.get(project_uid)?.release();
  }

  releaseAll(): void {
    for (const gate of this.gates.values()) gate.release();
  }
}
class RoutingAdapter extends FakeAdapter {
  constructor(private readonly failures: ReadonlySet<string>) {
    super();
  }

  override async reflect(input: ReflectionModelInput): Promise<unknown> {
    if (input.reflection_kind !== "manual" && this.failures.has(input.selector.project_uid)) {
      throw new Error("planned model failure");
    }
    return super.reflect(input);
  }
}
class ContractRoutingAdapter extends FakeAdapter {
  constructor(private readonly failingProjectUid: string) {
    super();
  }

  override async reflect(input: ReflectionModelInput): Promise<unknown> {
    if (input.reflection_kind !== "manual" && input.selector.project_uid === this.failingProjectUid) {
      throw new ReflectionModelContractError("input_too_large", "Automatic reflection model wire input exceeds max_input_bytes");
    }
    return super.reflect(input);
  }
}
class MutatingAdapter extends FakeAdapter {
  constructor(private readonly event_uid: string) {
    super();
  }

  override async reflect(input: ReflectionModelInput): Promise<unknown> {
    await withSession((session) => session.executeWrite((tx) => tx.run(
      "MATCH (e:RawEvent {event_uid: $event_uid}) SET e.captured_at = $captured_at",
      { event_uid: this.event_uid, captured_at: "2026-09-22T03:00:00.000Z" },
    )));
    return super.reflect(input);
  }
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error(`automatic reflection fixture requires config: ${loaded.kind}`);
  config = loaded.config;
  database = config.database;
});

afterAll(async () => {
  if (driver !== undefined) await driver.close();
});

describe("Neo4j automatic reflections", () => {
  test("initializes the persistent cursor, materializes a due slot, and reruns idempotently", async () => {
    const value = fixture();
    const adapter = new FakeAdapter();
    await seed(value);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: value.projectOwnership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      expect((await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      expect((await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      const first = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.attempts.some((attempt) => attempt.status === "materialized" || attempt.status === "up_to_date")).toBe(true);
      const second = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      expect(second.status).toBe("completed");
      expect(adapter.inputs.length).toBeGreaterThan(0);
      const graph = await withSession((session) => session.executeRead(async (tx) => tx.run(
        `MATCH (p:Project {project_uid: $project_uid})-[link:HAS_REFLECTION_SCHEDULE]->(c:ReflectionScheduleCursor)
         OPTIONAL MATCH (r:Reflection {project_uid: $project_uid})
         RETURN properties(link) AS link, properties(c) AS cursor, count(r) AS reflections`,
        { project_uid: value.project_uid },
      )));
      const record = graph.records[0]!;
      expect(record.get("link")).toEqual({});
      expect(record.get("cursor")).toMatchObject({ project_uid: value.project_uid, schedule_version: "v1", timezone: "Asia/Shanghai" });
      expect(Number(record.get("reflections"))).toBeGreaterThan(0);
    } finally {
      await store.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
        await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
        await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
        await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
        await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
      }));
    }
  }, 15000);
  test("blocks automatic execution, candidate, and initial cursor writes until the project fingerprint is authorized", async () => {
    const value = fixture();
    await seed(value);
    let marker: string | undefined;
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: new FakeAdapter(),
      projectOwnership: value.projectOwnership,
      authorizeAutomaticBeforeWrite: async (project_uid) => project_uid === value.project_uid ? marker : undefined,
    });
    const graphCounts = async () => withSession((session) => session.executeRead((tx) => tx.run(
      `MATCH (p:Project {project_uid: $project_uid})
       OPTIONAL MATCH (u:ExecutionUnit {project_uid: $project_uid})
       OPTIONAL MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid})
       OPTIONAL MATCH (cursor:ReflectionScheduleCursor {project_uid: $project_uid})
       RETURN count(DISTINCT u) AS units, count(DISTINCT c) AS candidates, count(DISTINCT cursor) AS cursors`,
      { project_uid: value.project_uid },
    )));
    try {
      expect((await store.initialize()).status).toBe("connected");
      const blocked = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (blocked.status === "failed") throw new Error(blocked.message);
      expect(blocked.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "identity_conflict")).toBe(true);
      const beforeAuthorization = await graphCounts();
      expect(Number(beforeAuthorization.records[0]?.get("units"))).toBe(0);
      expect(Number(beforeAuthorization.records[0]?.get("candidates"))).toBe(0);
      expect(Number(beforeAuthorization.records[0]?.get("cursors"))).toBe(0);

      marker = value.identity_fingerprint;
      const allowed = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (allowed.status === "failed") throw new Error(allowed.message);
      expect(allowed.attempts.some((attempt) => attempt.status === "materialized" || attempt.status === "up_to_date")).toBe(true);
      const afterAuthorization = await graphCounts();
      expect(Number(afterAuthorization.records[0]?.get("units"))).toBeGreaterThan(0);
      expect(Number(afterAuthorization.records[0]?.get("candidates"))).toBeGreaterThan(0);
      expect(Number(afterAuthorization.records[0]?.get("cursors"))).toBe(1);
      expect(await reflectionCount(value.project_uid)).toBeGreaterThan(0);
    } finally {
      await cleanup(value, store);
    }
  }, 15000);
  test("accepts strict instants across the normalized UTC range with an empty registered set", async () => {
    const projectOwnership = newOwnershipScope();
    await createScopeData(projectOwnership);
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), projectOwnership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const now of ["0001-06-01T00:00:00+00:00", "9999-06-01T00:00:00+00:00"]) {
        const result = await store.runDueAutomaticReflections({ now, max_input_bytes: 65536 });
        expect(result).toEqual({ status: "completed", now, attempts: [], has_more: false });
      }
    } finally {
      await store.close();
    }
  });
  test("ignores graph-only malformed and unlisted Projects", async () => {
    const fixture_run_id = randomUUID();
    const unlistedProject = randomUUID();
    const ownership = newOwnershipScope();
    await createScopeData(ownership);
    await withSession((session) => session.executeWrite(async (tx) => {
      for (const properties of [
        { fixture_run_id },
        { project_uid: "MALFORMED-PROJECT-ID", fixture_run_id },
        { project_uid: 42, fixture_run_id },
        { project_uid: unlistedProject, identity_fingerprint: identityFingerprint(), fixture_run_id },
      ]) {
        await tx.run(
          "CREATE (p:Project) SET p = $properties CREATE (target:MalformedScheduleTarget {fixture_run_id: $fixture_run_id}) CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(target)",
          { properties, fixture_run_id },
        );
      }
    }));
    const adapter = new FakeAdapter();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: adapter, projectOwnership: ownership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      expect(result).toMatchObject({ status: "completed", attempts: [], has_more: false });
      expect(adapter.inputs).toHaveLength(0);
      const cursorCount = await withSession((session) => session.executeRead((tx) => tx.run(
        "MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) RETURN count(c) AS count",
        { project_uid: unlistedProject },
      )));
      const count = cursorCount.records[0]?.get("count");
      expect(neo4j.isInt(count) ? count.toNumber() : Number(count ?? 0)).toBe(0);
    } finally {
      await store.close();
      await cleanupFixtureRun(fixture_run_id);
    }
  });
  test("fails closed for missing or malformed ownership scopes before graph work", async () => {
    const missingProject = randomUUID();
    const malformedProject = randomUUID();
    const missingFingerprint = identityFingerprint();
    const malformedFingerprint = identityFingerprint();
    const missingScope = newOwnershipScope();
    const malformedScope = newOwnershipScope();
    await registerProject(malformedScope, malformedProject, malformedFingerprint);
    await writeFile(
      resolve(malformedScope.directory, "data", "projects", `${malformedProject}.json`),
      "{",
      { flag: "w" },
    );
    const fixture_run_id = randomUUID();
    await withSession((session) => session.executeWrite(async (tx) => {
      await tx.run("CREATE (p:Project) SET p = $properties", {
        properties: { project_uid: missingProject, identity_fingerprint: missingFingerprint, fixture_run_id },
      });
      await tx.run("CREATE (p:Project) SET p = $properties", {
        properties: { project_uid: malformedProject, identity_fingerprint: malformedFingerprint, fixture_run_id },
      });
    }));
    const adapter = new FakeAdapter();
    try {
      for (const [projectOwnership, project_uid] of [[missingScope, missingProject], [malformedScope, malformedProject]] as const) {
        const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: adapter, projectOwnership });
        try {
          expect((await store.initialize()).status).toBe("connected");
          await expect(store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 })).resolves.toMatchObject({
            status: "failed",
            code: "identity_conflict",
          });
          expect(adapter.inputs).toHaveLength(0);
          expect(await cursorProperties(project_uid)).toBeNull();
        } finally {
          await store.close();
        }
      }
    } finally {
      await cleanupFixtureRun(fixture_run_id);
    }
  });
  test("skips a truly absent pending project while completing active projects", async () => {
    const active = fixture();
    const pending_uid = randomUUID();
    const pending_fingerprint = identityFingerprint();
    await registerProject(active.projectOwnership, pending_uid, pending_fingerprint);
    const markerPath = resolve(active.projectOwnership.directory, "data", "projects", `${pending_uid}.json`);
    const marker = await readFile(markerPath, "utf8");
    const adapter = new FakeAdapter();
    const store = await prepare(active, adapter);
    try {
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.status).toBe("completed");
      expect(result.attempts.some((attempt) => attempt.project_uid === active.project_uid && (attempt.status === "materialized" || attempt.status === "up_to_date"))).toBe(true);
      expect(result.attempts.some((attempt) => attempt.project_uid === pending_uid)).toBe(false);
      expect(await reflectionCount(active.project_uid)).toBeGreaterThan(0);
      expect(await cursorProperties(active.project_uid)).not.toBeNull();
      expect((await cursorProperties(active.project_uid))?.next_daily_period).not.toBe("2026-09-22");
      expect(await cursorProperties(pending_uid)).toBeNull();
      expect(await reflectionCount(pending_uid)).toBe(0);
      expect(await readFile(markerPath, "utf8")).toBe(marker);
    } finally {
      await cleanup(active, store);
    }
  }, 15000);
  test("reconciles an absent pending project after its fixture graph appears", async () => {
    const value = fixture();
    const markerPath = resolve(value.projectOwnership.directory, "data", "projects", `${value.project_uid}.json`);
    await createScopeData(value.projectOwnership);
    await registerProject(value.projectOwnership, value.project_uid, value.identity_fingerprint);
    const marker = await readFile(markerPath, "utf8");
    const adapter = new FakeAdapter();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: adapter, projectOwnership: value.projectOwnership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const first = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      expect(first).toEqual({ status: "completed", now: "2026-09-22T00:00:00+08:00", attempts: [], has_more: false });
      expect(await cursorProperties(value.project_uid)).toBeNull();
      await seedGraph(value);
      const second = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (second.status === "failed") throw new Error(second.message);
      expect(second.attempts.some((attempt) => attempt.project_uid === value.project_uid && (attempt.status === "materialized" || attempt.status === "up_to_date"))).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBeGreaterThan(0);
      expect(await cursorProperties(value.project_uid)).not.toBeNull();
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-22");
      expect(adapter.inputs.length).toBeGreaterThan(0);
      expect(await readFile(markerPath, "utf8")).toBe(marker);
    } finally {
      await cleanup(value, store);
    }
  }, 15000);
  test("blocks a pending project when a same-UID graph node already exists", async () => {
    const project_uid = randomUUID();
    const identity_fingerprint = identityFingerprint();
    const fixture_run_id = randomUUID();
    const projectOwnership = newOwnershipScope();
    await createScopeData(projectOwnership);
    await registerProject(projectOwnership, project_uid, identity_fingerprint);
    const adapter = new FakeAdapter();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: adapter, projectOwnership });
    try {
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "CREATE (:Session {project_uid: $project_uid, session_uid: $session_uid, fixture_run_id: $fixture_run_id})",
        { project_uid, session_uid: randomUUID(), fixture_run_id },
      )));
      expect((await store.initialize()).status).toBe("connected");
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.status).toBe("partial");
      expect(result.attempts).toContainEqual(expect.objectContaining({ project_uid, status: "blocked", code: "identity_conflict" }));
      expect(await cursorProperties(project_uid)).toBeNull();
      expect(await reflectionCount(project_uid)).toBe(0);
      expect(adapter.inputs).toHaveLength(0);
    } finally {
      await store.close();
      await cleanupFixtureRun(fixture_run_id);
    }
  });
  test("advances empty due periods without invoking the model", async () => {
    const project_uid = randomUUID();
    const identity_fingerprint = identityFingerprint();
    const fixture_run_id = randomUUID();
    const projectOwnership = newOwnershipScope();
    await registerProject(projectOwnership, project_uid, identity_fingerprint);
    const cursor_uid = automaticReflectionScheduleCursorUid(project_uid);
    await withSession((session) => session.executeWrite(async (tx) => {
      await tx.run("CREATE (p:Project) SET p = $properties", {
        properties: { project_uid, identity_fingerprint, fixture_run_id },
      });
      await tx.run("CREATE (c:ReflectionScheduleCursor) SET c = $properties", {
        properties: {
          cursor_uid,
          project_uid,
          schedule_version: "v1",
          timezone: "Asia/Shanghai",
          next_daily_period: "2026-09-20",
          next_weekly_period: "2026-09-14",
          next_monthly_period: "2026-09",
        },
      });
      await tx.run("MATCH (p:Project {project_uid: $project_uid}), (c:ReflectionScheduleCursor {cursor_uid: $cursor_uid}) CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(c)", { project_uid, cursor_uid });
    }));
    const adapter = new FakeAdapter();
    let authorized = false;
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership,
      authorizeAutomaticBeforeWrite: async (candidateProjectUid) =>
        candidateProjectUid === project_uid && authorized ? identity_fingerprint : undefined,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const rejected = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (rejected.status === "failed") throw new Error(rejected.message);
      expect((await cursorProperties(project_uid))?.next_daily_period).toBe("2026-09-20");
      authorized = true;
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.filter((attempt) => attempt.status === "empty_scope").length).toBeGreaterThan(0);
      expect((await cursorProperties(project_uid))?.next_daily_period).not.toBe("2026-09-20");
      expect(adapter.inputs).toHaveLength(0);
    } finally {
      await store.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        await tx.run("MATCH (c:ReflectionScheduleCursor {cursor_uid: $cursor_uid}) DETACH DELETE c", { cursor_uid });
        await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", { fixture_run_id });
      }));
    }
  });
  test("rejects malformed linked and orphan cursor topology without replacement", async () => {
    const fixture_run_id = randomUUID();
    const projects = {
      wrong_label: randomUUID(),
      property_mismatch: randomUUID(),
      orphan: randomUUID(),
      multi_owner: randomUUID(),
      duplicate_link: randomUUID(),
      eligible_candidate: randomUUID(),
    };
    const fingerprints = new Map<string, string>(Object.values(projects).map((project_uid) => [project_uid, identityFingerprint()] as const));
    const projectOwnership = newOwnershipScope();
    for (const [project_uid, identity_fingerprint] of fingerprints) {
      await registerProject(projectOwnership, project_uid, identity_fingerprint);
    }
    const projectProperties = (project_uid: string) => ({
      project_uid,
      identity_fingerprint: fingerprints.get(project_uid)!,
      fixture_run_id,
    });
    const cursorProperties = (project_uid: string) => ({
      cursor_uid: automaticReflectionScheduleCursorUid(project_uid),
      project_uid,
      schedule_version: "v1",
      timezone: "Asia/Shanghai",
      next_daily_period: "2026-09-20",
      next_weekly_period: "2026-09-14",
      next_monthly_period: "2026-09",
    });
    await withSession((session) => session.executeWrite(async (tx) => {
      await tx.run(
        "CREATE (p:Project) SET p = $project CREATE (target:WrongScheduleTarget) SET target = $target CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(target)",
        { project: projectProperties(projects.wrong_label), target: cursorProperties(projects.wrong_label) },
      );
      await tx.run(
        "CREATE (p:Project) SET p = $project CREATE (target:ReflectionScheduleCursor) SET target = $target CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(target)",
        {
          project: projectProperties(projects.property_mismatch),
          target: { ...cursorProperties(projects.property_mismatch), project_uid: randomUUID() },
        },
      );
      await tx.run(
        "CREATE (p:Project) SET p = $project CREATE (c:ReflectionScheduleCursor) SET c = $cursor",
        { project: projectProperties(projects.orphan), cursor: cursorProperties(projects.orphan) },
      );
      await tx.run(
        "CREATE (p:Project) SET p = $project CREATE (c:ReflectionScheduleCursor) SET c = $cursor CREATE (owner:OtherOwner {fixture_run_id: $fixture_run_id}) CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(c) CREATE (owner)-[:HAS_REFLECTION_SCHEDULE]->(c)",
        { project: projectProperties(projects.multi_owner), cursor: cursorProperties(projects.multi_owner), fixture_run_id },
      );
      await tx.run(
        "CREATE (p:Project) SET p = $project CREATE (c:ReflectionScheduleCursor) SET c = $cursor CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(c) CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(c)",
        { project: projectProperties(projects.duplicate_link), cursor: cursorProperties(projects.duplicate_link) },
      );
      await tx.run(
        "CREATE (p:Project) SET p = $project CREATE (target:WrongScheduleTarget) SET target = $target CREATE (candidate:ExecutionReviewCandidate) SET candidate = $candidate CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(target)",
        {
          project: projectProperties(projects.eligible_candidate),
          target: { ...cursorProperties(projects.eligible_candidate), fixture_run_id },
          candidate: { candidate_uid: randomUUID(), project_uid: projects.eligible_candidate, state: "pending", fixture_run_id },
        },
      );
    }));
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), projectOwnership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      for (const project_uid of Object.values(projects)) {
        expect(result.attempts.some((attempt) => attempt.project_uid === project_uid && attempt.status === "blocked" && attempt.code === "identity_conflict")).toBe(true);
      }
      const cursorCount = await withSession((session) => session.executeRead((tx) => tx.run(
        "MATCH (c:ReflectionScheduleCursor) WHERE c.cursor_uid IN $cursor_uids RETURN count(c) AS count",
        {
          cursor_uids: [projects.property_mismatch, projects.orphan, projects.multi_owner, projects.duplicate_link].map((project_uid) => automaticReflectionScheduleCursorUid(project_uid)),
        },
      )));
      const count = cursorCount.records[0]?.get("count");
      expect(neo4j.isInt(count) ? count.toNumber() : Number(count ?? 0)).toBe(4);
    } finally {
      await store.close();
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (c:ReflectionScheduleCursor) WHERE c.cursor_uid IN $cursor_uids DETACH DELETE c",
        {
          cursor_uids: [projects.property_mismatch, projects.orphan, projects.multi_owner, projects.duplicate_link].map((project_uid) => automaticReflectionScheduleCursorUid(project_uid)),
        },
      )));
      await cleanupFixtureRun(fixture_run_id);
    }
  });
  test("emits registered project attempts in calendar order", async () => {
    const ownership = newOwnershipScope();
    const firstFixture = fixture(ownership);
    const secondFixture = fixture(ownership);
    const adapter = new FakeAdapter();
    await seed(firstFixture);
    await seed(secondFixture);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: ownership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const value of [firstFixture, secondFixture]) {
        await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
        await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      }
      const result = await store.runDueAutomaticReflections({ now: "2026-10-02T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      const fixtureProjectUids = new Set([firstFixture.project_uid, secondFixture.project_uid]);
      const projectUids = new Set(result.attempts.map((attempt) => attempt.project_uid));
      expect(projectUids.has(firstFixture.project_uid)).toBe(true);
      expect(projectUids.has(secondFixture.project_uid)).toBe(true);
      const fixtureAttempts = result.attempts.filter((attempt) => attempt.project_uid !== null && fixtureProjectUids.has(attempt.project_uid));
      const firstProjectAttempts = fixtureAttempts.filter((attempt) => attempt.project_uid === firstFixture.project_uid && "kind" in attempt);
      const due = firstProjectAttempts.flatMap((attempt) => {
        if (!("kind" in attempt)) return [];
        return [selectorDueAt(automaticReflectionSelector(firstFixture.project_uid, attempt.kind, attempt.period_key))];
      });
      expect(due.every((value, index) => index === 0 || parseInstant(value) >= parseInstant(due[index - 1]!))).toBe(true);
    } finally {
      await store.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        for (const value of [firstFixture, secondFixture]) {
          await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
          await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
          await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
        }
      }));
    }
  });
  test("keeps each automatic run inside its project ownership scope", async () => {
    const firstFixture = fixture();
    const secondFixture = fixture();
    const adapterA = new FakeAdapter();
    const adapterB = new FakeAdapter();
    await seed(firstFixture);
    await seed(secondFixture);
    for (const value of [firstFixture, secondFixture]) {
      const setupStore = new Neo4jMemoryStore({
        configPath: syntheticConfigPath(),
        reflectionModelAdapter: new FakeAdapter(),
        projectOwnership: value.projectOwnership,
      });
      try {
        expect((await setupStore.initialize()).status).toBe("connected");
        await setupStore.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
        await setupStore.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      } finally {
        await setupStore.close();
      }
    }
    const storeA = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapterA,
      projectOwnership: firstFixture.projectOwnership,
    });
    const storeB = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapterB,
      projectOwnership: secondFixture.projectOwnership,
    });
    try {
      expect((await storeA.initialize()).status).toBe("connected");
      const resultA = await storeA.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (resultA.status === "failed") throw new Error(resultA.message);
      expect(resultA.attempts.length).toBeGreaterThan(0);
      expect(resultA.attempts.every((attempt) => attempt.project_uid === firstFixture.project_uid)).toBe(true);
      expect(adapterA.inputs.length).toBeGreaterThan(0);
      expect(adapterA.inputs.every((input) => input.selector.project_uid === firstFixture.project_uid)).toBe(true);
      expect(await cursorProperties(secondFixture.project_uid)).toBeNull();

      expect((await storeB.initialize()).status).toBe("connected");
      const resultB = await storeB.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (resultB.status === "failed") throw new Error(resultB.message);
      expect(resultB.attempts.length).toBeGreaterThan(0);
      expect(resultB.attempts.every((attempt) => attempt.project_uid === secondFixture.project_uid)).toBe(true);
      expect(adapterB.inputs.length).toBeGreaterThan(0);
      expect(adapterB.inputs.every((input) => input.selector.project_uid === secondFixture.project_uid)).toBe(true);
      expect((await cursorProperties(secondFixture.project_uid))?.next_daily_period).not.toBe("2026-09-20");
    } finally {
      await cleanup(firstFixture, storeA);
      await cleanup(secondFixture, storeB);
    }
  });
  test("retains the cursor when the canonical input exceeds the limit", async () => {
    const value = fixture();
    const adapter = new FakeAdapter();
    const store = await prepare(value, adapter);
    try {
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 1 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "input_too_large")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(0);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
    } finally {
      await cleanup(value, store);
    }
  });
  test("rechecks authorization after the model response and leaves Reflection and cursor unchanged on revocation", async () => {
    const value = fixture();
    const adapter = new HeldAdapter();
    const rejectedFingerprint = identityFingerprint();
    let marker: string | undefined = value.identity_fingerprint;
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: value.projectOwnership,
      authorizeAutomaticBeforeWrite: async (project_uid) => project_uid === value.project_uid ? marker : undefined,
    });
    await seed(value);
    try {
      expect((await store.initialize()).status).toBe("connected");
      expect((await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      expect((await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      const running = store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      await adapter.modelStarted;
      marker = undefined;
      adapter.release();
      const rejected = await running;
      if (rejected.status === "failed") throw new Error(rejected.message);
      expect(rejected.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "identity_conflict")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(0);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");

      marker = rejectedFingerprint;
      const mismatched = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (mismatched.status === "failed") throw new Error(mismatched.message);
      expect(mismatched.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "identity_conflict")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(0);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");

      marker = value.identity_fingerprint;
      const accepted = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (accepted.status === "failed") throw new Error(accepted.message);
      expect(accepted.attempts.some((attempt) => attempt.status === "materialized" || attempt.status === "up_to_date")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBeGreaterThan(0);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
    } finally {
      await cleanup(value, store);
    }
  });
  test("blocks one project on model failure while another registered project continues", async () => {
    const ownership = newOwnershipScope();
    const failed = fixture(ownership);
    const healthy = fixture(ownership);
    const adapter = new RoutingAdapter(new Set([failed.project_uid]));
    await seed(failed);
    await seed(healthy);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: ownership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const value of [failed, healthy]) {
        await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
        await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      }
      const result = await store.runDueAutomaticReflections({
        now: "2026-09-22T00:00:00+08:00",
        max_input_bytes: 65536,
        max_concurrent_projects: 2,
      });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.status).toBe("partial");
      expect(result.attempts.some((attempt) => attempt.project_uid === failed.project_uid && attempt.status === "failed" && attempt.code === "model_failed")).toBe(true);
      expect(result.attempts.some((attempt) => attempt.project_uid === healthy.project_uid && (attempt.status === "materialized" || attempt.status === "up_to_date"))).toBe(true);
      expect((await cursorProperties(failed.project_uid))?.next_daily_period).toBe("2026-09-20");
      expect((await cursorProperties(healthy.project_uid))?.next_daily_period).not.toBe("2026-09-20");
    } finally {
      await cleanup(failed, store);
      await withSession((session) => session.executeWrite(async (tx) => {
        await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", healthy);
        await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", healthy);
        await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", healthy);
        await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", healthy);
        await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", healthy);
      }));
    }
  });
  test("runs a deterministic bounded roster across projects while preserving per-project serial work", async () => {
    const ownership = newOwnershipScope();
    const fixtures = [fixture(ownership), fixture(ownership), fixture(ownership)];
    const projectUids = fixtures.map((value) => value.project_uid).sort();
    for (const value of fixtures) await seed(value);
    const adapter = new ProjectLaneAdapter(projectUids);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: ownership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const value of fixtures) {
        expect((await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
        expect((await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      }
      const running = store.runDueAutomaticReflections({
        now: "2026-09-22T00:00:00+08:00",
        max_input_bytes: 65536,
        max_work_items_per_project: 1,
        max_concurrent_projects: 2,
      });
      await adapter.waitForStarted(2);
      expect(new Set(adapter.startedProjects.slice(0, 2))).toEqual(new Set(projectUids.slice(0, 2)));
      expect(adapter.peak).toBe(2);
      expect(adapter.startedProjects).toHaveLength(2);
      adapter.release(adapter.startedProjects[0]!);
      await adapter.waitForProject(projectUids[2]!);
      expect(adapter.startedProjects).toContain(projectUids[2]);
      adapter.releaseAll();
      const result = await running;
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.map((attempt) => attempt.project_uid)).toEqual([...result.attempts.map((attempt) => attempt.project_uid)].sort());
      expect(new Set(result.attempts.map((attempt) => attempt.project_uid))).toEqual(new Set(projectUids));
      expect(adapter.peak).toBe(2);
      expect(adapter.peakPerProject).toBe(1);
      for (const value of fixtures) {
        expect(await reflectionCount(value.project_uid)).toBe(1);
        expect(await cursorProperties(value.project_uid)).toMatchObject({ next_daily_period: "2026-09-21" });
      }
    } finally {
      adapter.releaseAll();
      await store.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        for (const value of fixtures) {
          await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
          await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
          await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
        }
      }));
    }
  }, 30000);
  test("serializes overlapping scans on one store without repeating already committed batches", async () => {
    const ownership = newOwnershipScope();
    const fixtures = [fixture(ownership), fixture(ownership), fixture(ownership)];
    const projectUids = fixtures.map((value) => value.project_uid).sort();
    for (const value of fixtures) await seed(value);
    const adapter = new ProjectLaneAdapter(projectUids);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: ownership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const value of fixtures) {
        await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
        await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      }
      const input = { now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536, max_work_items_per_project: 1, max_concurrent_projects: 2 };
      const first = store.runDueAutomaticReflections(input);
      await adapter.waitForStarted(2);
      const second = store.runDueAutomaticReflections(input);
      expect(adapter.startedProjects).toHaveLength(2);
      adapter.releaseAll();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult.status).toBe("completed");
      expect(secondResult.status).toBe("completed");
      expect(adapter.peak).toBe(2);
      expect(adapter.peakPerProject).toBe(1);
      expect([...adapter.startedProjects].sort()).toEqual(projectUids);
      for (const value of fixtures) {
        expect(await reflectionCount(value.project_uid)).toBe(1);
        expect(await cursorProperties(value.project_uid)).toMatchObject({ next_daily_period: "2026-09-21" });
      }
    } finally {
      adapter.releaseAll();
      await store.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        for (const value of fixtures) {
          await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
          await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
          await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
        }
      }));
    }
  }, 30000);
  test("close prevents a lane from claiming an unstarted project", async () => {
    const ownership = newOwnershipScope();
    const fixtures = [fixture(ownership), fixture(ownership), fixture(ownership)];
    const projectUids = fixtures.map((value) => value.project_uid).sort();
    for (const value of fixtures) await seed(value);
    const adapter = new ProjectLaneAdapter(projectUids);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: ownership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const value of fixtures) {
        await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
        await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      }
      const running = store.runDueAutomaticReflections({
        now: "2026-09-22T00:00:00+08:00",
        max_input_bytes: 65536,
        max_concurrent_projects: 2,
      });
      await adapter.waitForStarted(2);
      const closing = store.close();
      adapter.releaseAll();
      const result = await running;
      expect(result).toMatchObject({ status: "failed", code: "core_closed" });
      await closing;
      expect(adapter.startedProjects).not.toContain(projectUids[2]);
    } finally {
      adapter.releaseAll();
      await store.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        for (const value of fixtures) {
          await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
          await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
          await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
          await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
        }
      }));
    }
  }, 30000);
  test("blocks a contract-failed project while another registered project continues", async () => {
    const ownership = newOwnershipScope();
    const failed = fixture(ownership);
    const healthy = fixture(ownership);
    const adapter = new ContractRoutingAdapter(failed.project_uid);
    await seed(failed);
    await seed(healthy);
    const store = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: adapter,
      projectOwnership: ownership,
    });
    try {
      expect((await store.initialize()).status).toBe("connected");
      for (const value of [failed, healthy]) {
        await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
        await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      }
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.status).toBe("partial");
      expect(result.attempts.some((attempt) => attempt.project_uid === failed.project_uid && attempt.status === "blocked" && attempt.code === "input_too_large" && attempt.message === "Automatic reflection model wire input exceeds max_input_bytes")).toBe(true);
      expect(result.attempts.some((attempt) => attempt.project_uid === healthy.project_uid && (attempt.status === "materialized" || attempt.status === "up_to_date"))).toBe(true);
      expect((await cursorProperties(failed.project_uid))?.next_daily_period).toBe("2026-09-20");
      expect((await cursorProperties(healthy.project_uid))?.next_daily_period).not.toBe("2026-09-20");
    } finally {
      await cleanup(failed, store);
      await withSession((session) => session.executeWrite(async (tx) => {
        await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", healthy);
        await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", healthy);
        await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", healthy);
        await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", healthy);
        await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", healthy);
      }));
    }
  }, 60000);
  test("does not create a cursor when initialization sees an invalid terminal timestamp", async () => {
    const value = fixture();
    const adapter = new FakeAdapter();
    const store = await prepare(value, adapter);
    try {
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (e:RawEvent {event_uid: $event_uid}) SET e.captured_at = $captured_at",
        { event_uid: value.events.at(-1)!.event_uid, captured_at: "not-an-instant" },
      )));
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "invalid_timestamp" && !("kind" in attempt))).toBe(true);
      expect(await cursorProperties(value.project_uid)).toBeNull();
    } finally {
      await cleanup(value, store);
    }
  });
  test("resumes persisted catch-up after a new store instance", async () => {
    const value = fixture();
    const firstAdapter = new FakeAdapter();
    const firstStore = await prepare(value, firstAdapter);
    try {
      const first = await firstStore.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (first.status === "failed") throw new Error(first.message);
    } finally {
      await firstStore.close();
    }
    const secondAdapter = new FakeAdapter();
    const secondStore = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: secondAdapter,
      projectOwnership: value.projectOwnership,
    });
    try {
      expect((await secondStore.initialize()).status).toBe("connected");
      const resumed = await secondStore.runDueAutomaticReflections({ now: "2026-09-23T00:00:00+08:00", max_input_bytes: 65536 });
      if (resumed.status === "failed") throw new Error(resumed.message);
      expect(resumed.attempts.length).toBeGreaterThan(0);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
    } finally {
      await cleanup(value, secondStore);
    }
  });
  test("does not rewind an advanced cursor for a late historical backfill", async () => {
    const value = fixture();
    const adapter = new FakeAdapter();
    const store = await prepare(value, adapter);
    try {
      const first = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (first.status === "failed") throw new Error(first.message);
      const before = await cursorProperties(value.project_uid);
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (e:RawEvent {event_uid: $event_uid}) SET e.captured_at = $captured_at",
        { event_uid: value.events.at(-1)!.event_uid, captured_at: "2026-09-19T03:00:00.000Z" },
      )));
      const second = await store.runDueAutomaticReflections({ now: "2026-09-23T00:00:00+08:00", max_input_bytes: 65536 });
      if (second.status === "failed") throw new Error(second.message);
      const after = await cursorProperties(value.project_uid);
      expect(String(after?.next_daily_period ?? "") >= String(before?.next_daily_period ?? "")).toBe(true);
    } finally {
      await cleanup(value, store);
    }
  });
  test("reports identity conflict and leaves the cursor when model-call source changes", async () => {
    const value = fixture();
    const store = await prepare(value, new MutatingAdapter(value.events.at(-1)!.event_uid));
    try {
      const result = await store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "identity_conflict")).toBe(true);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
      expect(await reflectionCount(value.project_uid)).toBe(0);
    } finally {
      await cleanup(value, store);
    }
  });
  test("rejects a terminal whose local period is outside the schedulable calendar", async () => {
    const value = fixture();
    const store = await prepare(value, new FakeAdapter());
    try {
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (e:RawEvent {event_uid: $event_uid}) SET e.captured_at = $captured_at",
        { event_uid: value.events.at(-1)!.event_uid, captured_at: "9999-12-31T00:00:00.000Z" },
      )));
      const result = await store.runDueAutomaticReflections({ now: "9999-12-31T00:00:00+00:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "invalid_timestamp" && !("kind" in attempt))).toBe(true);
      expect(await cursorProperties(value.project_uid)).toBeNull();
    } finally {
      await cleanup(value, store);
    }
  });

  test("rejects invalid per-project work budgets before graph writes", async () => {
    const project_uid = randomUUID();
    const fixture_run_id = randomUUID();
    const projectOwnership = newOwnershipScope();
    await createCursorFixture(projectOwnership, project_uid, identityFingerprint(), fixture_run_id, {
      next_daily_period: "2026-09-20",
      next_weekly_period: "complete",
      next_monthly_period: "complete",
    });
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), projectOwnership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const invalidBudgets: (number | undefined)[] = [undefined, 0, 129, 1.5, Number.NaN];
      for (const budget of invalidBudgets) {
        const result = await store.runDueAutomaticReflections({
          now: "2026-09-21T00:10:00+08:00",
          max_input_bytes: 65536,
          max_work_items_per_project: budget,
        });
        expect(result).toMatchObject({ status: "failed", code: "invalid_input" });
      }
      expect(await cursorProperties(project_uid)).toMatchObject({ next_daily_period: "2026-09-20" });
      expect(await reflectionCount(project_uid)).toBe(0);
      const invalidProjectLimits: unknown[] = [0, 9, 1.5, Number.NaN, undefined, "2"];
      for (const limit of invalidProjectLimits) {
        const result = await store.runDueAutomaticReflections({
          now: "2026-09-21T00:10:00+08:00",
          max_input_bytes: 65536,
          max_concurrent_projects: limit,
        } as never);
        expect(result).toMatchObject({ status: "failed", code: "invalid_input" });
      }
      for (const limit of [1, 8]) {
        const result = await store.runDueAutomaticReflections({
          now: "2026-09-21T00:10:00+08:00",
          max_input_bytes: 65536,
          max_concurrent_projects: limit,
        });
        expect(result.status).not.toBe("failed");
      }
      class InheritedProjectLimit {
        readonly now = "2026-09-21T00:10:00+08:00";
        readonly max_input_bytes = 65536;
        get max_concurrent_projects(): number { throw new Error("An inherited setting must not be read."); }
      }
      expect(await store.runDueAutomaticReflections(new InheritedProjectLimit())).toMatchObject({ status: "completed" });
    } finally {
      await store.close();
      await cleanupFixtureRun(fixture_run_id);
    }
  });

  test("bounds each project catch-up allowance and preserves healthy project progress", async () => {
    const fixture_run_id = randomUUID();
    const projects = [randomUUID(), randomUUID()];
    const fingerprints = new Map(projects.map((project_uid) => [project_uid, identityFingerprint()] as const));
    const projectOwnership = newOwnershipScope();
    for (const project_uid of projects) {
      await createCursorFixture(projectOwnership, project_uid, fingerprints.get(project_uid)!, fixture_run_id, {
        next_daily_period: "2026-05-15",
        next_weekly_period: "complete",
        next_monthly_period: "complete",
      });
    }
    const now = "2026-09-21T00:10:00+08:00";
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), projectOwnership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const first = await store.runDueAutomaticReflections({ now, max_input_bytes: 65536, max_work_items_per_project: 1 });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.status).toBe("completed");
      expect(first.has_more).toBe(true);
      for (const project_uid of projects) {
        const projectAttempts = first.attempts.filter((attempt) => attempt.project_uid === project_uid);
        expect(projectAttempts).toHaveLength(1);
        expect(projectAttempts.every((attempt) => attempt.status === "empty_scope")).toBe(true);
        expect((await cursorProperties(project_uid))?.next_daily_period).toBe("2026-05-16");
      }

      const second = await store.runDueAutomaticReflections({ now, max_input_bytes: 65536, max_work_items_per_project: 1 });
      if (second.status === "failed") throw new Error(second.message);
      expect(second.status).toBe("completed");
      expect(second.has_more).toBe(true);
      for (const project_uid of projects) {
        const projectAttempts = second.attempts.filter((attempt) => attempt.project_uid === project_uid);
        expect(projectAttempts).toHaveLength(1);
        expect(projectAttempts[0]?.status).toBe("empty_scope");
        expect((await cursorProperties(project_uid))?.next_daily_period).toBe("2026-05-17");
      }
    } finally {
      await store.close();
      await cleanupFixtureRun(fixture_run_id);
    }
  });

  test("advances each final cursor period to complete and skips an all-complete cursor", async () => {
    const fixture_run_id = randomUUID();
    const projects = [randomUUID(), randomUUID(), randomUUID()];
    const fingerprints = new Map(projects.map((project_uid) => [project_uid, identityFingerprint()] as const));
    const projectOwnership = newOwnershipScope();
    const complete = "complete";
    await createCursorFixture(projectOwnership, projects[0]!, fingerprints.get(projects[0]!)!, fixture_run_id, {
      next_daily_period: "9998-12-31",
      next_weekly_period: complete,
      next_monthly_period: complete,
    });
    await createCursorFixture(projectOwnership, projects[1]!, fingerprints.get(projects[1]!)!, fixture_run_id, {
      next_daily_period: complete,
      next_weekly_period: "9998-12-28",
      next_monthly_period: complete,
    });
    await createCursorFixture(projectOwnership, projects[2]!, fingerprints.get(projects[2]!)!, fixture_run_id, {
      next_daily_period: complete,
      next_weekly_period: complete,
      next_monthly_period: "9998-12",
    });
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), projectOwnership });
    try {
      expect((await store.initialize()).status).toBe("connected");
      const first = await store.runDueAutomaticReflections({ now: "9999-12-31T00:00:00+00:00", max_input_bytes: 65536 });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.attempts.filter((attempt) => attempt.status === "empty_scope")).toHaveLength(3);
      for (const project_uid of projects) {
        expect(await cursorProperties(project_uid)).toMatchObject({
          next_daily_period: complete,
          next_weekly_period: complete,
          next_monthly_period: complete,
        });
      }
      const second = await store.runDueAutomaticReflections({ now: "9999-12-31T00:00:00+00:00", max_input_bytes: 65536 });
      expect(second).toEqual({ status: "completed", now: "9999-12-31T00:00:00+00:00", attempts: [], has_more: false });
    } finally {
      await store.close();
      await cleanupFixtureRun(fixture_run_id);
    }
  });
  test("splits oversized period input across complete execution units and persists every batch", async () => {
    const value = fixture();
    const adapter = new FakeAdapter();
    const setup = await prepare(value, adapter);
    try {
      for (let index = 1; index < 24; index += 1) appendFixtureTurn(value, index, "x".repeat(3000));
      await seedAdditionalFixtureEvents(value);
      await setup.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
      await setup.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
      const result = await setup.runDueAutomaticReflections({ now: "2026-10-02T00:00:00+08:00", max_input_bytes: 65536 });
      expect(result.status).toBe("completed");
      expect(adapter.inputs.length).toBeGreaterThan(1);
      expect(adapter.inputs.every((input) => Buffer.byteLength(canonicalize(input), "utf8") <= 65536)).toBe(true);
      const candidatesByKind = new Map<string, string[]>();
      for (const input of adapter.inputs) {
        const kind = input.selector.kind;
        const candidateUids = candidatesByKind.get(kind) ?? [];
        candidateUids.push(...input.task_digests.map((digest) => digest.candidate_uid));
        candidatesByKind.set(kind, candidateUids);
      }
      expect(candidatesByKind.size).toBeGreaterThan(1);
      for (const [kind, candidateUids] of candidatesByKind) {
        expect(candidateUids).toHaveLength(24);
        expect(new Set(candidateUids).size).toBe(24);
        const contentBytes = adapter.inputs
          .filter((input) => input.selector.kind === kind)
          .reduce((total, input) => total + input.task_digests.reduce((digestTotal, digest) => digestTotal + Buffer.byteLength(digest.initiator.content ?? "", "utf8"), 0), 0);
        expect(contentBytes).toBeGreaterThan(65536);
      }
      const cursorAfterRun = await cursorProperties(value.project_uid);
      expect(cursorAfterRun?.next_daily_period).not.toBe("2026-09-20");
      expect(cursorAfterRun?.next_weekly_period).not.toBe("2026-09-14");
      expect(cursorAfterRun?.next_monthly_period).not.toBe("2026-09");
      const called = adapter.inputs.length;
      const second = await setup.runDueAutomaticReflections({ now: "2026-10-02T00:00:00+08:00", max_input_bytes: 65536 });
      expect(second.status).toBe("completed");
      expect(adapter.inputs).toHaveLength(called);
    } finally {
      await cleanup(value, setup);
    }
  }, 60000);

  test("resumes large metadata-driven singleton batches after a later model failure", async () => {
    const value = fixture();
    const turn_index = 1;
    const tool_name = "synthetic-evidence-tool-".repeat(4);
    const result_text = "result-0123456789012345678";
    expect(Buffer.byteLength(result_text, "utf8")).toBe(26);
    const selector = automaticReflectionSelector(value.project_uid, "daily", "2026-09-20");
    let largeDigest: AutomaticReflectionInput["task_digests"][number] | undefined;
    let largeInput: AutomaticReflectionInput | undefined;
    value.events.push(event(value, "message", {
      role: "user",
      message_origin: "external_user",
      turn_index,
    }));
    for (let index = 0; index < 350; index += 1) {
      const call = event(value, "tool_call", { tool_name, turn_index });
      value.events.push(call);
      value.events.push(event(value, "tool_result", {
        outcome: "success",
        turn_index,
        correlation_json: JSON.stringify({ method: "source", source_tool_call_id: call.event_uid }),
        content_parts_json: JSON.stringify([{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: result_text }]),
      }));
    }
    value.events.push(event(value, "message", { role: "assistant", turn_index }));
    value.events.push(event(value, "turn_end", { turn_index, turn_end_status: "final_reply" }));
    const setup = await prepare(value, new FakeAdapter());
    try {
      const candidates = await withSession((session) => session.executeRead((tx) => tx.run(
        "MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) RETURN c.candidate_uid AS candidate_uid ORDER BY c.candidate_uid",
        value,
      )));
      const candidateUids = candidates.records.map((record) => {
        const candidate_uid = record.get("candidate_uid");
        if (typeof candidate_uid !== "string") throw new Error("fixture candidate UID is malformed");
        return candidate_uid;
      });
      for (const candidate_uid of candidateUids) {
        const result = await setup.getTaskDigest({ candidate_uid });
        if (result.status === "failed") throw new Error(result.message);
        if (result.digest.events.filter((item) => item.tool_name === tool_name).length === 350) largeDigest = result.digest;
      }
      if (largeDigest === undefined) throw new Error("large fixture execution unit was not projected");
      expect(largeDigest.content_omissions).toEqual([]);
      expect(largeDigest.events.filter((item) => item.kind === "tool_result")).toHaveLength(350);
      const sourceContentBytes = value.events.reduce((total, item) =>
        total + (item.kind === "tool_result" ? Buffer.byteLength(result_text, "utf8") : 0), 0);
      expect(sourceContentBytes).toBeLessThan(65536);
      expect(value.events.every((item) => Buffer.byteLength(String(item.content_parts_json), "utf8") < 4096)).toBe(true);
      largeInput = buildAutomaticReflectionInput(selector, [largeDigest]);
      const singletonBytes = Buffer.byteLength(canonicalize(largeInput), "utf8");
      expect(singletonBytes).toBeGreaterThan(65536);
      expect(singletonBytes).toBeLessThanOrEqual(524288);
    } finally {
      await setup.close();
    }

    const firstAdapter = new FakeAdapter();
    const firstStore = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: firstAdapter,
      projectOwnership: value.projectOwnership,
    });
    try {
      await firstStore.initialize();
      const first = await firstStore.runDueAutomaticReflections({
        now: "2026-09-21T00:10:00+08:00",
        max_input_bytes: 524288,
        max_work_items_per_project: 1,
      });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.has_more).toBe(true);
      expect(firstAdapter.inputs).toHaveLength(1);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
    } finally {
      await firstStore.close();
    }
    const committed = await reflectionFingerprints(value.project_uid);
    class FailNextAdapter extends FakeAdapter {
      override async reflect(_input: ReflectionModelInput): Promise<unknown> {
        throw new ReflectionModelContractError("invalid_reflection", "model evidence is outside the evidence scope");
      }
    }
    const failedAdapter = new FailNextAdapter();
    const failedStore = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: failedAdapter,
      projectOwnership: value.projectOwnership,
    });
    try {
      await failedStore.initialize();
      const failed = await failedStore.runDueAutomaticReflections({
        now: "2026-09-21T00:10:00+08:00",
        max_input_bytes: 524288,
        max_work_items_per_project: 1,
      });
      if (failed.status === "failed") throw new Error(failed.message);
      expect(failed.attempts.some((attempt) => attempt.status === "failed" && attempt.code === "invalid_reflection" && attempt.message === "model evidence is outside the evidence scope")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
    } finally {
      await failedStore.close();
    }
    const resumedAdapter = new FakeAdapter();
    const resumedStore = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: resumedAdapter,
      projectOwnership: value.projectOwnership,
    });
    try {
      await resumedStore.initialize();
      const resumed = await resumedStore.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 524288 });
      if (resumed.status === "failed") throw new Error(resumed.message);
      expect(resumedAdapter.inputs.every((input) => !committed.includes(input.input_fingerprint))).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBeGreaterThan(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
      const expectedLargeInput = largeInput;
      if (expectedLargeInput === undefined) throw new Error("large fixture input was not built");
      expect([...firstAdapter.inputs, ...resumedAdapter.inputs].filter((input) =>
        canonicalize(input) === canonicalize(expectedLargeInput))).toHaveLength(1);
    } finally {
      await cleanup(value, resumedStore);
    }
  }, 120000);

  test("continues beyond a one-item per-project budget without advancing an incomplete period", async () => {
    const value = fixture();
    const setup = await prepare(value, new FakeAdapter());
    for (let index = 1; index < 130; index += 1) appendFixtureTurn(value, index);
    await seedAdditionalFixtureEvents(value);
    await setup.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid });
    await setup.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid });
    const max_input_bytes = await singletonBatchBudget(value, setup);
    await setup.close();
    const adapter = new FakeAdapter();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: adapter, projectOwnership: value.projectOwnership });
    try {
      await store.initialize();
      const first = await store.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes, max_work_items_per_project: 1 });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.has_more).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
      const firstFingerprints = await reflectionFingerprints(value.project_uid);
      expect(adapter.inputs).toHaveLength(1);
      const firstModelCallCount = adapter.inputs.length;
      const second = await store.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes, max_work_items_per_project: 128 });
      if (second.status === "failed") throw new Error(second.message);
      expect(second.has_more).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(129);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
      expect(adapter.inputs.slice(firstModelCallCount).filter((input) => firstFingerprints.includes(input.input_fingerprint))).toHaveLength(0);
      const third = await store.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes, max_work_items_per_project: 128 });
      if (third.status === "failed") throw new Error(third.message);
      expect(third.has_more).toBe(false);
      expect(await reflectionCount(value.project_uid)).toBe(130);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
    } finally {
      await cleanup(value, store);
    }
  }, 600000);
  test("persists canonical automatic evidence without changing any fact group", async () => {
    const value = fixture();
    const adapter = new FakeAdapter();
    const setup = await prepare(value, adapter);
    const expectedTexts = {
      overview: "Canonical overview",
      observations: [{ text: "Canonical observation", evidence: [] as { candidate_uid: string; event_uid: string }[] }],
      open_questions: [{ text: "Canonical open question", evidence: [] as { candidate_uid: string; event_uid: string }[] }],
    };
    class OrderedEvidenceAdapter extends FakeAdapter {
      override async reflect(input: ReflectionModelInput): Promise<unknown> {
        if (input.reflection_kind === "manual") throw new Error("unexpected manual input");
        this.inputs.push(input);
        const digests = input.task_digests;
        if (digests.length !== 2) throw new Error("expected two execution candidates");
        const evidence = digests.flatMap((digest) => [
          { candidate_uid: digest.candidate_uid, event_uid: digest.events[0]!.event_uid },
          { candidate_uid: digest.candidate_uid, event_uid: digest.events.at(-1)!.event_uid },
        ]).reverse();
        return {
          overview: { text: expectedTexts.overview, evidence },
          observations: [{ observation_uid: "o1", kind: "theme", text: expectedTexts.observations[0]!.text, evidence: [...evidence] }],
          open_questions: [{ question_uid: "q1", text: expectedTexts.open_questions[0]!.text, evidence: [...evidence] }],
        };
      }
    }
    const orderedAdapter = new OrderedEvidenceAdapter();
    await setup.close();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: orderedAdapter, projectOwnership: value.projectOwnership });
    try {
      appendFixtureTurn(value, 1);
      await seedAdditionalFixtureEvents(value);
      await store.initialize();
      expect((await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      expect((await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      const now = "2026-09-21T00:10:00+08:00";
      const first = await store.runDueAutomaticReflections({ now, max_input_bytes: 524288, max_work_items_per_project: 1 });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.has_more).toBe(false);
      expect(first.attempts.some((attempt) => attempt.status === "materialized" || attempt.status === "up_to_date")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
      const firstCount = orderedAdapter.inputs.length;
      const second = await store.runDueAutomaticReflections({ now, max_input_bytes: 524288, max_work_items_per_project: 1 });
      if (second.status === "failed") throw new Error(second.message);
      expect(second.has_more).toBe(false);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
      expect(orderedAdapter.inputs.length).toBe(firstCount);

      const persisted = await withSession((session) => session.executeRead((tx) => tx.run(
        `MATCH (r:Reflection {project_uid: $project_uid})
         RETURN r.overview_json AS overview, r.observations_json AS observations,
                r.open_questions_json AS questions, r.input_fingerprint AS fingerprint
         ORDER BY fingerprint`,
        value,
      )));
      expect(persisted.records).toHaveLength(1);
      for (let index = 0; index < persisted.records.length; index += 1) {
        const input = orderedAdapter.inputs[index]!;
        const orderedPairs = input.task_digests.flatMap((digest) => [
          { candidate_uid: digest.candidate_uid, event_uid: digest.events[0]!.event_uid },
          { candidate_uid: digest.candidate_uid, event_uid: digest.events.at(-1)!.event_uid },
        ]);
        const expected = [...orderedPairs].sort((left, right) => {
          const candidateOrder = input.task_digests.findIndex((digest) => digest.candidate_uid === left.candidate_uid)
            - input.task_digests.findIndex((digest) => digest.candidate_uid === right.candidate_uid);
          if (candidateOrder !== 0) return candidateOrder;
          return input.task_digests.find((digest) => digest.candidate_uid === left.candidate_uid)!.events.findIndex((event) => event.event_uid === left.event_uid)
            - input.task_digests.find((digest) => digest.candidate_uid === right.candidate_uid)!.events.findIndex((event) => event.event_uid === right.event_uid);
        });
        const record = persisted.records[index]!;
        const persistedOutput = validateReflectionOutput({
          overview: JSON.parse(String(record.get("overview"))),
          observations: JSON.parse(String(record.get("observations"))),
          open_questions: JSON.parse(String(record.get("questions"))),
        }, input.task_digests.flatMap((digest, candidate_order) => digest.events.map((event) => ({
          candidate_uid: digest.candidate_uid, event_uid: event.event_uid,
          candidate_order, event_position: event.position,
        }))));
        const { overview, observations, open_questions: questions } = persistedOutput;
        expect(overview.text).toBe(expectedTexts.overview);
        expect(overview.evidence).toEqual(expected);
        expect(observations).toEqual([{ observation_uid: "o1", kind: "theme", text: expectedTexts.observations[0]!.text, evidence: expected }]);
        expect(questions).toEqual([{ question_uid: "q1", text: expectedTexts.open_questions[0]!.text, evidence: expected }]);
        const links = await withSession((session) => session.executeRead((tx) => tx.run(
          `MATCH (r:Reflection {input_fingerprint: $fingerprint})-[link:EVIDENCED_BY]->(event:RawEvent)
           RETURN link.subject_path AS subject_path, link.evidence_index AS evidence_index,
                  link.candidate_position AS candidate_position, event.event_uid AS event_uid
           ORDER BY subject_path, evidence_index`,
          { fingerprint: record.get("fingerprint") },
        )));
        const paths = [
          ["overview", overview.evidence],
          ["observations/o1", observations[0]!.evidence],
          ["open_questions/q1", questions[0]!.evidence],
        ] as const;
        expect(links.records).toHaveLength(paths.reduce((count, [, refs]) => count + refs.length, 0));
        for (const [subject_path, refs] of paths) {
          const subjectLinks = links.records.filter((link) => link.get("subject_path") === subject_path);
          expect(subjectLinks).toHaveLength(refs.length);
          refs.forEach((ref, evidence_index) => {
            const link = subjectLinks[evidence_index]!;
            const digest = input.task_digests.find((item) => item.candidate_uid === ref.candidate_uid)!;
            expect(link.get("subject_path")).toBe(subject_path);
            expect(Number(link.get("evidence_index"))).toBe(evidence_index);
            expect(link.get("event_uid")).toBe(ref.event_uid);
            expect(Number(link.get("candidate_position"))).toBe(digest.events.find((event) => event.event_uid === ref.event_uid)!.position);
          });
        }
      }
      const callsAfterSuccess = orderedAdapter.inputs.length;
      const repeat = await store.runDueAutomaticReflections({ now, max_input_bytes: 524288, max_work_items_per_project: 1 });
      expect(repeat.status).toBe("completed");
      expect(orderedAdapter.inputs).toHaveLength(callsAfterSuccess);
    } finally {
      await cleanup(value, store);
    }
  }, 60000);

  test("rejects cross-candidate evidence and retries the same scope with canonical valid evidence", async () => {
    const value = fixture();
    const setup = await prepare(value, new FakeAdapter());
    await setup.close();
    class RetryEvidenceAdapter extends FakeAdapter {
      override async reflect(input: ReflectionModelInput): Promise<unknown> {
        if (input.reflection_kind === "manual") throw new Error("unexpected manual input");
        this.inputs.push(input);
        const digests = input.task_digests;
        if (digests.length !== 2) throw new Error("expected two execution candidates");
        const evidence = digests.flatMap((digest) => [
          { candidate_uid: digest.candidate_uid, event_uid: digest.events[0]!.event_uid },
          { candidate_uid: digest.candidate_uid, event_uid: digest.events[1]!.event_uid },
        ]);
        const reversed = [...evidence].reverse();
        const valid = {
          overview: { text: "Retryable overview", evidence: reversed },
          observations: [{ observation_uid: "o1", kind: "theme", text: "Retryable observation", evidence: [...reversed] }],
          open_questions: [{ question_uid: "q1", text: "Retryable question", evidence: [...reversed] }],
        };
        if (this.inputs.length > 1) return valid;
        return {
          ...valid,
          overview: {
            ...valid.overview,
            evidence: [{ candidate_uid: digests[0]!.candidate_uid, event_uid: digests[1]!.events[1]!.event_uid }],
          },
        };
      }
    }
    const adapter = new RetryEvidenceAdapter();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: adapter, projectOwnership: value.projectOwnership });
    try {
      appendFixtureTurn(value, 1);
      await seedAdditionalFixtureEvents(value);
      await store.initialize();
      expect((await store.materializeExecutionUnits({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      expect((await store.materializeExecutionReviewCandidates({ project_uid: value.project_uid, session_uid: value.session_uid })).status).toBe("materialized");
      const now = "2026-09-21T00:10:00+08:00";
      const first = await store.runDueAutomaticReflections({ now, max_input_bytes: 524288, max_work_items_per_project: 1 });
      if (first.status === "failed") throw new Error(first.message);
      expect(first.attempts.some((attempt) => attempt.status === "failed" && attempt.code === "invalid_reflection")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(0);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
      const retry = await store.runDueAutomaticReflections({ now, max_input_bytes: 524288, max_work_items_per_project: 1 });
      if (retry.status === "failed") throw new Error(retry.message);
      expect(retry.attempts.some((attempt) => attempt.status === "materialized" || attempt.status === "up_to_date")).toBe(true);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).not.toBe("2026-09-20");
      const successfulCalls = adapter.inputs.length;
      expect(successfulCalls).toBe(2);
      const repeat = await store.runDueAutomaticReflections({ now, max_input_bytes: 524288, max_work_items_per_project: 1 });
      expect(repeat.status).toBe("completed");
      expect(adapter.inputs).toHaveLength(successfulCalls);
    } finally {
      await cleanup(value, store);
    }
  }, 60000);

  test("concurrent stores with different held responses commit one batch identity", async () => {
    const value = fixture();
    const setup = await prepare(value, new FakeAdapter());
    await setup.close();
    class DifferentHeldAdapter extends FakeAdapter {
      private entered!: () => void;
      private release!: () => void;
      readonly started = new Promise<void>((resolve) => { this.entered = resolve; });
      private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
      constructor(private readonly text: string) { super(); }
      override async reflect(input: ReflectionModelInput): Promise<unknown> {
        if (input.reflection_kind === "manual") throw new Error("unexpected manual input");
        this.inputs.push(input);
        this.entered();
        await this.gate;
        return {
          overview: { text: this.text, evidence: [{ candidate_uid: input.task_digests[0]!.candidate_uid, event_uid: input.task_digests[0]!.events[0]!.event_uid }] },
          observations: [],
          open_questions: [],
        };
      }
      resume(): void { this.release(); }
    }
    const leftAdapter = new DifferentHeldAdapter("left response");
    const rightAdapter = new DifferentHeldAdapter("right response");
    const leftStore = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: leftAdapter, projectOwnership: value.projectOwnership });
    const rightStore = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: rightAdapter, projectOwnership: value.projectOwnership });
    try {
      await leftStore.initialize();
      await rightStore.initialize();
      const leftRun = leftStore.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536 });
      const rightRun = rightStore.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536 });
      await Promise.all([leftAdapter.started, rightAdapter.started]);
      leftAdapter.resume();
      rightAdapter.resume();
      const [left, right] = await Promise.all([leftRun, rightRun]);
      if (left.status === "failed") throw new Error(left.message);
      if (right.status === "failed") throw new Error(right.message);
      expect(leftAdapter.inputs).toHaveLength(1);
      expect(rightAdapter.inputs).toHaveLength(1);
      expect(await reflectionCount(value.project_uid)).toBe(1);
      expect(await reflectionFingerprints(value.project_uid)).toHaveLength(1);
    } finally {
      leftAdapter.resume();
      rightAdapter.resume();
      await leftStore.close();
      await rightStore.close();
      await cleanup(value, setup);
    }
  }, 30000);

  test("rejects tampered committed batch without replaying the model or advancing cursor", async () => {
    const value = fixture();
    const firstAdapter = new FakeAdapter();
    const firstStore = await prepare(value, firstAdapter);
    await firstStore.close();
    const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reflectionModelAdapter: firstAdapter, projectOwnership: value.projectOwnership });
    try {
      await store.initialize();
      const materialized = await store.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536 });
      if (materialized.status === "failed") throw new Error(materialized.message);
      const daily = await withSession((session) => session.executeRead((tx) => tx.run(
        "MATCH (r:Reflection {project_uid: $project_uid, kind: 'daily'}) RETURN r.input_fingerprint AS fingerprint ORDER BY fingerprint",
        { project_uid: value.project_uid },
      )));
      const dailyFingerprint = String(daily.records[0]?.get("fingerprint"));
      expect(dailyFingerprint).not.toBe("undefined");
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (r:Reflection {project_uid: $project_uid, input_fingerprint: $fingerprint}) SET r.overview_json = $corrupt",
        { project_uid: value.project_uid, fingerprint: dailyFingerprint, corrupt: "{\"text\":\"tampered\",\"evidence\":[]}" },
      )));
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) SET c.next_daily_period = '2026-09-20'",
        value,
      )));
      const beforeCalls = firstAdapter.inputs.length;
      const result = await store.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536 });
      if (result.status === "failed") throw new Error(result.message);
      expect(result.attempts.some((attempt) => attempt.status === "blocked" && attempt.code === "identity_conflict")).toBe(true);
      expect((await cursorProperties(value.project_uid))?.next_daily_period).toBe("2026-09-20");
      expect(firstAdapter.inputs).toHaveLength(beforeCalls);
    } finally {
      await cleanup(value, store);
    }
  }, 30000);
  test("concurrent stores materialize one reflection and one loser reports already_processed", async () => {
    const value = fixture();
    const setupStore = await prepare(value, new FakeAdapter());
    await setupStore.close();
    const storeA = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: new FakeAdapter(),
      projectOwnership: value.projectOwnership,
    });
    const storeB = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      reflectionModelAdapter: new FakeAdapter(),
      projectOwnership: value.projectOwnership,
    });
    try {
      expect((await storeA.initialize()).status).toBe("connected");
      expect((await storeB.initialize()).status).toBe("connected");
      const [left, right] = await Promise.all([
        storeA.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536 }),
        storeB.runDueAutomaticReflections({ now: "2026-09-21T00:10:00+08:00", max_input_bytes: 65536 }),
      ]);
      if (left.status === "failed") throw new Error(left.message);
      if (right.status === "failed") throw new Error(right.message);
      const attempts = [...left.attempts, ...right.attempts];
      expect(attempts.some((attempt) => attempt.status === "already_processed")).toBe(true);
      const count = await withSession((session) => session.executeRead(async (tx) => tx.run(
        "MATCH (r:Reflection {project_uid: $project_uid}) WHERE r.kind = 'daily' RETURN count(r) AS count",
        { project_uid: value.project_uid },
      )));
      const reflections = count.records[0]?.get("count");
      expect(neo4j.isInt(reflections) ? reflections.toNumber() : Number(reflections ?? 0)).toBe(1);
    } finally {
      await storeA.close();
      await storeB.close();
      await withSession((session) => session.executeWrite(async (tx) => {
        await tx.run("MATCH (r:Reflection {project_uid: $project_uid}) DETACH DELETE r", value);
        await tx.run("MATCH (c:ReflectionScheduleCursor {project_uid: $project_uid}) DETACH DELETE c", value);
        await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid}) DETACH DELETE c", value);
        await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid}) DETACH DELETE u", value);
        await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", value);
      }));
    }
  });
});
