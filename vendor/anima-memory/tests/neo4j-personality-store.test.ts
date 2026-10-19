import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { loadConfig, type ConfigLoadResult, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import {
  buildPersonalityAggregateSnapshot,
  derivePersonalityUids,
  REQUIRED_PERSONALITY_ANCHORS,
} from "../src/personality-projector.ts";
import type { PersonalityAggregateSnapshot, PersonalityInitInput, PersonalityInitResult, TrustedIdentity } from "../src/personality-types.ts";
import { Neo4jPersonalityStore } from "../src/neo4j-personality-store.ts";
import { syntheticConfigPath } from "./dev-config.ts";

const PERSONALITY_CONSTRAINTS = [
  { name: "anima_personality_uid_unique", property: "personality_uid" },
  { name: "anima_personality_principal_uid_unique", property: "principal_uid" },
] as const;
const FIXED_NOW = "2026-09-23T00:00:00.000Z";

let config: Neo4jConfig | undefined;
let driver: neo4j.Driver | undefined;
let store: Neo4jPersonalityStore | undefined;
const cleanupUids: Array<{ personality_uid: string; principal_uid: string }> = [];

function requiredConfig(): Neo4jConfig {
  if (config === undefined) throw new Error("Neo4j personality integration config is unavailable.");
  return config;
}

function requiredDriver(): neo4j.Driver {
  if (driver === undefined) throw new Error("Neo4j personality integration driver is unavailable.");
  return driver;
}

function requiredStore(): Neo4jPersonalityStore {
  if (store === undefined) throw new Error("Neo4j personality store is unavailable.");
  return store;
}

function tenantIdentity(): TrustedIdentity {
  return { principal_uid: randomUUID() };
}

function personalitySnapshot(identity: TrustedIdentity, content = `Synthetic identity ${randomUUID()}`, value = "0.5"): PersonalityAggregateSnapshot {
  return buildPersonalityAggregateSnapshot(identity, {
    rules: [{ rule_type: "identity", name: "synthetic-test", content }],
    anchors: REQUIRED_PERSONALITY_ANCHORS.map(({ name, dimension }) => ({ name, dimension, initial_value: value })),
  }, FIXED_NOW);
}

function initInput(content: string, value = "0.5"): PersonalityInitInput {
  return {
    rules: [{ rule_type: "identity", name: "synthetic-test", content }],
    anchors: REQUIRED_PERSONALITY_ANCHORS.map(({ name, dimension }) => ({ name, dimension, initial_value: value })),
  };
}

async function matchingNodeCount(identity: TrustedIdentity): Promise<number> {
  const uids = derivePersonalityUids(identity);
  return withSession(async (session) => {
    const result = await session.run(
      "MATCH (n) WHERE n.personality_uid = $personality_uid OR n.principal_uid = $principal_uid RETURN n",
      uids,
    );
    return result.records.length;
  });
}

function nodeProperties(snapshot: PersonalityAggregateSnapshot): Record<string, unknown> {
  return {
    personality_uid: snapshot.personality_uid,
    principal_uid: snapshot.principal_uid,
    rules_json: snapshot.rules_json,
    anchors_json: snapshot.anchors_json,
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at,
  };
}

async function withSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  const session = requiredDriver().session({ database: requiredConfig().database });
  try {
    return await work(session);
  } finally {
    await session.close();
    // Bun 1.3.14 releases closed Neo4j sessions to its pool on the next timer turn.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function seedNode(label: "AnimaPersonality" | "SyntheticWrongLabel", properties: Record<string, unknown>): Promise<void> {
  const uids = {
    personality_uid: String(properties.personality_uid),
    principal_uid: String(properties.principal_uid),
  };
  cleanupUids.push(uids);
  await withSession(async (session) => {
    const create = label === "AnimaPersonality"
      ? "CREATE (n:AnimaPersonality) SET n = $properties RETURN n"
      : "CREATE (n:SyntheticWrongLabel) SET n = $properties RETURN n";
    await session.run(create, { properties });
  });
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") throw new Error(`Neo4j personality integration config is ${loaded.kind}.`);
  const testConfig = loaded.config;
  config = testConfig;
  const testDriver = neo4j.driver(testConfig.uri, neo4j.auth.basic(testConfig.username, testConfig.password));
  driver = testDriver;
  await testDriver.verifyConnectivity();
  const injectedConfig: ConfigLoadResult = { kind: "ready", config: testConfig };
  const personalityStore = new Neo4jPersonalityStore({
    loadConfig: async () => injectedConfig,
    driverFactory: (value) => neo4j.driver(value.uri, neo4j.auth.basic(value.username, value.password)),
    clock: () => new Date(FIXED_NOW),
  });
  store = personalityStore;
  const health = await personalityStore.initialize();
  if (health.status !== "connected") throw new Error("Neo4j personality store did not connect to the integration database.");
}, 30_000);

afterAll(async () => {
  if (cleanupUids.length > 0 && config !== undefined && driver !== undefined) {
    await withSession(async (session) => {
      await session.run(
        "MATCH (n) WHERE n.personality_uid IN $personality_uids OR n.principal_uid IN $principal_uids DETACH DELETE n",
        {
          personality_uids: cleanupUids.map(({ personality_uid }) => personality_uid),
          principal_uids: cleanupUids.map(({ principal_uid }) => principal_uid),
        },
      );
    });
  }
  if (store !== undefined) await store.close();
  if (driver !== undefined) await driver.close();
}, 30_000);

describe("Neo4jPersonalityStore actual Neo4j behavior", () => {
  test("creates and verifies both exact uniqueness constraints", async () => {
    const personalityStore = requiredStore();
    const database = requiredConfig().database;
    expect(personalityStore.health()).toMatchObject({ status: "connected", database });
    const metadata = await withSession(async (session) => {
      const result = await session.run(
        "SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties WHERE name IN $names RETURN name, type, entityType, labelsOrTypes, properties",
        { names: PERSONALITY_CONSTRAINTS.map(({ name }) => name) },
      );
      return result.records.map((record) => ({
        name: record.get("name"),
        type: record.get("type"),
        entityType: record.get("entityType"),
        labels: record.get("labelsOrTypes"),
        properties: record.get("properties"),
      }));
    });
    expect(metadata).toHaveLength(2);
    for (const expected of PERSONALITY_CONSTRAINTS) {
      expect(metadata).toContainEqual({
        name: expected.name,
        type: "UNIQUENESS",
        entityType: "NODE",
        labels: ["AnimaPersonality"],
        properties: [expected.property],
      });
    }
  }, { timeout: 30_000 });


  test("initializes one complete seven-anchor persona with exact stored properties", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));

    await expect(personalityStore.initializePersona(identity, initInput("Initialized synthetic persona", "0.35"))).resolves.toEqual({
      action: "init_commit",
      rules: 1,
      anchors: 7,
    });
    await expect(personalityStore.getStatus(identity)).resolves.toEqual({ initialized: true });
    const persona = await personalityStore.readPersona(identity);
    expect(persona.status).toBe("initialized");
    if (persona.status === "initialized") {
      expect(persona.immutable_rules[0]?.content).toBe("Initialized synthetic persona");
      expect(persona.anchors).toHaveLength(7);
      expect(persona.anchors.every(({ current_value }) => current_value === 0.35)).toBe(true);
    }

    const properties = await withSession(async (session) => {
      const uids = derivePersonalityUids(identity);
      const result = await session.run(
        "MATCH (n:AnimaPersonality) WHERE n.personality_uid = $personality_uid RETURN properties(n) AS properties",
        uids,
      );
      return result.records[0]?.get("properties") as Record<string, unknown>;
    });
    expect(Object.keys(properties).sort()).toEqual([
      "anchors_json",
      "created_at",
      "personality_uid",
      "principal_uid",
      "rules_json",
      "updated_at",
    ]);
  }, { timeout: 30_000 });

  test("initializes a persona after the principal has memory graph nodes", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await withSession((session) => session.run(
      "CREATE (:MemorySubject {principal_uid: $principal_uid, domain_uid: $domain_uid})",
      { principal_uid: identity.principal_uid, domain_uid: randomUUID() },
    ));

    await expect(personalityStore.getStatus(identity)).resolves.toEqual({ initialized: false });
    await expect(personalityStore.initializePersona(identity, initInput("Memory owner persona"))).resolves.toEqual({
      action: "init_commit",
      rules: 1,
      anchors: 7,
    });
    await expect(personalityStore.readSnapshot(identity)).resolves.toMatchObject({
      status: "initialized",
      snapshot: { principal_uid: identity.principal_uid },
    });
  }, { timeout: 30_000 });

  test("updates numeric anchors atomically and appends ordered trajectory history", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await personalityStore.initializePersona(identity, initInput("Anchor update fixture", "0.35"));
    const beforeUpdate = await personalityStore.readSnapshot(identity);
    expect(beforeUpdate.status).toBe("initialized");

    const name = REQUIRED_PERSONALITY_ANCHORS[0]!.name;
    await expect(personalityStore.setAnchor(identity, name, 0.6, "First synthetic adjustment")).resolves.toEqual({
      action: "anchor_update",
      name,
      old_value: 0.35,
      new_value: 0.6,
    });
    await expect(personalityStore.setAnchor(identity, name, 0.8, "Second synthetic adjustment")).resolves.toEqual({
      action: "anchor_update",
      name,
      old_value: 0.6,
      new_value: 0.8,
    });
    const afterUpdate = await personalityStore.readSnapshot(identity);
    expect(afterUpdate.status).toBe("initialized");
    if (beforeUpdate.status === "initialized" && afterUpdate.status === "initialized") {
      expect(afterUpdate.snapshot.rules_json).toBe(beforeUpdate.snapshot.rules_json);
    }
    const persona = await personalityStore.readPersona(identity);
    expect(persona.status).toBe("initialized");
    if (persona.status === "initialized") {
      const anchor = persona.anchors.find((item) => item.name === name);
      expect(anchor?.current_value).toBe(0.8);
      expect(anchor?.evolution_trajectory.slice(-2)).toEqual([
        { at: FIXED_NOW, from: 0.35, to: 0.6, reason: "First synthetic adjustment" },
        { at: FIXED_NOW, from: 0.6, to: 0.8, reason: "Second synthetic adjustment" },
      ]);
    }
  }, { timeout: 30_000 });

  test("validates update inputs and distinguishes uninitialized and conflicting identities", async () => {
    const personalityStore = requiredStore();
    const missing = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(missing));
    await expect(personalityStore.setAnchor(missing, REQUIRED_PERSONALITY_ANCHORS[0]!.name, 0.4, "reason"))
      .resolves.toMatchObject({ status: "failed", code: "not_initialized" });

    const identity = tenantIdentity();
    const snapshot = personalitySnapshot(identity);
    await seedNode("AnimaPersonality", {
      ...nodeProperties(snapshot),
      principal_uid: randomUUID(),
    });
    await expect(personalityStore.setAnchor(identity, REQUIRED_PERSONALITY_ANCHORS[0]!.name, 0.4, "reason"))
      .resolves.toMatchObject({ status: "failed", code: "identity_conflict" });

    const validIdentity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(validIdentity));
    await personalityStore.initializePersona(validIdentity, initInput("Input validation fixture"));
    const name = REQUIRED_PERSONALITY_ANCHORS[0]!.name;
    for (const [value, reason] of [
      [1.1, "reason"],
      [Number.NaN, "reason"],
      [0.4, "   "],
    ] as const) {
      await expect(personalityStore.setAnchor(validIdentity, name, value, reason))
        .resolves.toMatchObject({ status: "failed", code: "invalid_input" });
    }
    await expect(personalityStore.setAnchor({ ...validIdentity, legacy: true } as never, name, 0.4, "reason"))
      .resolves.toMatchObject({ status: "failed", code: "invalid_input" });
    const before = await personalityStore.readSnapshot(validIdentity);
    expect(before.status).toBe("initialized");
    if (before.status === "initialized") {
      const anchor = before.snapshot.anchors.find((item) => item.name === name);
      expect(anchor?.evolution_trajectory).toEqual([
        { at: FIXED_NOW, from: null, to: 0.5, reason: "init" },
      ]);
    }
  }, { timeout: 30_000 });

  test("rejects immutable and qualitative anchors without mutating the aggregate", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    const baseInput: PersonalityInitInput = initInput("Special anchor fixture");
    const input: PersonalityInitInput = {
      ...baseInput,
      anchors: [
        ...baseInput.anchors,
        { name: "synthetic-immutable", dimension: "test", value_type: "immutable", initial_value: "fixed" },
        { name: "synthetic-qualitative", dimension: "test", value_type: "qualitative", initial_value: "steady" },
      ],
    };
    await personalityStore.initializePersona(identity, input);
    for (const [name, code] of [
      ["synthetic-immutable", "immutable_anchor"],
      ["synthetic-qualitative", "invalid_input"],
      ["missing-anchor", "anchor_not_found"],
    ] as const) {
      await expect(personalityStore.setAnchor(identity, name, 0.4, "synthetic attempt"))
        .resolves.toMatchObject({ status: "failed", code });
    }
    const snapshot = await personalityStore.readSnapshot(identity);
    expect(snapshot.status).toBe("initialized");
    if (snapshot.status === "initialized") {
      expect(snapshot.snapshot.anchors.find(({ name }) => name === "synthetic-immutable")?.evolution_trajectory)
        .toEqual([{ at: FIXED_NOW, from: null, to: "fixed", reason: "init" }]);
      expect(snapshot.snapshot.anchors.find(({ name }) => name === "synthetic-qualitative")?.evolution_trajectory)
        .toEqual([{ at: FIXED_NOW, from: null, to: "steady", reason: "init" }]);
    }
  }, { timeout: 30_000 });

  test("serializes concurrent anchor updates and retains both trajectory records", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await personalityStore.initializePersona(identity, initInput("Concurrent anchor fixture", "0.2"));
    const name = REQUIRED_PERSONALITY_ANCHORS[0]!.name;
    const results = await Promise.all([
      personalityStore.setAnchor(identity, name, 0.4, "Concurrent update A"),
      personalityStore.setAnchor(identity, name, 0.7, "Concurrent update B"),
    ]);
    expect(results.every((result) => "action" in result)).toBe(true);
    const persona = await personalityStore.readPersona(identity);
    expect(persona.status).toBe("initialized");
    if (persona.status === "initialized") {
      const anchor = persona.anchors.find((item) => item.name === name);
      expect(anchor?.evolution_trajectory).toHaveLength(3);
      expect(anchor?.evolution_trajectory[0]).toEqual({ at: FIXED_NOW, from: null, to: 0.2, reason: "init" });
      expect(anchor?.evolution_trajectory.slice(1).map(({ reason, to }) => [reason, to]).sort())
        .toEqual([["Concurrent update A", 0.4], ["Concurrent update B", 0.7]]);
      expect(anchor?.evolution_trajectory[1]?.from).toBe(0.2);
      expect(anchor?.evolution_trajectory[2]?.from).toBe(anchor?.evolution_trajectory[1]?.to);
    }
  }, { timeout: 30_000 });


  test("timestamps updates after lock acquisition when transactions commit out of admission order", async () => {
    let firstUpdateStarted!: () => void;
    let releaseFirstUpdate!: () => void;
    const firstUpdateWait = new Promise<void>((resolve) => {
      firstUpdateStarted = resolve;
    });
    const releaseFirstWait = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let executeWriteCalls = 0;
    let clockTicks = 0;
    const orderedStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: (value) => {
        const actualDriver = neo4j.driver(value.uri, neo4j.auth.basic(value.username, value.password));
        return {
          verifyConnectivity: () => actualDriver.verifyConnectivity(),
          session: (options: { database?: string }) => {
            const session = actualDriver.session(options);
            return {
              run: session.run.bind(session),
              executeRead: session.executeRead.bind(session),
              executeWrite: async <T>(work: (tx: neo4j.ManagedTransaction) => Promise<T>) => {
                executeWriteCalls += 1;
                if (executeWriteCalls === 2) {
                  firstUpdateStarted();
                  await releaseFirstWait;
                }
                const result = await session.executeWrite(work);
                if (executeWriteCalls === 3) releaseFirstUpdate();
                return result;
              },
              close: session.close.bind(session),
            };
          },
          close: () => actualDriver.close(),
        } as unknown as neo4j.Driver;
      },
      clock: () => new Date(Date.parse(FIXED_NOW) + clockTicks++ * 1_000),
    });
    await expect(orderedStore.initialize()).resolves.toMatchObject({ status: "connected" });
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await orderedStore.initializePersona(identity, initInput("Reverse commit fixture", "0.2"));

    const name = REQUIRED_PERSONALITY_ANCHORS[0]!.name;
    const first = orderedStore.setAnchor(identity, name, 0.4, "Admitted first");
    await firstUpdateWait;
    const second = orderedStore.setAnchor(identity, name, 0.7, "Committed first");
    await expect(second).resolves.toMatchObject({ action: "anchor_update", new_value: 0.7 });
    releaseFirstUpdate();
    await expect(first).resolves.toMatchObject({ action: "anchor_update", new_value: 0.4 });

    const persona = await orderedStore.readPersona(identity);
    expect(persona.status).toBe("initialized");
    if (persona.status === "initialized") {
      const anchor = persona.anchors.find((item) => item.name === name);
      expect(anchor?.evolution_trajectory.map(({ reason, from, to }) => [reason, from, to])).toEqual([
        ["init", null, 0.2],
        ["Committed first", 0.2, 0.7],
        ["Admitted first", 0.7, 0.4],
      ]);
    }
    await orderedStore.close();
  }, { timeout: 30_000 });
  test("maps an ambiguous anchor write to write_outcome_unknown without retrying", async () => {
    const constraintRecords = PERSONALITY_CONSTRAINTS.map(({ name, property }) => {
      const values: Record<string, unknown> = {
        name,
        type: "UNIQUENESS",
        entityType: "NODE",
        labelsOrTypes: ["AnimaPersonality"],
        properties: [property],
      };
      return { get: (key: string) => values[key] };
    });
    const transactionQueries: string[] = [];
    const identity = tenantIdentity();
    const snapshot = personalitySnapshot(identity);
    let writes = 0;
    const transaction = {
      run: async (query: string) => {
        transactionQueries.push(query);
        if (query.includes("RETURN labels(n)")) {
          return { records: [{
            get: (key: string) => key === "labels" ? ["AnimaPersonality"] : nodeProperties(snapshot),
          }] };
        }
        if (query.includes("SET n.anchors_json")) {
          writes += 1;
          throw Object.assign(new Error("synthetic lost response"), { code: "Neo.TransientError.General.DatabaseUnavailable" });
        }
        return { records: [] };
      },
    };
    const fakeDriver = {
      verifyConnectivity: async () => undefined,
      session: () => ({
        run: async (query: string) => ({ records: query === "SHOW CONSTRAINTS" ? constraintRecords : [] }),
        executeWrite: async <T>(work: (tx: typeof transaction) => Promise<T>) => work(transaction),
        close: async () => undefined,
      }),
      close: async () => undefined,
    } as unknown as neo4j.Driver;
    const uncertainStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: () => fakeDriver,
      clock: () => new Date(FIXED_NOW),
    });
    await expect(uncertainStore.initialize()).resolves.toMatchObject({ status: "connected" });
    await expect(uncertainStore.setAnchor(identity, REQUIRED_PERSONALITY_ANCHORS[0]!.name, 0.4, "synthetic write"))
      .resolves.toMatchObject({ status: "failed", code: "write_outcome_unknown" });
    expect(writes).toBe(1);
    expect(transactionQueries[0]).toContain("SET n.personality_uid = n.personality_uid");
    await uncertainStore.close();
  });

  test("preserves a known committed anchor update when close starts before executeWrite returns", async () => {
    let closeRaceStore: Neo4jPersonalityStore | undefined;
    const raceStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: (value) => {
        const actualDriver = neo4j.driver(value.uri, neo4j.auth.basic(value.username, value.password));
        return {
          verifyConnectivity: () => actualDriver.verifyConnectivity(),
          session: (options: { database?: string }) => {
            const session = actualDriver.session(options);
            return {
              run: session.run.bind(session),
              executeRead: session.executeRead.bind(session),
              executeWrite: async <T>(work: (tx: neo4j.ManagedTransaction) => Promise<T>) => {
                const result = await session.executeWrite(work);
                if (result !== undefined && typeof result === "object" && result !== null && "action" in result &&
                  result.action === "anchor_update") void closeRaceStore?.close();
                return result;
              },
              close: session.close.bind(session),
            };
          },
          close: () => actualDriver.close(),
        } as unknown as neo4j.Driver;
      },
      clock: () => new Date(FIXED_NOW),
    });
    closeRaceStore = raceStore;
    await expect(raceStore.initialize()).resolves.toMatchObject({ status: "connected" });
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await raceStore.initializePersona(identity, initInput("Known committed update fixture"));
    await expect(raceStore.setAnchor(identity, REQUIRED_PERSONALITY_ANCHORS[0]!.name, 0.4, "known commit"))
      .resolves.toMatchObject({ action: "anchor_update", new_value: 0.4 });
    await raceStore.close();
    expect(raceStore.health()).toMatchObject({ status: "closed" });
  }, { timeout: 30_000 });

  test("rejects invalid identity, missing axes, null values, out-of-range numbers, and invalid clock before writing", async () => {
    const personalityStore = requiredStore();
    const fullInput = initInput("Missing axis");
    const missingAxis = { ...fullInput, anchors: fullInput.anchors.slice(0, -1) };
    const invalidNumber = initInput("Invalid numeric value");
    invalidNumber.anchors.find(({ name }) => name === REQUIRED_PERSONALITY_ANCHORS[0].name)!.initial_value = "1.5";
    const nullAxis = initInput("Null anchor value");
    nullAxis.anchors[0]!.initial_value = null as unknown as string;
    const inputs: Array<{ identity: TrustedIdentity; input: unknown }> = [
      { identity: tenantIdentity(), input: missingAxis },
      { identity: tenantIdentity(), input: null },
      { identity: tenantIdentity(), input: invalidNumber },
      { identity: tenantIdentity(), input: nullAxis },
    ];
    const invalidIdentity = { ...tenantIdentity(), principal_uid: "not-a-uuid" };
    await expect(personalityStore.initializePersona(invalidIdentity, initInput("Invalid identity"))).resolves.toMatchObject({
      status: "failed",
      code: "invalid_input",
    });

    for (const { identity, input } of inputs) {
      cleanupUids.push(derivePersonalityUids(identity));
      await expect(personalityStore.initializePersona(identity, input)).resolves.toMatchObject({
        status: "failed",
        code: "invalid_input",
      });
      await expect(matchingNodeCount(identity)).resolves.toBe(0);
    }

    const invalidClockStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: (value) => neo4j.driver(value.uri, neo4j.auth.basic(value.username, value.password)),
      clock: () => new Date(Number.NaN),
    });
    await expect(invalidClockStore.initialize()).resolves.toMatchObject({ status: "connected" });
    const clockIdentity = tenantIdentity();
    await expect(invalidClockStore.initializePersona(clockIdentity, initInput("Invalid clock"))).resolves.toMatchObject({
      status: "failed",
      code: "invalid_input",
    });
    await expect(matchingNodeCount(clockIdentity)).resolves.toBe(0);
    await invalidClockStore.close();
  }, { timeout: 30_000 });

  test("duplicate initialization preserves the original persona", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await expect(personalityStore.initializePersona(identity, initInput("Original persona", "0.2"))).resolves.toMatchObject({
      action: "init_commit",
    });
    const before = await personalityStore.readSnapshot(identity);

    await expect(personalityStore.initializePersona(identity, initInput("Replacement persona", "0.9"))).resolves.toMatchObject({
      status: "failed",
      code: "already_initialized",
    });
    await expect(personalityStore.readSnapshot(identity)).resolves.toEqual(before);
  }, { timeout: 30_000 });

  test("concurrent first initialization creates at most one node", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    const results = await Promise.all([
      personalityStore.initializePersona(identity, initInput("Concurrent first")),
      personalityStore.initializePersona(identity, initInput("Concurrent second")),
    ]);
    expect(results.filter((result) => "action" in result)).toHaveLength(1);
    expect(results.filter((result) => "status" in result && result.code === "already_initialized")).toHaveLength(1);
    await expect(matchingNodeCount(identity)).resolves.toBe(1);
  }, { timeout: 30_000 });

  test("keeps a principal's persona stable across development-key rotation", async () => {
    const personalityStore = requiredStore();
    const beforeRotation = tenantIdentity();
    const afterRotation: TrustedIdentity = { ...beforeRotation };
    cleanupUids.push(derivePersonalityUids(beforeRotation));
    await expect(personalityStore.initializePersona(beforeRotation, initInput("Original principal persona"))).resolves.toMatchObject({
      action: "init_commit",
    });
    expect(derivePersonalityUids(afterRotation)).toEqual(derivePersonalityUids(beforeRotation));
    await expect(personalityStore.initializePersona(afterRotation, initInput("Rotated-key persona"))).resolves.toMatchObject({
      status: "failed",
      code: "already_initialized",
    });
    await expect(personalityStore.readPersona(beforeRotation)).resolves.toMatchObject({
      status: "initialized",
      immutable_rules: [expect.objectContaining({ content: "Original principal persona" })],
    });
  }, { timeout: 30_000 });

  test("isolates personas for distinct principals", async () => {
    const personalityStore = requiredStore();
    const first = tenantIdentity();
    const second = tenantIdentity();
    const firstSnapshot = personalitySnapshot(first, "Synthetic first principal", "0.2");
    const secondSnapshot = personalitySnapshot(second, "Synthetic second principal", "0.8");
    await seedNode("AnimaPersonality", nodeProperties(firstSnapshot));
    await seedNode("AnimaPersonality", nodeProperties(secondSnapshot));

    const firstRead = await personalityStore.readPersona(first);
    const secondRead = await personalityStore.readPersona(second);
    expect(firstRead.status).toBe("initialized");
    expect(secondRead.status).toBe("initialized");
    if (firstRead.status === "initialized" && secondRead.status === "initialized") {
      expect(firstRead.immutable_rules[0]?.content).toBe("Synthetic first principal");
      expect(secondRead.immutable_rules[0]?.content).toBe("Synthetic second principal");
      expect(firstRead.anchors[0]?.current_value).not.toBe(secondRead.anchors[0]?.current_value);
    }
  }, { timeout: 30_000 });

  test("rejects initialization when only one UID is bound to a stored node", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    const snapshot = personalitySnapshot(identity, "Partial UID conflict");
    await seedNode("AnimaPersonality", {
      ...nodeProperties(snapshot),
      principal_uid: randomUUID(),
    });
    await expect(personalityStore.initializePersona(identity, initInput("Must not overwrite"))).resolves.toMatchObject({
      status: "failed",
      code: "identity_conflict",
    });
    await expect(matchingNodeCount(identity)).resolves.toBe(1);
  }, { timeout: 30_000 });

  test("returns uninitialized for missing identity and serves a validated persona", async () => {
    const personalityStore = requiredStore();
    const missing = tenantIdentity();
    await expect(personalityStore.getStatus(missing)).resolves.toEqual({ initialized: false });
    await expect(personalityStore.readPersona(missing)).resolves.toEqual({ status: "uninitialized" });

    const identity = tenantIdentity();
    const snapshot = personalitySnapshot(identity, "Synthetic test persona");
    await seedNode("AnimaPersonality", nodeProperties(snapshot));
    await expect(personalityStore.getStatus(identity)).resolves.toEqual({ initialized: true });
    const persona = await personalityStore.readPersona(identity);
    expect(persona.status).toBe("initialized");
    if (persona.status === "initialized") {
      expect(persona.immutable_rules[0]?.content).toBe("Synthetic test persona");
      expect(persona.anchors).toHaveLength(REQUIRED_PERSONALITY_ANCHORS.length);
    }
    await expect(personalityStore.readSnapshot(identity)).resolves.toEqual({ status: "initialized", snapshot });
  }, { timeout: 30_000 });

  test("returns identity_conflict for a matching UID on a wrong label or with only one matching UID", async () => {
    const personalityStore = requiredStore();
    const wrongLabelIdentity = tenantIdentity();
    const wrongLabelSnapshot = personalitySnapshot(wrongLabelIdentity);
    await seedNode("SyntheticWrongLabel", nodeProperties(wrongLabelSnapshot));
    await expect(personalityStore.getStatus(wrongLabelIdentity)).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });

    const partialIdentity = tenantIdentity();
    const partialSnapshot = personalitySnapshot(partialIdentity);
    await seedNode("AnimaPersonality", {
      ...nodeProperties(partialSnapshot),
      principal_uid: randomUUID(),
    });
    await expect(personalityStore.readPersona(partialIdentity)).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    const principalOnlyIdentity = tenantIdentity();
    const principalOnlySnapshot = personalitySnapshot(principalOnlyIdentity);
    await seedNode("AnimaPersonality", {
      ...nodeProperties(principalOnlySnapshot),
      personality_uid: randomUUID(),
    });
    await expect(personalityStore.getStatus(principalOnlyIdentity)).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("returns identity_conflict when persisted canonical JSON is malformed", async () => {
    const personalityStore = requiredStore();
    const identity = tenantIdentity();
    const snapshot = personalitySnapshot(identity);
    await seedNode("AnimaPersonality", { ...nodeProperties(snapshot), rules_json: "[" });
    await expect(personalityStore.getStatus(identity)).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    await expect(personalityStore.readPersona(identity)).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("maps a lost write response to write_outcome_unknown without reissuing CREATE", async () => {
    const constraintRecords = PERSONALITY_CONSTRAINTS.map(({ name, property }) => {
      const values: Record<string, unknown> = {
        name,
        type: "UNIQUENESS",
        entityType: "NODE",
        labelsOrTypes: ["AnimaPersonality"],
        properties: [property],
      };
      return { get: (key: string) => values[key] };
    });
    let createAttempts = 0;
    let callbackAttempts = 0;
    let executeWriteCalls = 0;
    const transaction = {
      run: async (query: string) => {
        if (query.startsWith("MATCH (n)")) return { records: [] };
        createAttempts += 1;
        throw Object.assign(new Error("synthetic lost write response"), {
          code: "Neo.TransientError.General.DatabaseUnavailable",
        });
      },
    };
    const fakeDriver = {
      verifyConnectivity: async () => undefined,
      session: () => ({
        run: async (query: string) => ({ records: query === "SHOW CONSTRAINTS" ? constraintRecords : [] }),
        executeWrite: async <T>(work: (tx: typeof transaction) => Promise<T>) => {
          executeWriteCalls += 1;
          callbackAttempts += 1;
          try {
            return await work(transaction);
          } catch {
            callbackAttempts += 1;
            return await work(transaction);
          }
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    } as unknown as neo4j.Driver;
    const uncertainStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: () => fakeDriver,
      clock: () => new Date(FIXED_NOW),
    });
    await expect(uncertainStore.initialize()).resolves.toMatchObject({ status: "connected" });
    const identity = tenantIdentity();
    const result: PersonalityInitResult = await uncertainStore.initializePersona(identity, initInput("Ambiguous synthetic write"));
    expect(result).toMatchObject({ status: "failed", code: "write_outcome_unknown" });
    expect({ executeWriteCalls, callbackAttempts, createAttempts }).toEqual({
      executeWriteCalls: 1,
      callbackAttempts: 2,
      createAttempts: 1,
    });
    await uncertainStore.close();
  });

  test("preserves a known committed init when close starts before executeWrite returns", async () => {
    let closeRaceStore: Neo4jPersonalityStore | undefined;
    const raceStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: (value) => {
        const actualDriver = neo4j.driver(value.uri, neo4j.auth.basic(value.username, value.password));
        return {
          verifyConnectivity: () => actualDriver.verifyConnectivity(),
          session: (options: { database?: string }) => {
            const session = actualDriver.session(options);
            return {
              run: session.run.bind(session),
              executeRead: session.executeRead.bind(session),
              executeWrite: async <T>(work: (tx: neo4j.ManagedTransaction) => Promise<T>) => {
                const result = await session.executeWrite(work);
                void closeRaceStore?.close();
                return result;
              },
              close: session.close.bind(session),
            };
          },
          close: () => actualDriver.close(),
        } as unknown as neo4j.Driver;
      },
      clock: () => new Date(FIXED_NOW),
    });
    closeRaceStore = raceStore;
    await expect(raceStore.initialize()).resolves.toMatchObject({ status: "connected" });
    const identity = tenantIdentity();
    cleanupUids.push(derivePersonalityUids(identity));
    await expect(raceStore.initializePersona(identity, initInput("Known committed init"))).resolves.toEqual({
      action: "init_commit",
      rules: 1,
      anchors: 7,
    });
    await raceStore.close();
    expect(raceStore.health()).toMatchObject({ status: "closed" });
  }, { timeout: 30_000 });

  test("maps failed connectivity to degraded health and database_error", async () => {
    const downStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: () => ({
        verifyConnectivity: async () => { throw new Error("synthetic outage"); },
        close: async () => undefined,
      } as unknown as neo4j.Driver),
    });
    await expect(downStore.initialize()).resolves.toMatchObject({ status: "degraded" });
    await expect(downStore.initializePersona(tenantIdentity(), initInput("Degraded path"))).resolves.toMatchObject({
      status: "failed",
      code: "database_error",
    });
    await expect(downStore.getStatus(tenantIdentity())).resolves.toMatchObject({ status: "failed", code: "database_error" });
    await downStore.close();
  }, { timeout: 30_000 });

  test("closes idempotently and rejects subsequent reads", async () => {
    const closedStore = new Neo4jPersonalityStore({
      loadConfig: async () => ({ kind: "ready", config: requiredConfig() }),
      driverFactory: (value) => neo4j.driver(value.uri, neo4j.auth.basic(value.username, value.password)),
    });
    await expect(closedStore.initialize()).resolves.toMatchObject({ status: "connected" });
    await Promise.all([closedStore.close(), closedStore.close()]);
    expect(closedStore.health()).toEqual({ status: "closed", database: null, constraints: [] });
    await expect(closedStore.initializePersona(tenantIdentity(), initInput("Closed path"))).resolves.toMatchObject({
      status: "failed",
      code: "core_closed",
    });
    await expect(closedStore.readSnapshot(tenantIdentity())).resolves.toMatchObject({ status: "failed", code: "core_closed" });
  }, { timeout: 30_000 });
});
