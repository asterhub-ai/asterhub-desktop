/** Task aggregate storage and in-memory indexing. */
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { automationDomain, validateTaskAggregate } from './schema.ts'
import type {
  AutomationTask,
  AutomationTaskId,
  AutomationRun,
  AutomationReceipt,
} from './types.ts'

/** Table type for automation tasks. */
export type AutomationTaskTable = KvTable<AutomationTaskId, AutomationTask>

/**
 * Opens the automation domain and validates stored records.
 * @param ctx - Host Cordis context supplying the required services.
 * @returns Opened schedule store whose domain closes with its owning plugin.
 */
export async function openAutomationStore(ctx: Context): Promise<AutomationStore> {
  const domain = await ctx.storageDomain.open(automationDomain)
  const table = domain.table('tasks')

  // Validate all stored tasks on open
  const errors: string[] = []
  for (const [key, task] of table.entries()) {
    try {
      if (key !== task.id) {
        errors.push(`Task id mismatch: key "${key}" != record id "${task.id}"`)
      }
      validateTaskAggregate(task)
    } catch (error) {
      errors.push(`Invalid task "${key}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length > 0) {
    await domain.close()
    throw new Error(`Automation domain validation failed:\n${errors.join('\n')}`)
  }

  return AutomationStore.open(domain, table)
}

/** In-memory index for fast lookups. */
interface TaskIndex {
  byAccount: Map<string, Set<AutomationTaskId>>
  byWorkspace: Map<string, Set<AutomationTaskId>>
  activeTasks: Set<AutomationTaskId>
  pendingRuns: Map<AutomationTaskId, AutomationRun>
}

/** Manages automation task aggregates with validation and indexing. */
export class AutomationStore {
  private readonly domain: Domain<typeof automationDomain>
  private readonly table: AutomationTaskTable
  private index: TaskIndex

  private constructor(domain: Domain<typeof automationDomain>, table: AutomationTaskTable) {
    this.domain = domain
    this.table = table
    this.index = this.buildIndex()
  }

  /**
   * Static factory for opening a store from validated domain/table.
   * @param domain - Opened schedule storage domain owned by this store.
   * @param table - Task table within the schedule domain.
   * @returns Store with a validated in-memory index over the supplied table.
   */
  static open(domain: Domain<typeof automationDomain>, table: AutomationTaskTable): AutomationStore {
    return new AutomationStore(domain, table)
  }

  /** Rebuild the in-memory index from stored tasks. */
  private buildIndex(): TaskIndex {
    const index: TaskIndex = {
      byAccount: new Map(),
      byWorkspace: new Map(),
      activeTasks: new Set(),
      pendingRuns: new Map(),
    }

    for (const [, task] of this.table.entries()) {
      // Index by account
      let accountSet = index.byAccount.get(task.ownerAccountId)
      if (!accountSet) {
        accountSet = new Set()
        index.byAccount.set(task.ownerAccountId, accountSet)
      }
      accountSet.add(task.id)

      // Index by workspace
      let workspaceSet = index.byWorkspace.get(task.definition.workspaceId)
      if (!workspaceSet) {
        workspaceSet = new Set()
        index.byWorkspace.set(task.definition.workspaceId, workspaceSet)
      }
      workspaceSet.add(task.id)

      // Track active (enabled, not deleted) tasks
      if (task.enabled && !task.deletedAt) {
        index.activeTasks.add(task.id)
      }

      // Track pending runs (reserved, running, waiting-approval, stopping)
      if (task.activeRunId) {
        const activeRun = task.runs.find((r: AutomationRun) => r.id === task.activeRunId)
        if (activeRun && isActiveState(activeRun.state)) {
          index.pendingRuns.set(task.id, activeRun)
        }
      }
    }

    return index
  }

  /**
   * Get all tasks.
   * @returns Current task aggregates in storage order.
   */
  tasks(): readonly AutomationTask[] {
    return [...this.table.entries()].map(([, task]) => task)
  }
  /**
   * Get a task by id.
   * @param id - Task identity.
   * @returns Matching task, or undefined when it is absent.
   */
  get(id: AutomationTaskId): AutomationTask | undefined {
    return this.table.get(id)
  }

  /**
   * Get tasks for an account.
   * @param accountId - Account identity used to filter owned records.
   * @returns Tasks owned by the selected account.
   */
  getByAccount(accountId: string): AutomationTask[] {
    const ids = this.index.byAccount.get(accountId)
    if (!ids) return []
    return [...ids].map(id => this.table.get(id)).filter((t): t is AutomationTask => t !== undefined)
  }

  /**
   * Get tasks for a workspace.
   * @param workspaceId - Workspace identity used to filter task records.
   * @returns Tasks bound to the selected workspace.
   */
  getByWorkspace(workspaceId: string): AutomationTask[] {
    const ids = this.index.byWorkspace.get(workspaceId)
    if (!ids) return []
    return [...ids].map(id => this.table.get(id)).filter((t): t is AutomationTask => t !== undefined)
  }

  /**
   * Get enabled non-deleted tasks.
   * @returns Enabled, undeleted tasks eligible for scheduling.
   */
  getActiveTasks(): AutomationTask[] {
    return [...this.index.activeTasks].map(id => this.table.get(id)).filter((t): t is AutomationTask => t !== undefined)
  }

  /**
   * Get a task's active run.
   * @param taskId - Task identity whose active attempt is requested.
   * @returns Active attempt for the task, or undefined when none exists.
   */
  getActiveRun(taskId: AutomationTaskId): AutomationRun | undefined {
    return this.index.pendingRuns.get(taskId)
  }

  /**
   * Get a receipt by request id.
   * @param accountId - Account identity used to filter owned records.
   * @param requestId - Idempotent request identity within the account.
   * @returns Matching account request receipt, or undefined when absent.
   */
  getReceipt(accountId: string, requestId: string): AutomationReceipt | undefined {
    const tasks = this.getByAccount(accountId)
    for (const task of tasks) {
      const receipt = task.requestReceipts.find(r => r.requestId === requestId)
      if (receipt) return receipt
    }
    return undefined
  }

  /**
   * Count tasks for an account.
   * @param accountId - Account identity used to filter owned records.
   * @returns Number of task aggregates owned by the account.
   */
  countByAccount(accountId: string): number {
    return this.index.byAccount.get(accountId)?.size ?? 0
  }

  /**
   * Check if any task has an active run.
   * @returns Whether any stored attempt is in an active lifecycle state.
   */
  hasActiveRuns(): boolean {
    return this.index.pendingRuns.size > 0
  }

  /**
   * Put a task (validates and indexes).
   * @param task - Complete task aggregate to persist.
   */
  async put(task: AutomationTask): Promise<void> {
    const validated = validateTaskAggregate(task)
    await this.table.put(task.id, validated)
    this.index = this.buildIndex()
  }

  /**
   * Delete a task.
   * @param id - Task identity.
   */
  async delete(id: AutomationTaskId): Promise<void> {
    await this.table.delete(id)
    this.index = this.buildIndex()
  }

  /** Close the store. */
  async close(): Promise<void> {
    await this.domain.close()
  }

  /**
   * Get the underlying domain for transactions.
   * @returns Owned schedule domain for transactional operations.
   */
  getDomain(): Domain<typeof automationDomain> {
    return this.domain
  }
}

/** Check if a run state is still active. */
function isActiveState(state: string): boolean {
  return state === 'reserved' || state === 'running' || state === 'waiting-approval' || state === 'stopping'
}
