import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { syntheticConfigPath } from "./dev-config.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";
import type { TaskDigest } from "../src/task-digest-types.ts";

type FixtureEvent = Record<string, unknown> & {
  event_uid: string;
  kind: "message" | "tool_call" | "tool_result" | "turn_end" | "boundary";
  ingest_sequence: number;
};

type Fixture = {
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  events: FixtureEvent[];
};

type ScenarioName = "completed-two-tools" | "error-then-retry" | "cancelled" | "shutdown" | "compact";

type Scenario = {
  name: ScenarioName;
  terminal_state: "completed" | "cancelled" | "interrupted";
  terminal_reason: "final_reply" | "user_cancelled" | "session_shutdown" | "session_compact";
  result_indices: number[];
  result_outcomes: Array<"success" | "error">;
  result_call_indices: number[];
  unsettled_call_indices: number[];
};

const scenarios: Scenario[] = [
  {
    name: "completed-two-tools",
    terminal_state: "completed",
    terminal_reason: "final_reply",
    result_indices: [2, 4],
    result_outcomes: ["success", "success"],
    result_call_indices: [1, 3],
    unsettled_call_indices: [],
  },
  {
    name: "error-then-retry",
    terminal_state: "completed",
    terminal_reason: "final_reply",
    result_indices: [2, 4],
    result_outcomes: ["error", "success"],
    result_call_indices: [1, 3],
    unsettled_call_indices: [],
  },
  {
    name: "cancelled",
    terminal_state: "cancelled",
    terminal_reason: "user_cancelled",
    result_indices: [],
    result_outcomes: [],
    result_call_indices: [],
    unsettled_call_indices: [1],
  },
  {
    name: "shutdown",
    terminal_state: "interrupted",
    terminal_reason: "session_shutdown",
    result_indices: [],
    result_outcomes: [],
    result_call_indices: [],
    unsettled_call_indices: [1],
  },
  {
    name: "compact",
    terminal_state: "interrupted",
    terminal_reason: "session_compact",
    result_indices: [],
    result_outcomes: [],
    result_call_indices: [],
    unsettled_call_indices: [1],
  },
];

let config: Neo4jConfig | undefined;
let database: string | undefined;
let driver: neo4j.Driver | undefined;
let store: Neo4jMemoryStore;

function numberValue(value: unknown): number {
  return neo4j.isInt(value) ? value.toNumber() : Number(value);
}

function fixtureParams(fixture: Fixture): { fixture_run_id: string; project_uid: string; session_uid: string } {
  return {
    fixture_run_id: fixture.fixture_run_id,
    project_uid: fixture.project_uid,
    session_uid: fixture.session_uid,
  };
}

async function withSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  if (config === undefined || database === undefined) throw new Error("Neo4j TaskDigest fixture is not initialized.");
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
  if (kind === "turn_end") return "TurnEnd";
  return "BoundarySignal";
}

function event(
  fixture: Fixture,
  kind: FixtureEvent["kind"],
  ingest_sequence: number,
  extra: Record<string, unknown> = {},
): FixtureEvent {
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
    content_parts_json: JSON.stringify(kind === "message"
      ? [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "Bearer password=hidden" }]
      : []),
    fidelity_json: JSON.stringify({ completeness: "full", missing_fields: [] }),
    native_payload_json: "{}",
    fingerprint: ingest_sequence.toString(16).padStart(64, "0"),
    fixture_run_id: fixture.fixture_run_id,
    ...extra,
  };
}

function makeFixture(scenario: Scenario): Fixture {
  const fixture: Fixture = {
    fixture_run_id: randomUUID(),
    project_uid: randomUUID(),
    session_uid: randomUUID(),
    events: [],
  };
  const push = (kind: FixtureEvent["kind"], extra: Record<string, unknown> = {}): FixtureEvent => {
    const item = event(fixture, kind, fixture.events.length, extra);
    fixture.events.push(item);
    return item;
  };

  push("message", { role: "user", message_origin: "external_user" });
  const firstCall = push("tool_call", { tool_name: "lookup" });
  if (scenario.name === "completed-two-tools" || scenario.name === "error-then-retry") {
    push("tool_result", {
      outcome: scenario.name === "error-then-retry" ? "error" : "success",
      correlation_json: JSON.stringify({ method: "source", source_tool_call_id: firstCall.event_uid }),
    });
    const secondCall = push("tool_call", { tool_name: "retry" });
    push("tool_result", {
      outcome: "success",
      correlation_json: JSON.stringify({ method: "source", source_tool_call_id: secondCall.event_uid }),
    });
    push("turn_end", { turn_index: 0, turn_end_status: "final_reply" });
  } else if (scenario.name === "cancelled") {
    push("turn_end", { turn_index: 0, turn_end_status: "cancelled" });
  } else {
    push("boundary", { boundary_type: scenario.name });
  }
  return fixture;
}

function makeTwoExecutionFixture(): Fixture {
  const fixture: Fixture = {
    fixture_run_id: randomUUID(),
    project_uid: randomUUID(),
    session_uid: randomUUID(),
    events: [],
  };
  const push = (kind: FixtureEvent["kind"], extra: Record<string, unknown> = {}): FixtureEvent => {
    const item = event(fixture, kind, fixture.events.length, extra);
    fixture.events.push(item);
    return item;
  };
  for (const tool_name of ["lookup", "retry"]) {
    push("message", { role: "user", message_origin: "external_user" });
    push("message", { role: "assistant", message_origin: null });
    const call = push("tool_call", { tool_name });
    push("tool_result", {
      outcome: "success",
      correlation_json: JSON.stringify({ method: "source", source_tool_call_id: call.event_uid }),
    });
    push("turn_end", { turn_index: 0, turn_end_status: "final_reply" });
  }
  return fixture;
}

async function seed(fixture: Fixture): Promise<void> {
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run("CREATE (p:Project) SET p = $properties", {
      properties: {
        project_uid: fixture.project_uid,
        identity_fingerprint: fixture.project_uid,
        fixture_run_id: fixture.fixture_run_id,
      },
    });
    await tx.run("CREATE (s:Session) SET s = $properties", {
      properties: {
        session_uid: fixture.session_uid,
        project_uid: fixture.project_uid,
        next_ingest_sequence: fixture.events.length,
        fixture_run_id: fixture.fixture_run_id,
      },
    });
    await tx.run(
      "MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)",
      fixture,
    );
    for (const item of fixture.events) {
      await tx.run(`CREATE (e:RawEvent:${structuralLabel(item.kind)}) SET e = $properties`, { properties: item });
      await tx.run(
        "MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)",
        { ...fixture, event_uid: item.event_uid },
      );
      if (item.kind === "tool_result") {
        const correlation = JSON.parse(String(item.correlation_json)) as { source_tool_call_id: string };
        await tx.run(
          "MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)",
          { event_uid: item.event_uid, target_uid: correlation.source_tool_call_id },
        );
      }
    }
  }));
}

async function candidateUids(fixture: Fixture): Promise<string[]> {
  return withSession((session) => session.executeRead(async (tx) => {
    const result = await tx.run(
      "MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) RETURN c.candidate_uid AS uid ORDER BY c.execution_uid",
      fixture,
    );
    return result.records.map((record) => String(record.get("uid")));
  }));
}

async function candidateUid(fixture: Fixture): Promise<string> {
  const uids = await candidateUids(fixture);
  if (uids.length !== 1) throw new Error(`Expected one candidate, got ${uids.length}.`);
  return uids[0]!;
}

async function cleanup(fixture: Fixture): Promise<void> {
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run(
      "MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE c",
      fixtureParams(fixture),
    );
    await tx.run(
      "MATCH (u:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE u",
      fixtureParams(fixture),
    );
    await tx.run("MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", fixtureParams(fixture));
  }));
  const markerCount = await withSession((session) => session.executeRead(async (tx) => {
    const result = await tx.run(
      "MATCH (n) WHERE n.fixture_run_id = $fixture_run_id RETURN count(n) AS count",
      fixtureParams(fixture),
    );
    return numberValue(result.records[0]!.get("count"));
  }));
  expect(markerCount).toBe(0);
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error(`Neo4j TaskDigest fixture requires config: ${loaded.kind}`);
  config = loaded.config;
  database = config.database;
  store = new Neo4jMemoryStore({ configPath: syntheticConfigPath() });
  const health = await store.initialize();
  if (health.status !== "connected") throw new Error(`Neo4j TaskDigest fixture requires connected store: ${health.status}`);
});

afterAll(async () => {
  await store.close();
  if (driver !== undefined) await driver.close();
});

describe("Neo4j TaskDigest", () => {
  for (const scenario of scenarios) {
    test(`materializes and reads ${scenario.name}`, async () => {
      const fixture = makeFixture(scenario);
      try {
        await seed(fixture);
        await expect(store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).resolves.toMatchObject({
          status: "materialized",
          execution_units_created: 1,
        });
        await expect(store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).resolves.toMatchObject({
          status: "materialized",
          candidates_created: 1,
        });

        const candidate_uid = await candidateUid(fixture);
        const result = await store.getTaskDigest({ candidate_uid });
        expect(result.status).toBe("found");
        if (result.status !== "found") throw new Error(`Expected a digest, got ${result.status}.`);
        const digest: TaskDigest = result.digest;
        const terminal = fixture.events.at(-1)!;
        expect(digest.terminal).toMatchObject({
          state: scenario.terminal_state,
          terminal_reason: scenario.terminal_reason,
          event_uid: terminal.event_uid,
          position: fixture.events.length - 1,
        });
        expect(digest.events.map((item) => item.position)).toEqual(fixture.events.map((_, position) => position));
        expect(digest.events.map((item) => item.event_uid)).toEqual(fixture.events.map((item) => item.event_uid));
        expect(digest.initiator).toMatchObject({ event_uid: fixture.events[0]!.event_uid, position: 0, content: "[REDACTED]" });

        for (let index = 0; index < scenario.result_indices.length; index += 1) {
          const resultEvent = digest.events[scenario.result_indices[index]!]!;
          expect(resultEvent).toMatchObject({
            kind: "tool_result",
            result_of_event_uid: fixture.events[scenario.result_call_indices[index]!]!.event_uid,
            outcome: scenario.result_outcomes[index],
          });
        }
        expect(digest.unsettled_tool_calls).toEqual(scenario.unsettled_call_indices.map((index) => ({
          tool_call_event_uid: fixture.events[index]!.event_uid,
          terminal_event_uid: terminal.event_uid,
        })));
      } finally {
        await cleanup(fixture);
      }
    }, { timeout: 60_000 });
  }

  test("reads both requested candidates from one session and preserves message authors", async () => {
    const fixture = makeTwoExecutionFixture();
    try {
      await seed(fixture);
      await expect(store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).resolves.toMatchObject({
        status: "materialized",
        execution_units_created: 2,
      });
      await expect(store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).resolves.toMatchObject({
        status: "materialized",
        candidates_created: 2,
      });
      const candidate_uids = await candidateUids(fixture);
      expect(candidate_uids).toHaveLength(2);
      for (const candidate_uid of candidate_uids) {
        const result = await store.getTaskDigest({ candidate_uid });
        expect(result.status).toBe("found");
        if (result.status !== "found") throw new Error(`Expected a digest, got ${result.status}.`);
        expect(result.digest.events.filter((event) => event.kind === "message").map((event) => event.role)).toEqual(["user", "assistant"]);
        expect(result.digest.initiator).toMatchObject({ event_uid: expect.any(String), position: 0, content: "[REDACTED]" });
      }
    } finally {
      await cleanup(fixture);
    }
  }, { timeout: 60_000 });

  test("rejects a candidate with an extra property as an identity conflict", async () => {
    const fixture = makeFixture(scenarios[0]!);
    try {
      await seed(fixture);
      await store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      await store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      const candidate_uid = await candidateUid(fixture);
      await withSession((session) => session.executeWrite((tx) => tx.run(
        "MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) SET c.unexpected_property = true",
        { candidate_uid },
      )));
      await expect(store.getTaskDigest({ candidate_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    } finally {
      await cleanup(fixture);
    }
  }, { timeout: 60_000 });

  test("rejects a leased candidate missing an exact workflow field", async () => {
    const fixture = makeFixture(scenarios[0]!);
    try {
      await seed(fixture);
      await store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      await store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      const candidate_uid = await candidateUid(fixture);
      await withSession((session) => session.executeWrite((tx) => tx.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         SET c.state = "leased", c.lease_owner = "worker", c.lease_token = $lease_token, c.leased_at = datetime()
         REMOVE c.lease_until`,
        { candidate_uid, lease_token: randomUUID() },
      )));
      await expect(store.getTaskDigest({ candidate_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    } finally {
      await cleanup(fixture);
    }
  }, { timeout: 60_000 });

  test("reads a well-formed leased candidate", async () => {
    const fixture = makeFixture(scenarios[0]!);
    try {
      await seed(fixture);
      await store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      await store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      const candidate_uid = await candidateUid(fixture);
      await withSession((session) => session.executeWrite((tx) => tx.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         SET c.state = "leased", c.lease_owner = "worker", c.lease_token = $lease_token,
             c.lease_until = datetime() + duration({seconds: 60}), c.leased_at = datetime()`,
        { candidate_uid, lease_token: randomUUID() },
      )));
      await expect(store.getTaskDigest({ candidate_uid })).resolves.toMatchObject({ status: "found" });
    } finally {
      await cleanup(fixture);
    }
  }, { timeout: 60_000 });
  test("rejects a candidate with a second session owner as an identity conflict", async () => {
    const fixture = makeFixture(scenarios[0]!);
    try {
      await seed(fixture);
      await store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      await store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      const candidate_uid = await candidateUid(fixture);
      const executionResult = await withSession((session) => session.executeRead(async (tx) => tx.run(
        "MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) RETURN c.execution_uid AS execution_uid",
        { candidate_uid },
      )));
      if (executionResult.records.length !== 1) throw new Error(`Expected one candidate execution, got ${executionResult.records.length}.`);
      const execution_uid = String(executionResult.records[0]!.get("execution_uid"));
      await withSession((session) => session.executeWrite((tx) => tx.run(
        `CREATE (s:Session) SET s = $session_properties
         WITH s
         MATCH (u:ExecutionUnit {execution_uid: $execution_uid})
         CREATE (s)-[:HAS_EXECUTION {schema_id: $schema_id}]->(u)`,
        {
          execution_uid,
          schema_id: "anima.session-execution-link/v1.0",
          session_properties: {
            session_uid: randomUUID(),
            project_uid: fixture.project_uid,
            next_ingest_sequence: 0,
            fixture_run_id: fixture.fixture_run_id,
          },
        },
      )));
      await expect(store.getTaskDigest({ candidate_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    } finally {
      await cleanup(fixture);
    }
  }, { timeout: 60_000 });
});
