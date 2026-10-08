/** Fresh durable Session execution and rejected-input settlement through the actual AgentLoop. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import { harness as presetHarness, declare } from '../../../preset/agent-preset-registry/tests/harness.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { executeRun } from '../src/execution.ts'
import { reserveAutomationRun } from '../src/runtime.ts'
import type { AutomationRuntimeHost } from '../src/runtime-contract.ts'
import type { AutomationRun, AutomationTask, AutomationTaskId } from '../src/types.ts'

class CatalogAdapter extends MockAdapter {
  override listModels(provider: string): Promise<LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'fixed-model', name: 'Fixed model' }])
  }
}

async function executionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-native-execution-'))
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
  const identity = { accountId: 'fixture-account', epoch: 1 }
  ctx.provide('accountSub2api', {
    assertAutomationIdentity(candidate: typeof identity) {
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
  }
  let fifo = Promise.resolve()
  const host: AutomationRuntimeHost = {
    ctx, runtimeId: 'fixture-runtime',
    limits: { maxConcurrent: 1, runTimeoutMs: 1800_000, historyDays: 30, historyRecords: 200, historyBytes: 2097152, receiptDays: 30, receiptRecords: 1000, receiptBytes: 1048576, maxTaskBytes: 4194304, maxTasksPerAccount: 100, maxTasks: 500, maxInstructionChars: 16000, maxInstructionBytes: 65536, confirmationTimeoutMs: 300000 },
    tasks: () => [current], identity: async () => identity,
    transact: work => { const result = fifo.then(work); fifo = result.then(() => undefined, () => undefined); return result },
    put: async value => { current = value }, emitChanged: () => {},
  }
  const reserve = () => {
    const reserved = reserveAutomationRun(current, 'manual', null, `fixture-${current.recordVersion}`, Date.now(), host.runtimeId)
    current = reserved.task
    return reserved
  }
  return { ctx, host, identity, reserve, settle: (terminal: AutomationRun) => { current = { ...current, activeRunId: null, runs: current.runs.map(run => run.id === terminal.id ? terminal : run) } } }
}

describe('native execution interval', () => {
  it('creates different persisted root Sessions without inheriting the prior output', async () => {
    const fixture = await executionFixture()
    const adapter = new CatalogAdapter([textResponse('first-only-output'), textResponse('second-only-output')])
    fixture.ctx.llm.registerAdapter(['fixture'], adapter)
    const first = fixture.reserve()
    const firstTerminal = await executeRun(fixture.host, first.task, first.run.id, fixture.identity, new AbortController().signal)
    fixture.settle(firstTerminal)
    const second = fixture.reserve()
    const secondTerminal = await executeRun(fixture.host, second.task, second.run.id, fixture.identity, new AbortController().signal)
    expect([firstTerminal.state, secondTerminal.state]).toEqual(['succeeded', 'succeeded'])
    expect(secondTerminal.sessionId).not.toBe(firstTerminal.sessionId)
    expect(fixture.ctx.agents.roots()).toEqual([])
    expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain('first-only-output')
    for (const run of [firstTerminal, secondTerminal]) {
      if (run.sessionId === null) throw new Error('missing result Session')
      await using stored = await fixture.ctx.sessionPersistence.open(run.sessionId, 'read')
      const { events } = await stored.read()
      expect(stored.header.parentSession).toBeUndefined()
      expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'automation')).toBe(true)
      expect(events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
      expect(run.endLogOffset).toBe(events.length)
    }
  })

  it('settles a claimed but rejected initial step without spending a model request or waiting for timeout', async () => {
    const fixture = await executionFixture()
    const adapter = new CatalogAdapter([textResponse('must-not-run')])
    fixture.ctx.llm.registerAdapter(['fixture'], adapter)
    fixture.ctx.on('agent/pre-step', async (_payload, next) => { await next(); return { kind: 'reject' } })
    const reserved = fixture.reserve()
    const terminal = await executeRun(fixture.host, reserved.task, reserved.run.id, fixture.identity, new AbortController().signal)
    expect(terminal.state).toBe('blocked')
    expect(adapter.requests).toEqual([])
    expect(terminal.sessionCreated).toBe(true)
    expect(fixture.ctx.agents.roots()).toEqual([])
  })
})
