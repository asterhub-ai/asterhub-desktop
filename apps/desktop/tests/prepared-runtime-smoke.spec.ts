import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { smokePreparedRuntime } from '../scripts/smoke-prepared-runtime.ts'
import { verifyDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const { payload } = vi.hoisted(() => ({ payload: vi.fn(async (..._args: unknown[]) => ({ stdout: '' })) }))
vi.mock('node:child_process', async (importOriginal) => {
  const { promisify } = await import('node:util')
  return { ...await importOriginal<typeof import('node:child_process')>(),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: payload }) }
})
vi.mock('../scripts/smoke-runtime.ts', () => ({ smokeDesktopRuntime: vi.fn(async () => {}) }))

const roots: string[] = []
const hostArch = Object.getOwnPropertyDescriptor(process, 'arch')!
afterEach(() => {
  Object.defineProperty(process, 'arch', hostArch)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

it('smokes an x64 target verified on an arm64 build host without revalidating against the host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prepared-runtime-target-'))
  roots.push(root)
  const fixture = runtimeFixture(root)
  const target = { platform: 'darwin' as const, arch: 'x64' }
  writeDesktopRuntime(root, fixture.release, fixture.sharedPackages.map(entry => entry.name), target)
  Object.defineProperty(process, 'arch', { ...hostArch, value: 'arm64' })
  await expect(verifyDesktopRuntime(root, fixture.release.version, { ...target, arch: process.arch }))
    .rejects.toThrow(/incompatible/u)
  const descriptor = await verifyDesktopRuntime(root, fixture.release.version, target)
  const electron = join(root, 'target-electron')
  const resources = join(root, 'runtime')
  await smokePreparedRuntime(root, electron, resources, descriptor)
  expect(payload).toHaveBeenCalledTimes(2)
  const [payloadNode, payloadArgs] = payload.mock.calls[0]!
  expect(payloadNode).toBe(electron)
  expect(payloadArgs).toEqual(expect.arrayContaining([root, resources]))
  const [smokeNode, smokeArgs, smokeOptions] = payload.mock.calls[1]!
  expect(smokeNode).toBe(electron)
  expect(smokeArgs).toEqual(expect.arrayContaining([
    '--import', 'tsx/esm', expect.stringContaining('smoke-runtime-entry.ts'),
    root, resources, descriptor.release.version, target.platform, target.arch,
  ]))
  expect(smokeOptions).toMatchObject({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) })
  if (typeof smokeOptions !== 'object' || smokeOptions === null || !('env' in smokeOptions)
    || typeof smokeOptions.env !== 'object' || smokeOptions.env === null
    || !('NARB_NATIVE_CACHE_DIR' in smokeOptions.env) || typeof smokeOptions.env.NARB_NATIVE_CACHE_DIR !== 'string') {
    throw new Error('prepared runtime smoke must pass its private native cache to the matching Electron runtime')
  }
  expect(existsSync(smokeOptions.env.NARB_NATIVE_CACHE_DIR)).toBe(false)
})
