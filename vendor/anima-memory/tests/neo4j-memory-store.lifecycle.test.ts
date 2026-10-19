import { describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigLoadResult } from "@deepseek-ai/anima-capture/config";
import { boundaryCursorUid, boundaryWindowUid } from "../src/ids.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";
import type { ProjectOwnershipScope } from "../src/project-ownership.ts";

type QueryRecord = { get(key: string): unknown };
type QueryResult = { records: QueryRecord[] };
type Transaction = {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
};
type Session = {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
  executeRead?<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  executeWrite?<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
type Driver = {
  verifyConnectivity(): Promise<void>;
  session(options?: { database?: string }): Session;
  close(): Promise<void>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const config = {
  uri: "bolt://synthetic-memory-test",
  username: "synthetic-user",
  password: "synthetic-password",
  database: "neo4j",
} as const;

function readyConfig(): ConfigLoadResult {
  return { kind: "ready", config };
}

const constraintDefinitions = [
  { name: "anima_project_uid_unique", label: "Project", property: "project_uid" },
  { name: "anima_session_uid_unique", label: "Session", property: "session_uid" },
  { name: "anima_raw_event_uid_unique", label: "RawEvent", property: "event_uid" },
  { name: "anima_boundary_window_uid_unique", label: "BoundaryWindow", property: "window_uid" },
  { name: "anima_memory_cursor_uid_unique", label: "MemoryCursor", property: "cursor_uid" },
  { name: "anima_episode_uid_unique", label: "Episode", property: "episode_uid" },
  { name: "anima_execution_unit_uid_unique", label: "ExecutionUnit", property: "execution_uid" },
  { name: "anima_execution_review_candidate_uid_unique", label: "ExecutionReviewCandidate", property: "candidate_uid" },
  { name: "anima_execution_review_uid_unique", label: "ExecutionReview", property: "review_uid" },
  { name: "anima_reflection_uid_unique", label: "Reflection", property: "reflection_uid" },
  { name: "anima_reflection_schedule_cursor_uid_unique", label: "ReflectionScheduleCursor", property: "cursor_uid" },
  { name: "anima_memory_subject_uid_unique", label: "MemorySubject", property: "domain_uid" },
  { name: "anima_memory_uid_unique", label: "Memory", property: "memory_uid" },
  { name: "anima_memory_claim_key_unique", label: "Memory", property: "claim_key" },
  { name: "anima_memory_revision_uid_unique", label: "MemoryRevision", property: "revision_uid" },
  { name: "anima_memory_decision_uid_unique", label: "MemoryDecision", property: "decision_uid" },
] as const;
const initializationQueries = ["SHOW CONSTRAINTS"] as const;

type MetadataField = "name" | "type" | "entityType" | "labelsOrTypes" | "properties";
type MetadataMutation = { index: number; field: MetadataField };

const metadataMutations: MetadataMutation[] = constraintDefinitions.flatMap((_, index) =>
  (["name", "type", "entityType", "labelsOrTypes", "properties"] as const).map((field) => ({ index, field })),
);

function mutatedValue(definition: (typeof constraintDefinitions)[number], field: MetadataField): unknown {
  if (field === "name") return `${definition.name}-wrong`;
  if (field === "type") return "RANGE";
  if (field === "entityType") return "RELATIONSHIP";
  if (field === "labelsOrTypes") return ["WrongLabel"];
  return ["wrong_property"];
}

function record(fields: Record<string, unknown>): QueryRecord {
  return {
    get(key: string): unknown {
      if (!(key in fields)) throw new Error(`missing synthetic record field: ${key}`);
      return fields[key];
    },
  };
}

function schemaRecords(mutation?: MetadataMutation): QueryRecord[] {
  return constraintDefinitions.map((definition, index) => {
    const fields: Record<string, unknown> = {
      name: definition.name,
      type: "UNIQUENESS",
      entityType: "NODE",
      labelsOrTypes: [definition.label],
      properties: [definition.property],
    };
    if (mutation?.index === index) fields[mutation.field] = mutatedValue(definition, mutation.field);
    return record(fields);
  });
}
const projectUid = randomUUID();
const sessionUid = randomUUID();
const previousSessionUid = randomUUID();
const checkpointEventUid = randomUUID();
const cursorUid = boundaryCursorUid(sessionUid);
const windowUid = boundaryWindowUid(projectUid, sessionUid, 0);
const projectIdentityFingerprint = projectUid.replaceAll("-", "").repeat(2);

function syntheticNode(properties: Record<string, unknown>): { properties: Record<string, unknown> } {
  return { properties };
}

function operationRecord(): QueryRecord {
  const project = syntheticNode({ project_uid: projectUid, identity_fingerprint: projectIdentityFingerprint });
  const currentSession = syntheticNode({ session_uid: sessionUid, project_uid: projectUid });
  const previousSession = syntheticNode({ session_uid: previousSessionUid, project_uid: projectUid });
  const checkpoint = syntheticNode({
    event_uid: checkpointEventUid,
    session_uid: sessionUid,
    project_uid: projectUid,
    kind: "boundary",
    boundary_type: "checkpoint",
    ingest_sequence: 0,
  });
  const cursor = syntheticNode({
    cursor_uid: cursorUid,
    project_uid: projectUid,
    session_uid: sessionUid,
    projector_version: "anima.boundary-projector/v1",
    last_ingest_sequence: -1,
    open_window_uid: windowUid,
    open_window_start_sequence: 0,
  });
  const window = syntheticNode({
    window_uid: windowUid,
    project_uid: projectUid,
    session_uid: sessionUid,
    start_ingest_sequence: 0,
    end_ingest_sequence: 0,
    projector_version: "anima.boundary-projector/v1",
    collection_state: "sealed",
    terminal_event_uid: checkpointEventUid,
    terminal_boundary_type: "checkpoint",
    decision_status: "pending",
  });
  const values: Record<string, unknown> = {
    project_labels: ["Project"],
    project_properties: project.properties,
    p: project,
    project,
    s: currentSession,
    session: currentSession,
    current: currentSession,
    previous: previousSession,
    previous_session: previousSession,
    e: checkpoint,
    event: checkpoint,
    checkpoint: checkpoint,
    cursor,
    w: window,
    assignment: { properties: { projector_version: "anima.boundary-projector/v1" } },
    window,
    events: [checkpoint],
    next_ingest_sequence: 1,
    last_ingest_sequence: -1,
    event_count: 1,
    through_ingest_sequence: 0,
  };
  return {
    get(key: string): unknown {
      if (key in values) return values[key];
      if (key.endsWith("s") || key.includes("rows")) return [];
      return values.s;
    },
  };
}

type ExecuteWriteMode = "normal" | "reject-before-callback" | "reject-after-callback";

type FakeDriverOptions = {
  connectivity?: Promise<void>;
  schemaRecords?: QueryRecord[];
  schemaRun?: (query: string) => Promise<QueryResult>;
  executeWriteMode?: ExecuteWriteMode;
  executeReadFailure?: Error;
  afterExecuteWriteWork?: () => void;
  operationRun?: (query: string) => Promise<QueryResult>;
  operationSessionError?: Error;
  operationSessionClose?: () => Promise<void>;
  close?: () => Promise<void>;
};

type FakeDriverState = {
  driver: Driver;
  driverCloseCalls: number;
  sessionsCreated: number;
  sessionCloseCalls: number;
  schemaQueries: string[];
  showConstraintsStarted: Promise<void>;
  operationQueries: string[];
};

function fakeDriver(options: FakeDriverOptions = {}): FakeDriverState {
  let driverCloseCalls = 0;
  let sessionsCreated = 0;
  let sessionCloseCalls = 0;
  const schemaQueries: string[] = [];
  const operationQueries: string[] = [];
  const showConstraintsStarted = deferred<void>();
  const schema = options.schemaRecords ?? schemaRecords();
  const transaction: Transaction = {
    async run(query: string): Promise<QueryResult> {
      operationQueries.push(query);
      if (options.executeWriteMode === "reject-before-callback") {
        throw new Error("synthetic driver secret before write boundary");
      }
      return options.operationRun?.(query) ?? (query.includes("CONTINUES_FROM") ? { records: [] } : { records: [operationRecord()] });
    },
  };
  const driver: Driver = {
    verifyConnectivity: () => options.connectivity ?? Promise.resolve(),
    session: () => {
      const initializationSession = sessionsCreated === 0;
      sessionsCreated += 1;
      if (!initializationSession && options.operationSessionError !== undefined) throw options.operationSessionError;
      const session: Session = {
        run: async (query: string): Promise<QueryResult> => {
          if (initializationSession) {
            schemaQueries.push(query);
            if (query === initializationQueries[0]) showConstraintsStarted.resolve(undefined);
            if (options.schemaRun !== undefined) return options.schemaRun(query);
            if (query === initializationQueries[0]) return { records: schema };
            return { records: [] };
          }
          operationQueries.push(query);
          return options.operationRun?.(query) ?? (query.includes("CONTINUES_FROM") ? { records: [] } : { records: [operationRecord()] });
        },
        executeRead: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
          if (!initializationSession && options.executeReadFailure !== undefined) throw options.executeReadFailure;
          if (options.executeWriteMode === "reject-before-callback") {
            throw new Error("synthetic driver secret before write boundary");
          }
          return work(transaction);
        },
        executeWrite: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
          if (options.executeWriteMode === "reject-before-callback") {
            throw new Error("synthetic driver secret before write boundary");
          }
          const result = await work(transaction);
          options.afterExecuteWriteWork?.();
          if (options.executeWriteMode === "reject-after-callback") {
            throw new Error("synthetic driver secret after commit boundary");
          }
          return result;
        },
        close: async () => {
          sessionCloseCalls += 1;
          if (!initializationSession) await options.operationSessionClose?.();
        },
      };
      return session;
    },
    close: async () => {
      driverCloseCalls += 1;
      await options.close?.();
    },
  };
  return {
    driver,
    get driverCloseCalls() { return driverCloseCalls; },
    get sessionsCreated() { return sessionsCreated; },
    get schemaQueries() { return schemaQueries; },
    get showConstraintsStarted() { return showConstraintsStarted.promise; },
    get operationQueries() { return operationQueries; },
    get sessionCloseCalls() { return sessionCloseCalls; },
  };
}

function storeWithDriver(driverState: FakeDriverState, projectOwnership?: ProjectOwnershipScope): Neo4jMemoryStore {
  return new Neo4jMemoryStore({
    loadConfig: async () => readyConfig(),
    driverFactory: () => driverState.driver as never,
    ...(projectOwnership === undefined ? {} : { projectOwnership }),
  });
}
async function syntheticProjectOwnership(): Promise<ProjectOwnershipScope> {
  const principal_uid = randomUUID();
  let directory_id = randomUUID();
  while (directory_id === principal_uid) directory_id = randomUUID();
  const users_root = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/neo4j-memory-store-lifecycle-tests/users");
  const scope = {
    users_root,
    directory_id,
    directory: resolve(users_root, directory_id),
    principal_uid,
  };
  const projectsDirectory = resolve(scope.directory, "data", "projects");
  await mkdir(projectsDirectory, { recursive: true });
  const record = {
    identity_fingerprint: projectIdentityFingerprint,
    principal_uid,
    project_uid: projectUid,
    schema_id: "anima.dev-project-ownership/v1",
  };
  await writeFile(resolve(projectsDirectory, `${projectUid}.json`), JSON.stringify(record), { flag: "wx" });
  return scope;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const validProcessInput = { project_uid: projectUid, session_uid: sessionUid };
const validContinuationInput = {
  project_uid: projectUid,
  session_uid: sessionUid,
  previous_session_uid: previousSessionUid,
  checkpoint_event_uid: checkpointEventUid,
};

describe("Neo4jMemoryStore lifecycle", () => {
  test("returns disabled health for unavailable configuration without creating a driver", async () => {
    let driverFactoryCalls = 0;
    const store = new Neo4jMemoryStore({
      loadConfig: async () => ({ kind: "disabled", reason: "Neo4j configuration is unavailable." }),
      driverFactory: () => {
        driverFactoryCalls += 1;
        throw new Error("driver must not be created");
      },
    });

    await expect(store.initialize()).resolves.toEqual({ status: "disabled", database: null, constraints: [] });
    expect(driverFactoryCalls).toBe(0);
  });

  test("returns error health for invalid configuration without creating a driver", async () => {
    let driverFactoryCalls = 0;
    const store = new Neo4jMemoryStore({
      loadConfig: async () => ({ kind: "error", reason: "Neo4j configuration is invalid." }),
      driverFactory: () => {
        driverFactoryCalls += 1;
        throw new Error("driver must not be created");
      },
    });

    await expect(store.initialize()).resolves.toEqual({ status: "error", database: null, constraints: [] });
    expect(driverFactoryCalls).toBe(0);
  });

  test("maps connectivity failure to sanitized error health and closes the driver", async () => {
    const driverState = fakeDriver({
      connectivity: Promise.reject(new Error("bolt://user:secret@host/password-secret")),
    });
    const store = storeWithDriver(driverState);

    await expect(store.initialize()).resolves.toEqual({ status: "error", database: null, constraints: [] });
    expect(driverState.driverCloseCalls).toBe(1);
  });

  for (const { index, field } of metadataMutations) {
    const definition = constraintDefinitions[index];
    test(`rejects ${field} metadata mutation for ${definition.name}`, async () => {
      const driverState = fakeDriver({ schemaRecords: schemaRecords({ index, field }) });
      const store = storeWithDriver(driverState);

      await expect(store.initialize()).resolves.toEqual({ status: "error", database: null, constraints: [] });
      expect(driverState.driverCloseCalls).toBe(1);
      expect(driverState.sessionCloseCalls).toBe(1);
    });
  }

  test("initialize is idempotent and verifies schema with SHOW only when DDL is denied", async () => {
    let loadCalls = 0;
    let factoryCalls = 0;
    const driverState = fakeDriver({
      schemaRun: async (query) => {
        if (query.startsWith("CREATE ")) throw new Error("application DDL denied");
        if (query === initializationQueries[0]) return { records: schemaRecords() };
        return { records: [] };
      },
    });
    const store = new Neo4jMemoryStore({
      loadConfig: async () => {
        loadCalls += 1;
        return readyConfig();
      },
      driverFactory: () => {
        factoryCalls += 1;
        return driverState.driver as never;
      },
    });

    const first = store.initialize();
    const second = store.initialize();
    const [firstHealth, secondHealth] = await Promise.all([first, second]);
    expect(firstHealth).toEqual({
      status: "connected",
      database: "neo4j",
      constraints: [
        "anima_project_uid_unique",
        "anima_session_uid_unique",
        "anima_raw_event_uid_unique",
        "anima_boundary_window_uid_unique",
        "anima_memory_cursor_uid_unique",
        "anima_episode_uid_unique",
        "anima_execution_unit_uid_unique",
        "anima_execution_review_candidate_uid_unique",
        "anima_execution_review_uid_unique",
        "anima_reflection_uid_unique",
        "anima_reflection_schedule_cursor_uid_unique",
        "anima_memory_subject_uid_unique",
        "anima_memory_uid_unique",
        "anima_memory_claim_key_unique",
        "anima_memory_revision_uid_unique",
        "anima_memory_decision_uid_unique",
      ],
    });
    expect(secondHealth).toEqual(firstHealth);
    expect(loadCalls).toBe(1);
    expect(factoryCalls).toBe(1);
  });

  test("SHOW failure closes the driver and prevents operations while degraded", async () => {
    const driverState = fakeDriver({
      schemaRun: async () => {
        throw new Error("SHOW CONSTRAINTS denied");
      },
    });
    const store = storeWithDriver(driverState);

    await expect(store.initialize()).resolves.toEqual({ status: "error", database: null, constraints: [] });
    const result = await store.processSession(validProcessInput);

    expect(result).toMatchObject({ status: "failed", code: "core_degraded" });
    expect(driverState.driverCloseCalls).toBe(1);
    expect(driverState.sessionCloseCalls).toBe(1);
    expect(driverState.sessionsCreated).toBe(1);
    expect(driverState.operationQueries).toEqual([]);
  });

  test("close is bounded while configuration loading remains permanently pending", async () => {
    const store = new Neo4jMemoryStore({
      shutdown_timeout_ms: 20,
      loadConfig: () => new Promise<ConfigLoadResult>(() => {}),
    });
    void store.initialize();
    await flushMicrotasks();

    const started = performance.now();
    const firstClose = store.close(20);
    const secondClose = store.close(20);
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(performance.now() - started).toBeLessThan(250);
    await expect(store.initialize()).resolves.toEqual({ status: "closed", database: null, constraints: [] });
  });

  test("close during pending connectivity closes the created driver and prevents late connected health", async () => {
    const connectivity = deferred<void>();
    const driverState = fakeDriver({ connectivity: connectivity.promise });
    const store = storeWithDriver(driverState);
    const initializing = store.initialize();
    await flushMicrotasks();

    const closing = store.close(100);
    expect(driverState.driverCloseCalls).toBe(1);
    await closing;
    connectivity.resolve(undefined);
    await expect(initializing).resolves.toEqual({ status: "closed", database: null, constraints: [] });
    expect(driverState.driverCloseCalls).toBe(1);
  });

  test("close during pending SHOW closes one driver and session and prevents late connected health", async () => {
    const showConstraints = deferred<QueryResult>();
    const driverState = fakeDriver({
      schemaRun: async (query) => {
        if (query === initializationQueries[0]) return showConstraints.promise;
        return { records: [] };
      },
    });
    const store = storeWithDriver(driverState);
    const initializing = store.initialize();
    await driverState.showConstraintsStarted;
    expect(await store.processSession(validProcessInput)).toMatchObject({ status: "failed", code: "core_degraded" });
    expect(driverState.operationQueries).toEqual([]);

    const closing = store.close(100);
    expect(driverState.driverCloseCalls).toBe(1);
    await closing;
    showConstraints.resolve({ records: schemaRecords() });
    await expect(initializing).resolves.toEqual({ status: "closed", database: null, constraints: [] });
    expect(driverState.driverCloseCalls).toBe(1);
    expect(driverState.sessionCloseCalls).toBe(1);
    expect(driverState.operationQueries).toEqual([]);
  });

  test("close is bounded and idempotent when driver close remains pending", async () => {
    const driverClose = deferred<void>();
    const driverState = fakeDriver({ close: () => driverClose.promise });
    const store = storeWithDriver(driverState);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });

    const started = performance.now();
    const firstClose = store.close(20);
    const secondClose = store.close(20);
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(performance.now() - started).toBeLessThan(250);
    expect(driverState.driverCloseCalls).toBe(1);
    driverClose.resolve(undefined);
    await expect(store.close(20)).resolves.toBeUndefined();
  });

  test("rejects new operations after close with one fixed sanitized public message", async () => {
    const driverState = fakeDriver();
    const store = storeWithDriver(driverState);
    await store.close(20);

    const processResult = await store.processSession(validProcessInput);
    const continuationResult = await store.recordSessionContinuation(validContinuationInput);
    expect(processResult).toMatchObject({ status: "failed", code: "core_closed" });
    expect(continuationResult).toMatchObject({ status: "failed", code: "core_closed" });
    if (processResult.status !== "failed" || continuationResult.status !== "failed") {
      throw new Error("closed operations must return failed results");
    }
    expect(processResult.message).toBe(continuationResult.message);
    expect(processResult.message).toBe("Memory store is closed.");
  });

  test("maps a driver error before the write boundary to database_error with a fixed sanitized message", async () => {
    const driverState = fakeDriver({ executeWriteMode: "reject-before-callback" });
    const store = storeWithDriver(driverState);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });

    const result = await store.processSession(validProcessInput);
    expect(result).toEqual({
      status: "failed",
      code: "database_error",
      message: "Neo4j write failed before the memory write boundary.",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic driver secret");
  });

  test("keeps continuation lock acquisition before the semantic write boundary", async () => {
    const driverState = fakeDriver({
      operationRun: async (query) => {
        if (query.includes("SET cursor.last_ingest_sequence")) {
          throw new Error("synthetic driver secret during continuation lock");
        }
        return query.includes("CONTINUES_FROM") ? { records: [] } : { records: [operationRecord()] };
      },
    });
    const store = storeWithDriver(driverState);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });

    const result = await store.recordSessionContinuation(validContinuationInput);
    expect(result).toEqual({
      status: "failed",
      code: "database_error",
      message: "Neo4j write failed before the memory write boundary.",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic driver secret");
  });

  test("maps an unknown driver result after the write boundary to indeterminate", async () => {
    const driverState = fakeDriver({ executeWriteMode: "reject-after-callback" });
    const store = storeWithDriver(driverState);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });

    const result = await store.recordSessionContinuation(validContinuationInput);
    expect(result).toMatchObject({
      status: "indeterminate",
      decision_uid: expect.any(String),
      message: "Neo4j write outcome is unknown.",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic driver secret");
  });
  test("reports unknown outcome when close races after the semantic write boundary", async () => {
    const storeRef: { current?: Neo4jMemoryStore } = {};
    const driverState = fakeDriver({
      executeWriteMode: "reject-after-callback",
      afterExecuteWriteWork: () => {
        void storeRef.current?.close(20);
      },
    });
    const store = storeWithDriver(driverState);
    storeRef.current = store;
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });

    const result = await store.recordSessionContinuation(validContinuationInput);
    expect(result).toMatchObject({
      status: "indeterminate",
      decision_uid: expect.any(String),
      message: "Neo4j write outcome is unknown.",
    });
    expect(result).not.toMatchObject({ status: "failed", code: "core_closed" });
    expect(JSON.stringify(result)).not.toContain("synthetic driver secret");
  });

  test("lists recent memories through the direct Store API with registered Project isolation and bounded limits", async () => {
    const projectOwnership = await syntheticProjectOwnership();
    const queries: string[] = [];
    const driverState = fakeDriver({
      operationRun: async (query) => {
        queries.push(query);
        if (query.includes("RETURN labels(p) AS project_labels")) {
          return {
            records: [record({
              project_labels: ["Project"],
              project_properties: {
                project_uid: projectUid,
                identity_fingerprint: projectIdentityFingerprint,
              },
            })],
          };
        }
        if (query.includes("WHERE n.domain_uid = $uid")) return { records: [] };
        return { records: [] };
      },
    });
    const store = storeWithDriver(driverState, projectOwnership);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });

    await expect(store.listRecentProjectMemories({
      project_uid: projectUid,
      limit: 6,
      now: "2026-09-24T00:00:00.000Z",
    })).resolves.toEqual({ status: "failed", code: "invalid_input", message: "Memory store input is invalid." });
    expect(queries).toEqual([]);

    await expect(store.listRecentProjectMemories({
      project_uid: projectUid,
      limit: 0,
      now: "2026-09-24T00:00:00.000Z",
    })).resolves.toEqual({ status: "completed", results: [], count: 0 });
    expect(queries.some((query) => query.includes("WHERE n.domain_uid = $uid"))).toBe(false);

    await expect(store.listRecentProjectMemories({
      project_uid: projectUid,
      limit: 5,
      now: "2026-09-24T00:00:00.000Z",
    })).resolves.toEqual({ status: "completed", results: [], count: 0 });
    expect(queries.some((query) => query.includes("WHERE n.domain_uid = $uid"))).toBe(true);

    const beforeCrossProject = queries.length;
    await expect(store.listRecentProjectMemories({
      project_uid: randomUUID(),
      limit: 5,
      now: "2026-09-24T00:00:00.000Z",
    })).resolves.toEqual({
      status: "failed",
      code: "identity_conflict",
      message: "Memory identity or provenance conflicts with Capture.",
    });
    expect(queries).toHaveLength(beforeCrossProject);
    await store.close();
  });

  test("lists only reflections in the registered Project and keeps invalid requests outside the graph", async () => {
    const projectOwnership = await syntheticProjectOwnership();
    const queries: string[] = [];
    const driverState = fakeDriver({
      operationRun: async (query) => {
        queries.push(query);
        if (query.includes("RETURN labels(p) AS project_labels")) {
          return { records: [record({
            project_labels: ["Project"],
            project_properties: { project_uid: projectUid, identity_fingerprint: projectIdentityFingerprint },
          })] };
        }
        return { records: [] };
      },
    });
    const store = storeWithDriver(driverState, projectOwnership);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    const input = { project_uid: projectUid, limit: 5, now: "2026-09-24T00:00:00.000Z" };
    await expect(store.listProjectReflections({ ...input, limit: 6 })).resolves.toMatchObject({
      status: "failed", code: "invalid_input",
    });
    expect(queries).toEqual([]);
    await expect(store.listProjectReflections({ ...input, limit: 0 })).resolves.toEqual({
      status: "completed", items: [], count: 0,
    });
    expect(queries.some((query) => query.includes("MATCH (r:Reflection"))).toBe(false);
    await expect(store.listProjectReflections(input)).resolves.toEqual({
      status: "completed", items: [], count: 0,
    });
    expect(queries.some((query) => query.includes("MATCH (r:Reflection"))).toBe(true);
    const beforeCrossProject = queries.length;
    await expect(store.listProjectReflections({ ...input, project_uid: randomUUID() })).resolves.toMatchObject({
      status: "failed", code: "identity_conflict",
    });
    expect(queries).toHaveLength(beforeCrossProject);
    await store.close();
  });

  test("lists current-session review candidates only after Project ownership and Session linkage checks", async () => {
    const projectOwnership = await syntheticProjectOwnership();
    const queries: string[] = [];
    const driverState = fakeDriver({
      operationRun: async (query) => {
        queries.push(query);
        const project = { properties: { project_uid: projectUid, identity_fingerprint: projectIdentityFingerprint } };
        const session = { properties: { session_uid: sessionUid, project_uid: projectUid, next_ingest_sequence: 0 } };
        if (query.includes("[link:HAS_SESSION]")) return { records: [record({
          project_labels: ["Project"], project_properties: project.properties,
          session_labels: ["Session"], session_properties: session.properties,
        })] };
        if (query.includes("OPTIONAL MATCH (p)-[has_session:HAS_SESSION]")) return { records: [record({
          p: project, s: session, has_session: { properties: {} },
        })] };
        return { records: [] };
      },
    });
    const store = storeWithDriver(driverState, projectOwnership);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    const input = { project_uid: projectUid, session_uid: sessionUid, limit: 5 };
    await expect(store.listSessionReviewCandidates({ ...input, limit: 6 })).resolves.toMatchObject({
      status: "failed", code: "invalid_input",
    });
    expect(queries).toEqual([]);
    await expect(store.listSessionReviewCandidates({ ...input, project_uid: randomUUID() })).resolves.toMatchObject({
      status: "failed", code: "identity_conflict",
    });
    expect(queries).toEqual([]);
    await expect(store.listSessionReviewCandidates({ ...input, limit: 0 })).resolves.toEqual({
      status: "completed", candidates: [], count: 0,
    });
    await expect(store.listSessionReviewCandidates(input)).resolves.toEqual({
      status: "completed", candidates: [], count: 0,
    });
    expect(queries.some((query) => query.includes("ExecutionReviewCandidate"))).toBe(true);
    await store.close();
  });

  test("selects latest completed execution even when review state differs or cancellation is newer", async () => {
    const driverState = fakeDriver({
      operationRun: async (query) => query.includes("[link:HAS_SESSION]")
        ? { records: [record({
          project_labels: ["Project"], project_properties: { project_uid: projectUid, identity_fingerprint: projectIdentityFingerprint },
          session_labels: ["Session"], session_properties: { session_uid: sessionUid, project_uid: projectUid },
        })] }
        : { records: [] },
    });
    const store = storeWithDriver(driverState, await syntheticProjectOwnership());
    const older = randomUUID();
    const latest = randomUUID();
    const cancelled = randomUUID();
    const executionOlder = randomUUID();
    const executionLatest = randomUUID();
    const executionCancelled = randomUUID();
    Object.assign(store, {
      readExecutionSource: async () => [],
      readExecutionReviewCandidates: async () => [
        { candidate_uid: older, execution_uid: executionOlder, execution_state: "completed", state: "ready", created_at: "2026-09-23T13:00:00Z[UTC]" },
        { candidate_uid: cancelled, execution_uid: executionCancelled, execution_state: "cancelled", state: "ready", created_at: "2026-09-23T14:00:00Z[UTC]" },
        { candidate_uid: latest, execution_uid: executionLatest, execution_state: "completed", state: "reviewed", created_at: "2026-09-23T12:00:00Z[UTC]" },
      ],
      readRequestedExecutionUnits: async () => [
        { execution_uid: executionOlder, state: "completed", terminal_event_uid: randomUUID(), end_ingest_sequence: 4 },
        { execution_uid: executionLatest, state: "completed", terminal_event_uid: randomUUID(), end_ingest_sequence: 10 },
      ],
    });
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    const result = await store.listSessionReviewCandidates({ project_uid: projectUid, session_uid: sessionUid, limit: 2 });
    expect(result).toEqual({
      status: "completed", count: 2,
      candidates: [
        { candidate_uid: latest, execution_uid: executionLatest, created_at: "2026-09-23T12:00:00Z" },
        { candidate_uid: older, execution_uid: executionOlder, created_at: "2026-09-23T13:00:00Z" },
      ],
    });
    await store.close();
  });


  test("maps automatic project verification query failures to a blocked database_error attempt", async () => {
    const driverState = fakeDriver({ operationRun: async () => Promise.reject(new Error("synthetic query secret")) });
    const store = storeWithDriver(driverState, await syntheticProjectOwnership());
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    await expect(store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+00:00", max_input_bytes: 65536 })).resolves.toMatchObject({
      status: "partial",
      attempts: [expect.objectContaining({ project_uid: projectUid, status: "blocked", code: "database_error" })],
    });
  });

  test("maps automatic session acquisition failures to a blocked database_error attempt", async () => {
    const driverState = fakeDriver({ operationSessionError: new Error("synthetic session secret") });
    const store = storeWithDriver(driverState, await syntheticProjectOwnership());
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    await expect(store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+00:00", max_input_bytes: 65536 })).resolves.toMatchObject({
      status: "partial",
      attempts: [expect.objectContaining({ project_uid: projectUid, status: "blocked", code: "database_error" })],
    });
  });

  test("maps automatic executeRead failures to a blocked database_error attempt", async () => {
    const driverState = fakeDriver({ executeReadFailure: new Error("synthetic executeRead secret") });
    const store = storeWithDriver(driverState, await syntheticProjectOwnership());
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    await expect(store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+00:00", max_input_bytes: 65536 })).resolves.toMatchObject({
      status: "partial",
      attempts: [expect.objectContaining({ project_uid: projectUid, status: "blocked", code: "database_error" })],
    });
  });

  test("maps automatic session close-only failures to a blocked database_error attempt", async () => {
    const driverState = fakeDriver({ operationSessionClose: async () => Promise.reject(new Error("synthetic close secret")) });
    const store = storeWithDriver(driverState, await syntheticProjectOwnership());
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    await expect(store.runDueAutomaticReflections({ now: "2026-09-22T00:00:00+00:00", max_input_bytes: 65536 })).resolves.toMatchObject({
      status: "partial",
      attempts: [expect.objectContaining({ project_uid: projectUid, status: "blocked", code: "database_error" })],
    });
  });

  test("preserves an automatic domain error when session close also fails", async () => {
    const driverState = fakeDriver({ operationSessionClose: async () => Promise.reject(new Error("synthetic close secret")) });
    const store = storeWithDriver(driverState);
    await expect(store.initialize()).resolves.toMatchObject({ status: "connected" });
    const privateStore = store as unknown as {
      domain(code: "identity_conflict"): Error;
      runAutomaticRead<T>(work: (transaction: unknown) => Promise<T>): Promise<T>;
    };
    const domainError = privateStore.domain("identity_conflict");
    await expect(privateStore.runAutomaticRead(async () => { throw domainError; })).rejects.toMatchObject({
      name: "StoreDomainError",
      code: "identity_conflict",
    });
  });
});
