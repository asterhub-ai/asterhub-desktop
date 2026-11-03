import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as atomic from '@deepseek-ai/dsh-atomic-write'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { DesktopSettingsFile } from '../src/settings-file.ts'
import { readDesktopSettings } from '../src/settings.ts'

vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }))
vi.mock('@deepseek-ai/dsh-atomic-write', async original => ({ ...await original<typeof import('@deepseek-ai/dsh-atomic-write')>() }))
afterEach(() => { vi.restoreAllMocks() })

async function fixture(raw?: string) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-settings-file-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const file = new DesktopSettingsFile(root)
  if (raw !== undefined) {
    await mkdir(dirname(file.path))
    await writeFile(file.path, raw)
  }
  return { root, file }
}

it('distinguishes missing files from absent fields without creating a file during reads', async () => {
  const { file } = await fixture()
  expect(await file.read()).toEqual({ kind: 'missing' })
  await expect(readFile(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  await file.saveUpdates({})
  expect(await file.read()).toMatchObject({ kind: 'ready', fields: {
    allowTestAuthPopupWindow: { kind: 'absent' },
  } })
})

it.each([
  ['{secret-value', 'json'], ['null', 'structure'], ['[]', 'structure'],
  ['{"updates":null}', 'structure'], ['{"updates":[]}', 'structure'], ['{"updates":true}', 'structure'],
])('classifies malformed documents and refuses to replace them: %s', async (raw, reason) => {
  const { file } = await fixture(raw)
  const result = await file.initialize()
  expect(result).toMatchObject({ kind: 'error', error: { problem: { kind: 'invalid', reason }, path: file.path } })
  expect(JSON.stringify(result)).not.toContain('secret-value')
  await expect(file.saveUpdates({ allowTestAuthPopupWindow: true })).rejects.toMatchObject({ problem: { kind: 'invalid', reason } })
  expect(await readFile(file.path, 'utf8')).toBe(raw)
})

it('keeps an invalid popup preference independent from unrelated fields and repairs only the selected field', async () => {
  const { root, file } = await fixture('{"other":[1],"updates":{"channel":"alpha","allowTestAuthPopupWindow":"bad","future":{"x":2}}}')
  expect(await file.read()).toMatchObject({ kind: 'ready', fields: {
    allowTestAuthPopupWindow: { kind: 'invalid', error: { problem: { kind: 'invalid', reason: 'field', field: 'allowTestAuthPopupWindow' } } },
  } })
  expect((await readDesktopSettings(root)).updates.allowTestAuthPopupWindow).toBe(false)
  await file.saveUpdates({ allowTestAuthPopupWindow: true })
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ other: [1], updates: {
    channel: 'alpha', allowTestAuthPopupWindow: true, future: { x: 2 },
  } })
})

it('classifies unreadable files without attempting initialization', async () => {
  const { file } = await fixture()
  await mkdir(file.path, { recursive: true })
  expect(await file.initialize()).toMatchObject({ kind: 'error', error: { problem: { kind: 'read' } } })
  expect((await fs.stat(file.path)).isDirectory()).toBe(true)
})

it('serializes initializers and patches from separate storage instances without losing fields', async () => {
  const { root, file } = await fixture()
  const other = new DesktopSettingsFile(root)
  await Promise.all([file.initialize(), other.initialize()])
  await Promise.all([file.saveUpdates({ allowTestAuthPopupWindow: true }), other.saveUpdates({ allowTestAuthPopupWindow: false })])
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ updates: { allowTestAuthPopupWindow: false } })
  await expect(fs.access(`${file.path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('preserves a file created by an external writer during exclusive initialization', async () => {
  const { file } = await fixture()
  const original = fs.writeFile
  const external = '{"updates":{"channel":"nightly"},"external":true}'
  vi.spyOn(fs, 'writeFile').mockImplementation(async (path, contents, options) => {
    if (path === file.path) await original(path, external)
    return original(path, contents, options)
  })
  expect(await file.initialize()).toMatchObject({ kind: 'ready', fields: { allowTestAuthPopupWindow: { kind: 'absent' } } })
  expect(await readFile(file.path, 'utf8')).toBe(external)
})

it('reports preparation failure as unchanged and does not create a file', async () => {
  const { file } = await fixture()
  vi.spyOn(fs, 'mkdir').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(file.saveUpdates({ allowTestAuthPopupWindow: true })).rejects.toMatchObject({ problem: {
    kind: 'write', operation: 'save', effect: 'unchanged',
  } })
  await expect(readFile(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reports uncertain write completion without reporting a successful save', async () => {
  const { file } = await fixture('{}')
  vi.spyOn(atomic, 'writeFileAtomic').mockRejectedValue(new Error('write failed'))
  await expect(file.saveUpdates({ allowTestAuthPopupWindow: true })).rejects.toMatchObject({ problem: {
    kind: 'write', operation: 'save', effect: 'unknown',
  } })
  expect(await readFile(file.path, 'utf8')).toBe('{}')
  await expect(fs.access(`${file.path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reports a committed write when lock cleanup fails, without claiming rollback', async () => {
  const { file } = await fixture('{}')
  const original = fs.rm
  vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
    if (path === `${file.path}.lock`) throw new Error('lock cleanup failed')
    return original(path, options)
  })
  await expect(file.saveUpdates({ allowTestAuthPopupWindow: true })).rejects.toMatchObject({ problem: {
    kind: 'write', operation: 'save', effect: 'written',
  } })
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ updates: { allowTestAuthPopupWindow: true } })
})

it('reports a partial initialization write as uncertain and preserves it for diagnosis', async () => {
  const { file } = await fixture()
  const original = fs.writeFile
  vi.spyOn(fs, 'writeFile').mockImplementation(async (path, contents, options) => {
    if (path !== file.path) return original(path, contents, options)
    await original(path, '{', options)
    throw new Error('disk write interrupted')
  })
  expect(await file.initialize()).toMatchObject({ kind: 'error', error: { problem: {
    kind: 'write', operation: 'initialize', effect: 'unknown',
  } } })
  expect(await readFile(file.path, 'utf8')).toBe('{')
  expect(await file.initialize()).toMatchObject({ kind: 'error', error: { problem: { kind: 'invalid', reason: 'json' } } })
})

it('rereads fields after acquiring the writer lock instead of saving a stale snapshot', async () => {
  const { file } = await fixture('{"updates":{"allowTestAuthPopupWindow":false}}')
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const holder = atomic.withFileLock(file.path, async () => {
    started.resolve(undefined)
    await release.promise
    await writeFile(file.path, '{"updates":{"allowTestAuthPopupWindow":false,"future":3},"other":4}')
  })
  await started.promise
  const attempting = Promise.withResolvers<undefined>()
  const originalLock = atomic.withFileLock
  vi.spyOn(atomic, 'withFileLock').mockImplementation(<T>(path: string, operation: () => Promise<T>, options?: atomic.FileLockOptions): Promise<T> => {
    attempting.resolve(undefined)
    return originalLock(path, operation, options)
  })
  const save = file.saveUpdates({ allowTestAuthPopupWindow: true })
  onTestFinished(async () => { release.resolve(undefined); await Promise.allSettled([holder, save]) })
  await attempting.promise
  release.resolve(undefined)
  const outcomes = await Promise.allSettled([holder, save])
  expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ updates: { allowTestAuthPopupWindow: true, future: 3 }, other: 4 })
})
