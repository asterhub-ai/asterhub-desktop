import type { SessionId, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable, portable identity stored in `.aster/project.json`. */
export type ProjectId = Branded<'ProjectId'>
/** Revision changes whenever a locator binding changes. */
export type ProjectBindingRevision = Branded<'ProjectBindingRevision'>

export interface ProjectSessionRecord {
  readonly id: SessionId
  readonly relativeCwd: string
}

export interface PortableProjectManifest {
  readonly schemaVersion: 1
  readonly id: ProjectId
  readonly title: string
  readonly createdAt: number
  readonly sessions: readonly ProjectSessionRecord[]
  readonly sessionOrder: readonly SessionId[]
  readonly pinnedSessionIds: readonly SessionId[]
  readonly archivedSessionIds: readonly SessionId[]
}

export interface ProjectBinding {
  readonly id: ProjectId
  readonly root: string
  readonly revision: ProjectBindingRevision
}

export interface ProjectSessionLocation {
  readonly projectId: ProjectId
  readonly projectRoot: string
  readonly relativeCwd: string
  readonly sessionsRoot: string
  readonly attachmentsRoot: string
  readonly bindingRevision: ProjectBindingRevision
}


/** Trusted project and Session identity used to route original attachments. */
export interface ProjectAttachmentScope {
  readonly projectId: ProjectId
  readonly sessionId: SessionId
}
export interface LegacyProjectProposal {
  readonly projectId: ProjectId
  readonly title: string
  readonly sourceRoot: string
  readonly sessions: readonly ProjectSessionRecord[]
  readonly sessionOrder: readonly SessionId[]
  readonly pinnedSessionIds: readonly SessionId[]
  readonly archivedSessionIds: readonly SessionId[]
}

export type ProjectInspection =
  | { readonly kind: 'new'; readonly root: string }
  | { readonly kind: 'existing'; readonly root: string; readonly manifest: PortableProjectManifest; readonly digest: string }
  | { readonly kind: 'registered'; readonly binding: ProjectBinding; readonly manifest: PortableProjectManifest; readonly digest: string }
  | { readonly kind: 'legacy'; readonly root: string; readonly proposal: LegacyProjectProposal; readonly digest: string }

export interface OpenProjectRequest {
  readonly root: string
  readonly mode: 'new' | 'existing' | 'legacy'
  readonly expectedId?: ProjectId
  readonly expectedDigest?: string
}

export interface ProjectStorageConfig {
  /** Explicitly select grouped or project-local Session persistence. */
  readonly sessionMode: 'grouped' | 'project-local'
  /** Machine-local locator index file beneath the prepared global home. */
  readonly locatorPath: string
  /** Read-only grouped Session source used to inspect legacy workspaces. */
  readonly legacySessionRoot: string
  /** Maximum accepted byte size for project metadata files. */
  readonly metadataLimitBytes: number
  /** Maximum wait for the cross-process project mutation lock. */
  readonly lockDeadlineMs: number
}

export interface ProjectStorage {
  inspect(root: string, signal?: AbortSignal): Promise<ProjectInspection>
  open(request: OpenProjectRequest, signal?: AbortSignal): Promise<ProjectBinding>
  list(): readonly ProjectBinding[]
  status(id: ProjectId, signal?: AbortSignal): Promise<'available' | 'missing' | 'read-only'>
  manifest(id: ProjectId): PortableProjectManifest
  bindSession(header: SessionHeader, signal?: AbortSignal): Promise<ProjectSessionLocation>
  executionCwd(header: SessionHeader): string | undefined
  locateSession(id: SessionId): ProjectSessionLocation | undefined
  reorderSessions(id: ProjectId, orderedIds: readonly SessionId[]): Promise<void>
  setSessionArchived(id: ProjectId, sessionId: SessionId, archived: boolean): Promise<void>
  setSessionPinned(id: ProjectId, sessionId: SessionId, pinned: boolean): Promise<void>
  rename(id: ProjectId, title: string): Promise<void>
  unregister(id: ProjectId): Promise<void>
}

export type ProjectStorageOptions = ProjectStorageConfig

export interface ProjectStorageChanged {
  readonly id: ProjectId
  readonly binding: ProjectBinding | undefined
  readonly manifest: PortableProjectManifest | undefined
}
export type ProjectLegacyAdopter = (proposal: LegacyProjectProposal, root: string, signal?: AbortSignal) => Promise<PortableProjectManifest>

export interface LegacySourceProvider {
  inspect(root: string, signal?: AbortSignal): Promise<LegacyProjectProposal | undefined>
}

export interface ProjectStorageHost extends ProjectStorage {
  registerLegacySource(provider: LegacySourceProvider): () => void
  registerLegacyAdopter(adopter: ProjectLegacyAdopter): () => void
}
