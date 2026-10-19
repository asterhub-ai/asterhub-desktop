import { describe, expect, test } from "vitest";
import { Neo4jStore } from "../src/index.ts";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
type ConstraintRecord = { get(key: string): unknown };
type ConstraintMetadata = {
  name: string;
  type: string;
  entityType: string;
  labelsOrTypes: string[];
  properties: string[];
};
type ConstraintResult = { records: ConstraintRecord[] };

const expectedConstraints: ConstraintMetadata[] = [
  {
    name: "anima_project_uid_unique",
    type: "UNIQUENESS",
    entityType: "NODE",
    labelsOrTypes: ["Project"],
    properties: ["project_uid"],
  },
  {
    name: "anima_session_uid_unique",
    type: "UNIQUENESS",
    entityType: "NODE",
    labelsOrTypes: ["Session"],
    properties: ["session_uid"],
  },
  {
    name: "anima_raw_event_uid_unique",
    type: "UNIQUENESS",
    entityType: "NODE",
    labelsOrTypes: ["RawEvent"],
    properties: ["event_uid"],
  },
];

function constraintRecord(metadata: ConstraintMetadata): ConstraintRecord {
  return { get: (key) => metadata[key as keyof ConstraintMetadata] };
}

function validConstraintRecords(): ConstraintRecord[] {
  return expectedConstraints.map(constraintRecord);
}

function makeStore(showConstraints: () => Promise<ConstraintResult>) {
  const stats = { queries: [] as string[], transactionStarts: 0, driverCloseCalls: 0 };
  const driver = {
    verifyConnectivity: async () => {},
    session: () => ({
      run: async (query: string) => {
        stats.queries.push(query);
        if (query !== "SHOW CONSTRAINTS") throw new Error("DDL is not permitted.");
        return showConstraints();
      },
      executeWrite: async (work: (transaction: never) => Promise<unknown>) => {
        stats.transactionStarts += 1;
        return work({} as never);
      },
      close: async () => {},
    }),
    close: async () => {
      stats.driverCloseCalls += 1;
    },
  };
  const store = new Neo4jStore({
    loadConfig: async () => ({
      kind: "ready" as const,
      config: { uri: "bolt://test", username: "test", password: "test", database: "neo4j" },
    }),
    driverFactory: () => driver as never,
  });
  return { store, stats };
}

type DatabaseIdentity = { id: string; name: string };
type IdentityStoreOptions = {
  expectedDatabaseId?: string;
  identityProbeFails?: boolean;
  retryWithEndpointSwap?: boolean;
};

function makeIdentityStore(options: IdentityStoreOptions = {}) {
  const identity: DatabaseIdentity = { id: "database-A", name: "neo4j" };
  const stats = {
    queries: [] as string[],
    writeTransactions: 0,
    readTransactions: 0,
    transactionAttempts: 0,
    sessionCloseCalls: 0,
    driverCloseCalls: 0,
  };
  const identityResult = () => {
    if (options.identityProbeFails) throw new Error("Identity probe failed.");
    return { records: [{ get: (key: string) => identity[key as keyof DatabaseIdentity] }] };
  };
  const transaction = {
    run: async (query: string) => {
      stats.queries.push(query);
      if (query === "CALL db.info() YIELD id, name RETURN id, name") return identityResult();
      return { records: [] };
    },
  };
  const driver = {
    verifyConnectivity: async () => {},
    session: () => ({
      run: async (query: string) => {
        stats.queries.push(query);
        if (query === "CALL db.info() YIELD id, name RETURN id, name") return identityResult();
        if (query === "SHOW CONSTRAINTS") return { records: validConstraintRecords() };
        throw new Error("Unexpected session query.");
      },
      executeWrite: async (work: (tx: never) => Promise<unknown>) => {
        stats.writeTransactions += 1;
        stats.transactionAttempts += 1;
        const result = await work(transaction as never);
        if (options.retryWithEndpointSwap && stats.transactionAttempts === 1) {
          identity.id = "database-B";
          stats.transactionAttempts += 1;
          return work(transaction as never);
        }
        return result;
      },
      executeRead: async (work: (tx: never) => Promise<unknown>) => {
        stats.readTransactions += 1;
        return work(transaction as never);
      },
      close: async () => {
        stats.sessionCloseCalls += 1;
      },
    }),
    close: async () => {
      stats.driverCloseCalls += 1;
    },
  };
  const store = new Neo4jStore({
    requireDatabaseIdentity: true,
    expectedDatabaseId: options.expectedDatabaseId,
    loadConfig: async () => ({
      kind: "ready" as const,
      config: { uri: "bolt://test", username: "test", password: "test", database: "neo4j" },
    }),
    driverFactory: () => driver as never,
  });
  return { store, stats, setDatabaseId: (id: string) => { identity.id = id; } };
}

const invalidSchemaCases: Array<{ name: string; showConstraints: () => Promise<ConstraintResult> }> = [
  {
    name: "missing constraint",
    showConstraints: async () => ({ records: validConstraintRecords().slice(1) }),
  },
  {
    name: "wrong constraint property",
    showConstraints: async () => ({
      records: expectedConstraints.map((metadata) => constraintRecord(
        metadata.name === "anima_session_uid_unique" ? { ...metadata, properties: ["wrong_uid"] } : metadata,
      )),
    }),
  },
  {
    name: "wrong constraint name",
    showConstraints: async () => ({
      records: expectedConstraints.map((metadata) => constraintRecord(
        metadata.name === "anima_session_uid_unique" ? { ...metadata, name: "unexpected_constraint" } : metadata,
      )),
    }),
  },
  {
    name: "wrong constraint type",
    showConstraints: async () => ({
      records: expectedConstraints.map((metadata) => constraintRecord(
        metadata.name === "anima_session_uid_unique" ? { ...metadata, type: "NODE_PROPERTY_EXISTENCE" } : metadata,
      )),
    }),
  },
  {
    name: "wrong constraint entity",
    showConstraints: async () => ({
      records: expectedConstraints.map((metadata) => constraintRecord(
        metadata.name === "anima_session_uid_unique" ? { ...metadata, entityType: "RELATIONSHIP" } : metadata,
      )),
    }),
  },
  {
    name: "wrong constraint label",
    showConstraints: async () => ({
      records: expectedConstraints.map((metadata) => constraintRecord(
        metadata.name === "anima_session_uid_unique" ? { ...metadata, labelsOrTypes: ["OtherLabel"] } : metadata,
      )),
    }),
  },
  {
    name: "SHOW permission denied",
    showConstraints: async () => {
      throw new Error("Forbidden.");
    },
  },
];

describe("Neo4jStore lifecycle", () => {
  test("close returns within its budget while initialization remains permanently pending", async () => {
    const originalDateNow = Date.now;
    let dateNowCalls = 0;
    Date.now = () => {
      dateNowCalls += 1;
      return dateNowCalls === 1 ? 1_000 : 1_000_000_000;
    };
    const store = new Neo4jStore({
      shutdown_timeout_ms: 20,
      loadConfig: () => new Promise(() => {}),
    });
    try {
      void store.initialize();
      const started = performance.now();
      await store.close();
      expect(performance.now() - started).toBeGreaterThan(5);
      expect(performance.now() - started).toBeLessThan(250);
      await expect(store.initialize()).resolves.toMatchObject({ status: "closed" });
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("close starts driver close while connectivity is still pending", async () => {
    const connectivity = deferred<void>();
    let driverCloseCalls = 0;
    const driver = {
      verifyConnectivity: () => connectivity.promise,
      close: () => {
        driverCloseCalls += 1;
        return Promise.resolve();
      },
      session: () => {
        throw new Error("session should not be opened while connectivity is pending");
      },
    };
    const store = new Neo4jStore({
      shutdown_timeout_ms: 100,
      loadConfig: async () => ({
        kind: "ready" as const,
        config: { uri: "bolt://test", username: "test", password: "test", database: "neo4j" },
      }),
      driverFactory: () => driver as never,
    });
    const initializing = store.initialize();
    await Promise.resolve();
    await Promise.resolve();
    const closing = store.close();
    expect(driverCloseCalls).toBe(1);
    await closing;
    connectivity.resolve();
    await initializing;
    expect(driverCloseCalls).toBe(1);
  });

  test("verifies preprovisioned schema and keeps writes disabled until verification completes", async () => {
    const showStarted = deferred<void>();
    const verification = deferred<{ records: ConstraintRecord[] }>();
    const { store, stats } = makeStore(() => {
      showStarted.resolve();
      return verification.promise;
    });
    const initializing = store.initialize();

    await showStarted.promise;
    await expect(store.executeWrite(async () => "unexpected")).rejects.toThrow("Neo4j store is not connected.");
    expect(stats.transactionStarts).toBe(0);

    verification.resolve({ records: validConstraintRecords() });
    await expect(initializing).resolves.toEqual({
      status: "connected",
      database: "neo4j",
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
      message: "Neo4j connection is healthy.",
    });
    expect(stats.queries).toEqual(["SHOW CONSTRAINTS"]);
    await expect(store.executeWrite(async () => "written")).resolves.toBe("written");
    expect(stats.transactionStarts).toBe(1);
    expect(store.getDatabaseId()).toBeUndefined();
    await store.close();
  });

  test("requires a matched database identity before exposing the connected ID", async () => {
    const { store, stats } = makeIdentityStore({ expectedDatabaseId: "database-A" });
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    expect(store.getDatabaseId()).toBe("database-A");
    expect(stats.queries).toEqual([
      "CALL db.info() YIELD id, name RETURN id, name",
      "SHOW CONSTRAINTS",
    ]);
    await store.close();
    expect(store.getDatabaseId()).toBeUndefined();
  });

  test("fails closed when startup database identity does not match the expected ID", async () => {
    const { store, stats } = makeIdentityStore({ expectedDatabaseId: "database-B" });
    await expect(store.initialize()).resolves.toEqual({
      status: "error",
      database: null,
      constraints: [],
      message: "Neo4j connection failed.",
    });
    expect(store.getDatabaseId()).toBeUndefined();
    await expect(store.executeWrite(async () => "unexpected")).rejects.toThrow("Neo4j store is not connected.");
    expect(stats.writeTransactions).toBe(0);
    expect(stats.driverCloseCalls).toBe(1);
    await store.close();
  });

  test("fails closed when the startup identity probe fails", async () => {
    const { store, stats } = makeIdentityStore({ identityProbeFails: true });
    await expect(store.initialize()).resolves.toMatchObject({
      status: "error",
      message: "Neo4j connection failed.",
    });
    expect(store.getDatabaseId()).toBeUndefined();
    await expect(store.executeWrite(async () => "unexpected")).rejects.toThrow("Neo4j store is not connected.");
    expect(stats.writeTransactions).toBe(0);
    await store.close();
  });

  test("blocks write work when the endpoint identity changes before the transaction", async () => {
    const { store, setDatabaseId } = makeIdentityStore();
    await store.initialize();
    setDatabaseId("database-B");
    let workCalls = 0;
    await expect(store.executeWrite(async () => {
      workCalls += 1;
      return "unexpected";
    })).rejects.toThrow("Neo4j database identity verification failed.");
    expect(workCalls).toBe(0);
    await store.close();
  });

  test("blocks service identity reads when the endpoint changes after startup", async () => {
    const { store, setDatabaseId } = makeIdentityStore();
    await store.initialize();
    setDatabaseId("database-B");
    let readStarted = false;
    await expect(store.executeRead(async () => {
      readStarted = true;
      return "unexpected";
    })).rejects.toThrow("Neo4j database identity verification failed.");
    expect(readStarted).toBe(false);
    await store.close();
  });

  test("rechecks database identity on each managed transaction retry", async () => {
    const { store, stats } = makeIdentityStore({ retryWithEndpointSwap: true });
    await store.initialize();
    let workCalls = 0;
    await expect(store.executeWrite(async () => {
      workCalls += 1;
      return "written";
    })).rejects.toThrow("Neo4j database identity verification failed.");
    expect(workCalls).toBe(1);
    expect(stats.queries.filter((query) => query === "CALL db.info() YIELD id, name RETURN id, name")).toHaveLength(3);
    await store.close();
  });

  test("closes managed read sessions after failure and prevents reads after close", async () => {
    const { store, stats } = makeIdentityStore();
    await store.initialize();
    const sessionCloseCallsAfterInitialize = stats.sessionCloseCalls;
    await expect(store.executeRead(async () => { throw new Error("read failed"); })).rejects.toThrow("read failed");
    expect(stats.readTransactions).toBe(1);
    expect(stats.sessionCloseCalls).toBe(sessionCloseCallsAfterInitialize + 1);

    await store.close();
    expect(store.getDatabaseId()).toBeUndefined();
    await expect(store.executeRead(async () => "unexpected")).rejects.toThrow("Neo4j store is not connected.");
    await expect(store.executeWrite(async () => "unexpected")).rejects.toThrow("Neo4j store is not connected.");
    expect(stats.readTransactions).toBe(1);
    expect(stats.writeTransactions).toBe(0);
    expect(stats.sessionCloseCalls).toBe(sessionCloseCallsAfterInitialize + 1);
  });

  for (const schemaCase of invalidSchemaCases) {
    test(`fails closed when ${schemaCase.name}`, async () => {
      const { store, stats } = makeStore(schemaCase.showConstraints);
      await expect(store.initialize()).resolves.toEqual({
        status: "error",
        database: null,
        constraints: [],
        message: "Neo4j connection failed.",
      });

      await expect(store.executeWrite(async () => "unexpected")).rejects.toThrow("Neo4j store is not connected.");
      expect(stats.transactionStarts).toBe(0);
      expect(stats.driverCloseCalls).toBe(1);
      await store.close();
    });
  }
});
