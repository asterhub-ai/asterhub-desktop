import { describe, expect, test } from "vitest";
import type {
  GetTaskDigestInput,
  GetTaskDigestResult,
  CreateExactSpanModelMemoryInput,
  CreateExactSpanModelMemoryResult,
  CreateToolSaveMemoryInput,
  CreateToolSaveMemoryResult,
  SearchProjectMemoriesInput,
  SearchProjectMemoriesResult,
  ListRecentProjectMemoriesInput,
  ListRecentProjectMemoriesResult,
  MemoryCoreHealth,
  MemoryStore,
  MemoryStoreHealth,
  MaterializeExecutionReviewCandidatesInput,
  MaterializeExecutionReviewCandidatesResult,
  ProcessSessionInput,
  ProcessSessionResult,
  MemoryOperationInput,
  MemoryOperationResult,
  RecordSessionContinuationInput,
  RecordSessionContinuationResult,
} from "../src/types.ts";
import type { RunDueAutomaticReflectionsInput, RunDueAutomaticReflectionsResult } from "../src/automatic-reflection-types.ts";
import type { MaterializeExecutionUnitsInput, MaterializeExecutionUnitsResult } from "../src/execution-types.ts";
import type { MaterializeEpisodeInput, MaterializeEpisodeResult } from "../src/episode-types.ts";
import { MemoryCore } from "../src/memory-core.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const constraints = [
  "anima_project_uid_unique",
  "anima_session_uid_unique",
  "anima_raw_event_uid_unique",
  "anima_boundary_window_uid_unique",
  "anima_memory_cursor_uid_unique",
  "anima_episode_uid_unique",
  "anima_execution_unit_uid_unique",
  "anima_execution_review_candidate_uid_unique",
] as const;

const connectedHealth: MemoryStoreHealth = {
  status: "connected",
  database: "neo4j",
  constraints,
};

const validProcessInput: ProcessSessionInput = {
  project_uid: "123e4567-e89b-42d3-a456-426614174000",
  session_uid: "223e4567-e89b-42d3-a456-426614174001",
};

const validContinuationInput: RecordSessionContinuationInput = {
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
  previous_session_uid: "323e4567-e89b-42d3-a456-426614174002",
  checkpoint_event_uid: "423e4567-e89b-42d3-a456-426614174003",
};

const validMaterializeInput = {
  project_uid: validProcessInput.project_uid,
  episode_kind: "work",
  window_uids: ["723e4567-e89b-42d3-a456-426614174006"],
  closure: {
    kind: "work_validated",
    checkpoint_event_uid: validContinuationInput.checkpoint_event_uid,
    validation_result_event_uid: "823e4567-e89b-42d3-a456-426614174007",
    validation_event_uid: "923e4567-e89b-42d3-a456-426614174008",
  },
} as const satisfies MaterializeEpisodeInput;
const validExecutionInput: MaterializeExecutionUnitsInput = {
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
};
const validReviewCandidateInput: MaterializeExecutionReviewCandidatesInput = {
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
};

const validExactSpanInput: CreateExactSpanModelMemoryInput = {
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
  event_uid: validContinuationInput.checkpoint_event_uid,
  span: { text_part_index: 0, utf8_start: 0, utf8_end: 5, sha256: "a".repeat(64) },
  statement: "Remember this.",
  decision_uid: "a23e4567-e89b-42d3-a456-426614174009",
  now: "2026-09-23T00:00:00.000Z",
};

const validMemoryOperationInput: MemoryOperationInput = {
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
  operation_event_uid: "b23e4567-e89b-42d3-a456-426614174010",
  tool_call_id: "edit-1",
  user_event_uid: validContinuationInput.checkpoint_event_uid,
  user_span: { text_part_index: 0, utf8_start: 0, utf8_end: 5, sha256: "a".repeat(64) },
  memory_uid: "c23e4567-e89b-42d3-a456-426614174011",
  expected_revision_uid: "d23e4567-e89b-42d3-a456-426614174012",
  action: "revise",
  statement: "Remember this.",
  decision_uid: "e23e4567-e89b-42d3-a456-426614174013",
  now: "2026-09-23T00:00:00.000Z",
};

const memoryOperationResult: MemoryOperationResult = {
  status: "written",
  decision_uid: validMemoryOperationInput.decision_uid,
  memory_uid: validMemoryOperationInput.memory_uid,
  revision_uid: "f23e4567-e89b-42d3-a456-426614174014",
};

const validToolSaveInput: CreateToolSaveMemoryInput = {
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
  event_uid: validContinuationInput.checkpoint_event_uid,
  tool_call_id: "tool-call-1",
  params: { statement: "Remember this." },
  decision_uid: "d23e4567-e89b-42d3-a456-426614174012",
  now: "2026-09-23T00:00:00.000Z",
};

const toolSaveMemoryResult: CreateToolSaveMemoryResult = {
  status: "written",
  decision_uid: validToolSaveInput.decision_uid,
  memory_uid: "e23e4567-e89b-42d3-a456-426614174013",
  revision_uid: "f23e4567-e89b-42d3-a456-426614174014",
};

const validSearchInput: SearchProjectMemoriesInput = {
  project_uid: validProcessInput.project_uid,
  query: "喝茶",
  top_k: 10,
  now: "2026-09-23T00:00:00.000Z",
};
const projectSearchResult: SearchProjectMemoriesResult = {
  status: "completed",
  query: "喝茶",
  results: [{
    id: "e23e4567-e89b-42d3-a456-426614174013",
    type: "experience",
    title: "茶偏好",
    narrative: "喜欢喝茶",
    context: "",
    principle: "",
    tags: ["饮食"],
    created_at: "2026-09-22T00:00:00.000Z",
    epistemic_kind: "hypothesis",
    provenance: "tool_invocation",
    applicability: { kind: "project", project_uid: validProcessInput.project_uid },
  }],
  count: 1,
};

const validRecentMemoriesInput: ListRecentProjectMemoriesInput = {
  project_uid: validProcessInput.project_uid,
  limit: 5,
  now: "2026-09-23T00:00:00.000Z",
};
const recentMemoriesResult: ListRecentProjectMemoriesResult = {
  status: "completed",
  results: projectSearchResult.results,
  count: projectSearchResult.count,
};

const exactSpanRevisionResult: CreateExactSpanModelMemoryResult = {
  status: "written",
  decision_uid: validExactSpanInput.decision_uid,
  memory_uid: "b23e4567-e89b-42d3-a456-426614174010",
  revision_uid: "c23e4567-e89b-42d3-a456-426614174011",
};

const reviewCandidateResult: MaterializeExecutionReviewCandidatesResult = {
  status: "materialized",
  project_uid: validReviewCandidateInput.project_uid,
  session_uid: validReviewCandidateInput.session_uid,
  through_ingest_sequence: 3,
  candidates_created: 1,
  evidence_links_created: 4,
};

const executionResult: MaterializeExecutionUnitsResult = {
  status: "materialized",
  project_uid: validExecutionInput.project_uid,
  session_uid: validExecutionInput.session_uid,
  through_ingest_sequence: 3,
  execution_units_created: 1,
  execution_units_updated: 0,
  event_links_created: 4,
};

const materializedResult: MaterializeEpisodeResult = {
  status: "materialized",
  decision_uid: "a23e4567-e89b-42d3-a456-426614174009",
  episode_uid: "b23e4567-e89b-42d3-a456-426614174010",
  state: "open",
  revision: 1,
  windows_assigned: 1,
  evidence_links_created: 3,
};

const processedResult: ProcessSessionResult = {
  status: "processed",
  project_uid: validProcessInput.project_uid,
  session_uid: validProcessInput.session_uid,
  from_ingest_sequence: 0,
  through_ingest_sequence: 3,
  events_assigned: 4,
  windows_created: 1,
  windows_updated: 0,
};

const continuationWritten: RecordSessionContinuationResult = {
  status: "written",
  decision_uid: "523e4567-e89b-42d3-a456-426614174004",
};

const validTaskDigestInput: GetTaskDigestInput = {
  candidate_uid: "a23e4567-e89b-42d3-a456-426614174009",
};

const taskDigestResult: GetTaskDigestResult = {
  status: "found",
  digest: {
    candidate_uid: validTaskDigestInput.candidate_uid,
    execution_uid: "b23e4567-e89b-42d3-a456-426614174010",
    project_uid: validProcessInput.project_uid,
    session_uid: validProcessInput.session_uid,
    source_fingerprint: "a".repeat(64),
    terminal: {
      state: "completed",
      terminal_reason: "final_reply",
      event_uid: "c23e4567-e89b-42d3-a456-426614174011",
      position: 1,
      captured_at: "2026-01-01T00:00:00.000Z",
    },
    initiator: { event_uid: "923e4567-e89b-42d3-a456-426614174008", position: 0, content: "request" },
    events: [
      { event_uid: "923e4567-e89b-42d3-a456-426614174008", position: 0, kind: "message", role: "initiator", content: "request" },
      { event_uid: "c23e4567-e89b-42d3-a456-426614174011", position: 1, kind: "turn_end", role: "terminal", content: null },
    ],
    unsettled_tool_calls: [],
    content_omissions: [],
  },
};
const validAutomaticInput: RunDueAutomaticReflectionsInput = {
  now: "2026-09-22T00:00:00.000Z",
  max_input_bytes: 65_536,
};

const automaticReflectionResult: RunDueAutomaticReflectionsResult = {
  status: "completed",
  now: validAutomaticInput.now,
  attempts: [],
  has_more: false,
};


class ControlledStore implements MemoryStore {
  initializeCalls = 0;
  processCalls = 0;
  continuationCalls = 0;
  materializeCalls = 0;
  executionCalls = 0;
  reviewCandidateCalls = 0;
  taskDigestCalls = 0;
  automaticReflectionCalls = 0;
  exactSpanRevisionCalls = 0;
  exactSpanRevisionImpl: (input: CreateExactSpanModelMemoryInput) => Promise<CreateExactSpanModelMemoryResult> = async () => exactSpanRevisionResult;
  toolSaveRevisionCalls = 0;
  toolSaveRevisionImpl: (input: CreateToolSaveMemoryInput) => Promise<CreateToolSaveMemoryResult> = async () => toolSaveMemoryResult;
  searchCalls = 0;
  searchImpl: (input: SearchProjectMemoriesInput) => Promise<SearchProjectMemoriesResult> = async () => projectSearchResult;
  recentMemoriesCalls = 0;
  recentMemoriesImpl: (input: ListRecentProjectMemoriesInput) => Promise<ListRecentProjectMemoriesResult> = async () => recentMemoriesResult;
  memoryOperationCalls = 0;
  memoryOperationImpl: (input: MemoryOperationInput) => Promise<MemoryOperationResult> = async () => memoryOperationResult;
  getTaskDigestImpl: (input: GetTaskDigestInput) => Promise<GetTaskDigestResult> = async () => taskDigestResult;
  runAutomaticReflectionImpl: (input: RunDueAutomaticReflectionsInput) => Promise<RunDueAutomaticReflectionsResult> = async () => automaticReflectionResult;
  closeCalls = 0;
  closeTimeouts: number[] = [];

  initializeImpl: () => Promise<MemoryStoreHealth> = async () => connectedHealth;
  processImpl: (input: ProcessSessionInput) => Promise<ProcessSessionResult> = async () => processedResult;
  continuationImpl: (input: RecordSessionContinuationInput) => Promise<RecordSessionContinuationResult> = async () => continuationWritten;
  materializeImpl: (input: MaterializeEpisodeInput) => Promise<MaterializeEpisodeResult> = async () => materializedResult;
  materializeExecutionImpl: (input: MaterializeExecutionUnitsInput) => Promise<MaterializeExecutionUnitsResult> = async () => executionResult;
  materializeReviewCandidateImpl: (input: MaterializeExecutionReviewCandidatesInput) => Promise<MaterializeExecutionReviewCandidatesResult> = async () => reviewCandidateResult;
  closeImpl: (timeoutMs: number) => Promise<void> = async () => {};

  initialize(): Promise<MemoryStoreHealth> {
    this.initializeCalls += 1;
    return this.initializeImpl();
  }

  processSession(input: ProcessSessionInput): Promise<ProcessSessionResult> {
    this.processCalls += 1;
    return this.processImpl(input);
  }

  recordSessionContinuation(input: RecordSessionContinuationInput): Promise<RecordSessionContinuationResult> {
    this.continuationCalls += 1;
    return this.continuationImpl(input);
  }

  materializeEpisode(input: MaterializeEpisodeInput): Promise<MaterializeEpisodeResult> {
    this.materializeCalls += 1;
    return this.materializeImpl(input);
  }

  getTaskDigest(input: GetTaskDigestInput): Promise<GetTaskDigestResult> {
    this.taskDigestCalls += 1;
    return this.getTaskDigestImpl(input);
  }
  materializeExecutionUnits(input: MaterializeExecutionUnitsInput): Promise<MaterializeExecutionUnitsResult> {
    this.executionCalls += 1;
    return this.materializeExecutionImpl(input);
  }
  materializeExecutionReviewCandidates(input: MaterializeExecutionReviewCandidatesInput): Promise<MaterializeExecutionReviewCandidatesResult> {
    this.reviewCandidateCalls += 1;
    return this.materializeReviewCandidateImpl(input);
  }


  createExactSpanModelMemoryRevision(input: CreateExactSpanModelMemoryInput): Promise<CreateExactSpanModelMemoryResult> {
    this.exactSpanRevisionCalls += 1;
    return this.exactSpanRevisionImpl(input);
  }
  createToolSaveMemoryRevision(input: CreateToolSaveMemoryInput): Promise<CreateToolSaveMemoryResult> {
    this.toolSaveRevisionCalls += 1;
    return this.toolSaveRevisionImpl(input);
  }
  searchProjectMemories(input: SearchProjectMemoriesInput): Promise<SearchProjectMemoriesResult> {
    this.searchCalls += 1;
    return this.searchImpl(input);
  }
  listRecentProjectMemories(input: ListRecentProjectMemoriesInput): Promise<ListRecentProjectMemoriesResult> {
    this.recentMemoriesCalls += 1;
    return this.recentMemoriesImpl(input);
  }
  applyMemoryOperation(input: MemoryOperationInput): Promise<MemoryOperationResult> {
    this.memoryOperationCalls += 1;
    return this.memoryOperationImpl(input);
  }
  runDueAutomaticReflections(input: RunDueAutomaticReflectionsInput): Promise<RunDueAutomaticReflectionsResult> {
    this.automaticReflectionCalls += 1;
    return this.runAutomaticReflectionImpl(input);
  }

  close(timeoutMs: number): Promise<void> {
    this.closeCalls += 1;
    this.closeTimeouts.push(timeoutMs);
    return this.closeImpl(timeoutMs);
  }
}

function readyCore(store = new ControlledStore(), shutdown_timeout_ms = 50): { core: MemoryCore; store: ControlledStore } {
  return { core: new MemoryCore({ store, shutdown_timeout_ms }), store };
}

function expectedHealth(state: MemoryCoreHealth["state"], database: string | null, items: readonly string[], message: MemoryCoreHealth["message"]): MemoryCoreHealth {
  return { state, database, constraints: [...items], message };
}

async function expectNoUnhandled<T>(action: () => Promise<T>): Promise<T> {
  const reasons: unknown[] = [];
  const handler = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", handler);
  try {
    const result = await action();
    await flushMicrotasks();
    expect(reasons).toEqual([]);
    return result;
  } finally {
    process.off("unhandledRejection", handler);
  }
}

describe("MemoryCore facade", () => {
  test("starts with the exact starting health snapshot and supports default construction", () => {
    const core = new MemoryCore();
    expect(core.health()).toEqual(expectedHealth("starting", null, [], "Memory core is starting."));
  });

  test("rejects invalid shutdown timeout values synchronously", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new MemoryCore({ store: new ControlledStore(), shutdown_timeout_ms: value } as never)).toThrow(TypeError);
    }
  });

  test("rejects configPath together with an injected store", () => {
    expect(() => new MemoryCore({ configPath: "secret/config.toml", store: new ControlledStore() } as never)).toThrow(TypeError);
  });

  const initializationCases: Array<[string, MemoryStoreHealth, MemoryCoreHealth]> = [
    ["connected", connectedHealth, expectedHealth("ready", "neo4j", constraints, "Memory core is ready.")],
    ["disabled", { status: "disabled", database: null, constraints: [] }, expectedHealth("degraded", null, [], "Memory core is degraded.")],
    ["error", { status: "error", database: null, constraints: [] }, expectedHealth("degraded", null, [], "Memory core is degraded.")],
    ["closed", { status: "closed", database: null, constraints: [] }, expectedHealth("degraded", null, [], "Memory core is degraded.")],
  ];

  for (const [name, storeHealth, coreHealth] of initializationCases) {
    test(`initialization ${name} health maps to the public state and resolves undefined`, async () => {
      const store = new ControlledStore();
      store.initializeImpl = async () => storeHealth;
      const core = new MemoryCore({ store });
      const initialization: Promise<void> = core.initialize();
      await expect(initialization).resolves.toBeUndefined();
      expect(core.health()).toEqual(coreHealth);
    });
  }

  test("clones health snapshots instead of exposing mutable store or caller state", async () => {
    const sourceConstraints: string[] = [...constraints];
    const storeHealth = {
      status: "connected",
      database: "neo4j",
      constraints: sourceConstraints,
    } as unknown as MemoryStoreHealth;
    const store = new ControlledStore();
    store.initializeImpl = async () => storeHealth;
    const core = new MemoryCore({ store });

    await core.initialize();
    const first = core.health();
    first.state = "degraded";
    sourceConstraints.push("store-mutation");

    expect(core.health()).toEqual(expectedHealth("ready", "neo4j", constraints, "Memory core is ready."));
    expect(first.constraints).not.toBe(core.health().constraints);
  });

  test("close consumes a late initialization rejection without publishing degraded data", async () => {
    const gate = deferred<MemoryStoreHealth>();
    const store = new ControlledStore();
    store.initializeImpl = () => gate.promise;
    const core = new MemoryCore({ store, shutdown_timeout_ms: 15 });
    const initializing = core.initialize();
    await flushMicrotasks();

    await core.close();
    gate.reject(new Error("late secret initialization failure"));
    await expectNoUnhandled(() => initializing);
    expect(core.health()).toEqual(expectedHealth("closed", null, [], "Memory core is closed."));
  });


  test("initialize is idempotent, caches one Promise<void>, and initializes the store once", async () => {
    const gate = deferred<MemoryStoreHealth>();
    const store = new ControlledStore();
    store.initializeImpl = () => gate.promise;
    const core = new MemoryCore({ store });

    const initialization: Promise<void> = core.initialize();
    const second = core.initialize();
    expect(second).toBe(initialization);
    await flushMicrotasks();
    expect(store.initializeCalls).toBe(1);
    gate.resolve(connectedHealth);
    await expect(initialization).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    const third = core.initialize();
    expect(third).toBe(initialization);
    await expect(third).resolves.toBeUndefined();
    expect(store.initializeCalls).toBe(1);
    expect(core.health().state).toBe("ready");
  });

  test("an initialization rejection enters degraded state with a fixed sanitized snapshot", async () => {
    const store = new ControlledStore();
    store.initializeImpl = async () => {
      throw new Error("bolt://secret-user:secret-password@host/private-database");
    };
    const core = new MemoryCore({ store });

    await expectNoUnhandled(() => core.initialize());
    expect(core.health()).toEqual(expectedHealth("degraded", null, [], "Memory core is degraded."));
    expect(JSON.stringify(core.health())).not.toContain("secret-password");
  });

  test("operations admitted after ready pass through every process result union member", async () => {
    const results: ProcessSessionResult[] = [
      processedResult,
      { status: "up_to_date", project_uid: validProcessInput.project_uid, session_uid: validProcessInput.session_uid, through_ingest_sequence: 3 },
      { status: "indeterminate", project_uid: validProcessInput.project_uid, session_uid: validProcessInput.session_uid, message: "outcome is unknown" },
      { status: "failed", code: "invalid_input", message: "Memory store input is invalid." },
      { status: "failed", code: "not_found", message: "Requested Capture entity was not found." },
      { status: "failed", code: "source_incomplete", message: "Capture source is incomplete." },
      { status: "failed", code: "identity_conflict", message: "Memory identity or provenance conflicts with Capture." },
      { status: "failed", code: "core_degraded", message: "Memory store is degraded." },
      { status: "failed", code: "core_closed", message: "Memory store is closed." },
      { status: "failed", code: "database_error", message: "Memory write failed." },
    ];
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.processImpl = async () => results.shift()!;

    for (const expected of results.slice()) {
      await expect(core.processSession(validProcessInput)).resolves.toEqual(expected);
    }
  });

  test("operations admitted after ready pass through every continuation result union member", async () => {
    const results: RecordSessionContinuationResult[] = [
      { status: "written", decision_uid: "523e4567-e89b-42d3-a456-426614174004" },
      { status: "duplicate", decision_uid: "623e4567-e89b-42d3-a456-426614174005" },
      { status: "indeterminate", decision_uid: "723e4567-e89b-42d3-a456-426614174006", message: "outcome is unknown" },
      { status: "failed", code: "invalid_input", message: "Continuation evidence is invalid." },
      { status: "failed", code: "not_found", message: "Requested Capture entity was not found." },
      { status: "failed", code: "source_incomplete", message: "Capture source is incomplete." },
      { status: "failed", code: "evidence_invalid", message: "Continuation evidence is invalid." },
      { status: "failed", code: "identity_conflict", message: "Memory identity or provenance conflicts with Capture." },
      { status: "failed", code: "core_degraded", message: "Memory store is degraded." },
      { status: "failed", code: "core_closed", message: "Memory store is closed." },
      { status: "failed", code: "database_error", message: "Memory write failed." },
    ];
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.continuationImpl = async () => results.shift()!;
    const expected = [...results];

    for (const item of expected) {
      await expect(core.recordSessionContinuation(validContinuationInput)).resolves.toEqual(item);
    }
  });

  test("operations admitted after ready pass through every materialization result union member", async () => {
    const results: MaterializeEpisodeResult[] = [
      materializedResult,
      {
        status: "duplicate",
        decision_uid: "c23e4567-e89b-42d3-a456-426614174011",
        episode_uid: "b23e4567-e89b-42d3-a456-426614174010",
        state: "stable_ended",
        revision: 2,
        windows_assigned: 0,
        evidence_links_created: 0,
      },
      {
        status: "indeterminate",
        decision_uid: "d23e4567-e89b-42d3-a456-426614174012",
        episode_uid: "b23e4567-e89b-42d3-a456-426614174013",
        message: "outcome is unknown",
      },
      { status: "failed", code: "invalid_input", message: "Episode input is invalid." },
      { status: "failed", code: "not_found", message: "Requested Episode source was not found." },
      { status: "failed", code: "source_incomplete", message: "Episode source is incomplete." },
      { status: "failed", code: "evidence_invalid", message: "Episode evidence is invalid." },
      { status: "failed", code: "identity_conflict", message: "Episode identity or provenance conflicts." },
      { status: "failed", code: "invalid_transition", message: "Episode transition is invalid." },
      { status: "failed", code: "core_degraded", message: "Memory store is degraded." },
      { status: "failed", code: "core_closed", message: "Memory store is closed." },
      { status: "failed", code: "database_error", message: "Memory write failed." },
    ];
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.materializeImpl = async () => results.shift()!;
    const expected = [...results];

    for (const item of expected) {
      await expect(core.materializeEpisode(validMaterializeInput)).resolves.toEqual(item);
    }
    expect(store.materializeCalls).toBe(expected.length);
  });

  test("materialization passes the input through without changing the caller input", async () => {
    const callerInput: MaterializeEpisodeInput = {
      ...validMaterializeInput,
      window_uids: [...validMaterializeInput.window_uids] as readonly [string, ...string[]],
      closure: { ...validMaterializeInput.closure },
    };
    const before = structuredClone(callerInput);
    let received: MaterializeEpisodeInput | undefined;
    const store = new ControlledStore();
    store.materializeImpl = async (input) => {
      received = input;
      return materializedResult;
    };
    const core = new MemoryCore({ store });
    await core.initialize();

    await expect(core.materializeEpisode(callerInput)).resolves.toEqual(materializedResult);
    expect(store.materializeCalls).toBe(1);
    expect(received).toEqual(callerInput);
    expect(callerInput).toEqual(before);
  });

  test("starting operations fail immediately without calling the store, then explicit initialization enables passthrough", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    const startingProcess = core.processSession(validProcessInput);
    const startingContinuation = core.recordSessionContinuation(validContinuationInput);
    const startingMaterialization = core.materializeEpisode(validMaterializeInput);
    expect(store.initializeCalls).toBe(0);
    expect(store.processCalls).toBe(0);
    expect(store.continuationCalls).toBe(0);
    expect(store.materializeCalls).toBe(0);
    expect(store.closeCalls).toBe(0);
    expect(core.health()).toEqual(expectedHealth("starting", null, [], "Memory core is starting."));

    await expect(startingProcess).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await expect(startingContinuation).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await expect(startingMaterialization).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.initializeCalls).toBe(0);
    expect(store.processCalls).toBe(0);
    expect(store.continuationCalls).toBe(0);
    expect(store.materializeCalls).toBe(0);
    expect(store.closeCalls).toBe(0);
    expect(core.health()).toEqual(expectedHealth("starting", null, [], "Memory core is starting."));

    const initialization: Promise<void> = core.initialize();
    await expect(initialization).resolves.toBeUndefined();
    expect(core.health()).toEqual(expectedHealth("ready", "neo4j", constraints, "Memory core is ready."));
    await expect(core.processSession(validProcessInput)).resolves.toEqual(processedResult);
    await expect(core.recordSessionContinuation(validContinuationInput)).resolves.toEqual(continuationWritten);
    await expect(core.materializeEpisode(validMaterializeInput)).resolves.toEqual(materializedResult);
    expect(store.initializeCalls).toBe(1);
    expect(store.processCalls).toBe(1);
    expect(store.continuationCalls).toBe(1);
    expect(store.materializeCalls).toBe(1);
  });

  test("degraded lifecycle gates all operations without calling the store", async () => {
    const store = new ControlledStore();
    store.initializeImpl = async () => ({ status: "error", database: null, constraints: [] });
    const core = new MemoryCore({ store });
    const initialization: Promise<void> = core.initialize();
    await expect(initialization).resolves.toBeUndefined();

    expect(core.health()).toEqual(expectedHealth("degraded", null, [], "Memory core is degraded."));
    await expect(core.processSession(validProcessInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await expect(core.recordSessionContinuation(validContinuationInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await expect(core.materializeEpisode(validMaterializeInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.processCalls).toBe(0);
    expect(store.continuationCalls).toBe(0);
    expect(store.materializeCalls).toBe(0);
  });

  test("store operation throws and rejects become one fixed sanitized database error", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.processImpl = async () => {
      throw new Error("neo4j://secret-user:secret-password/private-cypher");
    };
    store.continuationImpl = async () => Promise.reject(new Error("raw native payload secret"));
    store.materializeImpl = () => {
      throw new Error("bolt://episode-secret-user:episode-secret-password/episode-database");
    };

    await expect(core.processSession(validProcessInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    await expect(core.recordSessionContinuation(validContinuationInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    const syncMaterializeResult = await core.materializeEpisode(validMaterializeInput);
    expect(syncMaterializeResult).toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    expect(JSON.stringify(syncMaterializeResult)).not.toContain("episode-secret-password");
    store.materializeImpl = () => Promise.reject(new Error("raw episode native payload episode-reject-secret"));
    const asyncMaterializeResult = await core.materializeEpisode(validMaterializeInput);
    expect(asyncMaterializeResult).toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    expect(JSON.stringify(asyncMaterializeResult)).not.toContain("episode-reject-secret");
    expect(JSON.stringify(await core.processSession(validProcessInput))).not.toContain("secret-password");
  });

  test("close is immediate, idempotent, invokes Store.close once, and gates post-close operations", async () => {
    const { core, store } = readyCore();
    await core.initialize();
    const firstClose = core.close();
    const secondClose = core.close();
    const postAdmissionMaterialization = core.materializeEpisode(validMaterializeInput);

    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(store.closeCalls).toBe(1);
    expect(store.closeTimeouts[0]).toBeGreaterThan(0);
    expect(core.health()).toEqual(expectedHealth("closed", null, [], "Memory core is closed."));
    await expect(core.processSession(validProcessInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    await expect(core.recordSessionContinuation(validContinuationInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    await expect(postAdmissionMaterialization).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    expect(store.processCalls).toBe(0);
    expect(store.continuationCalls).toBe(0);
    expect(store.materializeCalls).toBe(0);
  });

  test("close during initialization is bounded and late initialization cannot publish ready", async () => {
    const gate = deferred<MemoryStoreHealth>();
    const store = new ControlledStore();
    store.initializeImpl = () => gate.promise;
    const core = new MemoryCore({ store, shutdown_timeout_ms: 15 });
    const initializing = core.initialize();
    await flushMicrotasks();

    const started = performance.now();
    const closing = core.close();
    await closing;
    expect(performance.now() - started).toBeLessThan(250);
    expect(store.closeCalls).toBe(1);
    expect(core.health()).toEqual(expectedHealth("closed", null, [], "Memory core is closed."));

    gate.resolve(connectedHealth);
    await expectNoUnhandled(() => initializing);
    expect(core.health()).toEqual(expectedHealth("closed", null, [], "Memory core is closed."));
  });

  test("close during a pending process preserves its admitted real result after the close boundary", async () => {
    const gate = deferred<ProcessSessionResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.processImpl = () => gate.promise;
    const operation = core.processSession(validProcessInput);
    await flushMicrotasks();

    const closing = core.close();
    await closing;
    gate.resolve(processedResult);
    await expectNoUnhandled(async () => operation).then((result) => expect(result).toEqual(processedResult));
    expect(store.processCalls).toBe(1);
  });

  test("close during a pending continuation preserves its admitted real result after the close boundary", async () => {
    const gate = deferred<RecordSessionContinuationResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.continuationImpl = () => gate.promise;
    const operation = core.recordSessionContinuation(validContinuationInput);
    await flushMicrotasks();

    const closing = core.close();
    await closing;
    gate.resolve(continuationWritten);
    await expectNoUnhandled(async () => operation).then((result) => expect(result).toEqual(continuationWritten));
    expect(store.continuationCalls).toBe(1);
  });

  test("close during a pending materialization preserves its admitted real result after the close boundary", async () => {
    const gate = deferred<MaterializeEpisodeResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.materializeImpl = () => gate.promise;
    const operation = core.materializeEpisode(validMaterializeInput);
    await flushMicrotasks();

    const closing = core.close();
    await closing;
    gate.resolve(materializedResult);
    await expectNoUnhandled(async () => operation).then((result) => expect(result).toEqual(materializedResult));
    expect(store.materializeCalls).toBe(1);
  });

  test("pending operation rejection after close is consumed and sanitized", async () => {
    const gate = deferred<ProcessSessionResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.processImpl = () => gate.promise;
    const operation = core.processSession(validProcessInput);
    await flushMicrotasks();
    await core.close();

    gate.reject(new Error("secret driver URI and cypher").message);
    await expectNoUnhandled(async () => {
      await expect(operation).resolves.toEqual({
        status: "failed",
        code: "database_error",
        message: "Memory store operation failed.",
      });
    });
  });

  test("a permanently pending Store.close times out on one monotonic bounded deadline and consumes late rejection", async () => {
    const closeGate = deferred<void>();
    const { core, store } = readyCore();
    await core.initialize();
    store.closeImpl = () => closeGate.promise;

    const started = performance.now();
    const firstClose = core.close();
    const secondClose = core.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(performance.now() - started).toBeLessThan(250);
    expect(core.health().state).toBe("closed");
    expect(store.closeCalls).toBe(1);

    closeGate.reject(new Error("secret late close failure"));
    await flushMicrotasks();
    await expectNoUnhandled(() => core.close());
  });

  test("close consumes an immediate Store.close rejection and still completes closed", async () => {
    const { core, store } = readyCore();
    await core.initialize();
    store.closeImpl = async () => {
      throw new Error("secret close URI");
    };

    await expectNoUnhandled(() => core.close());
    expect(core.health()).toEqual(expectedHealth("closed", null, [], "Memory core is closed."));
    expect(store.closeCalls).toBe(1);
  });

  test("same-tick admission before close receives the Store result instead of core_closed", async () => {
    const gate = deferred<ProcessSessionResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.processImpl = () => gate.promise;

    const operation = core.processSession(validProcessInput);
    const closing = core.close();
    gate.resolve(processedResult);
    await expect(operation).resolves.toEqual(processedResult);
    await closing;
    expect(store.processCalls).toBe(1);
  });
  test("materializeExecutionUnits follows ready delegation, error containment, and close admission", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store, shutdown_timeout_ms: 50 });
    await expect(core.materializeExecutionUnits(validExecutionInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await core.initialize();
    const callerInput = { ...validExecutionInput };
    await expect(core.materializeExecutionUnits(callerInput)).resolves.toEqual(executionResult);
    expect(store.executionCalls).toBe(1);
    expect(callerInput).toEqual(validExecutionInput);

    store.materializeExecutionImpl = () => { throw new Error("neo4j://execution-secret"); };
    await expect(core.materializeExecutionUnits(validExecutionInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    expect(JSON.stringify(await core.materializeExecutionUnits(validExecutionInput))).not.toContain("execution-secret");

    const gate = deferred<MaterializeExecutionUnitsResult>();
    store.materializeExecutionImpl = () => gate.promise;
    const operation = core.materializeExecutionUnits(validExecutionInput);
    const closing = core.close();
    gate.resolve(executionResult);
    await expect(operation).resolves.toEqual(executionResult);
    await closing;
    expect(core.health().state).toBe("closed");
  });
  test("materializeExecutionReviewCandidates forwards, contains errors, and rejects degraded or closed admission", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store, shutdown_timeout_ms: 50 });
    await expect(core.materializeExecutionReviewCandidates(validReviewCandidateInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await core.initialize();
    await expect(core.materializeExecutionReviewCandidates({ ...validReviewCandidateInput })).resolves.toEqual(reviewCandidateResult);
    expect(store.reviewCandidateCalls).toBe(1);
    store.materializeReviewCandidateImpl = () => { throw new Error("neo4j://candidate-secret"); };
    await expect(core.materializeExecutionReviewCandidates(validReviewCandidateInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    await core.close();
    await expect(core.materializeExecutionReviewCandidates(validReviewCandidateInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
  });
  test("getTaskDigest forwards found results and contains degraded, store errors, and closed admission", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store, shutdown_timeout_ms: 50 });
    await expect(core.getTaskDigest(validTaskDigestInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    await core.initialize();
    await expect(core.getTaskDigest({ ...validTaskDigestInput })).resolves.toEqual(taskDigestResult);
    expect(store.taskDigestCalls).toBe(1);
    store.getTaskDigestImpl = () => { throw new Error("neo4j://digest-secret"); };
    await expect(core.getTaskDigest(validTaskDigestInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    await core.close();
    await expect(core.getTaskDigest(validTaskDigestInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
  });
  test("runDueAutomaticReflections follows lifecycle admission, delegation, and exception containment", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });

    await expect(core.runDueAutomaticReflections(validAutomaticInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.automaticReflectionCalls).toBe(0);

    await core.initialize();
    await expect(core.runDueAutomaticReflections({ ...validAutomaticInput })).resolves.toEqual(automaticReflectionResult);
    expect(store.automaticReflectionCalls).toBe(1);
    const ownershipFailure: RunDueAutomaticReflectionsResult = {
      status: "failed",
      code: "identity_conflict",
      message: "Project ownership scope is invalid.",
    };
    store.runAutomaticReflectionImpl = async () => ownershipFailure;
    await expect(core.runDueAutomaticReflections(validAutomaticInput)).resolves.toEqual(ownershipFailure);
    expect(store.automaticReflectionCalls).toBe(2);

    store.runAutomaticReflectionImpl = () => {
      throw new Error("neo4j://automatic-secret");
    };
    await expect(core.runDueAutomaticReflections(validAutomaticInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });

    await core.close();
    await expect(core.runDueAutomaticReflections(validAutomaticInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
  });

  test("rejects automatic configuration without an injected store capability", () => {
    const store = new ControlledStore();
    Object.defineProperty(store, "runDueAutomaticReflections", { value: undefined });
    expect(() => new MemoryCore({
      store,
      automaticReflection: { max_input_bytes: 65_536 },
    })).toThrow(TypeError);
  });

  test("legacy injected stores remain valid when automatic reflection is absent", async () => {
    const store = new ControlledStore();
    Object.defineProperty(store, "runDueAutomaticReflections", { value: undefined });
    const core = new MemoryCore({ store });
    await core.initialize();

    expect(core.health()).toEqual(expectedHealth("ready", "neo4j", constraints, "Memory core is ready."));
    await core.close();
  });

  test("missing automatic store capability maps to core_degraded", async () => {
    const store = new ControlledStore();
    Object.defineProperty(store, "runDueAutomaticReflections", { value: undefined });
    const core = new MemoryCore({ store });
    await core.initialize();

    await expect(core.runDueAutomaticReflections(validAutomaticInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.automaticReflectionCalls).toBe(0);
  });

  test("exact-span revision requires ready capability and gates calls before ready and after close", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await expect(core.createExactSpanModelMemoryRevision(validExactSpanInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.exactSpanRevisionCalls).toBe(0);

    await core.initialize();
    Object.defineProperty(store, "createExactSpanModelMemoryRevision", { value: undefined });
    await expect(core.createExactSpanModelMemoryRevision(validExactSpanInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.exactSpanRevisionCalls).toBe(0);
    await core.close();
    await expect(core.createExactSpanModelMemoryRevision(validExactSpanInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    expect(store.exactSpanRevisionCalls).toBe(0);
  });

  test("exact-span revision preserves Store results and method this binding", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    const input = structuredClone(validExactSpanInput);
    let received: CreateExactSpanModelMemoryInput | undefined;
    const results: CreateExactSpanModelMemoryResult[] = [
      exactSpanRevisionResult,
      { status: "indeterminate", decision_uid: input.decision_uid, message: "The write outcome is unknown." },
      { status: "failed", code: "confirmation_required", message: "User confirmation is required." },
    ];
    store.exactSpanRevisionImpl = async function (actualInput) {
      expect(this).toBe(store);
      received = actualInput;
      return results.shift()!;
    };

    const expectedResults = [...results];
    for (const expected of expectedResults) {
      await expect(core.createExactSpanModelMemoryRevision(input)).resolves.toEqual(expected);
    }
    expect(received).toBe(input);
    expect(input).toEqual(validExactSpanInput);
    expect(store.exactSpanRevisionCalls).toBe(3);
  });

  test("exact-span revision sanitizes synchronous throws and asynchronous rejections", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.exactSpanRevisionImpl = () => { throw new Error("neo4j://private-user:secret-password"); };
    await expect(core.createExactSpanModelMemoryRevision(validExactSpanInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    store.exactSpanRevisionImpl = () => Promise.reject(new Error("private rejected payload secret"));
    const result = await core.createExactSpanModelMemoryRevision(validExactSpanInput);
    expect(result).toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("close waits for an admitted exact-span revision without replacing its result", async () => {
    const gate = deferred<CreateExactSpanModelMemoryResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.exactSpanRevisionImpl = () => gate.promise;
    const operation = core.createExactSpanModelMemoryRevision(validExactSpanInput);
    const closing = core.close();
    gate.resolve(exactSpanRevisionResult);
    await expect(operation).resolves.toEqual(exactSpanRevisionResult);
    await closing;
    expect(store.exactSpanRevisionCalls).toBe(1);
    expect(core.health().state).toBe("closed");
    await expect(core.createExactSpanModelMemoryRevision(validExactSpanInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    expect(store.exactSpanRevisionCalls).toBe(1);
  });


  test("tool-save revision requires ready Store capability and gates calls", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await expect(core.createToolSaveMemoryRevision(validToolSaveInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.toolSaveRevisionCalls).toBe(0);

    const degradedStore = new ControlledStore();
    degradedStore.initializeImpl = async () => ({ status: "error", database: null, constraints: [] });
    const degradedCore = new MemoryCore({ store: degradedStore });
    await degradedCore.initialize();
    await expect(degradedCore.createToolSaveMemoryRevision(validToolSaveInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(degradedStore.toolSaveRevisionCalls).toBe(0);
    await degradedCore.close();

    await core.initialize();
    Object.defineProperty(store, "createToolSaveMemoryRevision", { value: undefined });
    await expect(core.createToolSaveMemoryRevision(validToolSaveInput)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      message: "Memory core is not ready.",
    });
    expect(store.toolSaveRevisionCalls).toBe(0);
    await core.close();
    await expect(core.createToolSaveMemoryRevision(validToolSaveInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    expect(store.toolSaveRevisionCalls).toBe(0);
  });

  test("tool-save revision passes through Store results and preserves input and decision UID", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    const input = structuredClone(validToolSaveInput);
    let received: CreateToolSaveMemoryInput | undefined;
    const results: CreateToolSaveMemoryResult[] = [
      toolSaveMemoryResult,
      { ...toolSaveMemoryResult, status: "duplicate" },
      { status: "indeterminate", decision_uid: input.decision_uid, message: "The write outcome is unknown." },
      { status: "failed", code: "confirmation_required", message: "User confirmation is required." },
    ];
    store.toolSaveRevisionImpl = async function (actualInput) {
      expect(this).toBe(store);
      received = actualInput;
      return results.shift()!;
    };

    const expectedResults = [...results];
    for (const expected of expectedResults) {
      await expect(core.createToolSaveMemoryRevision(input)).resolves.toEqual(expected);
    }
    expect(received).toBe(input);
    expect(input).toEqual(validToolSaveInput);
    expect(store.toolSaveRevisionCalls).toBe(4);
  });

  test("tool-save revision sanitizes synchronous throws and asynchronous rejections", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.toolSaveRevisionImpl = () => { throw new Error("neo4j://private-user:secret-password"); };
    await expect(core.createToolSaveMemoryRevision(validToolSaveInput)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    store.toolSaveRevisionImpl = () => Promise.reject(new Error("private rejected payload secret"));
    const result = await core.createToolSaveMemoryRevision(validToolSaveInput);
    expect(result).toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("close waits for an admitted tool-save revision without replacing its result", async () => {
    const gate = deferred<CreateToolSaveMemoryResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.toolSaveRevisionImpl = () => gate.promise;
    const operation = core.createToolSaveMemoryRevision(validToolSaveInput);
    const closing = core.close();
    gate.resolve(toolSaveMemoryResult);
    await expect(operation).resolves.toEqual(toolSaveMemoryResult);
    await closing;
    expect(store.toolSaveRevisionCalls).toBe(1);
    expect(core.health().state).toBe("closed");
    await expect(core.createToolSaveMemoryRevision(validToolSaveInput)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      message: "Memory core is closed.",
    });
    expect(store.toolSaveRevisionCalls).toBe(1);
  });

  test("memory operations require a ready Store capability and preserve operation outcomes", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await expect(core.applyMemoryOperation(validMemoryOperationInput)).resolves.toEqual({
      status: "failed", code: "core_degraded", message: "Memory core is not ready.",
    });
    expect(store.memoryOperationCalls).toBe(0);

    await core.initialize();
    const input = structuredClone(validMemoryOperationInput);
    let received: MemoryOperationInput | undefined;
    const outcomes: MemoryOperationResult[] = [
      memoryOperationResult,
      { ...memoryOperationResult, status: "duplicate" },
      { status: "indeterminate", decision_uid: input.decision_uid, message: "The write outcome is unknown." },
    ];
    store.memoryOperationImpl = async function (actualInput) {
      expect(this).toBe(store);
      received = actualInput;
      return outcomes.shift()!;
    };
    for (const expected of [
      memoryOperationResult,
      { ...memoryOperationResult, status: "duplicate" },
      { status: "indeterminate", decision_uid: input.decision_uid, message: "The write outcome is unknown." },
    ] satisfies MemoryOperationResult[]) {
      await expect(core.applyMemoryOperation(input)).resolves.toEqual(expected);
    }
    expect(received).toBe(input);
    expect(input).toEqual(validMemoryOperationInput);
    expect(store.memoryOperationCalls).toBe(3);

    Object.defineProperty(store, "applyMemoryOperation", { value: undefined });
    await expect(core.applyMemoryOperation(input)).resolves.toEqual({
      status: "failed", code: "core_degraded", message: "Memory core is not ready.",
    });
    await core.close();
    await expect(core.applyMemoryOperation(input)).resolves.toEqual({
      status: "failed", code: "core_closed", message: "Memory core is closed.",
    });
    expect(store.memoryOperationCalls).toBe(3);
  });

  test("memory operation failures sanitize unexpected Store errors", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.memoryOperationImpl = () => { throw new Error("neo4j://private-user:secret"); };
    await expect(core.applyMemoryOperation(validMemoryOperationInput)).resolves.toEqual({
      status: "failed", code: "database_error", message: "Memory store operation failed.",
    });
    store.memoryOperationImpl = () => Promise.reject(new Error("private operation text"));
    const result = await core.applyMemoryOperation(validMemoryOperationInput);
    expect(result).toEqual({ status: "failed", code: "database_error", message: "Memory store operation failed." });
    expect(JSON.stringify(result)).not.toContain("private operation text");
    await core.close();
  });

  test("search returns current Project memories only when the Store is ready", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await expect(core.searchProjectMemories(validSearchInput)).resolves.toEqual({
      status: "failed", code: "core_degraded", message: "Memory core is not ready.",
    });
    expect(store.searchCalls).toBe(0);
    await core.initialize();
    await expect(core.searchProjectMemories(validSearchInput)).resolves.toEqual(projectSearchResult);
    expect(store.searchCalls).toBe(1);
    Object.defineProperty(store, "searchProjectMemories", { value: undefined });
    await expect(core.searchProjectMemories(validSearchInput)).resolves.toEqual({
      status: "failed", code: "core_degraded", message: "Memory core is not ready.",
    });
    await core.close();
    await expect(core.searchProjectMemories(validSearchInput)).resolves.toEqual({
      status: "failed", code: "core_closed", message: "Memory core is closed.",
    });
    expect(store.searchCalls).toBe(1);
  });

  test("search preserves Store failure and sanitizes rejected or thrown reads", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await core.initialize();
    store.searchImpl = async () => ({ status: "failed", code: "identity_conflict", message: "Memory identity conflicts with Capture." });
    await expect(core.searchProjectMemories(validSearchInput)).resolves.toMatchObject({
      status: "failed", code: "identity_conflict",
    });
    store.searchImpl = () => { throw new Error("neo4j://private-user:secret"); };
    await expect(core.searchProjectMemories(validSearchInput)).resolves.toEqual({
      status: "failed", code: "database_error", message: "Memory store operation failed.",
    });
    store.searchImpl = async () => { throw new Error("private memory text"); };
    const failed = await core.searchProjectMemories(validSearchInput);
    expect(failed).toEqual({ status: "failed", code: "database_error", message: "Memory store operation failed." });
    expect(JSON.stringify(failed)).not.toContain("private memory text");
    await core.close();
  });

  test("close waits for admitted search and preserves its Store result", async () => {
    const pending = deferred<SearchProjectMemoriesResult>();
    const { core, store } = readyCore();
    await core.initialize();
    store.searchImpl = () => pending.promise;
    const operation = core.searchProjectMemories(validSearchInput);
    const closing = core.close();
    pending.resolve(projectSearchResult);
    await expect(operation).resolves.toEqual(projectSearchResult);
    await closing;
    expect(store.searchCalls).toBe(1);
  });

  test("recent Project memories require a ready Store, forward inputs, and sanitize failures", async () => {
    const store = new ControlledStore();
    const core = new MemoryCore({ store });
    await expect(core.listRecentProjectMemories(validRecentMemoriesInput)).resolves.toEqual({
      status: "failed", code: "core_degraded", message: "Memory core is not ready.",
    });
    expect(store.recentMemoriesCalls).toBe(0);
    await core.initialize();
    await expect(core.listRecentProjectMemories(validRecentMemoriesInput)).resolves.toEqual(recentMemoriesResult);
    expect(store.recentMemoriesCalls).toBe(1);
    store.recentMemoriesImpl = () => { throw new Error("private recent memory text"); };
    const failed = await core.listRecentProjectMemories(validRecentMemoriesInput);
    expect(failed).toEqual({ status: "failed", code: "database_error", message: "Memory store operation failed." });
    expect(JSON.stringify(failed)).not.toContain("private recent memory text");
    Object.defineProperty(store, "listRecentProjectMemories", { value: undefined });
    await expect(core.listRecentProjectMemories(validRecentMemoriesInput)).resolves.toEqual({
      status: "failed", code: "core_degraded", message: "Memory core is not ready.",
    });
    await core.close();
    await expect(core.listRecentProjectMemories(validRecentMemoriesInput)).resolves.toEqual({
      status: "failed", code: "core_closed", message: "Memory core is closed.",
    });
  });

  test("validates automatic configuration synchronously and starts only after connected initialization", async () => {
    for (const max_input_bytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_048_577]) {
      expect(() => new MemoryCore({
        store: new ControlledStore(),
        automaticReflection: { max_input_bytes },
      } as never)).toThrow(TypeError);
    }
    expect(() => new MemoryCore({
      automaticReflection: { max_input_bytes: 65_536 },
    })).toThrow(TypeError);


    const degradedStore = new ControlledStore();
    degradedStore.initializeImpl = async () => ({ status: "error", database: null, constraints: [] });
    const degradedCore = new MemoryCore({
      store: degradedStore,
      automaticReflection: { max_input_bytes: 65_536 },
    });
    await degradedCore.initialize();
    await flushMicrotasks();
    expect(degradedStore.automaticReflectionCalls).toBe(0);
    await degradedCore.close();

    const connectedStore = new ControlledStore();
    const connectedCore = new MemoryCore({
      store: connectedStore,
      automaticReflection: { max_input_bytes: 65_536 },
    });
    expect(connectedStore.automaticReflectionCalls).toBe(0);
    await connectedCore.initialize();
    await flushMicrotasks();
    expect(connectedStore.automaticReflectionCalls).toBe(1);
    await connectedCore.close();
  });

  test("close stops scheduling and waits for an active automatic run", async () => {
    const gate = deferred<RunDueAutomaticReflectionsResult>();
    const store = new ControlledStore();
    store.runAutomaticReflectionImpl = () => gate.promise;
    const core = new MemoryCore({
      store,
      shutdown_timeout_ms: 50,
      automaticReflection: { max_input_bytes: 65_536 },
    });
    await core.initialize();
    await flushMicrotasks();
    expect(store.automaticReflectionCalls).toBe(1);

    const closing = core.close();
    gate.resolve(automaticReflectionResult);
    await closing;
    expect(store.closeCalls).toBe(1);
    expect(core.health().state).toBe("closed");
  });
});
