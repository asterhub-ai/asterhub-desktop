/** Installed release version in General Settings for Web and Desktop. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

/** Optional callback and installed version; only present on Desktop with a bridge. */
export interface CurrentVersionRowInjected {
  /** Explicit installed application version from Desktop carrier; absent in generic Web. */
  installedVersion?: string
  /** Triggers the main-owned manual check-and-consent prompt; absent in browsers. */
  checkUpdates?: () => Promise<void>
}

/**
 * Render the version embedded by the client build; partial builds without metadata omit the row.
 * On Desktop with a bridge, also show a check for updates button.
 * @param props - runtime share, optional update callback, and localized copy.
 * @returns the current release label with optional update button, or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t, installedVersion, checkUpdates }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & CurrentVersionRowInjected) {
  const version = installedVersion ?? process.env.DSH_CLIENT_VERSION
  if (version === undefined) return null
  if (checkUpdates !== undefined) {
    return (
      <div className={css.row}>
        <span>{t('general.currentVersion', { version })}</span>
        <Button variant="ghost" size="sm" onClick={() => { void checkUpdates() }}>
          {t('general.checkUpdates')}
        </Button>
      </div>
    )
  }
  return <div className={css.row}>{t('general.currentVersion', { version })}</div>
}
