/** User-selected defaults for subagent delegation. */

import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentModelSelectionCardFace, SubagentModelSelectionCardState } from './subagent-model-selection-card-controller.ts'
import css from './SubagentModelSelectionFields.module.css'

/** Plain defaults and callbacks supplied by the owning card. */
export type SubagentModelSelectionFieldsProps = PropsLocale<'settings.subagent'>
  & Pick<SubagentModelSelectionCardFace, 'retryCatalog' | 'chooseDefaultModel' | 'toggleDelegation'>
  & { state: SubagentModelSelectionCardState }

/**
 * Render user-owned model and delegation preferences.
 * @param props - Localized labels, current settings, and edit actions.
 * @returns Default model choices and the delegation preference.
 */
export function SubagentModelSelectionFields(props: SubagentModelSelectionFieldsProps) {
  const { t, state } = props
  return (
    <>
      {state.catalogStatus === 'loading' ? <p className={css.notice} role="status">{t('subagentModelSelectionLoading')}</p> : null}
      <fieldset className={css.models}>
        <legend>{t('subagentDefaultModel')}</legend>
        <p className={css.hint}>{t('subagentDefaultModelHint')}</p>
        <label className={css.model}>
          <input type="radio" name="subagent-default-model" checked={!state.defaultModelKey}
            disabled={!state.writable || state.saving} onChange={() => { props.chooseDefaultModel('') }} />
          <span>{t('subagentDefaultInherit')}</span>
        </label>
        {state.candidates.map(candidate => (
          <label key={candidate.key} className={css.model}>
            <input type="radio" name="subagent-default-model" checked={state.defaultModelKey === candidate.key}
              disabled={!state.writable || state.saving || !candidate.available}
              onChange={() => { props.chooseDefaultModel(candidate.key) }} />
            <span>{candidate.modelName} · {candidate.providerName}</span>
            {!candidate.available ? <span>{t('subagentModelSelectionUnavailable')}</span> : null}
          </label>
        ))}
        <button type="button" disabled={state.saving || state.catalogStatus === 'loading'} onClick={props.retryCatalog}>
          {t('subagentDefaultLoadModels')}
        </button>
        {state.catalogStatus === 'error'
          ? (
            <div className={css.catalogError} role="alert">
              <span>{t('subagentModelSelectionLoadFailed')}</span>
              <button type="button" disabled={state.saving} onClick={props.retryCatalog}>{t('subagentModelSelectionRetry')}</button>
            </div>
          )
          : null}
      </fieldset>
      <div className={css.permission}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('subagentDelegateComplex')}</span>
          <Switch checked={state.delegateComplexTasks ?? false} label={t('subagentDelegateComplex')}
            disabled={!state.writable || state.saving} onChange={props.toggleDelegation} />
        </div>
        <p className={css.hint}>{t('subagentDelegateComplexHint')}</p>
      </div>
      {state.conflicted ? <p className={css.conflict} role="status">{t('subagentModelSelectionConflict')}</p> : null}
    </>
  )
}
