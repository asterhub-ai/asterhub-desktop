/** Staged personality preferences and catalog-owned model choices. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'

/** Host configuration namespace this page edits. */
export const ANIMA_SETTINGS_NS = 'anima'

/** User-facing personality and processing preferences. */
export interface AnimaSettings {
  /** Assistant nickname. */
  nickname?: string
  /** Communication tone. */
  tone?: string
  /** Preferred explanation depth. */
  responseDetail?: string
  /** Preferred amount of suggestions. */
  initiative?: string
  /** Humor frequency. */
  humor?: string
  /** Emotional response style. */
  emotionalSupport?: string
  /** Interpersonal distance. */
  familiarity?: string
  /** Joke informality. */
  jokeStyle?: string
  /** Enable reflection while capture and recall remain built in. */
  reflectionEnabled?: boolean
  /** Host provider id, selected only through the available catalog. */
  modelProvider?: string
  /** Host model id, selected only through the available catalog. */
  model?: string
}

const fields: SettingsFieldSpec[] = [
  { ...settingsTextField('nickname'), parse: text => text.trim().length > 0 && text.trim().length <= 40 ? { kind: 'set', value: text.trim() } : undefined },
  ...[
    ['tone', ['direct', 'balanced', 'warm']],
    ['responseDetail', ['concise', 'balanced', 'detailed']],
    ['initiative', ['reserved', 'balanced', 'proactive']],
    ['humor', ['none', 'light', 'playful']],
    ['emotionalSupport', ['practical', 'balanced', 'empathetic']],
    ['familiarity', ['formal', 'balanced', 'familiar']],
    ['jokeStyle', ['restrained', 'balanced', 'casual']],
  ].map(([field, values]): SettingsFieldSpec => ({
    ...settingsTextField(String(field)),
    parse: text => Array.isArray(values) && values.includes(text) ? { kind: 'set', value: text } : undefined,
  })),
  { field: 'reflectionEnabled', format: value => typeof value === 'boolean' ? String(value) : '',
    parse: text => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined },
  settingsTextField('modelProvider'), settingsTextField('model'),
]

/** One opaque option resolved against the current AsterHub catalog. */
export interface AnimaModelChoice {
  /** Opaque lookup key. */
  id: string
  /** Account-advertised display name. */
  label: string
  /** Exact Host provider route. */
  provider: string
  /** Exact Host model route. */
  model: string
}

/** Complete visual state for the Anima settings form. */
export interface AnimaFormState extends SettingsFormShell {
  /** Visible personality values and internal paired model fields. */
  fields: Record<keyof AnimaSettings, SettingsFieldState>
  /** Available models from the shared Host-generation catalog. */
  models: readonly AnimaModelChoice[]
  /** Current selected option, or session for the session route. */
  selectedModel: string
  /** Shared catalog loading lifecycle. */
  modelStatus: 'idle' | 'loading' | 'ready' | 'error'
}

/** Snapshot and actions supplied to the settings section renderer. */
export interface AnimaFormFace extends SettingsFormActions {
  /** Form snapshot. */
  hooks: { animaForm: SnapshotStore<AnimaFormState> }
  /** Stage one currently available model, or follow the session route.
   * @param id - Opaque catalog option key or session.
   */
  selectModel: (id: string) => void
  /** Reload the shared available models. */
  loadModels: () => void
}

/** Owns staged preferences and refuses models absent from the live catalog. */
export class AnimaSettingsForm {
  private readonly form: SettingsFormModel<AnimaSettings>
  private readonly store: SnapshotStore<AnimaFormState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - Host settings document for the anima namespace.
   * @param catalog - Shared catalog also used by the conversation model picker.
   */
  constructor(scope: SettingsFormScope<AnimaSettings>, private readonly catalog: Pick<ModelDirectoryResolver['catalog'], 'store' | 'load'>) {
    this.form = new SettingsFormModel(scope, fields)
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = catalog.store.subscribe(() => { this.store.set(this.projection()) })
  }

  /**
   * Build the snapshot and guarded actions consumed by the renderer.
   * @returns The form face, including catalog-backed selection and retry.
   */
  inject(): AnimaFormFace {
    const actions = this.form.actions()
    return {
      hooks: { animaForm: this.store }, ...actions,
      edit: (field, text) => { if (field !== 'modelProvider' && field !== 'model') actions.edit(field, text) },
      save: () => { if (!this.projection().invalid) actions.save() },
      selectModel: (id) => {
        if (id === 'session') {
          actions.edit('modelProvider', '')
          actions.edit('model', '')
          return
        }
        const choice = this.projection().models.find(model => model.id === id)
        if (choice === undefined) return
        actions.edit('modelProvider', choice.provider)
        actions.edit('model', choice.model)
      },
      loadModels: () => { void this.catalog.load().catch(() => { /* The shared catalog snapshot exposes the failure. */ }) },
    }
  }

  /** Release subscriptions when the settings owner is disposed. */
  dispose(): void { this.unsubscribe(); this.form.dispose() }

  private projection(): AnimaFormState {
    const shell = this.form.shell()
    const fields = {
      nickname: this.form.field('nickname'), tone: this.form.field('tone'), responseDetail: this.form.field('responseDetail'),
      initiative: this.form.field('initiative'), humor: this.form.field('humor'), emotionalSupport: this.form.field('emotionalSupport'),
      familiarity: this.form.field('familiarity'), jokeStyle: this.form.field('jokeStyle'), reflectionEnabled: this.form.field('reflectionEnabled'),
      modelProvider: this.form.field('modelProvider'), model: this.form.field('model'),
    }
    const catalog = this.catalog.store.getSnapshot()
    const models = (catalog.value?.groups ?? []).flatMap(group => group.models.map(model => ({
      id: JSON.stringify([group.id, model.id]), label: model.name, provider: group.id, model: model.id,
    })))
    const provider = fields.modelProvider.text.trim(), model = fields.model.text.trim()
    const selectedModel = provider === '' && model === '' ? 'session' : JSON.stringify([provider, model])
    const invalidModel = selectedModel !== 'session' && (catalog.status !== 'ready' || !models.some(choice => choice.id === selectedModel))
    return { ...shell, fields, models, selectedModel, modelStatus: catalog.status, invalid: shell.invalid || invalidModel }
  }
}
