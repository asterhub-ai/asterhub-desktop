/** One native Host timer and account-scoped, non-overlapping execution owners. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AutomationRun, AutomationRunId, AutomationTask, AutomationAccountIdentity } from './types.ts'
import type { AutomationRuntimeHost } from './runtime-contract.ts'
import { executeRun, recoverRun, isTerminalState } from './execution.ts'
import { resolveOccurrence } from './timing.ts'

const maxTimerDelay = 2_147_483_647

/**
 * Reserve before side effects; manual attempts do not consume the recurring slot.
 * @param task - Current task aggregate, read inside the shared FIFO.
 * @param trigger - Automatic or explicitly authorized manual occurrence.
 * @param occurrenceAt - Due UTC occurrence for automatic runs.
 * @param requestId - Manual idempotency identity, or null.
 * @param now - Acceptance wall time.
 * @param runtimeId - Exact Host-startup owner.
 * @returns New aggregate and its fixed-identity reserved run.
 */
export function reserveAutomationRun(task: AutomationTask, trigger: AutomationRun['trigger'], occurrenceAt: string | null, requestId: string | null, now: number, runtimeId: string): { task: AutomationTask; run: AutomationRun } {
  if (task.activeRunId !== null || task.deletedAt !== null || (trigger !== 'manual' && !task.enabled)) throw new Error('automation: task cannot be reserved')
  if (task.consentRevision !== task.authorizationRevision) throw new Error('automation: task needs confirmation')
  const run: AutomationRun = {
    id: brandString<AutomationRunId>(`run-${randomUUID()}`), taskId: task.id, trigger,
    scheduledAt: trigger === 'manual' ? null : occurrenceAt, requestedAt: new Date(now).toISOString(), requestId,
    definitionRevision: task.revision, snapshot: task.definition,
    sessionId: brandString<SessionId>(`automation-${randomUUID()}`), sessionCreated: false,
    state: 'reserved', startedAt: null, finishedAt: null, reason: null, ownerRuntimeId: runtimeId,
    inputMessageId: null, startLogOffset: null, endLogOffset: null, terminalTurn: null, interactionIds: [], humanIntervened: false,
  }
  const automatic = trigger !== 'manual'
  const next = automatic && occurrenceAt !== null ? resolveOccurrence(task.definition.timing, occurrenceAt, now).nextAt : task.nextOccurrenceAt
  return { run, task: {
    ...task, recordVersion: task.recordVersion + 1, updatedAt: new Date(now).toISOString(),
    enabled: automatic && next === null ? false : task.enabled,
    activeRunId: run.id, nextOccurrenceAt: next,
    occurrenceWatermark: automatic && occurrenceAt !== null ? { ruleRevision: task.ruleRevision, at: occurrenceAt } : task.occurrenceWatermark,
    pendingOccurrence: automatic ? null : task.pendingOccurrence, runs: [...task.runs, run],
  } }
}

interface ActiveExecution { readonly abort: AbortController; readonly done: Promise<void> }

/** Timer and resource owner; accepted work drains before the storage owner closes. */
export class AutomationRuntime {
  private timer: NodeJS.Timeout | undefined
  private driving: Promise<void> | undefined
  private requested = false
  private stopping = false
  private locked = false
  private recovered = false
  private disposal: Promise<void> | undefined
  private readonly active = new Map<AutomationRunId, ActiveExecution>()

  /** @param host - Shared task FIFO, storage and concrete Host capabilities. */
  constructor(private readonly host: AutomationRuntimeHost) {}

  /** Request timer recomputation without nesting the storage queue. */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    if (this.driving !== undefined) return
    this.clearTimer()
    const drive = this.host.ctx.agents.withoutInitiator(async () => {
      while (this.requested && !this.stopping) { this.requested = false; await this.drive() }
    })
    this.driving = drive
    void drive.catch(() => this.host.ctx.logger.error('automation: dispatch failed; task claims are retained')).finally(() => {
      this.driving = undefined
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  /** @param locked - Whether new reservations must stop for quit/update admission. */
  setAdmissionLocked(locked: boolean): void { this.locked = locked; this.clearTimer(); if (!locked) this.requestDrive() }

  /**
   * Cancel and await the exact running attempt, not merely its abort request.
   * @param runId - Attempt identity.
   * @returns After resources and terminal persistence settle.
   */
  async stopRun(runId: AutomationRunId): Promise<void> {
    const active = this.active.get(runId)
    if (active !== undefined) { active.abort.abort(); await active.done; return }
    await this.host.transact(async () => {
      const task = this.host.tasks().find(value => value.activeRunId === runId)
      if (task === undefined) return
      const run = task.runs.find(value => value.id === runId)
      if (run === undefined || (run.state !== 'reserved' && run.state !== 'stopping')) return
      const canceled = { ...run, state: 'canceled' as const, finishedAt: new Date().toISOString(), reason: { code: 'canceled', message: 'Canceled before execution.' } }
      await this.host.put({ ...task, activeRunId: null, recordVersion: task.recordVersion + 1, runs: task.runs.map(value => value.id === runId ? canceled : value) })
    })
  }

  /**
   * Find the scheduler claims that still own a result conversation.
   * @param sessionId - Result Session whose archive admission is checked.
   * @returns Active native attempts that must stop before archival.
   */
  activeRunsForSession(sessionId: SessionId): AutomationRunId[] {
    const runs: AutomationRunId[] = []
    for (const task of this.host.tasks()) {
      const run = task.runs.find(r => r.id === task.activeRunId && r.sessionId === sessionId && !isTerminalState(r.state))
      if (run) runs.push(run.id)
    }
    return runs
  }

  /** @returns True task obligations, excluding idle timer bookkeeping as active work. */
  inspectLifecycle(): { armed: boolean; active: boolean } {
    const tasks = this.host.tasks()
    return {
      armed: tasks.some(task => task.enabled && task.deletedAt === null
        && (task.nextOccurrenceAt !== null || task.pendingOccurrence !== null)),
      active: this.active.size > 0 || tasks.some(task => task.activeRunId !== null),
    }
  }

  /** @returns After timers stop and accepted executions reach quiescence. */
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.stopping = true; this.clearTimer()
      for (const value of this.active.values()) value.abort.abort()
      await this.driving
      const results = await Promise.allSettled([...this.active.values()].map(value => value.done))
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    })()
  }

  private clearTimer(): void { if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined } }

  private async drive(): Promise<void> {
    const starts: { task: AutomationTask; run: AutomationRun; identity: AutomationAccountIdentity }[] = []
    let accountId: string | undefined
    await this.host.transact(async () => {
      if (!this.recovered) {
        for (const task of this.host.tasks()) {
          const run = task.runs.find(value => value.id === task.activeRunId)
          if (run === undefined || run.ownerRuntimeId === this.host.runtimeId || isTerminalState(run.state)) continue
          const sessionExists = run.sessionId !== null && await this.host.ctx.sessionPersistence.stat(run.sessionId) !== undefined
          const recovered = recoverRun(run, sessionExists)
          await this.host.put({ ...task, activeRunId: null, recordVersion: task.recordVersion + 1, runs: task.runs.map(value => value.id === run.id ? recovered : value) })
        }
        this.recovered = true
      }
      if (this.stopping || this.locked) return
      const identity = await this.host.identity()
      if (identity === null) return
      accountId = identity.accountId
      const now = Date.now()
      for (const task of this.host.tasks()) {
        if (task.ownerAccountId !== identity.accountId || !task.enabled || task.deletedAt !== null || task.nextOccurrenceAt === null || Date.parse(task.nextOccurrenceAt) > now) continue
        const occurrence = resolveOccurrence(task.definition.timing, task.nextOccurrenceAt, now)
        const consumed = task.occurrenceWatermark?.ruleRevision === task.ruleRevision && Date.parse(task.occurrenceWatermark.at) >= Date.parse(occurrence.occurrenceAt)
        const from = task.pendingOccurrence?.ruleRevision === task.ruleRevision ? task.pendingOccurrence.from : task.nextOccurrenceAt
        this.host.ctx.accountSub2api.assertAutomationIdentity(identity)
        await this.host.put({ ...task, nextOccurrenceAt: occurrence.nextAt,
          pendingOccurrence: consumed ? task.pendingOccurrence : { at: occurrence.occurrenceAt, from, ruleRevision: task.ruleRevision },
          skippedRange: !consumed && from !== occurrence.occurrenceAt ? { from, through: occurrence.occurrenceAt, reason: 'latest-only' } : task.skippedRange,
          recordVersion: task.recordVersion + 1, updatedAt: new Date(now).toISOString() })
      }
      const tasks = this.host.tasks().filter(task => task.ownerAccountId === identity.accountId)
      let startCapacity = this.host.limits.maxConcurrent - this.active.size
      for (const task of tasks) {
        const run = task.runs.find(value => value.id === task.activeRunId && value.state === 'reserved' && value.ownerRuntimeId === this.host.runtimeId)
        if (run !== undefined && !this.active.has(run.id) && startCapacity > 0) { starts.push({ task, run, identity }); startCapacity-- }
      }
      let capacity = this.host.limits.maxConcurrent - this.host.tasks().filter(task => task.activeRunId !== null).length
      const due = tasks.filter(task => task.enabled && task.deletedAt === null && task.activeRunId === null && task.pendingOccurrence !== null && task.pendingOccurrence.ruleRevision === task.ruleRevision && Date.parse(task.pendingOccurrence.at) <= now)
        .sort((a, b) => a.pendingOccurrence!.at.localeCompare(b.pendingOccurrence!.at) || a.id.localeCompare(b.id))
      for (const task of due) {
        if (capacity <= 0) break
        const pending = task.pendingOccurrence!
        this.host.ctx.accountSub2api.assertAutomationIdentity(identity)
        const reserved = reserveAutomationRun(task, Date.parse(pending.at) < now - 1000 ? 'catch-up' : 'scheduled', pending.at, null, now, this.host.runtimeId)
        await this.host.put(reserved.task)
        starts.push({ ...reserved, identity }); capacity--
      }
    })
    for (const start of starts) { if (!this.stopping && !this.locked) this.launch(start.task, start.run, start.identity) }
    this.armNext(accountId)
  }

  private launch(task: AutomationTask, run: AutomationRun, identity: AutomationAccountIdentity): void {
    if (this.active.has(run.id)) return
    const abort = new AbortController()
    const finished = Promise.withResolvers<void>()
    this.active.set(run.id, { abort, done: finished.promise })
    const timeout = setTimeout(() => abort.abort(new Error('automation timeout')), this.host.limits.runTimeoutMs)
    void (async () => {
      let release: (() => void) | undefined
      let settled = false
      try {
        try {
          release = this.host.ctx.accountSub2api.registerAutomationLease(identity, async () => { abort.abort(); await finished.promise })
        } catch {
          // Lease rejection happens before any Session or model request can start.
          const blocked: AutomationRun = { ...run, state: 'blocked', finishedAt: new Date().toISOString(), reason: { code: 'account_changed', message: 'The active account changed before execution started.' } }
          await this.host.transact(async () => {
            const current = this.host.tasks().find(value => value.id === task.id)
            if (current?.activeRunId !== run.id) throw new Error('automation: reservation ownership changed')
            await this.host.put({ ...current, activeRunId: null, recordVersion: current.recordVersion + 1, runs: current.runs.map(value => value.id === run.id ? blocked : value), updatedAt: new Date().toISOString() })
          })
          settled = true; finished.resolve(); return
        }
        const terminal = await executeRun(this.host, task, run.id, identity, abort.signal)
        await this.host.transact(async () => {
          const current = this.host.tasks().find(value => value.id === task.id)
          if (current?.activeRunId !== run.id) throw new Error('automation: execution owner changed before settlement')
          const runs = current.runs.map(value => value.id === run.id ? terminal : value)
          const retained = this.retainRuns(runs)
          await this.host.put({ ...current, activeRunId: null, runs: retained, historyPruned: current.historyPruned || retained.length !== runs.length, recordVersion: current.recordVersion + 1, updatedAt: new Date().toISOString() })
        })
        settled = true
        finished.resolve()
      } catch (error) {
        // A failed teardown or terminal write retains the durable claim for recovery.
        this.host.ctx.logger.error(`automation: execution ${run.id} did not settle; its ownership remains blocked`)
        finished.reject(error)
      } finally {
        clearTimeout(timeout)
        if (settled) { release?.(); this.active.delete(run.id); this.requestDrive() }
      }
    })()
    void finished.promise.catch(() => undefined)
  }

  private retainRuns(runs: readonly AutomationRun[]): AutomationRun[] {
    const floor = Date.now() - this.host.limits.historyDays * 86_400_000
    const retained = runs.filter((run, index) => index === runs.length - 1 || !isTerminalState(run.state) || Date.parse(run.finishedAt ?? '') >= floor)
    let bytes = Buffer.byteLength(JSON.stringify(retained), 'utf8')
    while (retained.length > 1 && (retained.length > this.host.limits.historyRecords || bytes > this.host.limits.historyBytes)) {
      const index = retained.findIndex(is => isTerminalState(is.state))
      if (index < 0 || index === retained.length - 1) break
      retained.splice(index, 1); bytes = Buffer.byteLength(JSON.stringify(retained), 'utf8')
    }
    return retained
  }

  private armNext(accountId: string | undefined): void {
    this.clearTimer()
    if (accountId === undefined || this.stopping || this.locked) return
    const capacity = this.host.limits.maxConcurrent - this.host.tasks().filter(task => task.activeRunId !== null).length
    const times: number[] = []
    for (const task of this.host.tasks()) {
      if (task.ownerAccountId !== accountId || !task.enabled || task.deletedAt !== null) continue
      if (task.nextOccurrenceAt !== null) times.push(Date.parse(task.nextOccurrenceAt))
      if (capacity > 0 && task.activeRunId === null && task.pendingOccurrence !== null) times.push(Date.parse(task.pendingOccurrence.at))
    }
    if (times.length === 0) return
    const delay = Math.min(maxTimerDelay, Math.max(0, Math.min(...times) - Date.now()))
    this.timer = setTimeout(() => { this.timer = undefined; this.requestDrive() }, delay)
    this.timer.unref()
  }
}
export { recoverRun }
