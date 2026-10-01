import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AsterHubMark } from '@deepseek-ai/dsh-client-ui-primitives'
import { brandName } from './locales.ts'

/**
 * Render the AsterHub mark at the size requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the AsterHub mark.
 */
export function OfficialBrandMark({ size, className }: SidebarBrandMarkOwnerProps & { className?: string | undefined }) {
  return <AsterHubMark size={size} className={className} />
}

/**
 * Render the AsterHub mark inside the conversation hero slot.
 * @param props - Host-supplied mark presentation.
 * @returns the AsterHub mark.
 */
export function OfficialHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <OfficialBrandMark size={size} className={className} />
}

/**
 * Render the AsterHub name as the sidebar wordmark.
 * @returns the AsterHub name.
 */
export function OfficialBrandName() {
  return <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.2 }}>{brandName}</span>
}
