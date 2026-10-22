/** Selection and retention policy for independently owned Sidebar Session views. */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SidebarSessionView } from './session-view.ts'

/** The reference is exclusively a framework SessionProvider target, not a business-component service. */
export interface SidebarSessionViewSnapshot {
  readonly sessionId: SessionId
  readonly reference: SessionReference
  readonly selected: boolean
  /** Stable for this View's lifetime, independently of Session injection bindings. */
  readonly retainTab: SidebarSessionView['retainTab']
}

/** Selects and retires views; the Sidebar plugin's injected dependencies own global teardown. */
export class SidebarSessionViews {
  /** Selected and retained View targets observed by the root renderer. */
  readonly source = createSnapshotStore<readonly SidebarSessionViewSnapshot[]>([])
  private readonly views = new Map<SessionId, SidebarSessionView>()
  private readonly viewsByReference = new Map<SessionReference, SidebarSessionView>()
  /** Retention counts that keep a non-selected View alive; a View is pruned only at zero. */
  private readonly holds = new Map<SessionId, number>()
  private selected: SessionId | undefined
  private closed = false

  constructor(private readonly sessions: ISessions) {}

  /**
   * Change the foreground Session while preserving retained background Views.
   * @param sessionId - main selection, or absence.
   */
  select(sessionId: SessionId | undefined): void {
    if (this.closed || this.selected === sessionId) return
    this.selected = sessionId
    if (sessionId !== undefined) this.ensure(sessionId)
    for (const view of this.views.values()) this.prune(view)
    this.publish()
  }

  /**
   * Keep one Session's View alive without selecting it until the operation ends.
   *
   * The View is created when absent exactly as `select()` creates it, indexed by
   * its reference, and published to the root renderer. The promise settles after
   * the reference's initial Session open, so the View is owned and the root
   * renderer has been told to mount it; the store adoption that follows the
   * renderer's commit is not observable here.
   * @param sessionId - Session whose View must survive background tab work.
   * @param signal - operation lifetime; abort releases the hold.
   * @returns an idempotent release that drops this hold; safe after disposal.
   */
  async retain(sessionId: SessionId, signal: AbortSignal): Promise<() => void> {
    if (this.closed || signal.aborted) return () => {}
    const view = this.ensure(sessionId)
    this.holds.set(sessionId, (this.holds.get(sessionId) ?? 0) + 1)
    this.publish()
    let held = true
    const release = (): void => {
      if (!held) return
      held = false
      signal.removeEventListener('abort', release)
      this.releaseHold(sessionId)
      this.prune(view)
    }
    signal.addEventListener('abort', release, { once: true })
    try {
      await view.reference.ready
    } catch (error) {
      release()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal and abort can occur during the await.
      if (this.closed || signal.aborted) return () => {}
      throw error
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Abort can occur during the await.
    if (signal.aborted) {
      release()
      return () => {}
    }
    return release
  }

  /**
   * Bind a committed root; release retired references after that root unmounts.
   * @param reference - framework target published by this owner.
   * @returns releases this committed mount.
   */
  mount(reference: SessionReference): () => void {
    const view = this.viewsByReference.get(reference)
    if (view === undefined) {
      if (this.closed) return () => {}
      throw new Error('Sidebar Session view reference is no longer owned')
    }
    return view.mount()
  }

  /** Plugin shutdown releases every view, including any awaiting a React unmount. */
  dispose(): void {
    this.closed = true
    this.holds.clear()
    this.views.clear()
    this.source.set([])
    for (const view of this.viewsByReference.values()) view.dispose()
  }

  /** Create the single View for a Session; `select()` and `retain()` share this constructor shape. */
  private ensure(sessionId: SessionId): SidebarSessionView {
    const existing = this.views.get(sessionId)
    if (existing !== undefined) return existing
    const view = new SidebarSessionView(sessionId, this.sessions, (disposed) => {
      this.viewsByReference.delete(disposed.reference)
    }, (released) => { this.prune(released) })
    this.views.set(sessionId, view)
    this.viewsByReference.set(view.reference, view)
    return view
  }

  private releaseHold(sessionId: SessionId): void {
    const count = this.holds.get(sessionId)
    if (count === undefined) return
    if (count > 1) this.holds.set(sessionId, count - 1)
    else this.holds.delete(sessionId)
  }

  private prune(view: SidebarSessionView): void {
    if (view.sessionId === this.selected || (this.holds.get(view.sessionId) ?? 0) > 0
      || view.hasRetainedTabs || this.views.get(view.sessionId) !== view) return
    this.views.delete(view.sessionId)
    // Render targets must be withdrawn before an unmounted view can release its reference.
    this.publish()
    view.retire()
  }

  private publish(): void {
    this.source.set([...this.views.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)).map(view => ({
      sessionId: view.sessionId, reference: view.reference, selected: view.sessionId === this.selected, retainTab: view.retainTab,
    })))
  }
}
