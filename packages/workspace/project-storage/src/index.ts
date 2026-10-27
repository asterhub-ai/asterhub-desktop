import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session/cwd'
import type {
  LegacySourceProvider, OpenProjectRequest, PortableProjectManifest, ProjectBinding,
  ProjectId, ProjectInspection, ProjectLegacyAdopter, ProjectSessionLocation, ProjectStorage, ProjectStorageChanged, ProjectStorageOptions,
} from './types.ts'
import { ProjectStorageRegistry } from './registry.ts'

/** Host-facing Cordis service. Register at startup independently of Workspace and Session persistence. */
export class ProjectStorageService extends Service implements ProjectStorage {
  static inject = ['sessionCwd']
  private registry: ProjectStorageRegistry | undefined
  static Config: z<ProjectStorageOptions> = z.object({
    sessionMode: z.union(['grouped', 'project-local'] as const).required(),
    locatorPath: z.string().min(1).required(),
    legacySessionRoot: z.string().required(),
    metadataLimitBytes: z.number().step(1).min(1).required(),
    lockDeadlineMs: z.number().step(1).min(1).required(),
  })

  constructor(ctx: Context, private readonly options: ProjectStorageOptions) {
    super(ctx, 'projectStorage')
  }

  protected async [Service.init](): Promise<void> {
    this.registry = await ProjectStorageRegistry.create(this.options)
    const registry = this.registry
    this.ctx.effect(() => registry.onChanged((change) => { this.ctx.emit('project-storage/changed', change) }), 'projectStorage.changed')
    this.ctx.effect(
      () => this.ctx.sessionCwd.registerResolver(header => this.executionCwd(header)),
      'projectStorage.sessionCwd',
    )
  }

  /**
   * Register read-only legacy discovery for this plugin lifetime.
   * @param provider - Plugin-owned legacy discovery callback.
   * @returns Disposer that unregisters this discovery source.
   */
  registerLegacySource(provider: LegacySourceProvider): () => void | Promise<void> {
    const registry = this.requireRegistry()
    return this.ctx.effect(() => registry.registerLegacySource(provider), 'projectStorage.registerLegacySource')
  }
  /**
   * Register the single legacy adoption implementation for this plugin lifetime.
   * @param adopter - Plugin-owned callback that copies and verifies confirmed history.
   * @returns Disposer that unregisters this adopter.
   */
  registerLegacyAdopter(adopter: ProjectLegacyAdopter): () => void | Promise<void> {
    const registry = this.requireRegistry()
    return this.ctx.effect(() => registry.registerLegacyAdopter(adopter), 'projectStorage.registerLegacyAdopter')
  }
  /**
   * Inspect project metadata and registration without publishing a binding.
   * @param root - Selected project directory.
   * @param signal - Optional filesystem cancellation.
   * @returns Validated new, existing, registered, or legacy project state.
   */
  inspect(root: string, signal?: AbortSignal): Promise<ProjectInspection> { return this.requireRegistry().inspect(root, signal) }
  /**
   * Confirm and publish a project binding after validating its current metadata.
   * @param request - Root, explicit open mode, and inspected confirmation facts.
   * @param signal - Optional mutation cancellation.
   * @returns Durable binding for the canonical project root.
   */
  open(request: OpenProjectRequest, signal?: AbortSignal): Promise<ProjectBinding> { return this.requireRegistry().open(request, signal) }
  /**
   * Read the machine-local project registry.
   * @returns Snapshot of registered project bindings.
   */
  list(): readonly ProjectBinding[] { return this.requireRegistry().list() }
  /**
   * Observe the current availability of one registered project.
   * @param id - Registered project identity.
   * @param signal - Optional filesystem cancellation.
   * @returns Available, missing, or read-only status.
   */
  status(id: ProjectId, signal?: AbortSignal): Promise<'available' | 'missing' | 'read-only'> { return this.requireRegistry().status(id, signal) }
  /**
   * Read the validated manifest for a registered project.
   * @param id - Registered project identity.
   * @returns Current portable manifest snapshot.
   */
  manifest(id: ProjectId): PortableProjectManifest { return this.requireRegistry().manifest(id) }
  /**
   * Persist one Session's membership in its registered project.
   * @param header - Immutable Session identity and execution directory.
   * @param signal - Optional mutation cancellation.
   * @returns Project-owned Session and attachment locations.
   */
  bindSession(header: SessionHeader, signal?: AbortSignal): Promise<ProjectSessionLocation> {
    return this.requireRegistry().bindSession(header, signal)
  }
  /**
   * Resolve Session storage from registered project membership.
   * @param id - Session identity to locate.
   * @returns Project-owned locations, or undefined when no project owns the Session.
   */
  locateSession(id: SessionId): ProjectSessionLocation | undefined { return this.requireRegistry().locateSession(id) }
  /**
   * Resolve a Session's execution directory through its portable project membership.
   * @param header - Session whose registered membership is being resolved.
   * @returns Project-bound execution directory, or undefined when unregistered.
   */
  executionCwd(header: SessionHeader): string | undefined { return this.requireRegistry().executionCwd(header) }
  /**
   * Delete one project's Session log files and portable membership.
   * @param id - Session identity to delete.
   * @returns `true` when the owned Session was deleted, or `false` when unowned.
   */
  deleteSession(id: SessionId): Promise<boolean> { return this.requireRegistry().deleteSession(id) }
  /**
   * Persist the project's complete Session display order.
   * @param id - Registered project identity.
   * @param orderedIds - Unique Session identities in the requested order.
   */
  reorderSessions(id: ProjectId, orderedIds: readonly SessionId[]): Promise<void> {
    return this.requireRegistry().reorderSessions(id, orderedIds)
  }
  /**
   * Update portable archive membership without deleting Session data.
   * @param id - Registered project identity.
   * @param sessionId - Session owned by that project.
   * @param archived - Requested archive membership.
   */
  setSessionArchived(id: ProjectId, sessionId: SessionId, archived: boolean): Promise<void> {
    return this.requireRegistry().setSessionArchived(id, sessionId, archived)
  }
  /**
   * Update portable pin membership for one project-owned Session.
   * @param id - Registered project identity.
   * @param sessionId - Session owned by that project.
   * @param pinned - Requested pin membership.
   */
  setSessionPinned(id: ProjectId, sessionId: SessionId, pinned: boolean): Promise<void> {
    return this.requireRegistry().setSessionPinned(id, sessionId, pinned)
  }
  /**
   * Persist a validated project display title.
   * @param id - Registered project identity.
   * @param title - Nonblank project title within the metadata limit.
   */
  rename(id: ProjectId, title: string): Promise<void> { return this.requireRegistry().rename(id, title) }
  /**
   * Remove a machine-local binding while retaining all project files.
   * @param id - Registered project identity to forget.
   */
  unregister(id: ProjectId): Promise<void> { return this.requireRegistry().unregister(id) }

  private requireRegistry(): ProjectStorageRegistry {
    if (this.registry === undefined) throw new Error('project storage service is not initialized')
    return this.registry
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { projectStorage: ProjectStorageService }
  interface Events {
    /**
     * Publish a project manifest or locator change after durable storage.
     * @param change - the affected project binding and manifest projection.
     * @mode emit
     */
    'project-storage/changed'(change: ProjectStorageChanged): void
  }
}

export { ProjectId, ProjectBindingRevision, createManifest, decodeManifest, manifestDigest, validateRelativeCwd } from './manifest.ts'
export { ProjectMigrationUnavailableError } from './registry.ts'
export { ensureProjectGitExclusion } from './git-exclusion.ts'
export { createLegacyAdopter, type LegacyAdoptionOptions } from './legacy-sessions.ts'
export type * from './types.ts'
export default ProjectStorageService
