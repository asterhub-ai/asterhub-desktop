/**
 * Toast notification source for automation operations.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Toast kind. */
export type ToastKind = 'created' | 'updated' | 'deleted' | 'paused' | 'resumed' | 'runStarted' | 'stopped' | 'error' | 'conflict'

/** One toast entry. */
export interface ToastEntry {
  readonly id: number
  readonly kind: ToastKind
  readonly message?: string
  readonly taskId?: string
}

/** Toast snapshot. */
export interface ToastSnapshot {
  readonly toasts: readonly ToastEntry[]
}

/** Toast source. */
export interface ToastSource {
  readonly hooks: {
    readonly toasts: HostObservable<ToastSnapshot>
  }
  readonly report: (entry: Omit<ToastEntry, 'id'>) => void
  readonly dismiss: (id: number) => void
  readonly clearAll: () => void
}

/**
 * Create a toast source.
 * @returns toast source.
 */
export function createToastSource(): ToastSource {
  let nextId = 1
  let snapshot: ToastSnapshot = { toasts: [] }
  const listeners = new Set<(snapshot: ToastSnapshot) => void>()

  const emit = (next: ToastSnapshot): void => {
    snapshot = next
    for (const listener of listeners) {
      listener(next)
    }
  }

  const report = (entry: Omit<ToastEntry, 'id'>): void => {
    const toast: ToastEntry = { id: nextId++, ...entry }
    emit({ toasts: [...snapshot.toasts, toast] })
    // Auto-dismiss after 5 seconds
    const toastId = toast.id
    setTimeout(() => { dismiss(toastId) }, 5000)
  }
  const dismiss = (id: number): void => {
    emit({ toasts: snapshot.toasts.filter(toast => toast.id !== id) })
  }

  const clearAll = (): void => {
    emit({ toasts: [] })
  }

  const subscribe = (listener: (snapshot: ToastSnapshot) => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const getSnapshot = (): ToastSnapshot => snapshot
  return {
    hooks: { toasts: { getSnapshot, subscribe } },
    report,
    dismiss,
    clearAll,
  }
}
