/**
 * Derive the current execution root an `lsp` call resolves against. A missing
 * cwd fails as `LSP_WORKSPACE_REQUIRED` because the local provider must
 * canonicalize a real workspace before starting a server.
 * @module @deepseek-ai/dsh-tool-lsp/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** @param exec - tool execution context. @returns current cwd or undefined without an agent. */
export function sessionCwd(exec: ToolExecution): string | undefined {
  const agent = exec.agent
  if (agent === undefined) return undefined
  const service = agent.ctx.get('sessionCwd', false)
  if (service !== undefined) {
    const cwd = service.resolve(agent.session.header)
    if (cwd === undefined) {
      throw new Error(`Session ${agent.session.id} has no current execution directory`)
    }
    return cwd
  }
  return agent.options.cwd ?? agent.session.header.cwd
}
