/**
 * The Plugins page: the sidebar entry is kept, and the surface is reserved
 * for the AsterHub plugin system — the upstream install and management UI is
 * intentionally not part of this fork.
 */
import css from './PluginManagerPage.module.css'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CuratedPluginCatalog } from '@deepseek-ai/dsh-plugin-manager/types'

/** Full component props assembled by the main slot renderer. */
export type PluginManagerPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'pluginManager'>
  & PropsRenderSlots<'plugins.item' | 'plugins.bundle.config' | 'plugins.row.config'>
  & {
    catalog?: CuratedPluginCatalog
    loading?: boolean
    unavailable?: boolean
    busy?: string
    message?: string
    onInstall?(entry: CuratedPluginCatalog['plugins'][number]): Promise<void>
  }

/**
 * Render the reserved Plugins surface.
 * @param props - the framework-composed page props.
 * @returns the curated catalogue.
 */
export function PluginManagerPage(props: PluginManagerPageProps) {
  const { t, catalog } = props
  return (
    <div className={css.page}>
      <h1 className={css.title}>{props.t('title')}</h1>
      {props.loading && <p className={css.status}>{t('loading')}</p>}
      {props.unavailable && <p className={css.status} role="status">{t('unavailable')}</p>}
      {!props.loading && !props.unavailable && catalog?.plugins.length === 0 && <p className={css.status}>{t('empty')}</p>}
      {props.message && <p className={css.notice} role="status">{props.message}</p>}
      <div className={css.list}>
        {catalog?.plugins.map((entry) => {
          const isInstalled = entry.installed === true
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
                {props.busy === entry.id ? t('installing') : isInstalled ? t('installed') : t('install')}
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
