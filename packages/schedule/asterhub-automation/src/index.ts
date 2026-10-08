/**
 * Native scheduled-task management with fresh-session execution for AsterHub Desktop.
 *
 * The Host owning package persists each task and its bounded run/receipt history as
 * a single storage-domain record. Management operations, the chat tool, and the
 * Client Remote all consume the same implementation. A timer-driven runtime
 * (owned by the runtime worker) creates fresh Workspace Sessions through public
 * Agent/preset APIs; this service provides the frozen {@link AutomationRuntimeHost}
 * interface to that runtime and owns the shared management FIFO.
 *
 * @module @deepseek-ai/dsh-asterhub-automation
 */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AutomationStore, openAutomationStore } from './store.ts'
import { AutomationOperations, AutomationOperationError } from './operations.ts'
import { AutomationRuntime } from './runtime.ts'
import { registerAutomationTools } from './tools.ts'
import type {
  AutomationTask,
  AutomationTaskId,
  AutomationRunId,
  AutomationDraft,
  AutomationOperation,
  AutomationPreparedOperation,
  AutomationCommitRequest,
  AutomationMutationResult,
  AutomationPreview,
  AutomationListRequest,
  AutomationTaskPage,
  AutomationGetRequest,
  AutomationRunsRequest,
  AutomationRunsPage,
  AutomationChoices,
  AutomationLimits,
  AutomationAccountIdentity,
} from './types.ts'
import type { AutomationRuntimeHost } from './runtime-contract.ts'

import { WorkspaceActiveSessionError } from '@deepseek-ai/dsh-workspace'
export type * from './types.ts'
export { automationDomain } from './schema.ts'
export { AutomationOperations, AutomationOperationError } from './operations.ts'
export type { AutomationConfig } from './operations.ts'
export { openAutomationStore, AutomationStore } from './store.ts'
export type { AutomationTaskTable } from './store.ts'
export { AutomationSchemaError, validateTaskAggregate } from './schema.ts'
export { registerAutomationTools } from './tools.ts'
export type { AutomationManageOutput, AutomationReadOutput } from './tools.ts'

declare module '@deepseek-ai/dsh-workspace/types' {
  interface SessionActivityKindMap {
    /** Active scheduled-task automation runs on this session. */
    'automation-run': true
  }
}

/**
 * Configuration for the automation service.
 *
 * Every field is optional with a validated default; the merged result is checked
 * for internal consistency (one max snapshot + one active run + receipt budget
 * must fit inside the aggregate hard limit) before the service arms.
 */
export interface Config {
  /** Maximum concurrent runs across all accounts. Default: 2. */
  maxConcurrent?: number
  /** Run timeout in milliseconds, including approval wait. Default: 30 minutes. */
  runTimeoutMs?: number
  /** Terminal-history retention window in days. Default: 30. */
  historyDays?: number
  /** Maximum terminal-history records per task. Default: 200. */
  historyRecords?: number
  /** Terminal-history byte budget per task. Default: 2 MiB. */
  historyBytes?: number
  /** Request-receipt retention window in days. Default: 30. */
  receiptDays?: number
  /** Maximum request receipts per task. Default: 1000. */
  receiptRecords?: number
  /** Request-receipt byte budget per task. Default: 1 MiB. */
  receiptBytes?: number
  /** Hard upper bound on one task aggregate's UTF-8 JSON byte size. Default: 4 MiB. */
  maxTaskBytes?: number
  /** Maximum non-deleted tasks per account. Default: 100. */
  maxTasksPerAccount?: number
  /** Maximum total tasks (including deleted) per data root. Default: 500. */
  maxTasks?: number
  /** Maximum instruction character count. Default: 16000. */
  maxInstructionChars?: number
  /** Maximum instruction UTF-8 byte count. Default: 64 KiB. */
  maxInstructionBytes?: number
  /** Host-issued confirmation ticket lifetime in milliseconds. Default: 5 minutes. */
  confirmationTimeoutMs?: number
}

/** Validated deployment limits derived from {@link Config}. */
const DEFAULT_LIMITS = {
  maxConcurrent: 2,
  runTimeoutMs: 30 * 60 * 1000,
  historyDays: 30,
  historyRecords: 200,
  historyBytes: 2 * 1024 * 1024,
  receiptDays: 30,
  receiptRecords: 1000,
  receiptBytes: 1 * 1024 * 1024,
  maxTaskBytes: 4 * 1024 * 1024,
  maxTasksPerAccount: 100,
  maxTasks: 500,
  maxInstructionChars: 16000,
  maxInstructionBytes: 64 * 1024,
  confirmationTimeoutMs: 5 * 60 * 1000,
} as const satisfies Required<Config>

/**
 * Schemastery schema for the automation service configuration.
 *
 * Every field carries a validated default, so an omitted config is a valid
 * deployment. The schema enforces positive ranges. Cross-budget validation
 * (receiptBytes + overhead < maxTaskBytes) is checked at runtime after
 * Schemastery resolves defaults.
 */
export const Config: z<Config> = z.object({
  maxConcurrent: z.number().step(1).min(1).max(64).default(DEFAULT_LIMITS.maxConcurrent),
  runTimeoutMs: z.number().step(1).min(60_000).max(24 * 60 * 60 * 1000).default(DEFAULT_LIMITS.runTimeoutMs),
  historyDays: z.number().step(1).min(1).max(3650).default(DEFAULT_LIMITS.historyDays),
  historyRecords: z.number().step(1).min(1).max(10_000).default(DEFAULT_LIMITS.historyRecords),
  historyBytes: z.number().step(1).min(1024).max(16 * 1024 * 1024).default(DEFAULT_LIMITS.historyBytes),
  receiptDays: z.number().step(1).min(1).max(3650).default(DEFAULT_LIMITS.receiptDays),
  receiptRecords: z.number().step(1).min(1).max(10_000).default(DEFAULT_LIMITS.receiptRecords),
  receiptBytes: z.number().step(1).min(1024).max(4 * 1024 * 1024).default(DEFAULT_LIMITS.receiptBytes),
  maxTaskBytes: z.number().step(1).min(512 * 1024).max(16 * 1024 * 1024).default(DEFAULT_LIMITS.maxTaskBytes),
  maxTasksPerAccount: z.number().step(1).min(1).max(10_000).default(DEFAULT_LIMITS.maxTasksPerAccount),
  maxTasks: z.number().step(1).min(1).max(10_000).default(DEFAULT_LIMITS.maxTasks),
  maxInstructionChars: z.number().step(1).min(1).max(64_000).default(DEFAULT_LIMITS.maxInstructionChars),
  maxInstructionBytes: z.number().step(1).min(1024).max(256 * 1024).default(DEFAULT_LIMITS.maxInstructionBytes),
  confirmationTimeoutMs: z.number().step(1).min(30_000).max(60 * 60 * 1000).default(DEFAULT_LIMITS.confirmationTimeoutMs),
})

/**
 * Cordis context extension: the automation service is available as `ctx.asterhubAutomation`.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Native scheduled-task automation service (Host only). */
    asterhubAutomation: AutomationService
  }
}

/**
 * Event payload for `automation/changed`.
 *
 * Carries no task content; clients re-query the authoritative record set.
 * The event is emitted after every durable put/delete so the runtime
 * recomputes its next timer and the Client refreshes its visible list.
 */
export interface AutomationChangedEvent {
  /** Always empty; the payload exists so the event type is declared. */
  readonly kind: 'automation-changed'
}

/**
 * Event payload for `automation/account-changed`.
 *
 * Emitted when the automation identity changes (login/logout/switch).
 * Carries no task content or secrets; clients re-query the authoritative record set.
 * List/get/runs/choices capture identity and reassert before resolving.
 */
export interface AutomationAccountChangedEvent {
  /** The new account id, or null if logged out. */
  readonly accountId: string | null
  /** The new epoch, or 0 if logged out. */
  readonly epoch: number
}

/**
 * Event payload for `automation/run-stop-requested`.
 *
 * Emitted when a run stop is requested; observed by the runtime outside the FIFO.
 */
export interface AutomationRunStopRequestedEvent {
  readonly taskId: AutomationTaskId
  readonly runId: AutomationRunId
}

/**
 * Automation service events declaration for Cordis.
 * Uses method signature style (not EventMap tuples) per Cordis Events interface.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Notification that automation tasks changed; re-query for authoritative state.
     * @param event - The automation changed event.
     */
    'automation/changed'(event: AutomationChangedEvent): void
    /**
     * Account identity changed; re-query and drop stale prepared ops.
     * @param event - The account changed event.
     */
    'automation/account-changed'(event: AutomationAccountChangedEvent): void
    /**
     * Request to stop one run; observed by the runtime outside the FIFO.
     * @param event - The run stop requested event.
     */
    'automation/run-stop-requested'(event: AutomationRunStopRequestedEvent): void
  }
}

/**
 * Native scheduled-task management and execution service.
 *
 * Extends {@link TypertRemoteService} so its methods are exposed to the
 * authenticated Client through the `automation` Remote namespace. Implements
 * the frozen {@link AutomationRuntimeHost} interface for the runtime worker.
 *
 * The service owns:
 * - The single storage-domain store with schema-validated task aggregates.
 * - One shared management FIFO serializing all write operations and runtime
 *   reservations, so no task can cross global quota/concurrency checks while
 *   another await is in flight.
 * - The {@link AutomationRuntime} instance, started after the store opens and
 *   disposed before the store closes.
 * - The `automation_manage` chat tool, registered on root interactive Agent
 *   scopes only; scheduled-run/descendant scopes never receive it.
 */
export class AutomationService extends TypertRemoteService implements AutomationRuntimeHost {
  static inject = ['storageDomain', 'workspaceRegistry', 'accountSub2api', 'llm', 'agents', 'agentPresets', 'sessionController', 'sessionProjections', 'sessionPersistence', 'userQuestions', 'permissionPresets', 'sessionTitle', 'jobs']

  static Config = Config

  private readonly ready: Promise<AutomationStore>
  private operations: AutomationOperations | undefined
  private runtime: AutomationRuntime | undefined
  /** Exact startup owner shared by manual and timer-created reservations. */
  readonly runtimeId: string
  private readonly limitsCache: AutomationLimits
  /** Shared management+runtime FIFO chain. */
  private chain: Promise<unknown> = Promise.resolve()
  private stopping = false

  /**
   * @param ctx - Host context supplying storage, workspace, account, and llm services.
   * @param config - Validated configuration (Schemastery resolves defaults).
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'asterhubAutomation', { namespace: 'automation' })
    const effective: Required<Config> = { ...DEFAULT_LIMITS, ...config }
    this.runtimeId = `runtime-${randomUUID()}`
    this.limitsCache = {
      maxConcurrent: effective.maxConcurrent,
      runTimeoutMs: effective.runTimeoutMs,
      historyDays: effective.historyDays,
      historyRecords: effective.historyRecords,
      historyBytes: effective.historyBytes,
      receiptDays: effective.receiptDays,
      receiptRecords: effective.receiptRecords,
      receiptBytes: effective.receiptBytes,
      maxTaskBytes: effective.maxTaskBytes,
      maxTasksPerAccount: effective.maxTasksPerAccount,
      maxTasks: effective.maxTasks,
      maxInstructionChars: effective.maxInstructionChars,
      maxInstructionBytes: effective.maxInstructionBytes,
      confirmationTimeoutMs: effective.confirmationTimeoutMs,
    }

    // Validate cross-budget constraint after Schemastery resolves defaults:
    const reserved = effective.receiptBytes + 64 * 1024
    if (reserved >= effective.maxTaskBytes) {
      throw new Error('asterhubAutomation: maxTaskBytes must exceed receiptBytes plus one active-run overhead')
    }

    // Open the store, validate stored records, and wire the runtime + operations.
    this.ready = openAutomationStore(ctx).then(async (store) => {
      const identityProvider = async (): Promise<AutomationAccountIdentity | null> => {
        return ctx.accountSub2api.automationIdentity()
      }
      this.operations = new AutomationOperations(ctx, store, effective, identityProvider,
        this.runtimeId, <T>(work: () => Promise<T>) => this.transact(work))
      // AutomationRuntime takes only the frozen AutomationRuntimeHost; execution
      // APIs are resolved internally via host.ctx (webhook session pattern).
      this.runtime = new AutomationRuntime(this)
      this.runtime.requestDrive()
      return store
    })

    // Subscribe to account identity changes: emit a credential-free client signal
    // so the UI drops stale account tasks before any old-epoch task reply can publish.
    ctx.on('asterhub-account/changed', (identity: AutomationAccountIdentity | null) => {
      this.ctx.emit('automation/account-changed', {
        accountId: identity?.accountId ?? null,
        epoch: identity?.epoch ?? 0,
      })
      // Re-arm schedules: login after unauthenticated startup must arm the
      // timer, and logout must recompute (no identity → no dispatch).
      this.runtime?.requestDrive()
    })
    ctx.on('automation/run-stop-requested', ({ runId }) => {
      void this.runtime?.stopRun(runId).catch(() => { this.ctx.logger.error('automation: requested run could not reach quiescence') })
    })

    // Report active automation runs as session activity so archive refuses
    // a session with a live run unless stopActivity is requested.
    ctx.on('workspace/session-activity', async (request, next) => {
      const activities = await next()
      const runs = this.runtime?.activeRunsForSession(request.sessionId) ?? []
      if (runs.length === 0) return activities
      return [{
        kind: 'automation-run' as const,
        items: runs.map(runId => ({ id: runId, label: 'Scheduled task run' })),
      }, ...activities]
    })

    // Admit waterfall: when stopActivity is true, stop and await every
    // automation run on this session before the archive write proceeds.
    // When false, refuse if any run is still active (defense in depth — the
    // activity waterfall already checked, but a run may have started since).
    ctx.on('workspace/session-archive/admit', async (request, next) => {
      if (request.stopActivity) {
        const runs = this.runtime?.activeRunsForSession(request.sessionId) ?? []
        for (const runId of runs) {
          await this.runtime?.stopRun(runId)
        }
      } else {
        const runs = this.runtime?.activeRunsForSession(request.sessionId) ?? []
        if (runs.length > 0) {
          throw new WorkspaceActiveSessionError(request.sessionId, [{ kind: 'automation-run', items: runs.map(id => ({ id, label: 'Scheduled task run' })) }])
        }
      }
      await next()
    })

    // Register cleanup: stop runtime, drain FIFO, close store.
    ctx.effect(() => async () => {
      this.stopping = true
      this.operations?.dispose()
      await this.runtime?.dispose()
      // Drain the chain; failures were already returned to their callers.
      await this.chain
      const store = await this.ready
      await store.close()
    })
    // Register automation_manage on root interactive Agent scopes only.
    const registered = new WeakSet<object>()
    const attached = new Map<Agent, () => Promise<void>>()
    const attach = (agent: Agent): void => {
      if (this.stopping || registered.has(agent) || agent.ctx.get('asterhubAutomationRun') !== undefined || !ctx.agents.roots().includes(agent)) return
      registered.add(agent)
      attached.set(agent, ctx.effect(
        () => agent.ctx.effect(() => registerAutomationTools(ctx, agent.ctx, agent)),
      ))
    }
    ctx.on('agent/created', ({ agent }) => { attach(agent) })
    ctx.on('agent/disposed', ({ agent }) => {
      const detach = attached.get(agent)
      if (detach === undefined) return
      attached.delete(agent)
      void detach()
    })
    for (const agent of ctx.agents.roots()) attach(agent)
  }

  async [Service.init](): Promise<void> {
    await this.ready
  }

  /** Await the store (used internally and by tests). */
  private async getStore(): Promise<AutomationStore> {
    return await this.ready
  }

  /** Get operations; throws if the service has not finished initializing. */
  private getOps(): AutomationOperations {
    if (!this.operations) {
      throw new Error('asterhubAutomation: service not initialized')
    }
    return this.operations
  }

  // ---- AutomationRuntimeHost implementation ----

  /** Host context (Cordis Service base exposes `ctx` as a protected property). */
  declare readonly ctx: Context

  /** Validated deployment limits for the runtime (computed once at construction). */
  get limits(): AutomationLimits {
    return this.limitsCache
  }
  /** All tasks (synchronous snapshot for runtime scanning outside the FIFO). */
  tasks(): readonly AutomationTask[] {
    if (this.operations) {
      return this.operations.store.tasks()
    }
    return []
  }

  /** Current account identity (delegates to accountSub2api). */
  identity(): Promise<AutomationAccountIdentity | null> {
    return this.ctx.accountSub2api.automationIdentity()
  }

  /**
   * Serialized transaction wrapper — the single shared management+runtime FIFO.
   *
   * Every management write and every runtime reservation enters this queue so
   * no task can cross global quota/concurrency checks while another await is
   * in flight. The runtime calls this for reservation; management operations
   * call it through {@link AutomationOperations}.
   */
  transact<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    // Keep the chain alive even if `work` rejects, so a failure does not
    // poison subsequent operations.
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  /** Persist a task and emit change. */
  async put(task: AutomationTask): Promise<void> {
    const store = await this.getStore()
    await store.put(task)
    this.emitChanged()
    this.runtime?.requestDrive()
  }

  /** Emit `automation/changed` without leaking task content. */
  emitChanged(): void {
    this.ctx.emit('automation/changed', { kind: 'automation-changed' })
  }

  // ---- Remote API (Typert namespace `automation`) ----

  /**
   * Preview a task draft without persisting.
   * @param draft - Task draft to validate and preview.
   * @returns Normalized draft and the next three occurrence timestamps.
   */
  @Remote('preview')
  async preview(draft: AutomationDraft): Promise<AutomationPreview> {
    return this.getOps().preview(draft)
  }

  private assertInteractiveCaller(): void {
    const caller = this.ctx.agents.currentInitiator()
    if (caller?.ctx.get('asterhubAutomationRun') !== undefined) {
      throw new AutomationOperationError('scheduled_origin', 'Scheduled executions cannot change task authorization.')
    }
  }

  /**
   * Prepare an operation, issuing a Host-signed request ticket bound to the
   * current account/epoch. Does not execute the write.
   * @param operation - The operation to prepare.
   * @returns Prepared operation with requestId and confirmation challenge.
   */
  @Remote('prepareOperation')
  async prepareOperation(operation: AutomationOperation): Promise<AutomationPreparedOperation> {
    this.assertInteractiveCaller()
    return this.getOps().prepareOperation(operation)
  }

  /**
   * Commit a prepared operation after user confirmation (GUI) or internal
   * approval (chat tool). Idempotent by requestId within the receipt window.
   * @param request - Commit request carrying the requestId and confirmationId.
   * @returns Mutation result; a runId acknowledges admission, not success.
   */
  @Remote('commitOperation')
  async commitOperation(request: AutomationCommitRequest): Promise<AutomationMutationResult> {
    this.assertInteractiveCaller()
    const result = await this.getOps().commitOperation(request)
    this.emitChanged()
    this.runtime?.requestDrive()
    return result
  }

  /**
   * List tasks for the current account with optional filters and pagination.
   * @param request - List request with cursor, search, and status filters.
   * @returns One page of tasks scoped to the active account.
   */
  @Remote('list')
  async list(request: AutomationListRequest): Promise<AutomationTaskPage> {
    return this.getOps().list(request)
  }

  /**
   * Get a single task by id (must belong to the current account).
   * @param request - Get request with the task id.
   * @returns The authoritative task record.
   */
  @Remote('get')
  async get(request: AutomationGetRequest): Promise<AutomationTask> {
    return this.getOps().get(request)
  }

  /**
   * Get bounded execution history for a task.
   * @param request - Runs request with task id, limit, and optional cursor.
   * @returns One page of runs plus the truthful history-pruned flag.
   */
  @Remote('runs')
  async runs(request: AutomationRunsRequest): Promise<AutomationRunsPage> {
    return this.getOps().runs(request)
  }

  /**
   * Get Host-approved form selections (workspaces and models) for the current
   * account. No private credentials are included.
   * @returns Available workspaces and catalog models.
   */
  @Remote('choices')
  async choices(): Promise<AutomationChoices> {
    return this.getOps().choices()
  }

  // ---- Host-only methods (not exposed via Remote) ----

  /**
   * Inspect lifecycle state for quit/update checks. Emits no task content.
   * @returns `armed` when the runtime is not stopping; `active` when any
   * timer or execution is in flight.
   */
  inspectLifecycle(): { armed: boolean; active: boolean } {
    if (!this.runtime) {
      return { armed: false, active: false }
    }
    return this.runtime.inspectLifecycle()
  }

  /**
   * Lock or unlock admission. When locked, no new run reservations are
   * admitted; active runs drain. Used by quit and installed-update paths.
   * @param locked - Whether to lock admission.
   */
  setAdmissionLocked(locked: boolean): void {
    this.runtime?.setAdmissionLocked(locked)
    this.operations?.setAdmissionLocked(locked)
  }

  /**
   * Stop a run. Called outside the management FIFO to avoid runtime reentry
   * deadlock; the runtime observes the abort signal during execution.
   * @param runId - The run to stop.
   */
  async stopRun(runId: AutomationRunId): Promise<void> {
    await this.runtime?.stopRun(runId)
  }

  /**
   * Dispose the runtime and close the store (Host only).
   * Called by the plugin effect cleanup; not intended for direct callers.
   */
  async disposeRuntime(): Promise<void> {
    this.stopping = true
    await this.runtime?.dispose()
    const store = await this.getStore()
    await store.close()
  }
}

/**
 * Apply the automation service to a Cordis context.
 *
 * Cordis class-plugin entry point: receives the validated config and registers
 * the service. The accountSub2api, storageDomain, workspace, llm, and agents
 * services must be present (declared via {@link AutomationService.inject}).
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(AutomationService, config)
}
