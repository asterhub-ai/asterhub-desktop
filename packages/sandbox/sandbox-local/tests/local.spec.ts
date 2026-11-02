/**
 * LocalSandboxProvider tests for the Windows ACL runner and custom runnerCommand.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SANDBOX_UNAVAILABLE, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { Config } from '@deepseek-ai/dsh-sandbox-local'

const RO: SandboxPolicy = { mode: 'read-only', workspaceRoot: '/ws' }
const WW: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: '/ws' }

/** Every temp dir created by this file (fake launchers and runner entries), removed after each test. */
const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup(config: Config = {}, internals: LocalSandboxProvider['internals'] = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, config)
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = internals
  return { ctx, sandbox }
}

/**
 * A path inside a fresh temp dir where no file is written, pinning the
 * built-entry `existsSync` check to false. Without it the resolution depends on
 * whether the checkout has run `build:lib:host`, which emits
 * `sandbox-windows-acl/lib/runner.js`.
 */
function absentRunnerEntry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-absent-acl-entry-'))
  tempDirs.push(dir)
  return join(dir, 'runner.js')
}

describe('runnerCommand config', () => {
  it('forwards read-only and workspace-write policy flags before -- delimiter', async () => {
    const { sandbox } = await setup({
      runnerCommand: ['fake-runner', '--flag'],
      runnerFailureSignatures: ['fake-runner: profile rejected'],
    })

    const readOnly = await sandbox.confine(['cmd', '/c', 'dir'], RO)
    expect(readOnly).toEqual({
      argv: ['fake-runner', '--flag', '--workspace', '/ws', '--temp', tmpdir(), '--mode', 'read-only', '--', 'cmd', '/c', 'dir'],
      enforcement: 'full',
      denialSignatures: ['access is denied', 'access to the path', 'permission denied', 'operation not permitted'],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: profile rejected'] }],
    })

    const workspaceWrite = await sandbox.confine(['tool', 'run'], WW)
    expect(workspaceWrite).toEqual({
      argv: ['fake-runner', '--flag', '--workspace', '/ws', '--temp', tmpdir(), '--mode', 'workspace-write', '--', 'tool', 'run'],
      enforcement: 'full',
      denialSignatures: ['access is denied', 'access to the path', 'permission denied', 'operation not permitted'],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: profile rejected'] }],
    })
  })

  it('an EMPTY runnerCommand means unconfigured: the platform chain still gates the wrap', async () => {
    const { sandbox } = await setup({ runnerCommand: [] }, { platform: 'freebsd' })
    await expect(sandbox.confine(['true'], RO)).rejects.toThrow(SandboxUnavailableError)
  })

  it('requires an operator-owned failure dialect for every configured runner', async () => {
    await expect(setup({ runnerCommand: ['fake-runner'] })).rejects.toThrow(
      'runnerCommand requires at least one runnerFailureSignatures entry',
    )
  })

  it('rejects runner failure signatures when no custom runner consumes them', async () => {
    await expect(setup({ runnerFailureSignatures: ['profile rejected'] })).rejects.toThrow(
      'runnerFailureSignatures requires runnerCommand',
    )
  })

  it.each(['  ', 'fatal\ncontinued', 'fatal\rcontinued'])(
    'rejects an unusable configured-runner failure signature %j',
    async (signature) => {
      await expect(setup({ runnerCommand: ['fake-runner'], runnerFailureSignatures: [signature] })).rejects.toThrow(
        'runnerFailureSignatures entries must be non-empty single-line strings',
      )
    },
  )
})

describe('the platform chains', () => {
  it('a platform with no chain fails closed without running the command', async () => {
    const { sandbox } = await setup({}, { platform: 'freebsd' })
    await expect(sandbox.confine(['true'], RO)).rejects.toThrow(expect.objectContaining({ name: 'SandboxUnavailableError', code: SANDBOX_UNAVAILABLE }))
  })

  it('caches the verdict for the provider lifetime: one chain walk across wraps', async () => {
    const { sandbox } = await setup({}, { platform: 'win32' })
    const first = await sandbox.confine(['true'], RO)
    const second = await sandbox.confine(['true'], WW)
    expect(first.enforcement).toBe('partial')
    expect(second.enforcement).toBe('partial')
  })

  it('the unavailable verdict is cached too, and the error is structured', async () => {
    const { sandbox } = await setup({}, { platform: 'unsupported-os' })
    await expect(sandbox.confine(['true'], RO)).rejects.toThrow(expect.objectContaining({ name: 'SandboxUnavailableError', code: SANDBOX_UNAVAILABLE }))
    await expect(sandbox.confine(['true'], RO)).rejects.toThrow(SandboxUnavailableError)
  })

  it('a rogue chain entry throws via the exhaustiveness guard (closed union)', async () => {
    const { sandbox } = await setup({}, { chain: ['chroot'] as unknown as readonly ['windows-acl'] })
    await expect(sandbox.confine(['true'], RO)).rejects.toThrow('unreachable variant')
  })

  it('a rogue cached runner tag throws via the exhaustiveness guard (closed union)', async () => {
    const { sandbox } = await setup()
    ;(sandbox as unknown as { selectedRunner: unknown }).selectedRunner = { runner: 'chroot', enforcement: 'full' }
    await expect(sandbox.confine(['true'], RO)).rejects.toThrow('unreachable variant')
  })

  it('walks the real platform chain when nothing is injected (usable on Windows or fails closed elsewhere)', async () => {
    const { sandbox } = await setup({}, {})
    const verdict = await (async () => {
      try {
        await sandbox.confine(['true'], RO)
        return 'usable'
      } catch (error: unknown) {
        if (error instanceof SandboxUnavailableError) return 'unavailable'
        throw error
      }
    })()
    expect(['usable', 'unavailable']).toContain(verdict)
  })
})

describe('probeTimeoutMs config', () => {
  it('rejects 0 at construction: Node treats a 0 spawnSync timeout as UNBOUNDED, the opposite of the field', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(LocalSandboxProvider, { probeTimeoutMs: 0 }))
      .rejects.toThrow(/probeTimeoutMs must be a positive finite number/)
  })
})

describe('the windows-acl runner (invocation contract)', () => {
  it('refuses unsupported extra grants before a Windows runner or ACL mutation', async () => {
    const { ctx, sandbox } = await setup({}, {
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
    })
    try {
      await expect(sandbox.confine(['true'], { ...WW, additionalWritableRoots: ['/extra'] }))
        .rejects.toThrow('Windows ACL confinement does not support additional writable directories')
      await expect(sandbox.confine(['true'], { ...RO, additionalWritableRoots: ['/extra'] })).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('selects the windows-acl runner, speaking the ACL dialect', async () => {
    const { sandbox } = await setup({}, {
      chain: ['windows-acl'],
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
    })
    const confined = await sandbox.confine(['true'], RO)
    expect(confined.argv.slice(-4)).toEqual(['--mode', 'read-only', '--', 'true'])
    expect(confined.enforcement).toBe('partial')
    expect(confined.denialSignatures).toEqual(['access is denied', 'access to the path', 'permission denied', 'operation not permitted'])
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
  })

  it('falls back to the runner source through tsx when the built entry is absent', async () => {
    const { sandbox } = await setup({}, {
      chain: ['windows-acl'],
      windowsAclRunnerEntry: absentRunnerEntry(),
    })
    const confined = await sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual([process.execPath, '--import'])
    expect(confined.argv[2]).toMatch(/^data:text\/javascript,/)
    expect(confined.argv[3]).toMatch(/runner\.ts$/)
  })

  it('loads the full source runner independently of cwd and ambient tsconfig', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-acl-source-cwd-'))
    tempDirs.push(cwd)
    writeFileSync(join(cwd, 'tsconfig.json'), '{ invalid workspace configuration')
    const { sandbox } = await setup({}, {
      chain: ['windows-acl'],
      windowsAclRunnerEntry: absentRunnerEntry(),
    })
    const { argv } = await sandbox.confine(['true'], RO)
    for (const ambientConfig of [undefined, join(cwd, 'absent-ambient-tsconfig.json')]) {
      const result = spawnSync(argv[0]!, argv.slice(1, 4), {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, NODE_OPTIONS: undefined, TSX_TSCONFIG_PATH: ambientConfig },
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.stderr).toBe(127)
      expect(result.stderr).toBe('windows-acl-run: missing --workspace\n')
    }
  }, 10_000)

  it('prefers the built lib/runner.js entry when the resolved file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fake-acl-entry-'))
    tempDirs.push(dir)
    const builtEntry = join(dir, 'runner.js')
    writeFileSync(builtEntry, '')
    const { sandbox } = await setup({}, {
      chain: ['windows-acl'],
      windowsAclRunnerEntry: builtEntry,
    })
    const confined = await sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual([process.execPath, builtEntry])
  })
})
