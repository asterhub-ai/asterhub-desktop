/** Account section registered in Settings. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionActions } from './account-api.ts'
import { AccountPanel } from './AccountPanel.tsx'

/** Props assembled by the Settings section renderer. */
export type AccountSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.account'>
  & InjectFace<AccountSectionActions>

/** Render account controls inside Settings. */
export function AccountSection(props: AccountSectionProps) {
  const { t, getStatus, login, logout, quota, paymentMethods, topUp, redeem } = props
  return <AccountPanel t={t} actions={{ getStatus, login, logout, quota, paymentMethods, topUp, redeem }} />
}
