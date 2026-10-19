import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { syntheticConfigPath } from "./dev-config.ts";
import {
  automaticReflectionSelector,
  buildAutomaticReflectionInput,
  buildAutomaticReflectionPlan,
  buildManualCandidateReflectionInput,
  buildManualReflectionPlan,
  DAILY_REFLECTION_PROMPT_CONTRACT,
} from "../src/index.ts";
import type { TaskDigest } from "../src/task-digest-types.ts";
import type { ReflectionPersistencePlan } from "../src/reflection-persistence-types.ts";
import {
  materializeManualReflectionPlan,
  materializeReflectionPlan,
  ReflectionMaterializationError,
} from "../src/reflection-neo4j-materializer.ts";

const project_uid = randomUUID();
const candidate_uid = randomUUID();
const event_uids = [randomUUID(), randomUUID()] as const;
const fixture_run_id = randomUUID();
let config: Neo4jConfig | undefined;
let driver: neo4j.Driver | undefined;
let database: string | undefined;

async function withWrite<T>(work: (transaction: neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
  if (driver === undefined || database === undefined) throw new Error("Neo4j reflection fixture is not initialized.");
  const session = driver.session({ database });
  try {
    return await session.executeWrite(work);
  } finally {
    await session.close();
  }
}

async function withRead<T>(work: (transaction: neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
  if (driver === undefined || database === undefined) throw new Error("Neo4j reflection fixture is not initialized.");
  const session = driver.session({ database });
  try {
    return await session.executeRead(work);
  } finally {
    await session.close();
  }
}

function digest(): TaskDigest {
  return {
    candidate_uid,
    execution_uid: randomUUID(),
    project_uid,
    session_uid: randomUUID(),
    source_fingerprint: "source-fingerprint",
    terminal: { state: "completed", terminal_reason: "final_reply", event_uid: event_uids[1], position: 1, captured_at: "2026-01-01T00:00:00Z" },
    initiator: { event_uid: event_uids[0], position: 0, content: "start" },
    events: [
      { event_uid: event_uids[0], position: 0, kind: "message", role: "user", content: "start" },
      { event_uid: event_uids[1], position: 1, kind: "turn_end", role: "assistant", content: "done" },
    ],
    unsettled_tool_calls: [],
    content_omissions: [],
  };
}

function plan(overviewText = "overview") {
  const model_input = buildManualCandidateReflectionInput(digest());
  return buildManualReflectionPlan({
    model_input,
    prompt_contract_version: "manual-reflection/v1",
    model_ref: "model-v1",
    response: {
      overview: {
        text: overviewText,
        evidence: event_uids.map((event_uid) => ({ candidate_uid, event_uid })),
      },
      observations: [],
      open_questions: [],
    },
  });
}

function calendarDigest(candidateUid: string, events: readonly [string, string], capturedAt: string): TaskDigest {
  const base = digest();
  return {
    ...base,
    candidate_uid: candidateUid,
    execution_uid: randomUUID(),
    session_uid: randomUUID(),
    terminal: { ...base.terminal, event_uid: events[1], captured_at: capturedAt },
    initiator: { ...base.initiator, event_uid: events[0] },
    events: [
      { ...base.events[0]!, event_uid: events[0] },
      { ...base.events[1]!, event_uid: events[1] },
    ],
  };
}

function calendarPlan(): {
  plan: ReflectionPersistencePlan;
  second_candidate_uid: string;
  second_event_uids: readonly [string, string];
} {
  const second_candidate_uid = randomUUID();
  const second_event_uids = [randomUUID(), randomUUID()] as const;
  const model_input = buildAutomaticReflectionInput(
    automaticReflectionSelector(project_uid, "daily", "2026-01-01"),
    [
      calendarDigest(candidate_uid, event_uids, "2026-01-01T00:00:00Z"),
      calendarDigest(second_candidate_uid, second_event_uids, "2026-01-01T01:00:00Z"),
    ],
  );
  const persistencePlan = buildAutomaticReflectionPlan({
    model_input,
    prompt_contract_version: DAILY_REFLECTION_PROMPT_CONTRACT,
    model_ref: "model-v1",
    response: {
      overview: {
        text: "calendar overview",
        evidence: [
          { candidate_uid, event_uid: event_uids[0] },
          { candidate_uid, event_uid: event_uids[1] },
          { candidate_uid: second_candidate_uid, event_uid: second_event_uids[0] },
          { candidate_uid: second_candidate_uid, event_uid: second_event_uids[1] },
        ],
      },
      observations: [],
      open_questions: [],
    },
  });
  return { plan: persistencePlan, second_candidate_uid, second_event_uids };
}

async function seedCandidate(candidateUid: string, events: readonly [string, string], candidateProjectUid = project_uid): Promise<void> {
  await withWrite(async (transaction) => {
    await transaction.run(
      "CREATE (c:ExecutionReviewCandidate) SET c = $properties",
      { properties: { candidate_uid: candidateUid, project_uid: candidateProjectUid, fixture_run_id } },
    );
    for (const [position, event_uid] of events.entries()) {
      await transaction.run(
        "CREATE (e:RawEvent) SET e = $properties",
        { properties: { event_uid, project_uid: candidateProjectUid, fixture_run_id } },
      );
      await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}), (e:RawEvent {event_uid: $event_uid})
         CREATE (c)-[:EVIDENCED_BY {position: $position}]->(e)`,
        { candidate_uid: candidateUid, event_uid, position },
      );
    }
  });
}
async function seed(): Promise<void> {
  await withWrite(async (transaction) => {
    await transaction.run(
      "CREATE (c:ExecutionReviewCandidate) SET c = $properties",
      { properties: { candidate_uid, project_uid, fixture_run_id } },
    );
    for (const [position, event_uid] of event_uids.entries()) {
      await transaction.run(
        "CREATE (e:RawEvent) SET e = $properties",
        { properties: { event_uid, project_uid, fixture_run_id } },
      );
      await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}), (e:RawEvent {event_uid: $event_uid})
         CREATE (c)-[:EVIDENCED_BY {position: $position}]->(e)`,
        { candidate_uid, event_uid, position },
      );
    }
  });
}

async function cleanup(reflection_uids: readonly string[]): Promise<void> {
  await withWrite(async (transaction) => {
    for (const reflection_uid of reflection_uids) {
      await transaction.run("MATCH (r:Reflection {reflection_uid: $reflection_uid}) DETACH DELETE r", { reflection_uid });
    }
    await transaction.run("MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) DETACH DELETE c", { candidate_uid });
    await transaction.run("MATCH (e:RawEvent {event_uid: $event_uid}) DETACH DELETE e", { event_uid: event_uids[0] });
    await transaction.run("MATCH (e:RawEvent {event_uid: $event_uid}) DETACH DELETE e", { event_uid: event_uids[1] });
  });
  const remaining = await withRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (n)
       WHERE (n:Reflection AND n.reflection_uid IN $reflection_uids)
          OR (n:ExecutionReviewCandidate AND n.candidate_uid = $candidate_uid)
          OR (n:RawEvent AND n.event_uid IN $event_uids)
       RETURN count(n) AS count`,
      { reflection_uids, candidate_uid, event_uids },
    );
    return neo4j.integer.toNumber(result.records[0]!.get("count"));
  });
  expect(remaining).toBe(0);
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error("Actual Neo4j configuration is required for Reflection tests.");
  config = loaded.config;
  database = config.database;
  driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  await driver.verifyConnectivity();
});

afterAll(async () => {
  await driver?.close();
});

describe("concrete Neo4j Reflection materialization", () => {
  test("creates exact reflection topology, replays, and aborts a tampered plan before writing", async () => {
    const firstPlan = plan();
    const tamperedPlan = plan("tampered");
    const reflection_uids = [firstPlan.facts.reflection_uid, tamperedPlan.facts.reflection_uid];
    try {
      await seed();
      const first = await withWrite((transaction) => materializeManualReflectionPlan(transaction, firstPlan));
      expect(first).toEqual({ status: "materialized", reflection_uid: firstPlan.facts.reflection_uid, evidence_count: 2 });

      const graph = await withRead(async (transaction) => {
        const node = await transaction.run("MATCH (r:Reflection {reflection_uid: $reflection_uid}) RETURN properties(r) AS properties", { reflection_uid: firstPlan.facts.reflection_uid });
        const target = await transaction.run("MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:REFLECTS_ON]->(c:ExecutionReviewCandidate) RETURN properties(link) AS properties, c.candidate_uid AS candidate_uid", { reflection_uid: firstPlan.facts.reflection_uid });
        const evidence = await transaction.run("MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:EVIDENCED_BY]->(e:RawEvent) RETURN e.event_uid AS event_uid, properties(link) AS properties ORDER BY link.evidence_index", { reflection_uid: firstPlan.facts.reflection_uid });
        return {
          node: node.records[0]!.get("properties") as Record<string, unknown>,
          target: target.records.map((record) => ({ properties: record.get("properties"), candidate_uid: record.get("candidate_uid") })),
          evidence: evidence.records.map((record) => ({ event_uid: record.get("event_uid"), properties: record.get("properties") })),
        };
      });
      expect(Object.keys(graph.node).sort()).toEqual([...Object.keys(firstPlan.facts), "created_at"].sort());
      expect(graph.node).toMatchObject(firstPlan.facts);
      expect(graph.node.created_at).toEqual(expect.any(String));
      expect(graph.node.created_at).not.toBe("");
      expect(graph.target).toEqual([{ properties: { schema_id: "anima.reflection-target/v1.0" }, candidate_uid }]);
      expect(graph.evidence).toEqual([
        { event_uid: event_uids[0], properties: { schema_id: "anima.reflection-evidence/v1.0", subject_path: "overview", evidence_index: 0, candidate_position: 0 } },
        { event_uid: event_uids[1], properties: { schema_id: "anima.reflection-evidence/v1.0", subject_path: "overview", evidence_index: 1, candidate_position: 1 } },
      ]);

      const replay = await withWrite((transaction) => materializeManualReflectionPlan(transaction, firstPlan));
      expect(replay).toEqual({ status: "up_to_date", reflection_uid: firstPlan.facts.reflection_uid, evidence_count: 2 });
      const counts = await withRead(async (transaction) => {
        const result = await transaction.run("MATCH (r:Reflection {reflection_uid: $reflection_uid}) OPTIONAL MATCH (r)-[link]->() RETURN count(DISTINCT r) AS nodes, count(link) AS links", { reflection_uid: firstPlan.facts.reflection_uid });
        return { nodes: neo4j.integer.toNumber(result.records[0]!.get("nodes")), links: neo4j.integer.toNumber(result.records[0]!.get("links")) };
      });
      expect(counts).toEqual({ nodes: 1, links: 3 });

      const tampered = { ...tamperedPlan, evidence_links: tamperedPlan.evidence_links.map((link, index) => index === 0 ? { ...link, candidate_position: 99 } : link) };
      if (driver === undefined || database === undefined) throw new Error("Neo4j reflection fixture is not initialized.");
      const invalidSession = driver.session({ database });
      const invalidTransaction = invalidSession.beginTransaction();
      let tamperedError: unknown;
      try {
        await materializeManualReflectionPlan(invalidTransaction, tampered);
      } catch (error) {
        tamperedError = error;
      } finally {
        await invalidTransaction.rollback();
        await invalidSession.close();
      }
      expect(tamperedError).toBeInstanceOf(ReflectionMaterializationError);
      expect(tamperedError).toMatchObject({ code: "identity_conflict" });
      const absenceSession = driver.session({ database });
      try {
        const absent = await absenceSession.run(
          "MATCH (r:Reflection {reflection_uid: $reflection_uid}) RETURN count(r) AS count",
          { reflection_uid: tamperedPlan.facts.reflection_uid },
        );
        expect(neo4j.integer.toNumber(absent.records[0]!.get("count"))).toBe(0);
      } finally {
        await absenceSession.close();
      }
    } finally {
      await cleanup(reflection_uids);
    }
  }, { timeout: 30_000 });
  test("materializes a daily multi-target plan, replays exact topology, and rejects target and source conflicts atomically", async () => {
    const { plan: dailyPlanValue, second_candidate_uid, second_event_uids } = calendarPlan();
    const wrong_candidate_uid = randomUUID();
    const wrong_event_uids = [randomUUID(), randomUUID()] as const;
    const wrong_project_uid = randomUUID();
    const wrongReflectionUid = randomUUID();
    const reflection_uids = [dailyPlanValue.facts.reflection_uid, wrongReflectionUid];
    try {
      await seed();
      await seedCandidate(second_candidate_uid, second_event_uids);
      await seedCandidate(wrong_candidate_uid, wrong_event_uids, wrong_project_uid);

      const first = await withWrite((transaction) => materializeReflectionPlan(transaction, dailyPlanValue));
      expect(first).toEqual({
        status: "materialized",
        reflection_uid: dailyPlanValue.facts.reflection_uid,
        evidence_count: 4,
      });
      const graph = await withRead(async (transaction) => {
        const targets = await transaction.run(
          `MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:REFLECTS_ON]->(candidate)
           RETURN candidate.candidate_uid AS candidate_uid, properties(link) AS properties`,
          { reflection_uid: dailyPlanValue.facts.reflection_uid },
        );
        const evidence = await transaction.run(
          `MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:EVIDENCED_BY]->(event:RawEvent)
           RETURN event.event_uid AS event_uid, properties(link) AS properties`,
          { reflection_uid: dailyPlanValue.facts.reflection_uid },
        );
        return {
          targets: targets.records.map((record) => ({ candidate_uid: record.get("candidate_uid"), properties: record.get("properties") })),
          evidence: evidence.records.map((record) => ({ event_uid: record.get("event_uid"), properties: record.get("properties") })),
        };
      });
      expect(graph.targets.sort((left, right) => String(left.candidate_uid).localeCompare(String(right.candidate_uid)))).toEqual(
        dailyPlanValue.target_candidate_uids
          .map((candidate_uid) => ({ candidate_uid, properties: { schema_id: "anima.reflection-target/v1.0" } }))
          .sort((left, right) => left.candidate_uid.localeCompare(right.candidate_uid)),
      );
      expect(graph.evidence.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))).toEqual(
        dailyPlanValue.evidence_links
          .map((link) => ({
            event_uid: link.event_uid,
            properties: {
              schema_id: "anima.reflection-evidence/v1.0",
              subject_path: link.subject_path,
              evidence_index: link.evidence_index,
              candidate_position: link.candidate_position,
            },
          }))
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      );

      const replay = await withWrite((transaction) => materializeReflectionPlan(transaction, dailyPlanValue));
      expect(replay).toEqual({
        status: "up_to_date",
        reflection_uid: dailyPlanValue.facts.reflection_uid,
        evidence_count: 4,
      });

      const wrongTargetPlan = {
        ...dailyPlanValue,
        facts: { ...dailyPlanValue.facts, reflection_uid: wrongReflectionUid },
        target_candidate_uids: [...dailyPlanValue.target_candidate_uids, wrong_candidate_uid],
      };
      let wrongTargetError: unknown;
      try {
        await withWrite((transaction) => materializeReflectionPlan(transaction, wrongTargetPlan));
      } catch (error) {
        wrongTargetError = error;
      }
      expect(wrongTargetError).toBeInstanceOf(ReflectionMaterializationError);
      expect(wrongTargetError).toMatchObject({ code: "identity_conflict" });
      const wrongTargetCount = await withRead(async (transaction) => {
        const result = await transaction.run(
          "MATCH (r:Reflection {reflection_uid: $reflection_uid}) RETURN count(r) AS count",
          { reflection_uid: wrongReflectionUid },
        );
        return neo4j.integer.toNumber(result.records[0]!.get("count"));
      });
      expect(wrongTargetCount).toBe(0);

      await withWrite((transaction) => transaction.run(
        `MATCH (r:Reflection {reflection_uid: $reflection_uid}), (candidate:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         CREATE (r)-[:REFLECTS_ON {schema_id: $schema_id}]->(candidate)`,
        {
          reflection_uid: dailyPlanValue.facts.reflection_uid,
          candidate_uid,
          schema_id: "anima.reflection-target/v1.0",
        },
      ).then(() => undefined));
      let extraTargetError: unknown;
      try {
        await withWrite((transaction) => materializeReflectionPlan(transaction, dailyPlanValue));
      } catch (error) {
        extraTargetError = error;
      }
      expect(extraTargetError).toBeInstanceOf(ReflectionMaterializationError);
      expect(extraTargetError).toMatchObject({ code: "identity_conflict" });

      await withWrite(async (transaction) => {
        await transaction.run(
          `MATCH (candidate:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[link:EVIDENCED_BY {position: 0}]->
                 (event:RawEvent {event_uid: $event_uid})
           DELETE link`,
          { candidate_uid, event_uid: event_uids[0] },
        );
        await transaction.run(
          `MATCH (candidate:ExecutionReviewCandidate {candidate_uid: $candidate_uid}),
                (event:RawEvent {event_uid: $event_uid})
           CREATE (candidate)-[:EVIDENCED_BY {position: 0}]->(event)`,
          { candidate_uid: second_candidate_uid, event_uid: event_uids[0] },
        );
      });
      let wrongEvidenceError: unknown;
      try {
        await withWrite((transaction) => materializeReflectionPlan(transaction, dailyPlanValue));
      } catch (error) {
        wrongEvidenceError = error;
      }
      expect(wrongEvidenceError).toBeInstanceOf(ReflectionMaterializationError);
      expect(wrongEvidenceError).toMatchObject({ code: "identity_conflict" });
    } finally {
      await cleanup(reflection_uids);
      await withWrite(async (transaction) => {
        await transaction.run(
          "MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) DETACH DELETE c",
          { candidate_uid: second_candidate_uid },
        );
        await transaction.run(
          "MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}) DETACH DELETE c",
          { candidate_uid: wrong_candidate_uid },
        );
        for (const event_uid of [...second_event_uids, ...wrong_event_uids, event_uids[0]]) {
          await transaction.run("MATCH (e:RawEvent {event_uid: $event_uid}) DETACH DELETE e", { event_uid });
        }
      });
    }
  }, { timeout: 30_000 });
  test("manual compatibility wrapper rejects multi-target and automatic plans before querying", async () => {
    const manualPlan = plan();
    const candidates = [
      {
        ...manualPlan,
        target_candidate_uids: [...manualPlan.target_candidate_uids, randomUUID()],
      },
      calendarPlan().plan,
    ];
    for (const candidate of candidates) {
      let queryCount = 0;
      const transaction = {
        run: async () => {
          queryCount += 1;
          throw new Error("unexpected transaction query");
        },
      };
      let error: unknown;
      try {
        await materializeManualReflectionPlan(transaction, candidate);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ReflectionMaterializationError);
      expect(error).toMatchObject({ code: "identity_conflict" });
      expect(queryCount).toBe(0);
    }
  });
});
