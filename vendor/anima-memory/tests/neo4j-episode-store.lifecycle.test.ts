import { describe, expect, test } from "vitest";
import type { ConfigLoadResult, Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { boundaryWindowUid } from "../src/index.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";

const projectUid = "a1111111-b222-4c33-8d44-e55555555555";
const stagedSessionUid = "44444444-4444-4444-8444-444444444444";
const windowUid = boundaryWindowUid(projectUid, stagedSessionUid, 0);
const eventUid = "33333333-3333-4333-8333-333333333333";
const config: Neo4jConfig = { uri: "neo4j://fake", username: "neo4j", password: "secret", database: "memory" };

interface QueryRecord { get(key: string): unknown }
interface QueryResult { records: QueryRecord[]; summary?: { counters?: { updates(): { nodesCreated?: number } } } }
interface Tx { run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult> }
interface Session {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
  executeWrite?<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
interface Driver {
  verifyConnectivity(): Promise<void>;
  session(options?: { database?: string }): Session;
  close(): Promise<void>;
}

function result(fields: Record<string, unknown>): QueryResult {
  return { records: [{ get(key: string) { return fields[key]; } }] };
}
function node(properties: Record<string, unknown>): { properties: Record<string, unknown> } {
  return { properties };
}
const definitions = [
  ["anima_project_uid_unique", "Project", "project_uid"],
  ["anima_session_uid_unique", "Session", "session_uid"],
  ["anima_raw_event_uid_unique", "RawEvent", "event_uid"],
  ["anima_boundary_window_uid_unique", "BoundaryWindow", "window_uid"],
  ["anima_memory_cursor_uid_unique", "MemoryCursor", "cursor_uid"],
  ["anima_episode_uid_unique", "Episode", "episode_uid"],
  ["anima_execution_unit_uid_unique", "ExecutionUnit", "execution_uid"],
  ["anima_execution_review_candidate_uid_unique", "ExecutionReviewCandidate", "candidate_uid"],
  ["anima_execution_review_uid_unique", "ExecutionReview", "review_uid"],
  ["anima_reflection_uid_unique", "Reflection", "reflection_uid"],
  ["anima_reflection_schedule_cursor_uid_unique", "ReflectionScheduleCursor", "cursor_uid"],
  ["anima_memory_subject_uid_unique", "MemorySubject", "domain_uid"],
  ["anima_memory_uid_unique", "Memory", "memory_uid"],
  ["anima_memory_claim_key_unique", "Memory", "claim_key"],
  ["anima_memory_revision_uid_unique", "MemoryRevision", "revision_uid"],
  ["anima_memory_decision_uid_unique", "MemoryDecision", "decision_uid"],
] as const;

function fakeDriver(options: { executeWrite?: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>; executeWriteSyncError?: boolean; sessionThrows?: boolean; postMarkerError?: boolean } = {}): { driver: Driver; sessions: number; writes: number; failSessions(): void } {
  let sessions = 0;
  let writes = 0;
  let sessionThrows = options.sessionThrows ?? false;
  const driver: Driver = {
    async verifyConnectivity() {},
    session() {
      sessions += 1;
      if (sessionThrows) throw new Error("session-internal-secret");
      const session: Session = {
        async run(query) {
          if (query === "SHOW CONSTRAINTS") {
            return { records: definitions.map(([name, label, property]) => ({ get(key: string) {
              return key === "name" ? name : key === "type" ? "UNIQUENESS" : key === "entityType" ? "NODE" : key === "labelsOrTypes" ? [label] : key === "properties" ? [property] : undefined;
            } })) };
          }
          return { records: [] };
        },
        executeWrite<T>(work: (tx: Tx) => Promise<T>) {
          writes += 1;
          if (options.executeWriteSyncError) throw new Error("sync executeWrite secret");
          if (options.executeWrite !== undefined) return options.executeWrite(work);
          if (options.postMarkerError) {
            const window = {
              window_uid: windowUid,
              project_uid: projectUid,
              session_uid: stagedSessionUid,
              start_ingest_sequence: 0,
              end_ingest_sequence: 0,
              projector_version: "anima.boundary-projector/v1",
              collection_state: "sealed",
              terminal_event_uid: eventUid,
              terminal_boundary_type: "compact",
              decision_status: "pending",
            };
            const event = { event_uid: eventUid, project_uid: projectUid, session_uid: window.session_uid, ingest_sequence: 0, kind: "boundary", boundary_type: "compact" };
            return work({
              async run(query) {
                if (query.includes("RETURN count(r) AS count")) return result({ count: 0 });
                if (query.includes("RETURN count(p) AS count")) return result({ count: 1 });
                if (query.includes("relation_count")) return result({ session: { project_uid: projectUid, session_uid: window.session_uid }, relation: {}, relation_count: 1 });
                if (query.includes("RETURN count(w) AS count")) return result({ count: 1 });
                if (query.includes("project_uid: p.project_uid") && query.includes("AS properties")) return result({ properties: { project_uid: projectUid } });
                if (query.includes("properties(w) AS properties")) return result({ properties: window });
                if (query.includes("session_uid: s.session_uid") && query.includes("MATCH (s:Session")) return result({ labels: ["Session"], session: { project_uid: projectUid, session_uid: window.session_uid } });
                if (query.includes("MATCH (owner:Project)-")) return result({ owner: { project_uid: projectUid }, relation: {} });
                if (query.includes("MATCH (s:Session {session_uid") && query.includes("HAS_SESSION")) return { records: [] };
                if (query.includes("RETURN {event_uid: e.event_uid") && query.includes("labels(e) AS labels")) return result({ event, labels: ["RawEvent", "BoundarySignal"], has_event: {} });
                if (query.includes("MATCH (e:RawEvent") && query.includes("IN_PROJECT")) return result({ project: { project_uid: projectUid }, relation: {} });
                if (query.includes("MATCH (owner:Session)-")) return result({ owner: { session_uid: window.session_uid }, relation: {} });
                if (query.includes("MATCH (e:RawEvent") && query.includes("HAS_EVENT")) return { records: [] };
                if (query.includes("MATCH (p:Project)-") && query.includes("IN_PROJECT")) return { records: [] };
                if (query.includes("MATCH (e:RawEvent)-[assignment:IN_BOUNDARY_WINDOW]")) return result({ event, assignment: { projector_version: "anima.boundary-projector/v1" } });
                if (query.includes("MATCH (w:BoundaryWindow") && query.includes("IN_BOUNDARY_WINDOW")) return { records: [] };
                if (query.includes("MATCH (e:RawEvent {event_uid") && query.includes("assigned:BoundaryWindow")) return result({ window, assignment: { projector_version: "anima.boundary-projector/v1" } });
                if (query.includes("IN_EPISODE")) return { records: [] };
                if (query.includes("CONTINUES_FROM")) return { records: [] };
                if (query.includes("MATCH (e:Episode")) return { records: [] };
                if (query.includes("MERGE (e:Episode")) throw new Error("post-marker secret");
                return { records: [] };
              },
            });
          }
          return work({ async run() { return { records: [] }; } });
        },
        async close() {},
      };
      return session;
    },
    async close() {},
  };
  return { driver, get sessions() { return sessions; }, get writes() { return writes; }, failSessions() { sessionThrows = true; } };
}

function storeWith(fake: ReturnType<typeof fakeDriver>): Neo4jMemoryStore {
  return new Neo4jMemoryStore({
    loadConfig: async (): Promise<ConfigLoadResult> => ({ kind: "ready", config }),
    driverFactory: () => fake.driver as never,
  });
}

const validInput = {
  project_uid: projectUid,
  episode_kind: "personal" as const,
  window_uids: [windowUid] as [string],
  closure: { kind: "none" } as const,
};

describe("materializeEpisode lifecycle", () => {
  test("closed admission precedes validation and does not open a session", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);
    await store.close();
    const outcome = await store.materializeEpisode({ bad: true } as never);
    expect(outcome).toEqual({ status: "failed", code: "core_closed", message: "Memory store is closed." });
    expect(fake.sessions).toBe(0);
  });

  test("degraded admission precedes validation and does not open a session", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);
    const outcome = await store.materializeEpisode({ bad: true } as never);
    expect(outcome).toEqual({ status: "failed", code: "core_degraded", message: "Memory store is degraded." });
    expect(fake.sessions).toBe(0);
  });

  test("every public shape error is invalid_input without opening a materialization session", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);
    expect((await store.initialize()).status).toBe("connected");
    const before = fake.sessions;
    const cases: unknown[] = [
      null,
      {},
      { ...validInput, extra: true },
      { ...validInput, project_uid: projectUid.toUpperCase() },
      { ...validInput, window_uids: [] },
      { ...validInput, window_uids: [windowUid, windowUid] },
      { ...validInput, closure: { kind: "work_validated", checkpoint_event_uid: eventUid } },
      { ...validInput, episode_kind: "work", closure: { kind: "personal_explicit", checkpoint_event_uid: eventUid } },
      { ...validInput, closure: { kind: "none", event_uid: eventUid } },
    ];
    for (const input of cases) {
      await expect(store.materializeEpisode(input as never)).resolves.toEqual({ status: "failed", code: "invalid_input", message: "Memory store input is invalid." });
    }
    expect(fake.sessions).toBe(before);
  });

  test("session creation failure is sanitized as database_error", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);
    await store.initialize();
    fake.failSessions();
    const outcome = await store.materializeEpisode(validInput);
    expect(outcome).toEqual({ status: "failed", code: "database_error", message: "Neo4j write failed before the memory write boundary." });
  });

  test("executeWrite rejection before semantic marker is sanitized", async () => {
    const fake = fakeDriver({ executeWrite: async () => { throw new Error("neo4j internal details"); } });
    const store = storeWith(fake);
    await store.initialize();
    const outcome = await store.materializeEpisode(validInput);
    expect(outcome).toEqual({ status: "failed", code: "database_error", message: "Neo4j write failed before the memory write boundary." });
  });
  test("post-marker driver rejection returns deterministic indeterminate IDs", async () => {
    const fake = fakeDriver({ postMarkerError: true });
    const store = storeWith(fake);
    await store.initialize();
    const first = await store.materializeEpisode(validInput);
    const second = await store.materializeEpisode(validInput);
    expect(first.status).toBe("indeterminate");
    expect(second.status).toBe("indeterminate");
    if (first.status === "indeterminate" && second.status === "indeterminate") {
      expect(first.episode_uid).toBe(second.episode_uid);
      expect(first.decision_uid).toBe(second.decision_uid);
      expect(first.episode_uid).toBeDefined();
      expect(first.decision_uid).toBeDefined();
    }
  });

  test("synchronous executeWrite rejection is sanitized", async () => {
    const fake = fakeDriver({ executeWriteSyncError: true });
    const store = storeWith(fake);
    await store.initialize();
    await expect(store.materializeEpisode(validInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Neo4j write failed before the memory write boundary.",
    });
  });

  test("existing process and continuation calls retain their domain result mapping", async () => {
    const fake = fakeDriver();
    const store = storeWith(fake);
    await store.initialize();
    await expect(store.processSession({ project_uid: projectUid, session_uid: "44444444-4444-4444-8444-444444444444" })).resolves.toEqual({
      status: "failed",
      code: "not_found",
      message: "Requested Capture entity was not found.",
    });
    await expect(store.recordSessionContinuation({
      project_uid: projectUid,
      session_uid: "44444444-4444-4444-8444-444444444444",
      previous_session_uid: "55555555-5555-4555-8555-555555555555",
      checkpoint_event_uid: eventUid,
    })).resolves.toEqual({
      status: "failed",
      code: "not_found",
      message: "Requested Capture entity was not found.",
    });
  });

  test("a real completed result is retained when close races after admission", async () => {
    let store: Neo4jMemoryStore;
    const fake = fakeDriver({
      executeWrite: async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
        try {
          await work({ async run() { return { records: [] }; } });
        } catch {
          // The callback is exercised to preserve the generic executeWrite contract.
        }
        await store.close();
        return {
          status: "materialized",
          decision_uid: "66666666-6666-4666-8666-666666666666",
          episode_uid: "77777777-7777-4777-8777-777777777777",
          state: "open" as const,
          revision: 0,
          windows_assigned: 1,
          evidence_links_created: 0,
        } as unknown as T;
      },
    });
    store = storeWith(fake);
    await store.initialize();
    await expect(store.materializeEpisode(validInput)).resolves.toMatchObject({ status: "materialized", revision: 0 });
  });

  test("domain errors expose frozen code/message and never driver text", async () => {
    const fake = fakeDriver({ executeWrite: async (work) => work({ async run() { return { records: [] }; } }) });
    const store = storeWith(fake);
    await store.initialize();
    const outcome = await store.materializeEpisode(validInput);
    expect(outcome.status).toBe("failed");
    expect((outcome as { code: string }).code).toBe("not_found");
    expect((outcome as { message: string }).message).toBe("Requested Episode source was not found.");
    expect((outcome as { message: string }).message).not.toContain("driver");
  });
});
