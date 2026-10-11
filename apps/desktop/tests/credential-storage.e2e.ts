/** Built provider qualification with the real Electron safeStorage implementation. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

it.skipIf(!hasDisplay)('decrypts an OS-encrypted account grant after Electron restarts', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'asterhub-cipher-'))
  try {
    await mkdir(join(root, 'electron'))
    const executable: unknown = require('electron')
    if (typeof executable !== 'string') throw new Error('Electron executable unavailable')
    const fixture = fileURLToPath(new URL('./fixtures/credential-storage-smoke.mjs', import.meta.url))
    const provider = fileURLToPath(new URL('../../../packages/credentials/credentials-local/lib/index.js', import.meta.url))
    for (const phase of ['write', 'restart']) {
      const result = await execa(executable, [fixture, provider, root, phase], {
        env: { ELECTRON_RUN_AS_NODE: undefined }, timeout: 40_000,
        forceKillAfterDelay: 5_000, reject: false, windowsHide: true,
      })
      expect(result.timedOut, result.stderr).toBe(false)
      expect(result.signal, result.stderr).toBeUndefined()
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).toContain(`CREDENTIAL_STORAGE_RESULT ${phase}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
