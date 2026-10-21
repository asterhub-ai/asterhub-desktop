import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

function resolvePython(): string | undefined {
  if (process.env.DSH_OFFICE_TEST_PYTHON) return process.env.DSH_OFFICE_TEST_PYTHON
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return candidate
  }
  return undefined
}

const python = resolvePython()

it.skipIf(!python).each(['utf-8', 'cp1252'])('executes the shipped OOXML checker against valid, edited, and broken documents with %s stdout', (encoding) => {
  const result = spawnSync(python!, [fileURLToPath(new URL('./check_office_test.py', import.meta.url))], {
    env: { ...process.env, PYTHONIOENCODING: encoding },
    encoding: 'utf8', timeout: 30_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal, result.stderr + result.stdout).toBeNull()
  expect(result.status, result.stderr + result.stdout).toBe(0)
}, 30_000)
