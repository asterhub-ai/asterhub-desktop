import { createDesktopBrowserTransport } from '@deepseek-ai/dsh-browser-use-desktop/transport'
import type { DesktopBrowserTransportPort } from '@deepseek-ai/dsh-browser-use-desktop/transport'
import type { DesktopBrowserTransport } from '@deepseek-ai/dsh-browser-use-desktop/types'

/** Create the Browser Use transport backed by the authenticated Electron parent IPC channel. */
export function createDesktopHostBrowserTransport(): DesktopBrowserTransport {
  const port: DesktopBrowserTransportPort = {
    send(message) {
      if (process.connected !== true || process.send === undefined) {
        return Promise.reject(new Error('Desktop Browser Host is unavailable'))
      }
      const { promise, resolve, reject } = Promise.withResolvers<void>()
      process.send(message, (error) => {
        if (error !== null) reject(error)
        else resolve()
      })
      return promise
    },
    subscribe(listener) {
      process.on('message', listener)
      return () => { process.off('message', listener) }
    },
    connected: () => process.connected === true && process.send !== undefined,
    onDisconnect(listener) {
      process.once('disconnect', listener)
      return () => { process.off('disconnect', listener) }
    }
  }
  return createDesktopBrowserTransport(port)
}
