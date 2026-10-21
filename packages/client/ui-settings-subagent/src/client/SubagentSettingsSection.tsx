/** Direct Settings entry for the shared Subagent configuration form. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SubagentCard } from './SubagentCard.tsx'
import type { SubagentCardFace } from './subagent-card-controller.ts'

type SubagentSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.subagent'> & InjectFace<SubagentCardFace>

/** Render the Subagent form without a Plugin Manager navigation dependency.
 * @param props - Framework locale, form snapshots, and save callbacks.
 * @returns The shared configuration form in page mode.
 */
export function SubagentSettingsSection(props: SubagentSettingsSectionProps) {
  return <SubagentCard {...props} view="page" />
}
