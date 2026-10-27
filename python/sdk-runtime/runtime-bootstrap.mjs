#!/usr/bin/env node
/** Private entry owned by the Python single-file runtime packaging. */
import { registerHooks } from 'node:module'
import { delimiter, dirname, isAbsolute, join } from 'node:path'import { isSea } from 'node:sea'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (isSea()) {
  // Office spawns executable helpers and URL workers; its complete package tree must be real files.
  const parentURL = pathToFileURL(`${process.execPath.replace(/\.exe$/i, '')}-office/package.json`).href
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const office = specifier === '@deepseek-ai/libreoffice-kit' || specifier === '@deepseek-ai/libreoffice-kit/package.json'
      return nextResolve(specifier, office ? { ...context, parentURL } : context)
    },
  })
}

const selectorName = 'DSH_SUBPROCESS_RUNNER'
const selection = process.env[selectorName]
const aclRunner = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))

if (aclRunner !== undefined && process.argv[2] === aclRunner) {
  process.argv.splice(1, 1)
  await import('@deepseek-ai/dsh-sandbox-windows-acl/runner')
} else if (process.env.DSH_PTC_RUNTIME_NODE === '1') {
  Reflect.deleteProperty(process.env, 'DSH_PTC_RUNTIME_NODE')
  await import('@deepseek-ai/dsh-ptc-runtime-node/process')
} else if (selection === undefined) {
  if (isSea()) {
    // Carrier default stays separate so process/home environment and profile patches can override it.
    const platform = 'win'
    process.env.DSH_BUNDLED_PRIMARY_RUNTIME = join(dirname(process.execPath), `${platform}-${process.arch}`, 'primary-runtime')
  }
  let packageManager
  const primary = process.env.DSH_PRIMARY_RUNTIME ?? process.env.DSH_BUNDLED_PRIMARY_RUNTIME
  if (primary !== undefined && primary !== '') {
    const { resolvePrimaryRuntime } = await import('@deepseek-ai/dsh-tool-workspace-dependencies')
    const { node, pnpm } = await resolvePrimaryRuntime(primary)
    if (node !== undefined && pnpm !== undefined) {
      packageManager = { command: node, args: [pnpm],
        env: { PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` } }
    }
  }
  const { runCli } = await import('@deepseek-ai/dsh/lib/bin.js')
  await runCli({ packageManager })
} else {
  Reflect.deleteProperty(process.env, selectorName)
  const { runSelectedSubprocessRunner } = await import('@deepseek-ai/dsh-subprocess-local/runner')
  await runSelectedSubprocessRunner(selection)
}
