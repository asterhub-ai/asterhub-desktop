/** Management operations for automation tasks. */
import { randomUUID, createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { scheduleDomain } from '@deepseek-ai/dsh-schedule/storage'
import type {
  AutomationTask,
  AutomationTaskId,
  AutomationRun,
  AutomationRunId,
  AutomationDraft,
  AutomationSnapshot,
  AutomationTiming,
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
  AutomationReceipt,
} from './types.ts'
import type { AutomationStore } from './store.ts'
import '@deepseek-ai/dsh-workspace'
import { normalizeTiming, previewTiming, nextOccurrence } from './timing.ts'
import { reserveAutomationRun } from './runtime.ts'
import { parseAtInput } from '@deepseek-ai/dsh-schedule/timing'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'

/** Error thrown for operation failures. */
export class AutomationOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AutomationOperationError'
  }
}

/** Pending request with confirmation challenge. */
interface PendingRequest {
  readonly requestId: string
  readonly confirmationId: string | null
  readonly accountId: string
  readonly epoch: number
  readonly operation: AutomationOperation
  readonly expectedRevision: number
  readonly digest: string
  readonly expiresAt: number
  readonly requiresConfirmation: boolean
  readonly summary: string
}

/** Configuration for automation limits. */
export interface AutomationConfig {
  readonly maxConcurrent: number
  readonly runTimeoutMs: number
  readonly historyDays: number
  readonly historyRecords: number
  readonly historyBytes: number
  readonly receiptDays: number
  readonly receiptRecords: number
  readonly receiptBytes: number
  readonly maxTaskBytes: number
  readonly maxTasksPerAccount: number
  readonly maxTasks: number
  readonly maxInstructionChars: number
  readonly maxInstructionBytes: number
  readonly confirmationTimeoutMs: number
}


/** Manages automation operations with idempotency and validation. */
export class AutomationOperations {
  private readonly ctx: Context
  /** The underlying store (read-only access for runtime). */
  readonly store: AutomationStore
  private readonly config: AutomationConfig
  private readonly pendingRequests: Map<string, PendingRequest>
  private readonly identityProvider: () => Promise<AutomationAccountIdentity | null>
  private readonly runtimeId: string
  private admissionLocked = false
  private readonly cleanupTimer: NodeJS.Timeout
  private readonly transact: <T>(work: () => Promise<T>) => Promise<T>

  /**
   * @param ctx - Host context with workspace/llm services for choices validation.
   * @param store - The opened automation store.
   * @param config - Fully resolved deployment limits (validated by the service Config schema).
   * @param identityProvider - Function returning the current account identity.
   * @param runtimeId - The shared Host runtime id; manual reservations use this
   * same owner identity as timer-created reservations.
   * @param transact - Optional shared FIFO; when omitted, operations run directly
   * (used by tests with an in-memory store).
   */
  constructor(
    ctx: Context,
    store: AutomationStore,
    config: AutomationConfig,
    identityProvider: () => Promise<AutomationAccountIdentity | null>,
    runtimeId: string,
    transact?: <T>(work: () => Promise<T>) => Promise<T>
  ) {
    let chain = Promise.resolve()
    this.transact = transact ?? (work => {
      const result = chain.then(work)
      chain = result.then(() => undefined, () => undefined)
      return result
    })
    this.ctx = ctx
    this.store = store
    this.config = config
    this.pendingRequests = new Map()
    this.identityProvider = identityProvider
    this.runtimeId = runtimeId

    // Clean up expired requests periodically
    this.cleanupTimer = setInterval(() => this.cleanupExpiredRequests(), 60_000)
  }

  /** Dispose the periodic cleanup timer. */
  dispose(): void {
    clearInterval(this.cleanupTimer)
  }

  /** Generate a unique task id. */
  private generateTaskId(): AutomationTaskId {
    return `task-${randomUUID()}` as AutomationTaskId
  }


  /** Generate a unique request id. */
  private generateRequestId(): string {
    return `req-${randomUUID()}`
  }

  /** Generate a confirmation id for GUI confirmation. */
  private generateConfirmationId(): string {
    return `confirm-${randomUUID()}`
  }
  /** Compute a SHA-256 digest of an operation for idempotency. */
  private computeDigest(operation: AutomationOperation): string {
    // Canonical JSON with sorted keys for stable hashing
    const canonical = JSON.stringify(operation, Object.keys(operation).sort())
    return createHash('sha256').update(canonical).digest('hex')
  }

  /** Get current identity or throw. */
  private async requireIdentity(): Promise<AutomationAccountIdentity> {
    const identity = await this.identityProvider()
    if (!identity) {
      throw new AutomationOperationError('not_authenticated', 'No active account')
    }
    return identity
  }

  /** Check if account matches current identity. */
  private async assertAccountMatch(accountId: string, epoch: number): Promise<void> {
    const identity = await this.requireIdentity()
    if (identity.accountId !== accountId || identity.epoch !== epoch) {
      throw new AutomationOperationError('account_mismatch', 'Account identity has changed')
    }
  }

  /** Clean up expired pending requests. */
  private cleanupExpiredRequests(): void {
    const now = Date.now()
    for (const [id, request] of this.pendingRequests) {
      if (request.expiresAt < now) {
        this.pendingRequests.delete(id)
      }
    }
  }

  /** Validate a draft. */
  private validateDraft(draft: AutomationDraft, now: number, existing?: AutomationTiming): { timing: AutomationTiming; nextOccurrences: string[] } {
    if (draft.name.trim().length === 0 || draft.name.trim().length > 120) throw new AutomationOperationError('invalid_name', 'Task name must contain 1–120 characters.')
    const instruction = draft.instruction.trim()
    if (instruction.length === 0 || instruction.length > this.config.maxInstructionChars || Buffer.byteLength(instruction, 'utf8') > this.config.maxInstructionBytes) throw new AutomationOperationError('invalid_instruction', 'The task instruction is empty or exceeds the configured limit.')
    if (draft.workspaceId.length === 0) throw new AutomationOperationError('invalid_workspace', 'Select a registered workspace.')
    if (draft.modelId.length === 0) throw new AutomationOperationError('invalid_model', 'Select a current-account model.')
    let timing: AutomationTiming
    try {
      const input = draft.timing
      const retained = existing !== undefined && (
        (input.kind === 'once' && existing.kind === 'once' && parseAtInput(input.at) === Date.parse(existing.at))
        || (input.kind === 'interval' && existing.kind === 'interval' && input.seconds === existing.seconds && input.firstAt !== undefined && parseAtInput(input.firstAt) === Date.parse(existing.firstAt))
        || (input.kind === 'delay' && existing.kind === 'delay' && input.seconds === existing.seconds)
      )
      timing = existing !== undefined && retained ? existing : normalizeTiming(input, now)
      if (existing?.kind === 'delay' && !retained && timing.kind === 'delay') timing = { kind: 'once', at: timing.at }
    } catch (error) {
      throw new AutomationOperationError('invalid_timing', `Invalid timing: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { timing, nextOccurrences: previewTiming(timing, now, 3) }
  }

  /** Create a snapshot from draft and normalized timing. */
  private createSnapshot(draft: AutomationDraft, timing: AutomationTiming): AutomationSnapshot {
    return {
      name: draft.name.trim(),
      instruction: draft.instruction.trim(),
      workspaceId: draft.workspaceId,
      modelId: draft.modelId,
      reasoningEffort: draft.reasoningEffort,
      timing,
    }
  }

  /** Preview a draft without persisting. */
  async preview(draft: AutomationDraft): Promise<AutomationPreview> {
    const now = Date.now()
    await this.requireIdentity()
    const { nextOccurrences } = this.validateDraft(draft, now)

    return {
      draft: {
        ...draft,
        name: draft.name.trim(),
        instruction: draft.instruction.trim(),
      },
      nextOccurrences,
    }
  }

  /** Prepare an operation for confirmation. */
  async prepareOperation(operation: AutomationOperation): Promise<AutomationPreparedOperation> {
    const identity = await this.requireIdentity()
    const now = Date.now()
    const requestId = this.generateRequestId()
    const confirmationId = this.generateConfirmationId()
    const digest = this.computeDigest(operation)

    // Check for existing receipt (idempotency)
    const existingReceipt = this.store.getReceipt(identity.accountId, requestId)
    if (existingReceipt && existingReceipt.expiresAt > now) {
      return {
        requestId,
        confirmationId: null,
        requiresConfirmation: false,
        summary: 'Operation already completed',
        expiresAt: existingReceipt.expiresAt,
      }
    }

    // Validate operation and build summary
    let requiresConfirmation = false
    let summary = ''

    switch (operation.action) {
      case 'create': {
        const { nextOccurrences } = this.validateDraft(operation.draft, now)
        requiresConfirmation = true
        summary = `Create task "${operation.draft.name.trim()}" with timing "${JSON.stringify(operation.draft.timing)}". Next runs: ${nextOccurrences.join(', ')}`
        break
      }
      case 'update': {
        const task = this.store.get(operation.id)
        if (!task) {
          throw new AutomationOperationError('task_not_found', 'Task not found')
        }
        if (task.ownerAccountId !== identity.accountId) {
          throw new AutomationOperationError('not_authorized', 'Not authorized to update this task')
        }
        if (task.revision !== operation.expectedRevision) {
          throw new AutomationOperationError('revision_conflict', 'Task has been modified')
        }
        if (task.deletedAt) {
          throw new AutomationOperationError('task_deleted', 'Task has been deleted')
        }
        const { nextOccurrences } = this.validateDraft(operation.draft, now, task.definition.timing)
        requiresConfirmation = true
        summary = `Update task "${task.definition.name}" to "${operation.draft.name.trim()}". Next runs: ${nextOccurrences.join(', ')}`
        break
      }
      case 'pause':
      case 'resume':
      case 'remove':
      case 'purgeDeleted': {
        const task = this.store.get(operation.id)
        if (!task) {
          throw new AutomationOperationError('task_not_found', 'Task not found')
        }
        if (task.ownerAccountId !== identity.accountId) {
          throw new AutomationOperationError('not_authorized', 'Not authorized')
        }
        if (task.revision !== operation.expectedRevision) {
          throw new AutomationOperationError('revision_conflict', 'Task has been modified')
        }
        summary = `${operation.action} task "${task.definition.name}"`
        break
      }
      case 'run': {
        const task = this.store.get(operation.id)
        if (!task) {
          throw new AutomationOperationError('task_not_found', 'Task not found')
        }
        if (task.ownerAccountId !== identity.accountId) {
          throw new AutomationOperationError('not_authorized', 'Not authorized')
        }
        if (task.revision !== operation.expectedRevision) {
          throw new AutomationOperationError('revision_conflict', 'Task has been modified')
        }
        if (task.deletedAt) {
          throw new AutomationOperationError('task_deleted', 'Task has been deleted')
        }
        if (task.activeRunId) {
          throw new AutomationOperationError('run_active', 'Task already has an active run')
        }
        summary = `Run task "${task.definition.name}" now`
        break
      }
      case 'stop': {
        const task = this.store.get(operation.id)
        if (!task) {
          throw new AutomationOperationError('task_not_found', 'Task not found')
        }
        if (task.ownerAccountId !== identity.accountId) {
          throw new AutomationOperationError('not_authorized', 'Not authorized')
        }
        const run = task.runs.find(r => r.id === operation.runId)
        if (!run) {
          throw new AutomationOperationError('run_not_found', 'Run not found')
        }
        if (!this.isActiveState(run.state)) {
          throw new AutomationOperationError('run_inactive', 'Run is not active')
        }
        summary = `Stop run for task "${task.definition.name}"`
        break
      }
    }

    // Store pending request
    const pending: PendingRequest = {
      requestId,
      confirmationId: requiresConfirmation ? confirmationId : null,
      accountId: identity.accountId,
      epoch: identity.epoch,
      operation,
      expectedRevision: (operation as { expectedRevision?: number }).expectedRevision ?? 0,
      digest,
      expiresAt: now + this.config.confirmationTimeoutMs,
      requiresConfirmation,
      summary,
    }
    this.pendingRequests.set(requestId, pending)

    return {
      requestId,
      confirmationId: requiresConfirmation ? confirmationId : null,
      requiresConfirmation,
      summary,
      expiresAt: pending.expiresAt,
    }
  }

  /** Check if run state is active. */
  private isActiveState(state: string): boolean {
    return state === 'reserved' || state === 'running' || state === 'waiting-approval' || state === 'stopping'
  }
  /** Commit a prepared operation. */
  async commitOperation(request: AutomationCommitRequest): Promise<AutomationMutationResult> {
    const captured = await this.requireIdentity()
    const commit = async (): Promise<AutomationMutationResult> => {
      const identity = await this.requireIdentity()
      if (identity.accountId !== captured.accountId || identity.epoch !== captured.epoch) throw new AutomationOperationError('account_mismatch', 'The active account changed before acceptance.')
      const now = Date.now()
      const receipt = this.store.getReceipt(identity.accountId, request.requestId)
      if (receipt !== undefined) {
        if (receipt.expiresAt <= now) throw new AutomationOperationError('request_expired', 'The request receipt expired; prepare a new operation.')
        return { task: this.store.get(receipt.result.taskId) ?? null, ...receipt.result }
      }
      const pending = this.pendingRequests.get(request.requestId)
      if (pending === undefined || pending.expiresAt <= now) throw new AutomationOperationError('request_expired', 'Prepare and confirm this operation again.')
      if (pending.accountId !== identity.accountId || pending.epoch !== identity.epoch) throw new AutomationOperationError('account_mismatch', 'The account that confirmed this operation is no longer active.')
      if (pending.requiresConfirmation && request.confirmationId !== pending.confirmationId) throw new AutomationOperationError('confirmation_required', 'Explicit user confirmation is required.')
      const result = await this.executeOperation(pending.operation, request.requestId, now, identity)
      this.pendingRequests.delete(request.requestId)
      return result
    }
    return this.transact(commit)
  }

  /** Execute an operation and return the result. */
  private async executeOperation(
    operation: AutomationOperation,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity,
  ): Promise<AutomationMutationResult> {
    switch (operation.action) {
      case 'create':
        return this.executeCreate(operation.draft, requestId, now, identity)
      case 'update':
        return this.executeUpdate(operation.id, operation.expectedRevision, operation.draft, requestId, now, identity)
      case 'pause':
        return this.executePause(operation.id, operation.expectedRevision, requestId, now, identity)
      case 'resume':
        return this.executeResume(operation.id, operation.expectedRevision, requestId, now, identity)
      case 'remove':
        return this.executeRemove(operation.id, operation.expectedRevision, requestId, now, identity)
      case 'purgeDeleted':
        return this.executePurgeDeleted(operation.id, operation.expectedRevision, requestId, now, identity)
      case 'run':
        return this.executeRun(operation.id, operation.expectedRevision, requestId, now, identity)
      case 'stop':
        return this.executeStop(operation.id, operation.runId, requestId, now, identity)
      default:
        throw new AutomationOperationError('unknown_action', `Unknown action: ${(operation as { action: string }).action}`)
    }
  }

  /** Execute create operation. */
  private async executeCreate(
    draft: AutomationDraft,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const digest = this.computeDigest({ action: 'create', draft } as AutomationOperation)
    // Check account task limit
    const taskCount = this.store.countByAccount(identity.accountId)
    if (taskCount >= this.config.maxTasksPerAccount) {
      throw new AutomationOperationError('task_limit', `Maximum ${this.config.maxTasksPerAccount} tasks per account`)
    }

    // Check global task limit
    const allTasks = this.store.tasks()
    if (allTasks.length >= this.config.maxTasks) {
      throw new AutomationOperationError('global_task_limit', `Maximum ${this.config.maxTasks} tasks`)
    }

    // Validate and normalize
    const { timing, nextOccurrences } = this.validateDraft(draft, now)
    const snapshot = this.createSnapshot(draft, timing)

    // Compute next occurrence
    const nextAt = nextOccurrences[0] ?? null

    // Create task
    const taskId = this.generateTaskId()
    const createdAt = new Date(now).toISOString()
    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId, runId: null, deleted: false },
    }

    const task: AutomationTask = {
      id: taskId,
      ownerAccountId: identity.accountId,
      revision: 1,
      recordVersion: 1,
      authorizationRevision: 1,
      consentRevision: 1,
      ruleRevision: 1,
      definition: snapshot,
      enabled: true,
      deletedAt: null,
      nextOccurrenceAt: nextAt,
      occurrenceWatermark: null,
      pendingOccurrence: null,
      activeRunId: null,
      runs: [],
      requestReceipts: [receipt],
      creationRequest: { requestId, digest },
      historyPruned: false,
      skippedRange: null,
      createdAt,
      updatedAt: createdAt,
    }

    await this.store.put(task)

    return { task, taskId, runId: null, deleted: false }
  }

  /** Execute update operation. */
  private async executeUpdate(
    id: AutomationTaskId,
    expectedRevision: number,
    draft: AutomationDraft,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const digest = this.computeDigest({ action: 'update', id, expectedRevision, draft } as AutomationOperation)
    const updatedAt = new Date(now).toISOString()
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    if (task.revision !== expectedRevision) {
      throw new AutomationOperationError('revision_conflict', 'Task has been modified')
    }
    if (task.deletedAt) {
      throw new AutomationOperationError('task_deleted', 'Task has been deleted')
    }

    const { timing } = this.validateDraft(draft, now, task.definition.timing)
    const snapshot = this.createSnapshot(draft, timing)
    const timingChanged = !deepEqualJson(timing, task.definition.timing)
    const authorizationChanged = timingChanged || snapshot.instruction !== task.definition.instruction
      || snapshot.workspaceId !== task.definition.workspaceId || snapshot.modelId !== task.definition.modelId
      || snapshot.reasoningEffort !== task.definition.reasoningEffort
    const newAuthorizationRevision = task.authorizationRevision + (authorizationChanged ? 1 : 0)
    const newConsentRevision = newAuthorizationRevision
    const newRuleRevision = task.ruleRevision + (timingChanged ? 1 : 0)
    const nextAt = !task.enabled ? null : timingChanged ? nextOccurrence(timing, now) : task.nextOccurrenceAt

    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId: id, runId: null, deleted: false },
    }

    const updatedTask: AutomationTask = {
      ...task,
      revision: task.revision + 1,
      recordVersion: task.recordVersion + 1,
      authorizationRevision: newAuthorizationRevision,
      consentRevision: newConsentRevision,
      ruleRevision: newRuleRevision,
      definition: snapshot,
      nextOccurrenceAt: nextAt,
      pendingOccurrence: authorizationChanged ? null : task.pendingOccurrence,
      updatedAt,
      requestReceipts: [...task.requestReceipts, receipt],
    }

    // Prune receipts if needed (mutates updatedTask inline)
    const pruned = this.pruneReceipts(updatedTask)

    await this.store.put(pruned)

    return { task: pruned, taskId: id, runId: null, deleted: false }
  }

  /** Execute pause operation. */
  private async executePause(
    id: AutomationTaskId,
    expectedRevision: number,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    if (task.revision !== expectedRevision) {
      throw new AutomationOperationError('revision_conflict', 'Task has been modified')
    }
    if (task.deletedAt) {
      throw new AutomationOperationError('task_deleted', 'Task has been deleted')
    }
    if (!task.enabled) {
      throw new AutomationOperationError('already_paused', 'Task is already paused')
    }

    const updatedAt = new Date(now).toISOString()
    const digest = this.computeDigest({ action: 'pause', id, expectedRevision } as AutomationOperation)

    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId: id, runId: null, deleted: false },
    }

    // Track skipped range
    const skippedRange = task.nextOccurrenceAt ? {
      from: task.nextOccurrenceAt,
      through: new Date(now).toISOString(),
      reason: 'paused',
    } : null

    const updatedTask: AutomationTask = {
      ...task,
      revision: task.revision + 1,
      recordVersion: task.recordVersion + 1,
      enabled: false,
      nextOccurrenceAt: null,
      pendingOccurrence: null,
      skippedRange,
      updatedAt,
      requestReceipts: [...task.requestReceipts, receipt],
    }

    const pruned = this.pruneReceipts(updatedTask)
    await this.store.put(pruned)

    return { task: pruned, taskId: id, runId: null, deleted: false }
  }

  /** Execute resume operation. */
  private async executeResume(
    id: AutomationTaskId,
    expectedRevision: number,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    if (task.revision !== expectedRevision) {
      throw new AutomationOperationError('revision_conflict', 'Task has been modified')
    }
    if (task.deletedAt) {
      throw new AutomationOperationError('task_deleted', 'Task has been deleted')
    }
    if (task.enabled) {
      throw new AutomationOperationError('already_enabled', 'Task is already enabled')
    }

    // Compute next occurrence from now
    const nextAt = nextOccurrence(task.definition.timing, now)

    const updatedAt = new Date(now).toISOString()
    const digest = this.computeDigest({ action: 'resume', id, expectedRevision } as AutomationOperation)

    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId: id, runId: null, deleted: false },
    }

    const updatedTask: AutomationTask = {
      ...task,
      revision: task.revision + 1,
      recordVersion: task.recordVersion + 1,
      ruleRevision: task.ruleRevision + 1, // Resume advances rule revision
      enabled: true,
      nextOccurrenceAt: nextAt,
      pendingOccurrence: null,
      updatedAt,
      requestReceipts: [...task.requestReceipts, receipt],
    }

    const pruned = this.pruneReceipts(updatedTask)
    await this.store.put(pruned)

    return { task: pruned, taskId: id, runId: null, deleted: false }
  }

  /** Execute remove operation (soft delete). */
  private async executeRemove(
    id: AutomationTaskId,
    expectedRevision: number,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    if (task.revision !== expectedRevision) {
      throw new AutomationOperationError('revision_conflict', 'Task has been modified')
    }
    if (task.deletedAt) {
      throw new AutomationOperationError('already_deleted', 'Task is already deleted')
    }
    if (task.activeRunId) {
      throw new AutomationOperationError('run_active', 'Cannot delete task with active run')
    }

    const updatedAt = new Date(now).toISOString()
    const digest = this.computeDigest({ action: 'remove', id, expectedRevision } as AutomationOperation)

    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId: id, runId: null, deleted: true },
    }

    const updatedTask: AutomationTask = {
      ...task,
      revision: task.revision + 1,
      recordVersion: task.recordVersion + 1,
      enabled: false,
      deletedAt: updatedAt,
      nextOccurrenceAt: null,
      pendingOccurrence: null,
      updatedAt,
      requestReceipts: [...task.requestReceipts, receipt],
    }

    const pruned = this.pruneReceipts(updatedTask)
    await this.store.put(pruned)

    return { task: pruned, taskId: id, runId: null, deleted: true }
  }

  /** Execute purge deleted operation. */
  private async executePurgeDeleted(
    id: AutomationTaskId,
    _expectedRevision: number,
    _requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    if (!task.deletedAt) {
      throw new AutomationOperationError('not_deleted', 'Task is not deleted')
    }
    if (task.activeRunId) {
      throw new AutomationOperationError('run_active', 'Cannot purge task with active run')
    }

    // Check all receipts are expired
    const allReceiptsExpired = task.requestReceipts.every(r => r.expiresAt < now)
    if (!allReceiptsExpired) {
      throw new AutomationOperationError('receipts_active', 'Some receipts have not expired')
    }

    await this.store.delete(id)

    return { task: null, taskId: id, runId: null, deleted: true }
  }

  /** Execute run now operation. */
  private async executeRun(
    id: AutomationTaskId,
    expectedRevision: number,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    if (task.revision !== expectedRevision) {
      throw new AutomationOperationError('revision_conflict', 'Task has been modified')
    }
    if (task.deletedAt) {
      throw new AutomationOperationError('task_deleted', 'Task has been deleted')
    }
    if (task.activeRunId) {
      throw new AutomationOperationError('run_active', 'Task already has an active run')
    }

    // Check admission lock
    if (this.admissionLocked) {
      throw new AutomationOperationError('admission_locked', 'New runs are temporarily disabled')
    }

    // Check concurrent run limit
    const activeRuns = this.store.tasks().filter(t => t.activeRunId !== null).length
    if (activeRuns >= this.config.maxConcurrent) {
      throw new AutomationOperationError('concurrent_limit', `Maximum ${this.config.maxConcurrent} concurrent runs`)
    }

    const reserved = reserveAutomationRun(task, 'manual', null, requestId, now, this.runtimeId)
    const runId = reserved.run.id

    const updatedAt = new Date(now).toISOString()
    const digest = this.computeDigest({ action: 'run', id, expectedRevision } as AutomationOperation)

    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId: id, runId, deleted: false },
    }

    const updatedTask: AutomationTask = {
      ...reserved.task,
      updatedAt,
      requestReceipts: [...task.requestReceipts, receipt],
    }

    const pruned = this.pruneReceipts(updatedTask)
    await this.store.put(pruned)

    return { task: pruned, taskId: id, runId, deleted: false }
  }

  /** Execute stop run operation. */
  private async executeStop(
    id: AutomationTaskId,
    runId: AutomationRunId,
    requestId: string,
    now: number,
    identity: AutomationAccountIdentity
  ): Promise<AutomationMutationResult> {
    const task = this.store.get(id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }

    const runIndex = task.runs.findIndex(r => r.id === runId)
    if (runIndex === -1) {
      throw new AutomationOperationError('run_not_found', 'Run not found')
    }

    const run = task.runs[runIndex]
    if (run === undefined) {
      throw new AutomationOperationError('run_not_found', 'Run not found')
    }
    if (!this.isActiveState(run.state)) {
      throw new AutomationOperationError('run_inactive', 'Run is not active')
    }

    // Update run state to stopping
    const updatedRun: AutomationRun = {
      ...run,
      state: 'stopping',
    }

    const updatedRuns = [...task.runs]
    updatedRuns[runIndex] = updatedRun

    const updatedAt = new Date(now).toISOString()
    const digest = this.computeDigest({ action: 'stop', id, runId } as AutomationOperation)

    const receipt: AutomationReceipt = {
      requestId,
      digest,
      acceptedAt: now,
      expiresAt: now + this.config.receiptDays * 24 * 60 * 60 * 1000,
      result: { taskId: id, runId, deleted: false },
    }

    const updatedTask: AutomationTask = {
      ...task,
      recordVersion: task.recordVersion + 1,
      runs: updatedRuns,
      updatedAt,
      requestReceipts: [...task.requestReceipts, receipt],
    }

    const pruned = this.pruneReceipts(updatedTask)
    await this.store.put(pruned)

    // Notify runtime to stop the run (outside FIFO)
    this.emitRunStopRequested(id, runId)

    return { task: pruned, taskId: id, runId, deleted: false }
  }

  /** Emit event for runtime to stop a run. */
  private emitRunStopRequested(taskId: AutomationTaskId, runId: AutomationRunId): void {
    this.ctx.emit('automation/run-stop-requested', { taskId, runId })
  }

  /** Prune old receipts. Returns a new task with pruned receipts. */
  private pruneReceipts(task: AutomationTask): AutomationTask {
    const now = Date.now()
    // Expired receipts are safely discardable; unexpired ones are still valid
    // idempotency evidence and must never be silently dropped.
    const kept = task.requestReceipts.filter(r => r.expiresAt > now)
    const keptBytes = Buffer.byteLength(JSON.stringify(kept), 'utf8')
    if (kept.length > this.config.receiptRecords || keptBytes > this.config.receiptBytes) {
      throw new AutomationOperationError('receipt_capacity', 'Receipt storage budget is full; retry later or purge deleted tasks.')
    }
    return { ...task, requestReceipts: kept }
  }

  /** List tasks for the current account. */
  async list(request: AutomationListRequest): Promise<AutomationTaskPage> {
    const identity = await this.requireIdentity()
    const tasks = this.store.getByAccount(identity.accountId)

    // Apply filters
    let filtered = tasks
    if (request.status && request.status !== 'all') {
      switch (request.status) {
        case 'enabled':
          filtered = tasks.filter(t => t.enabled && !t.deletedAt)
          break
        case 'paused':
          filtered = tasks.filter(t => !t.enabled && !t.deletedAt)
          break
        case 'deleted':
          filtered = tasks.filter(t => t.deletedAt)
          break
      }
    }

    // Apply search
    if (request.search) {
      const search = request.search.toLowerCase()
      filtered = filtered.filter(t =>
        t.definition.name.toLowerCase().includes(search) ||
        t.definition.instruction.toLowerCase().includes(search)
      )
    }

    // Sort by updatedAt desc
    filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // Apply cursor/limit
    const limit = request.limit ?? 20
    let cursorIndex = 0
    if (request.cursor) {
      const index = filtered.findIndex(t => t.id === request.cursor)
      if (index !== -1) {
        cursorIndex = index + 1
      }
    }

    const page = filtered.slice(cursorIndex, cursorIndex + limit)
    const lastItem = page.length > 0 ? page[page.length - 1] : undefined
    const nextCursor: string | null = cursorIndex + limit < filtered.length && lastItem !== undefined
      ? lastItem.id
      : null

    // Reassert identity before resolving so a mid-request account switch cannot
    // publish old-account tasks to the new account's client.
    await this.assertAccountMatch(identity.accountId, identity.epoch)

    return { tasks: page, nextCursor }
  }

  /** Get a task by id. */
  async get(request: AutomationGetRequest): Promise<AutomationTask> {
    const identity = await this.requireIdentity()
    const task = this.store.get(request.id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }
    // Reassert identity before resolving so a mid-request account switch cannot
    // publish old-account tasks to the new account's client.
    await this.assertAccountMatch(identity.accountId, identity.epoch)
    return task
  }


  /** Get runs for a task. */
  async runs(request: AutomationRunsRequest): Promise<AutomationRunsPage> {
    const identity = await this.requireIdentity()
    const task = this.store.get(request.id)
    if (!task) {
      throw new AutomationOperationError('task_not_found', 'Task not found')
    }
    if (task.ownerAccountId !== identity.accountId) {
      throw new AutomationOperationError('not_authorized', 'Not authorized')
    }

    // Sort runs by requestedAt desc
    const sorted = [...task.runs].sort((a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    )

    // Apply cursor
    let startIndex = 0
    if (request.before) {
      const index = sorted.findIndex(r => r.id === request.before)
      if (index !== -1) {
        startIndex = index + 1
      }
    }

    const page = sorted.slice(startIndex, startIndex + request.limit)
    const lastRun = page.length > 0 ? page[page.length - 1] : undefined
    const nextBefore: AutomationRunId | null = startIndex + request.limit < sorted.length && lastRun !== undefined
      ? lastRun.id
      : null

    // Reassert identity before resolving so a mid-request account switch cannot
    // publish old-account tasks to the new account's client.
    await this.assertAccountMatch(identity.accountId, identity.epoch)

    return {
      records: page,
      nextBefore,
      historyPruned: task.historyPruned,
    }
  }
  /**
   * Get Host-approved form selections for the current account.
   *
   * Workspaces come from the workspace registry (registered directories only).
   * Models come from the LLM catalog: each provider route's advertised models.
   * No private credentials are included.
   * @returns Account id, registered workspaces, catalog models, and default model.
   */
  async choices(): Promise<AutomationChoices> {
    const identity = await this.requireIdentity()

    // Registered workspaces only; never create or guess directories.
    const workspaces = this.ctx.workspaceRegistry?.list() ?? []
    const workspaceChoices = workspaces.map((w) => ({
      id: w.id,
      name: w.title,
      path: w.path,
    }))

    // Catalog models from every registered provider route.
    const models: { id: string; name: string; reasoningEfforts: string[] }[] = []
    let defaultModelId: string | null = null
    const llm = this.ctx.llm
    if (llm !== undefined) {
      for (const provider of llm.listProviders()) {
        let catalog: readonly LlmModelInfo[]
        try {
          catalog = await llm.listModels(provider.id)
        } catch (error: unknown) {
          this.ctx.logger.warn(`asterhubAutomation: model catalog for provider "${provider.id}" unavailable: ${String(error)}`)
          continue
        }
        for (const model of catalog) {
          models.push({
            id: model.id,
            name: model.name,
            reasoningEfforts: [],
          })
        }
      }
      const route = this.ctx.get('applicationModelRoute')
      if (route !== undefined && route.selectableModels !== false) {
        defaultModelId = route.model
      }
    }

    // Legacy schedule detection: read-only, no mutation, no task content returned.
    const legacyScheduleStatus = await this.detectLegacySchedule()

    // Reassert identity before resolving so a mid-request account switch cannot
    // publish old-account selections to the new account's client.
    await this.assertAccountMatch(identity.accountId, identity.epoch)

    return {
      accountId: identity.accountId,
      legacyScheduleStatus,
      workspaces: workspaceChoices,
      models,
      defaultModelId,
    }
  }

  /**
   * Detect legacy schedule installation status without mounting old ScheduleService
   * or changing old rows. Opens the schedule domain read-only, checks for presence,
   * and closes the handle. Invalid legacy data returns 'unreadable'.
   * @returns 'none' | 'present' | 'unreadable'
   */
  private async detectLegacySchedule(): Promise<'none' | 'present' | 'unreadable'> {
    try {
      // Open the schedule domain; this validates stored records.
      const domain = await this.ctx.storageDomain.open(scheduleDomain)
      try {
        const table = domain.table('tasks')
        const hasAny = table.size > 0
        return hasAny ? 'present' : 'none'
      } finally {
        // Always close the handle; do not keep it open.
        await domain.close()
      }
    } catch (error: unknown) {
      // If domain is already open (product conflict), diagnose as unreadable.
      // Invalid legacy data or storage failure also returns 'unreadable'.
      this.ctx.logger.warn(`asterhubAutomation: legacy schedule detection failed: ${String(error)}`)
      return 'unreadable'
    }
  }

  /** Get lifecycle state. */
  inspectLifecycle(): { armed: boolean; active: boolean } {
    const activeTasks = this.store.getActiveTasks()
    const hasActiveRuns = this.store.hasActiveRuns()
    return {
      armed: activeTasks.length > 0,
      active: hasActiveRuns,
    }
  }

  /** Set admission lock. */
  setAdmissionLocked(locked: boolean): void {
    this.admissionLocked = locked
  }

  /** Get limits. */
  getLimits(): AutomationLimits {
    return {
      maxConcurrent: this.config.maxConcurrent,
      runTimeoutMs: this.config.runTimeoutMs,
      historyDays: this.config.historyDays,
      historyRecords: this.config.historyRecords,
      historyBytes: this.config.historyBytes,
      receiptDays: this.config.receiptDays,
      receiptRecords: this.config.receiptRecords,
      receiptBytes: this.config.receiptBytes,
      maxTaskBytes: this.config.maxTaskBytes,
      maxTasksPerAccount: this.config.maxTasksPerAccount,
      maxTasks: this.config.maxTasks,
      maxInstructionChars: this.config.maxInstructionChars,
      maxInstructionBytes: this.config.maxInstructionBytes,
      confirmationTimeoutMs: this.config.confirmationTimeoutMs,
    }
  }
}
