import { writeFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { packageTarget, parseDesktopPackageInvocation } from '../scripts/package-target.ts'
import { withWindowsSigningStage } from '../scripts/windows-signing-stage.mjs'
import { prepareWindowsSignatureCacheDirectory } from '../scripts/windows-signature-cache-directory.mjs'


vi.mock('../scripts/windows-signing-stage.mjs', () => ({
  withWindowsSigningStage: vi.fn(async (_options: object, operation: () => Promise<void>) => operation()),
}))
vi.mock('../scripts/windows-signature-cache-directory.mjs', () => ({
  prepareWindowsSignatureCacheDirectory: vi.fn(async () => {}),
  resolveWindowsSignatureCacheDirectory: vi.fn(() => 'C:\\fixture-cache'),
}))

// Keep the real orchestration and manifest reads; this suite owns no release directories or subprocesses.
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  rmSync: vi.fn(), mkdirSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(),
}))

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

const environment = { DSH_DESKTOP_APP_ID: 'com.example.test', DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
  DOWNLOAD_TEST_ORIGIN: 'https://updates.example.com', DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef',
  DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'fixture-pin', DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY: '2' }

function supervisor(failure?: string) {
  vi.stubEnv('npm_execpath', 'fixture-pnpm.cjs')
  const stages: string[] = []
  const run = { directory: 'fixture-record', finish: vi.fn(),
    run: vi.fn(async (stage: string, _executable: string, _args: readonly string[], _options: { env: NodeJS.ProcessEnv }) => {
      stages.push(stage)
      if (failure !== undefined && (stage === failure || stage.startsWith(`${failure} `))) throw new Error('stage refused')
    }) }
  return { run, stages }
}



it('requires one signing preflight before building, then records only the complete release', async () => {
  const { run, stages } = supervisor()
  await packageTarget(parseDesktopPackageInvocation(['win-x64'], 'win32', 'x64'), environment, run)
  expect(stages.slice(0, 2)).toEqual(['preflight:windows-signing', 'run build:official'])
  expect(stages.filter(stage => stage === 'preflight:windows-signing')).toHaveLength(1)
  expect(vi.mocked(withWindowsSigningStage).mock.calls.map(([options]) => options.stage))
    .toEqual(['preflight', 'artifacts'])
  expect(run.run.mock.calls[0]![3]).toMatchObject({ env: { DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'fixture-pin' }, timeoutMs: 60_000 })
  expect(run.run.mock.calls[1]![3].env).not.toHaveProperty('DSH_DESKTOP_WINDOWS_TOKEN_PIN')
  expect(stages.indexOf('run sign:primary-runtime --dsh')).toBeGreaterThan(stages.indexOf('run prepare:dsh --defer-runtime-smoke'))
  expect(stages).toContain('--filter @deepseek-ai/dsh-anima-memory run prepare:desktop-runtime')
  for (const directory of ['vendor/anima-protocol', 'vendor/anima-capture', 'vendor/anima-memory']) {
    expect(stages.some(stage => stage.startsWith(`--dir ${directory} pack --pack-destination `))).toBe(true)
  }
  const animaRuntimeCall = run.run.mock.calls.find(([command]) => command.includes('prepare:desktop-runtime'))
  expect(animaRuntimeCall?.[3].env).toMatchObject({
    DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64',
  })
  expect(animaRuntimeCall?.[3].env.DSH_ANIMA_RUNTIME_DESTINATION).toContain('targets\\win-x64\\anima-runtime')
  expect(stages.at(-1)).toBe('exec tsx scripts/smoke-packaged-runtime.ts')
  for (const call of run.run.mock.calls) {
    if (call[0].startsWith('run prepare:') || call[0].includes('smoke-packaged-runtime')) {
      expect(call[3].env).not.toHaveProperty('DSH_DESKTOP_WINDOWS_TOKEN_PIN')
      expect(call[3].env).not.toHaveProperty('DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY')
    }
    if (call[0].startsWith('run sign:primary-runtime')) {
      expect(call[3].env).toHaveProperty('DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_CONCURRENCY', '2')
    }
  }
  expect(writeFileSync).toHaveBeenCalledOnce()
  const record = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string) as { publicUrl: string }
  expect(record.publicUrl).toBe('https://updates.example.com/dsh-desk/0123456789abcdef0123456789abcdef/feeds/win-x64/')
})

it('initializes shared storage only after acquiring the preflight stage lock', async () => {
  const { run } = supervisor()
  vi.mocked(withWindowsSigningStage).mockImplementationOnce(async (_options, operation) => {
    expect(prepareWindowsSignatureCacheDirectory).not.toHaveBeenCalled()
    await operation()
    expect(prepareWindowsSignatureCacheDirectory).toHaveBeenCalledOnce()
  })
  await packageTarget(parseDesktopPackageInvocation(['win-x64'], 'win32', 'x64'), environment, run)
})

it.each(['preflight:windows-signing', 'run build:official', 'run sign:primary-runtime', 'run prepare:dsh --defer-runtime-smoke', 'run sign:primary-runtime --dsh',
  'exec tsx scripts/smoke-packaged-runtime.ts',
  'exec electron-builder --config electron-builder.config.mjs --win --x64 --publish never'])
('never continues or records a release after %s fails', async (failure) => {
  const { run, stages } = supervisor(failure)
  await expect(packageTarget(parseDesktopPackageInvocation(['win-x64'], 'win32', 'x64'), environment, run)).rejects.toThrow('stage refused')
  expect(stages.at(-1)).toBe(failure)
  expect(stages.filter(stage => stage === failure)).toHaveLength(1)
  expect(writeFileSync).not.toHaveBeenCalled()
})

it.each(['--unsigned', '--prepare-only'])('keeps %s hardware-free and creates no release record', async (mode) => {
  const { run, stages } = supervisor()
  await packageTarget(parseDesktopPackageInvocation(['win-x64', mode], 'win32', 'x64'), environment, run)
  expect(stages[0]).toBe(mode === '--unsigned' ? 'run build --profile local' : 'run build:official')
  expect(stages).not.toContain('preflight:windows-signing')
  expect(stages).not.toContain('run sign:primary-runtime')
  expect(stages).not.toContain('run sign:primary-runtime --dsh')
  expect(withWindowsSigningStage).not.toHaveBeenCalled()
  for (const call of run.run.mock.calls) expect(call[3].env).not.toHaveProperty('DSH_DESKTOP_WINDOWS_TOKEN_PIN')
  expect(writeFileSync).not.toHaveBeenCalled()
  expect(stages.includes('exec tsx scripts/smoke-packaged-runtime.ts --unsigned')).toBe(mode === '--unsigned')
})
