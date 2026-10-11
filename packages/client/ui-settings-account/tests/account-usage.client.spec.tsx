// @vitest-environment jsdom
/** Account usage abbreviates large token totals without changing accounting values. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AccountUsageSnapshot } from '@deepseek-ai/dsh-account-sub2api/types'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function unusedHook(): never {
  throw new Error('Usage statistics do not read global slot sources')
}
const globalProps = {
  usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook,
  useSessionRetainInfo: unusedHook, useWorkspaces: unusedHook, useResource: unusedHook,
}

describe.each([
  { language: 'English', t: makeTranslate(en, commonEn) },
  { language: 'Chinese', t: makeTranslate(zh, commonZh) },
])('Account usage in $language', ({ t }) => {
  it.each([
    { tokens: 0, expected: '0' },
    { tokens: 517, expected: '517' },
    { tokens: 12_240, expected: '12,240' },
    { tokens: 999_999, expected: '999,999' },
    { tokens: 1_000_000, expected: '1M' },
    { tokens: 1_234_567, expected: '1.2M' },
    { tokens: 12_300_000, expected: '12.3M' },
    { tokens: 120_000_000, expected: '120M' },
    { tokens: 999_999_999, expected: '1000M' },
    { tokens: 1_000_000_000, expected: '1B' },
    { tokens: 1_234_567_890, expected: '1.2B' },
  ])('displays $tokens tokens as $expected', async ({ tokens, expected }) => {
    const snapshot: AccountUsageSnapshot = {
      cumulative: { requests: 1, tokens, credits: 1 },
      last7Days: { requests: 0, tokens: 0, credits: 0 },
      today: { requests: 0, tokens: 0, credits: 0 },
    }
    render(<UsageSection {...globalProps} t={t} close={() => {}} usage={async () => ({ ok: true, value: snapshot })} />)
    await waitFor(() => {
      const card = screen.getByRole('article', { name: t('cumulative') })
      expect(within(card).getByText(t('tokenCount')).nextElementSibling?.textContent).toBe(expected)
    })
  })

  it('formats each reporting window while preserving request counts, credits and raw totals', async () => {
    const snapshot: AccountUsageSnapshot = Object.freeze({
      cumulative: Object.freeze({ requests: 15_420, tokens: 1_234_567_890, credits: 128.5 }),
      last7Days: Object.freeze({ requests: 2_350, tokens: 1_200_000, credits: 24.1 }),
      today: Object.freeze({ requests: 84, tokens: 42_100, credits: 1.25 }),
    })
    render(<UsageSection {...globalProps} t={t} close={() => {}} usage={async () => ({ ok: true, value: snapshot })} />)
    await screen.findByText('1.2B')
    for (const [label, tokens, requests, credits] of [
      ['cumulative', '1.2B', '15,420', '128.50'],
      ['last7Days', '1.2M', '2,350', '24.10'],
      ['today', '42,100', '84', '1.25'],
    ] as const) {
      const card = screen.getByRole('article', { name: t(label) })
      expect(within(card).getByText(t('tokenCount')).nextElementSibling?.textContent).toBe(tokens)
      expect(within(card).getByText(t('requestCount')).nextElementSibling?.textContent).toBe(requests)
      expect(within(card).getByText(t('consumedCredits')).nextElementSibling?.textContent).toBe(credits)
    }
  })
})
