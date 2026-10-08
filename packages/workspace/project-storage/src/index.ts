import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  LegacySourceProvider, OpenProjectRequest, PortableProjectManifest, ProjectBinding,
  ProjectId, ProjectInspection, ProjectLegacyAdopter, ProjectSessionLocation, ProjectStorage, ProjectStorageChanged, ProjectStorageOptions,
} from './types.ts'
import { ProjectStorageRegistry } from './registry.ts'

/** Host-facing Cordis service. Register at startup independently of Workspace and Session persistence. */
export class ProjectStorageService extends Service implements ProjectStorage {
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
    this.ctx.effect(() => registry.onChanged(change => this.ctx.emit('project-storage/changed', change)), 'projectStorage.changed')
  }

  registerLegacySource(provider: LegacySourceProvider): () => void {
    const registry = this.requireRegistry()
    return this.ctx.effect(() => registry.registerLegacySource(provider), 'projectStorage.registerLegacySource')
  }
  registerLegacyAdopter(adopter: ProjectLegacyAdopter): () => void {
    const registry = this.requireRegistry()
    return this.ctx.effect(() => registry.registerLegacyAdopter(adopter), 'projectStorage.registerLegacyAdopter')
  }
  inspect(root: string, signal?: AbortSignal): Promise<ProjectInspection> { return this.requireRegistry().inspect(root, signal) }
  open(request: OpenProjectRequest, signal?: AbortSignal): Promise<ProjectBinding> { return this.requireRegistry().open(request, signal) }
  list(): readonly ProjectBinding[] { return this.requireRegistry().list() }
  status(id: ProjectId, signal?: AbortSignal): Promise<'available' | 'missing' | 'read-only'> { return this.requireRegistry().status(id, signal) }
  manifest(id: ProjectId): PortableProjectManifest { return this.requireRegistry().manifest(id) }
  bindSession(header: SessionHeader, signal?: AbortSignal): Promise<ProjectSessionLocation> {
    return this.requireRegistry().bindSession(header, signal)
  }
  locateSession(id: SessionId): ProjectSessionLocation | undefined { return this.requireRegistry().locateSession(id) }
  executionCwd(header: SessionHeader): string | undefined { return this.requireRegistry().executionCwd(header) }
  reorderSessions(id: ProjectId, orderedIds: readonly SessionId[]): Promise<void> {
    return this.requireRegistry().reorderSessions(id, orderedIds)
  }
  setSessionArchived(id: ProjectId, sessionId: SessionId, archived: boolean): Promise<void> {
    return this.requireRegistry().setSessionArchived(id, sessionId, archived)
  }
  setSessionPinned(id: ProjectId, sessionId: SessionId, pinned: boolean): Promise<void> {
    return this.requireRegistry().setSessionPinned(id, sessionId, pinned)
  }
  rename(id: ProjectId, title: string): Promise<void> { return this.requireRegistry().rename(id, title) }
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
export { resolveProjectAttachmentScope } from './attachments.ts'
export { createLegacyAdopter, type LegacyAdoptionOptions } from './legacy-sessions.ts'
export type * from './types.ts'
export default ProjectStorageService
