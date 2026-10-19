import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { syntheticConfigPath } from "./dev-config.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";
import type { ExecutionReviewModelInput } from "../src/index.ts";

type Fixture = { fixture_run_id: string; project_uid: string; session_uid: string; events: Array<Record<string, unknown>> };
let config: Neo4jConfig | undefined;
let database: string | undefined;
let driver: neo4j.Driver | undefined;
let store: Neo4jMemoryStore;
let lastInput: ExecutionReviewModelInput | undefined;
let reviewCalls = 0;

async function withSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  if (config === undefined || database === undefined) throw new Error("Neo4j fixture is not initialized.");
  driver ??= neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  const session = driver.session({ database });
  try { return await work(session); } finally { await session.close(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
}
function event(fixture: Fixture, event_uid: string, ingest_sequence: number, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_uid, schema_id: "anima.raw-event/v1.0", event_identity_method: "source", session_uid: fixture.session_uid,
    session_identity_method: "source", project_uid: fixture.project_uid, project_identity_method: "derived", kind,
    runtime_identity_json: "{}", capture_capabilities_json: "{}", source_json: JSON.stringify({ event_name: kind, event_id: event_uid, session_id: fixture.session_uid }),
    ingest_sequence, captured_at: "2026-09-21T00:00:00.000Z", content_parts_json: JSON.stringify(kind === "message" ? [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "password=hidden" }] : []),
    fidelity_json: JSON.stringify({ completeness: "full", missing_fields: [] }), native_payload_json: "{}", fingerprint: ingest_sequence.toString(16).padStart(64, "0"), fixture_run_id: fixture.fixture_run_id, ...extra,
  };
}
async function seed(): Promise<Fixture> {
  const fixture: Fixture = { fixture_run_id: randomUUID(), project_uid: randomUUID(), session_uid: randomUUID(), events: [] };
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  fixture.events = [
    event(fixture, ids[0]!, 0, "message", { role: "user", message_origin: "external_user" }),
    event(fixture, ids[1]!, 1, "tool_call"),
    event(fixture, ids[2]!, 2, "tool_result", { outcome: "success", correlation_json: JSON.stringify({ method: "source", source_tool_call_id: ids[1] }) }),
    event(fixture, ids[3]!, 3, "turn_end", { turn_index: 0, turn_end_status: "final_reply" }),
  ];
  await withSession((session) => session.executeWrite(async (tx) => {
    await tx.run("CREATE (p:Project) SET p = $properties", { properties: { project_uid: fixture.project_uid, identity_fingerprint: fixture.project_uid, fixture_run_id: fixture.fixture_run_id } });
    await tx.run("CREATE (s:Session) SET s = $properties", { properties: { session_uid: fixture.session_uid, project_uid: fixture.project_uid, next_ingest_sequence: 4, fixture_run_id: fixture.fixture_run_id } });
    await tx.run("MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)", fixture);
    for (const item of fixture.events) {
      await tx.run(`CREATE (e:RawEvent:${item.kind === "message" ? "Message" : item.kind === "tool_call" ? "ToolCall" : item.kind === "tool_result" ? "ToolResult" : "TurnEnd"}) SET e = $properties`, { properties: item });
      await tx.run("MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid}) CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)", { ...fixture, event_uid: item.event_uid });
      if (item.correlation_json !== undefined) await tx.run("MATCH (result:RawEvent {event_uid: $event_uid}), (call:RawEvent {event_uid: $target_uid}) CREATE (result)-[:RESULT_OF]->(call)", { event_uid: item.event_uid, target_uid: ids[1] });
    }
  }));
  return fixture;
}
async function cleanup(fixture: Fixture): Promise<void> {
  await withSession((session) => session.executeWrite((tx) => tx.run("MATCH (r:ExecutionReview {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE r WITH 1 AS ignored MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE c WITH 1 AS ignored MATCH (u:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid}) DETACH DELETE u WITH 1 AS ignored MATCH (n) WHERE n.fixture_run_id = $fixture_run_id DETACH DELETE n", fixture)));
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error(`Neo4j fixture requires config: ${loaded.kind}`);
  config = loaded.config;
  database = config.database;
  store = new Neo4jMemoryStore({ configPath: syntheticConfigPath(), reviewModelAdapter: { review: async (input) => {
    reviewCalls += 1;
    lastInput = input;
    const event_uid = input.events[0]?.event_uid;
    if (event_uid === undefined) throw new Error("missing input event");
    return { outcome: "completed", outcome_evidence_event_uids: [event_uid], objective: "objective", process_summary: "summary", findings: [], failure_analysis: null, failure_analysis_evidence_event_uids: null, reusable_practices: [], decision: { action: "reviewed", skip_reason: null } };
  } } });
  const health = await store.initialize();
  if (health.status !== "connected") throw new Error(`Neo4j fixture requires connected store: ${health.status}`);
});
afterAll(async () => { await store.close(); if (driver !== undefined) await driver.close(); });

describe("Neo4j ExecutionReview", () => {
  test("claims, projects, persists, and replays a fake-adapter review", async () => {
    const fixture = await seed();
    try {
      const materialized = await store.materializeExecutionUnits({ project_uid: fixture.project_uid, session_uid: fixture.session_uid });
      expect(materialized).toMatchObject({ status: "materialized" });
      expect((await store.materializeExecutionReviewCandidates({ project_uid: fixture.project_uid, session_uid: fixture.session_uid })).status).toBe("materialized");
      const candidate_uid = await withSession((session) => session.executeRead(async (tx) => String((await tx.run("MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid}) RETURN c.candidate_uid AS uid", fixture)).records[0]!.get("uid"))));
      const input = { candidate_uid, lease_owner: "fake-worker", lease_ttl_ms: 30000, prompt_contract_version: "prompt-v1", model_ref: "fake-v1" } as const;
      await expect(store.reviewExecutionCandidate(input)).resolves.toMatchObject({ status: "reviewed", candidate_uid });
      expect(lastInput?.events[0]?.content).toBe("[REDACTED]");
      expect(reviewCalls).toBe(1);
      const v2Input = { ...input, prompt_contract_version: "execution-review-manual/v2", model_ref: "fake-v2" } as const;
      await expect(store.reviewExecutionCandidate(v2Input)).resolves.toMatchObject({ status: "skipped", candidate_uid });
      expect(reviewCalls).toBe(1);
      const counts = await withSession((session) => session.executeRead(async (tx) => {
        const reviews = await tx.run("MATCH (r:ExecutionReview {candidate_uid: $candidate_uid}) RETURN count(r) AS count", { candidate_uid });
        const edges = await tx.run("MATCH (:ExecutionReview {candidate_uid: $candidate_uid})-[:EVIDENCED_BY]->() RETURN count(*) AS count", { candidate_uid });
        return { reviews: neo4j.integer.toNumber(reviews.records[0]!.get("count")), edges: neo4j.integer.toNumber(edges.records[0]!.get("count")) };
      }));
      expect(counts).toEqual({ reviews: 1, edges: 1 });
    } finally { await cleanup(fixture); }
  }, { timeout: 30_000 });
});
