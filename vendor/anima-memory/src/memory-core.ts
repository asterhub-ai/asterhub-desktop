import { AutomaticReflectionScheduler } from "./automatic-reflection-scheduler.ts";
import type { RunDueAutomaticReflectionsInput, RunDueAutomaticReflectionsResult } from "./automatic-reflection-types.ts";
import { Neo4jMemoryStore } from "./neo4j-memory-store.ts";
import type {
  AutomaticReflectionOptions,
  CreateExactSpanModelMemoryInput,
  CreateExactSpanModelMemoryResult,
  CreateToolSaveMemoryInput,
  CreateToolSaveMemoryResult,
  MemoryOperationInput,
  MemoryOperationResult,
  SearchProjectMemoriesInput,
  SearchProjectMemoriesResult,
  ListRecentProjectMemoriesInput,
  ListRecentProjectMemoriesResult,
  ListProjectReflectionsInput,
  ListProjectReflectionsResult,
  ListSessionReviewCandidatesInput,
  ListSessionReviewCandidatesResult,
  GetTaskDigestInput,
  GetTaskDigestResult,
  MemoryCoreHealth,
  MemoryCoreOptions,
  MemoryStore,
  MemoryStoreHealth,
  MaterializeExecutionReviewCandidatesInput,
  MaterializeExecutionReviewCandidatesResult,
  MaterializeExecutionUnitsInput,
  MaterializeExecutionUnitsResult,
  ProcessSessionInput,
  ProcessSessionResult,
  RecordSessionContinuationInput,
  RecordSessionContinuationResult,
  ReflectManualCandidateInput,
  ReflectManualCandidateResult,
} from "./types.ts";
import type { MaterializeEpisodeInput, MaterializeEpisodeResult } from "./episode-types.ts";
import type { ExecutionReviewModelAdapter, ExecutionReviewOperationResult, ReviewExecutionCandidateInput, ReflectionModelAdapter } from "./types.ts";
import type { ProjectOwnershipScope } from "./project-ownership.ts";

const STARTING_MESSAGE = "Memory core is starting." as const;
const READY_MESSAGE = "Memory core is ready." as const;
const DEGRADED_MESSAGE = "Memory core is degraded." as const;
const CLOSED_MESSAGE = "Memory core is closed." as const;
const NOT_READY_MESSAGE = "Memory core is not ready." as const;
const DATABASE_ERROR_MESSAGE = "Memory store operation failed." as const;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1500;

export class MemoryCore {
  private readonly store: MemoryStore;
  private readonly shutdownTimeoutMs: number;
  private readonly automaticReflectionScheduler?: AutomaticReflectionScheduler;
  private state: MemoryCoreHealth["state"] = "starting";
  private database: string | null = null;
  private constraints: string[] = [];
  private initialization?: Promise<void>;
  private closePromise?: Promise<void>;
  private readonly inFlight = new Set<Promise<unknown>>();
  private admissionClosed = false;
  constructor(options: MemoryCoreOptions = {}) {
    const configured = options as {
      configPath?: string;
      shutdown_timeout_ms?: number;
      store?: MemoryStore;
      reviewModelAdapter?: ExecutionReviewModelAdapter;
      review_model_adapter?: ExecutionReviewModelAdapter;
      reflectionModelAdapter?: ReflectionModelAdapter;
      reflection_model_adapter?: ReflectionModelAdapter;
      automaticReflection?: AutomaticReflectionOptions;
      projectOwnership?: ProjectOwnershipScope;
    };
    const injectedStore = configured.store !== undefined;
    if (injectedStore && configured.projectOwnership !== undefined) {
      throw new TypeError("projectOwnership cannot be used with an injected store.");
    }
    const reflectionModelAdapter = configured.reflectionModelAdapter ?? configured.reflection_model_adapter;
    if (injectedStore && configured.configPath !== undefined) {
      throw new TypeError("configPath cannot be used with an injected store.");
    }

    const timeout = configured.shutdown_timeout_ms ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new TypeError("shutdown_timeout_ms must be a positive safe integer.");
    }
    this.shutdownTimeoutMs = timeout;
    this.store = configured.store ?? new Neo4jMemoryStore({
      configPath: configured.configPath,
      shutdown_timeout_ms: timeout,
      reviewModelAdapter: configured.reviewModelAdapter ?? configured.review_model_adapter,
      reflectionModelAdapter,
      projectOwnership: configured.projectOwnership,
    });
    if (configured.automaticReflection !== undefined) {
      if (injectedStore) {
        if (typeof this.store.runDueAutomaticReflections !== "function") {
          throw new TypeError("automaticReflection requires an injected store with runDueAutomaticReflections.");
        }
      } else if (reflectionModelAdapter === undefined) {
        throw new TypeError("automaticReflection requires a reflection model adapter with the default store.");
      }
      this.automaticReflectionScheduler = new AutomaticReflectionScheduler({
        max_input_bytes: configured.automaticReflection.max_input_bytes,
        run: (input) => this.runDueAutomaticReflections(input),
      });
    }
  }

  health(): MemoryCoreHealth {
    return {
      state: this.state,
      database: this.database,
      constraints: [...this.constraints],
      message: this.message(),
    };
  }

  initialize(): Promise<void> {
    if (this.initialization !== undefined) return this.initialization;
    if (this.state === "closed") {
      this.initialization = Promise.resolve();
      return this.initialization;
    }

    let storeInitialization: Promise<MemoryStoreHealth>;
    try {
      storeInitialization = Promise.resolve(this.store.initialize());
    } catch {
      storeInitialization = Promise.reject(undefined);
    }

    this.initialization = storeInitialization.then(
      (storeHealth) => {
        this.publishInitialization(storeHealth);
      },
      () => {
        this.publishInitializationFailure();
      },
    );
    return this.initialization;
  }

  processSession(input: ProcessSessionInput): Promise<ProcessSessionResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedProcessResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedProcessResult());
    return this.invokeProcess(input);
  }

  recordSessionContinuation(input: RecordSessionContinuationInput): Promise<RecordSessionContinuationResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedContinuationResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedContinuationResult());
    return this.invokeContinuation(input);
  }

  materializeEpisode(input: MaterializeEpisodeInput): Promise<MaterializeEpisodeResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedMaterializeEpisodeResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedMaterializeEpisodeResult());
    return this.invokeMaterializeEpisode(input);
  }
  materializeExecutionUnits(input: MaterializeExecutionUnitsInput): Promise<MaterializeExecutionUnitsResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedMaterializeExecutionUnitsResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedMaterializeExecutionUnitsResult());
    return this.invokeMaterializeExecutionUnits(input);
  }
  getTaskDigest(input: GetTaskDigestInput): Promise<GetTaskDigestResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedTaskDigestResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedTaskDigestResult());
    return this.invokeTaskDigest(input);
  }

  createExactSpanModelMemoryRevision(input: CreateExactSpanModelMemoryInput): Promise<CreateExactSpanModelMemoryResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedExactSpanModelMemoryRevisionResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedExactSpanModelMemoryRevisionResult());
    return this.invokeExactSpanModelMemoryRevision(input);
  }

  createToolSaveMemoryRevision(input: CreateToolSaveMemoryInput): Promise<CreateToolSaveMemoryResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedToolSaveMemoryRevisionResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedToolSaveMemoryRevisionResult());
    return this.invokeToolSaveMemoryRevision(input);
  }

  searchProjectMemories(input: SearchProjectMemoriesInput): Promise<SearchProjectMemoriesResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedSearchProjectMemoriesResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedSearchProjectMemoriesResult());
    return this.invokeSearchProjectMemories(input);
  }

  listRecentProjectMemories(input: ListRecentProjectMemoriesInput): Promise<ListRecentProjectMemoriesResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedListRecentProjectMemoriesResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedListRecentProjectMemoriesResult());
    return this.invokeListRecentProjectMemories(input);
  }
  listProjectReflections(input: ListProjectReflectionsInput): Promise<ListProjectReflectionsResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve({ status: "failed", code: "core_closed", message: CLOSED_MESSAGE });
    if (this.state !== "ready") return Promise.resolve({ status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE });
    const read = this.store.listProjectReflections;
    if (read === undefined) return Promise.resolve({ status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE });
    try {
      return this.track(Promise.resolve(read.call(this.store, input)).catch(() => ({
        status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE,
      } as const)));
    } catch {
      return Promise.resolve({ status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE });
    }
  }

  listSessionReviewCandidates(input: ListSessionReviewCandidatesInput): Promise<ListSessionReviewCandidatesResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve({ status: "failed", code: "core_closed", message: CLOSED_MESSAGE });
    if (this.state !== "ready") return Promise.resolve({ status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE });
    const list = this.store.listSessionReviewCandidates;
    if (list === undefined) return Promise.resolve({ status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE });
    try {
      return this.track(Promise.resolve(list.call(this.store, input)).catch(() => ({
        status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE,
      } as const)));
    } catch {
      return Promise.resolve({ status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE });
    }
  }

  applyMemoryOperation(input: MemoryOperationInput): Promise<MemoryOperationResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve({ status: "failed", code: "core_closed", message: CLOSED_MESSAGE });
    if (this.state !== "ready") return Promise.resolve({ status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE });
    const operation = this.store.applyMemoryOperation;
    if (operation === undefined) return Promise.resolve({ status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE });
    try {
      return this.track(Promise.resolve(operation.call(this.store, input)).catch(() => ({ status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE })));
    } catch {
      return Promise.resolve({ status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE });
    }
  }



  materializeExecutionReviewCandidates(input: MaterializeExecutionReviewCandidatesInput): Promise<MaterializeExecutionReviewCandidatesResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedMaterializeExecutionReviewCandidatesResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedMaterializeExecutionReviewCandidatesResult());
    return this.invokeMaterializeExecutionReviewCandidates(input);
  }


  reviewExecutionCandidate(input: ReviewExecutionCandidateInput): Promise<ExecutionReviewOperationResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedReviewExecutionCandidateResult(input.candidate_uid));
    if (this.state !== "ready") return Promise.resolve(this.degradedReviewExecutionCandidateResult(input.candidate_uid));
    return this.invokeReviewExecutionCandidate(input);
  }

  reflectManualCandidate(input: ReflectManualCandidateInput): Promise<ReflectManualCandidateResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedReflectManualCandidateResult(input.candidate_uid));
    if (this.state !== "ready") return Promise.resolve(this.degradedReflectManualCandidateResult(input.candidate_uid));
    return this.invokeReflectManualCandidate(input);
  }

  runDueAutomaticReflections(input: RunDueAutomaticReflectionsInput): Promise<RunDueAutomaticReflectionsResult> {
    if (this.state === "closed" || this.admissionClosed) return Promise.resolve(this.closedAutomaticReflectionResult());
    if (this.state !== "ready") return Promise.resolve(this.degradedAutomaticReflectionResult());
    return this.invokeAutomaticReflections(input);
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;

    this.automaticReflectionScheduler?.close();
    this.admissionClosed = true;
    this.state = "closed";
    this.database = null;
    this.constraints = [];

    let resolveClose!: () => void;
    this.closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    const deadline = performance.now() + this.shutdownTimeoutMs;
    const remaining = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(1, Math.ceil(deadline - performance.now())),
    );

    let storeClose: Promise<unknown>;
    try {
      storeClose = Promise.resolve(this.store.close(remaining));
    } catch {
      storeClose = Promise.resolve();
    }

    const pending: Promise<unknown>[] = [storeClose];
    if (this.initialization !== undefined) pending.push(this.initialization);
    pending.push(...this.inFlight);

    Promise.all(pending.map((promise) => this.waitUntilDeadline(promise, deadline)))
      .then(() => resolveClose(), () => resolveClose());

    return this.closePromise;
  }



  private invokeProcess(input: ProcessSessionInput): Promise<ProcessSessionResult> {
    let operation: Promise<ProcessSessionResult>;
    try {
      operation = Promise.resolve(this.store.processSession(input)).then(
        (result) => result,
        () => this.databaseErrorProcessResult(),
      );
    } catch {
      operation = Promise.resolve(this.databaseErrorProcessResult());
    }
    return this.track(operation);
  }

  private invokeContinuation(input: RecordSessionContinuationInput): Promise<RecordSessionContinuationResult> {
    let operation: Promise<RecordSessionContinuationResult>;
    try {
      operation = Promise.resolve(this.store.recordSessionContinuation(input)).then(
        (result) => result,
        () => this.databaseErrorContinuationResult(),
      );
    } catch {
      operation = Promise.resolve(this.databaseErrorContinuationResult());
    }
    return this.track(operation);
  }

  private invokeMaterializeEpisode(input: MaterializeEpisodeInput): Promise<MaterializeEpisodeResult> {
    let operation: Promise<MaterializeEpisodeResult>;
    try {
      operation = Promise.resolve(this.store.materializeEpisode(input)).then(
        (result) => result,
        () => this.databaseErrorMaterializeEpisodeResult(),
      );
    } catch {
      operation = Promise.resolve(this.databaseErrorMaterializeEpisodeResult());
    }
    return this.track(operation);
  }

  private invokeTaskDigest(input: GetTaskDigestInput): Promise<GetTaskDigestResult> {
    let operation: Promise<GetTaskDigestResult>;
    try {
      operation = Promise.resolve(this.store.getTaskDigest(input)).then(
        (result) => result,
        () => this.databaseErrorTaskDigestResult(),
      );
    } catch {
      operation = Promise.resolve(this.databaseErrorTaskDigestResult());
    }
    return this.track(operation);
  }

  private invokeMaterializeExecutionUnits(input: MaterializeExecutionUnitsInput): Promise<MaterializeExecutionUnitsResult> {
    let operation: Promise<MaterializeExecutionUnitsResult>;
    try {
      operation = Promise.resolve(this.store.materializeExecutionUnits(input)).then(
        (result) => result,
        () => this.databaseErrorMaterializeExecutionUnitsResult(),
      );
    } catch {
      operation = Promise.resolve(this.databaseErrorMaterializeExecutionUnitsResult());
    }
    return this.track(operation);
  }
  private invokeMaterializeExecutionReviewCandidates(input: MaterializeExecutionReviewCandidatesInput): Promise<MaterializeExecutionReviewCandidatesResult> {
    let operation: Promise<MaterializeExecutionReviewCandidatesResult>;
    try {
      operation = Promise.resolve(this.store.materializeExecutionReviewCandidates(input)).then(
        (result) => result,
        () => this.databaseErrorMaterializeExecutionReviewCandidatesResult(),
      );
    } catch {
      operation = Promise.resolve(this.databaseErrorMaterializeExecutionReviewCandidatesResult());
    }
    return this.track(operation);
  }

  private invokeReviewExecutionCandidate(input: ReviewExecutionCandidateInput): Promise<ExecutionReviewOperationResult> {
    let operation: Promise<ExecutionReviewOperationResult>;
    try {
      const review = this.store.reviewExecutionCandidate;
      operation = review === undefined
        ? Promise.resolve({ status: "failed", code: "model_unavailable", message: "Execution review model adapter is unavailable." })
        : Promise.resolve(review.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorReviewExecutionCandidateResult(input.candidate_uid),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorReviewExecutionCandidateResult(input.candidate_uid));
    }
    return this.track(operation);
  }

  private invokeReflectManualCandidate(input: ReflectManualCandidateInput): Promise<ReflectManualCandidateResult> {
    let operation: Promise<ReflectManualCandidateResult>;
    try {
      const reflect = this.store.reflectManualCandidate;
      operation = reflect === undefined
        ? Promise.resolve({
          status: "failed",
          code: "model_unavailable",
          message: "Manual reflection model adapter is unavailable.",
        } satisfies ReflectManualCandidateResult)
        : Promise.resolve(reflect.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorReflectManualCandidateResult(),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorReflectManualCandidateResult());
    }
    return this.track(operation);
  }

  private invokeExactSpanModelMemoryRevision(input: CreateExactSpanModelMemoryInput): Promise<CreateExactSpanModelMemoryResult> {
    let operation: Promise<CreateExactSpanModelMemoryResult>;
    try {
      const create = this.store.createExactSpanModelMemoryRevision;
      operation = create === undefined
        ? Promise.resolve(this.degradedExactSpanModelMemoryRevisionResult())
        : Promise.resolve(create.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorExactSpanModelMemoryRevisionResult(),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorExactSpanModelMemoryRevisionResult());
    }
    return this.track(operation);
  }

  private invokeToolSaveMemoryRevision(input: CreateToolSaveMemoryInput): Promise<CreateToolSaveMemoryResult> {
    let operation: Promise<CreateToolSaveMemoryResult>;
    try {
      const create = this.store.createToolSaveMemoryRevision;
      operation = create === undefined
        ? Promise.resolve(this.degradedToolSaveMemoryRevisionResult())
        : Promise.resolve(create.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorToolSaveMemoryRevisionResult(),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorToolSaveMemoryRevisionResult());
    }
    return this.track(operation);
  }

  private invokeSearchProjectMemories(input: SearchProjectMemoriesInput): Promise<SearchProjectMemoriesResult> {
    let operation: Promise<SearchProjectMemoriesResult>;
    try {
      const search = this.store.searchProjectMemories;
      operation = search === undefined
        ? Promise.resolve(this.degradedSearchProjectMemoriesResult())
        : Promise.resolve(search.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorSearchProjectMemoriesResult(),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorSearchProjectMemoriesResult());
    }
    return this.track(operation);
  }

  private invokeListRecentProjectMemories(input: ListRecentProjectMemoriesInput): Promise<ListRecentProjectMemoriesResult> {
    let operation: Promise<ListRecentProjectMemoriesResult>;
    try {
      const list = this.store.listRecentProjectMemories;
      operation = list === undefined
        ? Promise.resolve(this.degradedListRecentProjectMemoriesResult())
        : Promise.resolve(list.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorListRecentProjectMemoriesResult(),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorListRecentProjectMemoriesResult());
    }
    return this.track(operation);
  }


  private invokeAutomaticReflections(input: RunDueAutomaticReflectionsInput): Promise<RunDueAutomaticReflectionsResult> {
    let operation: Promise<RunDueAutomaticReflectionsResult>;
    try {
      const run = this.store.runDueAutomaticReflections;
      operation = run === undefined
        ? Promise.resolve(this.degradedAutomaticReflectionResult())
        : Promise.resolve(run.call(this.store, input)).then(
          (result) => result,
          () => this.databaseErrorAutomaticReflectionResult(),
        );
    } catch {
      operation = Promise.resolve(this.databaseErrorAutomaticReflectionResult());
    }
    return this.track(operation);
  }



  private track<T>(operation: Promise<T>): Promise<T> {
    this.inFlight.add(operation);
    operation.then(
      () => this.inFlight.delete(operation),
      () => this.inFlight.delete(operation),
    );
    return operation;
  }

  private publishInitialization(storeHealth: MemoryStoreHealth): void {
    if (this.state === "closed" || this.admissionClosed) return;
    if (storeHealth.status === "connected") {
      this.state = "ready";
      this.database = storeHealth.database;
      this.constraints = [...storeHealth.constraints];
      this.automaticReflectionScheduler?.start();
    } else {
      this.state = "degraded";
      this.database = null;
      this.constraints = [];
    }
  }

  private publishInitializationFailure(): void {
    if (this.state === "closed" || this.admissionClosed) return;
    this.state = "degraded";
    this.database = null;
    this.constraints = [];
  }

  private message(): MemoryCoreHealth["message"] {
    if (this.state === "starting") return STARTING_MESSAGE;
    if (this.state === "ready") return READY_MESSAGE;
    if (this.state === "degraded") return DEGRADED_MESSAGE;
    return CLOSED_MESSAGE;
  }

  private waitUntilDeadline(promise: Promise<unknown>, deadline: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };

      promise.then(finish, finish);
      const remaining = deadline - performance.now();
      if (remaining <= 0) finish();
      else timer = setTimeout(finish, remaining);
    });
  }

  private closedProcessResult(): ProcessSessionResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedProcessResult(): ProcessSessionResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorProcessResult(): ProcessSessionResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedContinuationResult(): RecordSessionContinuationResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedContinuationResult(): RecordSessionContinuationResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorContinuationResult(): RecordSessionContinuationResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedMaterializeEpisodeResult(): MaterializeEpisodeResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedMaterializeEpisodeResult(): MaterializeEpisodeResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorMaterializeEpisodeResult(): MaterializeEpisodeResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }
  private closedMaterializeExecutionUnitsResult(): MaterializeExecutionUnitsResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedMaterializeExecutionUnitsResult(): MaterializeExecutionUnitsResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorMaterializeExecutionUnitsResult(): MaterializeExecutionUnitsResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }
  private closedMaterializeExecutionReviewCandidatesResult(): MaterializeExecutionReviewCandidatesResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedMaterializeExecutionReviewCandidatesResult(): MaterializeExecutionReviewCandidatesResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorMaterializeExecutionReviewCandidatesResult(): MaterializeExecutionReviewCandidatesResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }



  private closedReviewExecutionCandidateResult(candidate_uid: string): ExecutionReviewOperationResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedReviewExecutionCandidateResult(candidate_uid: string): ExecutionReviewOperationResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private closedTaskDigestResult(): GetTaskDigestResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedTaskDigestResult(): GetTaskDigestResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorTaskDigestResult(): GetTaskDigestResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }
  private databaseErrorReviewExecutionCandidateResult(candidate_uid: string): ExecutionReviewOperationResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedReflectManualCandidateResult(candidate_uid: string): ReflectManualCandidateResult {
    return { status: "failed", code: "core_closed", candidate_uid, message: CLOSED_MESSAGE };
  }

  private degradedReflectManualCandidateResult(candidate_uid: string): ReflectManualCandidateResult {
    return { status: "failed", code: "core_degraded", candidate_uid, message: NOT_READY_MESSAGE };
  }

  private databaseErrorReflectManualCandidateResult(): ReflectManualCandidateResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedExactSpanModelMemoryRevisionResult(): CreateExactSpanModelMemoryResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedExactSpanModelMemoryRevisionResult(): CreateExactSpanModelMemoryResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorExactSpanModelMemoryRevisionResult(): CreateExactSpanModelMemoryResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedToolSaveMemoryRevisionResult(): CreateToolSaveMemoryResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedToolSaveMemoryRevisionResult(): CreateToolSaveMemoryResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorToolSaveMemoryRevisionResult(): CreateToolSaveMemoryResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedSearchProjectMemoriesResult(): SearchProjectMemoriesResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedSearchProjectMemoriesResult(): SearchProjectMemoriesResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorSearchProjectMemoriesResult(): SearchProjectMemoriesResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }

  private closedListRecentProjectMemoriesResult(): ListRecentProjectMemoriesResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedListRecentProjectMemoriesResult(): ListRecentProjectMemoriesResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorListRecentProjectMemoriesResult(): ListRecentProjectMemoriesResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }


  private closedAutomaticReflectionResult(): RunDueAutomaticReflectionsResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private degradedAutomaticReflectionResult(): RunDueAutomaticReflectionsResult {
    return { status: "failed", code: "core_degraded", message: NOT_READY_MESSAGE };
  }

  private databaseErrorAutomaticReflectionResult(): RunDueAutomaticReflectionsResult {
    return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
  }
}
