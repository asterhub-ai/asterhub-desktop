/** Concrete fresh-session execution, durable completion evidence and account lifetime guards. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-account-sub2api'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-workspace'
import { createUserMessage, boundContextSummary, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SessionExecutionInputOwner } from '@deepseek-ai/dsh-api-session-controller'
import { stat } from 'node:fs/promises'
import type { AutomationRun, AutomationRunId, AutomationRunState, AutomationTask, AutomationAccountIdentity } from './types.ts'
import type { AutomationRuntimeHost } from './runtime-contract.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * User-confirmed native scheduled work, not a live user input.
     * @persistenceAttribution
     */
    automation: { kind: 'automation'; taskId: string; runId: string } & ContextFormed
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Inherited execution marker; scheduler mutation tools cannot act from this world. */
    asterhubAutomationRun: { readonly runId: AutomationRunId; readonly taskId: string; readonly accountId: string }
  }
}

/** Whether a run cannot reenter automatic execution. @param state - Stored outcome. @returns Terminal membership. */
export function isTerminalState(state: AutomationRunState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'canceled' || state === 'interrupted' || state === 'unknown' || state === 'blocked' || state === 'skipped'
}
/**
 * Conservatively retire abandoned attempts without replaying possible side effects.
 * @param run - Old runtime attempt.
 * @param sessionExists - Whether its conversation is independently known to exist.
 * @returns A terminal record; existing terminal records remain unchanged.
 */
export function recoverRun(run: AutomationRun, sessionExists: boolean): AutomationRun {
  return isTerminalState(run.state) ? run : { ...run, sessionCreated: sessionExists || run.sessionCreated, state: 'unknown', finishedAt: new Date().toISOString(), reason: { code: 'runtime_lost', message: 'The previous execution stopped without a confirmed result. Inspect its conversation before running again.' } }
}
/**
 * Build reconstructable explicit input for one independently executing occurrence.
 * @param run - Reserved execution.
 * @param snapshot - Immutable instruction and scheduling metadata.
 * @returns A genuine logged automation-source message.
 */
export function buildAutomationInputMessage(run: AutomationRun, snapshot: AutomationRun['snapshot']): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: `[用户已确认的定时任务] ${snapshot.name}\n任务 ${run.taskId}；运行 ${run.id}\n计划：${run.scheduledAt ?? run.requestedAt}\n实际：${new Date().toISOString()}\n时区：${'timeZone' in snapshot.timing ? snapshot.timing.timeZone : 'UTC（绝对时点）'}\n\n${snapshot.instruction}` }],
    source: { kind: 'automation', taskId: run.taskId, runId: run.id, form: 'notice', summary: boundContextSummary(snapshot.name) },
  })
}

function outcome(reason: TurnEndReason): AutomationRunState {
  switch (reason.kind) {
    case 'completed': return 'succeeded'
    case 'aborted': return 'canceled'
    case 'blocked': return 'blocked'
    case 'error': case 'max-tokens': return 'failed'
    case 'interrupted': return 'interrupted'
    default: return 'unknown' // Turn reasons are merge-extensible; unfamiliar endings are not success.
  }
}

async function saveRun(host: AutomationRuntimeHost, run: AutomationRun): Promise<void> {
  await host.transact(async () => {
    const task = host.tasks().find(value => value.id === run.taskId)
    if (task?.activeRunId !== run.id) throw new Error('automation: execution no longer owns its task')
    await host.put({ ...task, recordVersion: task.recordVersion + 1, updatedAt: new Date().toISOString(), runs: task.runs.map(value => value.id === run.id ? run : value) })
  })
}

/**
 * Execute a fixed-identity reservation through the actual Agent factory.
 * @param host - Concrete Host dependencies and shared task FIFO.
 * @param task - Reserved task snapshot.
 * @param runId - Exact owned run.
 * @param identity - Account lifetime registered by the runtime's lease.
 * @param signal - Cancellation/timeout; cleanup must settle before returning.
 * @returns Durable interval evidence, never inferred solely from an idle status.
 */
export async function executeRun(host: AutomationRuntimeHost, task: AutomationTask, runId: AutomationRunId, identity: AutomationAccountIdentity, signal: AbortSignal): Promise<AutomationRun> {
  const initial = task.runs.find(value => value.id === runId)
  if (initial === undefined || initial.sessionId === null) throw new Error('automation: reservation needs a fixed Session identity')
  if (isTerminalState(initial.state)) return initial
  const ctx = host.ctx
  let run = initial
  let handle: AgentHandle | undefined
  let inputOwner: SessionExecutionInputOwner | undefined
  const publicationReady = Promise.withResolvers<void>()
  const family = new Set<Agent>()
  const interactions = new Set<string>()
  let closed = false
  let admitted = false
  let claimedTurn: number | null = null
  const observation: { ending: TurnEndReason | null; terminalTurn: number | null } = { ending: null, terminalTurn: null }
  let humanIntervened = false
  const approvals = new Set<string>()
  const disposers: (() => void)[] = []
  const result = Promise.withResolvers<void>()
  void result.promise.catch(() => undefined)
  let queuedWrites = Promise.resolve()
  let writeFailure: unknown
  let finishing = false
  let completed = false

  const publishState = (state: AutomationRunState): void => {
    run = { ...run, state, startedAt: run.startedAt ?? (state === 'reserved' ? null : new Date().toISOString()) }
    const snapshot = run
    queuedWrites = queuedWrites.then(() => saveRun(host, snapshot)).catch(error => {
      writeFailure = error; handle?.agent.cancel({ kind: 'hook', reason: 'automation persistence failed' }); result.reject(error)
    })
  }
  const hasOwnedWork = (): boolean => {
    for (const member of family) {
      if (member.status !== 'idle' || member.inbox.nextTurn.length > 0 || member.inbox.nextStep.length > 0) return true
      if (ctx.jobs.list(member.id).some(job => job.owner === member.id && (job.status === 'running' || job.status === 'stopping'))) return true
    }
    return false
  }
  const checkEnding = (): void => {
    const agent = handle?.agent
    if (closed || completed || finishing || agent === undefined || !admitted || observation.ending === null) return
    const questions = ctx.sessionProjections.stateOf(agent.session, 'userQuestions')?.questions.active ?? []
    if (approvals.size > 0 || questions.length > 0) { publishState('waiting-approval'); return }
    finishing = true
    void Promise.resolve().then(async () => {
      await agent.whenIdle()
      if (closed || completed || inputOwner === undefined) return
      const didClose = await inputOwner.closeIf(() => {
        const pending = ctx.sessionProjections.stateOf(agent.session, 'userQuestions')?.questions.active ?? []
        if (hasOwnedWork() || approvals.size > 0 || pending.length > 0 || observation.ending === null) return false
        closed = true
        return true
      })
      if (didClose) { completed = true; result.resolve() }
    }).catch(error => result.reject(error)).finally(() => { finishing = false })
  }

  try {
    signal.throwIfAborted()
    ctx.accountSub2api.assertAutomationIdentity(identity)
    const route = ctx.get('applicationModelRoute')
    if (route === undefined) throw new Error('automation: application model route is unavailable')
    const models = await ctx.llm.listModels(route.provider)
    if (!models.some(model => model.id === run.snapshot.modelId && model.id !== '__unselected__')) throw new Error('automation: saved model is unavailable')
    const model = await ctx.llm.resolveModelInfo(route.provider, run.snapshot.modelId, signal)
    if (run.snapshot.reasoningEffort !== null && !model.reasoning?.efforts.some(effort => effort.id === run.snapshot.reasoningEffort)) throw new Error('automation: saved reasoning effort is unavailable')
    const workspace = ctx.workspaceRegistry.get(run.snapshot.workspaceId)
    if (workspace === undefined) throw new Error('automation: workspace is unavailable')
    const path = workspace.path
    if (!(await stat(path)).isDirectory() || workspace.path !== path) throw new Error('automation: workspace directory is unavailable')
    const preset = await ctx.agentPresets.resolve()
    await using presetScope = await ctx.agentPresets.acquireScope(preset.id)
    void presetScope
    ctx.accountSub2api.assertAutomationIdentity(identity)
    const installGuards = (agentCtx: Context, agent: Agent): void => {
      family.add(agent)
      agentCtx.provide('asterhubAutomationRun', { runId: run.id, taskId: task.id, accountId: identity.accountId })
      agentCtx.on('agent/request', async (_payload, next) => {
        const config = await next()
        ctx.accountSub2api.assertAutomationIdentity(identity)
        if (closed || signal.aborted) throw new Error('automation: execution interval is closed')
        const { reasoningEffort: _effort, ...base } = config
        return { ...base, provider: route.provider, model: run.snapshot.modelId, ...(run.snapshot.reasoningEffort === null ? {} : { reasoningEffort: ReasoningEffortId(run.snapshot.reasoningEffort) }) }
      })
      agentCtx.on('agent/pre-step', async (_payload, next) => {
        const decision = await next()
        return closed || signal.aborted ? { kind: 'reject' } : decision
      })
    }
    disposers.push(ctx.on('agent/created', ({ agent }) => {
      if (family.has(agent)) return
      if ([...family].some(parent => ctx.agents.isOwnedBy(agent.id, parent))) installGuards(agent.ctx, agent)
    }, { prepend: true }))
    inputOwner = ctx.sessionController.registerExecutionInputOwner(initial.sessionId, publicationReady.promise)
    handle = await ctx.agents.create({
      sessionId: initial.sessionId, signal,
      meta: { cwd: path, agentPreset: preset.id },
      agentOptions: { provider: route.provider, model: run.snapshot.modelId, ...(run.snapshot.reasoningEffort === null ? {} : { reasoningEffort: ReasoningEffortId(run.snapshot.reasoningEffort) }) },
      setup: async (agentCtx, agent) => {
        installGuards(agentCtx, agent)
        await ctx.agentPresets.mount(agentCtx, preset.id)
      },
    })
    disposers.push(ctx.jobs.events.subscribe({ owners: 'scope' }, event => {
      if (event.type !== 'output' && [...family].some(member => member.id === event.job.owner)) checkEnding()
    }))
    disposers.push(ctx.on('agent/status', ({ agent: member }) => { if (family.has(member)) checkEnding() }))
    const agent = handle.agent
    run = { ...run, sessionCreated: true }
    await workspace.attachSession(agent.id)
    ctx.permissionPresets.set(agent.session, ctx.permissionPresets.current(agent.session))
    ctx.sessionTitle.rename(agent.session, `${run.snapshot.name} · ${new Date().toLocaleString()}`)
    const message = buildAutomationInputMessage(run, run.snapshot)
    run = { ...run, sessionCreated: true, startLogOffset: Number(agent.session.seq), inputMessageId: message.id }
    await saveRun(host, run)

    disposers.push(agent.ctx.on('agent/inbox/claimed', ({ agent: subject, message: claimed, turn }) => {
      if (subject !== agent || closed) return
      if (claimed.id === message.id) claimedTurn = turn
      else {
        if (claimed.source.kind === 'user' || claimed.source.kind === 'user-question-reply') humanIntervened = true
        observation.ending = null; observation.terminalTurn = null
      }
    }))
    disposers.push(agent.ctx.on('agent/inbox/discarded', ({ message: discarded }) => {
      if (discarded.id === message.id && !admitted) result.reject(new Error('automation input canceled before admission'))
    }))
    disposers.push(ctx.on('session/event', (session, event) => {
      if (session !== agent.session || closed) return
      if (event.type === 'user/message') {
        if (event.data.id === message.id) { admitted = true; publishState('running') }
        else if (event.data.source.kind === 'user' || event.data.source.kind === 'user-question-reply') humanIntervened = true
      } else if (event.type === 'approval/asked') { approvals.add(event.data.id); interactions.add(event.data.id); publishState('waiting-approval') }
      else if (event.type === 'approval/decided') { approvals.delete(event.data.id) }
      else if (event.type === 'turn/end' && claimedTurn !== null) {
        observation.ending = event.data.reason; observation.terminalTurn = event.data.turn
        if (!admitted) result.reject(new Error('automation: initial input was not admitted'))
      }
      for (const question of ctx.sessionProjections.stateOf(agent.session, 'userQuestions')?.questions.active ?? []) interactions.add(question.callId)
      checkEnding()
    }))
    disposers.push(agent.ctx.on('agent/status', () => { checkEnding() }))
    const onAbort = (): void => { agent.cancel({ kind: 'hook', reason: 'scheduled execution stopped' }); result.reject(signal.reason ?? new Error('automation canceled')) }
    signal.addEventListener('abort', onAbort, { once: true })
    disposers.push(() => signal.removeEventListener('abort', onAbort))
    ctx.accountSub2api.assertAutomationIdentity(identity)
    signal.throwIfAborted()
    agent.followup(message)
    publicationReady.resolve()
    if (!(await ctx.sessions.flush(agent.session))) throw new Error('automation input persistence unavailable')
    await result.promise
    await queuedWrites
    if (writeFailure !== undefined) throw writeFailure
    const ending = observation.ending
    if (!admitted || ending === null) throw new Error('automation: completion lacks durable input/turn evidence')
    closed = true
    if (!(await ctx.sessions.flush(agent.session))) throw new Error('automation result persistence unavailable')
    run = { ...run, state: outcome(ending), finishedAt: new Date().toISOString(), terminalTurn: observation.terminalTurn, endLogOffset: Number(agent.session.seq), humanIntervened,
      interactionIds: [...interactions], reason: ending.kind === 'completed' ? null : { code: `turn_${ending.kind}`, message: 'The scheduled execution did not finish successfully. Inspect its conversation.' } }
  } catch (error) {
    closed = true
    handle?.agent.cancel({ kind: 'hook', reason: 'scheduled execution stopped' })
    if (inputOwner !== undefined) await inputOwner.closeIf(() => true)
    if (handle !== undefined) {
      ctx.userQuestions.cancelPending(handle.agent)
      await handle.agent.whenIdle()
      if (!(await ctx.sessions.flush(handle.agent.session))) throw new Error('automation canceled result persistence unavailable')
    }
    await queuedWrites
    run = { ...run, state: signal.aborted ? (signal.reason instanceof Error && signal.reason.message === 'automation timeout' ? 'failed' : 'canceled') : (admitted ? 'failed' : 'blocked'), finishedAt: new Date().toISOString(), terminalTurn: observation.terminalTurn, humanIntervened,
      interactionIds: [...interactions], endLogOffset: handle === undefined ? run.endLogOffset : Number(handle.agent.session.seq), reason: { code: signal.aborted ? (signal.reason instanceof Error && signal.reason.message === 'automation timeout' ? 'timeout' : 'stopped') : 'execution_failed', message: 'Scheduled execution stopped. Inspect its conversation and configuration before running again.' } }
    if (writeFailure !== undefined) throw error
  } finally {
    closed = true
    for (const dispose of disposers.splice(0)) dispose()
    for (const member of family) {
      member.cancel({ kind: 'hook', reason: 'scheduled execution ended' })
      for (const job of ctx.jobs.list(member.id)) {
        if (job.owner === member.id && (job.status === 'running' || job.status === 'stopping')) ctx.jobs.kill(job.id, member.id, 'scheduled execution ended')
      }
    }
    await Promise.all([...family].map(member => member.whenIdle()))
    if (handle !== undefined) {
      // Disposal is the resource fence. A rejection prevents runtime settlement and key replacement.
      await handle.dispose()
      family.clear()
    }
    inputOwner?.release()
    publicationReady.resolve()
  }
  return run
}
