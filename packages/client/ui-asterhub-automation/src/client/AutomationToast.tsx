/** Toast notification overlay for automation operations. */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToastSnapshot } from './toast-source.ts'

/** Injected toast hooks. */
export interface AutomationToastInjected {
  readonly hooks: {
    readonly toasts: HostObservable<ToastSnapshot>
  }
  readonly dismiss: (id: number) => void
}

/** Toast props. */
export type AutomationToastProps = InjectFace<AutomationToastInjected> & PropsLocale<'automation'>

/**
 * Render automation toast notifications.
 * @param props - toast hooks and locale.
 * @returns toast overlay.
 */
export function AutomationToast({ useToasts, dismiss, t }: AutomationToastProps) {
  const snapshot = useToasts(s => s)
  const { toasts } = snapshot
  if (toasts.length === 0) return null
  return (
    <div data-testid="automation-toast-overlay">
      {toasts.map((toast) => {
        const text = toast.message ?? t(`toast.${toast.kind}` as const)
        return (
          <Toast key={toast.id} text={text} onDone={() => { dismiss(toast.id) }} />
        )
      })}
    </div>
  )
}
