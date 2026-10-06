/** Catalog feedback for loading, error, retry, and auth-gate states. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogSnapshot } from './catalog-source.ts'
import css from './AutomationPanel.module.css'

/** Catalog status. */
type CatalogStatus = CatalogSnapshot<unknown>['status']

/** Feedback props. */
export interface AutomationFeedbackProps extends PropsLocale<'automation'> {
  readonly status: CatalogStatus
  readonly populated: boolean
  readonly onRetry: (readRequest: number) => Promise<void>
}

/**
 * Render loading, error, retry, or auth-gate feedback.
 * @param props - status, populated flag, retry callback, locale.
 * @returns feedback element.
 */
export function AutomationFeedback({ status, populated, onRetry, t }: AutomationFeedbackProps) {
  if (status === 'loading' && !populated) {
    return (
      <div className={css.empty} role="status" aria-live="polite">
        <p>{t('list.loading')}</p>
      </div>
    )
  }
  if (status === 'unauthorized') {
    return (
      <div className={css.empty} role="alert">
        <p>{t('error.unauthorized')}</p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className={css.empty} role="alert">
        <p>{t('list.error')}</p>
        <Button
          variant="outline"
          className={css.emptyAction}
          onClick={() => { void onRetry(0) }}
        >
          {t('list.retry')}
        </Button>
      </div>
    )
  }
  return null
}
