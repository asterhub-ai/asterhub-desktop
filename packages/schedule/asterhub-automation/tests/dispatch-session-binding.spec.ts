/** Dual-track dispatch: bound tasks resume their authoring conversation, GUI tasks mint fresh Sessions. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createUserMessage, type LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry, { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import { harness as presetHarness, declare } from '../../../preset/agent-preset-registry/tests/harness.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { executeRun } from '../src/execution.ts'
import { reserveAutomationRun } from '../src/runtime.ts'
import { AutomationOperations } from '../src/operations.ts'
import { openAutomationStore } from '../src/store.ts'
import type { AutomationRuntimeHost } from '../src/runtime-contract.ts'
import type { AutomationDraft, AutomationLimits, AutomationRun, AutomationTask, AutomationTaskId, AutomationAccountIdentity, AutomationOperation } from '../src/types.ts'

class CatalogAdapter extends MockAdapter {
  override listModels(provider: string): Promise<LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'fixed-model', name: 'Fixed model' }])
  }
}

const dispatchLimits: AutomationLimits = {
  maxConcurrent: 1,
  runTimeoutMs: 1800_000,
  historyDays: 30,
  historyRecords: 200,
  historyBytes: 2097152,
  receiptDays: 30,
  receiptRecords: 1000,
  receiptBytes: 1048576,
  maxTaskBytes: 4194304,
  maxTasksPerAccount: 100,
  maxTasks: 500,
  maxInstructionChars: 16000,
  maxInstructionBytes: 65536,
  confirmationTimeoutMs: 300000,
}

async function dispatchFixture(options: { originSessionId?: SessionId } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-automation-dispatch-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = await presetHarness()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 1024 })
  await ctx.plugin(LocalJobs)
  await declare(ctx, { id: 'standard', plugins: [] })
  ctx.provide('permissionPresets', {
    current: () => 'workspace-write',
    set: (session: Session, preset: string) => { session.append('permission/preset', { preset }) },
  })
  const identity: AutomationAccountIdentity = { accountId: 'fixture-account', epoch: 1 }
  ctx.provide('accountSub2api', {
    assertAutomationIdentity(candidate: AutomationAccountIdentity) {
      if (candidate.accountId !== identity.accountId || candidate.epoch !== identity.epoch) throw new Error('account changed')
    },
  })
  ctx.provide('applicationModelRoute', { provider: 'fixture' })
  createSessionTestController(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'fixture', model: 'fixed-model' }) })
  const workspace = await ctx.workspaceRegistry.create(root)
  const now = Date.now()
  let current: AutomationTask = {
    id: brandString<AutomationTaskId>('fixture-task'), ownerAccountId: identity.accountId, revision: 1, recordVersion: 1, authorizationRevision: 1, consentRevision: 1, ruleRevision: 1,
    definition: { name: 'Probe', instruction: 'Return only a harmless execution marker', workspaceId: workspace.id, modelId: 'fixed-model', reasoningEffort: null, timing: { kind: 'once', at: new Date(now + 3600_000).toISOString() } },
    enabled: false, deletedAt: null, nextOccurrenceAt: null, occurrenceWatermark: null, pendingOccurrence: null, activeRunId: null, runs: [], requestReceipts: [], creationRequest: { requestId: 'fixture-create', digest: 'fixture-digest' }, historyPruned: false, skippedRange: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    ...(options.originSessionId === undefined ? {} : { originSessionId: options.originSessionId }),
  }
  let fifo = Promise.resolve()
  const host: AutomationRuntimeHost = {
    ctx, runtimeId: 'fixture-runtime',
    limits: dispatchLimits,
    tasks: () => [current], identity: async () => identity,
    transact: (work) => { const result = fifo.then(work); fifo = result.then(() => undefined, () => undefined); return result },
    put: async (value) => { current = value }, emitChanged: () => {},
  }
  const reserve = () => {
    const reserved = reserveAutomationRun(current, 'manual', null, `fixture-${current.recordVersion}`, Date.now(), host.runtimeId)
    current = reserved.task
    return reserved
  }
  const storedSessionIds = async (): Promise<string[]> => (await ctx.sessionPersistence.list()).map(snapshot => String(snapshot.header.id))
  return { ctx, root, host, identity, reserve, settle: (terminal: AutomationRun) => {
    current = { ...current, activeRunId: null, runs: current.runs.map(run => run.id === terminal.id ? terminal : run) }
  }, storedSessionIds }
}

/** Create and retire one real authoring conversation so a persisted Session exists to resume. */
async function authorConversation(ctx: Context, cwd: string, sessionId: SessionId): Promise<void> {
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: 'fixture', model: 'fixed-model' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
  })
  try {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'authoring turn' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
  } finally {
    await handle.dispose()
  }
}

describe('bound-task dispatch', () => {
  it('resumes the authoring conversation and appends the automation turn there without minting a Session', async () => {
    const origin = brandString<SessionId>('authoring-origin')
    const fixture = await dispatchFixture({ originSessionId: origin })
    const adapter = new CatalogAdapter([textResponse('authoring-output'), textResponse('run-output')])
    fixture.ctx.llm.registerAdapter(['fixture'], adapter)
    await authorConversation(fixture.ctx, fixture.root, origin)
    expect(await fixture.storedSessionIds()).toEqual([origin])

    const reserved = fixture.reserve()
    expect(reserved.run.sessionId).toBe(origin)
    expect(reserved.run.sessionCreated).toBe(false)
    const terminal = await executeRun(fixture.host, reserved.task, reserved.run.id, fixture.identity, new AbortController().signal)
    fixture.settle(terminal)

    expect(terminal.state).toBe('succeeded')
    expect(terminal.sessionId).toBe(origin)
    expect(terminal.sessionCreated).toBe(false)
    expect(terminal.reason).toBeNull()
    // The bound dispatch reused the authoring conversation: no fresh Session id appeared.
    expect(await fixture.storedSessionIds()).toEqual([origin])
    expect(fixture.ctx.agents.roots()).toEqual([])
    await using stored = await fixture.ctx.sessionPersistence.open(origin, 'read')
    const { events } = await stored.read()
    expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'user')).toBe(true)
    expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'automation')).toBe(true)
    expect(events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
    expect(terminal.endLogOffset).toBe(events.length)
  })

  it('fails the run with origin_session_missing when the authoring conversation no longer exists', async () => {
    const missing = brandString<SessionId>('vanished-origin')
    const fixture = await dispatchFixture({ originSessionId: missing })
    const adapter = new CatalogAdapter([])
    fixture.ctx.llm.registerAdapter(['fixture'], adapter)

    const reserved = fixture.reserve()
    expect(reserved.run.sessionId).toBe(missing)
    const terminal = await executeRun(fixture.host, reserved.task, reserved.run.id, fixture.identity, new AbortController().signal)
    fixture.settle(terminal)

    expect(terminal.state).toBe('failed')
    expect(terminal.reason?.code).toBe('origin_session_missing')
    expect(terminal.sessionId).toBe(missing)
    expect(adapter.requests).toEqual([])
    expect(await fixture.storedSessionIds()).toEqual([])
    expect(fixture.ctx.agents.roots()).toEqual([])
  })
})

describe('unbound-task dispatch regression', () => {
  it('still mints a fresh independent Session for a GUI-created task', async () => {
    const fixture = await dispatchFixture()
    const adapter = new CatalogAdapter([textResponse('fresh-only-output')])
    fixture.ctx.llm.registerAdapter(['fixture'], adapter)

    const reserved = fixture.reserve()
    expect(reserved.run.sessionId).not.toBe('authoring-origin')
    const terminal = await executeRun(fixture.host, reserved.task, reserved.run.id, fixture.identity, new AbortController().signal)
    fixture.settle(terminal)

    expect(terminal.state).toBe('succeeded')
    expect(terminal.sessionId).toBe(reserved.run.sessionId)
    expect(String(terminal.sessionId)).toMatch(/^automation-/)
    expect(terminal.sessionCreated).toBe(true)
    expect(await fixture.storedSessionIds()).toEqual([terminal.sessionId])
    expect(fixture.ctx.agents.roots()).toEqual([])
  })
})

const managementLimits: AutomationLimits = { ...dispatchLimits }
const draft: AutomationDraft = { name: 'News', instruction: 'Collect public current news and cite sources', workspaceId: WorkspaceId('fixture-workspace'), modelId: 'fixture-model', reasoningEffort: null, timing: { kind: 'interval', seconds: 3600 } }

async function managementFixture() {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-automation-binding-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const store = await openAutomationStore(ctx)
  onTestFinished(() => store.close())
  const identityProvider = async (): Promise<AutomationAccountIdentity> => ({ accountId: 'account-a', epoch: 1 })
  let chain = Promise.resolve()
  const transact = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work)
    chain = result.then(() => undefined, () => undefined)
    return result
  }
  const ops = new AutomationOperations(ctx, store, managementLimits, identityProvider, 'fixture-runtime', transact)
  onTestFinished(() => { ops.dispose() })
  const confirm = async (operation: AutomationOperation) => {
    const prepared = await ops.prepareOperation(operation)
    return ops.commitOperation({ requestId: prepared.requestId, confirmationId: prepared.confirmationId })
  }
  return { ctx, store, ops, confirm }
}

describe('one automation per conversation', () => {
  it('rejects a second binding while the first task is live and frees it after soft delete', async () => {
    const f = await managementFixture()
    const first = await f.confirm({ action: 'create', draft: { ...draft, name: 'First' }, originSessionId: brandString<SessionId>('session-1') })
    expect(first.task?.originSessionId).toBe('session-1')
    await expect(f.confirm({ action: 'create', draft: { ...draft, name: 'Second' }, originSessionId: brandString<SessionId>('session-1') }))
      .rejects.toMatchObject({ code: 'session_already_bound' })
    // Preparation rejects before user confirmation, so the operator never confirms a doomed write.
    await expect(f.ops.prepareOperation({ action: 'create', draft: { ...draft, name: 'Second' }, originSessionId: brandString<SessionId>('session-1') }))
      .rejects.toMatchObject({ code: 'session_already_bound' })
    // Soft delete frees the conversation for a new binding.
    await f.confirm({ action: 'remove', id: first.taskId, expectedRevision: 1 })
    const third = await f.confirm({ action: 'create', draft: { ...draft, name: 'Third' }, originSessionId: brandString<SessionId>('session-1') })
    expect(third.task?.originSessionId).toBe('session-1')
  })

  it('keeps GUI-created tasks unbound across a storage round trip', async () => {
    const f = await managementFixture()
    const created = await f.confirm({ action: 'create', draft })
    expect(created.task?.originSessionId).toBeUndefined()
    const id = created.taskId
    await f.store.close()
    const reopened = await openAutomationStore(f.ctx)
    expect(reopened.get(id)?.originSessionId).toBeUndefined()
    await reopened.close()
  })
})
