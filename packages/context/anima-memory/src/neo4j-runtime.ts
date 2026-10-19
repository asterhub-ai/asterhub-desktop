/** Own the lifecycle and private state of one local Neo4j Community process. */

import { createHash, randomBytes } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import extractZip from 'extract-zip'
import neo4j from 'neo4j-driver'
import type { Session } from 'neo4j-driver'
import { x as extractTar } from 'tar'
import { acquireFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { findJavaHome } from './runtime-layout.ts'
import {
  JRE_RELEASE,
  NEO4J_VERSION,
  RUNTIME_MANIFEST_NAME,
  neo4jPlatformAsset,
  neo4jRuntimeManifest,
  type Neo4jPlatformAsset,
  type Neo4jRuntimeManifest,
} from './runtime-assets.ts'

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const PORT_ATTEMPTS = 5
const POLL_INTERVAL_MS = 200
const PROCESS_STOP_TIMEOUT_MS = 10_000
const PROBE_CONNECT_TIMEOUT_MS = 2_000
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const CREDENTIALS_FILE = 'neo4j-credentials.json'
const SETTINGS_FILE = 'neo4j.conf'

/** Private Neo4j credentials persisted in the AsterHub data directory. */
interface CredentialRecord {
  schema_id: 'anima.neo4j-credentials/v1'
  username: 'neo4j'
  password: string
  database: 'neo4j'
  initialized: boolean
}

/** Resolved Java runtime archive returned by the pinned Adoptium metadata endpoint. */
interface JavaArchive {
  url: string
  checksum: string
  archive: 'zip' | 'tar.gz'
}

/** Minimal child process contract used by lifecycle tests and the real process launcher. */
export interface Neo4jRuntimeProcess {
  /** Process id assigned by the operating system. */
  readonly pid?: number | undefined
  /** Exit status, or null while running and after a signal exit. */
  readonly exitCode: number | null
  /** Operating-system signal when the child exited without an exit code. */
  readonly signalCode?: NodeJS.Signals | null | undefined
  /** Observe process startup errors and exit.
   * @param event - child process event name.
   * @param listener - event callback.
   * @returns this child process.
   */
  once(event: 'error', listener: (error: Error) => void): this
  /** Observe process startup errors and exit.
   * @param event - child process event name.
   * @param listener - event callback.
   * @returns this child process.
   */
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  /** Request termination of this process.
   * @param signal - operating-system signal when supported.
   * @returns whether the signal was delivered.
   */
  kill(signal?: NodeJS.Signals): boolean
}

/** Spawn contract accepted by the manager's process test seam.
 * @param command - executable path or operating-system command interpreter.
 * @param args - command arguments; credentials are never included.
 * @param options - working directory, filtered environment, and hidden stdio policy.
 * @returns the owned child process.
 */
export type Neo4jRuntimeSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: 'ignore'
    windowsHide: true
    shell: false
  },
) => Neo4jRuntimeProcess

/** Manager dependencies whose replacement lets lifecycle tests use a fake Java process. */
export interface Neo4jRuntimeDependencies {
  /** Fetch download, checksum, and Adoptium metadata URLs. */
  fetch?: typeof fetch
  /** Start Neo4j without shell interpolation or inherited stdout/stderr. */
  spawn?: Neo4jRuntimeSpawn
  /** Verify the Bolt listener and credentials after the child starts.
   * @param connection - candidate private loopback connection.
   * @param passwordNeedsInitialization - whether this data directory still has Neo4j's initial password.
   * @param signal - startup cancellation signal.
   * @param timeoutMs - time remaining before the startup deadline.
   * @returns true after authenticated Bolt connectivity succeeds.
   */
  probe?: (
    connection: Neo4jConnection,
    passwordNeedsInitialization: boolean,
    signal: AbortSignal,
    timeoutMs: number,
  ) => Promise<boolean>
  /** Stop only the process tree launched for this manager.
   * @param child - child process created by the manager.
   * @returns after the test process has stopped.
   */
  terminate?: (child: Neo4jRuntimeProcess) => Promise<void>
  /** Install verified archives into the supplied directory.
   * @param asset - pinned platform asset names and official checksum URLs.
   * @param destination - private directory receiving the installed runtime.
   * @param signal - download and installation cancellation signal.
   * @param fetcher - fetch implementation used for official manifests and archives.
   * @returns after both verified runtimes and their manifest are installed.
   */
  /** Replace archive installation to isolate lifecycle tests from network and extraction. */
  installRuntime?: (asset: Neo4jPlatformAsset, destination: string, signal: AbortSignal, fetcher: typeof fetch) => Promise<void>
}

/** Options for one locally-owned Neo4j instance. */
export interface EnsureNeo4jOptions {
  /** Private durable directory for credentials, graph data, logs, and runtime downloads. */
  dataRoot: string
  /** Optional packaged runtime tree containing `neo4j/`, `java/`, and the pinned manifest. */
  runtimeRoot?: string
  /** Maximum time to wait for Neo4j authentication and Bolt readiness. */
  startupTimeoutMs?: number
  /** Stop startup and the owned process tree when aborted. */
  signal?: AbortSignal
  /** Narrow test seam for process and network lifecycle behavior. */
  dependencies?: Neo4jRuntimeDependencies
}

/** Platform and destination for the runtime copied into an AsterHub Desktop installation. */
export interface PrepareNeo4jRuntimeOptions {
  /** Target operating system for the Desktop package. */
  platform: NodeJS.Platform
  /** Target CPU architecture for the Desktop package. */
  architecture: string
  /** Empty directory receiving the verified Neo4j and Java distributions. */
  destination: string
  /** Stop downloads and extraction when the packaging process is cancelled. */
  signal?: AbortSignal
  /** Fetch implementation used for metadata, checksums, and archives. */
  fetch?: typeof fetch
}

/** Connection data for the private local database. */
export interface Neo4jConnection {
  /** Loopback Bolt URI selected for this process. */
  uri: string
  /** Neo4j's single-owner local administrator. */
  username: 'neo4j'
  /** Random password persisted in the private AsterHub data directory. */
  password: string
  /** Neo4j Community's default database. */
  database: 'neo4j'
}

/** One running Neo4j instance and the caller-owned connection settings. */
export interface ManagedNeo4j {
  /** Private Bolt connection data for the owned process. */
  connection: Neo4jConnection
  /** Stop the owned process tree, wait for exit, then release its cross-process lock. */
  close(): Promise<void>
}

interface RuntimePaths {
  neo4jHome: string
  javaHome: string
  javaExecutable: string
  neo4jExecutable: string
  windows: boolean
}

interface ChildOutcome {
  code: number | null
  signal: NodeJS.Signals | null
}

interface ChildStatus {
  outcome?: ChildOutcome
  error?: Error
}

/**
 * Provision or reuse a pinned local Neo4j runtime, start it on a loopback Bolt port, and hold its owner lock until shutdown.
 * @param options - private data location, optional packaged runtime, startup budget, cancellation, and test dependencies.
 * @returns the local Bolt connection and an asynchronous process owner.
 */
export async function ensureNeo4j(options: EnsureNeo4jOptions): Promise<ManagedNeo4j> {
  validateOptions(options)
  const dataRoot = resolve(options.dataRoot)
  await ensurePrivateDirectory(dataRoot)
  const lock = await acquireFileLock(join(dataRoot, 'neo4j-owner'), { waitMs: 0 })
  let child: Neo4jRuntimeProcess | undefined
  let childStatus: ChildStatus | undefined
  let closing: Promise<void> | undefined
  let closed = false
  try {
    throwIfAborted(options.signal)
    const asset = neo4jPlatformAsset(process.platform, process.arch)
    const runtime = await resolveRuntime(options, dataRoot, asset)
    const credentials = await readOrCreateCredentials(dataRoot)
    const databaseRoot = join(dataRoot, 'database')
    await ensurePrivateDirectory(databaseRoot)
    const directories = await prepareDatabaseDirectories(databaseRoot)
    const deadline = Date.now() + (options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
    let connection: Neo4jConnection | undefined

    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
      throwIfAborted(options.signal)
      const port = await allocateLoopbackPort()
      await writeNeo4jConfig(directories.config, directories, port)
      const launched = launchNeo4j(runtime, directories.config, options.dependencies?.spawn ?? spawnRuntime)
      child = launched.child
      childStatus = launched.status
      const candidate: Neo4jConnection = {
        uri: `bolt://127.0.0.1:${port}`,
        username: credentials.username,
        password: credentials.password,
        database: credentials.database,
      }
      try {
        await waitForReadiness({
          connection: candidate,
          credentials,
          childStatus,
          deadline,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          probe: options.dependencies?.probe ?? probeNeo4j,
        })
        if (!credentials.initialized) {
          credentials.initialized = true
          await writeCredentialRecord(dataRoot, credentials)
        }
        connection = candidate
        break
      } catch (error) {
        const outcome = childStatus.outcome
        if (!options.signal?.aborted && Date.now() < deadline && attempt + 1 < PORT_ATTEMPTS) {
          if (outcome === undefined && child.pid !== undefined && child.exitCode === null) {
            await stopOwnedProcess(child, options.dependencies?.terminate ?? terminateProcess)
          }
          child = undefined
          childStatus = undefined
          continue
        }
        throw error
      }
    }
    if (connection === undefined || child === undefined || childStatus === undefined) {
      throw new Error('Anima Neo4j did not bind a usable loopback Bolt port.')
    }
    const managedChild = child

    return {
      connection,
      close: () => {
        if (closed) return Promise.resolve()
        if (closing !== undefined) return closing
        closing = (async () => {
          await stopOwnedProcess(managedChild, options.dependencies?.terminate ?? terminateProcess)
          await lock.release()
          closed = true
        })().catch((error: unknown) => {
          closing = undefined
          throw error
        })
        return closing
      },
    }
  } catch (error) {
    if (child !== undefined && child.pid !== undefined && child.exitCode === null) {
      try {
        await stopOwnedProcess(child, options.dependencies?.terminate ?? terminateProcess)
      } catch {
        // Keep the owner lock while a process may still be alive.
        throw error
      }
    }
    await lock.release()
    throw error
  }
}

function validateOptions(options: EnsureNeo4jOptions): void {
  if (typeof options.dataRoot !== 'string' || !isAbsolute(options.dataRoot)) {
    throw new TypeError('Anima Neo4j dataRoot must be an absolute path.')
  }
  const timeout = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 300_000) {
    throw new TypeError('Anima Neo4j startupTimeoutMs must be an integer from 1000 through 300000.')
  }
}

async function resolveRuntime(options: EnsureNeo4jOptions, dataRoot: string, asset: Neo4jPlatformAsset): Promise<RuntimePaths> {
  if (options.runtimeRoot !== undefined) {
    return readRuntimePaths(resolve(options.runtimeRoot), asset)
  }
  const installRoot = join(dataRoot, 'runtime', `${asset.platform}-${asset.architecture}`)
  const installed = await readRuntimePaths(installRoot, asset).catch(() => undefined)
  if (installed !== undefined) return installed
  const dependencies = options.dependencies
  const signal = options.signal ?? new AbortController().signal
  const install = dependencies?.installRuntime ?? installRuntimeAssets
  await install(asset, installRoot, signal, dependencies?.fetch ?? fetch)
  return readRuntimePaths(installRoot, asset)
}

async function readRuntimePaths(root: string, asset: Neo4jPlatformAsset): Promise<RuntimePaths> {
  const manifestPath = join(root, RUNTIME_MANIFEST_NAME)
  await assertRealDirectory(root)
  await assertRegularFile(manifestPath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Neo4jRuntimeManifest
  const expected = neo4jRuntimeManifest(asset.platform, asset.architecture)
  if (!isRuntimeManifest(manifest, expected)) throw new Error('Anima packaged runtime manifest does not match the pinned runtime.')
  const neo4jHome = join(root, 'neo4j')
  const javaHome = join(root, 'java')
  const windows = asset.platform === 'win32'
  const javaExecutable = join(javaHome, 'bin', windows ? 'java.exe' : 'java')
  const neo4jExecutable = join(neo4jHome, 'bin', windows ? 'neo4j.bat' : 'neo4j')
  await assertRegularFile(javaExecutable)
  await assertRegularFile(neo4jExecutable)
  await assertRealDirectory(neo4jHome)
  await assertRealDirectory(javaHome)
  return { neo4jHome, javaHome, javaExecutable, neo4jExecutable, windows }
}

/**
 * Download and install checksum-verified Neo4j and Java runtimes for a Desktop package.
 * @param options - target platform, destination, cancellation, and network implementation.
 * @returns after both runtimes and their pinned manifest are installed.
 */
export async function prepareNeo4jRuntime(options: PrepareNeo4jRuntimeOptions): Promise<void> {
  const asset = neo4jPlatformAsset(options.platform, options.architecture)
  const signal = options.signal ?? new AbortController().signal
  await installRuntimeAssets(asset, resolve(options.destination), signal, options.fetch ?? fetch)
}

/**
 * Validate the pinned runtime directory copied into a Desktop installer.
 * @param root - Packaged Neo4j and Java directory.
 * @param platform - Target operating system.
 * @param architecture - Target CPU architecture.
 * @returns after the manifest, directories, and platform executables match the pinned target.
 */
export async function verifyNeo4jRuntime(root: string, platform: NodeJS.Platform, architecture: string): Promise<void> {
  await readRuntimePaths(resolve(root), neo4jPlatformAsset(platform, architecture))
}

async function installRuntimeAssets(
  asset: Neo4jPlatformAsset,
  destination: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<void> {
  const parent = dirname(destination)
  await ensurePrivateDirectory(parent)
  const stage = await mkdtemp(join(parent, '.anima-runtime-'))
  await chmod(stage, PRIVATE_DIRECTORY_MODE).catch(() => undefined)
  const neo4jArchivePath = join(stage, asset.neo4jArchive)
  let javaArchivePath: string | undefined
  try {
    const neo4jChecksum = await fetchChecksum(asset.neo4jChecksumUrl, asset.neo4jArchive, signal, fetcher)
    await downloadVerifiedArchive(asset.neo4jUrl, neo4jChecksum, neo4jArchivePath, signal, fetcher)
    const javaArchive = await resolveJavaArchive(asset, signal, fetcher)
    javaArchivePath = join(stage, javaArchive.archive === 'zip' ? 'java.zip' : 'java.tar.gz')
    await downloadVerifiedArchive(javaArchive.url, javaArchive.checksum, javaArchivePath, signal, fetcher)

    const stagedNeo4j = join(stage, 'neo4j')
    const stagedJava = join(stage, 'java')
    if (asset.platform === 'win32') {
      const extracted = join(stage, 'neo4j-extract')
      await extractZip(neo4jArchivePath, { dir: extracted })
      await rename(join(extracted, `neo4j-community-${NEO4J_VERSION}`), stagedNeo4j)
      const javaExtract = join(stage, 'java-extract')
      await extractZip(javaArchivePath, { dir: javaExtract })
      const javaRoot = await findJavaHome(javaExtract, true)
      await rename(javaRoot, stagedJava)
    } else {
      await mkdir(stagedNeo4j, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      await extractTar({ file: neo4jArchivePath, cwd: stagedNeo4j, strip: 1, strict: true })
      const javaExtract = join(stage, 'java-extract')
      await mkdir(javaExtract, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      await extractTar({ file: javaArchivePath, cwd: javaExtract, strip: 1, strict: true })
      const javaRoot = await findJavaHome(javaExtract, false)
      await rename(javaRoot, stagedJava)
    }
    await rm(neo4jArchivePath, { force: true })
    await rm(javaArchivePath, { force: true })
    const manifest = neo4jRuntimeManifest(asset.platform, asset.architecture)
    await writeFileAtomic(join(stage, RUNTIME_MANIFEST_NAME), `${JSON.stringify(manifest)}\n`, { mode: PRIVATE_FILE_MODE })
    await assertRealDirectory(stagedNeo4j)
    await assertRealDirectory(stagedJava)
    await assertRegularFile(join(stagedNeo4j, 'bin', asset.platform === 'win32' ? 'neo4j.bat' : 'neo4j'))
    await assertRegularFile(join(stagedJava, 'bin', asset.platform === 'win32' ? 'java.exe' : 'java'))

    await removeOwnedDirectory(destination, parent)
    await rename(stage, destination)
  } catch (error) {
    await removeOwnedDirectory(stage, parent).catch(() => undefined)
    throw error
  } finally {
    await rm(neo4jArchivePath, { force: true }).catch(() => undefined)
    if (javaArchivePath !== undefined) await rm(javaArchivePath, { force: true }).catch(() => undefined)
  }
}

async function resolveJavaArchive(asset: Neo4jPlatformAsset, signal: AbortSignal, fetcher: typeof fetch): Promise<JavaArchive> {
  const response = await fetcher(asset.javaMetadataUrl, { signal, redirect: 'error' })
  if (!response.ok) throw new Error(`Adoptium Java metadata request failed with HTTP ${response.status}.`)
  const value = await response.json() as unknown
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) throw new Error('Adoptium returned an invalid Java asset manifest.')
  const metadata = value[0]
  const binaries = metadata.binaries
  const binary: unknown = Array.isArray(binaries) && binaries.length === 1 ? binaries[0] : undefined
  const packageAsset = isRecord(binary) ? binary.package : undefined
  if (metadata.release_name !== JRE_RELEASE || !isRecord(binary) || binary.image_type !== 'jre'
    || binary.os !== adoptiumOs(asset.platform) || binary.architecture !== adoptiumArchitecture(asset.architecture)
    || !isRecord(packageAsset) || typeof packageAsset.link !== 'string' || typeof packageAsset.name !== 'string'
    || typeof packageAsset.checksum !== 'string' || !SHA256_PATTERN.test(packageAsset.checksum)) {
    throw new Error('Adoptium returned an asset that does not match the pinned Java runtime.')
  }
  const url = new URL(packageAsset.link)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('Adoptium returned a non-official Java archive URL.')
  if (!packageAsset.name.endsWith('.zip') && !packageAsset.name.endsWith('.tar.gz')) {
    throw new Error('Adoptium returned an unsupported Java archive format.')
  }
  return {
    url: url.href,
    checksum: packageAsset.checksum,
    archive: packageAsset.name.endsWith('.zip') ? 'zip' : 'tar.gz',
  }
}

function adoptiumOs(platform: Neo4jPlatformAsset['platform']): string {
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : 'linux'
}

function adoptiumArchitecture(architecture: Neo4jPlatformAsset['architecture']): string {
  return architecture === 'arm64' ? 'aarch64' : 'x64'
}

async function fetchChecksum(url: string, filename: string, signal: AbortSignal, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, { signal, redirect: 'error', headers: { Range: 'bytes=0-' } })
  if (!response.ok) throw new Error(`Neo4j checksum request failed with HTTP ${response.status}.`)
  const body = (await response.text()).trim()
  const [checksum, namedFile] = body.split(/\s+/u)
  if (checksum === undefined || !SHA256_PATTERN.test(checksum)
    || (namedFile !== undefined && namedFile !== filename)) {
    throw new Error('Neo4j returned an invalid archive checksum.')
  }
  return checksum
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

async function downloadVerifiedArchive(
  url: string,
  checksum: string,
  path: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<void> {
  throwIfAborted(signal)
  const archiveUrl = new URL(url)
  if (archiveUrl.protocol !== 'https:') throw new Error('Runtime archives must use HTTPS.')
  const response = await fetcher(archiveUrl, { signal, redirect: 'follow', headers: { Range: 'bytes=0-' } })
  if (!response.ok) throw new Error(`Runtime archive download failed with HTTP ${response.status}.`)
  if (response.url !== '' && new URL(response.url).protocol !== 'https:') throw new Error('Runtime archive redirects must use HTTPS.')
  if (response.body === null) throw new Error('Runtime archive response had no body.')
  const hash = createHash('sha256')
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const reader = response.body.getReader()
  const source = Readable.from((async function* () {
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) return
        yield Buffer.from(next.value)
      }
    } finally {
      reader.releaseLock()
    }
  })())
  try {
    await pipeline(source, hashing, createWriteStream(path, { flags: 'wx', mode: PRIVATE_FILE_MODE }), { signal })
    if (hash.digest('hex') !== checksum) throw new Error('Runtime archive SHA-256 does not match the official checksum.')
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readOrCreateCredentials(dataRoot: string): Promise<CredentialRecord> {
  const path = join(dataRoot, CREDENTIALS_FILE)
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Anima Neo4j credential path is not a regular file.')
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('Anima Neo4j credentials are not owner-only.')
    const record = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isCredentialRecord(record)) throw new Error('Anima Neo4j credential file is invalid.')
    return record
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const database = join(dataRoot, 'database')
  try {
    if ((await readdir(join(database, 'data'))).length > 0) throw new Error('Anima Neo4j data exists without its owner credential file.')
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const record: CredentialRecord = {
    schema_id: 'anima.neo4j-credentials/v1',
    username: 'neo4j',
    password: randomBytes(32).toString('base64url'),
    database: 'neo4j',
    initialized: false,
  }
  await writeCredentialRecord(dataRoot, record)
  return record
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
  return isRecord(value) && Object.keys(value).length === 5
    && value.schema_id === 'anima.neo4j-credentials/v1'
    && value.username === 'neo4j'
    && typeof value.password === 'string' && value.password.length >= 40
    && value.database === 'neo4j'
    && typeof value.initialized === 'boolean'
}

function isRuntimeManifest(value: unknown, expected: Neo4jRuntimeManifest): value is Neo4jRuntimeManifest {
  return isRecord(value) && Object.keys(value).length === 5
    && value.schema_id === expected.schema_id
    && value.platform === expected.platform
    && value.architecture === expected.architecture
    && value.neo4j_version === expected.neo4j_version
    && value.java_release === expected.java_release
}

async function writeCredentialRecord(dataRoot: string, credentials: CredentialRecord): Promise<void> {
  await writeFileAtomic(join(dataRoot, CREDENTIALS_FILE), `${JSON.stringify(credentials)}\n`, {
    mode: PRIVATE_FILE_MODE,
    dirMode: PRIVATE_DIRECTORY_MODE,
  })
}

async function prepareDatabaseDirectories(root: string): Promise<{
  config: string
  data: string
  logs: string
  run: string
  plugins: string
  import: string
}> {
  const paths = {
    config: join(root, 'conf'),
    data: join(root, 'data'),
    logs: join(root, 'logs'),
    run: join(root, 'run'),
    plugins: join(root, 'plugins'),
    import: join(root, 'import'),
  }
  for (const path of Object.values(paths)) await ensurePrivateDirectory(path)
  return paths
}

async function writeNeo4jConfig(
  configDirectory: string,
  directories: { data: string; logs: string; run: string; plugins: string; import: string },
  port: number,
): Promise<void> {
  const config = [
    'server.default_listen_address=127.0.0.1',
    `server.bolt.listen_address=127.0.0.1:${port}`,
    `server.bolt.advertised_address=127.0.0.1:${port}`,
    'server.bolt.enabled=true',
    'server.http.enabled=false',
    'server.https.enabled=false',
    'dbms.security.auth_enabled=true',
    'dbms.usage_report.enabled=false',
    `server.directories.data=${neo4jConfigPath(configDirectory, directories.data)}`,
    `server.directories.logs=${neo4jConfigPath(configDirectory, directories.logs)}`,
    `server.directories.run=${neo4jConfigPath(configDirectory, directories.run)}`,
    `server.directories.plugins=${neo4jConfigPath(configDirectory, directories.plugins)}`,
    `server.directories.import=${neo4jConfigPath(configDirectory, directories.import)}`,
  ].join('\n') + '\n'
  await writeFileAtomic(join(configDirectory, SETTINGS_FILE), config, { mode: PRIVATE_FILE_MODE, dirMode: PRIVATE_DIRECTORY_MODE })
}

function neo4jConfigPath(configDirectory: string, path: string): string {
  return relative(dirname(configDirectory), path).replace(/\\/gu, '/')
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => { resolveListen() })
  })
  const address = server.address()
  try {
    if (address === null || typeof address === 'string') throw new Error('The operating system did not return a TCP port.')
    return address.port
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => {
      if (error === undefined) resolveClose()
      else reject(error)
    }))
  }
}

function spawnRuntime(command: string, args: readonly string[], options: Parameters<Neo4jRuntimeSpawn>[2]): Neo4jRuntimeProcess {
  return nodeSpawn(command, [...args], options)
}

function launchNeo4j(runtime: RuntimePaths, configDirectory: string, spawnProcess: Neo4jRuntimeSpawn): {
  child: Neo4jRuntimeProcess
  status: ChildStatus
} {
  const env = childEnvironment(runtime, configDirectory)
  const command = runtime.javaExecutable
  // Neo4j 5.26's string path parser escapes Unicode. A native home Path and relative
  // directory settings preserve Unicode user paths and keep writable files outside app resources.
  const args = ['-cp', join(runtime.neo4jHome, 'lib', '*'), '-Dfile.encoding=UTF-8', 'org.neo4j.server.CommunityEntryPoint',
    `--home-dir=${dirname(configDirectory)}`, `--config-dir=${configDirectory}`, '--console-mode']
  const child = spawnProcess(command, args, {
    cwd: runtime.neo4jHome,
    env,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  })
  const status: ChildStatus = {}
  child.once('error', (error) => {
    status.error = error
  })
  child.once('exit', (code, signal) => {
    status.outcome = { code, signal }
  })
  return { child, status }
}

function childEnvironment(runtime: RuntimePaths, configDirectory: string): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/key|secret|token|password/iu.test(name)))
  const javaPath = join(runtime.javaHome, 'bin')
  const delimiter = runtime.windows ? ';' : ':'
  return {
    ...inherited,
    JAVA_HOME: runtime.javaHome,
    NEO4J_HOME: dirname(configDirectory),
    NEO4J_CONF: configDirectory,
    PATH: `${javaPath}${delimiter}${inherited['PATH'] ?? ''}`,
  }
}

async function waitForReadiness(input: {
  connection: Neo4jConnection
  credentials: CredentialRecord
  childStatus: ChildStatus
  deadline: number
  signal?: AbortSignal
  probe: NonNullable<Neo4jRuntimeDependencies['probe']>
}): Promise<void> {
  const signal = input.signal ?? new AbortController().signal
  for (;;) {
    throwIfAborted(signal)
    const childExit = input.childStatus.outcome
    if (childExit !== undefined) throw new Error(`Anima Neo4j exited during startup (code ${childExit.code ?? 'none'}, signal ${childExit.signal ?? 'none'}).`)
    if (input.childStatus.error !== undefined) throw new Error('The Anima Neo4j process could not start.')
    const timeoutMs = input.deadline - Date.now()
    if (timeoutMs <= 0) throw new Error('Anima Neo4j did not become ready before the startup timeout.')
    const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    try {
      const ready = await awaitWithSignal(
        input.probe(input.connection, !input.credentials.initialized, probeSignal, timeoutMs), probeSignal,
      )
      throwIfAborted(signal)
      if (Date.now() >= input.deadline) throw new Error('Anima Neo4j did not become ready before the startup timeout.')
      if (ready) return
    } catch (error: unknown) {
      throwIfAborted(signal)
      if (Date.now() >= input.deadline) throw new Error('Anima Neo4j did not become ready before the startup timeout.')
      void error
      // Connection failures are expected until Neo4j finishes binding Bolt.
    }
    await delay(POLL_INTERVAL_MS, signal)
  }
}

async function probeNeo4j(
  connection: Neo4jConnection,
  initializePassword: boolean,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<boolean> {
  throwIfAborted(signal)
  if (await verifyCredentials(connection, signal, timeoutMs)) {
    throwIfAborted(signal)
    return true
  }
  if (!initializePassword) return false
  const bootstrapDriver = neo4j.driver(connection.uri, neo4j.auth.basic('neo4j', 'neo4j'), {
    connectionTimeout: Math.min(PROBE_CONNECT_TIMEOUT_MS, timeoutMs), connectionAcquisitionTimeout: timeoutMs,
  })
  let session: Session | undefined
  try {
    session = bootstrapDriver.session({ database: 'system' })
    await awaitWithSignal(session.run(
      'ALTER CURRENT USER SET PASSWORD FROM $currentPassword TO $newPassword',
      { currentPassword: 'neo4j', newPassword: connection.password },
      { timeout: timeoutMs },
    ), signal)
    throwIfAborted(signal)
  } catch (error: unknown) {
    throwIfAborted(signal)
    void error
    return false
  } finally {
    const closeSignal = AbortSignal.timeout(PROBE_CONNECT_TIMEOUT_MS)
    if (session !== undefined) await awaitWithSignal(session.close(), closeSignal).catch(() => undefined)
    await awaitWithSignal(bootstrapDriver.close(), closeSignal).catch(() => undefined)
  }
  return verifyCredentials(connection, signal, timeoutMs)
}

async function verifyCredentials(connection: Neo4jConnection, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
  const driver = neo4j.driver(
    connection.uri,
    neo4j.auth.basic(connection.username, connection.password),
    { connectionTimeout: Math.min(PROBE_CONNECT_TIMEOUT_MS, timeoutMs), connectionAcquisitionTimeout: timeoutMs },
  )
  try {
    await awaitWithSignal(driver.verifyConnectivity({ database: connection.database }), signal)
    throwIfAborted(signal)
    return true
  } catch (error: unknown) {
    throwIfAborted(signal)
    void error
    return false
  } finally {
    await awaitWithSignal(driver.close(), AbortSignal.timeout(PROBE_CONNECT_TIMEOUT_MS)).catch(() => undefined)
  }
}

async function terminateProcess(child: Neo4jRuntimeProcess): Promise<void> {
  if (processHasExited(child)) return
  if (process.platform === 'win32') {
    if (child.pid === undefined) throw new Error('Cannot stop the Anima Neo4j process tree without its process id.')
    const killer = nodeSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    })
    await new Promise<void>((resolveKill, rejectKill) => {
      killer.once('error', rejectKill)
      killer.once('exit', (code) => {
        if (code === 0) resolveKill()
        else rejectKill(new Error('Could not stop the owned Neo4j process tree.'))
      })
    })
    if (!await waitForChildExit(child, PROCESS_STOP_TIMEOUT_MS)) {
      throw new Error('The owned Anima Neo4j process did not exit after taskkill.')
    }
    return
  } else {
    child.kill('SIGTERM')
    const outcome = await waitForChildExit(child, PROCESS_STOP_TIMEOUT_MS)
    if (outcome) return
    child.kill('SIGKILL')
  }
  const outcome = await waitForChildExit(child, PROCESS_STOP_TIMEOUT_MS)
  if (!outcome) throw new Error('The owned Anima Neo4j process did not exit after termination.')
}

async function stopOwnedProcess(child: Neo4jRuntimeProcess, terminate: (child: Neo4jRuntimeProcess) => Promise<void>): Promise<void> {
  if (processHasExited(child)) return
  await terminate(child)
  if (!await waitForChildExit(child, PROCESS_STOP_TIMEOUT_MS)) {
    throw new Error('The owned Anima Neo4j process did not exit after termination.')
  }
}

async function waitForChildExit(child: Neo4jRuntimeProcess, timeoutMs: number): Promise<boolean> {
  if (processHasExited(child)) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  const exited = new Promise<boolean>((resolveExit) => {
    child.once('exit', () => { resolveExit(true) })
    timer = setTimeout(() => { resolveExit(false) }, timeoutMs)
  })
  const result = await exited
  if (timer !== undefined) clearTimeout(timer)
  return result
}

function processHasExited(child: Neo4jRuntimeProcess): boolean {
  return child.exitCode !== null || child.signalCode != null
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Anima Neo4j private data path is not a regular directory.')
  if (!samePath(await realpath(path), resolve(path))) throw new Error('Anima Neo4j private data path resolves through a different path.')
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    await chmod(path, PRIVATE_DIRECTORY_MODE)
    if (((await lstat(path)).mode & 0o077) !== 0) throw new Error('Anima Neo4j private data directory permissions are too broad.')
  }
}

async function assertRealDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory() || !samePath(await realpath(path), resolve(path))) {
    throw new Error('Anima runtime directory is missing or is not a regular directory.')
  }
}

async function assertRegularFile(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile() || !samePath(await realpath(path), resolve(path))) {
    throw new Error('Anima runtime executable is missing or is not a regular file.')
  }
}

async function removeOwnedDirectory(target: string, ownerRoot: string): Promise<void> {
  const absolute = resolve(target)
  const owner = resolve(ownerRoot)
  const relativePath = relative(owner, absolute)
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Refusing to remove a path outside the Anima runtime directory.')
  }
  try {
    await assertRealDirectory(absolute)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  await rm(absolute, { recursive: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Anima Neo4j startup was aborted.')
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolveDelay, rejectDelay) => {
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      rejectDelay(signal.reason instanceof Error ? signal.reason : new Error('Anima Neo4j startup was aborted.'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolveDelay()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Wait for one startup probe without delaying timeout or cancellation handling. */
function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolveResult, rejectResult) => {
    const finish = (): void => { signal.removeEventListener('abort', abort) }
    const abort = (): void => {
      finish()
      rejectResult(signal.reason instanceof Error ? signal.reason : new Error('Anima Neo4j probe was aborted.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => { finish(); resolveResult(value) },
      (error: unknown) => { finish(); rejectResult(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}
