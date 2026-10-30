/**
 * Model-facing delegation through one configured `ctx.subagents` provider.
 * Provider lifecycle controls tool registration and context-sensitive schema
 * wording. Every delegation starts a managed activation and returns its child
 * id; the subagent runtime owns result delivery and resource cleanup.
 *
 * AsterHub fork gates (each explicit config; defaults preserve upstream):
 * - `modelSelectionSettings`: sample the Host `subagent-model-selection`
 *   setting per new top-level Session and inherit that decision in child
 *   Sessions via `subagentSessionStartProjectionDefinition` +
 *   `recordSubagentModelSelection`.
 * - `globalModelDefaults`: apply the Host-owned default child model without
 *   per-call selection fields.
 * - `backgroundMode`: omitted preserves the upstream activation path;
 *   `'one-shot'` collects the child result in the foreground; `'continuable'`
 *   defaults background starts to the continuable activation path
 *   (startActivation + parent delivery) when the provider supports
 *   `prepareContinuable`.
 * - `enableRunInBackground`: gates the `run_in_background` parameter
 *   exposure (default `false`).
 *
 * @module @deepseek-ai/dsh-tool-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  assertSubagentMaxDepth,
  delegationDepthOf,
  parentAgentOptionsForDelegation,
  settleRun,
} from '@deepseek-ai/dsh-subagent'
import type { SubagentActivation, SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent'
import {
  assertAllowedModelSelection,
  hasConfiguredLlmSelection,
  hasDelegationModelRequest,
  preflightChildLlmRoute,
  requestedAgentOptions,
} from './model-selection.ts'
import type { DelegationModelRequest, ModelSelectionPolicy, AllowedModelRoute } from './model-selection.ts'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { registerListSubagentModels } from './list-models.ts'
import { SubagentPresetSelection, type PresetSelectionConfig, type PresetSelectionRequest } from './preset-selection.ts'
import {
  recordSubagentModelSelection,
  subagentModelSelectionProjectionDefinition,
  subagentModelSelectionPolicy,
  subagentSessionStartProjectionDefinition,
} from './model-selection-state.ts'
import type {} from './model-selection-settings.ts'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'

export const name = 'tool-subagent'
export const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections']

// Definition identity keeps shared guidance scoped to the actual visible tools,
// including scoped overrides and independently loaded tool registries.
const delegationTools = new Set<ToolDefinition>()

/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config extends PresetSelectionConfig {
  /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`, `acp`). */
  provider: string
  /**
   * Model-facing tool name (default `subagent`). Each loaded instance must use
   * a distinct name.
   */
  toolName?: string
  /**
   * AsterHub fork gate: sample the Host `subagent-model-selection` setting for
   * each new top-level Session and inherit that decision in its child Sessions.
   * Requires the `subagentModelSelection` service in the Host scope.
   */
  modelSelectionSettings?: boolean
  /**
   * AsterHub fork gate: apply the Host-owned default child model without
   * exposing per-call model selection. Requires the `subagentModelSelection`
   * service and provider `agentOptions` support.
   */
  globalModelDefaults?: boolean
  /**
   * AsterHub fork gate: background execution policy. Omitted preserves the
   * upstream activation path (startActivation + delivery `parent`).
   * `'one-shot'` collects the child result in the foreground
   * (startActivation + settleForegroundRun + dispose). `'continuable'`
   * delegates to the continuable activation path when the provider supports
   * `prepareContinuable`, else falls back to the upstream activation path.
   */
  backgroundMode?: 'one-shot' | 'continuable'
  /**
   * AsterHub fork gate: expose `run_in_background` parameter (default
   * `false`). When `false`, the parameter is omitted and forced background
   * calls are rejected at execution time.
   */
  enableRunInBackground?: boolean
  /**
   * Expose optional child `provider`, `model`, and `reasoning_effort` fields.
   * Requires provider `agentOptions` support. Execution enforces the Session
   * policy, or restricts explicit selection to the current parent route.
   */
  modelSelection?: boolean
  /**
   * Register the shared `list_subagent_models` tool for this scope.
   * Enable on only one instance per scope; defaults to false and does not
   * enable model selection. Discovery is removed when this instance unloads.
   */
  modelDiscovery?: boolean
  /**
   * Agent options applied to every child; omitted fields use child-loop defaults.
   */
  agentOptions?: AgentOptions
  /**
   * Maximum child depth: a non-negative safe integer (`0` forbids delegation),
   * or `'provider-managed'` to send no cap. A numeric cap
   * requires the provider's `depthLimit` capability (mount fails loud
   * otherwise). The provider checks the calling agent's current depth at every
   * start; the tool remains model-visible so runtime policy owns rejection.
   * `'provider-managed'` is for an out-of-process provider whose recursion
   * budget belongs to the child runtime or its own deployment. Omission reads
   * the current Host subagent depth setting (default `1`) at each delegation.
   */
  maxDepth?: number | 'provider-managed'
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  toolName: z.string().default('subagent'),
  modelSelectionSettings: z.boolean().default(false),
  globalModelDefaults: z.boolean().default(false),
  enableRunInBackground: z.boolean().default(false),
  backgroundMode: z.union(['one-shot', 'continuable'] as const),
  modelSelection: z.boolean().default(false),
  modelDiscovery: z.boolean().default(false),
  // Prevent Schemastery from materializing omitted agentOptions as `{}`.
  agentOptions: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId> | undefined>,
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(undefined as unknown as {
    provider: string
    model: string
    reasoningEffort: ReturnType<typeof ReasoningEffortId>
    maxTokens: number
  }),
  agentPreset: z.string().min(1),
  allowedAgentPresets: (z.array(z.string().min(1)).min(1) as z<string[] | undefined>).default(undefined),
  maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed' as const)]),
})

/** Settle pending startup without rejecting the task producer contract. */
async function settleStart(start: Promise<SubagentActivation>, signal: AbortSignal): Promise<JobOutcome> {
  try {
    return await settleRun(await start)
  } catch (error: unknown) {
    // Product providers aggregate startup and rollback failures. Cancellation
    // must not turn a failed cleanup into a cleanly killed Job.
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    // Merge-extensible union: a backend may add stop reasons. Treat an unknown
    // terminal reason as a failure rather than reporting partial output as success.
    default:
      return `subagent run ended abnormally (${String(result.stopReason)})`
  }
}

/**
 * Append provider-authored failure detail and the child's preserved partial
 * answer to a stop-reason error, keeping diagnostic text separate from the
 * child's assistant output.
 * @param error - the stop-reason headline.
 * @param result - the child's terminal result.
 * @returns the headline, diagnostic, and partial text that are present.
 */
function withDiagnosticAndPartialText(error: string, result: SubagentResult): string {
  const diagnostic = result.diagnostic === undefined
    ? ''
    : `\nDiagnostic: ${result.diagnostic}`
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const partial = text.length === 0
    ? ''
    : `\nPartial output before the run ended:\n${text}`
  return `${error}${diagnostic}${partial}`
}

type ForegroundToolResult = {
  readonly kind: 'foreground'
  readonly runId: SubagentActivation['childId']
  readonly output: string[]
}

/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure.
 */
async function settleForegroundRun(run: SubagentActivation): Promise<ForegroundToolResult> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): ForegroundToolResult => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        // The registry converts this throw to isError; partial output is not
        // success, but the preserved partial answer still reaches the parent.
        throw new Error(withDiagnosticAndPartialText(error, result))
      }
      return {
        kind: 'foreground',
        runId: run.childId,
        output: result.output
          .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
          .map(block => block.text),
      }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Model-facing wording from the provider's conversation-history descriptor
 * ({@link SubagentProvider.inheritsParentContext}).
 * A fresh child needs a standalone prompt; a forked child already sees the
 * conversation's completed turns — telling the model to restate everything
 * (or, worse, that the child "does not see this conversation") would be false
 * for a fork.
 * @param inheritsConversation - whether the child's conversation is seeded
 *   with the parent's completed turns; this says nothing about tool, service,
 *   scope, or authority inheritance.
 * @returns the tool `description` and the `prompt` parameter description.
 */
function providerWording(inheritsConversation: boolean): { description: string; promptDescription: string } {
  if (inheritsConversation) {
    return {
      description:
        'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all '
        + 'completed turns so far (it does not see the current in-flight turn). Use this when the subtask '
        + 'builds on this conversation\'s context — a follow-up analysis, '
        + 'a review, a continuation — without consuming this conversation\'s context for the work itself. '
        + 'You receive its result, not its intermediate steps.',
      promptDescription:
        'The task for the subagent. It already sees this conversation\'s completed turns, so build on them '
        + 'freely and state only what is new.',
    }
  }
  return {
    description:
      'Delegate a self-contained task to a subagent (a separate agent that works in its own context) '
      + 'to offload focused, independent work — research, a scoped '
      + 'implementation, an analysis — so it does not consume this conversation\'s context. The subagent '
      + 'returns its result, not its intermediate steps.',
    promptDescription:
      'The complete, self-contained task for the subagent. It does not share this '
      + 'conversation\'s context, so include everything it needs.',
  }
}

interface DelegationRunRequest {
  readonly run_in_background?: boolean
}

interface DelegationRunSpec {
  readonly runInBackground: boolean
}

/** Resolve the model's optional scheduling request into one execution route. */
function resolveDelegationRun(
  request: DelegationRunRequest,
  options: { readonly backgroundEnabled: boolean; readonly continuable: boolean },
): DelegationRunSpec {
  if (!options.backgroundEnabled) {
    // The validator permits undeclared keys, so schema omission also needs
    // execution-time enforcement.
    if (request.run_in_background === true) {
      throw new Error('run_in_background is disabled for this tool instance (enableRunInBackground: false)')
    }
    return { runInBackground: false }
  }
  return {
    // Continuable work is independently scheduled unless the caller explicitly
    // needs the result before its next action. One-shot policy keeps its existing
    // foreground default because its background result requires Task collection.
    runInBackground: request.run_in_background ?? options.continuable,
  }
}

/** Shared context-injection fiber type for the scoped install path. */
type InjectFiber = ReturnType<Context['inject']>

/**
 * Create one delegation tool definition for a provider.
 * Shared by the composition-level mount and the per-Agent scoped install so
 * both paths produce byte-identical schemas.
 * @param ctx - Context that owns the tool registry.
 * @param config - delegation-tool configuration.
 * @param presets - preset selector instance.
 * @param subagentProvider - the provider this definition delegates to.
 * @param providerRouteDefaults - provider-owned route defaults.
 * @param backgroundEnabled - whether `run_in_background` is exposed.
 * @param continuable - whether the provider supports continuable background mode.
 * @param toolName - the model-facing tool name.
 * @param modelSelectionEnabled - whether route fields are exposed.
 * @param modelSelectionProjectionHandle - registered Session policy reader.
 * @returns the tool definition.
 */
function createDelegationToolDefinition(
  ctx: Context,
  config: Config,
  presets: SubagentPresetSelection,
  subagentProvider: SubagentProvider,
  providerRouteDefaults: SubagentProvider['agentRouteDefaults'],
  backgroundEnabled: boolean,
  continuable: boolean,
  toolName: string,
  modelSelectionEnabled: boolean,
  modelSelectionProjectionHandle: ProjectionHandle<AllowedModelRoute[] | null>,
): ToolDefinition {
  const wording = providerWording(subagentProvider.inheritsParentContext)
  const selectionDescription = providerRouteDefaults !== undefined
    ? ' Supply `provider` and `model` together. Omitted values use child defaults, falling back to this backend\'s route defaults. When the effective route changes, an omitted `reasoning_effort` uses the model\'s default.'
    : ' Supply `provider` and `model` together. Omitted values use child defaults, falling back to compatible parent values. When the effective route changes, an omitted `reasoning_effort` uses the model\'s default.'
  return defineTool({
    name: toolName,
    description: wording.description
      + ' This tool starts an independently managed subagent and immediately returns its id. The runtime notifies you when it finishes.'
      + (subagentProvider.prepareContinuable !== undefined
        ? ' The child reports results with `send_message`; use `send_message` to steer it while running or continue its conversation after it finishes.'
        : ' The completion notice includes its final answer. This backend does not accept follow-up messages.')
      + (modelSelectionEnabled ? selectionDescription : '')
      + (modelSelectionEnabled && subagentProvider.inheritsParentContext
        ? ' Changing the route can prevent provider-side reuse of the inherited conversation prefix.'
        : ''),
    parameters: {
      cwd: {
        type: 'string',
        description: 'Initial child working directory. Relative paths use your current directory; omitted inherits it. Later directory changes in either agent are independent.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'A short (3-5 word) description of the delegated task, for display.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: wording.promptDescription,
      },
      ...presets.choices === undefined ? {} : {
        agent_preset: {
          type: 'string' as const,
          enum: [...presets.choices],
          description: presets.description,
        },
      },
      ...modelSelectionEnabled ? {
        provider: {
          type: 'string' as const,
          description: 'Child LLM provider id.',
        },
        model: {
          type: 'string' as const,
          description: 'Model id within that provider.',
        },
        reasoning_effort: {
          type: 'string' as const,
          description: 'Model-specific reasoning effort id.',
        },
      } : {},
      ...backgroundEnabled ? {
        run_in_background: {
          type: 'boolean' as const,
          description: continuable
            ? 'Defaults to true. Set false only when your next action depends on the result.'
            : 'Run as a background job and return its id (collect with job_output, stop with job_kill). Defaults to false.',
        },
      } : {},
    },
    output: {
      // The multi-route contract describes every gate-selectable result shape;
      // with all gates off, execution only ever returns the `activation` route.
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'activation' },
              subagentId: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background subagent job ${value.jobId}`
          : value.kind === 'continuable'
            ? `started subagent ${value.subagentId}`
            : value.kind === 'foreground'
              ? value.output.join('')
              : `started subagent ${value.subagentId}`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers provide no parent for delegation ownership.
        throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
      }

      const modelRequest = args as DelegationModelRequest
      // AsterHub fork gate: globalModelDefaults rejects per-call model overrides.
      if (config.globalModelDefaults === true && hasDelegationModelRequest(modelRequest)) {
        throw new Error('subagent model overrides are disabled; the user-selected default model must be used')
      }
      const parentOptions = parentAgentOptionsForDelegation(parent)
      // AsterHub fork gate: read the Host-owned default child model.
      const globalDefault = config.modelSelectionSettings === true || config.globalModelDefaults === true
        ? ctx.get('subagentModelSelection')?.defaultModel() : null
      if (globalDefault && !subagentProvider.capabilities.agentOptions) {
        throw new Error(`subagent provider "${subagentProvider.name}" cannot apply the saved default model`)
      }
      const childDefaults = globalDefault
        ? { ...config.agentOptions, ...globalDefault }
        : config.agentOptions
      if (globalDefault && childDefaults) delete childDefaults.reasoningEffort
      const requiresRoutePreflight = hasDelegationModelRequest(modelRequest)
        || hasConfiguredLlmSelection(childDefaults)
      const configuredChildAgentOptions = requiresRoutePreflight && providerRouteDefaults !== undefined
        ? { ...providerRouteDefaults, ...childDefaults }
        : childDefaults
      const requestedChildAgentOptions = requestedAgentOptions(
        parentOptions,
        configuredChildAgentOptions,
        modelRequest,
        modelSelectionEnabled,
      )
      const recordedRoutes = subagentModelSelectionPolicy(
        modelSelectionProjectionHandle,
        parent.session,
      )
      assertAllowedModelSelection(
        recordedRoutes === undefined ? undefined : { routes: recordedRoutes },
        parentOptions,
        requestedChildAgentOptions,
        modelRequest,
      )
      if (requiresRoutePreflight) {
        const llm = ctx.get('llm')
        if (llm === undefined) {
          throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
        }
        // AsterHub fork gate: validate the saved default model against the current account catalog.
        if (globalDefault && requestedChildAgentOptions?.provider === globalDefault.provider
          && requestedChildAgentOptions.model === globalDefault.model) {
          const available = await llm.listModels(globalDefault.provider)
          if (!available.some(model => model.id === globalDefault.model)) {
            throw new Error('the saved default subagent model is not available in the current account catalog; choose an available model in Settings')
          }
        }
        await preflightChildLlmRoute(
          llm,
          parentOptions,
          requestedChildAgentOptions,
          exec.signal,
          providerRouteDefaults === undefined,
        )
        if (ctx.subagents.getProvider(config.provider) !== subagentProvider) {
          throw new Error(`subagent provider "${config.provider}" changed while resolving the child LLM route; retry the delegation`)
        }
      }
      exec.signal.throwIfAborted()
      const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth)
      const agentPreset = presets.resolve(args as PresetSelectionRequest)
      const request = {
        ...args.cwd === undefined ? {} : { cwd: args.cwd },
        prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
        parent,
        ...agentPreset === undefined ? {} : { agentPreset },
        ...requestedChildAgentOptions !== undefined ? { agentOptions: requestedChildAgentOptions } : {},
        ...maxDepth !== undefined ? { maxDepth } : {},
      }

      // AsterHub fork gate: backgroundMode selects the execution route.
      const runSpec = resolveDelegationRun(args, { backgroundEnabled, continuable })
      if (runSpec.runInBackground) {
        if (continuable) {
          // Resolves at inbox acceptance: the child owns its own turns from
          // there, so this call neither waits for nor collects a result.
          const started = await ctx.subagents.startActivation({
            provider: config.provider,
            label: args.description,
            request,
            signal: exec.signal,
            delivery: 'parent',
          })
          return { kind: 'continuable' as const, subagentId: started.childId }
        }
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        }
        const id = jobs.start({
          kind: 'subagent',
          label: args.description,
          owner: parent.id,
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.startActivation({
              provider: config.provider,
              label: args.description,
              request,
              signal: controller.signal,
              delivery: 'caller',
            })
            return {
              cancel: (reason?: string) => {
                controller.abort(reason ?? 'background subagent task killed')
              },
              done: settleStart(start, controller.signal),
            }
          },
        })
        return { kind: 'background' as const, jobId: id }
      }

      // AsterHub fork gate: one-shot foreground collection.
      if (config.backgroundMode === 'one-shot') {
        const run = await ctx.subagents.startActivation({
          provider: config.provider,
          label: args.description,
          request,
          signal: exec.signal,
          delivery: 'caller',
        })
        return settleForegroundRun(run)
      }

      // Upstream default path: unified activation with parent delivery.
      const started = await ctx.subagents.startActivation({
        provider: config.provider,
        label: args.description,
        request,
        signal: exec.signal,
        delivery: 'parent',
      })
      return { kind: 'activation' as const, subagentId: started.childId }
    },
  })
}

/**
 * Install one delegation-tool composition.
 * The owning composition shares its registrations across Agents; child startup resolves the selected preset.
 * @param ctx - Context that owns the registrations.
 * @param config - delegation-tool configuration.
 * @returns when the plugin is ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  for (const field of ['persona', 'toolFilter']) {
    if (Object.hasOwn(config, field)) {
      throw new Error(`tool-subagent: ${field} is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)`)
    }
  }
  const presets = new SubagentPresetSelection(config)
  if (presets.configured && ctx.get('agentPresets') === undefined) {
    throw new Error('tool-subagent: agent preset selection requires the agent-presets service')
  }
  // Direct apply() bypasses Schemastery's numeric constraints. A direct-apply
  // omission stays capless (the schema default only runs through the loader).
  if (config.maxDepth !== 'provider-managed') assertSubagentMaxDepth(config.maxDepth)
  // AsterHub fork gate: globalModelDefaults requires the Host settings service.
  if (config.globalModelDefaults === true && ctx.get('subagentModelSelection') === undefined) {
    throw new Error('tool-subagent: globalModelDefaults requires the Host subagent model settings service')
  }
  const backgroundEnabled = config.enableRunInBackground === true
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable'
  const toolName = config.toolName ?? 'subagent'

  const modelSelectionCapable = config.modelSelectionSettings === true
  const subagentModelSelectionProjectionHandle = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
  const subagentSessionStartProjectionHandle = await ctx.sessionProjections.register(subagentSessionStartProjectionDefinition)

  const assertSubagentProviderConfiguration = (subagentProvider: SubagentProvider): void => {
    presets.assertProvider(subagentProvider)
    if (ctx.subagents.resolveMaxDepth(config.maxDepth) !== undefined && !subagentProvider.capabilities.depthLimit) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" cannot enforce maxDepth (no depthLimit capability) — `
        + 'set maxDepth: \'provider-managed\' to leave the recursion budget to the provider',
      )
    }
    if (config.agentOptions !== undefined && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support child agentOptions`,
      )
    }
    if (config.modelSelection === true && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support child model selection`,
      )
    }
    if (continuable && subagentProvider.prepareContinuable === undefined) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support \`backgroundMode: continuable\``,
      )
    }
  }

  // Validate provider-owned config outside the optional LLM binding so an
  // invalid provider always rejects its registration or this plugin's load.
  ctx.on('subagent/provider-added', (subagentProvider) => {
    if (subagentProvider.name === config.provider) assertSubagentProviderConfiguration(subagentProvider)
  })
  const initialProvider = ctx.subagents.getProvider(config.provider)
  if (initialProvider !== undefined) assertSubagentProviderConfiguration(initialProvider)

  if (config.modelDiscovery === true) registerListSubagentModels(ctx, subagentModelSelectionProjectionHandle)

  // Load order and HMR replacement can change provider availability while
  // this fiber remains active.
  let mounted: { subagentProvider: SubagentProvider; definition: ToolDefinition; disposeTool: () => void } | undefined
  const mount = (subagentProvider: SubagentProvider): void => {
    assertSubagentProviderConfiguration(subagentProvider)
    const definition = createDelegationToolDefinition(
      ctx, config, presets, subagentProvider, subagentProvider.agentRouteDefaults,
      backgroundEnabled, continuable, toolName,
      config.modelSelection === true, subagentModelSelectionProjectionHandle,
    )
    const disposeTool = ctx.effect(() => {
      const unregister = ctx.tools.register(definition)
      delegationTools.add(definition)
      return () => {
        delegationTools.delete(definition)
        unregister()
      }
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- Tool and guidance disposal are synchronous.
    mounted = { subagentProvider, definition, disposeTool }
  }

  // Register listeners before checking presence so no synchronous change is missed.
  ctx.on('subagent/provider-added', (subagentProvider) => {
    if (subagentProvider.name === config.provider && mounted === undefined) mount(subagentProvider)
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== config.provider || mounted === undefined) return
    mounted.disposeTool()
    mounted = undefined
  })
  const present = ctx.subagents.getProvider(config.provider)
  if (present !== undefined) {
    mount(present)
  } else {
    // A backend fiber may activate later; a misspelled provider remains visible in this log.
    ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? 'subagent'}" tool will register when it appears`)
  }
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
    text: (context) => {
      if (mounted === undefined) return ''
      const visible = [...delegationTools]
        .filter(tool => ctx.tools.get(tool.name, context.scope) === tool)
        .map(tool => tool.name)
        .sort()
      if (visible[0] !== toolName) return ''
      const names = visible.map(name => `\`${name}\``).join(' or ')
      return `Start independent delegations with ${names} together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.`
    },
  })
  ctx.systemPrompt.context({
    name: `tool:${toolName}:depth`,
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: (context) => {
      if (context.agent === undefined || mounted === undefined
        || ctx.tools.get(toolName, context.scope) !== mounted.definition) return ''
      const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth)
      if (maxDepth === undefined) return ''
      const depth = delegationDepthOf(context.agent)
      if (depth < maxDepth) return ''
      return `Delegation depth for \`${toolName}\`: current ${depth}, maximum ${maxDepth}, remaining levels 0.`
        + ` Do not call \`${toolName}\` at this depth; carry out the work directly.`
    },
  })

  // AsterHub fork gate: modelSelectionSettings scoped install path.
  if (!modelSelectionCapable) return

  const settings = ctx.get('subagentModelSelection')
  if (settings === undefined) {
    throw new Error(
      'tool-subagent: `modelSelectionSettings` requires '
      + '@deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope',
    )
  }
  const selectForSession = (target: Session): ModelSelectionPolicy | undefined => {
    const freshSession = target.firstLiveSeq === 0
      && !subagentSessionStartProjectionHandle.stateOf(target)
    let allowedModels = subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, target)
    if (allowedModels === undefined) {
      const parentId = target.header.origin === 'subagent'
        ? target.header.parentSession
        : undefined
      if (parentId !== undefined) {
        const sessions = ctx.get('sessions')
        if (sessions === undefined) {
          throw new Error('tool-subagent: child model-selection inheritance requires the Session registry')
        }
        const parent = sessions.get(parentId)
        allowedModels = parent === undefined
          ? undefined
          : subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, parent)
      } else if (freshSession) {
        const current = settings.current()
        allowedModels = current.enabled ? current.allowedModels : undefined
      }
    }
    if (allowedModels !== undefined) {
      recordSubagentModelSelection(subagentModelSelectionProjectionHandle, target, allowedModels)
    }
    return allowedModels === undefined ? undefined : { routes: allowedModels }
  }

  const compositionScope = scopeOf(ctx)
  if (compositionScope === undefined) {
    throw new Error('tool-subagent: standing `modelSelectionSettings` requires a scoped preset Context')
  }
  const agents = ctx.get('agents')
  /* v8 ignore next -- shipped preset compositions always include the Agent registry. */
  if (agents === undefined) throw new Error('tool-subagent: standing `modelSelectionSettings` requires the Agent registry')
  const scopedInstalls = new WeakMap<Agent, InjectFiber>()
  const installing = new WeakSet<Agent>()
  const belongsToComposition = (candidate: Agent): boolean =>
    scopeChainOf(scopeOf(candidate.ctx)).includes(compositionScope)
  const installScoped = (candidate: Agent): InjectFiber | undefined => {
    const existing = scopedInstalls.get(candidate)
    if (existing !== undefined) return existing
    if (installing.has(candidate)) return
    // Reserve before the injected fiber runs: tool registration emits
    // `tools/change` synchronously, which re-enters the reconciliation below.
    installing.add(candidate)
    let fiber: InjectFiber
    try {
      const policy = selectForSession(candidate.session)
      fiber = candidate.ctx.inject(['tools', 'subagents', 'systemPrompt'], (runtimeCtx) => {
        installScopedModelSelection(
          runtimeCtx, config, presets, backgroundEnabled, continuable, toolName, policy,
          subagentModelSelectionProjectionHandle,
        )
      })
    } finally {
      installing.delete(candidate)
    }
    scopedInstalls.set(candidate, fiber)
    return fiber
  }
  const removeScoped = (candidate: Agent): void => {
    const fiber = scopedInstalls.get(candidate)
    if (fiber === undefined) return
    scopedInstalls.delete(candidate)
    /* v8 ignore next 3 -- Cordis Fiber disposal contains registration cleanup failures; this is the final diagnostic sink. */
    void fiber.dispose().catch((error: unknown) => {
      ctx.logger.warn(`tool-subagent: failed to remove recomposed Agent "${candidate.id}" definitions: ${String(error)}`)
    })
  }
  const reconcileComposedAgents = (): void => {
    for (const candidate of agents.list()) {
      if (belongsToComposition(candidate)) installScoped(candidate)
      else removeScoped(candidate)
    }
  }
  // The preset-scoped listener admits descendant Agents and installs the
  // sampled tool definition in each Agent's own scope, so a later settings
  // change cannot mutate a live session.
  ctx.on('agent/created', async ({ agent: created }) => {
    await installScoped(created)
  })
  ctx.on('agent/disposed', ({ agent: disposed }) => { removeScoped(disposed) })
  ctx.on('tools/change', reconcileComposedAgents)
  reconcileComposedAgents()
}

/**
 * Install the model-selection-enabled delegation tool in one Agent scope.
 * AsterHub fork gate: called only when `modelSelectionSettings: true`.
 * Registers the tool definition in the given context and mirrors provider
 * lifecycle, mirroring the composition-level mount but scoped to the Agent.
 * @param ctx - Agent-scoped context that owns the tool registry.
 * @param config - delegation-tool configuration.
 * @param presets - preset selector instance.
 * @param backgroundEnabled - whether `run_in_background` is exposed.
 * @param continuable - whether the provider supports continuable background mode.
 * @param toolName - the model-facing tool name.
 * @param modelSelectionPolicy - Session policy captured for this Agent.
 * @param modelSelectionProjectionHandle - registered Session policy reader.
 */
function installScopedModelSelection(
  ctx: Context,
  config: Config,
  presets: SubagentPresetSelection,
  backgroundEnabled: boolean,
  continuable: boolean,
  toolName: string,
  modelSelectionPolicy: ModelSelectionPolicy | undefined,
  modelSelectionProjectionHandle: ProjectionHandle<AllowedModelRoute[] | null>,
): void {
  // The scoped install registers the tool in this Agent's scope. The policy
  // is captured at install time; execution reads it from the projection.
  const subagentProvider = ctx.subagents.getProvider(config.provider)
  if (subagentProvider === undefined) return
  const definition = createDelegationToolDefinition(
    ctx, config, presets, subagentProvider, subagentProvider.agentRouteDefaults,
    backgroundEnabled, continuable, toolName,
    modelSelectionPolicy !== undefined, modelSelectionProjectionHandle,
  )
  ctx.effect(() => {
    ctx.tools.register(definition)
    delegationTools.add(definition)
    return () => {
      delegationTools.delete(definition)
    }
  })
}
