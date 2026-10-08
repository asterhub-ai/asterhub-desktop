/** Reservation, latest-only backlog and fail-closed restart behavior. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationRuntime, reserveAutomationRun, recoverRun } from '../src/runtime.ts'
import type { AutomationRuntimeHost } from '../src/runtime-contract.ts'
import type { AutomationTask, AutomationTaskId, AutomationLimits } from '../src/types.ts'
import { normalizeTiming } from '../src/timing.ts'

const now = Date.parse('2026-10-05T00:00:00Z')
const limits: AutomationLimits = { maxConcurrent: 1, runTimeoutMs: 1800_000, historyDays: 30, historyRecords: 200, historyBytes: 2097152, receiptDays: 30, receiptRecords: 1000, receiptBytes: 1048576, maxTaskBytes: 4194304, maxTasksPerAccount: 100, maxTasks: 500, maxInstructionChars: 16000, maxInstructionBytes: 65536, confirmationTimeoutMs: 300000 }

function task(id: string): AutomationTask {
  return {
    id: brandString<AutomationTaskId>(id), ownerAccountId: 'account-1', revision: 1, recordVersion: 1, authorizationRevision: 1, consentRevision: 1, ruleRevision: 1,
    definition: { name: 'News', instruction: 'Collect current public news', workspaceId: brandString<WorkspaceId>('ws-1'), modelId: 'model-1', reasoningEffort: null, timing: normalizeTiming({ kind: 'interval', seconds: 3600, firstAt: '2026-10-05T01:00:00Z' }, now) },
    enabled: true, deletedAt: null, nextOccurrenceAt: '2026-10-05T01:00:00.000Z', occurrenceWatermark: null, pendingOccurrence: null, activeRunId: null, runs: [], requestReceipts: [], creationRequest: { requestId: 'create-1', digest: 'digest-1' }, historyPruned: false, skippedRange: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
  }
}

afterEach(() => { vi.useRealTimers() })

describe('durable native reservation', () => {
  it('advances the occurrence watermark atomically with a fixed fresh Session identity', () => {
    const initial = task('t1')
    const first = reserveAutomationRun(initial, 'scheduled', '2026-10-05T01:00:00.000Z', null, now + 3600_000, 'runtime-1')
    expect(first.task.occurrenceWatermark).toEqual({ ruleRevision: 1, at: '2026-10-05T01:00:00.000Z' })
    expect(first.task.nextOccurrenceAt).toBe('2026-10-05T02:00:00.000Z')
    expect(first.task.activeRunId).toBe(first.run.id)
    const second = reserveAutomationRun({ ...first.task, activeRunId: null }, 'scheduled', '2026-10-05T02:00:00.000Z', null, now + 7200_000, 'runtime-1')
    expect(second.run.sessionId).not.toBe(first.run.sessionId)
    expect(second.run.sessionCreated).toBe(false)
  })

  it('manual work does not consume the periodic watermark or resume a paused task', () => {
    const paused = { ...task('t2'), enabled: false, nextOccurrenceAt: null }
    const result = reserveAutomationRun(paused, 'manual', null, 'manual-1', now, 'runtime-1')
    expect(result.task.enabled).toBe(false)
    expect(result.task.occurrenceWatermark).toBeNull()
    expect(result.task.nextOccurrenceAt).toBeNull()
    expect(result.run.scheduledAt).toBeNull()
  })

  it('rejects overlapping and unconfirmed work', () => {
    const first = reserveAutomationRun(task('t3'), 'manual', null, 'manual-1', now, 'runtime-1')
    expect(() => reserveAutomationRun(first.task, 'manual', null, 'manual-2', now, 'runtime-1')).toThrow()
    expect(() => reserveAutomationRun({ ...task('t4'), consentRevision: 0 }, 'manual', null, 'manual-1', now, 'runtime-1')).toThrow()
  })

  it('never retries abandoned attempts from uncertain Session creation evidence', () => {
    const reserved = reserveAutomationRun(task('t5'), 'manual', null, 'manual-1', now, 'old-runtime')
    const recovered = recoverRun(reserved.run, true)
    expect(recovered.state).toBe('unknown')
    expect(recovered.sessionCreated).toBe(true)
    expect(recovered.sessionId).toBe(reserved.run.sessionId)
    expect(recovered.finishedAt).not.toBeNull()
    expect(recoverRun(recovered, false)).toBe(recovered)
  })
})

describe('Host backlog admission', () => {
  it('retains only the latest missed occurrence while another durable claim occupies capacity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now + 5.5 * 3600_000)
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    ctx.provide('accountSub2api', {
      assertAutomationIdentity(identity: { accountId: string; epoch: number }) {
        if (identity.accountId !== 'account-1' || identity.epoch !== 1) throw new Error('stale account')
      },
    })
    const occupied = reserveAutomationRun(task('busy'), 'manual', null, 'manual-1', now, 'runtime-1')
    const records = new Map<AutomationTaskId, AutomationTask>([[occupied.task.id, { ...occupied.task, enabled: false, nextOccurrenceAt: null, runs: [{ ...occupied.run, state: 'running' }] }], [task('queued').id, task('queued')]])
    const written = Promise.withResolvers<void>()
    let chain = Promise.resolve()
    const host: AutomationRuntimeHost = {
      ctx, runtimeId: 'runtime-1', limits, tasks: () => [...records.values()], identity: async () => ({ accountId: 'account-1', epoch: 1 }),
      transact: work => { const result = chain.then(work); chain = result.then(() => undefined, () => undefined); return result },
      put: async value => { records.set(value.id, value); written.resolve() }, emitChanged: () => {},
    }
    const runtime = new AutomationRuntime(host)
    try {
      runtime.requestDrive()
      await written.promise
      await chain
      const queued = records.get(brandString<AutomationTaskId>('queued'))!
      expect(queued.pendingOccurrence).toEqual({ at: '2026-10-05T05:00:00.000Z', from: '2026-10-05T01:00:00.000Z', ruleRevision: 1 })
      expect(queued.nextOccurrenceAt).toBe('2026-10-05T06:00:00.000Z')
      expect(queued.activeRunId).toBeNull()
      expect(queued.runs).toEqual([])
    } finally { await runtime.dispose(); await ctx.fiber.dispose() }
  })

  it('does not spin a past-due timer when no account is authenticated', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now + 7200_000)
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    let identities = 0
    const host: AutomationRuntimeHost = {
      ctx, runtimeId: 'runtime-1', limits, tasks: () => [task('t1')], identity: async () => { identities++; return null },
      transact: async work => work(), put: async () => { throw new Error('unauthenticated write') }, emitChanged: () => {},
    }
    const runtime = new AutomationRuntime(host)
    try {
      runtime.requestDrive()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(identities).toBe(1)
      expect(runtime.inspectLifecycle()).toEqual({ armed: true, active: false })
    } finally { await runtime.dispose(); await ctx.fiber.dispose() }
  })
})
