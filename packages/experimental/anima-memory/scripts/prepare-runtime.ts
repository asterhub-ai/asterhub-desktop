/** Prepare the platform-specific Anima database runtimes included in Desktop installers. */

import { prepareNeo4jRuntime } from '../src/neo4j-runtime.ts'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'

const platform = process.env.DSH_DESKTOP_TARGET_PLATFORM
const architecture = process.env.DSH_DESKTOP_TARGET_ARCH
const destination = process.env.DSH_ANIMA_RUNTIME_DESTINATION
if ((platform !== 'win32' && platform !== 'darwin') || (architecture !== 'x64' && architecture !== 'arm64')
  || destination === undefined || destination === '') {
  throw new Error('Anima runtime preparation requires a supported Desktop target and destination.')
}

const controller = new AbortController()
const abort = (): void => controller.abort(new Error('Anima runtime preparation was interrupted'))
process.once('SIGINT', abort)
process.once('SIGTERM', abort)
const disposeProxy = await installProxyFromEnvironment({
  get: (name) => {
    const value = process.env[name]
    return value === undefined ? undefined : { value }
  },
}, (message) => { console.warn(message) })
try {
  await prepareNeo4jRuntime({ platform, architecture, destination, signal: controller.signal })
} finally {
  process.removeListener('SIGINT', abort)
  process.removeListener('SIGTERM', abort)
  await disposeProxy()
}
