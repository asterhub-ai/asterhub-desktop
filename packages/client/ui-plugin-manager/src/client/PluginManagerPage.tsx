/**
 * The Plugins page: the sidebar entry is kept, and the surface is reserved
 * for the AsterHub plugin system — the upstream install and management UI is
 * intentionally not part of this fork.
 */
import css from './PluginManagerPage.module.css'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Full component props assembled by the main slot renderer. */
export type PluginManagerPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'pluginManager'>
  & PropsRenderSlots<'plugins.item' | 'plugins.bundle.config' | 'plugins.row.config'>

/**
 * Render the reserved Plugins surface.
 * @param props - the framework-composed page props.
 * @returns the placeholder page.
 */
export function PluginManagerPage(props: PluginManagerPageProps) {
  return (
    <div className={css.page}>
      <h1 className={css.title}>{props.t('title')}</h1>
      <p className={css.placeholder}>{props.t('placeholder')}</p>
    </div>
  )
}
