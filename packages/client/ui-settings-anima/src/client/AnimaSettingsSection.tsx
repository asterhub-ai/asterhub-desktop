/** User-facing personality, reflection, and account-model preferences. */
import { useEffect } from 'react'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnimaFormFace } from './anima-settings-form.ts'
import { formLabels, type AnimaSettingsLocaleKey } from './locales.ts'
import css from './AnimaSettingsSection.module.css'

/** Renderer-derived props for the Anima settings section. */
export type AnimaSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.anima'> & InjectFace<AnimaFormFace>

const traits = [
  { field: 'tone', values: ['direct', 'balanced', 'warm'] },
  { field: 'responseDetail', values: ['concise', 'balanced', 'detailed'] },
  { field: 'initiative', values: ['reserved', 'balanced', 'proactive'] },
  { field: 'humor', values: ['none', 'light', 'playful'] },
  { field: 'emotionalSupport', values: ['practical', 'balanced', 'empathetic'] },
  { field: 'familiarity', values: ['formal', 'balanced', 'familiar'] },
  { field: 'jokeStyle', values: ['restrained', 'balanced', 'casual'] },
] as const

/**
 * Render editable personality choices and the shared available-model catalog.
 * @param props - Localized form snapshot and staged actions.
 * @returns Anima's dedicated settings page.
 */
export function AnimaSettingsSection(props: AnimaSettingsSectionProps) {
  const { t } = props
  const state = props.useAnimaForm(value => value)
  const disabled = !state.writable || state.saving
  useEffect(() => { props.loadModels() }, [props.loadModels])
  const missingModel = state.selectedModel !== 'session' && !state.models.some(model => model.id === state.selectedModel)
  return (
    <section className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        {state.dirty ? <button className={css.discard} type="button" disabled={state.saving} onClick={props.discard}>{t('discard')}</button> : null}
        <SettingsValueField id="anima-nickname" label={t('nickname')} hint={t('nicknameHint')} overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNickname')} disabled={disabled} {...state.fields.nickname} onEdit={(text) => { props.edit('nickname', text) }} onReset={() => { props.resetField('nickname') }} />
        <div className={css.modelHeading}><h3>{t('personalityHeading')}</h3><p>{t('personalityHint')}</p></div>
        <div className={css.traits}>
          {traits.map(({ field, values }) => (
            <div className={css.choiceRow} key={field}>
              <label htmlFor={`anima-${field}`}>{t(field)}</label>
              <select id={`anima-${field}`} value={state.fields[field].text} disabled={disabled} onChange={(event) => { props.edit(field, event.target.value) }}>
                {values.map(value => <option key={value} value={value}>{t(value)}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className={css.modelHeading}><h3>{t('modelHeading')}</h3><p>{t('modelIntro')}</p></div>
        <div className={css.choiceRow}>
          <label htmlFor="anima-model">{t('model')}</label>
          <select id="anima-model" value={state.selectedModel} disabled={disabled || state.modelStatus !== 'ready'} onChange={(event) => { props.selectModel(event.target.value) }}>
            <option value="session">{t('sessionModel')}</option>
            {missingModel ? <option value={state.selectedModel} disabled>{t('modelUnavailable')}</option> : null}
            {state.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </div>
        {state.modelStatus === 'loading' || state.modelStatus === 'idle' ? <p className={css.intro} role="status">{t('modelLoading')}</p> : null}
        {state.modelStatus === 'error' ? <p className={css.validation} role="alert">{t('modelError')} <button type="button" className={css.reset} onClick={props.loadModels}>{t('retry')}</button></p> : null}
        {missingModel && state.modelStatus === 'ready' ? <p className={css.validation} role="alert">{t('modelUnavailable')}</p> : null}
        <div className={css.toggleRow}>
          <label className={css.toggleLabel} htmlFor="anima-reflectionEnabled">{t('reflectionEnabled')}</label>
          <input id="anima-reflectionEnabled" type="checkbox" role="switch" checked={state.fields.reflectionEnabled.text === 'true'} disabled={disabled} aria-describedby="anima-reflection-hint" onChange={(event) => { props.edit('reflectionEnabled', String(event.target.checked)) }} />
        </div>
        <p id="anima-reflection-hint" className={css.intro}>{t('reflectionHint')}</p>
        <p className={css.privacy} role="note">{t('privacy')}</p>
      </SettingsForm>
    </section>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dedicated Anima settings page copy. */
    'settings.anima': AnimaSettingsLocaleKey
  }
}
