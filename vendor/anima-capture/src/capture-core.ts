import { CanonicalBuilder, CanonicalBuilderError } from "./canonical-builder.ts";
import { Neo4jStore, type HealthResult } from "./neo4j-store.ts";
import { RawEventWriter, type AppendResult } from "./raw-event-writer.ts";
import { SessionQueue, type QueuedTask } from "./session-queue.ts";
import { validateCaptureSessionFacts, validateSourceFacts } from "./protocol-validator.ts";
import type { CaptureSessionFacts, ResolvedSessionContext, SourceEventFacts } from "./canonical-types.ts";

export type CaptureCoreState = "starting" | "ready" | "degraded" | "closed";

export interface CaptureCoreHealth {
  state: CaptureCoreState;
  database: string | null;
  pending_events: number;
  failed_events: number;
  constraints: string[];
  message: string;
}

export interface CaptureCoreOptions {
  core_version?: string;
  max_pending_events?: number;
  shutdown_timeout_ms?: number;
  store?: StoreLike;
  writer?: WriterLike;
  builder?: CanonicalBuilder;
}

export interface StoreLike {
  initialize(): Promise<HealthResult>;
  close(timeoutMs?: number): Promise<void>;
  cancelWrites?(): void;
  isWriteCancelled?(): boolean;
}

export interface WriterLike {
  write(draft: Parameters<RawEventWriter["write"]>[0], context: ResolvedSessionContext): Promise<AppendResult>;
}

const DEFAULT_MAX_PENDING = 256;
const DEFAULT_SHUTDOWN_TIMEOUT = 1500;
const CLOSED_MESSAGE = "Capture core is closed.";
const DEGRADED_MESSAGE = "Capture core is degraded.";

interface AcceptedTask {
  promise: Promise<AppendResult>;
  completion: Promise<void>;
  settle(value: AppendResult): void;
  settled(): boolean;
  started: boolean;
  eventUid?: string;
}

interface SessionState {
  queue: SessionQueue<AppendResult>;
  handleCount: number;
  pendingCount: number;
}

function failure(code: Extract<AppendResult, { status: "failed" }>['code'], message: string): AppendResult {
  return { status: "failed", code, message };
}

function sanitizedBuilderFailure(error: unknown): AppendResult {
  if (error instanceof CanonicalBuilderError && error.code === "invalid_source_facts") {
    return failure("invalid_source_facts", "source facts could not be written.");
  }
  return failure("database_error", "capture write failed.");
}

function isPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) return fallback;
  return value;
}

export class CaptureCore {
  private readonly builder: CanonicalBuilder;
  private readonly store: StoreLike;
  private readonly writer: WriterLike;
  private readonly maxPendingEvents: number;
  private readonly shutdownTimeoutMs: number;
  private readonly sessions = new Map<string, SessionState>();
  private readonly accepted = new Set<AcceptedTask>();
  private readonly readyGate: Promise<void>;
  private resolveReadyGate!: () => void;
  private state: CaptureCoreState = "starting";
  private database: string | null = null;
  private constraints: string[] = [];
  private message = "Capture core is starting.";
  private failedEvents = 0;
  private initializePromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private initializationOutcome: "not_started" | "in_flight" | "connected" | "failed" = "not_started";
  private shutdownTimedOut = false;

  constructor(options: CaptureCoreOptions = {}) {
    this.builder = options.builder ?? new CanonicalBuilder({ core_version: options.core_version ?? "capture-core" });
    this.maxPendingEvents = isPositiveInteger(options.max_pending_events, DEFAULT_MAX_PENDING);
    this.shutdownTimeoutMs = isPositiveInteger(options.shutdown_timeout_ms, DEFAULT_SHUTDOWN_TIMEOUT);
    this.store = options.store ?? new Neo4jStore({ shutdown_timeout_ms: this.shutdownTimeoutMs });
    this.writer = options.writer ?? new RawEventWriter(this.store as Neo4jStore, this.builder);
    this.readyGate = new Promise<void>((resolve) => {
      this.resolveReadyGate = resolve;
    });
  }

  initialize(): Promise<void> {
    if (this.initializePromise !== undefined) return this.initializePromise;
    if (this.state === "closed") {
      this.initializePromise = Promise.resolve();
      return this.initializePromise;
    }
    this.initializationOutcome = "in_flight";
    this.initializePromise = this.initializeOnce();
    return this.initializePromise;
  }

  openSession(facts: CaptureSessionFacts): CaptureSession {
    if (this.state === "closed") return new CaptureSession(this, undefined, undefined);
    const validation = validateCaptureSessionFacts(facts);
    if (!validation.ok) throw new CanonicalBuilderError("invalid_source_facts", validation.message ?? "invalid source facts");
    let factsSnapshot: CaptureSessionFacts;
    try {
      factsSnapshot = structuredClone(facts);
    } catch {
      throw new CanonicalBuilderError("invalid_source_facts", "source facts could not be copied");
    }
    const context = this.builder.openSession(factsSnapshot);
    let session = this.sessions.get(context.session_uid);
    if (session === undefined) {
      session = { queue: new SessionQueue<AppendResult>(), handleCount: 0, pendingCount: 0 };
      this.sessions.set(context.session_uid, session);
    }
    session.handleCount += 1;
    return new CaptureSession(this, context, session);
  }

  /** Narrow test/health hook for observing session-state reclamation. */
  sessionCountForTesting(): number {
    return this.sessions.size;
  }

  health(): CaptureCoreHealth {
    return {
      state: this.state,
      database: this.database,
      pending_events: this.pendingCount(),
      failed_events: this.failedEvents,
      constraints: [...this.constraints],
      message: this.message,
    };
  }

  close(timeoutMs?: number): Promise<void> {
    if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new RangeError("Capture close timeout must be a finite nonnegative number.");
    }
    if (this.closePromise !== undefined) return this.closePromise;
    const budget = timeoutMs === undefined ? this.shutdownTimeoutMs : Math.min(timeoutMs, this.shutdownTimeoutMs);
    this.closePromise = this.closeOnce(budget);
    return this.closePromise;
  }


  private async initializeOnce(): Promise<void> {
    let result: HealthResult;
    try {
      result = await this.store.initialize();
    } catch {
      result = { status: "error", database: null, constraints: [], message: "Neo4j connection failed." };
    }
    if (result.status !== "connected") {
      this.initializationOutcome = "failed";
      if (this.state !== "closed") this.transitionDegraded(result.message);
      this.resolveReadyGate();
      return;
    }
    this.initializationOutcome = "connected";
    if (this.state === "closed") {
      this.resolveReadyGate();
      return;
    }
    this.database = result.database;
    this.constraints = [...result.constraints];
    this.state = "ready";
    this.message = result.message;
    this.resolveReadyGate();
  }

  private transitionDegraded(message = DEGRADED_MESSAGE, preserve?: AcceptedTask): void {
    if (this.state === "closed") return;
    this.state = "degraded";
    this.database = null;
    this.constraints = [];
    this.message = message === "Neo4j connection failed." || message === "Neo4j configuration is unavailable." || message === "Neo4j configuration is invalid."
      ? message
      : DEGRADED_MESSAGE;
    for (const task of this.accepted) {
      if (task !== preserve && !task.started && !task.settled()) {
        task.settle(failure("core_degraded", DEGRADED_MESSAGE));
      }
    }
  }

  private pendingCount(): number {
    return this.accepted.size;
  }

  private append(handle: CaptureSession, source: SourceEventFacts): Promise<AppendResult> {
    if (handle.closed) return Promise.resolve(this.rejectClosed());
    if (this.state === "closed") return Promise.resolve(this.rejectClosed());
    if (this.state === "degraded") return Promise.resolve(this.rejectDegraded());
    if (this.pendingCount() >= this.maxPendingEvents) {
      this.failedEvents += 1;
      return Promise.resolve(failure("queue_full", "capture queue is full."));
    }
    const session = handle.session;
    const context = handle.context;
    if (session === undefined || context === undefined) return Promise.resolve(this.rejectClosed());
    const validation = validateSourceFacts(context.facts as CaptureSessionFacts, source);
    if (!validation.ok) {
      this.failedEvents += 1;
      return Promise.resolve(failure("invalid_source_facts", "source facts could not be written."));
    }
    let sourceSnapshot: SourceEventFacts;
    try {
      sourceSnapshot = structuredClone(source);
    } catch {
      this.failedEvents += 1;
      return Promise.resolve(failure("invalid_source_facts", "source facts could not be copied."));
    }
    let task!: AcceptedTask;
    const queued: QueuedTask<AppendResult> = session.queue.enqueue(async () => {
      await this.readyGate;
      if (this.shutdownTimedOut) return failure("core_closed", CLOSED_MESSAGE);
      if (this.initializationOutcome !== "connected") return failure("database_error", "capture write failed.");
      if (this.state === "degraded") return failure("core_degraded", DEGRADED_MESSAGE);
      task.started = true;
      let result: AppendResult;
      try {
        const draft = this.builder.build(context, sourceSnapshot);
        task.eventUid = draft.event_uid;
        result = await this.writer.write(draft, context);
      } catch (error: unknown) {
        result = sanitizedBuilderFailure(error);
      }
      if (result.status === "failed" && result.code === "database_error") {
        this.transitionDegraded(undefined, task);
      }
      return result;
    }, sanitizedBuilderFailure);
    task = queued as QueuedTask<AppendResult> & AcceptedTask;
    task.started = false;
    session.pendingCount += 1;
    this.accepted.add(task);
    handle.accepted.add(task);
    void queued.promise.then(
      (result) => {
        if (result.status === "failed") this.failedEvents += 1;
      },
      () => {
        this.failedEvents += 1;
      },
    );
    void queued.completion.then(() => {
      this.accepted.delete(task);
      handle.accepted.delete(task);
      session.pendingCount -= 1;
      this.reclaimSession(handle.session_uid, session);
    });
    return queued.promise;
  }
  private reclaimSession(sessionUid: string | undefined, session: SessionState | undefined): void {
    if (sessionUid === undefined || session === undefined || session.handleCount !== 0 || session.pendingCount !== 0) return;
    if (this.sessions.get(sessionUid) === session) this.sessions.delete(sessionUid);
  }

  /** Internal handle hook; releases one public handle for session-state reclamation. */
  releaseSessionHandle(handle: CaptureSession): void {
    const session = handle.session;
    if (session === undefined) return;
    if (session.handleCount > 0) session.handleCount -= 1;
    this.reclaimSession(handle.session_uid, session);
  }


  private rejectClosed(): AppendResult {
    this.failedEvents += 1;
    return failure("core_closed", CLOSED_MESSAGE);
  }

  private rejectDegraded(): AppendResult {
    this.failedEvents += 1;
    return failure("core_degraded", DEGRADED_MESSAGE);
  }

  /** Internal handle hook; keeps lifecycle checks inside CaptureCore. */
  appendForSession(handle: CaptureSession, source: SourceEventFacts): Promise<AppendResult> {
    return this.append(handle, source);
  }

  private async closeOnce(timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    this.state = "closed";
    this.database = null;
    this.constraints = [];
    this.message = CLOSED_MESSAGE;
    if (this.initializePromise === undefined) this.resolveReadyGate();
    const pending = [...this.accepted];
    const all = Promise.all(pending.map((task) => task.completion)).then(() => undefined);
    let timedOut = false;
    let timeoutHandle: Parameters<typeof clearTimeout>[0] | undefined;
    try {
      await Promise.race([
        all,
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            this.shutdownTimedOut = true;
            this.store.cancelWrites?.();
            this.resolveReadyGate();
            resolve();
          }, Math.max(0, deadline - performance.now()));
        }),
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
    }
    if (timedOut) {
      for (const task of pending) {
        if (!task.settled()) {
          if (task.eventUid !== undefined) {
            task.settle({
              status: "indeterminate",
              event_uid: task.eventUid,
              message: "Capture shutdown exceeded its completion budget.",
            });
          } else {
            task.settle(failure("core_closed", CLOSED_MESSAGE));
          }
        }
      }
    }
    try {
      await this.store.close(Math.max(0, deadline - performance.now()));
    } catch {
      // Store close errors are intentionally sanitized and cannot reopen a closed core.
    }
  }
}
export class CaptureSession {
  readonly accepted = new Set<AcceptedTask>();
  private isClosed = false;
  private closePromise?: Promise<void>;
  private readonly sessionContext: ResolvedSessionContext | undefined;
  constructor(
    private readonly core: CaptureCore,
    context: ResolvedSessionContext | undefined,
    readonly session: SessionState | undefined,
  ) {
    this.sessionContext = context;
  }

  get context(): ResolvedSessionContext | undefined {
    return this.sessionContext;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get profile_uid(): string | undefined {
    return this.context?.profile_uid;
  }

  get project_uid(): string | undefined {
    return this.context?.project_uid;
  }
  get session_uid(): string | undefined {
    return this.context?.session_uid;
  }

  append(source: SourceEventFacts): Promise<AppendResult> {
    return this.core.appendForSession(this, source);
  }
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.isClosed = true;
    this.core.releaseSessionHandle(this);
    const accepted = [...this.accepted];
    this.closePromise = Promise.all(accepted.map((task) => task.completion)).then(() => undefined);
    return this.closePromise;
  }
}
