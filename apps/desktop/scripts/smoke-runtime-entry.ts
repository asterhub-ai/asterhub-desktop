/** Run the Desktop Host smoke under the same Electron Node runtime as the Host child. */
import { verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { smokeDesktopRuntime } from './smoke-runtime.ts'

async function main(): Promise<void> {
  const [root, node, resourcesRuntime, expectedVersion, platform, arch] = process.argv.slice(2)
  if (root === undefined || node === undefined || resourcesRuntime === undefined || expectedVersion === undefined
    || (platform !== 'darwin' && platform !== 'win32') || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error('desktop runtime smoke: invalid arguments')
  }
  const descriptor = await verifyDesktopRuntime(root, expectedVersion, { platform, arch })
  await smokeDesktopRuntime(root, node, descriptor, process.env, resourcesRuntime)
}

await main()
