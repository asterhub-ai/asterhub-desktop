import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AsterHubMark } from '@deepseek-ai/dsh-client-ui-primitives'
import { brandName } from './locales.ts'

/**
 * Render the AsterHub mark at the size requested by its host surface. The
 * artwork carries its own opaque gradient tile, so it stays legible on dark
 * and light themes alike; the glyph is decorative (`aria-hidden`).
 * @param props - Host-supplied mark presentation.
 * @returns the AsterHub star mark.
 */
export function AsterHubBrandMark({ size, className }: SidebarBrandMarkOwnerProps & { className?: string | undefined }) {
  return <AsterHubMark size={size} className={className} />
}

/**
 * Render the AsterHub mark inside the conversation hero slot.
 * @param props - Host-supplied mark presentation.
 * @returns the AsterHub star mark.
 */
export function AsterHubHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <AsterHubMark size={size} className={className} />
}

/**
 * Render the AsterHub name as the sidebar wordmark. Plain text inherits the
 * surrounding color, keeping it readable in both themes.
 * @param _props - Owner marker props (the occupant owns its own content).
 * @returns the AsterHub name.
 */
export function AsterHubBrandName(_props: SidebarBrandNameOwnerProps) {
  return <span>{brandName}</span>
}
