/** Trusted input dispatching for offscreen browser windows and viewport-mapped coordinates. */
import type { WebContents } from 'electron'
import type {
  DesktopBrowserPoint,
  DesktopBrowserPointerAction,
} from '@deepseek-ai/dsh-browser-use-desktop/types'
import type { DesktopBrowserViewport } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'

/** Dispatch a pointer action at coordinates mapped to CSS viewport pixels. */
export async function dispatchPointerAction(
  guest: WebContents,
  viewport: DesktopBrowserViewport,
  action: DesktopBrowserPointerAction,
  options: {
    readonly x?: number | undefined
    readonly y?: number | undefined
    readonly deltaX?: number | undefined
    readonly deltaY?: number | undefined
    readonly path?: readonly DesktopBrowserPoint[] | undefined
  },
): Promise<void> {
  const checkBounds = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Coordinates must be finite numbers: x=${x}, y=${y}`)
    }
    if (x < 0 || y < 0 || x > viewport.cssWidth || y > viewport.cssHeight) {
      throw new Error(`Coordinates (${x}, ${y}) exceed viewport bounds (${viewport.cssWidth}x${viewport.cssHeight})`)
    }
  }

  switch (action) {
    case 'click': {
      if (options.x === undefined || options.y === undefined) {
        throw new Error('Pointer click action requires x and y coordinates')
      }
      checkBounds(options.x, options.y)
      const x = Math.round(options.x)
      const y = Math.round(options.y)
      guest.sendInputEvent({ type: 'mouseMove', x, y })
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      break
    }
    case 'doubleClick': {
      if (options.x === undefined || options.y === undefined) {
        throw new Error('Pointer doubleClick action requires x and y coordinates')
      }
      checkBounds(options.x, options.y)
      const x = Math.round(options.x)
      const y = Math.round(options.y)
      guest.sendInputEvent({ type: 'mouseMove', x, y })
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 2 })
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 2 })
      break
    }
    case 'move': {
      if (options.x === undefined || options.y === undefined) {
        throw new Error('Pointer move action requires x and y coordinates')
      }
      checkBounds(options.x, options.y)
      guest.sendInputEvent({ type: 'mouseMove', x: Math.round(options.x), y: Math.round(options.y) })
      break
    }
    case 'scroll': {
      if (options.x === undefined || options.y === undefined) {
        throw new Error('Pointer scroll action requires x and y coordinates')
      }
      checkBounds(options.x, options.y)
      guest.sendInputEvent({
        type: 'mouseWheel',
        x: Math.round(options.x),
        y: Math.round(options.y),
        deltaX: options.deltaX ?? 0,
        deltaY: options.deltaY ?? 0,
      })
      break
    }
    case 'drag': {
      if (!options.path || options.path.length < 2) {
        throw new Error('Pointer drag action requires a path with at least 2 points')
      }
      for (const pt of options.path) checkBounds(pt.x, pt.y)
      const first = options.path[0]
      const last = options.path[options.path.length - 1]
      if (first === undefined || last === undefined) throw new Error('Pointer drag action requires a path with at least 2 points')
      const start = first
      const end = last
      guest.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x), y: Math.round(start.y) })
      guest.sendInputEvent({ type: 'mouseDown', x: Math.round(start.x), y: Math.round(start.y), button: 'left', clickCount: 1 })
      for (let i = 1; i < options.path.length; i++) {
        const pt = options.path[i]
        if (pt === undefined) throw new Error('Pointer drag path contains an undefined point')
        guest.sendInputEvent({ type: 'mouseMove', x: Math.round(pt.x), y: Math.round(pt.y) })
      }
      guest.sendInputEvent({ type: 'mouseUp', x: Math.round(end.x), y: Math.round(end.y), button: 'left', clickCount: 1 })
      break
    }
  }
}

/** Insert text into the target page. */
export async function insertPageText(guest: WebContents, text: string): Promise<void> {
  if (text.length === 0) return
  await guest.insertText(text)
}

/** Replace the focused control's contents using native select-all and text input events. */
export async function replacePageText(guest: WebContents, text: string): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'meta' : 'control'
  const modifierKey = modifier === 'meta' ? 'Meta' : 'Control'
  guest.sendInputEvent({ type: 'keyDown', keyCode: modifierKey })
  guest.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [modifier] })
  guest.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [modifier] })
  guest.sendInputEvent({ type: 'keyUp', keyCode: modifierKey })
  await guest.insertText(text)
}

/** Dispatch key presses to the target page. */
export function dispatchPageKeys(guest: WebContents, keys: readonly string[]): void {
  for (const key of keys) {
    guest.sendInputEvent({ type: 'keyDown', keyCode: key })
    guest.sendInputEvent({ type: 'keyUp', keyCode: key })
  }
}
