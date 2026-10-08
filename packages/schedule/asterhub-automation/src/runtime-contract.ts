/** Host integration supplied to the timer/execution owner by task management. */
import type { Context } from '@deepseek-ai/cordis'
import type { AutomationAccountIdentity, AutomationLimits, AutomationTask } from './types.ts'

/** Management and runtime share the same durable operation queue and task aggregates. */
export interface AutomationRuntimeHost {
  readonly ctx: Context
  /** Exact startup owner shared by manual and timer-created reservations. */
  readonly runtimeId: string
  readonly limits: AutomationLimits
  readonly tasks: () => readonly AutomationTask[]
  readonly identity: () => Promise<AutomationAccountIdentity | null>
  readonly transact: <T>(work: () => Promise<T>) => Promise<T>
  readonly put: (task: AutomationTask) => Promise<void>
  readonly emitChanged: () => void
}
