import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureProjectGitExclusion } from '../src/git-exclusion.ts'

const run = promisify(execFile)
const roots: string[] = []
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'project-git-'))
  roots.push(path)
  return path
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function git(cwd: string, ...args: string[]): Promise<void> { await run('git', ['-C', cwd, ...args]) }

describe('project Git exclusion', () => {
  it('protects a project in root/nested repositories and preserves CRLF ignore content', async () => {
    const repo = await temp(), project = join(repo, 'nested')
    await git(repo, 'init', '-q')
    await mkdir(project)
    const original = '# keep\r\n*.log\r\n'
    await writeFile(join(project, '.gitignore'), original)
    await ensureProjectGitExclusion(project)
    expect(await readFile(join(project, '.gitignore'), 'utf8')).toBe(`${original}.aster/\r\n`)
    await mkdir(join(project, '.aster'))
    await writeFile(join(project, '.aster', 'private.json'), '{}')
    await git(repo, 'add', '-A')
    const staged = (await run('git', ['-C', repo, 'ls-files'])).stdout
    expect(staged).not.toContain('.aster/')
  })

  it('works for linked worktrees and repositories initialized after the project', async () => {
    const repo = await temp(), project = join(repo, 'project')
    await mkdir(project)
    await expect(ensureProjectGitExclusion(project)).resolves.toMatchObject({ kind: 'not-git' })
    await git(repo, 'init', '-q')
    await writeFile(join(repo, 'initial'), 'repo')
    await git(repo, 'add', 'initial')
    await git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial')
    const linked = join(await temp(), 'worktree')
    await git(repo, 'worktree', 'add', '-qb', 'linked', linked)
    await ensureProjectGitExclusion(linked)
    await mkdir(join(linked, '.aster'))
    await writeFile(join(linked, '.aster', 'private'), 'data')
    await git(linked, 'add', '-A')
    expect((await run('git', ['-C', linked, 'ls-files'])).stdout).not.toContain('.aster/')
  })

  it('reports already tracked private files without untracking them', async () => {
    const repo = await temp()
    await git(repo, 'init', '-q')
    await mkdir(join(repo, '.aster'))
    await writeFile(join(repo, '.aster', 'private'), 'keep')
    await git(repo, 'add', '.aster/private')
    const result = await ensureProjectGitExclusion(repo)
    expect(result.kind).toBe('tracked-data')
    expect(result.trackedPaths).toContain('.aster/private')
    expect((await run('git', ['-C', repo, 'ls-files'])).stdout).toContain('.aster/private')
  })
})
