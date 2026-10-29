/**
 * One-shot adoption of project-local Sessions discovered beneath a registered
 * Workspace root: listening trigger, per-Workspace scan, and the append-then-
 * account pair that rehomes Sessions moved from another machine.
 * @module @deepseek-ai/dsh-project-adopt
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { appendWorkingDirectoryEvent } from './adopt-session.ts'

export { appendWorkingDirectoryEvent } from './adopt-session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Adopts project-local Sessions into their Workspace record. */
    projectAdopt: ProjectAdoptService
  }
}

/**
 * Adopts every Session physically stored under a Workspace's `.aster/sessions`
 * into that Workspace's record (`ctx.projectAdopt`). The `domain/changed`
 * listener adopts each newly written Workspace once per process; explicit
 * callers share the same memoized run through {@link adoptWorkspace}.
 */
export class ProjectAdoptService extends Service {
  static inject = ['workspaceRegistry', 'sessionPersistence']

  /** One adoption run per Workspace identity; repeated writes (title changes, membership mutations) reuse it. */
  private readonly adopted = new Map<WorkspaceId, Promise<void>>()

  /** @param ctx - Host context containing the Workspace registry and project Session persistence. */
  constructor(ctx: Context) {
    super(ctx, 'projectAdopt')
  }

  protected [Service.init](): void {
    this.ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
  }

  /**
   * Adopt the project-local Sessions discovered under one Workspace's `.aster/sessions`.
   * Each discovered Session not accounted by any Workspace record first receives
   * its `working-directory/change` event and then enters the record through
   * `workspaceRegistry.adoptSession`; the event precedes membership because
   * `adoptSession` requires the caller to commit it first. A Session whose
   * adoption fails is logged and skipped, so one bad log cannot block the rest;
   * the next adoption retries it because both steps are idempotent.
   * @param id - Workspace record to adopt into; an unknown id resolves without work.
   * @returns completion after every discovered Session is adopted or individually failed.
   * @throws when the Workspace scan itself fails. Repeated calls for one id share the
   *   process's first run; a failed run is retried by the next call.
   */
  async adoptWorkspace(id: WorkspaceId): Promise<void> {
    const pending = this.adopted.get(id)
    if (pending !== undefined) return pending
    const run = this.adoptSessions(id)
    this.adopted.set(id, run)
    return run.catch((error: unknown) => {
      this.adopted.delete(id)
      throw error
    })
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace' || change.table !== 'workspaces' || change.operation !== 'put') return
    // Fire-and-forget trigger: the domain writer must not wait on adoption, so
    // scan failures log here while adoptWorkspace awaiters observe the rejection.
    this.adoptWorkspace(WorkspaceId(change.key)).catch((error: unknown) => {
      this.ctx.logger.error(`project-adopt: adoption of workspace '${change.key}' failed: ${String(error)}`)
    })
  }

  private async adoptSessions(id: WorkspaceId): Promise<void> {
    const workspace = this.ctx.workspaceRegistry.get(id)
    if (workspace === undefined) return
    const sessionsRoot = join(workspace.path, '.aster', 'sessions')
    try {
      if (!(await stat(sessionsRoot)).isDirectory()) return
    } catch (error) {
      // A directory without `.aster/sessions` has nothing to adopt.
      if (isMissingPath(error)) return
      throw error
    }
    const unaccounted = (await this.ctx.sessionPersistence.list()).filter(snapshot =>
      snapshot.location !== undefined
      && containsPath(sessionsRoot, snapshot.location.path)
      && this.ctx.workspaceRegistry.projectRootForSession(snapshot.header.id) === undefined)
    for (const snapshot of unaccounted) {
      const sessionId = snapshot.header.id
      try {
        // Order: commit the working-directory event before registry membership,
        // as `adoptSession` requires the caller to commit it first.
        await appendWorkingDirectoryEvent(this.ctx.sessionPersistence, sessionId, workspace.path)
        await this.ctx.workspaceRegistry.adoptSession(id, sessionId, workspace.path)
      } catch (error) {
        this.ctx.logger.error(
          `project-adopt: adopting session '${sessionId}' into workspace '${workspace.path}' failed; `
          + `the next adoption retries it: ${String(error)}`,
        )
      }
    }
  }
}

/** Whether `child` is `parent` itself or a path beneath it, compared lexically in one separator spelling. */
function containsPath(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export default ProjectAdoptService
