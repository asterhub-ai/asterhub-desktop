import { execFile } from 'node:child_process'
import { lstat, open as openFile, readFile, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execute = promisify(execFile)
export interface ProjectGitExclusion {
  readonly kind: 'not-git' | 'ignored' | 'tracked-data'
  readonly trackedPaths: readonly string[]
}

/** Ensure `.aster/` is ignored and explicitly report private files already tracked by Git. */
export async function ensureProjectGitExclusion(root: string, signal?: AbortSignal): Promise<ProjectGitExclusion> {
  if (signal?.aborted) throw signal.reason
  const canonicalRoot = await realpath(root)
  const ignorePath = join(canonicalRoot, '.gitignore')
  const ignoreInfo = await lstat(ignorePath).catch((error: unknown) => { if (isMissing(error)) return undefined; throw error })
  if (ignoreInfo?.isSymbolicLink() || (ignoreInfo !== undefined && (!ignoreInfo.isFile() || ignoreInfo.nlink > 1))) {
    throw new Error('project .gitignore must be a regular, non-linked file')
  }
  let bytes = ''
  try {
    bytes = await readFile(ignorePath, 'utf8')
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
  }
  const hasRule = bytes.split(/\r?\n/).some(line => line.trim() === '.aster/' || line.trim() === '/.aster/')
  if (!hasRule) {
    const newline = bytes.includes('\r\n') ? '\r\n' : '\n'
    const prefix = bytes.length === 0 || bytes.endsWith('\n') ? '' : newline
    const handle = await openFile(ignorePath, 'a', 0o666)
    try {
      await handle.writeFile(`${prefix}.aster/${newline}`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
  if (signal?.aborted) throw signal.reason

  let gitRoot: string
  let prefix: string
  try {
    const rootResult = await execute('git', ['-C', canonicalRoot, 'rev-parse', '--show-toplevel'], { signal })
    const prefixResult = await execute('git', ['-C', canonicalRoot, 'rev-parse', '--show-prefix'], { signal })
    gitRoot = await realpath(rootResult.stdout.trim())
    prefix = prefixResult.stdout.trim().replaceAll('\\', '/')
  } catch (error: unknown) {
    if (isOutsideGit(error)) return { kind: 'not-git', trackedPaths: [] }
    throw error
  }
  const gitPath = `${prefix}.aster/`
  const listed = await execute('git', ['--literal-pathspecs', '-C', gitRoot, 'ls-files', '-z', '--', gitPath], { signal })
  const trackedPaths = listed.stdout.split('\0').filter(Boolean)
  return trackedPaths.length > 0 ? { kind: 'tracked-data', trackedPaths } : { kind: 'ignored', trackedPaths: [] }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isOutsideGit(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return false
  return String(error.stderr).includes('not a git repository')
}
