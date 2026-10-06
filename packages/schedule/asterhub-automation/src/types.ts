/** Browser-safe native scheduling requests and durable task/run records. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Stable native scheduled-task identity. */
export type AutomationTaskId = Branded<'AutomationTaskId'>
/** Stable native task execution identity. */
export type AutomationRunId = Branded<'AutomationRunId'>
/** Active account lifetime sampled by the Host. */
export interface AutomationAccountIdentity { readonly accountId: string; readonly epoch: number }
/** One user-supplied timing rule, before normalization. */
export type AutomationTimingInput =
  | { readonly kind: 'once'; readonly at: string }
  | { readonly kind: 'delay'; readonly seconds: number }
  | { readonly kind: 'interval'; readonly seconds: number; readonly firstAt?: string }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly timeZone: string; readonly weekdays: readonly number[] }
  | { readonly kind: 'cron'; readonly expression: string; readonly timeZone: string }
/** Persisted normalized timing; interval anchors retain their accepted phase. */
export type AutomationTiming =
  | { readonly kind: 'once'; readonly at: string }
  | { readonly kind: 'delay'; readonly seconds: number; readonly anchorAt: string; readonly at: string }
  | { readonly kind: 'interval'; readonly seconds: number; readonly firstAt: string; readonly anchorAt: string }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly timeZone: string; readonly weekdays: readonly number[] }
  | { readonly kind: 'cron'; readonly expression: string; readonly timeZone: string }
/** Complete explicit user task definition; provider and credentials remain Host-owned. */
export interface AutomationDraft {
  readonly name: string
  readonly instruction: string
  readonly workspaceId: WorkspaceId
  readonly modelId: string
  readonly reasoningEffort: string | null
  readonly timing: AutomationTimingInput
}
/** Immutable execution definition captured when a run is claimed. */
export interface AutomationSnapshot {
  readonly name: string
  readonly instruction: string
  readonly workspaceId: WorkspaceId
  readonly modelId: string
  readonly reasoningEffort: string | null
  readonly timing: AutomationTiming
}
/** UI execution outcome; waiting includes both approvals and user questions. */
export type AutomationRunState = 'reserved' | 'running' | 'waiting-approval' | 'stopping' | 'succeeded' | 'failed' | 'canceled' | 'interrupted' | 'unknown' | 'blocked' | 'skipped'
/** One durable scheduled/manual execution interval. */
export interface AutomationRun {
  readonly id: AutomationRunId
  readonly taskId: AutomationTaskId
  readonly trigger: 'scheduled' | 'catch-up' | 'manual'
  readonly scheduledAt: string | null
  readonly requestedAt: string
  readonly requestId: string | null
  readonly definitionRevision: number
  readonly snapshot: AutomationSnapshot
  readonly sessionId: SessionId | null
  readonly sessionCreated: boolean
  readonly state: AutomationRunState
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly reason: { readonly code: string; readonly message: string } | null
  readonly ownerRuntimeId: string
  readonly inputMessageId: string | null
  readonly startLogOffset: number | null
  readonly endLogOffset: number | null
  readonly terminalTurn: number | null
  readonly interactionIds: readonly string[]
  readonly humanIntervened: boolean
}
/** Idempotent completed management operation receipt, retained separately from run history. */
export interface AutomationReceipt {
  readonly requestId: string
  readonly digest: string
  readonly acceptedAt: number
  readonly expiresAt: number
  readonly result: { readonly taskId: AutomationTaskId; readonly runId: AutomationRunId | null; readonly deleted: boolean }
}
/** One atomic durable aggregate; no task/run cross-table transaction is required. */
export interface AutomationTask {
  readonly id: AutomationTaskId
  readonly ownerAccountId: string
  readonly revision: number
  readonly recordVersion: number
  readonly authorizationRevision: number
  readonly consentRevision: number
  readonly ruleRevision: number
  readonly definition: AutomationSnapshot
  readonly enabled: boolean
  readonly deletedAt: string | null
  readonly nextOccurrenceAt: string | null
  readonly occurrenceWatermark: { readonly ruleRevision: number; readonly at: string } | null
  readonly pendingOccurrence: { readonly at: string; readonly from: string; readonly ruleRevision: number } | null
  readonly activeRunId: AutomationRunId | null
  readonly runs: readonly AutomationRun[]
  readonly requestReceipts: readonly AutomationReceipt[]
  readonly creationRequest: { readonly requestId: string; readonly digest: string }
  readonly historyPruned: boolean
  readonly skippedRange: { readonly from: string; readonly through: string; readonly reason: string } | null
  readonly createdAt: string
  readonly updatedAt: string
}
/** Typed management action, used by both GUI and chat producers. */
export type AutomationOperation =
  | { readonly action: 'create'; readonly draft: AutomationDraft }
  | { readonly action: 'update'; readonly id: AutomationTaskId; readonly expectedRevision: number; readonly draft: AutomationDraft }
  | { readonly action: 'pause' | 'resume' | 'remove' | 'purgeDeleted'; readonly id: AutomationTaskId; readonly expectedRevision: number }
  | { readonly action: 'run'; readonly id: AutomationTaskId; readonly expectedRevision: number }
  | { readonly action: 'stop'; readonly id: AutomationTaskId; readonly runId: AutomationRunId }
/** Host-issued request identity and user-only confirmation challenge. */
export interface AutomationPreparedOperation {
  readonly requestId: string
  readonly confirmationId: string | null
  readonly requiresConfirmation: boolean
  readonly summary: string
  readonly expiresAt: number
}
/** GUI confirmation carrying no model-supplied authorization boolean. */
export interface AutomationCommitRequest { readonly requestId: string; readonly confirmationId: string | null }
/** Durable mutation response; a runId acknowledges admission, not execution success. */
export interface AutomationMutationResult {
  readonly task: AutomationTask | null
  readonly taskId: AutomationTaskId
  readonly runId: AutomationRunId | null
  readonly deleted: boolean
}
/** Preview of the normalized rule before user confirmation. */
export interface AutomationPreview { readonly draft: AutomationDraft; readonly nextOccurrences: readonly string[] }
/** Page query scoped to the active account. */
export interface AutomationListRequest { readonly limit?: number; readonly cursor?: string; readonly search?: string; readonly status?: 'all' | 'enabled' | 'paused' | 'deleted' }
/** One authoritative task page. */
export interface AutomationTaskPage { readonly tasks: readonly AutomationTask[]; readonly nextCursor: string | null }
/** Task detail identity. */
export interface AutomationGetRequest { readonly id: AutomationTaskId }
/** Bounded execution history query. */
export interface AutomationRunsRequest { readonly id: AutomationTaskId; readonly limit: number; readonly before?: AutomationRunId }
/** One execution page plus truthful retention status. */
export interface AutomationRunsPage { readonly records: readonly AutomationRun[]; readonly nextBefore: AutomationRunId | null; readonly historyPruned: boolean }
/** Host-approved form selections, with no private credentials. */
export interface AutomationChoices {
  readonly accountId: string
  /** Read-only installation legacy-store detection; never includes old task content. */
  readonly legacyScheduleStatus: 'none' | 'present' | 'unreadable'
  readonly workspaces: readonly { readonly id: WorkspaceId; readonly name: string; readonly path: string }[]
  readonly models: readonly { readonly id: string; readonly name: string; readonly reasoningEfforts: readonly string[] }[]
  readonly defaultModelId: string | null
}
/** Validated deployment limits used by management and execution. */
export interface AutomationLimits {
  readonly maxConcurrent: number
  readonly runTimeoutMs: number
  readonly historyDays: number
  readonly historyRecords: number
  readonly historyBytes: number
  readonly receiptDays: number
  readonly receiptRecords: number
  readonly receiptBytes: number
  readonly maxTaskBytes: number
  readonly maxTasksPerAccount: number
  readonly maxTasks: number
  readonly maxInstructionChars: number
  readonly maxInstructionBytes: number
  readonly confirmationTimeoutMs: number
}
/** No-content lifecycle inspection used by quit and installed updates. */
export interface AutomationLifecycle { readonly armed: boolean; readonly active: boolean }
