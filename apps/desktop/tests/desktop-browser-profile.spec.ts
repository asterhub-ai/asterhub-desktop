import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadProfileDirectory, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import DesktopBrowserProvider from '@deepseek-ai/dsh-browser-use-desktop'
import { createPluginProfile } from '../src/project-manager.ts'

describe('Desktop browser profile composition', () => {
  it('includes browser-use and browser-use-desktop in the composed Desktop profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-browser-'))
    try {
      const profileDir = join(home, 'profiles', 'desktop')
      createPluginProfile(profileDir)
      const installAnchor = fileURLToPath(new URL('../../desktop-host/package.json', import.meta.url))
      const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
      const warnings: string[] = []
      const rows = composeEntries([
        ...profile.layers.map(layer => layer.patches),
        profile.patches,
      ], message => warnings.push(message))
      const browserUseRow = rows.find(row => row.id === 'browser-use')
      expect(browserUseRow).toBeDefined()
      expect(browserUseRow?.name).toBe('@deepseek-ai/dsh-browser-use')

      const desktopProviderRow = rows.find(row => row.id === 'browser-use-desktop')
      expect(desktopProviderRow).toBeDefined()
      expect(desktopProviderRow?.name).toBe('@deepseek-ai/dsh-browser-use-desktop')
      expect(desktopProviderRow?.config).toMatchObject({
        operationTimeoutMs: 3000,
        navigationTimeoutMs: 30000,
        snapshotMaxChars: 50000,
        readResultMaxChars: 50000,
      })
      expect(warnings).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('excludes browser-use-desktop from non-desktop profile templates', () => {
    for (const [name, template] of Object.entries(PROFILE_TEMPLATES)) {
      if (name === 'desktop') continue
      for (const bundle of template.bundles) {
        expect(bundle).not.toBe('@deepseek-ai/dsh-asterhub-desktop-native')
        expect(bundle).not.toBe('@deepseek-ai/dsh-browser-use-desktop')
      }
    }
  })

  it('discovers 8 browser tools and 2 bundled skills in desktop environment', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(BrowserUseRegistry)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SkillRegistry)

    const transport = {
      request: vi.fn(),
      releaseOwner: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    }

    const attachments = {
      saveImage: vi.fn(),
      imageLimits: {
        maxImageBytes: 10_000_000,
        maxImagesPerMessage: 10,
        maxMessageImageBytes: 20_000_000,
        maxImagePixels: 100_000_000,
        maxImageDimension: 10_000,
        mediaTypes: ['image/png'],
      },
    }

    const agents = {
      get: vi.fn(),
      list: vi.fn(() => []),
    }

    ctx.provide('desktopBrowserTransport', transport as never)
    ctx.provide('attachments', attachments as never)
    ctx.provide('agents', agents as never)

    const fiber = await ctx.plugin(DesktopBrowserProvider, {
      operationTimeoutMs: 3000,
      navigationTimeoutMs: 30000,
      snapshotMaxChars: 50000,
      readResultMaxChars: 50000,
    })
    await fiber

    // Check tools discovery
    const toolNames = ctx.tools.schemas().map(t => t.name)
    expect(toolNames).toContain('browser_tabs')
    expect(toolNames).toContain('browser_open')
    expect(toolNames).toContain('browser_close')
    expect(toolNames).toContain('browser_snapshot')
    expect(toolNames).toContain('browser_read')
    expect(toolNames).toContain('browser_act')
    expect(toolNames).toContain('browser_wait')
    expect(toolNames).toContain('browser_screenshot')
    expect(toolNames.length).toBe(8)

    // Check skills discovery
    const skillList = await ctx.skills.list()
    const skillNames = skillList.map(s => s.name)
    expect(skillNames).toContain('control-browser')
    expect(skillNames).toContain('web-gui-tester')

    // Check replacement / duplicate behavior
    expect(() => ctx.browserUse.register(BrowserUseProviderName('external-mcp'))).toThrow(
      'browser use provider "desktop-internal" is already registered',
    )

    await fiber.dispose()
    expect(ctx.browserUse.providerName).toBeUndefined()

    // After disposal, replacement provider can register
    const disposeExternal = ctx.browserUse.register(BrowserUseProviderName('external-mcp'))
    expect(ctx.browserUse.providerName).toBe('external-mcp')
    await disposeExternal()
  })
})
