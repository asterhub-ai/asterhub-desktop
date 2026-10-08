import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { open as openFile, lstat, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ProjectBindingRevision as makeProjectBindingRevision, ProjectId as makeProjectId, createManifest, decodeManifest, manifestDigest, parseStrictJson, projectSessionRecord } from './manifest.ts'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import { ensureProjectGitExclusion } from './git-exclusion.ts'
import type {
  LegacyProjectProposal,
  LegacySourceProvider,
  OpenProjectRequest,
  PortableProjectManifest,
  ProjectBinding,
  ProjectBindingRevision,
  ProjectId,
  ProjectInspection,
  ProjectLegacyAdopter,
  ProjectSessionLocation,
  ProjectStorageChanged,
  ProjectStorageHost,
  ProjectStorageOptions,
} from './types.ts'

const MANIFEST_PATH = ['.aster', 'project.json'] as const
interface LocatorRecord { readonly id: ProjectId; readonly root: string; readonly revision: ProjectBindingRevision }
interface LocatorFile { readonly schemaVersion: 1; readonly projects: readonly LocatorRecord[] }

/** Raised when a confirmed legacy project has no migration implementation registered. */
export class ProjectMigrationUnavailableError extends Error {
  readonly code = 'PROJECT_MIGRATION_UNAVAILABLE'
  constructor() {
    super('legacy project migration is unavailable because no adopter is registered')
    this.name = 'ProjectMigrationUnavailableError'
  }
}

/** Filesystem-backed portable metadata registry; project.json remains authoritative for membership. */
export class ProjectStorageRegistry implements ProjectStorageHost {
  private readonly options: ProjectStorageOptions
  private records: LocatorRecord[] = []
  private manifests = new Map<ProjectId, PortableProjectManifest>()
  private readonly sessionOwners = new Map<string, ProjectId>()
  private readonly legacyProviders = new Set<LegacySourceProvider>()
  private legacyAdopter: ProjectLegacyAdopter | undefined
  private operationTail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(change: ProjectStorageChanged) => void>()

  private constructor(options: ProjectStorageOptions) {
    if (
      options.locatorPath.trim().length === 0
      || !Number.isSafeInteger(options.metadataLimitBytes)
      || options.metadataLimitBytes < 1
      || !Number.isSafeInteger(options.lockDeadlineMs)
      || options.lockDeadlineMs < 1
    ) {
      throw new TypeError('invalid project storage configuration')
    }
    this.options = { ...options, locatorPath: resolve(options.locatorPath) }
  }

  /** Open and validate the locator cache without reading any user history. */
  static async create(options: ProjectStorageOptions): Promise<ProjectStorageRegistry> {
    const registry = new ProjectStorageRegistry(options)
    await registry.loadLocator()
    return registry
  }

  /** Listen for notifications emitted only after the durable file publication. */
  onChanged(listener: (change: ProjectStorageChanged) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  registerLegacySource(provider: LegacySourceProvider): () => void {
    this.legacyProviders.add(provider)
    return () => { this.legacyProviders.delete(provider) }
  }

  registerLegacyAdopter(adopter: ProjectLegacyAdopter): () => void {
    if (this.legacyAdopter !== undefined) throw new Error('a legacy project adopter is already registered')
    this.legacyAdopter = adopter
    return () => { if (this.legacyAdopter === adopter) this.legacyAdopter = undefined }
  }


  async inspect(root: string, signal?: AbortSignal): Promise<ProjectInspection> {
    if (signal?.aborted) throw signal.reason
    const canonical = await canonicalDirectory(root)
    const aster = join(canonical, '.aster')
    const metadata = join(canonical, ...MANIFEST_PATH)
    const asterInfo = await optionalLstat(aster)
    if (asterInfo?.isSymbolicLink()) throw new Error('project owned data root must not be a symlink')
    if (asterInfo !== undefined && !asterInfo.isDirectory()) throw new Error('.aster must be a directory')
    const info = await optionalLstat(metadata)
    if (info !== undefined) {
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('project metadata must be a regular file')
      const bytes = await readFile(metadata, { signal })
      const manifest = decodeManifest(bytes, this.options.metadataLimitBytes)
      await assertOwnedRoots(canonical, false)
      const digest = manifestDigest(bytes)
      const rootOwner = this.records.find(record => record.root === canonical && record.id !== manifest.id)
      if (rootOwner !== undefined) throw new Error(`project root identity conflict: registered as ${rootOwner.id}, metadata claims ${manifest.id}`)
      const owner = this.records.find(record => record.id === manifest.id)
      if (owner !== undefined && owner.root !== canonical && await existsDirectory(owner.root)) {
        throw new Error(`project identity conflict: ${manifest.id} is already registered at another existing root`)
      }
      if (owner?.root === canonical) return { kind: 'registered', binding: binding(owner), manifest, digest }
      return { kind: 'existing', root: canonical, manifest, digest }
    }
    if (asterInfo !== undefined) throw new Error('project .aster directory exists without project metadata')
    for (const provider of this.legacyProviders) {
      const proposal = await provider.inspect(canonical, signal)
      if (proposal !== undefined) {
        const validated = validateLegacyProposal(proposal, this.options.metadataLimitBytes)
        return { kind: 'legacy', root: canonical, proposal: validated, digest: digestLegacyProposal(validated) }
      }
    }
    return { kind: 'new', root: canonical }
  }

  async open(request: OpenProjectRequest, signal?: AbortSignal): Promise<ProjectBinding> {
    return this.mutate(async () => {
      if (signal?.aborted) throw signal.reason
      const root = await canonicalDirectory(request.root)
      const inspection = await this.inspect(root, signal)
      if (request.mode !== inspection.kind && !(request.mode === 'existing' && inspection.kind === 'registered')) {
        throw new Error(`project changed after inspection: expected ${request.mode}, found ${inspection.kind}`)
      }
      if (inspection.kind === 'new') {
        if (request.expectedId !== undefined || request.expectedDigest !== undefined) throw new Error('new project cannot use existing-project confirmation')
        await assertWritableDirectory(root)
        const exclusion = await ensureProjectGitExclusion(root, signal)
        if (exclusion.kind === 'tracked-data') throw new Error(`.aster contains already-tracked private Git data: ${exclusion.trackedPaths.join(', ')}`)
        await mkdir(join(root, '.aster'), { mode: 0o700 })
        await assertOwnedRoots(root, true)
        const manifest = createManifest({ title: baseName(root) })
        await writeManifest(root, manifest)
        const record = this.makeRecord(manifest.id, root)
        await this.saveRecord(record)
        this.manifests.set(manifest.id, manifest)
        this.indexSessionOwners(manifest)
        this.emitChange({ id: manifest.id, binding: binding(record), manifest })
        return binding(record)
      }
      if (inspection.kind === 'legacy') {
        if (request.expectedId !== inspection.proposal.projectId || request.expectedDigest !== inspection.digest) throw new Error('legacy confirmation identity or digest is stale')
        const adopter = this.legacyAdopter
        if (adopter === undefined) throw new ProjectMigrationUnavailableError()
        const proposal = await this.confirmedLegacyProposal(root, inspection.proposal, inspection.digest, signal)
        const exclusion = await ensureProjectGitExclusion(root, signal)
        if (exclusion.kind === 'tracked-data') throw new Error(`.aster contains already-tracked private Git data: ${exclusion.trackedPaths.join(', ')}`)
        const manifest = await adopter(proposal, root, signal)
        if (manifest.id !== proposal.projectId) throw new Error('legacy adopter returned a different project ID')
        const validated = decodeManifest(Buffer.from(JSON.stringify(manifest)), this.options.metadataLimitBytes)
        this.assertManifestOwner(validated)
        await assertOwnedRoots(root, true)
        await writeManifest(root, validated)
        const record = this.makeRecord(validated.id, root)
        await this.saveRecord(record)
        this.manifests.set(validated.id, validated)
        this.indexSessionOwners(validated)
        this.emitChange({ id: validated.id, binding: binding(record), manifest: validated })
        return binding(record)
      }
      const manifest = inspection.manifest
      if (inspection.kind === 'existing' && (request.expectedId !== manifest.id || request.expectedDigest !== inspection.digest)) {
        throw new Error('project confirmation identity or digest is stale')
      }
      if (inspection.kind === 'registered' && ((request.expectedId !== undefined && request.expectedId !== manifest.id) || (request.expectedDigest !== undefined && request.expectedDigest !== inspection.digest))) {
        throw new Error('project confirmation identity or digest is stale')
      }
      const exclusion = await ensureProjectGitExclusion(root, signal)
      if (exclusion.kind === 'tracked-data') throw new Error(`.aster contains already-tracked private Git data: ${exclusion.trackedPaths.join(', ')}`)
      await assertOwnedRoots(root, false)
      if (inspection.kind === 'registered') return inspection.binding
      const current = this.records.find(item => item.id === manifest.id)
      if (current !== undefined && current.root !== root && await existsDirectory(current.root)) throw new Error(`project location conflict: ${manifest.id}`)
      this.assertManifestOwner(manifest)
      const record = this.makeRecord(manifest.id, root)
      await this.saveRecord(record)
      this.manifests.set(manifest.id, manifest)
      this.indexSessionOwners(manifest)
      this.emitChange({ id: manifest.id, binding: binding(record), manifest })
      return binding(record)
    })
  }

  list(): readonly ProjectBinding[] { return this.records.map(binding) }

  async status(id: ProjectId, signal?: AbortSignal): Promise<'available' | 'missing' | 'read-only'> {
    if (signal?.aborted) throw signal.reason
    const record = this.requireRecord(id)
    try {
      const root = await realpath(record.root)
      if (root !== record.root) return 'missing'
      const project = await lstat(join(root, '.aster'))
      const metadata = await lstat(join(root, ...MANIFEST_PATH))
      if (project.isSymbolicLink() || !project.isDirectory() || metadata.isSymbolicLink() || !metadata.isFile()) return 'missing'
      const bits = (await stat(root)).mode & project.mode & metadata.mode & 0o222
      return bits === 0 ? 'read-only' : 'available'
    } catch (error: unknown) {
      if (isMissing(error)) return 'missing'
      throw error
    }
  }

  manifest(id: ProjectId): PortableProjectManifest {
    const record = this.requireRecord(id)
    const bytes = readFileSync(join(record.root, ...MANIFEST_PATH))
    const manifest = decodeManifest(bytes, this.options.metadataLimitBytes)
    if (manifest.id !== id) throw new Error(`project locator does not match local manifest: ${id}`)
    this.manifests.set(id, manifest)
    return manifest
  }

  async bindSession(header: SessionHeader, signal?: AbortSignal): Promise<ProjectSessionLocation> {
    return this.mutate(async () => {
      if (signal?.aborted) throw signal.reason
      const owner = this.sessionOwners.get(String(header.id))
      if (owner !== undefined) {
        const record = this.requireRecord(owner)
        const membership = this.readManifest(record).sessions.find(item => item.id === header.id)
        if (membership === undefined) throw new Error(`project owner index has no local Session record: ${header.id}`)
        if (header.cwd !== undefined && isAbsolute(header.cwd)) {
          const declaredCwd = await realpath(header.cwd).catch((error: unknown) => { if (isMissing(error)) return undefined; throw error })
          if (declaredCwd !== undefined) {
            for (const candidate of this.records) {
              if (candidate.id === owner) continue
              const root = await realpath(candidate.root).catch((error: unknown) => { if (isMissing(error)) return undefined; throw error })
              if (root !== undefined && inside(root, declaredCwd)) throw new Error(`Session claims a different project owner: ${header.id}`)
            }
          }
        }
        return location(record, membership.relativeCwd)
      }
      if (header.parentSession !== undefined) {
        const parentOwner = this.sessionOwners.get(String(header.parentSession))
        if (parentOwner !== undefined) {
          const record = this.requireRecord(parentOwner)
          const parent = this.readManifest(record).sessions.find(item => item.id === header.parentSession)
          if (parent === undefined) throw new Error(`parent Session is missing local project membership: ${header.parentSession}`)
          return this.addMembership(record, header.id, parent.relativeCwd)
        }
      }
      const cwd = header.cwd
      if (cwd === undefined || cwd.length === 0 || !isAbsolute(cwd)) throw new Error('Session header must have an absolute cwd for project ownership')
      const canonicalCwd = await realpath(cwd)
      for (const record of this.records) {
        const root = await realpath(record.root).catch((error: unknown) => { if (isMissing(error)) return undefined; throw error })
        if (root === undefined) continue
        const relativeCwd = relative(root, canonicalCwd)
        if (relativeCwd.startsWith(`..${sep}`) || relativeCwd === '..' || isAbsolute(relativeCwd)) continue
        const normalized = relativeCwd === '' ? '.' : relativeCwd.split(sep).join('/')
        return this.addMembership(record, header.id, normalized)
      }
      throw new Error(`Session cwd is not inside a registered project: ${cwd}`)
    })
  }

  locateSession(id: SessionId): ProjectSessionLocation | undefined {
    const projectId = this.sessionOwners.get(String(id))
    if (projectId === undefined) return undefined
    const record = this.requireRecord(projectId)
    const membership = this.readManifest(record).sessions.find(item => item.id === id)
    return membership === undefined ? undefined : location(record, membership.relativeCwd)
  }

  executionCwd(header: SessionHeader): string | undefined {
    const located = this.locateSession(header.id)
    return located === undefined ? undefined : resolve(located.projectRoot, ...located.relativeCwd.split('/'))
  }

  async reorderSessions(id: ProjectId, orderedIds: readonly SessionId[]): Promise<void> {
    await this.mutate(async () => {
      const record = this.requireRecord(id), manifest = this.readManifest(record)
      if (orderedIds.length !== manifest.sessions.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(item => !manifest.sessions.some(row => row.id === item))) throw new Error('invalid project Session order')
      await this.replaceManifest(record, { ...manifest, sessionOrder: [...orderedIds] })
    })
  }

  async setSessionArchived(id: ProjectId, sessionId: SessionId, archived: boolean): Promise<void> {
    await this.mutate(async () => {
      const record = this.requireRecord(id), manifest = this.readManifest(record)
      if (!manifest.sessions.some(item => item.id === sessionId)) throw new Error(`Session is not owned by project: ${sessionId}`)
      const archivedIds = manifest.archivedSessionIds.filter(item => item !== sessionId)
      const pinned = manifest.pinnedSessionIds.filter(item => item !== sessionId)
      await this.replaceManifest(record, {
        ...manifest,
        archivedSessionIds: archived ? [...archivedIds, sessionId] : archivedIds,
        pinnedSessionIds: pinned,
      })
    })
  }

  async setSessionPinned(id: ProjectId, sessionId: SessionId, pinned: boolean): Promise<void> {
    await this.mutate(async () => {
      const record = this.requireRecord(id), manifest = this.readManifest(record)
      if (!manifest.sessions.some(item => item.id === sessionId)) throw new Error(`Session is not owned by project: ${sessionId}`)
      if (pinned && manifest.archivedSessionIds.includes(sessionId)) throw new Error('archived Session cannot be pinned')
      const pinnedIds = manifest.pinnedSessionIds.filter(item => item !== sessionId)
      await this.replaceManifest(record, { ...manifest, pinnedSessionIds: pinned ? [...pinnedIds, sessionId] : pinnedIds })
    })
  }

  async rename(id: ProjectId, title: string): Promise<void> {
    await this.mutate(async () => {
      const record = this.requireRecord(id), manifest = this.readManifest(record)
      const updated = decodeManifest(Buffer.from(JSON.stringify({ ...manifest, title })), this.options.metadataLimitBytes)
      await this.replaceManifest(record, updated)
    })
  }

  async unregister(id: ProjectId): Promise<void> {
    await this.mutate(async () => {
      this.requireRecord(id)
      const manifest = this.manifests.get(id)
      const nextRecords = this.records.filter(item => item.id !== id)
      await this.saveLocator(nextRecords)
      this.records = nextRecords
      this.manifests.delete(id)
      for (const session of manifest?.sessions ?? []) this.sessionOwners.delete(String(session.id))
      this.emitChange({ id, binding: undefined, manifest })
    })
  }

  private async loadLocator(): Promise<void> {
    this.records = []
    this.manifests.clear()
    this.sessionOwners.clear()
    const bytes = await readFile(this.options.locatorPath).catch((error: unknown) => {
      if (isMissing(error)) return undefined
      throw error
    })
    if (bytes === undefined) return
    const value = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (
      !isObject(value)
      || Object.keys(value).sort().join(',') !== 'projects,schemaVersion'
      || value.schemaVersion !== 1
      || !Array.isArray(value.projects)
    ) {
      throw new Error('invalid project locator index')
    }
    const projects: unknown[] = value.projects
    const records: LocatorRecord[] = []
    for (const item of projects) {
      if (
        !isObject(item)
        || Object.keys(item).sort().join(',') !== 'id,revision,root'
        || typeof item.id !== 'string'
        || typeof item.root !== 'string'
        || !isAbsolute(item.root)
        || typeof item.revision !== 'string'
      ) {
        throw new Error('invalid project locator record')
      }
      const id = makeProjectId(item.id), root = resolve(item.root)
      if (records.some(record => record.id === id || record.root === root)) throw new Error('duplicate project locator identity or root')
      const record: LocatorRecord = { id, root, revision: makeProjectBindingRevision(item.revision) }
      records.push(record)
      if (await existsDirectory(root)) {
        try {
          const manifest = this.readManifest(record)
          if (manifest.id !== id) throw new Error('project locator ID does not match authoritative local manifest')
          this.manifests.set(id, manifest)
          this.indexSessionOwners(manifest)
        } catch (error: unknown) {
          throw new Error(`invalid project locator target ${root}: ${errorMessage(error)}`)
        }
      }
    }
    this.records = records
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operationTail
    const gate = Promise.withResolvers<void>()
    this.operationTail = gate.promise
    await prior
    const lockPath = `${this.options.locatorPath}.lock`
    let lock: FileHandle | undefined
    const deadline = Date.now() + this.options.lockDeadlineMs
    try {
      await mkdir(resolve(this.options.locatorPath, '..'), { recursive: true })
      while (lock === undefined) {
        try { lock = await openFile(lockPath, 'wx', 0o600) }
        catch (error: unknown) {
          if (!isExists(error) || Date.now() >= deadline) throw new Error(`timed out acquiring project storage lock: ${lockPath}`)
          const delay = Promise.withResolvers<void>()
          setTimeout(delay.resolve, Math.min(25, Math.max(1, deadline - Date.now())))
          await delay.promise
        }
      }
      await this.loadLocator()
      return await operation()
    } finally {
      try {
        await lock?.close()
        if (lock !== undefined) await rm(lockPath, { force: true })
      } finally {
        gate.resolve()
      }
    }
  }

  private makeRecord(id: ProjectId, root: string): LocatorRecord {
    const existing = this.records.find(record => record.id === id)
    return existing?.root === root ? existing : { id, root, revision: makeProjectBindingRevision(randomUUID()) }
  }

  private async saveRecord(record: LocatorRecord): Promise<void> {
    const rootOwner = this.records.find(item => item.root === record.root && item.id !== record.id)
    if (rootOwner !== undefined) throw new Error(`project root identity conflict: ${record.root} is registered to ${rootOwner.id}`)
    const previous = this.records.find(item => item.id === record.id)
    if (previous !== undefined && previous.root !== record.root && await existsDirectory(previous.root)) throw new Error(`project location conflict: ${record.id}`)
    const nextRecords = [...this.records.filter(item => item.id !== record.id && item.root !== record.root), record]
    await this.saveLocator(nextRecords)
    this.records = nextRecords
  }

  private async saveLocator(records: readonly LocatorRecord[] = this.records): Promise<void> {
    const file: LocatorFile = { schemaVersion: 1, projects: records }
    await atomicWrite(this.options.locatorPath, Buffer.from(JSON.stringify(file)), 0o600)
  }
  private readManifest(record: LocatorRecord): PortableProjectManifest {
    if (realpathSync(record.root) !== record.root) throw new Error(`registered project root is no longer canonical: ${record.root}`)
    const bytes = readFileSync(join(record.root, ...MANIFEST_PATH))
    const manifest = decodeManifest(bytes, this.options.metadataLimitBytes)
    if (manifest.id !== record.id) throw new Error(`project locator does not match local manifest: ${record.id}`)
    this.manifests.set(record.id, manifest)
    return manifest
  }
  private async replaceManifest(record: LocatorRecord, next: PortableProjectManifest): Promise<void> {
    const validated = decodeManifest(Buffer.from(JSON.stringify(next)), this.options.metadataLimitBytes)
    this.assertManifestOwner(validated)
    const status = await this.status(record.id)
    if (status !== 'available') throw new Error(`project ${record.id} is ${status}; project metadata cannot be changed`)
    await assertWritableDirectory(record.root)
    await assertWritableDirectory(join(record.root, '.aster'))
    await assertOwnedRoots(record.root, false)
    await writeManifest(record.root, validated)
    this.manifests.set(record.id, validated)
    this.indexSessionOwners(validated)
    this.emitChange({ id: record.id, binding: binding(record), manifest: validated })
  }


  private indexSessionOwners(manifest: PortableProjectManifest): void {
    for (const session of manifest.sessions) {
      const owner = this.sessionOwners.get(String(session.id))
      if (owner !== undefined && owner !== manifest.id) throw new Error(`duplicate project owner for Session ${session.id}`)
      this.sessionOwners.set(String(session.id), manifest.id)
    }
  }
  private assertManifestOwner(manifest: PortableProjectManifest): void {
    for (const session of manifest.sessions) {
      const owner = this.sessionOwners.get(String(session.id))
      if (owner !== undefined && owner !== manifest.id) throw new Error(`duplicate project owner for Session ${session.id}`)
    }
  }
  private async confirmedLegacyProposal(
    root: string,
    proposal: LegacyProjectProposal,
    digest: string,
    signal?: AbortSignal,
  ): Promise<LegacyProjectProposal> {
    let matched: LegacyProjectProposal | undefined
    for (const provider of this.legacyProviders) {
      const inspected = await provider.inspect(root, signal)
      if (inspected === undefined) continue
      const validated = validateLegacyProposal(inspected, this.options.metadataLimitBytes)
      if (digestLegacyProposal(validated) !== digest || validated.projectId !== proposal.projectId) continue
      if (matched !== undefined) throw new Error('multiple legacy sources claim this project proposal')
      matched = validated
    }
    if (matched === undefined) throw new Error('legacy project proposal changed after inspection')
    return matched
  }
  private async addMembership(record: LocatorRecord, id: SessionId, relativeCwd: string): Promise<ProjectSessionLocation> {
    const projectRecord = projectSessionRecord(String(id), relativeCwd)
    const manifest = this.readManifest(record)
    const owner = this.sessionOwners.get(String(id))
    if (owner !== undefined && owner !== record.id) throw new Error(`Session already has another project owner: ${id}`)
    const existing = manifest.sessions.find(item => item.id === id)
    if (existing !== undefined && existing.relativeCwd !== projectRecord.relativeCwd) throw new Error(`Session project cwd conflicts with local membership: ${id}`)
    if (existing === undefined) {
      const status = await this.status(record.id)
      if (status !== 'available') throw new Error(`project ${record.id} is ${status}; Session membership cannot be added`)
      await this.replaceManifest(record, {
        ...manifest,
        sessions: [...manifest.sessions, projectRecord],
        sessionOrder: [...manifest.sessionOrder, id],
      })
    }
    this.sessionOwners.set(String(id), record.id)
    return location(record, projectRecord.relativeCwd)
  }
  private requireRecord(id: ProjectId): LocatorRecord {
    const record = this.records.find(item => item.id === id)
    if (record === undefined) throw new Error(`unknown project: ${id}`)
    return record
  }

  private emitChange(change: ProjectStorageChanged): void { for (const listener of this.listeners) listener(change) }
}

export async function createProjectStorage(options: ProjectStorageOptions): Promise<ProjectStorageRegistry> {
  return ProjectStorageRegistry.create(options)
}

function binding(record: LocatorRecord): ProjectBinding { return { id: record.id, root: record.root, revision: record.revision } }
function location(record: LocatorRecord, relativeCwd: string): ProjectSessionLocation {
  return {
    projectId: record.id, projectRoot: record.root, relativeCwd,
    sessionsRoot: join(record.root, '.aster', 'sessions'),
    attachmentsRoot: join(record.root, '.aster', 'attachments', 'v1'), bindingRevision: record.revision,
  }
}
async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(resolve(path))
  if (!(await stat(canonical)).isDirectory()) throw new Error(`project root is not a directory: ${path}`)
  return canonical
}
async function optionalLstat(path: string) {
  try {
    return await lstat(path)
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw error
  }
}
async function existsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error: unknown) {
    if (isMissing(error)) return false
    throw error
  }
}
async function assertOwnedRoots(root: string, create: boolean): Promise<void> {
  if (await realpath(root) !== root) throw new Error('project root must remain canonical during storage operations')
  const project = join(root, '.aster')
  if (create) await mkdir(project, { recursive: true, mode: 0o700 })
  const base = await lstat(project)
  if (base.isSymbolicLink() || !base.isDirectory()) throw new Error('project owned data root must be a real directory')
  for (const name of ['sessions', 'attachments', join('attachments', 'v1')]) {
    const path = join(project, name), info = await optionalLstat(path)
    if (info?.isSymbolicLink() || (info !== undefined && !info.isDirectory())) throw new Error(`project owned data root is unsafe: ${path}`)
    if (info !== undefined && !inside(project, await realpath(path))) throw new Error(`project owned data root escapes project: ${path}`)
  }
}
async function assertWritableDirectory(path: string): Promise<void> {
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error(`project storage path is not a directory: ${path}`)
  if ((info.mode & 0o222) === 0) throw new Error(`project storage path is read-only: ${path}`)
}
function inside(root: string, target: string): boolean { const rel = relative(root, target); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) }
async function writeManifest(root: string, manifest: PortableProjectManifest): Promise<void> { await atomicWrite(join(root, ...MANIFEST_PATH), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o600) }
async function atomicWrite(path: string, bytes: Uint8Array, mode: number): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  const handle = await openFile(temp, 'wx', mode)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try {
    await rename(temp, path)
    if (process.platform !== 'win32') {
      const directory = await openFile(resolve(path, '..'), 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  } catch (error: unknown) {
    await rm(temp, { force: true })
    throw error
  }
}
function baseName(root: string): string { const name = root.split(/[\\/]/).filter(Boolean).at(-1); return name || 'Project' }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isMissing(error: unknown): boolean { return isNodeError(error, 'ENOENT') }
function isExists(error: unknown): boolean { return isNodeError(error, 'EEXIST') }
function isNodeError(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function digestLegacyProposal(proposal: LegacyProjectProposal): string { return manifestDigest(Buffer.from(JSON.stringify(proposal))) }
function validateLegacyProposal(proposal: LegacyProjectProposal, maxBytes: number): LegacyProjectProposal {
  const raw: unknown = proposal
  if (!isObject(raw) || Object.keys(raw).sort().join(',') !== 'archivedSessionIds,pinnedSessionIds,projectId,sessionOrder,sessions,sourceRoot,title') {
    throw new TypeError('invalid legacy project proposal fields')
  }
  if (typeof raw.projectId !== 'string' || typeof raw.title !== 'string' || typeof raw.sourceRoot !== 'string' || !isAbsolute(raw.sourceRoot) || raw.sourceRoot.includes('\0')) {
    throw new TypeError('invalid legacy project proposal identity or source root')
  }
  const id = makeProjectId(raw.projectId)
  const manifest = decodeManifest(Buffer.from(JSON.stringify({
    schemaVersion: 1,
    id,
    title: raw.title,
    createdAt: 0,
    sessions: raw.sessions,
    sessionOrder: raw.sessionOrder,
    pinnedSessionIds: raw.pinnedSessionIds,
    archivedSessionIds: raw.archivedSessionIds,
  })), maxBytes)
  return {
    projectId: id,
    title: manifest.title,
    sourceRoot: raw.sourceRoot,
    sessions: manifest.sessions,
    sessionOrder: manifest.sessionOrder,
    pinnedSessionIds: manifest.pinnedSessionIds,
    archivedSessionIds: manifest.archivedSessionIds,
  }
}
