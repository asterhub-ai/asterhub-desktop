import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as AsterHubSkills from '../src/index.ts'

describe('dsh-asterhub-skills', () => {
  it('discovers and loads the packaged skills from the bundled resource root', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(AsterHubSkills)
    const resourceRoot = fileURLToPath(new URL('../assets/', import.meta.url))

    const catalog = await ctx.skills.list()
    expect(catalog.map(skill => [skill.name, skill.provider, skill.source, skill.resourceBase])).toEqual([
      ['asterhub-rpc-cross-review', 'asterhub-bundled', 'bundled', { kind: 'directory', path: join(resourceRoot, 'asterhub-rpc-cross-review') }],
      ['asterhub-rpc-dev', 'asterhub-bundled', 'bundled', { kind: 'directory', path: join(resourceRoot, 'asterhub-rpc-dev') }],
    ])

    for (const name of ['asterhub-rpc-dev', 'asterhub-rpc-cross-review']) {
      const loaded = await ctx.skills.get(name)
      expect(loaded?.content).toContain('## ')
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(resourceRoot, name) })
      const source = await readFile(new URL(`../assets/${name}/SKILL.md`, import.meta.url), 'utf8')
      expect(loaded?.content).toBe(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim())
      for (const reference of ['rpc-control.md', 'session-record.md']) {
        expect(source).toContain(`references/${reference}`)
        await expect(readFile(new URL(`../assets/${name}/references/${reference}`, import.meta.url), 'utf8')).resolves.toContain('# ')
      }
    }

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })
})
