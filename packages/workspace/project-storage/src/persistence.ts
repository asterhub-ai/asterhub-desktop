import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { type JsonlCompression } from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  SessionPersistence, SessionPersistenceNotFoundError,
  type SessionAccess, type SessionHandle, type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions, type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot, type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

interface Config { compression?: JsonlCompression }
interface Backend {
  readonly persistence: SessionPersistence
  readonly dispose: () => Promise<void>
}

/** Routes SessionPersistence operations through `.aster/sessions` under registered Workspace roots. */
export class ProjectSessionPersistence extends SessionPersistence {
  static Config: z<Config> = z.object({ compression: z.union(['zstd', 'none'] as const) })

  private readonly backends = new Map<string, Backend>()
  private backendTail: Promise<void> = Promise.resolve()
  private readonly compression: JsonlCompression
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.compression = config.compression ?? 'zstd'
    ctx.effect(() => async () => {
      this.disposed = true
      await this.backendTail
      const backends = [...this.backends.values()]
      this.backends.clear()
      const results = await Promise.allSettled(backends.map(async (backend) => {
        await backend.persistence.flush()
        await backend.dispose()
      }))
      const failures = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'project Session persistence teardown failed')
    }, 'projectSessionPersistence.backends')
  }

  /**
   * Create a project-owned Session at the Workspace containing its header cwd.
   * @param header - immutable Session metadata.
   * @param options - optional cancellation.
   * @returns the project JSONL backend's owned write handle.
   * @throws when no registered Workspace contains `header.cwd`.
   */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const projectRoot = await this.projectRootForCwd(header.cwd)
    return await (await this.backend(projectRoot)).persistence.create(header, options)
  }

  /**
   * Open a Session found under one registered Workspace root.
   * @param id - stored Session identity.
   * @param access - read-only access or single-writer access.
   * @param options - optional cancellation.
   * @returns the owning project backend's open handle.
   * @throws {SessionPersistenceNotFoundError} when no Workspace root contains the Session.
   */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const located = await this.locate(id, options?.signal)
    if (located === undefined) throw new SessionPersistenceNotFoundError(id)
    return await located.backend.persistence.open(id, access, options)
  }

  /**
   * Flush every active project backend and aggregate failures.
   * @returns completion after all active backends flush.
   */
  async flush(): Promise<void> {
    const results = await Promise.allSettled([...this.backends.values()].map(backend => backend.persistence.flush()))
    const failures = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'one or more project Session stores failed to flush')
  }

  /**
   * Observe one Session without reading its event log.
   * @param id - stored Session identity.
   * @param options - optional cancellation.
   * @returns the snapshot, or `undefined` when no registered Workspace contains it.
   */
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    return (await this.locate(id, options?.signal))?.snapshot
  }

  /**
   * List Sessions physically stored beneath registered Workspace roots.
   * @param options - optional cancellation.
   * @returns one snapshot per stored Session under a registered root.
   */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const snapshots: SessionPersistenceSnapshot[] = []
    for (const root of this.workspaceRegistry().listProjectRoots()) {
      options?.signal?.throwIfAborted()
      try {
        if (!(await stat(root)).isDirectory()) continue
      } catch (error) {
        if (isMissingPath(error)) continue
        throw error
      }
      const backend = await this.backend(root)
      snapshots.push(...await backend.persistence.list(options))
    }
    return snapshots
  }

  private workspaceRegistry(): WorkspaceRegistry {
    const registry = this.ctx.get('workspaceRegistry', false)
    if (registry === undefined) throw new Error('project Session persistence requires the Workspace registry')
    return registry
  }

  private async projectRootForCwd(cwd: string | undefined): Promise<string> {
    if (cwd === undefined) throw new Error('project Session persistence requires a Session header cwd')
    const canonicalCwd = await realpath(cwd)
    const root = this.workspaceRegistry().listProjectRoots()
      .filter(root => containsPath(root, canonicalCwd))
      .sort((left, right) => right.length - left.length)[0]
    if (root === undefined) throw new Error(`no registered Workspace contains Session cwd '${canonicalCwd}'`)
    return root
  }

  private async locate(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ readonly backend: Backend; readonly snapshot: SessionPersistenceSnapshot } | undefined> {
    const registry = this.workspaceRegistry()
    const owner = registry.projectRootForSession(id)
    const roots = owner === undefined ? registry.listProjectRoots() : [owner]
    let found: { readonly backend: Backend; readonly snapshot: SessionPersistenceSnapshot } | undefined
    for (const root of roots) {
      signal?.throwIfAborted()
      const backend = await this.backend(root)
      const snapshot = await backend.persistence.stat(id, signal === undefined ? {} : { signal })
      if (snapshot === undefined) continue
      if (found !== undefined) throw new Error(`session '${id}' exists under multiple Workspace roots`)
      found = { backend, snapshot }
    }
    return found
  }

  private async backend(projectRoot: string): Promise<Backend> {
    const previous = this.backendTail
    const { promise, resolve } = Promise.withResolvers<void>()
    this.backendTail = promise
    await previous
    try {
      if (this.disposed) throw new Error('project Session persistence is disposing')
      const current = this.backends.get(projectRoot)
      if (current !== undefined) return current
      const scope = this.ctx.isolate('sessionPersistence')
      const fiber = scope.plugin(JsonlSessionPersistence, {
        root: join(projectRoot, '.aster', 'sessions'),
        compression: this.compression,
      })
      let persistence: SessionPersistence
      try {
        await fiber.await()
        const provided = scope.get('sessionPersistence')
        if (provided === undefined) throw new Error('project JSONL backend did not provide Session persistence')
        persistence = provided
      } catch (error) {
        await fiber.dispose()
        throw error
      }
      const backend: Backend = {
        persistence,
        dispose: async () => { await fiber.dispose() },
      }
      this.backends.set(projectRoot, backend)
      return backend
    } finally {
      resolve()
    }
  }
}

function containsPath(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export default ProjectSessionPersistence
