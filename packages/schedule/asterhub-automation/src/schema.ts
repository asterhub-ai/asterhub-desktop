/** Schema validation for durable automation task aggregates. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AutomationTask,
  AutomationTaskId,
  AutomationRun,
  AutomationRunId,
  AutomationTiming,
  AutomationSnapshot,
  AutomationReceipt,
} from './types.ts'

/** Branded task id validator. */
const taskIdSchema = z.string().min(1).transform((v): AutomationTaskId => brandString<AutomationTaskId>(v))

/** Branded run id validator. */
const runIdSchema = z.string().min(1).transform((v): AutomationRunId => brandString<AutomationRunId>(v))

/** ISO timestamp validator. */
const instantSchema = z.string().refine(
  (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v),
  { message: 'Expected ISO 8601 UTC timestamp' }
)

/** Normalized timing validator. */
const timingSchema: z.ZodType<AutomationTiming> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('once'),
    at: instantSchema,
  }),
  z.object({
    kind: z.literal('delay'),
    seconds: z.number().int().positive(),
    anchorAt: instantSchema,
    at: instantSchema,
  }),
  z.object({
    kind: z.literal('interval'),
    seconds: z.number().int().min(60),
    firstAt: instantSchema,
    anchorAt: instantSchema,
  }),
  z.object({
    kind: z.literal('daily'),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/),
    timeZone: z.string().min(1),
  }),
  z.object({
    kind: z.literal('weekly'),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/),
    timeZone: z.string().min(1),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1),
  }),
  z.object({
    kind: z.literal('cron'),
    expression: z.string().min(1),
    timeZone: z.string().min(1),
  }),
])

/** Snapshot validator. */
const snapshotSchema: z.ZodType<AutomationSnapshot> = z.object({
  name: z.string().min(1).max(120),
  instruction: z.string().min(1).max(16000),
  workspaceId: z.string().min(1).transform((v): WorkspaceId => brandString<WorkspaceId>(v)),
  modelId: z.string().min(1),
  reasoningEffort: z.string().nullable(),
  timing: timingSchema,
})

/** Run state validator. */
const runStateSchema = z.enum([
  'reserved', 'running', 'waiting-approval', 'stopping',
  'succeeded', 'failed', 'canceled', 'interrupted', 'unknown', 'blocked', 'skipped'
])

/** Run record validator. */
const runSchema: z.ZodType<AutomationRun> = z.object({
  id: runIdSchema,
  taskId: taskIdSchema,
  trigger: z.enum(['scheduled', 'catch-up', 'manual']),
  scheduledAt: instantSchema.nullable(),
  requestedAt: instantSchema,
  requestId: z.string().nullable(),
  definitionRevision: z.number().int().nonnegative(),
  snapshot: snapshotSchema,
  sessionId: z.string().nullable().transform((v) => v === null ? null : brandString<SessionId>(v)),
  sessionCreated: z.boolean(),
  state: runStateSchema,
  startedAt: instantSchema.nullable(),
  finishedAt: instantSchema.nullable(),
  reason: z.object({
    code: z.string(),
    message: z.string(),
  }).nullable(),
  ownerRuntimeId: z.string().min(1),
  inputMessageId: z.string().nullable(),
  startLogOffset: z.number().int().nullable(),
  endLogOffset: z.number().int().nullable(),
  terminalTurn: z.number().int().nullable(),
  interactionIds: z.array(z.string()),
  humanIntervened: z.boolean(),
})

/** Receipt validator. */
const receiptSchema: z.ZodType<AutomationReceipt> = z.object({
  requestId: z.string().min(1),
  digest: z.string().min(1),
  acceptedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  result: z.object({
    taskId: taskIdSchema,
    runId: runIdSchema.nullable(),
    deleted: z.boolean(),
  }),
})

/** Task aggregate validator - the complete durable record. */
export const taskAggregateSchema: z.ZodType<AutomationTask> = z.object({
  id: taskIdSchema,
  ownerAccountId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  recordVersion: z.number().int().nonnegative(),
  authorizationRevision: z.number().int().nonnegative(),
  consentRevision: z.number().int().nonnegative(),
  ruleRevision: z.number().int().nonnegative(),
  definition: snapshotSchema,
  enabled: z.boolean(),
  deletedAt: instantSchema.nullable(),
  nextOccurrenceAt: instantSchema.nullable(),
  occurrenceWatermark: z.object({
    ruleRevision: z.number().int().nonnegative(),
    at: instantSchema,
  }).nullable(),
  pendingOccurrence: z.object({
    at: instantSchema,
    from: instantSchema,
    ruleRevision: z.number().int().nonnegative(),
  }).nullable(),
  activeRunId: runIdSchema.nullable(),
  runs: z.array(runSchema),
  requestReceipts: z.array(receiptSchema),
  creationRequest: z.object({
    requestId: z.string().min(1),
    digest: z.string().min(1),
  }),
  historyPruned: z.boolean(),
  skippedRange: z.object({
    from: instantSchema,
    through: instantSchema,
    reason: z.string(),
  }).nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})

/** Storage domain definition for automation tasks. */
export const automationDomain = defineDomain({
  name: 'asterhub_automation',
  version: 1,
  exclusive: true,
  tables: {
    tasks: domainTable<AutomationTaskId, AutomationTask>(taskAggregateSchema),
  },
})

/** Error thrown when a stored task fails validation. */
export class AutomationSchemaError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message)
    this.name = 'AutomationSchemaError'
  }
}

/** Validate a task aggregate at the durable boundary. */
export function validateTaskAggregate(value: unknown): AutomationTask {
  const result = taskAggregateSchema.safeParse(value)
  if (!result.success) {
    throw new AutomationSchemaError(
      `Invalid task aggregate: ${result.error.message}`,
      result.error
    )
  }
  return result.data
}
