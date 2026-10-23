import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { APPLICATION_MODEL_ROUTE, apply } from '../src/index.ts'

describe('AsterHub model policy composition', () => {
  it('installs the immutable provider ceiling before generic LLM service construction', async () => {
    const ctx = new Context()
    apply(ctx)
    await ctx.plugin(LlmRuntime)

    expect(ctx.get('applicationModelRoute')).toBe(APPLICATION_MODEL_ROUTE)
    expect(ctx.llm.hasFixedRoute()).toBe(true)
    await expect(ctx.llm.prepareCall({ provider: 'attacker', model: 'attacker-model' }))
      .rejects.toMatchObject({ code: 'MODEL_ROUTE_LOCKED' })
    await ctx.fiber.dispose()
  })

  it('unloads route-dependent plugins when the product route owner unloads', async () => {
    const ctx = new Context()
    const policy = ctx.plugin(apply)
    await policy
    let consumerDisposed = false
    const consumer = ctx.plugin({
      inject: ['applicationModelRoute'],
      apply(owner: Context) {
        expect(owner.get('applicationModelRoute')).toBe(APPLICATION_MODEL_ROUTE)
        owner.effect(() => () => { consumerDisposed = true })
      },
    })
    await consumer

    await policy.dispose()

    expect(ctx.get('applicationModelRoute')).toBeUndefined()
    expect(consumerDisposed).toBe(true)
    await ctx.fiber.dispose()
  })
})
