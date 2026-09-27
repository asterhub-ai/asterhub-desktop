/**
 * The Account settings surface: logged-out it offers the sub2api login and
 * dashboard entries; logged in it shows the live balance and the top-up,
 * redemption, password-management, and logout actions.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountStatus } from '@deepseek-ai/dsh-account-sub2api/types'
import { getAccountApi } from './account-api.ts'
import css from './AccountSection.module.css'

/** Full component props assembled by the settings section renderer. */
export type AccountSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.account'>

/** Extract the human message from a failed remote call. */
function failureMessage(error: { message: string }): string {
  return error.message
}

/** Render the account surface for its current state. */
export function AccountSection({ t }: AccountSectionProps) {
  const api = getAccountApi()
  const [status, setStatus] = useState<AccountStatus>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [amount, setAmount] = useState('10')
  const [code, setCode] = useState('')

  const applyStatus = (next: AccountStatus): void => {
    setStatus(next)
    setError(undefined)
  }

  if (api === undefined) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        <p className={css.error}>账户服务不可用</p>
      </div>
    )
  }

  const load = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.getStatus()
      if (result.ok) applyStatus(result.value)
      else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  const login = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await api.login({ email, password })
      if (result.ok) {
        applyStatus(result.value)
        setPassword('')
      } else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.logout()
      if (result.ok) {
        setStatus({ loggedIn: false, keyBound: false, dashboardUrl: status?.dashboardUrl ?? '' })
        setNotice(undefined)
      } else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  const refreshBalance = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.quota()
      if (result.ok) {
        setStatus((previous) => {
          if (previous === undefined) return undefined
          const next: AccountStatus = {
            ...previous,
            balance: result.value.balance,
            ...(result.value.currency !== undefined ? { currency: result.value.currency } : {}),
          }
          return next
        })
        setError(undefined)
      } else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  const topUp = async (): Promise<void> => {
    const parsed = Number(amount)
    setBusy(true)
    setNotice(undefined)
    setError(undefined)
    try {
      const result = await api.topUp({ amount: parsed })
      if (result.ok) {
        if (result.value.checkoutUrl) {
          setNotice(t('topUpOpening'))
          window.open(result.value.checkoutUrl, '_blank')
        } else setError('认证服务未返回支付链接，请前往账户中心充值')
      } else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  const redeem = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await api.redeem({ code })
      if (result.ok) {
        setCode('')
        setNotice('兑换成功')
        await refreshBalance()
      } else setError(failureMessage(result.error))
    } finally {
      setBusy(false)
    }
  }

  if (status === undefined) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        <p className={css.muted}>{t('loading')}</p>
        {error !== undefined && <p className={css.error}>{error}</p>}
        <button type="button" className={css.action} disabled={busy} onClick={() => { void load() }}>
          {t('refresh')}
        </button>
      </div>
    )
  }

  if (!status.loggedIn) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        <p className={css.muted}>{t('loggedOutIntro')}</p>
        <form
          className={css.form}
          onSubmit={(event) => { event.preventDefault(); void login() }}
        >
          <label className={css.fieldLabel}>
            <span>{t('emailLabel')}</span>
            <input
              className={css.input}
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => { setEmail(event.target.value) }}
            />
          </label>
          <label className={css.fieldLabel}>
            <span>{t('passwordLabel')}</span>
            <input
              className={css.input}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => { setPassword(event.target.value) }}
            />
          </label>
          <button type="submit" className={css.primary} disabled={busy || !email || !password}>
            {busy ? t('loggingIn') : t('loginButton')}
          </button>
        </form>
        <div className={css.links}>
          <a className={css.link} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('forgotLink')}</a>
          <a className={css.link} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('registerLink')}</a>
        </div>
        <p className={css.muted}>{t('keyBoundNote')}</p>
        {error !== undefined && <p className={css.error}>{error}</p>}
      </div>
    )
  }

  const balanceText = status.balance === undefined
    ? t('balanceLoading')
    : `${status.balance}${status.currency === undefined ? '' : ` ${status.currency}`}`

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.muted}>
        {t('loggedInAs')}
        {'：'}
        {status.user?.email ?? status.user?.username ?? status.user?.id}
      </p>
      <div className={css.row}>
        <span>{t('balanceLabel')}</span>
        <strong>{balanceText}</strong>
        <button type="button" className={css.action} disabled={busy} onClick={() => { void refreshBalance() }}>
          {t('refresh')}
        </button>
      </div>
      <div className={css.group}>
        <span className={css.groupTitle}>{t('topUpTitle')}</span>
        <div className={css.row}>
          <label className={css.fieldLabel}>
            <span>{t('topUpAmountLabel')}</span>
            <input
              className={css.input}
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) => { setAmount(event.target.value) }}
            />
          </label>
          <button type="button" className={css.action} disabled={busy} onClick={() => { void topUp() }}>
            {t('topUpButton')}
          </button>
        </div>
        <div className={css.row}>
          <label className={css.fieldLabel}>
            <span>{t('redeemTitle')}</span>
            <input
              className={css.input}
              type="text"
              value={code}
              onChange={(event) => { setCode(event.target.value) }}
            />
          </label>
          <button type="button" className={css.action} disabled={busy || !code} onClick={() => { void redeem() }}>
            {t('redeemButton')}
          </button>
        </div>
      </div>
      <div className={css.links}>
        <a className={css.link} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('changePasswordLink')}</a>
        <a className={css.link} href={status.dashboardUrl} target="_blank" rel="noreferrer">{t('dashboardLink')}</a>
      </div>
      <button type="button" className={css.action} disabled={busy} onClick={() => { void logout() }}>
        {busy ? t('loggingOut') : t('logoutButton')}
      </button>
      {notice !== undefined && <p className={css.muted}>{notice}</p>}
      {error !== undefined && <p className={css.error}>{error}</p>}
    </div>
  )
}
