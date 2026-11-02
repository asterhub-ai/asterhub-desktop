/** Pure checkout estimates from validated, non-sensitive Host pricing. */
import type { AccountPaymentMethod } from '@deepseek-ai/dsh-account-sub2api/types'

/** Format a unitless amount for the active UI locale.
 * @param value - Amount to format.
 * @param locale - BCP 47 locale tag from the active dictionary.
 * @returns Grouped digits using that locale's separators.
 */
export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** Format a checkout amount in its currency for the active UI locale.
 * @param value - Monetary amount to format.
 * @param currency - ISO 4217 currency code, or undefined when the method omits one.
 * @param locale - BCP 47 locale tag from the active dictionary.
 * @returns Currency text, or grouped digits when no currency was supplied.
 */
export function formatCurrency(value: number, currency: string | undefined, locale: string): string {
  return currency === undefined
    ? formatAmount(value, locale)
    : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

/** Estimate credits and the payment base, excluding provider fees.
 * @param amount Original order amount, before discounts.
 * @param method Selected checkout method with optional verified pricing.
 * @returns Estimate, or undefined when pricing or the amount cannot support a preview.
 */
export function rechargePreview(amount: number, method: AccountPaymentMethod | undefined): {
  credits: number
  payBase: number
  discounted: boolean
} | undefined {
  const pricing = method?.pricing
  if (!pricing || !Number.isFinite(amount) || amount <= 0) return undefined
  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
  const base = round2(amount * pricing.multiplier)
  const tier = pricing.bonusTiers.filter(value => value.minAmount <= amount)
    .reduce<{ minAmount: number; bonusPercent: number } | undefined>(
      (selected, value) => !selected || value.minAmount > selected.minAmount ? value : selected, undefined)
  const percent = tier?.bonusPercent ?? 0
  const credited = pricing.bonusMode === 'bonus' ? round2(base + round2(base * percent / 100)) : base
  let payBase = amount
  if (pricing.bonusMode === 'discount' && percent > 0 && percent < 100) {
    const digits = method.currency ? new Intl.NumberFormat('en', { style: 'currency', currency: method.currency })
      .resolvedOptions().maximumFractionDigits ?? 2 : 2
    const scale = 10 ** digits
    const discounted = Math.round((amount * (100 - percent) / 100 + Number.EPSILON) * scale) / scale
    if (discounted > 0 && discounted < amount) payBase = discounted
  }
  if (!Number.isFinite(credited) || !Number.isFinite(credited * 100)) return undefined
  return { credits: round2(credited * 100), payBase, discounted: payBase < amount }
}
