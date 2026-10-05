/** Client-owned observation of the optional Desktop preload. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopUpdateBridge, DesktopUpdateView } from '../types.ts'

/** Phases that represent an active update interaction the carrier owns. */
const ACTIVE_PHASES: Record<string, true> = { checking: true, downloading: true, verifying: true, installing: true }

/** Owns one preload subscription across both sidebar locations. */
export class DesktopUpdateSource {
  /** Framework-observed carrier status shared by both sidebar controls. */
  readonly store = createSnapshotStore<DesktopUpdateView>({ failed: false, opening: false })
  private live = true
  private received = false
  private readonly unsubscribe: (() => void) | undefined
  /** Single in-flight action that both open() and check() respect. */
  private actionPromise: Promise<void> | undefined

  /** @param bridge - Optional isolated Electron API, absent in ordinary browsers. */
  constructor(private readonly bridge: DesktopUpdateBridge | undefined) {
    this.unsubscribe = bridge?.subscribe((presentation) => {
      if (!this.live) return
      this.received = true
      this.store.set({ ...this.store.getSnapshot(), presentation, failed: false })
    })
    void bridge?.status().then((presentation) => {
      if (this.live && !this.received) this.store.set({ ...this.store.getSnapshot(), presentation, failed: false })
    }, () => {
      if (this.live && !this.received) this.store.set({ ...this.store.getSnapshot(), failed: true })
    })
  }

  /** Invoke one user action; subsequent clicks join the shell-owned operation. */
  open(): void {
    if (!this.live || this.bridge === undefined) return
    const state = this.store.getSnapshot()
    if (state.opening || this.actionPromise !== undefined
      || (state.presentation !== undefined
      && state.presentation.phase in ACTIVE_PHASES)) return
    this.store.set({ ...state, opening: true, failed: false })
    this.actionPromise = this.bridge.open().catch(() => {
      if (this.live) this.store.set({ ...this.store.getSnapshot(), failed: true })
    }).finally(() => {
      if (this.live) this.store.set({ ...this.store.getSnapshot(), opening: false })
      this.actionPromise = undefined
    })
  }

  /**
   * Trigger one main-owned manual check-and-consent prompt; concurrent calls
   * join the same carrier interaction. No-op while disposed, while an action
   * is already in-flight, or while an update is already checking, downloading,
   * verifying, or installing.
   * @returns the shared in-flight check promise, or void when no action runs.
   */
  check(): Promise<void> {
    if (!this.live || this.bridge === undefined) return Promise.resolve()
    if (this.actionPromise !== undefined) return this.actionPromise
    const state = this.store.getSnapshot()
    if (state.presentation !== undefined
      && state.presentation.phase in ACTIVE_PHASES) return Promise.resolve()
    this.store.set({ ...state, failed: false })
    this.actionPromise = this.bridge.check().catch(() => {
      if (this.live) this.store.set({ ...this.store.getSnapshot(), failed: true })
    }).finally(() => {
      this.actionPromise = undefined
    })
    return this.actionPromise
  }

  /** Detach the carrier and ignore any pending status or action completion. */
  dispose(): void { this.live = false; this.unsubscribe?.() }
}
