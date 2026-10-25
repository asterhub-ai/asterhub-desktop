/** Exercise the local provider with Electron's real OS cipher across process restarts. */
import { app, safeStorage } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// This e2e only exercises safeStorage and never needs the GPU; in a GPU-less service context a failed GPU process makes Chromium FATAL-exit (0x80000003).
app.disableHardwareAcceleration()
// The service context cannot spawn a GPU subprocess at all (error_code=18), so run the GPU in-process to eliminate subprocess creation.
app.commandLine.appendSwitch('in-process-gpu')

async function main() {
  const [providerModule, root, phase] = process.argv.slice(2)
  app.setPath('userData', join(root, 'electron'))
  await app.whenReady()
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable')
    if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) {
      throw new Error('OS password manager unavailable')
    }
    ctx.provide('credentialCipher', {
      encrypt: async value => safeStorage.encryptString(value).toString('base64'),
      decrypt: async value => safeStorage.decryptString(Buffer.from(value, 'base64')),
    })
    const { LocalCredentialProvider } = await import(pathToFileURL(providerModule).href)
    const path = join(root, '.credentials.yaml')
    await ctx.plugin(LocalCredentialProvider, { path, encrypted: true, watch: false })
    const secret = 'qualification-only-login-token'
    const key = 'asterhub-account/session'
    if (phase === 'write') {
      await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { accessToken: secret } }))
    }
    const stored = await readFile(path, 'utf8')
    const record = await ctx.credentials.readRecord(key)
    if (!stored.startsWith('asterhub-credentials:v1:') || stored.includes(secret)
      || record?.kind !== 'grant' || record.payload.accessToken !== secret) throw new Error('credential round trip failed')
    console.log(`CREDENTIAL_STORAGE_RESULT ${phase}`)
  } finally {
    await ctx.fiber.dispose()
    app.quit()
  }
}

main().catch(error => { console.error(error); app.exit(1) })
