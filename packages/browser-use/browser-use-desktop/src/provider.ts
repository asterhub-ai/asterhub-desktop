/** Desktop Sidebar Browser provider registering browser-use tools and exclusive capability. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-browser-use'
import type {} from '@deepseek-ai/dsh-skill'
import type { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import { createDesktopSkillProvider } from './skills.ts'
import {
  AgentOwnerTracker,
  SessionOperationQueue,
  createDesktopBrowserTools,
  type DesktopBrowserToolConfig,
} from './tools.ts'

export const name = 'browser-use-desktop'

export const inject = ['browserUse', 'tools', 'agents', 'desktopBrowserTransport', 'attachments', 'skills'] as const

export interface Config extends DesktopBrowserToolConfig {
  readonly assetRoot?: string | null
}

export const Config: z<Config> = z.object({
  operationTimeoutMs: z.number().default(3_000).description('Timeout for non-navigation operations in ms.'),
  navigationTimeoutMs: z.number().default(30_000).description('Timeout for navigation in ms.'),
  snapshotMaxChars: z.number().default(50_000).description('Maximum characters for accessible DOM snapshot.'),
  readResultMaxChars: z.number().default(50_000).description('Maximum characters for page.read results.'),
  assetRoot: z.string().description('Optional custom directory containing skill assets.'),
})

export function validateConfig(config: Config): void {
  if (!Number.isInteger(config.operationTimeoutMs) || config.operationTimeoutMs <= 0) {
    throw new Error(`operationTimeoutMs must be a positive integer, got ${config.operationTimeoutMs}`)
  }
  if (!Number.isInteger(config.navigationTimeoutMs) || config.navigationTimeoutMs <= 0) {
    throw new Error(`navigationTimeoutMs must be a positive integer, got ${config.navigationTimeoutMs}`)
  }
  if (!Number.isInteger(config.snapshotMaxChars) || config.snapshotMaxChars <= 0 || config.snapshotMaxChars > 1_000_000) {
    throw new Error(`snapshotMaxChars must be a positive integer <= 1,000,000, got ${config.snapshotMaxChars}`)
  }
  if (!Number.isInteger(config.readResultMaxChars) || config.readResultMaxChars <= 0 || config.readResultMaxChars > 1_000_000) {
    throw new Error(`readResultMaxChars must be a positive integer <= 1,000,000, got ${config.readResultMaxChars}`)
  }
}

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)

  const tracker = new AgentOwnerTracker()
  const queue = new SessionOperationQueue()

  ctx.effect(() => {
    const unregisterProvider = ctx.browserUse.register('desktop-internal' as BrowserUseProviderName)

    const tools = createDesktopBrowserTools(
      ctx,
      ctx.desktopBrowserTransport,
      config,
      tracker,
      queue,
    )
    const unregisterTools = tools.map(tool => ctx.tools.register(tool))

    const skillProvider = createDesktopSkillProvider(config.assetRoot ?? undefined)
    const unregisterSkills = ctx.skills.registerProvider(() => skillProvider)

    const unregisterAgentDisposed = ctx.on('agent/disposed', ({ agent }) => {
      const caller = tracker.getCaller(agent)
      tracker.releaseAgent(agent)
      void ctx.desktopBrowserTransport.releaseOwner(caller).catch((error: unknown) => {
        ctx.logger('browser-use-desktop').warn(`Failed to release owner on agent disposal: ${String(error)}`)
      })
    })

    return async () => {
      unregisterAgentDisposed()
      unregisterSkills()
      for (const unreg of unregisterTools) unreg()
      await unregisterProvider()
    }
  }, 'browser-use-desktop.provider')
}

export default {
  name,
  inject,
  Config,
  apply,
}
