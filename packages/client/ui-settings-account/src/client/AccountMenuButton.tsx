/**
 * The top-left account menu: a compact entry on the sidebar brand row.
 * Logged out it offers the sub2api login and registration entries; logged in
 * it shows the live balance with top-up, password-management, and logout
 * shortcuts. The full login form lives in Settings → 账户.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountStatus } from '@deepseek-ai/dsh-account-sub2api/types'
import css from './AccountMenu.module.css'
import { getAccountApi } from './account-api.ts'

/** Props composed by the slot renderer. */
export type AccountMenuProps =
  PropsLocale<'settings.account'>

/** Extract the human message from a failed remote call. */
function failureMessage(error: { message: string }): string {
  return error.message
}

/** Render the account menu trigger and its dropdown. */
export function AccountMenuButton({ t }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AccountStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const api = getAccountApi()

  useEffect(() => {
    if (api === undefined) return
    let cancelled = false
    const result = api.getStatus()
    void Promise.resolve(result).then((resolved) => {
      if (cancelled) return
      if (resolved.ok) setStatus(resolved.value)
      else setError(failureMessage(resolved.error))
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [api])

  const logout = async (): Promise<void> => {
    if (api === undefined) { setError('账户服务不可用'); return }
    setBusy(true)
    try {
      const result = await api.logout()
      if (result.ok) {
        setStatus({ loggedIn: false, keyBound: false, dashboardUrl: status?.dashboardUrl ?? '' })
        setError(undefined)
      } else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  const initial = status?.user?.email?.charAt(0).toUpperCase()
    ?? status?.user?.username?.charAt(0).toUpperCase() ?? '?'
  const balanceText = status?.balance === undefined
    ? undefined
    : `${status.balance}${status.currency === undefined ? '' : ` ${status.currency}`}`

  return (
    <span className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('nav')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(previous => !previous) }}
      >
        {status?.loggedIn && status.user !== undefined
          ? <span className={css.avatar}>{initial}</span>
          : <span className={`${css.avatar} ${css.avatarAnonymous}`}>?</span>}
      </button>
      {open && (
        <div className={css.menu} role="menu">
          {status === undefined ? (
            <p className={css.muted}>{t('loading')}</p>
          ) : !status.loggedIn ? (
            <>
              <p className={css.muted}>{t('loggedOutIntro')}</p>
              <a className={css.item} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('loginButton')}</a>
              <a className={css.item} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('registerLink')}</a>
              <a className={css.item} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('forgotLink')}</a>
            </>
          ) : (
            <>
              <p className={css.muted}>
                {t('loggedInAs')}
                {'：'}
                {status.user?.email ?? status.user?.username ?? status.user?.id}
              </p>
              <p className={css.muted}>{t('balanceLabel')}：{balanceText ?? t('balanceLoading')}</p>
              <a className={css.item} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('topUpTitle')}</a>
              <a className={css.item} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('changePasswordLink')}</a>
              <button
                type="button"
                className={css.item}
                disabled={busy}
                onClick={() => { void logout() }}
              >
                {busy ? t('loggingOut') : t('logoutButton')}
              </button>
            </>
          )}
          {error !== undefined && <p className={css.error}>{error}</p>}
        </div>
      )}
    </span>
  )
}
