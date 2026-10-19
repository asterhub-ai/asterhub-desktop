import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import neo4j from "neo4j-driver";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { recycleSyntheticScope, syntheticConfigPath } from "./dev-config.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";
import type { ManualCandidateReflectionInput, ReflectionModelInput } from "../src/reflection-input-types.ts";
import type { ReflectionModelAdapter } from "../src/reflection-model-types.ts";
import type { ReflectManualCandidateInput, ReflectManualCandidateResult } from "../src/types.ts";
import { registerProjectOwnership, type ProjectOwnershipScope } from "../src/project-ownership.ts";

type FixtureEvent = Record<string, unknown> & {
  event_uid: string;
  kind: "message" | "tool_call" | "tool_result" | "turn_end";
  ingest_sequence: number;
};

type Fixture = {
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  scope: ProjectOwnershipScope;
  events: FixtureEvent[];
};

type Prepared = {
  fixture: Fixture;
  candidate_uid: string;
  event_uids: string[];
  store: Neo4jMemoryStore;
};

function fixtureParams(fixture: Fixture): { fixture_run_id: string; project_uid: string; session_uid: string } {
  return { fixture_run_id: fixture.fixture_run_id, project_uid: fixture.project_uid, session_uid: fixture.session_uid };
}
let config: Neo4jConfig | undefined;
let database: string | undefined;
let driver: neo4j.Driver | undefined;
const fixtureDirectories = new Set<string>();
type ReflectionCloseRace = {
  armed: boolean;
  store?: Neo4jMemoryStore;
};

function raceDriverFactory(race: ReflectionCloseRace): (config: Neo4jConfig) => neo4j.Driver {
  return (loadedConfig) => {
    const realDriver = neo4j.driver(loadedConfig.uri, neo4j.auth.basic(loadedConfig.username, loadedConfig.password));
    return new Proxy(realDriver, {
      get(target, property, receiver) {
        if (property === "session") {
          return (options?: neo4j.SessionConfig) => {
            const realSession = target.session(options);
            return new Proxy(realSession, {
              get(sessionTarget, sessionProperty, sessionReceiver) {
                if (sessionProperty === "executeWrite") {
                  return async (work: (transaction: unknown) => Promise<unknown>) => {
                    const result = await sessionTarget.executeWrite(work);
                    if (race.armed) {
                      race.armed = false;
                      if (race.store === undefined) throw new Error("Reflection close race store is not assigned.");
                      await race.store.close();
                    }
                    return result;
                  };
                }
                const value = Reflect.get(sessionTarget, sessionProperty, sessionTarget);
                return typeof value === "function" ? value.bind(sessionTarget) : value;
              },
            }) as neo4j.Session;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
}


function numberValue(value: unknown): number {
  return neo4j.isInt(value) ? value.toNumber() : Number(value);
}

async function withSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  if (config === undefined || database === undefined) throw new Error("Neo4j manual reflection fixture is not initialized.");
  driver ??= neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  const session = driver.session({ database });
  try {
    return await work(session);
  } finally {
    await session.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function structuralLabel(kind: FixtureEvent["kind"]): string {
  if (kind === "message") return "Message";
  if (kind === "tool_call") return "ToolCall";
  if (kind === "tool_result") return "ToolResult";
  return "TurnEnd";
}

function event(fixture: Fixture, kind: FixtureEvent["kind"], ingest_sequence: number, extra: Record<string, unknown> = {}): FixtureEvent {
  const event_uid = randomUUID();
  return {
    event_uid,
    schema_id: "anima.raw-event/v1.0",
    event_identity_method: "source",
    session_uid: fixture.session_uid,
    session_identity_method: "source",
    project_uid: fixture.project_uid,
    project_identity_method: "derived",
    kind,
    runtime_identity_json: "{}",
    capture_capabilities_json: "{}",
    source_json: JSON.stringify({ event_name: kind, event_id: event_uid, session_id: fixture.session_uid }),
    ingest_sequence,
    captured_at: "2026-09-21T00:00:00.000Z",
    content_parts_json: JSON.stringify(kind === "message" ? [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: extra.role === "user" ? "password=hidden" : "Final reply" }] : []),
    fidelity_json: JSON.stringify({ completeness: "full", missing_fields: [] }),
    native_payload_json: "{}",
    fingerprint: ingest_sequence.toString(16).padStart(64, "0"),
    fixture_run_id: fixture.fixture_run_id,
    ...extra,
  };
}

function makeFixture(): Fixture {
  const project_uid = randomUUID();
  const principal_uid = randomUUID();
  const directory_id = randomUUID();
  const users_root = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/neo4j-manual-reflection-tests/users");
  const fixture: Fixture = {
    fixture_run_id: randomUUID(),
    project_uid,
    session_uid: randomUUID(),
    scope: {
      users_root,
      directory_id,
      directory: resolve(users_root, directory_id),
      principal_uid,
    },
    events: [],
  };
  fixtureDirectories.add(fixture.scope.directory);
  const push = (kind: FixtureEvent["kind"], extra: Record<string, unknown> = {}): FixtureEvent => {
    const item = event(fixture, kind, fixture.events.length, extra);
    fixture.events.push(item);
    return item;
  };
  push("message", { role: "user", message_origin: "external_user" });
  const call = push("tool_call", { tool_name: "lookup" });
  push("tool_result", {
    outcome: "success",
    correlation_json: JSON.stringify({ method: "source", source_tool_call_id: call.event_uid }),
  });
  push("message", { role: "assistant" });
  push("turn_end", { turn_index: 0, turn_end_status: "final_reply" });
  return fixture;
}

async function seed(fixture: Fixture): Promise<void> {
  await mkdir(resolve(fixture.scope.directory, "data"), { recursive: true });
  const compact = fixture.project_uid.replaceAll("-", "");
  await registerProjectOwnership(fixture.scope, {
    project_uid: fixture.project_uid, identity_fingerprint: compact + compact,
  });
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run("CREATE (p:Project) SET p = $properties", {
      properties: { project_uid: fixture.project_uid, identity_fingerprint: compact + compact, fixture_run_id: fixture.fixture_run_id },
    });
    await tx.run("CREATE (s:Session) SET s = $properties", {
      properties: { session_uid: fixture.session_uid, project_uid: fixture.project_uid, next_ingest_sequence: fixture.events.length, fixture_run_id: fixture.fixture_run_id },
    });
    await tx.run("MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)", fixture);
    for (const item of fixture.events) {
      await tx.run(`CREATE (e:RawEvent:${structuralLabel(item.kind)}) SET e = $properties`, { properties: item });
      await tx.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)", { ...fixture, event_uid: item.event_uid });
      if (item.kind === "tool_result") {
        const correlation = JSON.parse(String(item.correlation_json)) as { source_tool_call_id: string };
        await tx.run("MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)", { event_uid: item.event_uid, target_uid: correlation.source_tool_call_id });
      }
    }
  }));
}

async function candidateUid(fixture: Fixture): Promise<string> {
  return withSession((session) => session.executeRead(async (tx) => {
    const result = await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) RETURN c.candidate_uid AS uid", fixture);
    if (result.records.length !== 1) throw new Error(`Expected one candidate, got ${result.records.length}.`);
    return String(result.records[0]!.get("uid"));
  }));
}

async function prepare(adapter?: ReflectionModelAdapter, driverFactory?: (config: Neo4jConfig) => neo4j.Driver): Promise<Prepared> {
  const fixture = makeFixture();
  await seed(fixture);
  const store = new Neo4jMemoryStore({
    configPath: syntheticConfigPath(),
    projectOwnership: fixture.scope,
    ...(adapter === undefined ? {} : { reflectionModelAdapter: adapter }),
    ...(driverFactory === undefined ? {} : { driverFactory }),
  });
  const health = await store.initialize();
  if (health.status !== "connected") throw new Error(`Neo4j manual reflection fixture requires connected store: ${health.status}`);
  expect((await store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).status).toBe("materialized");
  expect((await store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).status).toBe("materialized");
  return { fixture, candidate_uid: await candidateUid(fixture), event_uids: fixture.events.map((item) => item.event_uid), store };
}

async function cleanup(prepared: Prepared): Promise<void> {
  try {
    await prepared.store.close();
    await withSession((session) => session.executeWrite(async (tx) => {
      await tx.run("MATCH (r:Reflection)-[:REFLECTS_ON]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) DETACH DELETE r", { candidate_uid: prepared.candidate_uid });
      await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE c", fixtureParams(prepared.fixture));
      await tx.run("MATCH (u:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE u", fixtureParams(prepared.fixture));
      await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", fixtureParams(prepared.fixture));
    }));
    const remaining = await withSession((session) => session.executeRead(async (tx) => {
      const fixtureNodes = await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id RETURN count(n) AS count", fixtureParams(prepared.fixture));
      const reflectionNodes = await tx.run("MATCH (r:Reflection) WHERE r.scope_json CONTAINS $candidate_uid RETURN count(r) AS count", { candidate_uid: prepared.candidate_uid });
      return { fixture: numberValue(fixtureNodes.records[0]!.get("count")), reflections: numberValue(reflectionNodes.records[0]!.get("count")) };
    }));
    expect(remaining.fixture).toBe(0);
    expect(remaining.reflections).toBe(0);
  } finally {
    recycleSyntheticScope(prepared.fixture.scope.directory);
  }
}

class FakeAdapter implements ReflectionModelAdapter {
  readonly inputs: ManualCandidateReflectionInput[] = [];
  readonly model_ref = "fake/reflection";
  constructor(private readonly response: (input: ManualCandidateReflectionInput) => unknown) {}
  readonly reflect = (input: ReflectionModelInput): Promise<unknown> => {
    if (input.reflection_kind !== "manual") throw new Error("unexpected automatic input");
    this.inputs.push(input);
    return Promise.resolve(this.response(input));
  };
}

const manualOnlyReflect = (input: ManualCandidateReflectionInput): Promise<unknown> => Promise.resolve(input);
const manualOnlyAdapter: {
  readonly model_ref: string;
  readonly reflect: (input: ManualCandidateReflectionInput) => Promise<unknown>;
} = {
  model_ref: "manual-only",
  reflect: manualOnlyReflect,
};
// @ts-expect-error ReflectionModelAdapter must reject a manual-only function property.
const rejectedManualOnlyAdapter: ReflectionModelAdapter = manualOnlyAdapter;
void rejectedManualOnlyAdapter;

function validResponse(input: ManualCandidateReflectionInput): unknown {
  const evidence = { candidate_uid: input.selector.candidate_uid, event_uid: input.task_digests[0]!.events[0]!.event_uid };
  return {
    overview: { text: "A useful task", evidence: [evidence] },
    observations: [{ observation_uid: "o1", kind: "theme", text: "The task had a clear path", evidence: [evidence] }],
    open_questions: [{ question_uid: "q1", text: "What should be automated next?", evidence: [evidence] }],
  };
}

const operationInput = (candidate_uid: string, max_input_bytes = 65536): ReflectManualCandidateInput => ({
  candidate_uid,
  model_ref: "fake/reflection",
  prompt_contract_version: "manual-reflection/v1",
  max_input_bytes,
});

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error(`Neo4j manual reflection fixture requires config: ${loaded.kind}`);
  config = loaded.config;
  database = config.database;
});

afterAll(async () => {
  try {
    if (driver !== undefined) await driver.close();
  } finally {
    for (const directory of fixtureDirectories) recycleSyntheticScope(directory);
  }
});

describe("Neo4j manual candidate reflection", () => {
  test("materializes only while the trusted Project Marker fingerprint matches", async () => {
    const adapter = new FakeAdapter(validResponse);
    const prepared = await prepare(adapter);
    try {
      const fingerprint = prepared.fixture.project_uid.replaceAll("-", "").repeat(2);
      let authorizationCalls = 0;
      const result = await prepared.store.reflectManualCandidate({
        ...operationInput(prepared.candidate_uid),
        authorize_before_write: async () => {
          authorizationCalls += 1;
          return fingerprint;
        },
      });
      expect(result.status).toBe("materialized");
      expect(authorizationCalls).toBe(1);
    } finally {
      await cleanup(prepared);
    }

    let resolveModel!: (value: unknown) => void;
    let modelStarted!: () => void;
    let modelInput: ManualCandidateReflectionInput | undefined;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const response = new Promise<unknown>((resolve) => { resolveModel = resolve; });
    const deferredAdapter: ReflectionModelAdapter = {
      model_ref: "fake/reflection",
      async reflect(input) {
        if (input.reflection_kind !== "manual") throw new Error("unexpected automatic input");
        modelInput = input;
        modelStarted();
        return response;
      },
    };
    const changed = await prepare(deferredAdapter);
    try {
      const originalFingerprint = changed.fixture.project_uid.replaceAll("-", "").repeat(2);
      const pending = changed.store.reflectManualCandidate({
        ...operationInput(changed.candidate_uid),
        authorize_before_write: async () => originalFingerprint,
      });
      await started;
      await withSession((session) => session.executeWrite(async (tx) => {
        await tx.run(
          "MATCH (p:Project {project_uid: $project_uid}) SET p.identity_fingerprint = $fingerprint",
          { project_uid: changed.fixture.project_uid, fingerprint: "f".repeat(64) },
        );
      }));
      if (modelInput === undefined) throw new Error("Expected deferred manual model input.");
      resolveModel(validResponse(modelInput));
      expect(await pending).toMatchObject({ status: "failed", code: "identity_conflict" });
      const graph = await withSession((session) => session.executeRead(async (tx) => {
        const result = await tx.run(
          "MATCH (r:Reflection)-[:REFLECTS_ON]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) RETURN count(r) AS count",
          { candidate_uid: changed.candidate_uid },
        );
        return numberValue(result.records[0]!.get("count"));
      }));
      expect(graph).toBe(0);
    } finally {
      await cleanup(changed);
    }
  }, { timeout: 120_000 });

  test("materializes, repeats idempotently, validates input size, model availability, and invalid output", async () => {
    const adapter = new FakeAdapter(validResponse);
    const prepared = await prepare(adapter);
    try {
      const first = await prepared.store.reflectManualCandidate(operationInput(prepared.candidate_uid));
      expect(first.status).toBe("materialized");
      if (first.status !== "materialized") throw new Error("Expected materialized reflection.");
      expect(adapter.inputs).toHaveLength(1);
      expect(adapter.inputs[0]!.task_digests[0]!.initiator.content).toBe("[REDACTED]");

      const topology = await withSession((session) => session.executeRead(async (tx) => {
        const node = await tx.run("MATCH (r:Reflection {reflection_uid: $reflection_uid}) RETURN properties(r) AS properties", { reflection_uid: first.reflection_uid });
        const target = await tx.run("MATCH (r:Reflection {reflection_uid: $reflection_uid})-[rel:REFLECTS_ON]->(c:ExecutionReviewCandidate) RETURN count(rel) AS count", { reflection_uid: first.reflection_uid });
        const evidence = await tx.run("MATCH (r:Reflection {reflection_uid: $reflection_uid})-[rel:EVIDENCED_BY]->(e:RawEvent) RETURN rel.subject_path AS subject_path, rel.evidence_index AS evidence_index, rel.candidate_position AS candidate_position, e.event_uid AS event_uid ORDER BY rel.subject_path", { reflection_uid: first.reflection_uid });
        const candidate = await tx.run("MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) RETURN c.state AS state", { candidate_uid: prepared.candidate_uid });
        return { node: node.records[0]?.get("properties"), target: numberValue(target.records[0]!.get("count")), evidence: evidence.records.map((record) => ({ subject_path: record.get("subject_path"), evidence_index: numberValue(record.get("evidence_index")), candidate_position: numberValue(record.get("candidate_position")), event_uid: record.get("event_uid") })), state: candidate.records[0]?.get("state") };
      }));
      expect(topology.node).toMatchObject({ kind: "manual", model_ref: "fake/reflection", prompt_contract_version: "manual-reflection/v1" });
      expect(topology.target).toBe(1);
      expect(topology.evidence).toEqual([
        { subject_path: "observations/o1", evidence_index: 0, candidate_position: 0, event_uid: prepared.event_uids[0] },
        { subject_path: "open_questions/q1", evidence_index: 0, candidate_position: 0, event_uid: prepared.event_uids[0] },
        { subject_path: "overview", evidence_index: 0, candidate_position: 0, event_uid: prepared.event_uids[0] },
      ]);
      expect(topology.state).toBe("ready");
      await expect(prepared.store.listProjectReflections({
        project_uid: prepared.fixture.project_uid, limit: 5,
        now: String((topology.node as Record<string, unknown>).created_at).replace(/\[UTC\]$/u, ""),
      })).resolves.toMatchObject({
        status: "completed", count: 1,
        items: [{ reflection_uid: first.reflection_uid, kind: "manual", overview: "A useful task" }],
      });

      const repeated = await prepared.store.reflectManualCandidate(operationInput(prepared.candidate_uid));
      expect(repeated).toEqual({ status: "up_to_date", candidate_uid: prepared.candidate_uid, reflection_uid: first.reflection_uid });
      expect(adapter.inputs).toHaveLength(2);
      const counts = await withSession((session) => session.executeRead(async (tx) => {
        const result = await tx.run("MATCH (r:Reflection {reflection_uid: $reflection_uid}) OPTIONAL MATCH (r)-[target:REFLECTS_ON]->() OPTIONAL MATCH (r)-[e:EVIDENCED_BY]->() RETURN count(DISTINCT r) AS reflections, count(DISTINCT target) AS targets, count(DISTINCT e) AS evidence", { reflection_uid: first.reflection_uid });
        return result.records[0];
      }));
      expect(numberValue(counts!.get("reflections"))).toBe(1);
      expect(numberValue(counts!.get("targets"))).toBe(1);
      expect(numberValue(counts!.get("evidence"))).toBe(3);
    } finally {
      await cleanup(prepared);
    }

    const invalidAdapter = new FakeAdapter(() => ({}));
    const invalid = await prepare(invalidAdapter);
    try {
      const result = await invalid.store.reflectManualCandidate(operationInput(invalid.candidate_uid));
      expect(result).toMatchObject({ status: "failed", code: "invalid_reflection" });
      expect(invalidAdapter.inputs).toHaveLength(1);
      const reflectionCount = await withSession((session) => session.executeRead(async (tx) => {
        const count = await tx.run("MATCH (r:Reflection)-[:REFLECTS_ON]->(:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) RETURN count(r) AS count", { candidate_uid: invalid.candidate_uid });
        return numberValue(count.records[0]!.get("count"));
      }));
      expect(reflectionCount).toBe(0);
    } finally {
      await cleanup(invalid);
    }

    const sizeAdapter = new FakeAdapter(validResponse);
    const size = await prepare(sizeAdapter);
    try {
      const result = await size.store.reflectManualCandidate(operationInput(size.candidate_uid, 1));
      expect(result).toMatchObject({ status: "failed", code: "input_too_large" });
      expect(sizeAdapter.inputs).toHaveLength(0);
    } finally {
      await cleanup(size);
    }
    const mismatchAdapter = new FakeAdapter(validResponse);
    const mismatch = await prepare(mismatchAdapter);
    try {
      const result = await mismatch.store.reflectManualCandidate({
        ...operationInput(mismatch.candidate_uid),
        model_ref: "other/reflection",
      });
      expect(result).toMatchObject({ status: "failed", code: "invalid_input" });
      expect(mismatchAdapter.inputs).toHaveLength(0);
      const reflectionCount = await withSession((session) => session.executeRead(async (tx) => {
        const count = await tx.run("MATCH (r:Reflection)-[:REFLECTS_ON]->(:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) RETURN count(r) AS count", { candidate_uid: mismatch.candidate_uid });
        return numberValue(count.records[0]!.get("count"));
      }));
      expect(reflectionCount).toBe(0);
    } finally {
      await cleanup(mismatch);
    }

    const unavailable = await prepare();
    try {
      const result = await unavailable.store.reflectManualCandidate(operationInput(unavailable.candidate_uid));
      expect(result).toMatchObject({ status: "failed", code: "model_unavailable" });
    } finally {
      await cleanup(unavailable);
    }
  }, { timeout: 120_000 });

  test("preserves a committed reflection when close races after executeWrite resolves", async () => {
    const race: ReflectionCloseRace = { armed: false };
    const adapter = new FakeAdapter(validResponse);
    const prepared = await prepare(adapter, raceDriverFactory(race));
    race.store = prepared.store;
    race.armed = true;
    try {
      const result = await prepared.store.reflectManualCandidate(operationInput(prepared.candidate_uid));
      expect(result.status).toBe("materialized");
      if (result.status !== "materialized") throw new Error("Expected materialized reflection.");
      const reflectionCount = await withSession((session) => session.executeRead(async (tx) => {
        const count = await tx.run("MATCH (r:Reflection {reflection_uid: $reflection_uid}) RETURN count(r) AS count", { reflection_uid: result.reflection_uid });
        return numberValue(count.records[0]!.get("count"));
      }));
      expect(reflectionCount).toBe(1);
    } finally {
      race.armed = false;
      await cleanup(prepared);
    }
  }, { timeout: 120_000 });
});
