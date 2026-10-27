import type { SessionId, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable, portable identity stored in `.aster/project.json`. */
export type ProjectId = Branded<'ProjectId'>
/** Revision changes whenever a locator binding changes. */
export type ProjectBindingRevision = Branded<'ProjectBindingRevision'>

/**
 * Portable Session membership and its project-relative working directory.
 */
export interface ProjectSessionRecord {
  readonly id: SessionId
  readonly relativeCwd: string
}

/**
 * Authoritative project identity, Session membership, and sidebar ordering persisted beside the project.
 */
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

/**
 * Machine-local association between a portable project identity and its canonical root.
 */
export interface ProjectBinding {
  readonly id: ProjectId
  readonly root: string
  readonly revision: ProjectBindingRevision
}

/**
 * Resolved project-owned directories for one registered Session.
 */
export interface ProjectSessionLocation {
  readonly projectId: ProjectId
  readonly projectRoot: string
  readonly relativeCwd: string
  readonly sessionsRoot: string
  readonly attachmentsRoot: string
  readonly bindingRevision: ProjectBindingRevision
}


/**
 * Read-only legacy history proposed for explicit project adoption.
 */
export interface LegacyProjectProposal {
  readonly projectId: ProjectId
  readonly title: string
  readonly sourceRoot: string
  readonly sessions: readonly ProjectSessionRecord[]
  readonly sessionOrder: readonly SessionId[]
  readonly pinnedSessionIds: readonly SessionId[]
  readonly archivedSessionIds: readonly SessionId[]
}

/**
 * Validated project state and confirmation facts required before opening existing data.
 */
export type ProjectInspection =
  | { readonly kind: 'new'; readonly root: string }
  | { readonly kind: 'existing'; readonly root: string; readonly manifest: PortableProjectManifest; readonly digest: string }
  | { readonly kind: 'registered'; readonly binding: ProjectBinding; readonly manifest: PortableProjectManifest; readonly digest: string }
  | { readonly kind: 'legacy'; readonly root: string; readonly proposal: LegacyProjectProposal; readonly digest: string }

/**
 * Project root and explicit open mode, with inspected identity and digest for confirmation.
 */
export interface OpenProjectRequest {
  readonly root: string
  readonly mode: 'new' | 'existing' | 'legacy'
  readonly expectedId?: ProjectId
  readonly expectedDigest?: string
}

/**
 * Explicit storage mode, machine-local locator, metadata limit, and mutation lock deadline.
 */
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

/**
 * Project registration, Session membership, and project-owned storage lookup operations.
 */
export interface ProjectStorage {
  inspect(root: string, signal?: AbortSignal): Promise<ProjectInspection>
  open(request: OpenProjectRequest, signal?: AbortSignal): Promise<ProjectBinding>
  list(): readonly ProjectBinding[]
  status(id: ProjectId, signal?: AbortSignal): Promise<'available' | 'missing' | 'read-only'>
  manifest(id: ProjectId): PortableProjectManifest
  bindSession(header: SessionHeader, signal?: AbortSignal): Promise<ProjectSessionLocation>
  executionCwd(header: SessionHeader): string | undefined
  locateSession(id: SessionId): ProjectSessionLocation | undefined
  /** Delete a project-owned Session's log files and portable membership without removing the project directory. */
  deleteSession(id: SessionId): Promise<boolean>
  reorderSessions(id: ProjectId, orderedIds: readonly SessionId[]): Promise<void>
  setSessionArchived(id: ProjectId, sessionId: SessionId, archived: boolean): Promise<void>
  setSessionPinned(id: ProjectId, sessionId: SessionId, pinned: boolean): Promise<void>
  rename(id: ProjectId, title: string): Promise<void>
  unregister(id: ProjectId): Promise<void>
}

/**
 * Resolved inputs used to initialize project storage.
 */
export type ProjectStorageOptions = ProjectStorageConfig

/**
 * Project binding and manifest snapshot published after a durable mutation.
 */
export interface ProjectStorageChanged {
  readonly id: ProjectId
  readonly binding: ProjectBinding | undefined
  readonly manifest: PortableProjectManifest | undefined
}
/**
 * Copy and verify confirmed legacy history into a destination project before publication.
 */
export type ProjectLegacyAdopter = (proposal: LegacyProjectProposal, root: string, signal?: AbortSignal) => Promise<PortableProjectManifest>

/**
 * Read-only discovery of legacy Session membership for a selected project root.
 */
export interface LegacySourceProvider {
  inspect(root: string, signal?: AbortSignal): Promise<LegacyProjectProposal | undefined>
}

/**
 * Project storage with plugin-lifetime legacy discovery and adoption registration.
 */
export interface ProjectStorageHost extends ProjectStorage {
  registerLegacySource(provider: LegacySourceProvider): () => void | Promise<void>
  registerLegacyAdopter(adopter: ProjectLegacyAdopter): () => void | Promise<void>
}
