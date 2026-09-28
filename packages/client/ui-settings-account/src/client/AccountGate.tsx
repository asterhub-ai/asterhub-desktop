/** Full-screen login gate shown until the account is authenticated. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountStatus } from '@deepseek-ai/dsh-account-sub2api/types'
import type { AccountSectionActions } from './account-api.ts'
import { ACCOUNT_COMMAND_EVENT, ACCOUNT_STATE_CHANGED_EVENT } from './account-api.ts'
import { AccountPanel } from './AccountPanel.tsx'
import css from './AccountGate.module.css'

/** Props assembled by the application overlay slot. */
export type AccountGateProps =
  PropsLocale<'settings.account'>
  & InjectFace<AccountSectionActions>

/** Keep the workspace covered while signed out and reveal it after login. */
export function AccountGate(props: AccountGateProps) {
  const { t, getStatus, login, logout, quota, paymentMethods, topUp, redeem } = props
  const actions = useMemo(() => ({ getStatus, login, logout, quota, paymentMethods, topUp, redeem }),
    [getStatus, login, logout, quota, paymentMethods, topUp, redeem])
  const [visible, setVisible] = useState(true)
  const [forced, setForced] = useState(false)
  const [commandError, setCommandError] = useState<string>()

  const updateStatus = useCallback((status: AccountStatus) => {
    setVisible(!status.loggedIn || forced)
  }, [forced])

  const close = useCallback(() => {
    setForced(false)
    setVisible(false)
    setCommandError(undefined)
  }, [])

  useEffect(() => {
    const onCommand = (event: Event): void => {
      const command = (event as CustomEvent<'open' | 'logout'>).detail
      setCommandError(undefined)
      if (command === 'open') {
        setForced(true)
        setVisible(true)
        return
      }
      if (command !== 'logout') return
      setForced(false)
      void logout().then((result) => {
        if (result.ok) {
          setVisible(true)
          window.dispatchEvent(new Event(ACCOUNT_STATE_CHANGED_EVENT))
        }
        else {
          setForced(true)
          setVisible(true)
          setCommandError(result.error.message)
        }
      }).catch(() => {
        setForced(true)
        setVisible(true)
        setCommandError(t('serviceUnavailable'))
      })
    }
    window.addEventListener(ACCOUNT_COMMAND_EVENT, onCommand)
    return () => { window.removeEventListener(ACCOUNT_COMMAND_EVENT, onCommand) }
  }, [logout, t])

  useEffect(() => {
    const refresh = (): void => {
      void getStatus().then((result) => {
        if (result.ok) setVisible(!result.value.loggedIn || forced)
      }).catch(() => { setVisible(true) })
    }
    window.addEventListener(ACCOUNT_STATE_CHANGED_EVENT, refresh)
    return () => { window.removeEventListener(ACCOUNT_STATE_CHANGED_EVENT, refresh) }
  }, [getStatus, forced])

  if (!visible) return null
  return (
    <div className={css.backdrop}>
      <div className={css.card}>
        <AccountPanel
          t={t}
          actions={actions}
          fullPage
          externalError={commandError}
          onStatusChange={updateStatus}
          onClose={close}
        />
      </div>
    </div>
  )
}
