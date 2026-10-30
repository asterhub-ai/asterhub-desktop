import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { APPLICATION_MODEL_ROUTE, apply } from '../src/index.ts'

describe('AsterHub model policy composition', () => {
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
