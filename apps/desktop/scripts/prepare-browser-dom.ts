/** Extract the generated injected DOM script from pinned playwright-core and package as an immutable asset. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('playwright-core/package.json')
const pwDir = dirname(pkgPath)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }

if (pkg.version !== '1.59.1') {
  throw new Error(`Expected playwright-core@1.59.1, but found ${pkg.version}`)
}

const srcFile = join(pwDir, 'lib', 'generated', 'injectedScriptSource.js')
const rawModule = readFileSync(srcFile, 'utf8')
const sandbox = { module: { exports: { source: '' } } }
vm.runInNewContext(rawModule, sandbox)

const source = sandbox.module.exports.source
if (typeof source !== 'string' || source.length < 100_000) {
  throw new Error('Failed to extract valid injectedScriptSource from playwright-core')
}

const outDir = fileURLToPath(new URL('../src/generated', import.meta.url))
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'playwright-injected-source.ts')

const code = `/** Immutable generated injected DOM script asset from pinned playwright-core@${pkg.version}. @module */
export const PLAYWRIGHT_INJECTED_SOURCE = ${JSON.stringify(source)} as const
export const PLAYWRIGHT_CORE_VERSION = ${JSON.stringify(pkg.version)} as const
`

writeFileSync(outFile, code, 'utf8')
console.log(`prepare-browser-dom: extracted ${source.length} chars from playwright-core@${pkg.version} -> ${outFile}`)
