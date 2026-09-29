/** Shared account form used by Settings and the signed-out application gate. */
import { useEffect, useRef, useState } from 'react'
import type { AccountStatus, AccountPaymentMethod } from '@deepseek-ai/dsh-account-sub2api/types'
import type { AccountSectionActions } from './account-api.ts'
import { ACCOUNT_STATE_CHANGED_EVENT } from './account-api.ts'
import type { AccountLocaleKey } from './locales.ts'
import css from './AccountSection.module.css'

/** Callbacks and localized copy supplied by the owning account slot. */
export interface AccountPanelProps {
  readonly t: (key: AccountLocaleKey) => string
  readonly actions: AccountSectionActions
  readonly fullPage?: boolean
  readonly externalError?: string | undefined
  readonly onStatusChange?: (status: AccountStatus) => void
  readonly onClose?: () => void
}

/** Extract the human message from a failed Remote call. */
function failureMessage(error: { message: string }): string {
  return error.message
}

/** Render login or the account controls using Host status as the source of truth. */
export function AccountPanel({
  t, actions, fullPage = false, externalError, onStatusChange, onClose,
}: AccountPanelProps) {
  const [status, setStatus] = useState<AccountStatus>()
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberUsername, setRememberUsername] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [amount, setAmount] = useState('10')
  const [code, setCode] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<AccountPaymentMethod[]>([])
  const [paymentType, setPaymentType] = useState('')
  const [paymentMethodsError, setPaymentMethodsError] = useState<string>()
  const eventSource = useRef(Symbol('account-panel'))

  const applyStatus = (next: AccountStatus): void => {
    setStatus(next)
    setEmail(next.rememberedUsername ?? '')
    setRememberUsername(next.rememberedUsername !== undefined)
    setAutoLogin(next.autoLogin === true)
    setError(undefined)
    onStatusChange?.(next)
  }

  const loadPaymentMethods = async (): Promise<void> => {
    try {
      const result = await actions.paymentMethods()
      if (!result.ok) {
        setPaymentMethods([])
        setPaymentType('')
        setPaymentMethodsError(failureMessage(result.error))
        return
      }
      setPaymentMethods(result.value)
      setPaymentMethodsError(undefined)
      setPaymentType(previous => result.value.some(method => method.id === previous)
        ? previous
        : result.value[0]?.id ?? '')
    } catch {
      setPaymentMethods([])
      setPaymentType('')
      setPaymentMethodsError(t('paymentMethodsUnavailable'))
    }
  }

  const load = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await actions.getStatus()
      if (result.ok) {
        applyStatus(result.value)
        if (result.value.loggedIn) await loadPaymentMethods()
        else { setPaymentMethods([]); setPaymentType('') }
      } else setError(failureMessage(result.error))
    } catch {
      setError(t('serviceUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    void actions.getStatus().then(async (result) => {
      if (!active) return
      if (result.ok) {
        applyStatus(result.value)
        if (result.value.loggedIn) await loadPaymentMethods()
      } else setError(failureMessage(result.error))
    }).catch(() => {
      if (active) setError(t('serviceUnavailable'))
    }).finally(() => {
      if (active) setBusy(false)
    })
    const refresh = (event: Event): void => {
      if ((event as CustomEvent<symbol>).detail === eventSource.current) return
      void load()
    }
    window.addEventListener(ACCOUNT_STATE_CHANGED_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(ACCOUNT_STATE_CHANGED_EVENT, refresh)
    }
  }, [actions, t])

  const login = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await actions.login({ email, password, rememberUsername, autoLogin })
      if (result.ok) {
        setPassword('')
        applyStatus(result.value)
        await load()
        window.dispatchEvent(new CustomEvent(ACCOUNT_STATE_CHANGED_EVENT, { detail: eventSource.current }))
      } else setError(failureMessage(result.error))
    } catch {
      setError(t('serviceUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await actions.logout()
      if (result.ok) {
        setStatus(undefined)
        setPaymentMethods([])
        setPaymentType('')
        await load()
        setNotice(undefined)
        window.dispatchEvent(new CustomEvent(ACCOUNT_STATE_CHANGED_EVENT, { detail: eventSource.current }))
      } else setError(failureMessage(result.error))
    } catch {
      setError(t('serviceUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  const refreshBalance = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await actions.quota()
      if (result.ok) {
        setStatus((previous) => {
          if (previous === undefined) return undefined
          const next: AccountStatus = {
            ...previous,
            balance: result.value.balance,
          }
          return next
        })
        setError(undefined)
      } else setError(failureMessage(result.error))
    } catch {
      setError(t('serviceUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  const topUp = async (): Promise<void> => {
    const parsed = Number(amount)
    if (!paymentType || !Number.isFinite(parsed) || parsed <= 0) {
      setError(t('paymentUnavailable'))
      return
    }
    setBusy(true)
    setNotice(undefined)
    setError(undefined)
    try {
      const result = await actions.topUp({ amount: parsed, paymentType })
      if (result.ok) {
        if (result.value.checkoutUrl) {
          setNotice(t('topUpOpening'))
          window.open(result.value.checkoutUrl, '_blank')
        } else setError(t('paymentUnavailable'))
      } else setError(failureMessage(result.error))
    } catch {
      setError(t('serviceUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  const redeem = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await actions.redeem({ code })
      if (result.ok) {
        setCode('')
        setNotice(t('redeemed'))
        await load()
        window.dispatchEvent(new CustomEvent(ACCOUNT_STATE_CHANGED_EVENT, { detail: eventSource.current }))
      } else setError(failureMessage(result.error))
    } catch {
      setError(t('serviceUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  const showLogin = status?.loggedIn === false || (fullPage && status === undefined)
  const rootClass = fullPage ? `${css.section} ${css.fullPage}` : css.section

  if (status === undefined && !fullPage) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        {error === undefined
          ? <p className={css.muted}>{t('loading')}</p>
          : <p className={css.error}>{error}</p>}
        <button type="button" className={css.action} disabled={busy} onClick={() => { void load() }}>
          {busy ? t('loading') : t('refresh')}
        </button>
      </div>
    )
  }

  if (showLogin) {
    return (
      <div className={rootClass}>
        {fullPage && <p className={css.productName}>{t('productName')}</p>}
        <h2 className={css.heading}>{t('title')}</h2>
        <p className={css.muted}>{t('loggedOutIntro')}</p>
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); void login() }}>
          <label className={css.fieldLabel}>
            <span>{t('emailLabel')}</span>
            <input className={css.input} type="email" value={email} autoComplete="username"
              onChange={(event) => { setEmail(event.target.value) }} />
          </label>
          <label className={css.fieldLabel}>
            <span>{t('passwordLabel')}</span>
            <input className={css.input} type="password" value={password} autoComplete="current-password"
              onChange={(event) => { setPassword(event.target.value) }} />
          </label>
          <div className={css.preferences}>
            <label className={css.checkboxLabel}>
              <input type="checkbox" checked={rememberUsername}
                onChange={(event) => {
                  setRememberUsername(event.target.checked)
                  if (!event.target.checked) setAutoLogin(false)
                }} />
              <span>{t('rememberUsername')}</span>
            </label>
            <label className={css.checkboxLabel}>
              <input type="checkbox" checked={autoLogin}
                onChange={(event) => {
                  setAutoLogin(event.target.checked)
                  if (event.target.checked) setRememberUsername(true)
                }} />
              <span>{t('autoLogin')}</span>
            </label>
          </div>
          <button type="submit" className={css.primary} disabled={busy || !email || !password}>
            {busy ? t('loggingIn') : t('loginButton')}
          </button>
        </form>
        {(externalError ?? error) !== undefined && <p className={css.error}>{externalError ?? error}</p>}
      </div>
    )
  }

  if (status === undefined) return null
  const balanceText = status.balance === undefined ? t('balanceLoading') : status.balance.toFixed(2)

  return (
    <div className={rootClass}>
      {fullPage && <p className={css.productName}>{t('productName')}</p>}
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.muted}>{t('loggedInAs')}：{status.user?.email ?? status.user?.username ?? status.user?.id}</p>
      <div className={css.row}>
        <span>{t('balanceLabel')}</span>
        <strong>{balanceText}</strong>
        <button type="button" className={css.action} disabled={busy} onClick={() => { void refreshBalance() }}>
          {t('refresh')}
        </button>
      </div>
      <div className={css.group}>
        <span className={css.groupTitle}>{t('topUpTitle')}</span>
        <label className={css.fieldLabel}>
          <span>{t('paymentMethod')}</span>
          <select className={css.input} value={paymentType} disabled={busy || paymentMethods.length === 0}
            onChange={(event) => { setPaymentType(event.target.value) }}>
            {paymentMethods.length === 0
              ? <option value="">{paymentMethodsError ?? t('noPaymentMethods')}</option>
              : paymentMethods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
          </select>
        </label>
        <div className={css.row}>
          <label className={css.fieldLabel}>
            <span>{t('topUpAmountLabel')}</span>
            <input className={css.input} type="number" min="1" step="1" value={amount}
              onChange={(event) => { setAmount(event.target.value) }} />
          </label>
          <button type="button" className={`${css.action} ${css.fieldAction}`}
            disabled={busy || paymentMethods.length === 0} onClick={() => { void topUp() }}>
            {t('topUpButton')}
          </button>
        </div>
        <div className={css.row}>
          <label className={css.fieldLabel}>
            <span>{t('redeemTitle')}</span>
            <input className={css.input} type="text" value={code}
              onChange={(event) => { setCode(event.target.value) }} />
          </label>
          <button type="button" className={`${css.action} ${css.fieldAction}`}
            disabled={busy || !code} onClick={() => { void redeem() }}>
            {t('redeemButton')}
          </button>
        </div>
      </div>
      <button type="button" className={css.action} disabled={busy} onClick={() => { void logout() }}>
        {busy ? t('loggingOut') : t('logoutButton')}
      </button>
      {fullPage && onClose !== undefined && (
        <button type="button" className={css.action} disabled={busy} onClick={onClose}>{t('backToWorkspace')}</button>
      )}
      {notice !== undefined && <p className={css.muted}>{notice}</p>}
      {(externalError ?? error) !== undefined && <p className={css.error}>{externalError ?? error}</p>}
    </div>
  )
}
