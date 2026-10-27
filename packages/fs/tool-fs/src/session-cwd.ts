/**
 * Resolve the current execution directory for an agent call without changing
 * the immutable session header. Agentless calls keep the provider's default.
 * @module @deepseek-ai/dsh-tool-fs/session-cwd
 */

import type {} from '@deepseek-ai/dsh-session/cwd'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
/** @param exec - tool context. @returns current session cwd or undefined for agentless calls. */
export function sessionCwd(exec: ToolExecution): string | undefined {
  const agent = exec.agent
  if (agent === undefined) return undefined
  const sessionCwd = agent.ctx.get('sessionCwd', false)
  if (sessionCwd !== undefined) {
    const cwd = sessionCwd.resolve(agent.session.header)
    if (cwd === undefined) throw new Error(`Session ${agent.session.id} has no current execution directory`)
    return cwd
  }
  return agent.options.cwd ?? agent.session.header.cwd
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * A sandbox policy root is authoritative for mutations and must not be
 * replaced by a stale or conflicting session value.
 */
export function sessionResolveOptions(
  exec: ToolExecution,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
