/** Usage statistics registered as a separate Settings tab. */
import { useCallback, useEffect, useState } from 'react'
import type { AccountUsageSnapshot } from '@deepseek-ai/dsh-account-sub2api/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountUsageActions } from './account-api.ts'
import css from './UsageSection.module.css'

export type UsageSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.account'>
  & InjectFace<AccountUsageActions>

const emptyUsage: AccountUsageSnapshot = {
  cumulative: { requests: 0, tokens: 0, credits: 0 },
  last7Days: { requests: 0, tokens: 0, credits: 0 },
  today: { requests: 0, tokens: 0, credits: 0 },
}

/** Render account usage for all three supported windows. */
export function UsageSection({ t, usage }: UsageSectionProps) {
  const [snapshot, setSnapshot] = useState<AccountUsageSnapshot>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await usage()
      if (result.ok) setSnapshot(result.value)
      else setError(result.error.message)
    } catch {
      setError(t('usageUnavailable'))
    } finally {
      setBusy(false)
    }
  }, [t, usage])

  useEffect(() => { void refresh() }, [refresh])

  const windows = [
    ['cumulative', snapshot?.cumulative ?? emptyUsage.cumulative],
    ['last7Days', snapshot?.last7Days ?? emptyUsage.last7Days],
    ['today', snapshot?.today ?? emptyUsage.today],
  ] as const

  return (
    <section className={css.section}>
      <header className={css.header}>
        <h2>{t('usageTitle')}</h2>
        <button type="button" disabled={busy} onClick={() => { void refresh() }}>{busy ? t('usageLoading') : t('refresh')}</button>
      </header>
      {error !== undefined && <p className={css.error}>{error}</p>}
      <div className={css.grid}>
        {windows.map(([label, value]) => (
          <article className={css.card} key={label} aria-label={t(label)}>
            <h3>{t(label)}</h3>
            <dl>
              <div><dt>{t('requestCount')}</dt><dd>{value.requests.toLocaleString()}</dd></div>
              <div><dt>{t('tokenCount')}</dt><dd>{value.tokens.toLocaleString()}</dd></div>
              <div><dt>{t('consumedCredits')}</dt><dd>{value.credits.toFixed(2)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}
