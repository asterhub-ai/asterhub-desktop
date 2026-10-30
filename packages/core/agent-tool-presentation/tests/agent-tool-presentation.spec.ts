/**
 * The row an agent preset carries to pick its tool presentation. What it owes
 * its caller: the choice reaches THIS agent and no other, it unwinds with the
 * agent, and a code mode composed against a deployment with no PTC runtime
 * stops at mount — where a preset's activation audit can name it — rather
 * than at the first prompt assembly.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import ToolRuntime, { RUN_CODE_NAME, ToolBatchExecutionError, defineTool } from '@deepseek-ai/dsh-tools'
import type { ResolvedToolSet, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { apply, Config, name } from '@deepseek-ai/dsh-agent-tool-presentation'

function extractErrorText(result: ToolExecutionResult): string | undefined {
  if (!result.isError) return undefined
  const block = result.content[0]
  if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
    return block.text
  }
  return undefined
}

/** A runtime that never runs anything: presentation never dispatches. */
class StubRuntime extends PtcRuntime {
  runner?: (request: PtcRunRequest) => Promise<PtcRunResult>

  resolve(request: PtcRunRequest): PtcRunSpec {
    return {
      ...request,
      cwd: request.cwd ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 120_000,
    }
  }

  readonly language = 'typescript'
  readonly isolation = 'stub'

  run(request: PtcRunRequest): Promise<PtcRunResult> {
    if (this.runner) return this.runner(request)
    return Promise.resolve({ logs: [] })
  }
}

/** A host plane with one tool, optionally carrying a PTC runtime. */
async function host(options: { runtime?: boolean } = {}) {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(NativeToolExecutor)
  if (options.runtime !== false) await ctx.plugin(StubRuntime)
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echo tool.',
    parameters: { value: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : String(value) }],
    },
    execute: args => Promise.resolve(args.value),
  }))
  return ctx
}

/** Mount the row under one agent's scope, as a preset subtree does. */
async function mount(ctx: Context, config: Config, id = 'agent') {
  const sessionId = SessionId(id)
  let inner!: Context
  const agent = {
    id: sessionId,
    session: Session.create(sessionId),
  } as Agent
  const fiber = ctx.plugin(Object.assign((host: Context) => {
    inner = createScope(host, agent).ctx
    Object.defineProperty(agent, 'ctx', { value: inner, writable: false, configurable: true })
  }, { inject: ['tools', 'systemPrompt'] }))
  await fiber.await()
  const row = inner.plugin({ name, inject: ['tools'], Config, apply }, config)
  await row.await()
  return { agent, fiber, row }
}

describe('the tool-presentation row', () => {
  it('gives its own agent PTC mode and leaves the rest native', async () => {
    const ctx = await host()
    const coded = await mount(ctx, { mode: 'ptc' }, 'coded')
    const plain = await mount(ctx, { mode: 'native' }, 'plain')

    const codedAssembly = await ctx.systemPrompt.assemble({ scope: coded.agent })
    const plainAssembly = await ctx.systemPrompt.assemble({ scope: plain.agent })

    expect(codedAssembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(codedAssembly.sections.find(section => section.name === 'tools:sdk')?.text).toContain('echo')
    expect(plainAssembly.tools.map(tool => tool.name)).toEqual(['echo'])
  })

  it('presents both forms when asked for both', async () => {
    const ctx = await host()
    const { agent } = await mount(ctx, { mode: 'both' })

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })

    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo', RUN_CODE_NAME])
  })

  it('unloads its executor with the row', async () => {
    const ctx = await host()
    const { agent, row } = await mount(ctx, { mode: 'ptc' })

    await row.dispose()

    // Scoped executor selection is unloaded with the row rather than falling back to deployment default.
    await expect(ctx.systemPrompt.assemble({ scope: agent })).rejects.toThrow('selected tool executor is unavailable')
  })

  it('waits for a PTC runtime the deployment does not compose', async () => {
    const ctx = await host({ runtime: false })

    const { agent, row } = await mount(ctx, { mode: 'ptc' })

    // Pending, not applied: `dsh-agent-preset-registry` rejects a mount holding a row
    // that never reached a usable state, naming this id — so the preset fails
    // where the operator can act, instead of at the first request.
    expect(row.ctx.get('ptcRuntime')).toBeUndefined()
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo'])
  })

  it('applies once the runtime arrives', async () => {
    const ctx = await host({ runtime: false })
    const { agent } = await mount(ctx, { mode: 'ptc' })

    await ctx.plugin(StubRuntime)

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
  })

  it('requires a mode rather than defaulting one', () => {
    // An omitted value would mean the row was composed for nothing: a preset
    // without this row already gets the deployment default.
    expect(() => Config({} as never)).toThrow()
  })

  it('executes mixed native and run_code batches in sequence with maxParallelToolCalls: 1 and maps correlated results', async () => {
    const ctx = await host()
    const { agent } = await mount(ctx, { mode: 'both' })

    const trace: string[] = []
    let active = 0
    let maxObservedConcurrency = 0

    const gate1 = Promise.withResolvers<undefined>()
    const gate2 = Promise.withResolvers<undefined>()

    // Explicit started deferreds resolved by the fixture bodies when they actually enter.
    const call1Started = Promise.withResolvers<undefined>()
    const call2Started = Promise.withResolvers<undefined>()

    ctx.tools.register(defineTool({
      name: 'track',
      description: 'Track execution order and concurrency.',
      parameters: { step: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : String(value) }],
      },
      execute: async (args) => {
        active++
        maxObservedConcurrency = Math.max(maxObservedConcurrency, active)
        trace.push(`native:${args.step}:start`)
        if (args.step === '1') {
          call1Started.resolve(undefined)
          await gate1.promise
        }
        trace.push(`native:${args.step}:end`)
        active--
        return `native-done:${args.step}`
      },
    }))

    const stubRuntime = ctx.get('ptcRuntime') as StubRuntime
    stubRuntime.runner = async () => {
      active++
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active)
      trace.push('ptc:ptc-2:start')
      call2Started.resolve(undefined)
      await gate2.promise
      trace.push('ptc:ptc-2:end')
      active--
      return { logs: ['ptc-done:ptc-2'] }
    }

    const batchPromise = ctx.tools.execute({
      agent,
      calls: [
        { type: 'tool-call', id: ToolCallId('call-1'), name: 'track', arguments: JSON.stringify({ step: '1' }) },
        { type: 'tool-call', id: ToolCallId('call-2'), name: RUN_CODE_NAME, arguments: JSON.stringify({ code: 'x = 1', description: 'ptc-2' }) },
        { type: 'tool-call', id: ToolCallId('call-3'), name: 'track', arguments: JSON.stringify({ step: '3' }) },
      ],
      signal: new AbortController().signal,
      maxParallelToolCalls: 1,
    })

    try {
      // Wait until call 1 starts and blocks on gate1:
      await Promise.race([
        call1Started.promise,
        batchPromise.then(
          (res) => {
            const errs = res.results.map(r => extractErrorText(r.result)).filter(Boolean)
            throw new Error(`batch settled before call 1 started: ${JSON.stringify(res.results)} | errs: ${errs.join(', ')}`)
          },
          (err) => {
            throw new Error(`batch rejected before call 1 started: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
          },
        ),
      ])

      // Concurrency limit is strictly observed: call 1 is running, call 2 has NOT started
      expect(maxObservedConcurrency).toBe(1)
      expect(trace).toEqual(['native:1:start'])

      // Release call 1, then wait for call 2 to start and block on gate2:
      gate1.resolve(undefined)
      await Promise.race([
        call2Started.promise,
        batchPromise.then(
          (res) => {
            const errs = res.results.map(r => extractErrorText(r.result)).filter(Boolean)
            throw new Error(`batch settled before call 2 started: ${JSON.stringify(res.results)} | errs: ${errs.join(', ')}`)
          },
          (err) => {
            throw new Error(`batch rejected before call 2 started: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
          },
        ),
      ])

      // Call 1 has finished, call 2 is running, call 3 has NOT started:
      expect(maxObservedConcurrency).toBe(1)
      expect(trace).toEqual(['native:1:start', 'native:1:end', 'ptc:ptc-2:start'])

      // Release call 2 and await entire batch:
      gate2.resolve(undefined)
      const batchResult = await batchPromise

      // Concurrency limit was strictly observed throughout:
      expect(maxObservedConcurrency).toBe(1)
      // Execution order follows model-emitted call order:
      expect(trace).toEqual([
        'native:1:start',
        'native:1:end',
        'ptc:ptc-2:start',
        'ptc:ptc-2:end',
        'native:3:start',
        'native:3:end',
      ])

      // Results are correlated with their original calls in order:
      expect(batchResult.results).toHaveLength(3)
      expect(batchResult.results[0]?.callId).toBe(ToolCallId('call-1'))
      expect(batchResult.results[0]?.result).toMatchObject({ isError: false, value: 'native-done:1' })

      expect(batchResult.results[1]?.callId).toBe(ToolCallId('call-2'))
      expect(batchResult.results[1]?.result).toMatchObject({ isError: false })
      expect(batchResult.results[1]?.result.content[0]).toMatchObject({ text: 'ptc-done:ptc-2' })

      expect(batchResult.results[2]?.callId).toBe(ToolCallId('call-3'))
      expect(batchResult.results[2]?.result).toMatchObject({ isError: false, value: 'native-done:3' })
    } finally {
      // Always release all gates so the batch can settle even if assertions fail.
      gate1.resolve(undefined)
      gate2.resolve(undefined)
      await batchPromise
    }
  })

  it('preserves committed partial results when an execution fails mid-batch in both mode', async () => {
    const ctx = await host()
    const { agent } = await mount(ctx, { mode: 'both' })

    let failCall2 = false
    const step1Tool = defineTool({
      name: 'step1_tool',
      description: 'First step.',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
      execute: async () => {
        failCall2 = true
        return 'step1-done'
      },
    })
    ctx.tools.register(step1Tool)

    const toolSet: ResolvedToolSet = {
      dispose: () => {},
      view: () => {
        if (failCall2) throw new Error('internal tool resolution failure')
        return new Map([
          ['step1_tool', step1Tool],
          ['echo', ctx.tools.get('echo')!],
        ])
      },
    }

    let caught: unknown
    try {
      await ctx.tools.execute({
        agent,
        toolSet,
        calls: [
          { type: 'tool-call', id: ToolCallId('call-1'), name: 'step1_tool', arguments: '{}' },
          { type: 'tool-call', id: ToolCallId('call-2'), name: 'echo', arguments: JSON.stringify({ value: 'second' }) },
          { type: 'tool-call', id: ToolCallId('call-3'), name: RUN_CODE_NAME, arguments: JSON.stringify({ code: 'x = 1', description: 'unreached' }) },
        ],
        signal: new AbortController().signal,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ToolBatchExecutionError)
    const batchError = caught as ToolBatchExecutionError
    expect(batchError.cause).toEqual(new Error('internal tool resolution failure'))
    // Committed partial results before failure are retained:
    expect(batchError.partial.results).toHaveLength(1)
    expect(batchError.partial.results[0]?.callId).toBe(ToolCallId('call-1'))
    expect(batchError.partial.results[0]?.result).toMatchObject({ isError: false, value: 'step1-done' })
  })
})
