/**
 * Derive the current execution root an `lsp` call resolves against. A missing
 * cwd fails as `LSP_WORKSPACE_REQUIRED` because the local provider must
 * canonicalize a real workspace before starting a server.
 * @module @deepseek-ai/dsh-tool-lsp/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'

/** @param exec - tool execution context. @returns current cwd or undefined without an agent. */
export function sessionCwd(exec: ToolExecution): string | undefined {
  const agent = exec.agent
  if (agent === undefined) return undefined
  return agent.ctx.workingDirectory.get(agent.session)
}
