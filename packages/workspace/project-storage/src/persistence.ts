import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import JsonlSessionPersistence, { type JsonlCompression } from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  SessionPersistence, SessionPersistenceNotFoundError,
  type SessionAccess, type SessionHandle, type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions, type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot, type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import type {} from './index.ts'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectId, ProjectSessionLocation } from './types.ts'

interface Config { compression?: JsonlCompression }
interface Backend {
  readonly projectId: ProjectId
  readonly revision: string
  readonly persistence: SessionPersistence
  readonly dispose: () => Promise<void>
  activeHandles: number
}

/** Project-local router that delegates each Session to its immutable JSONL backend. */
export class ProjectSessionPersistence extends SessionPersistence {
  static inject = ['projectStorage']
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
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'project Session persistence teardown failed')
    }, 'projectSessionPersistence.backends')
  }

  /**
   * Create a project-owned Session after binding its header to one registered project.
   * @param header - immutable stored Session metadata.
   * @param options - inherited fork cut and cancellation.
   * @returns the project backend's owned write handle.
   */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const location = await this.ctx.projectStorage.bindSession(header, options?.signal)
    await this.requireWritable(location, options?.signal)
    const backend = await this.backend(location)
    return this.track(backend, await backend.persistence.create(header, options))
  }

  /**
   * Open one uniquely owned project Session.
   * @param id - Session identifier from the project manifest.
   * @param access - read-only access or single-writer access.
   * @param options - optional cancellation.
   * @returns the project backend's open handle.
   */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const location = this.ctx.projectStorage.locateSession(id)
    if (location === undefined) throw new SessionPersistenceNotFoundError(id)
    if (access === 'write') await this.requireWritable(location, options?.signal)
    else await this.requireAvailable(location, options?.signal)
    const backend = await this.backend(location)
    return this.track(backend, await backend.persistence.open(id, access, options))
  }

  /**
   * Flush every active project backend and aggregate failures.
   * @returns completion after all active backends flush.
   */
  async flush(): Promise<void> {
    const results = await Promise.allSettled([...this.backends.values()].map(backend => backend.persistence.flush()))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'one or more project Session stores failed to flush')
  }

  /**
   * Observe one Session in its registered project without reading its events.
   * @param id - Session identifier from the project manifest.
   * @param options - optional cancellation.
   * @returns stored metadata, or `undefined` when the owner backend has no record.
   */
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const location = this.ctx.projectStorage.locateSession(id)
    if (location === undefined) throw new SessionPersistenceNotFoundError(id)
    await this.requireAvailable(location, options?.signal)
    return (await this.backend(location)).persistence.stat(id, options)
  }

  /**
   * List stored Sessions belonging to registered, available projects.
   * @param options - optional cancellation.
   * @returns one snapshot per listed project Session.
   */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const snapshots: SessionPersistenceSnapshot[] = []
    for (const binding of this.ctx.projectStorage.list()) {
      options?.signal?.throwIfAborted()
      const status = await this.ctx.projectStorage.status(binding.id, options?.signal)
      if (status === 'missing') continue
      const manifest = this.ctx.projectStorage.manifest(binding.id)
      const first = manifest.sessions[0]
      if (first === undefined) continue
      const location = this.ctx.projectStorage.locateSession(first.id)
      if (location === undefined) throw new Error(`project Session membership has no registered location: ${first.id}`)
      const backend = await this.backend(location)
      const owned = new Set(manifest.sessions.map(session => session.id))
      for (const snapshot of await backend.persistence.list(options)) {
        if (owned.has(snapshot.header.id)) snapshots.push(snapshot)
      }
    }
    return snapshots
  }

  private async backend(location: ProjectSessionLocation): Promise<Backend> {
    let release!: () => void
    const previous = this.backendTail
    this.backendTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      if (this.disposed) throw new Error('project Session persistence is disposing')
      const key = String(location.projectId)
      const current = this.backends.get(key)
      if (current !== undefined && current.revision === location.bindingRevision) return current
      if (current !== undefined) {
        if (current.activeHandles !== 0) throw new Error(`cannot rebind project ${location.projectId} while Session handles are open`)
        await current.persistence.flush()
        await current.dispose()
        this.backends.delete(key)
      }
      const scope = this.ctx.isolate('sessionPersistence')
      const fiber = scope.plugin(JsonlSessionPersistence, { root: location.sessionsRoot, compression: this.compression })
      let persistence: SessionPersistence
      try {
        await fiber.await()
        // The parent scope's property lookup can return this router's own service.
        const provided = scope.get('sessionPersistence')
        if (provided === undefined) throw new Error('project JSONL backend did not provide Session persistence')
        persistence = provided
      } catch (error) {
        await fiber.dispose()
        throw error
      }
      const backend: Backend = {
        projectId: location.projectId,
        revision: location.bindingRevision,
        persistence,
        dispose: async () => { await fiber.dispose() },
        activeHandles: 0,
      }
      this.backends.set(key, backend)
      return backend
    } finally {
      release()
    }
  }

  private track(backend: Backend, handle: SessionHandle): SessionHandle {
    backend.activeHandles += 1
    let closed = false
    const close = async (): Promise<void> => {
      if (closed) return
      await handle.close()
      closed = true
      backend.activeHandles -= 1
    }
    return new Proxy(handle, {
      get(target, property, receiver) {
        if (property === 'close' || property === Symbol.asyncDispose) return close
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  private async requireWritable(location: ProjectSessionLocation, signal?: AbortSignal): Promise<void> {
    const status = await this.ctx.projectStorage.status(location.projectId, signal)
    if (status !== 'available') throw new Error(`project ${location.projectId} is ${status}; Session writes are unavailable`)
  }

  private async requireAvailable(location: ProjectSessionLocation, signal?: AbortSignal): Promise<void> {
    const status = await this.ctx.projectStorage.status(location.projectId, signal)
    if (status === 'missing') throw new Error(`project ${location.projectId} is missing; Session history is unavailable`)
  }
}

export default ProjectSessionPersistence
