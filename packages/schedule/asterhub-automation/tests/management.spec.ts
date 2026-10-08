/** Confirmed durable management, account fences and independent manual reservations. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { AutomationOperations } from '../src/operations.ts'
import { openAutomationStore } from '../src/store.ts'
import type { AutomationDraft, AutomationLimits, AutomationOperation, AutomationAccountIdentity } from '../src/types.ts'

const limits: AutomationLimits = { maxConcurrent: 2, runTimeoutMs: 1800_000, historyDays: 30, historyRecords: 200, historyBytes: 2097152, receiptDays: 30, receiptRecords: 1000, receiptBytes: 1048576, maxTaskBytes: 4194304, maxTasksPerAccount: 100, maxTasks: 500, maxInstructionChars: 16000, maxInstructionBytes: 65536, confirmationTimeoutMs: 300000 }
const draft: AutomationDraft = { name: 'News', instruction: 'Collect public current news and cite sources', workspaceId: WorkspaceId('fixture-workspace'), modelId: 'fixture-model', reasoningEffort: null, timing: { kind: 'interval', seconds: 3600 } }

async function fixture(overrides: Partial<AutomationLimits> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-native-management-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const store = await openAutomationStore(ctx)
  onTestFinished(() => store.close())
  let identity: AutomationAccountIdentity = { accountId: 'account-a', epoch: 1 }
  const identityProvider = async () => identity
  const config = { ...limits, ...overrides }
  let chain = Promise.resolve()
  const transact = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work)
    chain = result.then(() => undefined, () => undefined)
    return result
  }
  const createOps = () => {
    const ops = new AutomationOperations(ctx, store, config, identityProvider, 'fixture-runtime', transact)
    onTestFinished(() => ops.dispose())
    return ops
  }
  const ops = createOps()
  const confirm = async (operation: AutomationOperation) => {
    const prepared = await ops.prepareOperation(operation)
    return ops.commitOperation({ requestId: prepared.requestId, confirmationId: prepared.confirmationId })
  }
  return { ctx, store, ops, confirm, createOps, transact, setIdentity: (next: AutomationAccountIdentity) => { identity = next } }
}

describe('confirmed native task management', () => {
  it('leaves storage untouched when explicit create confirmation is absent', async () => {
    const f = await fixture()
    const prepared = await f.ops.prepareOperation({ action: 'create', draft })
    await expect(f.ops.commitOperation({ requestId: prepared.requestId, confirmationId: null })).rejects.toMatchObject({ code: 'confirmation_required' })
    expect(f.store.tasks()).toEqual([])
  })

  it('serializes duplicate commit receipts and replays them after operator restart', async () => {
    const f = await fixture()
    const prepared = await f.ops.prepareOperation({ action: 'create', draft })
    const request = { requestId: prepared.requestId, confirmationId: prepared.confirmationId }
    const [first, second] = await Promise.all([f.ops.commitOperation(request), f.ops.commitOperation(request)])
    expect(first.taskId).toBe(second.taskId)
    expect(f.store.tasks().map(task => task.id)).toEqual([first.taskId])
    const restarted = await f.createOps().commitOperation({ ...request, confirmationId: null })
    expect(restarted.taskId).toBe(first.taskId)
  })

  it('does not rebind a confirmation while its write waits in the FIFO', async () => {
    const f = await fixture()
    const prepared = await f.ops.prepareOperation({ action: 'create', draft })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const blocker = f.transact(async () => { entered.resolve(); await release.promise })
    await entered.promise
    const writing = f.ops.commitOperation({ requestId: prepared.requestId, confirmationId: prepared.confirmationId })
    await Promise.resolve()
    f.setIdentity({ accountId: 'account-b', epoch: 2 })
    release.resolve()
    await blocker
    await expect(writing).rejects.toMatchObject({ code: 'account_mismatch' })
    expect(f.store.tasks()).toEqual([])
  })

  it('counts quota across overlapping confirmed creates without partially saving a second task', async () => {
    const f = await fixture({ maxTasksPerAccount: 1 })
    const a = await f.ops.prepareOperation({ action: 'create', draft })
    const b = await f.ops.prepareOperation({ action: 'create', draft: { ...draft, name: 'Other' } })
    const results = await Promise.allSettled([f.ops.commitOperation({ requestId: a.requestId, confirmationId: a.confirmationId }), f.ops.commitOperation({ requestId: b.requestId, confirmationId: b.confirmationId })])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(f.store.tasks().map(task => task.definition.name)).toEqual(['News'])
  })

  it('reserves a fixed fresh Session for manual work without consuming the periodic slot', async () => {
    const f = await fixture()
    const created = await f.confirm({ action: 'create', draft })
    if (created.task === null) throw new Error('create did not persist a task')
    const before = created.task.nextOccurrenceAt
    const result = await f.confirm({ action: 'run', id: created.taskId, expectedRevision: created.task.revision })
    expect(result.task?.nextOccurrenceAt).toBe(before)
    expect(result.task?.occurrenceWatermark).toBeNull()
    const run = result.task?.runs.find(value => value.id === result.runId)
    expect(run?.sessionId).toMatch(/^automation-/)
    expect(run?.sessionCreated).toBe(false)
    expect(result.task?.revision).toBe(created.task.revision)
  })

  it('pause clears unclaimed work while preserving an already reserved attempt', async () => {
    const f = await fixture()
    const created = await f.confirm({ action: 'create', draft })
    if (created.task === null) throw new Error('create did not persist a task')
    const manual = await f.confirm({ action: 'run', id: created.taskId, expectedRevision: created.task.revision })
    if (manual.task === null) throw new Error('run reservation missing')
    const pending = { at: new Date().toISOString(), from: new Date().toISOString(), ruleRevision: manual.task.ruleRevision }
    await f.store.put({ ...manual.task, pendingOccurrence: pending })
    const paused = await f.confirm({ action: 'pause', id: created.taskId, expectedRevision: manual.task.revision })
    expect(paused.task?.enabled).toBe(false)
    expect(paused.task?.nextOccurrenceAt).toBeNull()
    expect(paused.task?.pendingOccurrence).toBeNull()
    expect(paused.task?.activeRunId).toBe(manual.runId)
  })

  it('does not drop an unexpired receipt when the configured receipt capacity is full', async () => {
    const f = await fixture({ receiptRecords: 1 })
    const created = await f.confirm({ action: 'create', draft })
    if (created.task === null) throw new Error('create did not persist a task')
    await expect(f.confirm({ action: 'pause', id: created.taskId, expectedRevision: created.task.revision })).rejects.toMatchObject({ code: 'receipt_capacity' })
    expect(f.store.get(created.taskId)?.enabled).toBe(true)
  })
})
