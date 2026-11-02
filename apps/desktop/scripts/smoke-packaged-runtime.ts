/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'
import { verifyNeo4jRuntime } from '@deepseek-ai/dsh-anima-memory/src/neo4j-runtime.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
if (target !== 'win-x64') throw new Error('desktop smoke: win-x64 is the only supported target')
const artifacts = values.unsigned ? paths.unsignedArtifacts : paths.artifacts
const application = join(artifacts, 'win-unpacked')
const resources = join(application, 'resources')
const executable = join(application, 'AsterHub.exe')
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
const animaRuntime = join(resources, 'anima-runtime')
const platform = 'win32'
const architecture = 'x64'
await verifyNeo4jRuntime(animaRuntime, platform, architecture)
if (!values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
