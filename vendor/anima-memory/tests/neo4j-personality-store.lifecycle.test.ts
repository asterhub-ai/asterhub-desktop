import { describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import type { ConfigLoadResult, Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { REQUIRED_PERSONALITY_ANCHORS } from "../src/personality-projector.ts";
import type { TrustedIdentity } from "../src/personality-types.ts";
import { Neo4jPersonalityStore } from "../src/neo4j-personality-store.ts";

const config: Neo4jConfig = {
  uri: "neo4j://synthetic-personality-test",
  username: "synthetic-user",
  password: "synthetic-password",
  database: "neo4j",
};
const constraints = [
  { name: "anima_personality_uid_unique", labelsOrTypes: ["AnimaPersonality"], properties: ["personality_uid"] },
  { name: "anima_personality_principal_uid_unique", labelsOrTypes: ["AnimaPersonality"], properties: ["principal_uid"] },
] as const;
const identity: TrustedIdentity = { principal_uid: randomUUID() };
const initInput = {
  rules: [{ rule_type: "identity" as const, name: "synthetic", content: "Lifecycle test persona." }],
  anchors: REQUIRED_PERSONALITY_ANCHORS.map(({ name, dimension }) => ({ name, dimension, initial_value: "0.5" })),
};

interface QueryRecord {
  get(key: string): unknown;
}
interface QueryResult {
  records: QueryRecord[];
}
interface Transaction {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
}
interface Session extends Transaction {
  executeRead?<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  executeWrite<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
interface Driver {
  verifyConnectivity(): Promise<void>;
  session(options?: { database?: string }): Session;
  close(): Promise<void>;
}
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}
interface FakeDriverOptions {
  schemaRecords?: QueryRecord[];
  showFailure?: boolean;
  showGate?: Deferred<void>;
  operationGate?: Deferred<void>;
  writeGate?: Deferred<void>;
  writeFailure?: unknown;
  driverCloseGate?: Deferred<void>;
}
interface FakeDriverHarness {
  driver: Driver;
  schemaQueries: string[];
  operationQueries: string[];
  closedAtOperationQueries: string[];
  showStarted: Promise<void>;
  operationStarted: Promise<void>;
  writeStarted: Promise<void>;
  closeStarted: Promise<void>;
  readonly closeCalls: number;
  readonly verifyCalls: number;
  readonly sessionCalls: number;
}


function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function record(fields: Record<string, unknown>): QueryRecord {
  return {
    get(key: string): unknown {
      if (!(key in fields)) throw new Error(`Missing fake record field: ${key}`);
      return fields[key];
    },
  };
}

function schemaRecords(): QueryRecord[] {
  return constraints.map(({ name, labelsOrTypes, properties }) => record({
    name,
    type: "UNIQUENESS",
    entityType: "NODE",
    labelsOrTypes,
    properties,
  }));
}

function fakeDriver(options: FakeDriverOptions = {}): FakeDriverHarness {
  const schemaQueries: string[] = [];
  const operationQueries: string[] = [];
  const closedAtOperationQueries: string[] = [];
  const showStarted = deferred<void>();
  const operationStarted = deferred<void>();
  const writeStarted = deferred<void>();
  const closeStarted = deferred<void>();
  let startupSessionCreated = false;
  let closeCalls = 0;
  let verifyCalls = 0;
  let personalityProperties: Record<string, unknown> | undefined;
  let sessionCalls = 0;
  let driverClosed = false;
  const driver: Driver = {
    async verifyConnectivity() {
      verifyCalls += 1;
    },
    session(): Session {
      sessionCalls += 1;
      const startupSession = !startupSessionCreated;
      startupSessionCreated = true;
      const runOperation = async (query: string, parameters?: Record<string, unknown>): Promise<QueryResult> => {
        operationQueries.push(query);
        if (driverClosed) closedAtOperationQueries.push(query);
        operationStarted.resolve(undefined);
        if (query.includes("RETURN labels(n) AS labels, properties(n) AS properties")) {
          return {
            records: personalityProperties === undefined
              ? []
              : [record({ labels: ["AnimaPersonality"], properties: personalityProperties })],
          };
        }
        if (query.startsWith("CREATE (n:AnimaPersonality)")) {
          writeStarted.resolve(undefined);
          if (options.writeGate !== undefined) await options.writeGate.promise;
          if (options.writeFailure !== undefined) throw options.writeFailure;
          personalityProperties = { ...(parameters?.properties as Record<string, unknown>) };
        }
        if (query.includes("SET n.anchors_json = $anchors_json")) {
          if (personalityProperties !== undefined) {
            personalityProperties.anchors_json = parameters?.anchors_json;
            personalityProperties.updated_at = parameters?.updated_at;
          }
        }
        if (options.operationGate !== undefined) await options.operationGate.promise;
        return { records: [] };
      };
      const session: Session = {
        async run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult> {
          if (!startupSession) return runOperation(query, parameters);
          schemaQueries.push(query);
          if (query !== "SHOW CONSTRAINTS") {
            throw new Error("Synthetic database denies schema writes.");
          }
          showStarted.resolve(undefined);
          if (options.showGate !== undefined) await options.showGate.promise;
          if (options.showFailure === true) throw new Error("Synthetic SHOW denied.");
          return { records: options.schemaRecords ?? schemaRecords() };
        },
        async executeRead<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
          return work({ run: runOperation });
        },
        async executeWrite<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
          return work({ run: runOperation });
        },
        async close() {},
      };
      return session;
    },
    async close() {
      closeCalls += 1;
      driverClosed = true;
      closeStarted.resolve(undefined);
      if (options.driverCloseGate !== undefined) await options.driverCloseGate.promise;
    },
  };
  return {
    driver,
    schemaQueries,
    operationQueries,
    closedAtOperationQueries,
    showStarted: showStarted.promise,
    operationStarted: operationStarted.promise,
    writeStarted: writeStarted.promise,
    closeStarted: closeStarted.promise,
    get closeCalls() { return closeCalls; },
    get verifyCalls() { return verifyCalls; },
    get sessionCalls() { return sessionCalls; },
  };
}

function storeWith(
  fake: FakeDriverHarness,
  options: {
    loadConfig?: (configPath?: string) => Promise<ConfigLoadResult>;
    driverFactory?: (loadedConfig: Neo4jConfig) => Driver;
    authorizeBeforeWrite?: (principal_uid: string) => Promise<boolean>;
  } = {},
): Neo4jPersonalityStore {
  return new Neo4jPersonalityStore({
    loadConfig: options.loadConfig ?? (async (): Promise<ConfigLoadResult> => ({ kind: "ready", config })),
    driverFactory: (loadedConfig) => (options.driverFactory?.(loadedConfig) ?? fake.driver) as never,
    authorizeBeforeWrite: options.authorizeBeforeWrite,
  });
}

const unavailable = {
  status: "failed",
  code: "database_error",
  message: "Neo4j personality operation failed.",
} as const;
const closed = {
  status: "failed",
  code: "core_closed",
  message: "Personality store is closed.",
} as const;

async function expectOperationsRejected(
  store: Neo4jPersonalityStore,
  operationQueries: string[],
  expected: typeof unavailable | typeof closed,
): Promise<void> {
  await expect(store.getStatus(identity)).resolves.toEqual(expected);
  await expect(store.readPersona(identity)).resolves.toEqual(expected);
  await expect(store.readSnapshot(identity)).resolves.toEqual(expected);
  await expect(store.initializePersona(identity, initInput)).resolves.toEqual(expected);
  const anchor = REQUIRED_PERSONALITY_ANCHORS[0]!;
  await expect(store.setAnchor(identity, anchor.name, 0.6, "Lifecycle check")).resolves.toEqual(expected);
  expect(operationQueries).toEqual([]);
}

type MetadataField = "name" | "type" | "entityType" | "labelsOrTypes" | "properties";

function wrongMetadataRecords(index: number, field: MetadataField): QueryRecord[] {
  const records = schemaRecords();
  const definition = constraints[index]!;
  const wrongValue: Record<MetadataField, unknown> = {
    name: `${definition.name}-wrong`,
    type: "RANGE",
    entityType: "RELATIONSHIP",
    labelsOrTypes: ["WrongLabel"],
    properties: ["wrong_property"],
  };
  const expected = {
    name: definition.name,
    type: "UNIQUENESS",
    entityType: "NODE",
    labelsOrTypes: definition.labelsOrTypes,
    properties: definition.properties,
  };
  records[index] = record({ ...expected, [field]: wrongValue[field] });
  return records;
}

describe("Neo4jPersonalityStore startup lifecycle", () => {
  test("rechecks authorization before creating a persona and permits a later authorized retry", async () => {
    const authorizationGate = deferred<void>();
    const authorizationStarted = deferred<void>();
    let authorized = true;
    let authorizationCalls = 0;
    const fake = fakeDriver();
    const store = storeWith(fake, {
      authorizeBeforeWrite: async (principal_uid) => {
        expect(principal_uid).toBe(identity.principal_uid);
        authorizationCalls += 1;
        if (authorizationCalls === 1) {
          authorizationStarted.resolve(undefined);
          await authorizationGate.promise;
        }
        return authorized;
      },
    });
    await store.initialize();

    const initialization = store.initializePersona(identity, initInput);
    await authorizationStarted.promise;
    authorized = false;
    authorizationGate.resolve(undefined);
    await expect(initialization).resolves.toEqual({
      status: "failed",
      code: "unauthorized",
      message: "Personality access is unauthorized.",
    });
    expect(fake.operationQueries.some((query) => query.startsWith("CREATE (n:AnimaPersonality)"))).toBe(false);

    authorized = true;
    expect(await store.initializePersona(identity, initInput)).toMatchObject({ action: "init_commit" });
    expect(authorizationCalls).toBe(2);
    expect(fake.operationQueries.filter((query) => query.startsWith("CREATE (n:AnimaPersonality)"))).toHaveLength(1);
    await store.close();
  });

  test("rechecks authorization before changing anchors and leaves the projected state unchanged when revoked", async () => {
    const authorizationGate = deferred<void>();
    const authorizationStarted = deferred<void>();
    let authorized = true;
    let authorizationCalls = 0;
    const fake = fakeDriver();
    const store = storeWith(fake, {
      authorizeBeforeWrite: async (principal_uid) => {
        expect(principal_uid).toBe(identity.principal_uid);
        authorizationCalls += 1;
        if (authorizationCalls === 2) {
          authorizationStarted.resolve(undefined);
          await authorizationGate.promise;
        }
        return authorized;
      },
    });
    await store.initialize();
    await store.initializePersona(identity, initInput);
    const before = await store.readSnapshot(identity);
    expect(before.status).toBe("initialized");

    const name = REQUIRED_PERSONALITY_ANCHORS[0]!.name;
    const update = store.setAnchor(identity, name, 0.8, "revocation during admission");
    await authorizationStarted.promise;
    authorized = false;
    authorizationGate.resolve(undefined);
    await expect(update).resolves.toEqual({
      status: "failed",
      code: "unauthorized",
      message: "Personality access is unauthorized.",
    });
    expect(fake.operationQueries.some((query) => query.includes("SET n.anchors_json = $anchors_json"))).toBe(false);
    const afterDenied = await store.readSnapshot(identity);
    expect(afterDenied).toEqual(before);

    authorized = true;
    await expect(store.setAnchor(identity, name, 0.8, "authorized retry")).resolves.toMatchObject({
      action: "anchor_update",
      new_value: 0.8,
    });
    expect(fake.operationQueries.filter((query) => query.includes("SET n.anchors_json = $anchors_json"))).toHaveLength(1);
    await store.close();
  });

  test("authorization callback failures are reported without exposing callback details", async () => {
    expect(() => new Neo4jPersonalityStore({ authorizeBeforeWrite: 1 as never })).toThrow(TypeError);
    const fake = fakeDriver();
    const store = storeWith(fake, {
      authorizeBeforeWrite: async () => {
        throw new Error("credential=synthetic-secret");
      },
    });
    await store.initialize();
    await expect(store.initializePersona(identity, initInput)).resolves.toEqual({
      status: "failed",
      code: "unauthorized",
      message: "Personality access is unauthorized.",
    });
    expect(JSON.stringify(fake.operationQueries)).not.toContain("synthetic-secret");
    expect(fake.operationQueries.some((query) => query.startsWith("CREATE (n:AnimaPersonality)"))).toBe(false);
    await store.close();
  });

  test("aborts a pending authorization admission when the store closes", async () => {
    const authorizationGate = deferred<boolean>();
    const authorizationStarted = deferred<void>();
    const fake = fakeDriver();
    const store = storeWith(fake, {
      authorizeBeforeWrite: async () => {
        authorizationStarted.resolve(undefined);
        return authorizationGate.promise;
      },
    });
    await store.initialize();
    const initialization = store.initializePersona(identity, initInput);
    await authorizationStarted.promise;

    await store.close();
    authorizationGate.resolve(true);
    await expect(initialization).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Personality store is closed.",
    });
    expect(fake.operationQueries.some((query) => query.startsWith("CREATE (n:AnimaPersonality)"))).toBe(false);
  });

  test("verifies exact pre-provisioned metadata without attempting schema writes and admits operations only afterward", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);

    await expect(store.initialize()).resolves.toEqual({
      status: "connected",
      database: config.database,
      constraints: constraints.map(({ name }) => name),
    });

    await expect(store.getStatus(identity)).resolves.toEqual({ initialized: false });
    expect(fake.operationQueries).toHaveLength(1);
    await store.close();
  });

  test("missing or mismatched metadata and denied SHOW degrade startup and reject every operation", async () => {
    const missingCases = [
      schemaRecords().slice(1),
      schemaRecords().slice(0, 1),
    ];
    const wrongCases = constraints.flatMap((_, index) =>
      (["name", "type", "entityType", "labelsOrTypes", "properties"] as const).map((field) =>
        wrongMetadataRecords(index, field)),
    );
    const cases: FakeDriverOptions[] = [
      ...missingCases.map((records) => ({ schemaRecords: records })),
      ...wrongCases.map((records) => ({ schemaRecords: records })),
      { showFailure: true },
    ];

    for (const options of cases) {
      const fake = fakeDriver(options);
      const store = storeWith(fake);
      await expect(store.initialize()).resolves.toMatchObject({ status: "degraded", database: null, constraints: [] });
      expect(store.health().status).toBe("degraded");
      await expectOperationsRejected(store, fake.operationQueries, unavailable);
      await store.close();
    }

  });

  test("keeps operations unavailable while SHOW is pending and after close", async () => {
    const showGate = deferred<void>();
    const fake = fakeDriver({ showGate });
    const store = storeWith(fake);
    const initialization = store.initialize();
    await fake.showStarted;

    expect(store.health()).toEqual({ status: "starting", database: null, constraints: [] });
    await expectOperationsRejected(store, fake.operationQueries, unavailable);

    const closing = store.close();
    expect(store.health()).toEqual({ status: "closed", database: null, constraints: [] });
    await expectOperationsRejected(store, fake.operationQueries, closed);

    showGate.resolve(undefined);
    await expect(initialization).resolves.toEqual({ status: "closed", database: null, constraints: [] });
    await closing;
    expect(fake.operationQueries).toEqual([]);
    expect(fake.closeCalls).toBe(1);
  });
});

describe("Neo4jPersonalityStore bounded shutdown", () => {
  test("returns at the deadline while SHOW remains pending and preserves the initialization result", async () => {
    const showGate = deferred<void>();
    const fake = fakeDriver({ showGate });
    const store = storeWith(fake);
    const initialization = store.initialize();
    await fake.showStarted;

    await store.close(25);
    let initializationSettled = false;
    void initialization.then(() => { initializationSettled = true; });
    await Promise.resolve();
    expect(initializationSettled).toBe(false);
    expect(store.health()).toEqual({ status: "closed", database: null, constraints: [] });

    showGate.resolve(undefined);
    await expect(initialization).resolves.toEqual({ status: "closed", database: null, constraints: [] });
    expect(fake.closeCalls).toBe(1);
  });

  test("bounds close while configuration loading is unresolved without starting a driver", async () => {
    const configGate = deferred<void>();
    const fake = fakeDriver();
    const store = storeWith(fake, {
      loadConfig: async (): Promise<ConfigLoadResult> => {
        await configGate.promise;
        return { kind: "ready", config };
      },
    });
    const initialization = store.initialize();

    await store.close(25);
    let initializationSettled = false;
    void initialization.then(() => { initializationSettled = true; });
    await Promise.resolve();
    expect(initializationSettled).toBe(false);
    expect(fake.verifyCalls).toBe(0);
    expect(fake.sessionCalls).toBe(0);

    configGate.resolve(undefined);
    await expect(initialization).resolves.toEqual({ status: "closed", database: null, constraints: [] });
    expect(fake.closeCalls).toBe(0);
  });

  test("lets an admitted read finish normally before close completes", async () => {
    const operationGate = deferred<void>();
    const fake = fakeDriver({ operationGate });
    const store = storeWith(fake);
    await store.initialize();
    const status = store.getStatus(identity);
    await fake.operationStarted;

    let closeSettled = false;
    const closing = store.close(500).then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    operationGate.resolve(undefined);
    await expect(status).resolves.toEqual({ initialized: false });
    await closing;
    expect(closeSettled).toBe(true);
  });

  test("returns at the deadline without settling an admitted write transaction", async () => {
    const writeGate = deferred<void>();
    const fake = fakeDriver({ writeGate });
    const store = storeWith(fake);
    await store.initialize();
    const initialization = store.initializePersona(identity, initInput);
    await fake.writeStarted;

    await store.close(25);
    let writeSettled = false;
    void initialization.then(() => { writeSettled = true; });
    await Promise.resolve();
    expect(writeSettled).toBe(false);

    writeGate.resolve(undefined);
    await expect(initialization).resolves.toEqual({
      action: "init_commit",
      rules: 1,
      anchors: REQUIRED_PERSONALITY_ANCHORS.length,
    });
  });

  test("bounds a driver close that never settles", async () => {
    const driverCloseGate = deferred<void>();
    const fake = fakeDriver({ driverCloseGate });
    const store = storeWith(fake);
    await store.initialize();

    const closing = store.close(25);
    await fake.closeStarted;
    await closing;
    expect(store.health()).toEqual({ status: "closed", database: null, constraints: [] });
    expect(fake.closeCalls).toBe(1);

    driverCloseGate.resolve(undefined);
  });

  test("rejects invalid timeout values without changing lifecycle state", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);

    for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.close(timeout)).toThrow(TypeError);
      expect(store.health()).toEqual({ status: "starting", database: null, constraints: [] });
    }
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    await store.close();
  });

  test("returns the same close promise for repeated calls with different timeouts", async () => {
    const driverCloseGate = deferred<void>();
    const fake = fakeDriver({ driverCloseGate });
    const store = storeWith(fake);
    await store.initialize();

    const first = store.close(25);
    await fake.closeStarted;
    const second = store.close(1000);
    expect(second).toBe(first);
    expect(() => store.close(0)).toThrow(TypeError);
    await first;
    driverCloseGate.resolve(undefined);
    expect(store.health()).toEqual({ status: "closed", database: null, constraints: [] });
  });

  test("closes a driver returned by a reentrant factory without verifying or opening a session", async () => {
    const fake = fakeDriver();
    let store!: Neo4jPersonalityStore;
    let closing: Promise<void> | undefined;
    store = storeWith(fake, {
      driverFactory: () => {
        closing = store.close(100);
        return fake.driver;
      },
    });

    await expect(store.initialize()).resolves.toEqual({ status: "closed", database: null, constraints: [] });
    expect(closing).toBeDefined();
    await closing!;
    expect(fake.verifyCalls).toBe(0);
    expect(fake.sessionCalls).toBe(0);
    expect(fake.closeCalls).toBe(1);
  });

  test("does not open a winner lookup after a constraint failure arrives after close", async () => {
    const writeGate = deferred<void>();
    const fake = fakeDriver({
      writeGate,
      writeFailure: { code: "Neo.ClientError.Schema.ConstraintValidationFailed" },
    });
    const store = storeWith(fake);
    await store.initialize();
    const initialization = store.initializePersona(identity, initInput);
    await fake.writeStarted;
    const sessionsBeforeClose = fake.sessionCalls;

    await store.close(25);
    writeGate.resolve(undefined);
    await expect(initialization).resolves.toEqual({
      status: "failed",
      code: "write_outcome_unknown",
      message: "Personality initialization outcome is unknown.",
    });
    expect(fake.sessionCalls).toBe(sessionsBeforeClose);
  });
});
