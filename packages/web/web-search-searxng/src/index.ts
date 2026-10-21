/** SearXNG `WebSearchProvider` plugin for the AsterHub Host composition. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { SearxngSearchProvider } from './provider.ts'

export { mapSearxngResponse, SEARXNG_PROVIDER_ID, SearxngSearchProvider } from './provider.ts'
export type { SearxngSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** Host capabilities consumed by the provider. */
export const inject = ['web', 'credentials']

/** Plugin configuration. */
export interface Config {
  /** Trusted HTTPS base URL; `/search` is appended for each query. */
  readonly baseURL: string
}

/** Validate the deployment-owned search endpoint. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
})

const MODEL_KEY_RECORD = credentialKey('asterhub-account', 'model-api-key')

/**
 * Register SearXNG and resolve the active model key only when a search runs.
 * @param ctx Host context with web and credentials services.
 * @param config SearXNG endpoint configuration.
 * @returns No value.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = new SearxngSearchProvider({
    baseURL: config.baseURL,
    apiKey: async () => {
      const record = await ctx.credentials.readRecord(MODEL_KEY_RECORD)
      return record?.kind === 'api-key' && typeof record.key === 'string' && record.key.length > 0
        ? record.key
        : undefined
    },
  })
  if (!provider.available()) {
    throw new Error('SearXNG search baseURL must be an absolute HTTPS URL without credentials or query data')
  }
  ctx.effect(() => ctx.web.registerSearchProvider(provider))
}
