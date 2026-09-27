import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Render the AsterHub mark at the size requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the AsterHub mark.
 */
export function OfficialBrandMark({ size, className }: SidebarBrandMarkOwnerProps & { className?: string | undefined }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="asterhub-brand-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f7cff" />
          <stop offset="1" stopColor="#8a5cff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#asterhub-brand-mark)" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M32 14 L47 50 H39.6 L36.8 43 H27.2 L24.4 50 H17 Z M32 26.8 L28.2 36.4 H35.8 Z"
        fill="#fff"
      />
    </svg>
  )
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
  return <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.2 }}>AsterHub</span>
}
