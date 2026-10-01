import { useId } from 'react'
import type { IconProps } from './icons/props.ts'

/** Render the compact AsterHub mark used across the workbench. */
export function AsterHubMark({ size = 24, className }: IconProps) {
  const gradientId = `asterhub-mark-${useId().replaceAll(':', '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="8" y1="5" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3B62D9" />
          <stop offset="0.55" stopColor="#6554D9" />
          <stop offset="1" stopColor="#8A4FCE" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${gradientId})`} />
      <g fill="#F8F8FF">
        <path d="M32 7.5C39.1 16.9 42.1 27.1 32 32C21.9 27.1 24.9 16.9 32 7.5Z" />
        <path d="M56.5 32C47.1 39.1 36.9 42.1 32 32C36.9 21.9 47.1 24.9 56.5 32Z" />
        <path d="M32 56.5C24.9 47.1 21.9 36.9 32 32C42.1 36.9 39.1 47.1 32 56.5Z" />
        <path d="M7.5 32C16.9 24.9 27.1 21.9 32 32C27.1 42.1 16.9 39.1 7.5 32Z" />
      </g>
      <circle cx="32" cy="32" r="5.5" fill="#2E367F" />
      <circle cx="32" cy="32" r="2.6" fill="#A8F1E9" />
    </svg>
  )
}
