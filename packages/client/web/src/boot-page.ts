/**
 * Minimal shell shown while the workspace mounts. It stays static so startup
 * never displays a loading animation or internal plugin names.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Static shell mounted before the application renderer takes the mount point. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly mark: HTMLImageElement
  private readonly wordmark: HTMLDivElement
  private failure = false

  /** Build and attach the static shell. */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.mark = document.createElement('img')
    this.mark.className = css.mark ?? ''
    this.mark.src = '/favicon.svg'
    this.mark.alt = ''
    this.mark.setAttribute('aria-hidden', 'true')
    this.wordmark = div(css.wordmark, 'AsterHub')
    this.card.append(this.mark, this.wordmark)
    this.root.append(this.card)
    container.append(this.root)
  }

  /** Retained for the loader interface; startup does not render progress.
   * @param _total - number of client modules in the startup plan.
   */
  setTotal(_total: number): void {}

  /** Replace the static shell with a generic failure message when a module fails.
   * @param _id - failed module identifier; never shown to the user.
   * @param state - loader state for the module.
   */
  setState(_id: string, state: LoaderEntryState): void {
    if (state === 'failed') this.showFailure()
  }

  /** Keep raw failure details out of the application page.
   * @param _message - failure detail; never shown to the user.
   */
  fail(_message: string): void {
    this.showFailure()
  }

  /** Detach the page after the application renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  private showFailure(): void {
    if (this.failure) return
    this.failure = true
    const message = document.documentElement.lang.toLowerCase().startsWith('zh')
      ? 'AsterHub 无法启动，请重启后重试。'
      : 'AsterHub could not start. Restart the application and try again.'
    this.card.replaceChildren(this.mark, this.wordmark, div(css.failed, message))
  }
}
