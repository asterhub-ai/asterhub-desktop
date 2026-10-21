/**
 * Capability probe for Windows restricted-token prerequisites.
 *
 * Creating a WRITE_RESTRICTED token requires a logon session SID (SE_GROUP_LOGON_ID)
 * in the process token (used for WinSta0/desktop access and keep-alive restricting SIDs).
 * Service identities (such as Nomad client workers, LocalSystem, or Windows services
 * running in Session 0) lack a logon session SID among their token groups. When no logon
 * SID is present, findLogonSid() fails closed as designed.
 */

import { win32Sync } from '../src/ffi.ts'
import { findLogonSid, openCurrentProcessToken } from '../src/token.ts'

let cachedHasLogonSid: boolean | undefined

/**
 * Returns true if the current Windows process token has a logon session SID
 * required for restricted-token construction.
 */
export function hasLogonSid(): boolean {
  if (process.platform !== 'win32') return false
  if (cachedHasLogonSid !== undefined) return cachedHasLogonSid
  const api = win32Sync()
  const token = openCurrentProcessToken(api)
  try {
    const logonSid = findLogonSid(api, token)
    api.localFree(logonSid)
    return (cachedHasLogonSid = true)
  } catch (error) {
    if (error instanceof Error
      && /^CreateRestrictedToken prerequisite failed: no logon SID found among \d+ token groups$/.test(error.message)) {
      return (cachedHasLogonSid = false)
    }
    throw error
  } finally {
    api.closeHandle(token)
  }
}
