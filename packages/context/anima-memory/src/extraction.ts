/** Native model calls preserve Anima's upstream review and reflection protocols. */
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, type UserMessage, type ContextFormed, type FinishReason } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionSeq as Seq } from '@deepseek-ai/dsh-session'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { Policy } from './config.ts'
import type {} from './projection.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Context and auxiliary messages produced from Anima's local graph. */
    anima: { kind: 'anima' } & ContextFormed
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact auxiliary request, logged before model dispatch. */
    'anima/extraction-request': {
      route: { provider: string; model: string }
      operation: 'extraction' | 'review' | 'reflection'
      system: string
      messages: UserMessage[]
      maxTokens: number
    }
    /** Exact auxiliary result, including failure, logged before graph materialization. */
    'anima/extraction-result': { requestSeq: Seq; text: string; error: string | null }
  }
}

/** Context for one auxiliary operation. */
export interface ModelOperation {
  /** Owning Agent Session for route selection and durable request logging. */
  agent: Agent
  /** Caller cancellation joined with provider shutdown. */
  signal: AbortSignal
  /** Complete immutable policy snapshot for this operation. */
  policy: Policy
  /** Session route captured at admission, or null if none is logged. */
  route?: { provider: string; model: string } | null
}

/**
 * Resolve the explicit model pair or the exact route captured from the Session.
 * @param ctx - Session projection registry.
 * @param operation - Current auxiliary operation.
 * @returns provider and model route; rejects when neither source supplies one.
 */
export function modelRoute(ctx: Context, operation: ModelOperation): { provider: string; model: string } {
  const { modelProvider, model } = operation.policy
  if ((modelProvider.trim() === '') !== (model.trim() === '')) throw new Error('Anima provider and model must be configured together')
  const route = modelProvider !== '' ? { provider: modelProvider, model }
    : operation.route ?? ctx.sessionProjections.stateOf(operation.agent.session, 'animaTurn')?.route
  if (route === undefined || route === null) throw new Error('Select an Anima model or start a conversation with a model first')
  return route
}

/**
 * Parse one complete JSON response after enforcing its terminal finish reason.
 * @param text - Complete assembled text response.
 * @param finish - Provider finish reason for the response.
 * @returns parsed JSON value; rejects incomplete output or surrounding prose.
 */
export function parseModelOutput(text: string, finish: FinishReason): unknown {
  if (finish.kind !== 'stop') {
    throw new Error(`Anima model request did not finish successfully (finish=${JSON.stringify(finish)})`)
  }
  const trimmed = text.trim()
  const fenced = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  return JSON.parse(fenced?.[1] ?? trimmed)
}

/**
 * Invoke the Host LLM registry with bounded JSON input and output.
 * @param ctx - Host model registry.
 * @param operation - Auxiliary model owner and current limits.
 * @param kind - Original Anima operation kind.
 * @param system - Original Anima system instruction.
 * @param input - JSON model input prepared by Anima.
 * @returns parsed model JSON; invalid, aborted, and oversized results reject before graph writes.
 */
export async function invokeModel(ctx: Context, operation: ModelOperation, kind: 'extraction' | 'review' | 'reflection',
  system: string, input: unknown): Promise<unknown> {
  const { agent, policy, signal } = operation
  const route = modelRoute(ctx, operation)
  const serialized = JSON.stringify(input)
  const messages = [createUserMessage({ source: { kind: 'anima' }, content: [{ type: 'text', text: serialized }] })]
  if (Buffer.byteLength(system + JSON.stringify(messages), 'utf8') > policy.maxInputBytes) throw new Error('Anima model input exceeds maxInputBytes')
  const request = agent.session.append('anima/extraction-request', { route, operation: kind, system, messages, maxTokens: policy.maxOutputTokens })
  let text = ''
  try {
    using timeout = deadline(signal, policy.timeoutMs, 'ANIMA_TIMEOUT')
    const assembler = new BlockAssembler()
    let outputBytes = 0
    for await (const chunk of ctx.llm.stream({ ...route, system, messages, maxTokens: policy.maxOutputTokens,
      signal: timeout.signal, sessionId: agent.id, purpose: 'anima-memory' })) {
      outputBytes += Buffer.byteLength(JSON.stringify(chunk), 'utf8')
      if (outputBytes > policy.maxInputBytes) throw new Error('Anima model output exceeds maxInputBytes')
      assembler.push(chunk)
    }
    timeout.signal.throwIfAborted()
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) throw new Error('Anima model output must contain JSON text')
    text = blocks.filter(block => block.type === 'text').map(block => block.text).join('')
    const result = parseModelOutput(text, assembler.finish)
    agent.session.append('anima/extraction-result', { requestSeq: request.seq, text, error: null })
    return result
  } catch (error) {
    agent.session.append('anima/extraction-result', { requestSeq: request.seq, text, error: String(error) })
    throw error
  }
}
