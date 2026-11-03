/**
 * AsterHub curated plugin catalog, browser half: the Plugins page tab over the
 * signature-verified `pluginManager` curated catalogue, ported from the
 * pre-merge embedded curated section of `ui-plugin-manager`.
 */
import type { ChangeResult, CuratedPluginCatalog } from '@deepseek-ai/dsh-plugin-manager/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.remote Context merge, and the `plugins.tab` slot
// declaration the page's `slot-contract.ts` owns.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { createElement, useEffect, useState } from 'react'
import { CatalogSection } from './CatalogSection.tsx'
import { en, zh, type AsterhubCatalogLocaleKey } from './locales.ts'

export type { CatalogSectionProps } from './CatalogSection.tsx'
export type { AsterhubCatalogLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Curated catalog tab copy. */
    'asterhubCatalog': AsterhubCatalogLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'asterhubCatalog'

/** Services required by the tab registration. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager']

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

/**
 * Contribute the curated catalog tab to the Plugins page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-asterhub-catalog: dictionaries')
  const t = ctx.locale.bind(NS)
  const Tab = (props: Parameters<typeof CatalogSection>[0]) => {
    const [catalog, setCatalog] = useState<CuratedPluginCatalog>()
    const [loading, setLoading] = useState(true)
    const [unavailable, setUnavailable] = useState(false)
    const [busy, setBusy] = useState<string>()
    const [message, setMessage] = useState<string>()
    const load = () => {
      setLoading(true)
      setUnavailable(false)
      void ctx.remote.pluginManager.curatedCatalog()
        .then((catalogResult) => {
          setCatalog(unwrap(catalogResult))
        })
        .catch(() => { setUnavailable(true) })
        .finally(() => { setLoading(false) })
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
          integrity: entry.integrity,
          artifactUrl: entry.artifactUrl,
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
    return createElement(CatalogSection, {
      ...props,
      ...catalog === undefined ? {} : { catalog },
      loading,
      unavailable,
      ...busy === undefined ? {} : { busy },
      ...message === undefined ? {} : { message },
      onInstall: install,
    })
  }
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: 'asterhub-catalog', label: () => t('title'), locale: NS,
  }, Tab))
  // The Settings → curated plugins section hosts the same catalogue as a tab
  // (the pre-merge layout strategy; the vanilla read-only inventory tab is
  // disabled in the asterhub-product-web patch).
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'asterhub-catalog', order: 10, label: () => t('title'), locale: NS,
  }, Tab))
}
