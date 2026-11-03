import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readDesktopPublishConfig, type DesktopPublishConfig } from '../scripts/desktop-publish-config.ts'

// AsterHub is Windows-only, so only the Windows templates are adopted from upstream.
for (const preset of ['test', 'production'] as const) {
  it(`accepts the windows ${preset} template after machine paths are supplied`, async () => {
    const path = fileURLToPath(new URL(`../config/publishing/windows/${preset}.json.example`, import.meta.url))
    const template = JSON.parse(await readFile(path, 'utf8')) as DesktopPublishConfig
    expect(win32.isAbsolute(template.credentialsFile)).toBe(true)
    expect(template.windows).toBeDefined()
    expect(Object.hasOwn(template, 'secretId')).toBe(false)
    expect(Object.hasOwn(template, 'secretKey')).toBe(false)
    if (preset === 'production') expect(win32.isAbsolute(template.githubApp?.privateKeyFile ?? '')).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'publish-template-'))
    try {
      await mkdir(join(root, 'publishing'))
      // The parser uses the current host's path syntax; examples retain their target platform's paths.
      const config = { ...template, credentialsFile: join(root, 'absent-credentials.json'),
        ...(template.githubApp ? { githubApp: { ...template.githubApp, privateKeyFile: join(root, 'absent-key.pem') } } : {}) }
      const output = join(root, 'publishing', `${preset}.json`)
      await writeFile(output, JSON.stringify(config))
      await expect(readDesktopPublishConfig(root, preset)).resolves.toEqual(config)
      await writeFile(output, JSON.stringify({ ...config, bucket: undefined }))
      await expect(readDesktopPublishConfig(root, preset)).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
