import { describe, expect, it } from 'vitest'
import type { AccountPaymentMethod } from '@deepseek-ai/dsh-account-sub2api/types'
import { formatAmount, formatCurrency, rechargePreview } from '../src/client/recharge-preview.ts'

const method: AccountPaymentMethod = {
  id: 'alipay', label: 'Alipay', currency: 'CNY',
  pricing: { multiplier: 2, bonusMode: 'bonus', bonusTiers: [
    { minAmount: 50, bonusPercent: 20 }, { minAmount: 10, bonusPercent: 10 },
  ] },
}
describe('checkout preview', () => {
  it('uses the greatest qualifying original-amount tier and scales credits by 100', () => {
    expect(rechargePreview(50, method)).toEqual({ credits: 12000, payBase: 50, discounted: false })
    expect(rechargePreview(30, method)?.credits).toBe(6600)
    expect(rechargePreview(5, method)?.credits).toBe(1000)
  })
  it('rounds the base and bonus separately', () => {
    expect(rechargePreview(10.123, method)?.credits).toBe(2228)
  })
  it('discounts payment rather than credited balance and respects currency precision', () => {
    const discount: AccountPaymentMethod = { ...method, currency: 'JPY', pricing: {
      multiplier: 2, bonusMode: 'discount', bonusTiers: [{ minAmount: 10, bonusPercent: 15 }],
    } }
    expect(rechargePreview(11, discount)).toEqual({ credits: 2200, payBase: 9, discounted: true })
    expect(rechargePreview(11, { ...discount, currency: 'CNY' })?.payBase).toBe(9.35)
  })
  it('rejects ineffective discounts without changing the original order amount', () => {
    for (const bonusPercent of [0, 100, 101]) {
      expect(rechargePreview(10, { ...method, pricing: {
        multiplier: 2, bonusMode: 'discount', bonusTiers: [{ minAmount: 1, bonusPercent }],
      } })).toEqual({ credits: 2000, payBase: 10, discounted: false })
    }
  })
  it('matches checkout half-cent rounding and defaults absent currency to two digits', () => {
    expect(rechargePreview(1.005, { ...method, pricing: {
      multiplier: 1, bonusMode: 'bonus', bonusTiers: [],
    } })?.credits).toBe(101)
    expect(rechargePreview(10, { id: 'test', label: 'Test', pricing: {
      multiplier: 1, bonusMode: 'discount', bonusTiers: [{ minAmount: 0, bonusPercent: 10 }],
    } })?.payBase).toBe(9)
  })
  it('does not invent missing pricing or accept invalid amounts', () => {
    expect(rechargePreview(10, { id: 'old', label: 'Legacy' })).toBeUndefined()
    for (const amount of [0, -1, NaN, Infinity]) expect(rechargePreview(amount, method)).toBeUndefined()
  })
})

describe('checkout formatting', () => {
  it('formats credits and currency for the active locale', () => {
    expect(formatAmount(2000, 'zh-CN')).toBe('2,000')
    expect(formatAmount(2000, 'en')).toBe('2,000')
    expect(formatCurrency(27, 'CNY', 'zh-CN')).toBe('¥27.00')
    expect(formatCurrency(27, 'CNY', 'en')).toBe('CN¥27.00')
  })
  it('formats a currency-less amount without throwing', () => {
    expect(formatCurrency(9.35, undefined, 'en')).toBe('9.35')
  })
})
