/** Anima settings page, browser half. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AnimaSettingsSection } from './AnimaSettingsSection.tsx'
import { ANIMA_SETTINGS_NS, AnimaSettingsForm } from './anima-settings-form.ts'
import { en, zh } from './locales.ts'

/** Services required by the browser half. */
export const inject = ['slots', 'locale', 'configForms', 'modelDirectories']
const NS = 'settings.anima'

/** Register the localized Anima settings page while its Host namespace is served.
 * @param ctx - the browser plugin context.
 * @returns nothing; registrations follow the plugin fiber lifecycle.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-anima: dictionaries')
  const form = new AnimaSettingsForm(ctx.configForms.get(ANIMA_SETTINGS_NS), ctx.modelDirectories.catalog)
  ctx.effect(() => () => { form.dispose() }, 'ui-settings-anima: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([ANIMA_SETTINGS_NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'anima', order: 30, label: () => t('nav'), locale: NS, inject: () => form.inject(),
  }, AnimaSettingsSection))), 'ui-settings-anima: page')
}
