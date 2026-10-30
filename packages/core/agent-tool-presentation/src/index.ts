/**
 * Agent-plane presentation selector: the row an agent preset carries to say
 * which form of its tools the model sees.
 *
 * The tool registry itself stays on the host plane — the agent loop's
 * scheduler, the API proxy's presenters, and every tool plugin are all its
 * consumers, so it cannot move into a preset. What a preset CAN own is the
 * presentation: `ctx.tools.setExecutor()` binds a scoped executor for the
 * mounting SCOPE, which is the preset's standing mount, so the declaration
 * covers every agent joined to that preset and a PTC mode preset runs beside
 * native ones in one process. One row per composition, not one per session.
 *
 * A PTC mode needs a TypeScript PTC runtime, which is a host-plane service
 * ([`dsh-ptc-runtime-node`](../../../ptc-runtime/ptc-runtime-node/README.md)).
 * This row therefore waits for it rather than assuming it: a preset selecting
 * PTC mode against a deployment that composes no runtime fails at mount, named
 * in the preset's own activation audit, instead of at the first prompt.
 * @module @deepseek-ai/dsh-agent-tool-presentation
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  RUN_CODE_NAME,
  ToolBatchExecutionError,
  type ToolBatchInput,
  type ToolBatchResult,
  type ToolCallResult,
  type ToolDefinition,
  type ToolExecutor,
  type ToolModelInput,
  type ToolPromptSection,
} from '@deepseek-ai/dsh-tools'
// Type-only: brings the `ctx.tools` Context merge into this program.
import type {} from '@deepseek-ai/dsh-tools'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc'

/** Cordis plugin name. */
export const name = 'tool-presentation'

/**
 * Required services. `ptcRuntime` is NOT listed: a `native` row must mount in
 * a deployment that composes no runtime, and the mode-dependent wait is
 * declared inside {@link apply} instead.
 */
export const inject = ['tools']

/**
 * The presentation form an agent's model sees.
 * `native` sends every visible schema,
 * `ptc` sends only `run_code` plus a generated SDK,
 * `both` sends both forms.
 */
export type ToolPresentationMode = 'native' | 'ptc' | 'both'

/** Plugin config. */
export interface Config {
  /**
   * The form this agent's model sees. `native` sends every visible schema,
   * `ptc` sends only `run_code` plus a generated SDK, `both` sends both.
   * Required rather than defaulted: the deployment default is what a preset
   * without this row already gets, so an omitted value would mean the row was
   * composed for nothing.
   */
  mode: ToolPresentationMode
}

/** Runtime schema. */
export const Config: z<Config> = z.object({
  mode: z.union(['native', 'ptc', 'both'] as const).required(),
})

/**
 * Combined tool executor supporting the fork feature `mode: 'both'`.
 *
 * Exposes both direct capability tool schemas and the `run_code` PTC transport
 * to the model, and provides the generated tools SDK guidance prompt section.
 * Direct model calls to `run_code` are dispatched through the PTC pipeline,
 * while other tool calls are dispatched directly through the native pipeline.
 */
export class BothToolExecutor implements ToolExecutor {
  readonly sections: readonly ToolPromptSection[]
  private readonly native: NativeToolExecutor
  private readonly ptc: PtcExecutor

  constructor(ctx: Context) {
    this.native = new NativeToolExecutor(ctx)
    this.ptc = new PtcExecutor(ctx)
    // Filter out the PTC-only instruction since direct native tool calls are permitted in both mode.
    // Retain the generated tools SDK prompt section so programs in run_code have type definitions.
    this.sections = this.ptc.sections.filter(section => section.name !== 'tools:ptc-only')
  }

  describe(tools: readonly ToolDefinition[]): ToolModelInput {
    const native = this.native.describe(tools)
    const ptc = this.ptc.describe(tools)
    return {
      schemas: [...native.schemas, ...ptc.schemas],
      knownNames: [
        ...native.knownNames ?? tools.map(tool => tool.name),
        ...ptc.knownNames ?? [RUN_CODE_NAME],
      ],
    }
  }

  async execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    const hasRunCode = input.calls.some(call => call.name === RUN_CODE_NAME)
    const hasNative = input.calls.some(call => call.name !== RUN_CODE_NAME)

    // Pure batches preserve maximum performance and internal pipeline scheduling unchanged.
    if (!hasRunCode) {
      return this.native.execute(input)
    }
    if (!hasNative) {
      return this.ptc.execute(input)
    }

    // Trade-off note: Mixed batches (interleaved native and PTC calls) are executed
    // sequentially in model-emitted call order. Running native and PTC sub-batches
    // concurrently via dual schedulers would violate strict batch-level concurrency limits
    // (such as maxParallelToolCalls: 1), permit side-effect calls to race out of order,
    // and misorder additionalContexts (which must strictly follow call occurrence order).
    // Serial execution guarantees deterministic ordering, safety, and exact context FIFO.
    const results: ToolCallResult[] = []
    const additionalContexts: NonNullable<ToolBatchResult['additionalContexts']>[number][] = []
    let concluded = false

    for (const call of input.calls) {
      const singleInput: ToolBatchInput = {
        ...input,
        calls: [call],
      }
      const executor = call.name === RUN_CODE_NAME ? this.ptc : this.native

      try {
        const batchResult = await executor.execute(singleInput)
        results.push(...batchResult.results)
        if (batchResult.additionalContexts?.length) {
          additionalContexts.push(...batchResult.additionalContexts)
        }
        if (batchResult.concluded) {
          concluded = true
        }
      } catch (error: unknown) {
        if (error instanceof ToolBatchExecutionError) {
          if (error.partial.results?.length) {
            results.push(...error.partial.results)
          }
          if (error.partial.additionalContexts?.length) {
            additionalContexts.push(...error.partial.additionalContexts)
          }
          if (error.partial.concluded) {
            concluded = true
          }
          throw new ToolBatchExecutionError(error.cause, {
            results,
            additionalContexts,
            concluded,
          })
        }
        throw new ToolBatchExecutionError(error, {
          results,
          additionalContexts,
          concluded,
        })
      }
    }

    return {
      results,
      additionalContexts,
      concluded,
    }
  }
}

/**
 * Declare the tool presentation for every agent this composition covers.
 * @param ctx - the mounting composition's scope context (a preset's standing scope).
 * @param config - the selected presentation.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.mode === 'native') {
    ctx.tools.setExecutor(new NativeToolExecutor(ctx))
    return
  }
  // The wait is the loud failure: an entry still pending on `ptcRuntime` is
  // what `dsh-agent-preset-registry` reports as an unusable row, naming this id.
  ctx.inject(['ptcRuntime'], (runtimeCtx: Context) => {
    if (config.mode === 'ptc') {
      runtimeCtx.tools.setExecutor(new PtcExecutor(runtimeCtx))
    } else {
      runtimeCtx.tools.setExecutor(new BothToolExecutor(runtimeCtx))
    }
  })
}
