/** Host-owned opt-in setting for model-selectable subagent delegation. */
import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AllowedModelRouteSchema,
  assertAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User preference sampled when a new Session receives delegation tools. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether newly composed top-level Sessions receive model selection. */
  enabled: boolean
  /** Exact child LLM routes offered to newly composed top-level Sessions. */
  allowedModels: AllowedModelRoute[]
}

/** Optional deployment base for the preference. */
export interface Config {
  /** Initial enabled state inherited when the user document does not override it. */
  enabled: Volatile<boolean>
  /** Initial route list inherited when the user document does not override it. */
  allowedModels: Volatile<AllowedModelRoute[]>
  /** Zero or one default child route selected from the authenticated application catalog. Empty inherits existing defaults. */
  defaultModels: Volatile<AllowedModelRoute[]>
  /** Prefer decomposition and delegation of complex top-level tasks. */
  delegateComplexTasks: Volatile<boolean>
}

/** Singleton settings owner read when delegation tools are composed for a Session. */
export class SubagentModelSelectionConfig extends Service {
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile(),
    defaultModels: z.array(AllowedModelRouteSchema).max(1).default([]).volatile(),
    delegateComplexTasks: z.boolean().default(false).volatile(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagentModelSelection')
  }

  /** Read the default child route without exposing provider configuration.
   * @returns A detached exact route, or null to preserve tool-instance defaults.
   */
  defaultModel(): AllowedModelRoute | null {
    const routes = this.config.defaultModels.get()
    assertAllowedModelRoutes(routes)
    if (routes.length > 1) throw new Error('only one default subagent model may be configured')
    return routes[0] ? { ...routes[0] } : null
  }

  /** Read whether complex tasks should be delegated by the top-level assistant.
   * @returns The current persistent decomposition preference.
   */
  delegatesComplexTasks(): boolean {
    return this.config.delegateComplexTasks.get()
  }

  /** Read a detached selection preference for the next eligible Session composition.
   * @returns The enabled state and exact allowed routes.
   */
  current(): SubagentModelSelectionSettings {
    const enabled = this.config.enabled.get()
    const allowedModels = this.config.allowedModels.get()
    assertAllowedModelRoutes(allowedModels)
    if (enabled && allowedModels.length === 0) {
      throw new Error('enabled subagent model selection requires at least one allowed model')
    }
    return { enabled, allowedModels: allowedModels.map(route => ({ ...route })) }
  }

}

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
