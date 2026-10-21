/** Staged editor for the Host-owned subagent model default. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'

/** Namespace of the Host-owned subagent model preference. */
export const SUBAGENT_MODEL_SELECTION_NS = 'subagent-model-selection-settings'

/** One exact provider/model route. */
export interface AllowedSubagentModel {
  provider: string
  model: string
}

/** Settings fields stored for subagent defaults. */
export interface SubagentModelSelectionSettings {
  /** Legacy per-call selection fields retained for config compatibility. */
  enabled: boolean
  allowedModels: AllowedSubagentModel[]
  /** Zero or one catalog-selected default; empty inherits the parent model. */
  defaultModels?: AllowedSubagentModel[]
  /** Prefer bounded delegation of complex main-session tasks. */
  delegateComplexTasks?: boolean
}

/** One catalog row joined with a saved route that may no longer be advertised. */
export interface SubagentModelCandidate extends AllowedSubagentModel {
  key: string
  providerName: string
  modelName: string
  available: boolean
  selected: boolean
}

/** State rendered by the staged default-model card. */
export interface SubagentModelSelectionCardState extends SettingsFormShell {
  enabled: boolean
  defaultModelKey?: string
  delegateComplexTasks?: boolean
  candidates: readonly SubagentModelCandidate[]
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  catalogPartial: boolean
  conflicted: boolean
}

/** Registration-side face for the model-default card. */
export interface SubagentModelSelectionCardFace {
  hooks: { subagentModelSelectionCard: SnapshotStore<SubagentModelSelectionCardState> }
  chooseDefaultModel: (key: string) => void
  toggleDelegation: () => void
  retryCatalog: () => void
  save: () => void
  discard: () => void
}

/**
 * Identify one provider/model route independently of object identity.
 * @param route - Route to identify.
 * @returns An opaque route key.
 */
export function subagentModelKey(route: AllowedSubagentModel): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Join the current catalog with a stored route so unavailable defaults can be cleared.
 * @param groups - Current model directory grouped by provider.
 * @param stored - Routes in effective settings.
 * @param selected - Selected opaque route keys.
 * @returns Catalog rows and stored routes absent from the catalog.
 */
export function subagentModelCandidates(
  groups: readonly ModelProviderGroup[], stored: readonly AllowedSubagentModel[], selected: ReadonlySet<string>,
): SubagentModelCandidate[] {
  const saved = new Map(stored.map(route => [subagentModelKey(route), route]))
  const candidates = groups.flatMap(group => group.models.map((model) => {
    const route = { provider: group.id, model: model.id }
    const key = subagentModelKey(route)
    saved.delete(key)
    return { ...route, key, providerName: group.name, modelName: model.name, available: true, selected: selected.has(key) }
  }))
  for (const route of saved.values()) {
    const key = subagentModelKey(route)
    candidates.push({ ...route, key, providerName: route.provider, modelName: route.model, available: false, selected: selected.has(key) })
  }
  return candidates
}

function sameRoutes(left: readonly AllowedSubagentModel[], right: readonly AllowedSubagentModel[]): boolean {
  return left.length === right.length && left.every(route => right.some(value => subagentModelKey(value) === subagentModelKey(route)))
}

/** Bridges the settings form and live account catalog onto a staged default-model card. */
export class SubagentModelSelectionCardController {
  private groups: readonly ModelProviderGroup[] = []
  private catalogPartial = false
  private catalogStatus: SubagentModelSelectionCardState['catalogStatus'] = 'idle'
  private catalogLoad: Promise<void> | undefined
  private draftDefaults: AllowedSubagentModel[] | undefined
  private draftDelegation: boolean | undefined
  private draftRevision: number | undefined
  private saving = false
  private failed = false
  private conflicted = false
  private disposed: boolean = false
  private ready = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private catalogLoadId: symbol | undefined
  private readonly store: SnapshotStore<SubagentModelSelectionCardState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - Bound Host settings form.
   * @param ctx - Context whose remote session namespace returns the current model catalog.
   */
  constructor(private readonly scope: SettingsFormScope<SubagentModelSelectionSettings>, private readonly ctx: ClientContext) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      const snapshot = scope.getSnapshot()
      if (snapshot.status === 'ready' && !this.ready) {
        this.ready = true
        if (this.defaults().length > 0 && this.catalogStatus === 'idle') void this.loadCatalog()
      }
      if (!this.saving && this.draftRevision !== undefined && scope.getSnapshot().revision !== this.draftRevision) {
        if (this.preferencesMatch()) this.clearDraft()
        else this.conflicted = true
      }
      if ((this.defaults().length > 0 || this.draftDefaults !== undefined) && this.catalogStatus === 'idle') void this.loadCatalog()
      this.publish()
    })
    if (this.defaults().length > 0) void this.loadCatalog()
  }

  /** Stop observing settings and suppress late catalog and write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.catalogLoadId = undefined
    this.catalogLoad = undefined
    this.unsubscribe()
  }

  /**
   * Publish the card snapshot and its staged actions to the renderer.
   * @returns The renderer-bound snapshot and staged card actions.
   */
  inject(): SubagentModelSelectionCardFace {
    return {
      hooks: { subagentModelSelectionCard: this.store },
      chooseDefaultModel: (key) => { this.chooseDefaultModel(key) },
      toggleDelegation: () => { this.toggleDelegation() },
      retryCatalog: () => { void this.loadCatalog() },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private defaults(): AllowedSubagentModel[] { return this.scope.getSnapshot().value?.defaultModels ?? [] }
  private desiredDefaults(): AllowedSubagentModel[] { return this.draftDefaults ?? this.defaults() }
  private delegation(): boolean { return this.draftDelegation ?? this.scope.getSnapshot().value?.delegateComplexTasks ?? false }

  private preferencesMatch(): boolean {
    return sameRoutes(this.defaults(), this.desiredDefaults())
      && (this.scope.getSnapshot().value?.delegateComplexTasks ?? false) === this.delegation()
  }

  private beginDraft(): void {
    if (this.draftRevision !== undefined) return
    const snapshot = this.scope.getSnapshot()
    this.draftDefaults = this.defaults().map(route => ({ ...route }))
    this.draftDelegation = snapshot.value?.delegateComplexTasks ?? false
    this.draftRevision = snapshot.revision
  }

  private chooseDefaultModel(key: string): void {
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || this.saving || snapshot.status !== 'ready' || !snapshot.writable) return
    const candidate = this.candidates().find(value => value.key === key && value.available)
    if (key !== '' && candidate === undefined) {
      if (this.catalogStatus === 'idle') void this.loadCatalog()
      return
    }
    this.beginDraft()
    this.draftDefaults = candidate ? [{ provider: candidate.provider, model: candidate.model }] : []
    this.failed = false
    if (candidate && this.catalogStatus === 'idle') void this.loadCatalog()
    this.publish()
  }

  private toggleDelegation(): void {
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || this.saving || snapshot.status !== 'ready' || !snapshot.writable) return
    this.beginDraft()
    this.draftDelegation = !this.delegation()
    this.failed = false
    this.publish()
  }

  private clearDraft(): void {
    this.draftDefaults = undefined
    this.draftDelegation = undefined
    this.draftRevision = undefined
    this.failed = false
    this.conflicted = false
  }

  private discard(): void {
    if (this.saving) return
    this.clearDraft()
    this.publish()
  }

  private candidates(): SubagentModelCandidate[] {
    const routes = new Map(this.defaults().map(route => [subagentModelKey(route), route]))
    for (const route of this.desiredDefaults()) routes.set(subagentModelKey(route), route)
    return subagentModelCandidates(this.groups, [...routes.values()], new Set(this.desiredDefaults().map(subagentModelKey)))
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving || this.preferencesMatch()) return
    if (this.draftRevision !== snapshot.revision) { this.conflicted = true; this.publish(); return }
    const desiredDefaults = this.desiredDefaults().map(route => ({ ...route }))
    const desiredDelegation = this.delegation()
    const generation = this.saveGeneration
    const operations = [
      ...!sameRoutes(this.defaults(), desiredDefaults)
        ? [{ op: 'set' as const, path: ['defaultModels'], value: desiredDefaults }] : [],
      ...(snapshot.value?.delegateComplexTasks ?? false) !== desiredDelegation
        ? [{ op: 'set' as const, path: ['delegateComplexTasks'], value: desiredDelegation }] : [],
    ]
    this.saving = true
    this.failed = false
    this.conflicted = false
    this.publish()
    const accepted = await this.scope.mutate(operations, snapshot.revision)
    if (generation !== this.saveGeneration) return
    this.saving = false
    this.failed = !accepted || !this.preferencesMatch()
    if (!this.failed) this.clearDraft()
    this.publish()
  }

  /** Reload model candidates after a Host model input changes. */
  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalogLoad = undefined
    this.catalogLoadId = undefined
    this.catalogStatus = 'idle'
    this.catalogPartial = false
    if (this.defaults().length > 0 || this.draftDefaults !== undefined) void this.loadCatalog()
    else this.publish()
  }

  /** Drop Host-specific candidates and drafts, then reload after reconnecting. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.clearDraft()
    this.groups = []
    this.refreshCatalog()
  }

  private loadCatalog(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.catalogStatus === 'loading') return this.catalogLoad ?? Promise.resolve()
    const generation = this.catalogGeneration
    const loadId = Symbol('catalog load')
    this.catalogLoadId = loadId
    this.catalogStatus = 'loading'
    this.catalogPartial = false
    this.publish()
    const load = this.ctx.remote.session.modelCatalog().then((response) => {
      if (generation !== this.catalogGeneration) {
        if (this.catalogLoadId === loadId) {
          this.catalogLoad = undefined
          this.catalogLoadId = undefined
          this.catalogStatus = 'idle'
          this.publish()
        }
        return
      }
      if (response.ok) {
        this.groups = response.value.groups
        this.catalogPartial = response.value.failures.length > 0
        this.catalogStatus = 'ready'
      } else this.catalogStatus = 'error'
      this.catalogLoad = undefined
      this.catalogLoadId = undefined
      this.publish()
    })
    this.catalogLoad = load
    return load
  }

  private projection(): SubagentModelSelectionCardState {
    const snapshot = this.scope.getSnapshot()
    const selected = this.desiredDefaults()[0]
    return {
      available: snapshot.status === 'ready', writable: snapshot.writable,
      dirty: !this.preferencesMatch(), invalid: false, saving: this.saving, failed: this.failed,
      enabled: false, defaultModelKey: selected ? subagentModelKey(selected) : '',
      delegateComplexTasks: this.delegation(), candidates: this.candidates(), catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial, conflicted: this.conflicted,
    }
  }

  private publish(): void { this.store.set(this.projection()) }
}
