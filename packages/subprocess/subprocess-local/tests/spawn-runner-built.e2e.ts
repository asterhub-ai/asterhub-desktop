import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  runnerInvocationAvailable,
  SUBPROCESS_RUNNER_ENV,
  targetEnvironment,
} from '../src/runner-launch.ts'
import type { RunnerInvocation } from '../src/runner-launch.ts'
import { bindManagedProcess } from '../src/spawn.ts'
import { launchWindowsJob } from '../src/windows-job.ts'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const sourceRunner = resolve(repoRoot, 'packages/subprocess/subprocess-local/src/bin.ts')
const builtRunner = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-subprocess-local/runner'))

function targetEnv(): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    [SUBPROCESS_RUNNER_ENV]: 'target-collision-restored',
  }
}

async function executeWindows(invocation: RunnerInvocation): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const request: SubprocessSpawnSpec = {
    argv: [
      process.execPath,
      '--input-type=module',
      '--eval',
      `process.stdout.write(process.argv[0]+'|'+process.cwd()+'|'+process.env.${SUBPROCESS_RUNNER_ENV})`,
    ],
    cwd: repoRoot,
    env: targetEnv(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000 },
      stderr: { maxBytes: 64_000 },
    },
    graceMs: 3_000,
  }
  const handle = bindManagedProcess(request, launchWindowsJob(
    request,
    targetEnvironment(request),
    { runnerInvocation: invocation },
  ))
  const outcome = await handle.done
  await handle.waitForExit()
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  return { status: outcome.exitCode, stdout, stderr }
}

describe('subprocess-local runner artifacts', () => {
  it('executes the source entry through the provider-owned core', async () => {
    const result = await executeWindows([process.execPath, '--import', 'tsx/esm', sourceRunner])
    expect(result).toEqual({
      status: 0,
      stdout: `${process.execPath}|${repoRoot}|target-collision-restored`,
      stderr: '',
    })
  }, 30_000)

  it.skipIf(!existsSync(builtRunner))('executes the built ./runner subpath through the same core', async () => {
    const invocation: RunnerInvocation = [process.execPath, builtRunner]
    expect(runnerInvocationAvailable(invocation)).toBe(true)
    const result = await executeWindows(invocation)
    expect(result).toEqual({
      status: 0,
      stdout: `${process.execPath}|${repoRoot}|target-collision-restored`,
      stderr: '',
    })
  }, 30_000)
})
