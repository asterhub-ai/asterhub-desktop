/** Narrow Remote callbacks passed to the account UI through its owned slots. */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

type AccountRemote = ClientRemote['accountSub2api']

/** Account settings actions; the component never receives the Remote service. */
export type AccountSectionActions = Pick<AccountRemote,
  'getStatus' | 'authSettings' | 'sendVerifyCode' | 'register' | 'login' | 'logout' | 'quota' | 'paymentMethods' | 'topUp' | 'redeem'>

/** Usage snapshot action owned by the account plugin. */
export type AccountUsageActions = Pick<AccountRemote, 'usage'>

/** Browser events connecting the native application menu to the account overlay. */
export const ACCOUNT_COMMAND_EVENT = 'asterhub:account-command'
/** Browser event asking account surfaces to reread Host state after a native command. */
export const ACCOUNT_STATE_CHANGED_EVENT = 'asterhub:account-state-changed'
