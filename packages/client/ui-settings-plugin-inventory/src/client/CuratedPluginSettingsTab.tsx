/** Settings surface for the signed AsterHub plugin catalogue. */
import { useEffect, useState, type ReactNode } from 'react'
import type { ChangeResult, CuratedPluginCatalog, CuratedPluginEntry, CuratedPluginInstallRequest } from '@deepseek-ai/dsh-plugin-manager/types'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CuratedPluginSettingsTab.module.css'

/** Registration-side Remote face used by the curated catalogue section. */
export interface CuratedPluginSettingsTabInjected {
  /** Read the verified server catalogue. */
  readonly catalog: () => Promise<CuratedPluginCatalog>
  /** Install one catalogue entry through the signed bundle path. */
  readonly install: (request: CuratedPluginInstallRequest) => Promise<ChangeResult>
}

/** Full component props assembled by the Settings slot renderer. */
export type CuratedPluginSettingsTabProps =
  PropsLocale<'settings.pluginInventory'>
  & InjectFace<CuratedPluginSettingsTabInjected>

type ViewState = 'loading' | 'error' | 'ready'

/** Render only entries returned by the verified AsterHub catalogue. */
export function CuratedPluginSettingsTab(props: CuratedPluginSettingsTabProps): ReactNode {
  const { t } = props
  const [catalog, setCatalog] = useState<CuratedPluginCatalog>()
  const [status, setStatus] = useState<ViewState>('loading')
  const [busy, setBusy] = useState<string>()
  const [message, setMessage] = useState<string>()

  const refresh = async (): Promise<void> => {
    setStatus('loading')
    try {
      setCatalog(await props.catalog())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }
  useEffect(() => { void refresh() }, [props.catalog])

  const install = async (entry: CuratedPluginEntry): Promise<void> => {
    if (catalog === undefined) return
    setBusy(entry.id)
    setMessage(undefined)
    try {
      const result = await props.install({
        id: entry.id,
        revision: catalog.revision,
        package: entry.package,
        version: entry.version,
        integrity: entry.integrity,
        artifactUrl: entry.artifactUrl,
      })
      if (result.error?.code === 'stale-approval') {
        setMessage(t('catalogChanged'))
        void refresh()
      } else if (result.application === 'applied' || result.application === 'restart-required') {
        setMessage(t('installed'))
        void refresh()
      } else {
        setMessage(t('installFailed'))
      }
    } catch {
      setMessage(t('installFailed'))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section className={css.section} aria-label={t('curatedTitle')}>
      {status === 'loading' && <p className={css.status} role="status">{t('loading')}</p>}
      {status === 'error' && <p className={css.status} role="alert">{t('error')} <button type="button" className={css.button} onClick={() => { void refresh() }}>{t('retry')}</button></p>}
      {message !== undefined && <p className={css.status} role="status">{message}</p>}
      {status === 'ready' && catalog?.plugins.length === 0 && <p className={css.status}>{t('empty')}</p>}
      <div className={css.cards}>
        {catalog?.plugins.map(entry => (
          <article className={css.card} key={entry.id}>
            <div className={css.copy}>
              <h2 className={css.name}>{entry.name}</h2>
              <p className={css.description}>{entry.description}</p>
              <div className={css.facts}>
                {entry.category !== undefined && <span>{entry.category}</span>}
                <span>{t('installedVersion')}: {entry.version}</span>
              </div>
            </div>
            <button type="button" className={css.button}
              disabled={entry.installed === true || busy !== undefined || status !== 'ready'}
              onClick={() => { void install(entry) }}>
              {busy === entry.id ? t('installing') : entry.installed === true ? t('installed') : t('install')}
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
