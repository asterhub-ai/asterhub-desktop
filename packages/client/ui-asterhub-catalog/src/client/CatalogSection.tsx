/** Curated catalog tab body: the verified catalogue's three states and one card per entry. */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CuratedPluginCatalog } from '@deepseek-ai/dsh-plugin-manager/types'
import css from './catalog.module.css'

/** Props the tab's state wrapper passes down from its catalogue and install state. */
export type CatalogSectionProps = PropsLocale<'asterhubCatalog'> & {
  catalog?: CuratedPluginCatalog
  loading?: boolean
  unavailable?: boolean
  /** The id of the entry an install is running for. */
  busy?: string
  /** Outcome text of the last install attempt, cleared on the next one. */
  message?: string
  onInstall?(entry: CuratedPluginCatalog['plugins'][number]): Promise<void>
}

/**
 * Render the curated catalogue: loading, unavailable, and empty states, then one card per entry.
 * @param props - the catalogue state and the install action.
 * @returns the tab body.
 */
export function CatalogSection(props: CatalogSectionProps): ReactNode {
  const { t, catalog } = props
  return (
    <div className={css.section}>
      {props.loading && <p className={css.status}>{t('loading')}</p>}
      {props.unavailable && <p className={css.status} role="status">{t('unavailable')}</p>}
      {!props.loading && !props.unavailable && catalog?.plugins.length === 0 && <p className={css.status}>{t('empty')}</p>}
      {props.message && <p className={css.notice} role="status">{props.message}</p>}
      <div className={css.list}>
        {catalog?.plugins.map((entry) => {
          const isInstalled = entry.installed === true
          const status = entry.installStatus ?? (isInstalled ? 'installed' : 'not-installed')
          const buttonLabel = props.busy === entry.id ? t('installing')
            : status === 'installed' ? t('installed')
              : status === 'update-available' ? t('updateAvailable')
                : status === 'reinstall' ? t('reinstall')
                  : t('install')
          return (
            <article className={css.card} key={entry.id}>
              <div className={css.copy}>
                <h2>{entry.name}</h2>
                <p>{entry.description}</p>
                <span>{t('installedVersion')}: {entry.version}</span>
              </div>
              <button
                type="button"
                disabled={isInstalled || props.busy !== undefined || props.loading}
                onClick={() => { void props.onInstall?.(entry) }}
              >
                {buttonLabel}
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
