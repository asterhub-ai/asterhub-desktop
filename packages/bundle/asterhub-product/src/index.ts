/**
 * Shared AsterHub model policy and deployment composition.
 * @module @deepseek-ai/dsh-asterhub-product
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'

/** Trusted product route consumed by Host and installed before model services. */
export const APPLICATION_MODEL_ROUTE = Object.freeze({
  provider: 'sub2api',
  model: '__unselected__',
  selectableModels: true,
  profile: Object.freeze({
    displayName: 'AsterHub',
    syncModels: true,
    baseURL: 'https://xapi.fans/v1',
    api: 'openai-completions',
    credentialRecord: 'asterhub-account/model-api-key',
    models: Object.freeze([Object.freeze({
      id: '__unselected__',
      name: 'AsterHub',
      contextWindow: 262144,
      maxTokens: 32768,
      input: Object.freeze(['text', 'image']),
      reasoningEfforts: Object.freeze({ off: null, low: 'low', medium: 'medium', high: 'high' }),
      compat: Object.freeze({ thinkingFormat: 'openai' }),
    })]),
    reasoning: 'medium',
  }),
})

/**
 * Install the deployment route before LlmRuntime and provider adapters load.
 * @param ctx - Product plugin context owning the route registration.
 */
export function apply(ctx: Context): void {
  const existing = ctx.get('applicationModelRoute')
  if (existing === undefined) {
    ctx.provide('applicationModelRoute', APPLICATION_MODEL_ROUTE)
    return
  }
  if (JSON.stringify(existing) !== JSON.stringify(APPLICATION_MODEL_ROUTE)) {
    throw new Error('asterhub-product: conflicting application model route')
  }
}
