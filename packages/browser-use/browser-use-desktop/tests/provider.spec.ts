import { Context } from '@deepseek-ai/cordis'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopBrowserTransport } from '../src/types.ts'
import DesktopBrowserProvider, { validateConfig, type Config } from '../src/provider.ts'

const DEFAULT_CONFIG: Config = {
  operationTimeoutMs: 3_000,
  navigationTimeoutMs: 30_000,
  snapshotMaxChars: 50_000,
  readResultMaxChars: 50_000,
}

async function makeHarness(config: Config = DEFAULT_CONFIG) {
  const ctx = new Context()
  await ctx.plugin(BrowserUseRegistry)

  const registeredTools: ToolDefinition[] = []
  const tools = {
    register: vi.fn((tool: ToolDefinition) => {
      registeredTools.push(tool)
      return () => {
        const idx = registeredTools.indexOf(tool)
        if (idx !== -1) registeredTools.splice(idx, 1)
      }
    }),
    list: () => registeredTools,
  }

  const transport: DesktopBrowserTransport = {
    request: vi.fn(),
    releaseOwner: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }

  const attachments = {
    imageLimits: {
      maxImageBytes: 10_000_000,
      maxImagesPerMessage: 10,
      maxMessageImageBytes: 20_000_000,
      maxImagePixels: 100_000_000,
      maxImageDimension: 10_000,
      mediaTypes: ['image/png'],
    },
    saveImage: vi.fn(),
  }

  const agents = {
    get: vi.fn(),
    list: vi.fn(() => []),
  }
  const skills = {
    registerProvider: vi.fn(() => () => {}),
  }

  ctx.provide('skills', skills as never)
  ctx.provide('tools', tools as never)
  ctx.provide('agents', agents as never)
  ctx.provide('desktopBrowserTransport', transport)
  ctx.provide('attachments', attachments as never)

  return { ctx, transport, attachments, tools, config }
}

describe('DesktopBrowserProvider plugin', () => {
  it('registers exclusive desktop-internal provider and 8 tools', async () => {
    const { ctx, tools, config } = await makeHarness()
    const fiber = await ctx.plugin(DesktopBrowserProvider, config)
    await fiber

    expect(ctx.browserUse.providerName).toBe('desktop-internal')

    const toolNames = tools.list().map(t => t.name)
    expect(toolNames).toContain('browser_tabs')
    expect(toolNames).toContain('browser_open')
    expect(toolNames).toContain('browser_close')
    expect(toolNames).toContain('browser_snapshot')
    expect(toolNames).toContain('browser_read')
    expect(toolNames).toContain('browser_act')
    expect(toolNames).toContain('browser_wait')
    expect(toolNames).toContain('browser_screenshot')
    expect(toolNames.length).toBe(8)

    await fiber.dispose()
    expect(ctx.browserUse.providerName).toBeUndefined()
    expect(tools.list().length).toBe(0)
  })

  it('rejects duplicate browserUse provider registration', async () => {
    const { ctx, config } = await makeHarness()
    const first = await ctx.plugin(DesktopBrowserProvider, config)
    await first

    expect(() => ctx.browserUse.register('desktop-internal' as never)).toThrow(
      'browser use provider "desktop-internal" is already registered',
    )
  })

  it('calls transport.releaseOwner when agent/disposed fires', async () => {
    const { ctx, transport, config } = await makeHarness()
    const fiber = await ctx.plugin(DesktopBrowserProvider, config)
    await fiber

    const fakeAgent = {
      session: { id: 'test-session-1' },
    }

    ctx.emit('agent/disposed', { agent: fakeAgent as never })

    expect(transport.releaseOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session-1',
      }),
    )
  })

  describe('Config validation', () => {
    it('accepts valid config bounds', () => {
      expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow()
    })

    it('rejects invalid operationTimeoutMs', () => {
      expect(() => validateConfig({ ...DEFAULT_CONFIG, operationTimeoutMs: 0 })).toThrow('operationTimeoutMs')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, operationTimeoutMs: -1 })).toThrow('operationTimeoutMs')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, operationTimeoutMs: 1.5 })).toThrow('operationTimeoutMs')
    })

    it('rejects invalid navigationTimeoutMs', () => {
      expect(() => validateConfig({ ...DEFAULT_CONFIG, navigationTimeoutMs: 0 })).toThrow('navigationTimeoutMs')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, navigationTimeoutMs: -100 })).toThrow('navigationTimeoutMs')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, navigationTimeoutMs: 12.3 })).toThrow('navigationTimeoutMs')
    })

    it('rejects invalid snapshotMaxChars', () => {
      expect(() => validateConfig({ ...DEFAULT_CONFIG, snapshotMaxChars: 0 })).toThrow('snapshotMaxChars')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, snapshotMaxChars: -5 })).toThrow('snapshotMaxChars')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, snapshotMaxChars: 1_000_001 })).toThrow('snapshotMaxChars')
    })

    it('rejects invalid readResultMaxChars', () => {
      expect(() => validateConfig({ ...DEFAULT_CONFIG, readResultMaxChars: 0 })).toThrow('readResultMaxChars')
      expect(() => validateConfig({ ...DEFAULT_CONFIG, readResultMaxChars: 1_000_001 })).toThrow('readResultMaxChars')
    })
  })
})
