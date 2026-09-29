/**
 * The Plugins entry, browser half: the sidebar entry and the main-column page
 * it opens. The upstream install and management machinery is intentionally
 * not part of this fork — the entry stays and the surface is reserved for the
 * AsterHub plugin system. The slot declarations below (`plugins.item` and the
 * per-row configuration seats) keep the slot contract available for that
 * system to grow into; see `slot-contract.ts`.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, useEffect, useState } from 'react'
// Type-only: the root `main` keyed slot the page registers into, declared by
// ui-layout with the panel id brand, and the `sidebar.panellist` list the
// entry registers into, declared by ui-sidebar.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PluginManagerPage } from './PluginManagerPage.tsx'
import { PluginsPanelIcon } from './PluginsPanelIcon.tsx'
import { en, zh, type PluginManagerLocaleKey } from './locales.ts'
import type { PluginConfigViewProps } from './slot-contract.ts'
import type { ChangeResult, CuratedPluginCatalog } from '@deepseek-ai/dsh-plugin-manager'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'

export type { PluginManagerPageProps } from './PluginManagerPage.tsx'
export type { PluginManagerLocaleKey } from './locales.ts'
export type { PluginConfigViewProps } from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins tab copy. */
    'pluginManager': PluginManagerLocaleKey
  }

  /**
   * The slots the Plugins page declares for plugins that carry their own
   * configuration. Kept inline (beside the mirror in `slot-contract.ts`) so
   * the augmentation survives dts bundling into the published types.
   */
  interface SlotMap {
    /**
     * One official plugin the Plugins page lists in its Official group after
     * the official bundles: `label` is the card's title and `order` its place.
     * The page renders the entry as the card's one-liner (`view: 'summary'`)
     * and, once the card is opened, as the body of the plugin's own page
     * (`view: 'page'`). OCCUPIED by the host-plane configuration pages
     * `ui-settings-plugins` ships; a bundle's configuration belongs in
     * `plugins.bundle.config` or `plugins.row.config` instead.
     */
    'plugins.item': { kind: 'list'; scope: 'root'; owner: PluginConfigViewProps }
    /**
     * A bundle's own configuration, keyed by the bundle's package name and
     * rendered on the bundle's page between its description and its rows
     * (`view: 'page'` only).
     */
    'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }
    /**
     * The configuration of one row a bundle declares, keyed by
     * `<package name>#<row id>` with the row id as the bundle's patch declares
     * it: the row on the bundle's page gains a configure control that opens
     * the entry's page, headed by the row id and the entry's summary.
     */
    'plugins.row.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginManager'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'plugins' as MainPanelId

/** Services required by the sidebar registration. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager']

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

/**
 * Contribute the Plugins entry to the sidebar with the reserved page it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const Page = (props: Parameters<typeof PluginManagerPage>[0]) => {
    const [catalog, setCatalog] = useState<CuratedPluginCatalog>()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [busy, setBusy] = useState<string>()
    const [message, setMessage] = useState<string>()
    const load = () => {
      setLoading(true)
      setError(false)
      void ctx.remote.pluginManager.curatedCatalog()
        .then((catalogResult) => {
          setCatalog(unwrap(catalogResult))
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false))
    }
    useEffect(() => { load() }, [])
    const install = async (entry: CuratedPluginCatalog['plugins'][number]): Promise<void> => {
      if (catalog === undefined) return
      setBusy(entry.id)
      setMessage(undefined)
      try {
        const result: ChangeResult = unwrap(await ctx.remote.pluginManager.installCuratedBundle({
          id: entry.id,
          revision: catalog.revision,
          package: entry.package,
          version: entry.version,
          ...entry.artifactUrl === undefined ? {} : { artifactUrl: entry.artifactUrl },
          integrity: entry.integrity,
        }))
        if (result.error?.code === 'stale-approval') {
          setMessage(t('catalogChanged'))
          load()
          return
        }
        if (result.application === 'applied' || result.application === 'restart-required') {
          setMessage(t('installed'))
          load()
        } else {
          setMessage(t('installFailed'))
        }
      } catch {
        setMessage(t('installFailed'))
      } finally {
        setBusy(undefined)
      }
    }
    return createElement(PluginManagerPage, {
      ...props,
      ...catalog === undefined ? {} : { catalog },
      loading,
      unavailable: error,
      ...busy === undefined ? {} : { busy },
      ...message === undefined ? {} : { message },
      onInstall: install,
    })
  }

  // The page is a global panel: it belongs to the profile, not to a Session,
  // and the sidebar's entry selects it. The children keep the slot contract
  // declared so the future AsterHub plugin system can register into it.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    children: {
      'plugins.item': { kind: 'list', scope: 'root' },
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'plugins.row.config': { kind: 'keyed', scope: 'root' },
    },
  }, Page))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 0,
    label: () => t('panel'),
    locale: NS,
  }, PluginsPanelIcon))
}
