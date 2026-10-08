/** Scoped native task authoring with explicit human consent and no model-visible tickets. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from './index.ts'
import { AutomationOperationError } from './operations.ts'
import type { AutomationTaskId, AutomationRunId, AutomationOperation, AutomationDraft } from './types.ts'

/** Persisted JSON acknowledgement rendered by native task result cards. */
export interface AutomationManageOutput {
  readonly action: string
  readonly success: boolean
  readonly result?: JsonValue
  readonly preview?: JsonValue
  readonly error?: { readonly code: string; readonly message: string }
}
/** Current-account readonly JSON response. */
export interface AutomationReadOutput {
  readonly action: string
  readonly success: boolean
  readonly tasks?: JsonValue
  readonly task?: JsonValue
  readonly error?: { readonly code: string; readonly message: string }
}

const timingSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'once' }, at: { type: 'string', required: true } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'delay' }, seconds: { type: 'integer', required: true } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'interval' }, seconds: { type: 'integer', required: true }, firstAt: { type: 'string' } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'daily' }, time: { type: 'string', required: true }, timeZone: { type: 'string', required: true } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'weekly' }, time: { type: 'string', required: true }, timeZone: { type: 'string', required: true }, weekdays: { type: 'array', required: true, items: { type: 'integer' } } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'cron' }, expression: { type: 'string', required: true }, timeZone: { type: 'string', required: true } } },
  ],
} as const
const draftSchema = {
  type: 'object', additionalProperties: false, required: true,
  properties: {
    name: { type: 'string', required: true }, instruction: { type: 'string', required: true },
    workspaceId: { type: 'string', required: true }, modelId: { type: 'string', required: true },
    reasoningEffort: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    timing: { ...timingSchema, required: true },
  },
} as const
const outputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', required: true }, success: { type: 'boolean', required: true },
    result: { type: 'json' }, preview: { type: 'json' }, tasks: { type: 'json' }, task: { type: 'json' },
    error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
  },
} as const

/** Validate the outgoing JSON value without copying the task and history again. */
function resultValue(value: unknown): {
  action: string; success: boolean; result?: JsonValue; preview?: JsonValue; tasks?: JsonValue; task?: JsonValue;
  error?: { code: string; message: string }
} {
  if (!isJsonValue(value)) throw new Error('automation: tool acknowledgement is not lossless JSON')
  return value as AutomationManageOutput & AutomationReadOutput
}

/**
 * Register the action-discriminated authoring tool in one interactive root scope.
 * @param rootCtx - Host service owner.
 * @param toolCtx - Exact calling Agent scope.
 * @param agent - Agent permitted to use this registration.
 * @returns Disposer for the scoped tool.
 */
export function registerAutomationTools(rootCtx: Context, toolCtx: Context, agent: Agent): () => void {
  return toolCtx.tools.register(defineTool({
    name: 'automation_manage',
    description: 'Manage native scheduled tasks in AsterHub. Use a complete, self-contained instruction, registered workspace and current-account model. Creation and execution changes wait for an explicit human confirmation; never supply a confirmation flag or ticket. Every run creates a fresh conversation while the application remains running, consumes model credits, and retains ordinary sensitive-operation approvals.',
    parameters: {
      operation: {
        required: true,
        oneOf: [
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, const: 'preview' }, draft: draftSchema } },
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, const: 'create' }, draft: draftSchema } },
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, const: 'list' } } },
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, const: 'get' }, id: { type: 'string', required: true } } },
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, const: 'update' }, id: { type: 'string', required: true }, expectedRevision: { type: 'integer', required: true }, draft: draftSchema } },
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, enum: ['pause', 'resume', 'run', 'remove', 'purgeDeleted'] }, id: { type: 'string', required: true }, expectedRevision: { type: 'integer', required: true } } },
          { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true, const: 'stop' }, id: { type: 'string', required: true }, runId: { type: 'string', required: true } } },
        ],
      },
    },
    output: { schema: outputSchema, render: (_args, value): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const request = args.operation
      const action = request.action
      try {
        if (exec.agent !== agent || agent.ctx.get('asterhubAutomationRun') !== undefined || !rootCtx.agents.roots().includes(agent)) {
          throw new AutomationOperationError('scheduled_origin', 'Scheduled executions cannot manage task authorization.')
        }
        exec.signal.throwIfAborted()
        if (action === 'list') {
          const page = await rootCtx.asterhubAutomation.list({})
          return resultValue({ action, success: true, tasks: page.tasks })
        }
        if (action === 'get') {
          const task = await rootCtx.asterhubAutomation.get({ id: brandString<AutomationTaskId>(request.id) })
          return resultValue({ action, success: true, task })
        }
        let operation: AutomationOperation
        if (action === 'create' || action === 'preview' || action === 'update') {
          const draft: AutomationDraft = { ...request.draft, workspaceId: brandString<WorkspaceId>(request.draft.workspaceId) }
          if (action === 'preview') return resultValue({ action, success: true, preview: await rootCtx.asterhubAutomation.preview(draft) })
          operation = action === 'create' ? { action, draft } : { action, draft, id: brandString<AutomationTaskId>(request.id), expectedRevision: request.expectedRevision }
        } else if (action === 'stop') {
          operation = { action, id: brandString<AutomationTaskId>(request.id), runId: brandString<AutomationRunId>(request.runId) }
        } else {
          operation = { action, id: brandString<AutomationTaskId>(request.id), expectedRevision: request.expectedRevision }
        }
        const prepared = await rootCtx.asterhubAutomation.prepareOperation(operation)
        if (prepared.requiresConfirmation) {
          const answer = await rootCtx.userQuestions.ask({
            agent, signal: exec.signal,
            questions: [{ id: 'automation-consent', question: '确认保存这项定时任务操作？', detail: `${prepared.summary}\n\n应用必须保持运行；每次执行会消耗算力积分；敏感操作仍需单独审批`, options: [{ label: '确认' }, { label: '取消' }] }],
          })
          if (!answer.answers.some(item => item.id === 'automation-consent' && item.selected.length === 1 && item.selected[0] === '确认')) {
            return resultValue({ action, success: false, error: { code: 'confirmation_canceled', message: 'The operation was not saved.' } })
          }
        }
        exec.signal.throwIfAborted()
        const result = await rootCtx.asterhubAutomation.commitOperation({ requestId: prepared.requestId, confirmationId: prepared.confirmationId })
        return resultValue({ action, success: true, result })
      } catch (error) {
        return resultValue({ action, success: false, error: error instanceof AutomationOperationError ? { code: error.code, message: error.message } : { code: 'operation_failed', message: 'The automation operation could not be completed.' } })
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Scheduled tasks', kind: 'other', rawInput: args }),
  }))
}
