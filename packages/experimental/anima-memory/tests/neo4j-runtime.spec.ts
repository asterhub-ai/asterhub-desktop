import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  JRE_RELEASE,
  NEO4J_VERSION,
  RUNTIME_MANIFEST_NAME,
  neo4jRuntimeManifest,
  neo4jPlatformAsset,
} from '../src/runtime-assets.ts'
import {
  ensureNeo4j,
  prepareNeo4jRuntime,
  verifyNeo4jRuntime,
  type Neo4jRuntimeProcess,
  type Neo4jRuntimeSpawn,
} from '../src/neo4j-runtime.ts'

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'anima-neo4j-runtime-'))
  roots.push(root)
  const dataRoot = join(root, 'data')
  const runtimeRoot = join(root, 'runtime')
  await mkdir(join(runtimeRoot, 'neo4j', 'bin'), { recursive: true })
  await mkdir(join(runtimeRoot, 'java', 'bin'), { recursive: true })
  await writeFile(join(runtimeRoot, 'neo4j', 'bin', 'neo4j.bat'), '')
  await writeFile(join(runtimeRoot, 'java', 'bin', 'java.exe'), '')
  await writeFile(join(runtimeRoot, RUNTIME_MANIFEST_NAME), JSON.stringify(neo4jRuntimeManifest('win32', 'x64')))
  return { dataRoot, runtimeRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FakeProcess extends EventEmitter implements Neo4jRuntimeProcess {
  readonly pid: number
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    setTimeout(() => {
      if (this.exitCode !== null || this.signalCode !== null) return
      this.exitCode = signal === 'SIGKILL' ? 1 : null
      this.signalCode = signal === 'SIGKILL' ? null : signal
      this.emit('exit', this.exitCode, this.signalCode)
    }, 20)
    return true
  }

  finish(code: number): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

function fakeSpawn(children: FakeProcess[], onStart?: (child: FakeProcess) => void): Neo4jRuntimeSpawn {
  let pid = 10_000
  return (_command, _args, _options) => {
    const child = new FakeProcess(pid++)
    children.push(child)
    onStart?.(child)
    return child
  }
}

async function terminateFake(child: Neo4jRuntimeProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode != null) return
  const exited = new Promise<void>((resolveExit) => { child.once('exit', () => { resolveExit() }) })
  child.kill('SIGTERM')
  await exited
}

describe('Anima managed Neo4j runtime', () => {
  it('prepares verified runtime archives from the version endpoint binaries array', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anima-runtime-install-'))
    roots.push(root)
    const fixturesDir = resolve(import.meta.dirname, 'fixtures')
    const neo4jArchive = await readFile(join(fixturesDir, 'neo4j-windows.zip'))
    const javaArchive = await readFile(join(fixturesDir, 'java-windows.zip'))
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    const asset = neo4jPlatformAsset('win32', 'x64')
    const javaUrl = 'https://github.com/adoptium/temurin21-binaries/releases/download/fixture/java.zip'
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === asset.javaMetadataUrl) return Response.json([{ release_name: JRE_RELEASE, binaries: [{
        os: 'windows', architecture: 'x64', image_type: 'jre',
        package: { link: javaUrl, name: 'java.zip', checksum: digest(javaArchive) },
      }] }])
      expect(new Headers(init?.headers).get('Range')).toBe('bytes=0-')
      if (url === asset.neo4jChecksumUrl) return new Response(digest(neo4jArchive))
      if (url === asset.neo4jUrl) return new Response(neo4jArchive)
      if (url === javaUrl) return new Response(javaArchive)
      throw new Error(`Unexpected runtime URL: ${url}`)
    })
    const destination = join(root, 'installed')
    await prepareNeo4jRuntime({ platform: 'win32', architecture: 'x64', destination, fetch: fetcher })
    await expect(verifyNeo4jRuntime(destination, 'win32', 'x64')).resolves.toBeUndefined()
    expect(await readFile(join(destination, 'java', 'bin', 'java.exe'), 'utf8')).toBe('java exe fixture')
    expect(await readFile(join(destination, 'neo4j', 'bin', 'neo4j.bat'), 'utf8')).toBe('neo4j bat fixture')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('uses the pinned Neo4j and JRE releases with official Windows archive URLs', () => {
    const windows = neo4jPlatformAsset('win32', 'x64')
    expect(NEO4J_VERSION).toBe('5.26.32')
    expect(JRE_RELEASE).toBe('jdk-21.0.12.1+1')
    expect(windows.neo4jUrl).toBe(`https://dist.neo4j.org/neo4j-community-${NEO4J_VERSION}-windows.zip`)
    expect(windows.neo4jChecksumUrl).toBe(`${windows.neo4jUrl}.sha256`)
    expect(windows.javaMetadataUrl).toContain('os=windows')
    expect(windows.javaMetadataUrl).toContain('architecture=x64')
    expect(() => neo4jPlatformAsset('darwin', 'x64')).toThrow(/no pinned Neo4j runtime/u)
    expect(() => neo4jPlatformAsset('linux', 'x64')).toThrow(/no pinned Neo4j runtime/u)
    expect(() => neo4jPlatformAsset('win32', 'arm64')).toThrow(/no pinned Neo4j runtime/u)
  })


  it('fails closed when a supplied packaged runtime is incomplete instead of downloading at first launch', async () => {
    const { dataRoot, runtimeRoot } = await fixture()
    await writeFile(join(runtimeRoot, RUNTIME_MANIFEST_NAME), '{}')
    const installRuntime = vi.fn()

    await expect(ensureNeo4j({
      dataRoot,
      runtimeRoot,
      dependencies: { installRuntime },
    })).rejects.toThrow('Anima packaged runtime manifest does not match the pinned runtime.')

    expect(installRuntime).not.toHaveBeenCalled()
  })

  it('returns loopback connection details, keeps credentials off process arguments, and waits for owned process exit', async () => {
    const { dataRoot, runtimeRoot } = await fixture()
    const children: FakeProcess[] = []
    let processArgs: readonly string[] = []
    let processEnvironment: NodeJS.ProcessEnv = {}
    let seenConnection: { uri: string; username: string; password: string; database: string } | undefined
    const installRuntime = vi.fn()
    await expect(verifyNeo4jRuntime(runtimeRoot, 'win32', 'x64')).resolves.toBeUndefined()
    const managed = await ensureNeo4j({
      dataRoot,
      runtimeRoot,
      dependencies: {
        spawn: (command, args, options) => {
          processArgs = args
          processEnvironment = options.env
          return fakeSpawn(children)(command, args, options)
        },
        terminate: terminateFake,
        installRuntime,
        probe: async (connection, passwordNeedsInitialization) => {
          seenConnection = connection
          expect(passwordNeedsInitialization).toBe(true)
          return true
        },
      },
    })

    expect(seenConnection).toEqual(managed.connection)
    expect(managed.connection).toMatchObject({ username: 'neo4j', database: 'neo4j' })
    expect(managed.connection.uri).toMatch(/^bolt:\/\/127\.0\.0\.1:\d+$/u)
    expect(children).toHaveLength(1)
    expect(installRuntime).not.toHaveBeenCalled()
    const config = await readFile(join(dataRoot, 'database', 'conf', 'neo4j.conf'), 'utf8')
    expect(config).toContain(`server.bolt.listen_address=127.0.0.1:${new URL(managed.connection.uri).port}`)
    expect(config).toContain('server.http.enabled=false')
    expect(config).toContain('server.https.enabled=false')
    expect(config).toContain('dbms.security.auth_enabled=true')
    expect(config).toContain('dbms.usage_report.enabled=false')
    const credentials = await readFile(join(dataRoot, 'neo4j-credentials.json'), 'utf8')
    expect(credentials).toContain(managed.connection.password)
    expect(processArgs.join(' ')).not.toContain(managed.connection.password)
    expect(processArgs.slice(-3)).toEqual([
      `--home-dir=${join(dataRoot, 'database')}`, `--config-dir=${join(dataRoot, 'database', 'conf')}`, '--console-mode',
    ])
    expect(config).toContain('server.directories.data=data')
    expect(JSON.stringify(processEnvironment)).not.toContain(managed.connection.password)
    expect(children[0]?.exitCode).toBeNull()

    await managed.close()

    expect(children[0]?.signalCode).toBe('SIGTERM')
    const lease = await acquireFileLock(join(dataRoot, 'neo4j-owner'), { waitMs: 0 })
    await lease.release()
  })

  it('aborts a stalled Bolt probe when its caller cancels startup', async () => {
    const { dataRoot, runtimeRoot } = await fixture()
    const children: FakeProcess[] = []
    const started = Promise.withResolvers<undefined>()
    let probeSignal: AbortSignal | undefined
    const controller = new AbortController()
    const startup = ensureNeo4j({
      dataRoot,
      runtimeRoot,
      signal: controller.signal,
      startupTimeoutMs: 30_000,
      dependencies: {
        spawn: fakeSpawn(children),
        terminate: terminateFake,
        probe: (_connection, _initializePassword, signal) => {
          probeSignal = signal
          started.resolve(undefined)
          return new Promise<boolean>(() => {})
        },
      },
    })

    await started.promise
    controller.abort(new Error('cancel stalled readiness'))
    await expect(startup).rejects.toThrow('cancel stalled readiness')
    expect(probeSignal?.aborted).toBe(true)
    expect(children[0]?.signalCode).toBe('SIGTERM')
  })

  it('bounds a stalled Bolt probe by the startup deadline', async () => {
    const { dataRoot, runtimeRoot } = await fixture()
    const children: FakeProcess[] = []
    const probeStarted = Promise.withResolvers<undefined>()
    await expect(ensureNeo4j({
      dataRoot,
      runtimeRoot,
      startupTimeoutMs: 1000,
      dependencies: {
        spawn: fakeSpawn(children),
        terminate: terminateFake,
        probe: () => {
          probeStarted.resolve(undefined)
          return new Promise<boolean>(() => {})
        },
      },
    })).rejects.toThrow('startup timeout')
    await probeStarted.promise
    expect(children[0]?.signalCode).toBe('SIGTERM')
  })

  it('holds the single-owner lock until close and rejects a second manager', async () => {
    const { dataRoot, runtimeRoot } = await fixture()
    const children: FakeProcess[] = []
    const options = {
      dataRoot,
      runtimeRoot,
      dependencies: { spawn: fakeSpawn(children), terminate: terminateFake, probe: async () => true },
    }
    const first = await ensureNeo4j(options)

    await expect(ensureNeo4j(options)).rejects.toThrow()
    expect(children).toHaveLength(1)

    await first.close()
  })

  it('fails startup when the managed process exits and releases its lock', async () => {
    const { dataRoot, runtimeRoot } = await fixture()
    const children: FakeProcess[] = []
    const spawn = fakeSpawn(children, (child) => { setTimeout(() => { child.finish(7) }, 0) })

    await expect(ensureNeo4j({
      dataRoot,
      runtimeRoot,
      startupTimeoutMs: 3000,
      dependencies: { spawn, terminate: terminateFake, probe: async () => false },
    })).rejects.toThrow(/exited during startup/u)

    const lease = await acquireFileLock(join(dataRoot, 'neo4j-owner'), { waitMs: 0 })
    await lease.release()
    expect(children.length).toBeGreaterThan(1)
  })

})
