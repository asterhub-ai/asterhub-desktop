/**
 * The Plugins settings entry: the entry is kept, and the surface is reserved
 * for the AsterHub plugin system — the upstream built-in-plugin configuration
 * UI is intentionally not part of this fork.
 */
import css from './PluginsSettingsSection.module.css'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Props the renderer binds for the section. */
export type PluginsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugins.tab'>

/**
 * Render the reserved Plugins settings surface.
 * @param props - the framework-composed section props.
 * @returns the placeholder section.
 */
export function PluginsSettingsSection(props: PluginsSettingsSectionProps) {
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{props.t('title')}</h2>
      <p className={css.placeholder}>{props.t('placeholder')}</p>
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins settings entry copy. */
    'settings.plugins': keyof typeof import('./locales.ts').zh
  }
}
