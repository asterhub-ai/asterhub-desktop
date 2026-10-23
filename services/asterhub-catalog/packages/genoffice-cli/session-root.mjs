import { realpath, stat } from 'node:fs/promises'

/** Resolve the live execution root without rewriting or falling back from Session history. */
export async function resolveSessionRoot(ctx, execution) {
  const session = execution.agent?.session
  if (session === undefined) throw new Error('GenOffice requires a Session execution identity')

  const candidate = ctx.sessionCwd.resolve(session.header)
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('GenOffice has no registered project execution directory for this Session')
  }

  const root = await realpath(candidate)
  if (!(await stat(root)).isDirectory()) {
    throw new Error(`GenOffice Session execution directory is not a directory: ${root}`)
  }
  return root
}
