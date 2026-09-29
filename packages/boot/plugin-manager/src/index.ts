/** Current-profile plugin and bundle management over shared dsh plugin operations. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { pluginEntryId, readPluginInventory } from '@deepseek-ai/dsh-host-plugin-inventory'
import {
  readProfileManifest, resolveBundleDir, loadOverlayPatches, composeEntries, reconcileProfilePatches, readProfilePatches, OPTIONAL_BUNDLES,
} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-hmr'
import type { ProfileContext, ProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { bundleManifest, runProfilePnpm, saveManifest, viewProfilePackage } from './operations.ts'
import { classifyInstallFailure } from './install-failure.ts'
import { InvalidInstallSpecError, parseInstallSpec } from './install-spec.ts'
import { writePluginEnabled } from './patch.ts'
import { ManagementFailure } from './failure.ts'
import { approveBuilds, readPendingBuilds } from './build-approval.ts'
import type {
  BundleInfo, BundleRowInfo, ChangeResult, InstallBundleOptions, ManagementError, PackageResult, PluginChange, PluginEntryId, PluginInfo,
  PluginInspectProblem, PluginInstallCancellation, PluginInstallProgress, PluginInstallRequestId, PluginSpecInspection,
  CuratedPluginCatalog, CuratedPluginEntry, CuratedPluginInstallRequest,
} from './types.ts'
export type * from './types.ts'
export { classifyInstallFailure, type InstallFailureFacts } from './install-failure.ts'
export { InvalidInstallSpecError, parseInstallSpec, type ParsedInstallSpec } from './install-spec.ts'

/** The pnpm executable and the limits for package diagnostics and registry lookups. */
export interface Config {
  /** The pnpm executable name or path; resolved through `PATH` like the `dsh plugin` command. */
  pnpmCommand?: string
  /** Maximum retained pnpm diagnostic bytes per operation. */
  outputBytes?: number
  /** Maximum time to wait for another process's profile package operation. */
  lockWaitMs?: number
  /** Bound on one registry lookup an inspection runs, in milliseconds. */
  inspectTimeoutMs?: number
  /** Public catalogue endpoint for the reserved app Plugins page. */
  curatedCatalogUrl?: string
  /** Release-pinned Ed25519 public key in PEM form. Empty means unavailable. */
  curatedCatalogPublicKey?: string
}

const protectedModules = new Set([
  '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include', '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-host-plugin-inventory', '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/cordis-plugin-timer', '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-host-frontend-static', '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-hmr',
  '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-agent-default-model', '@deepseek-ai/dsh-account-sub2api',
  '@deepseek-ai/dsh-credentials-local', '@deepseek-ai/dsh-sandbox-policy',
])

const protectedEntryIds = new Set(['llm', 'llm-pi-ai', 'agent-default-model', 'account-sub2api', 'credentials', 'sandbox-policy'])

/** The profile files an installation writes and a failed or cancelled one restores. */
const RESTORED_FILES = ['package.json', 'pnpm-lock.yaml'] as const

/** pnpm's colour escapes, which a JSON answer may be wrapped in. */
const ANSI_SEQUENCE = /\x1b\[[0-9;]*m/g

/** Flatten only the groups addressable by the profile's patch composer. */
function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : [])])
}

/** Preserve the exact observed diagnostic, including non-Error failures. */
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** An expected refusal keeps its code; anything else becomes an operation error carrying its exact diagnostic. */
function managementError(error: unknown): ManagementError {
  return error instanceof ManagementFailure ? { code: error.code } : { code: 'operation-error', diagnostic: messageOf(error) }
}

/** The caller stopped an installation; its files are restored before this is thrown. */
class InstallCancelledError extends Error {
  constructor() {
    super('Installation cancelled')
    this.name = 'InstallCancelledError'
  }
}

/** One installation the manager owns until its call settles. */
interface InstallControl {
  readonly abort: AbortController
  /** `applying` once pnpm has exited and the bundle is being selected and loaded, which cannot be stopped. */
  phase: 'installing' | 'applying'
  /** Settlement of the install call, whichever way it ended. */
  settled: Promise<void>
}

/** A manifest field that is a string, when the manifest carries one. */
function stringField(manifest: object, field: string): string | undefined {
  const value = (manifest as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

/** The fields of the dsh installation's own manifest the manager reads. */
interface InstallationManifest {
  dependencies?: Record<string, string>
}

/** What a package manifest says about the package: identity, one-liner, and whether it is a bundle. */
function inspectionOf(kind: 'registry' | 'path', manifest: object): Extract<PluginSpecInspection, { status: 'accepted' }> {
  const dsh = (manifest as { dsh?: unknown }).dsh
  const declared = typeof dsh === 'object' && dsh !== null ? dsh as { bundle?: unknown } : undefined
  const bundle = declared !== undefined && typeof declared.bundle === 'object' && declared.bundle !== null
  const name = stringField(manifest, 'name')
  const version = stringField(manifest, 'version')
  const description = stringField(manifest, 'description')
  return {
    status: 'accepted', kind, bundle,
    ...name === undefined ? {} : { name },
    ...version === undefined ? {} : { version },
    ...description === undefined || description === '' ? {} : { description },
  }
}

function refused(problem: PluginInspectProblem, reason: string): PluginSpecInspection {
  return { status: 'refused', problem, reason }
}

/** Verify the raw-byte envelope and validate the catalogue values before exposing them to a Client.
 * @param envelope Untrusted JSON envelope returned by the catalogue endpoint.
 * @param publicKeyPem Release-pinned Ed25519 public key in PEM form.
 * @param catalogUrl Configured HTTPS catalogue URL used to restrict icon origins.
 * @param now Current epoch time in milliseconds for validity checks.
 * @returns The validated catalogue payload and its monotone revision.
 */
export function verifyCuratedCatalogEnvelope(
  envelope: unknown,
  publicKeyPem: string,
  catalogUrl: string,
  now = Date.now(),
): CuratedPluginCatalog {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new Error('curated plugin catalogue signature envelope is invalid')
  }
  const record = envelope as Record<string, unknown>
  if (typeof record.payload !== 'string' || typeof record.signature !== 'string'
    || record.payload.length === 0 || record.payload.length > 3_000_000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.payload)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.signature)) {
    throw new Error('curated plugin catalogue signature envelope is invalid')
  }
  const payloadBytes = Buffer.from(record.payload, 'base64')
  if (!verifySignature(null, payloadBytes, createPublicKey(publicKeyPem), Buffer.from(record.signature, 'base64'))) {
    throw new Error('curated plugin catalogue signature verification failed')
  }
  const payload = JSON.parse(payloadBytes.toString('utf8')) as Record<string, unknown>
  if (payload.schemaVersion !== 1 || !Number.isSafeInteger(payload.revision) || (payload.revision as number) < 1
    || typeof payload.issuedAt !== 'string' || typeof payload.expiresAt !== 'string'
    || !Array.isArray(payload.plugins) || payload.plugins.length > 500) {
    throw new Error('curated plugin catalogue payload is invalid')
  }
  const issuedAt = Date.parse(payload.issuedAt)
  const expiresAt = Date.parse(payload.expiresAt)
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || new Date(issuedAt).toISOString() !== payload.issuedAt || new Date(expiresAt).toISOString() !== payload.expiresAt
    || issuedAt > now + 5 * 60_000 || expiresAt <= now || expiresAt <= issuedAt) {
    throw new Error('curated plugin catalogue is not currently valid')
  }
  const origin = new URL(catalogUrl).origin
  const ids = new Set<string>()
  const packages = new Set<string>()
  const plugins: CuratedPluginEntry[] = payload.plugins.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('catalogue plugin entry is invalid')
    const row = item as Record<string, unknown>
    for (const field of ['id', 'name', 'description', 'package', 'version', 'integrity']) {
      if (typeof row[field] !== 'string' || row[field] === '') throw new Error(`catalogue plugin ${field} is invalid`)
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.id as string)
      || ids.has(row.id as string)
      || packages.has(row.package as string)
      || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(row.package as string)
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(row.version as string)
      || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(row.integrity as string)) {
      throw new Error('catalogue plugin identity, package, exact version, or integrity is invalid')
    }
    ids.add(row.id as string)
    packages.add(row.package as string)
    let iconUrl: string | undefined
    if (typeof row.iconUrl === 'string') {
      try {
        if (new URL(row.iconUrl).origin === origin && new URL(row.iconUrl).protocol === 'https:') iconUrl = row.iconUrl
      } catch { /* invalid remote image URLs are omitted from the display data */ }
    }
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      package: row.package as string,
      version: row.version as string,
      integrity: row.integrity as string,
      ...typeof row.category === 'string' ? { category: row.category } : {},
      ...iconUrl === undefined ? {} : { iconUrl },
    }
  })
  return { revision: payload.revision as number, generatedAt: payload.issuedAt, plugins }
}

/** Match a UI install click to the exact signed row and revision it displayed.
 * @param catalog Current verified catalogue shown by the Plugins page.
 * @param request Exact item identity and signed package facts sent by the page.
 * @returns The verified catalogue entry bound to the user's selection.
 * @throws ManagementFailure `stale-approval` when the catalogue or item changed.
 */
export function resolveCuratedInstallRequest(
  catalog: CuratedPluginCatalog,
  request: CuratedPluginInstallRequest,
): CuratedPluginEntry {
  if (request.revision !== catalog.revision) throw new ManagementFailure('stale-approval')
  const entry = catalog.plugins.find(candidate => candidate.id === request.id)
  if (entry === undefined || entry.package !== request.package || entry.version !== request.version
    || entry.integrity !== request.integrity) throw new ManagementFailure('stale-approval')
  return entry
}

/** The root profile dependency reference and resolution records in a pnpm lockfile. */
interface CuratedLockfile {
  readonly importers?: Readonly<Record<string, {
    readonly dependencies?: Readonly<Record<string, { readonly specifier?: unknown; readonly version?: unknown }>>
    readonly devDependencies?: Readonly<Record<string, { readonly specifier?: unknown; readonly version?: unknown }>>
    readonly optionalDependencies?: Readonly<Record<string, { readonly specifier?: unknown; readonly version?: unknown }>>
  }>>
  readonly packages?: Readonly<Record<string, { readonly resolution?: { readonly integrity?: unknown } }>>
}

/** Check the profile's direct exact dependency and its resolved registry tarball integrity.
 * @param entry Signed package identity and registry integrity.
 * @param lockfile Parsed pnpm lockfile for the profile.
 * @returns Whether the exact root dependency resolves to the signed registry package.
 */
export function curatedLockIntegrityMatches(
  entry: Pick<CuratedPluginEntry, 'package' | 'version' | 'integrity'>,
  lockfile: CuratedLockfile,
): boolean {
  const importer = lockfile.importers?.['.']
  if (importer === undefined) return false
  const directReferences = [
    importer.dependencies?.[entry.package],
    importer.devDependencies?.[entry.package],
    importer.optionalDependencies?.[entry.package],
  ].filter(reference => reference !== undefined)
  if (directReferences.length !== 1) return false
  const direct = directReferences[0]
  if (direct?.specifier !== entry.version || typeof direct.version !== 'string'
    || !(direct.version === entry.version
      || direct.version.startsWith(`${entry.version}(`) && direct.version.endsWith(')'))) return false
  return lockfile.packages?.[`${entry.package}@${direct.version}`]?.resolution?.integrity === entry.integrity
}

/** A bundle is the exact curated installation only when both manifest and lockfile facts match.
 * @param entry Signed catalogue entry to compare.
 * @param bundles Installed bundle inventory from the current profile.
 * @param lockfile Parsed pnpm lockfile for the profile.
 * @returns Whether the installed bundle is the exact signed package resolution.
 */
export function isExactCuratedInstallation(
  entry: CuratedPluginEntry,
  bundles: readonly BundleInfo[],
  lockfile: CuratedLockfile,
): boolean {
  return bundles.some(bundle => bundle.name === entry.package && bundle.installed && bundle.version === entry.version)
    && curatedLockIntegrityMatches(entry, lockfile)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent management of the current profile's composition and packages. */
    pluginManager: PluginManager
    /** Release-pinned AsterHub catalogue trust root supplied by the Desktop Host. */
    applicationCatalogPublicKey?: string
  }
}

/** Manage profile files and apply their declared reload lifecycle. */
export class PluginManager extends TypertRemoteService {
  static inject = ['loader', 'profileContext']
  static Config: z<Config> = z.object({
    pnpmCommand: z.string().default('pnpm'),
    outputBytes: z.number().step(1).min(1).default(16384),
    lockWaitMs: z.number().step(1).min(0).default(120000),
    inspectTimeoutMs: z.number().step(1).min(1000).default(20000),
    curatedCatalogUrl: z.string().default('https://asterhub.xapi.fans/api/v1/catalog.json'),
    curatedCatalogPublicKey: z.string().default(''),
  })
  private readonly ownerEntryId: string | undefined
  private readonly packageOperations = new Set<Promise<unknown>>()
  private readonly profile: ProfileContext
  private readonly outputBytes: number
  private readonly lockWaitMs: number
  private readonly inspectTimeoutMs: number
  private readonly pnpmCommand: string
  private readonly curatedCatalogUrl: string
  private readonly curatedCatalogPublicKey: string
  private catalogRevisionWrite: Promise<void> = Promise.resolve()
  private readonly ownerContext: Context
  private readonly abort = new AbortController()
  /** Installations by request id, from their call until it settles. */
  private readonly installs = new Map<PluginInstallRequestId, InstallControl>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginManager')
    this.ownerEntryId = ctx.fiber.entry?.id
    this.ownerContext = ctx
    this.profile = ctx.profileContext
    this.outputBytes = (config as Required<Config>).outputBytes
    this.lockWaitMs = (config as Required<Config>).lockWaitMs
    this.inspectTimeoutMs = (config as Required<Config>).inspectTimeoutMs
    this.pnpmCommand = (config as Required<Config>).pnpmCommand
    this.curatedCatalogUrl = (config as Config & { curatedCatalogUrl?: string }).curatedCatalogUrl
      ?? 'https://asterhub.xapi.fans/api/v1/catalog.json'
    this.curatedCatalogPublicKey = ctx.get('applicationCatalogPublicKey')
      ?? config.curatedCatalogPublicKey
      ?? ''
    ctx.effect(() => async () => {
      this.abort.abort()
      await Promise.allSettled([...this.packageOperations])
    }, 'plugin-manager: package cancellation')
  }

  /** Read current plugins, including why a row cannot be changed through the profile patch.
   * @returns Current runtime entries with persistent patch targets.
   */
  @Remote
  async listPlugins(): Promise<PluginInfo[]> {
    const rows = flatten(composeEntries([readProfilePatches('dsh', this.profile)]))
    const snapshot = await readPluginInventory(this.ctx)
    return snapshot.entries.map((entry) => {
      const actual = [...this.ctx.loader.entries()].find(row => row.id === entry.entryId)
      const candidates = rows.filter(row => row.id === actual?.options.id)
      const candidate = candidates[0]
      if (protectedModules.has(entry.moduleName) || protectedEntryIds.has(actual?.options.id ?? '')
        || entry.entryId === this.ownerEntryId) {
        return { ...entry, readOnlyReason: 'management-required' as const }
      }
      if (candidate === undefined || candidates.length > 1 || candidate.name !== entry.moduleName
        || actual?.parent.tree.ctx.fiber.entry?.id !== 'include') {
        return { ...entry, readOnlyReason: 'unaddressable' as const }
      }
      return { ...entry, patchId: candidate.id }
    })
  }

  /** Read the profile's installed bundles, the bundles this dsh installation supplies, and the selected names that are not bundles.
   * A dependency without a bundle patch is listed, as a `not-bundle` problem, only while it is selected.
   * @returns Package versions, one-liners, rows, activation selections, whether the installation offers the
   * bundle, and removal availability.
   */
  @Remote
  listBundles(): Promise<BundleInfo[]> {
    const manifest = readProfileManifest('dsh', this.profile.dir)
    const selected = manifest.dsh?.profile?.bundles ?? []
    const dependencies = Object.keys(manifest.dependencies ?? {})
    const installation = JSON.parse(readFileSync(this.profile.installAnchor, 'utf8')) as InstallationManifest
    const names = [...new Set([...selected, ...dependencies, ...Object.keys(installation.dependencies ?? {})])]
    const bundles: BundleInfo[] = []
    for (const name of names) {
      const installed = dependencies.includes(name)
      const optional = OPTIONAL_BUNDLES.includes(name)
      const removable = installed && !Object.hasOwn(installation.dependencies ?? {}, name)
      const enabled = selected.includes(name)
      try {
        const info = bundleManifest(name, this.profile.dir, this.profile.installAnchor)
        if (info === undefined) {
          if (enabled) bundles.push({ name, enabled, installed, optional, removable, error: { code: 'not-bundle' }, rows: [], overrides: [] })
          continue
        }
        const readOnlyReason = this.protectsManager(name) ? 'management-required' as const : undefined
        bundles.push({ name, ...(info.version === undefined ? {} : { version: info.version }),
          ...(info.description === undefined || info.description === '' ? {} : { description: info.description }),
          enabled, installed, optional, removable: removable && readOnlyReason === undefined,
          ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
          ...this.declaredRows(name, info) })
      } catch (error) {
        if (enabled || installed) {
          bundles.push({ name, enabled, installed, optional, removable, error: managementError(error), rows: [], overrides: [] })
        }
      }
    }
    return Promise.resolve(bundles)
  }

  /** Read what a spec names before installing it.
   * @param spec One package spec: a registry name, an absolute path, a git address, or a tarball.
   * @param signal Ends a registry lookup early.
   * @returns The package the spec names, or why it is refused.
   */
  @Remote
  async inspect(spec: string, signal?: AbortSignal): Promise<PluginSpecInspection> {
    let parsed
    try {
      parsed = parseInstallSpec(spec)
    } catch (error) {
      /* v8 ignore next 2 -- parseInstallSpec throws nothing but its own refusal */
      if (!(error instanceof InvalidInstallSpecError)) throw error
      return refused('invalid-spec', error.reason)
    }
    const manifest = readProfileManifest('dsh', this.profile.dir)
    const installation = JSON.parse(readFileSync(this.profile.installAnchor, 'utf8')) as InstallationManifest
    const known = new Set([
      ...manifest.dsh?.profile?.bundles ?? [], ...Object.keys(manifest.dependencies ?? {}), ...Object.keys(installation.dependencies ?? {}),
    ])
    switch (parsed.kind) {
      case 'git': return { status: 'accepted', kind: 'git', bundle: null }
      case 'tarball':
        if (parsed.path !== undefined && !existsSync(parsed.path)) return refused('not-a-package', 'the tarball does not exist')
        return { status: 'accepted', kind: 'tarball', bundle: null }
      case 'path': {
        if (!existsSync(parsed.path)) return refused('not-a-package', 'the path does not exist')
        let read: object
        try {
          read = JSON.parse(await readFile(join(parsed.path, 'package.json'), 'utf8')) as object
        } catch (error) {
          return refused('not-a-package', `no readable package.json at the path: ${messageOf(error)}`)
        }
        const inspection = inspectionOf('path', read)
        if (inspection.name === undefined) return refused('not-a-package', 'the package.json names no package')
        if (known.has(inspection.name)) return refused('already-installed', `${inspection.name} is already installed`)
        if (!inspection.bundle) return refused('not-a-bundle', `${inspection.name} declares no dsh.bundle`)
        return inspection
      }
      case 'registry': {
        if (known.has(parsed.name)) return refused('already-installed', `${parsed.name} is already installed`)
        const view = await viewProfilePackage(this.profile.dir, spec.trim(), {
          ...this.profile.packageManager ?? { command: this.pnpmCommand },
          timeoutMs: this.inspectTimeoutMs, ...signal === undefined ? {} : { signal },
        })
        const log = `${view.stderr}${view.cause === undefined ? '' : `${messageOf(view.cause)}\n`}`.trim()
        if (view.exitCode !== 0 || view.cause !== undefined || view.timedOut) {
          const kind = classifyInstallFailure({ log, timedOut: view.timedOut, ...view.cause === undefined ? {} : { cause: view.cause } })
          const reason = log || view.stdout.trim() || `pnpm view exited with ${String(view.exitCode)}`
          if (kind === 'not-found' || kind === 'no-matching-version') return refused('not-found', reason)
          if (kind === 'network') return refused('network', reason)
          return refused('unknown', view.timedOut ? `pnpm view timed out after ${String(this.inspectTimeoutMs)}ms` : reason)
        }
        let answer: unknown
        try {
          answer = JSON.parse(view.stdout.replace(ANSI_SEQUENCE, '').trim() || 'null')
        } catch (error) {
          return refused('unknown', `unreadable pnpm view output: ${messageOf(error)}`)
        }
        // A range answers one object per matching version, oldest first.
        const latest: unknown = Array.isArray(answer) ? answer.at(-1) : answer
        if (typeof latest !== 'object' || latest === null) return refused('unknown', 'pnpm view answered no package')
        const inspection = inspectionOf('registry', latest)
        const named = inspection.name === undefined ? { ...inspection, name: parsed.name } : inspection
        if (!named.bundle) return refused('not-a-bundle', `${named.name} declares no dsh.bundle`)
        return named
      }
    }
  }

  /** Persist a plugin entry's desired enablement and apply it on live profiles.
   * @param id Loader entry identity returned by listPlugins.
   * @param enabled Whether the plugin should run.
   * @returns Saved and runtime outcomes, including higher-priority overrides.
   */
  @Remote
  setPluginEnabled(id: PluginEntryId, enabled: boolean): Promise<ChangeResult> {
    return this.change(result => this.configure(async () => {
      const row = (await this.listPlugins()).find(item => item.entryId === id)
      if (row === undefined) throw new ManagementFailure('unknown-plugin')
      if (row.readOnlyReason !== undefined) throw new ManagementFailure(row.readOnlyReason)
      await writePluginEnabled(this.profile.patchPath, row.patchId, row.moduleName, enabled)
      result.warnings = await this.reload(enabled ? [row.patchId] : [])
      const current = (await this.listPlugins()).find(item => item.entryId === id)
      return current?.enabled !== enabled && this.ownerContext.get('hmr') !== undefined ? 'overridden' : undefined
    }), { stage: 'enable', target: id, enabled }, 'plugin')
  }

  /** Select or remove a bundle layer while retaining installed dependencies.
   * @param name Bundle package name.
   * @param enabled Whether the bundle contributes its patch layer.
   * @returns Persisted and runtime outcomes.
   */
  @Remote
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeResult> {
    return this.change(result => this.configure(async () => {
      await this.selectBundle(name, enabled)
      result.warnings = await this.reload(enabled ? this.bundleRows(name).map(row => row.id) : [])
    }), { stage: 'enable', target: name, enabled }, 'bundle')
  }

  /**
   * Install a package using the same pnpm implementation as dsh plugin. A run
   * that fails, is cancelled, or adds a package without a bundle patch restores
   * `package.json` and `pnpm-lock.yaml` as they were; downloaded files can stay.
   * @param spec One package spec, including local paths relative to the invocation directory.
   * @param options Whether to activate the installed bundle (defaults to true), the request id a cancellation names, and
   * the pending build scripts to allow for this profile before pnpm runs.
   * @returns Package-manager diagnostics and observed activation outcome.
   */
  @Remote
  installBundle(spec: string, options?: InstallBundleOptions): Promise<ChangeResult> {
    return this.installBundleInternal(spec, options)
  }

  /** Install the exact signed catalogue item shown to the user.
   * @param request Catalogue identity and signed package facts displayed when the user selected Install.
   * @returns Package-manager diagnostics and the resulting application state.
   */
  @Remote
  async installCuratedBundle(request: CuratedPluginInstallRequest): Promise<ChangeResult> {
    let entry: CuratedPluginEntry
    try {
      entry = resolveCuratedInstallRequest(await this.curatedCatalog(), request)
    } catch (error) {
      if (error instanceof ManagementFailure && error.code === 'stale-approval') {
        return { changed: false, application: 'failed', stage: 'install', target: request.id,
          error: { code: 'stale-approval' } }
      }
      throw error
    }
    return this.installBundleInternal(`${entry.package}@${entry.version}`, { approvedBuilds: [] }, entry)
  }

  private installBundleInternal(spec: string, options?: InstallBundleOptions, curated?: CuratedPluginEntry): Promise<ChangeResult> {
    const requestId = options?.requestId
    const control: InstallControl = { abort: new AbortController(), phase: 'installing', settled: Promise.resolve() }
    const stopped = (): boolean => control.abort.signal.aborted
    if (requestId !== undefined) this.installs.set(requestId, control)
    const announce = (phase: PluginInstallProgress['phase']): void => {
      if (requestId !== undefined) this.ownerContext.emit('plugin-manager/install-state', { requestId, phase })
    }
    const result = this.change(async (result) => {
      if (spec.trim() === '' || spec.startsWith('-')) throw new ManagementFailure('invalid-spec')
      if (stopped()) throw new InstallCancelledError()
      if (options?.approvedBuilds !== undefined) {
        await approveBuilds(this.profile.dir, options.approvedBuilds)
        result.approvedBuilds = options.approvedBuilds
      }
      const files = await this.readRestoredFiles()
      const before = readProfileManifest('dsh', this.profile.dir).dependencies ?? {}
      announce('installing')
      let name: string
      try {
        result.packageResult = await this.runPnpm(['add', spec, ...(curated === undefined ? [] : ['--ignore-scripts'])], control.abort.signal, requestId)
        if (stopped()) throw new InstallCancelledError()
        if (result.packageResult.exitCode !== 0) {
          // pnpm-workspace.yaml is not restored, so the names pnpm left undecided there can be offered for approval.
          try { result.pendingBuilds = await readPendingBuilds(this.profile.dir) }
          catch (error) {
            this.ownerContext.logger.warn('Could not read pending build approvals after pnpm failed', error)
          }
          throw new Error(result.packageResult.output)
        }
        const after = readProfileManifest('dsh', this.profile.dir).dependencies ?? {}
        const installed = Object.keys(after).filter(name => before[name] !== after[name])
        // Registry retries can retain the saved range after a partial installation.
        if (installed.length === 0) installed.push(...Object.keys(after).filter(name => spec === name || spec.startsWith(`${name}@`)))
        const target = installed[0]
        if (installed.length !== 1 || target === undefined) throw new ManagementFailure('ambiguous-install')
        name = target
        if (curated !== undefined) {
          if (name !== curated.package) throw new ManagementFailure('invalid-spec')
          const lock = parseYaml(await readFile(join(this.profile.dir, 'pnpm-lock.yaml'), 'utf8')) as CuratedLockfile
          if (!curatedLockIntegrityMatches(curated, lock)) throw new ManagementFailure('invalid-spec')
        }
        const dir = resolveBundleDir('dsh', name, this.profile.installAnchor, this.profile.dir)
        const manifest = bundleManifest(name, this.profile.dir, this.profile.installAnchor)
        if (manifest?.dsh?.bundle?.patch === undefined) throw new ManagementFailure('not-bundle')
        loadOverlayPatches('dsh', join(dir, manifest.dsh.bundle.patch))
      } catch (error) {
        // pnpm has exited by now, so the files it rewrote go back as they were.
        await this.restoreFiles(files)
        throw error
      }
      control.phase = 'applying'
      announce('applying')
      result.bundle = name
      result.target = name
      result.stage = 'enable'
      return this.configure(async () => {
        if (options?.enabled !== false) await this.selectBundle(name, true)
        if (Object.hasOwn(before, name)) return 'restart-required'
        if (options?.enabled !== false) result.warnings = await this.reload()
        if (curated !== undefined) {
          result.warnings = [...result.warnings ?? [], 'Curated installation skipped dependency scripts; use the conversation manager if this bundle requires an explicitly approved build.']
        }
      })
    }, { stage: 'install', target: spec, enabled: options?.enabled !== false }, 'install')
    /* v8 ignore next -- change() folds every failure into its result; only a lock or disposal error rejects */
    control.settled = result.then(() => undefined, () => undefined)
    return result.finally(() => { if (requestId !== undefined) this.installs.delete(requestId) })
  }

  /** Stop an installation this manager owns and wait until its files are back.
   * @param requestId The id the installation was started with.
   * @returns `cancelled` once pnpm exited and the files are restored, `too-late` once the bundle is being
   * applied, `not-running` for any other id.
   */
  @Remote
  async cancelInstall(requestId: PluginInstallRequestId): Promise<PluginInstallCancellation> {
    const control = this.installs.get(requestId)
    if (control === undefined) return { status: 'not-running' }
    if (control.phase === 'applying') return { status: 'too-late' }
    this.ownerContext.emit('plugin-manager/install-state', { requestId, phase: 'cancelling' })
    control.abort.abort()
    await control.settled
    return { status: 'cancelled' }
  }

  /** Fetch and verify the separately curated catalogue for the app Plugins page.
   * @returns Verified catalogue entries with Host-computed exact installed state.
   */
  @Remote
  async curatedCatalog(): Promise<CuratedPluginCatalog> {
    if (this.curatedCatalogPublicKey.length === 0) {
      throw new Error('curated plugin catalogue is not configured for this installation')
    }
    const response = await fetch(this.curatedCatalogUrl, { headers: { accept: 'application/json' }, signal: this.abort.signal })
    if (!response.ok) throw new Error(`curated plugin catalogue request failed with HTTP ${String(response.status)}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 4_000_000) throw new Error('curated plugin catalogue envelope is too large')
    const envelope = JSON.parse(bytes.toString('utf8')) as { payload?: unknown }
    const catalog = verifyCuratedCatalogEnvelope(envelope,
      this.curatedCatalogPublicKey, this.curatedCatalogUrl)
    if (typeof envelope.payload !== 'string') throw new Error('curated plugin catalogue signature envelope is invalid')
    const digest = createHash('sha256').update(Buffer.from(envelope.payload, 'base64')).digest('hex')
    await this.commitCatalogRevision(catalog.revision, digest)
    let lockfile: CuratedLockfile = {}
    try {
      lockfile = parseYaml(await readFile(join(this.profile.dir, 'pnpm-lock.yaml'), 'utf8')) as CuratedLockfile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const bundles = await this.listBundles()
    return {
      ...catalog,
      plugins: catalog.plugins.map(entry => ({
        ...entry,
        installed: isExactCuratedInstallation(entry, bundles, lockfile),
      })),
    }
  }

  /** Persist the highest accepted signed catalogue revision against replay. */
  private async commitCatalogRevision(revision: number, digest: string): Promise<void> {
    const previous = this.catalogRevisionWrite
    let release!: () => void
    this.catalogRevisionWrite = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const path = join(this.profile.dir, '.asterhub-catalog-revision')
      let current = 0
      let currentDigest: string | undefined
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as { revision?: unknown; digest?: unknown }
        if (typeof parsed.revision === 'number' && Number.isSafeInteger(parsed.revision) && parsed.revision >= 0) current = parsed.revision
        if (typeof parsed.digest === 'string') currentDigest = parsed.digest
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      }
      if (revision < current) throw new Error('curated plugin catalogue revision rollback was rejected')
      if (revision === current && currentDigest !== undefined && currentDigest !== digest) {
        throw new Error('curated plugin catalogue changed without advancing its revision')
      }
      if (revision > current || currentDigest === undefined) {
        await writeFileAtomic(path, `${JSON.stringify({ revision, digest })}\n`, { mode: 0o600 })
      }
    } finally {
      release()
    }
  }

  /** Unload and remove a profile-owned bundle dependency through dsh plugin's pnpm path.
   * @param name Installed dependency name.
   * @returns Removal diagnostics and the remaining profile state.
   */
  @Remote
  removeBundle(name: string): Promise<ChangeResult> {
    return this.change(async (result) => {
      await this.configure(async () => {
        const bundle = (await this.listBundles()).find(item => item.name === name)
        if (bundle === undefined || !bundle.removable) throw new ManagementFailure('not-removable')
        if (this.ownerContext.get('hmr') === undefined && (this.profile.startedBundles.includes(name)
          || this.bundleRows(name).some(row => [...this.ctx.loader.entries()]
            .some(entry => entry.options.id === row.id && entry.fiber !== undefined)))) {
          throw new ManagementFailure('stop-profile')
        }
        const contributions = bundle.error === undefined ? this.bundleRows(name) : []
        if (bundle.enabled) {
          await this.selectBundle(name, false)
          result.warnings = await this.reload()
        }
        if ([...this.ctx.loader.entries()].some(entry => entry.fiber?.uid != null
          && contributions.some(row => row.id === entry.options.id && row.name === entry.options.name))) {
          throw new ManagementFailure('bundle-in-use')
        }
      })
      result.packageResult = await this.runPnpm(['remove', name])
      if (result.packageResult.exitCode !== 0) throw new Error(result.packageResult.output)
    }, { stage: 'remove', target: name }, 'remove')
  }

  /** The rows a bundle's patch inserts and the existing rows it changes; an unreadable patch throws. */
  private declaredRows(name: string, info: ProfileManifest): Pick<BundleInfo, 'rows' | 'overrides'> {
    const patch = info.dsh?.bundle?.patch
    /* v8 ignore next -- bundleManifest answers only manifests that declare a patch */
    if (patch === undefined) return { rows: [], overrides: [] }
    const dir = resolveBundleDir('dsh', name, this.profile.installAnchor, this.profile.dir)
    const patches: PatchOptions[] = loadOverlayPatches('dsh', join(dir, patch))
    // One entry per row id: the Loader keeps a single entry for an id, whichever layer declared it last.
    const live = new Map<string, PluginEntryId>()
    for (const entry of this.ctx.loader.entries()) {
      /* v8 ignore next -- the Loader gives every entry an id before it is listed */
      if (typeof entry.options.id === 'string') live.set(entry.options.id, pluginEntryId(entry.id))
    }
    const rows: BundleRowInfo[] = []
    for (const row of flatten(composeEntries([patches.filter(item => item.insert !== undefined)]))) {
      if (typeof row.id !== 'string' || typeof row.name !== 'string') continue
      const entryId = live.get(row.id)
      rows.push({ rowId: row.id, moduleName: row.name, ...entryId === undefined ? {} : { entryId } })
    }
    const declared = new Set(rows.map(row => row.rowId))
    const overrides = [...new Set(patches.flatMap(item =>
      item.insert === undefined && typeof item.id === 'string' && !declared.has(item.id) ? [item.id] : []))]
    return { rows, overrides }
  }

  /** Run one pnpm command in the profile, streaming its output as install-log chunks. */
  private async runPnpm(
    args: readonly string[], signal?: AbortSignal, requestId?: PluginInstallRequestId,
  ): Promise<PackageResult> {
    const jobId = randomUUID()
    const argv = ['pnpm', ...args]
    const cwd = this.profile.dir
    const identity = requestId === undefined ? {} : { requestId }
    const task = runProfilePnpm({ ...this.profile, profile: this.profile.name }, args, {
      execution: 'service', ...this.profile.packageManager ?? { command: this.pnpmCommand },
      signal: signal === undefined ? this.abort.signal : AbortSignal.any([this.abort.signal, signal]),
      outputBytes: this.outputBytes, activateNewBundles: false,
      onOutput: (text, stream) => {
        this.ownerContext.emit('plugin-manager/install-log', { ...identity, jobId, argv, cwd, stream, text })
      },
    })
    this.packageOperations.add(task)
    try {
      const result = await task
      this.ownerContext.emit('plugin-manager/install-log', {
        ...identity, jobId, argv, cwd, stream: 'stdout', text: '', exitCode: signal?.aborted === true ? null : result.exitCode,
      })
      return result.exitCode === 0 ? result : { ...result, kind: classifyInstallFailure({ log: result.output }) }
    } catch (error) {
      this.ownerContext.emit('plugin-manager/install-log', { ...identity, jobId, argv, cwd, stream: 'stderr', text: messageOf(error), exitCode: null })
      throw error
    } finally {
      this.packageOperations.delete(task)
    }
  }

  /** The profile files an installation may rewrite, as they are now; absent files read as undefined. */
  private async readRestoredFiles(): Promise<Map<string, string | undefined>> {
    const files = new Map<string, string | undefined>()
    for (const name of RESTORED_FILES) {
      const path = join(this.profile.dir, name)
      files.set(path, existsSync(path) ? await readFile(path, 'utf8') : undefined)
    }
    return files
  }

  /** Put the profile files back; pnpm has exited by the time this runs. */
  private async restoreFiles(files: Map<string, string | undefined>): Promise<void> {
    for (const [path, content] of files) {
      if (content === undefined) await rm(path, { force: true })
      else await writeFileAtomic(path, content, { mode: 0o600 })
    }
  }

  private async selectBundle(name: string, enabled: boolean): Promise<void> {
    const manifest = readProfileManifest('dsh', this.profile.dir)
    const previous = manifest.dsh?.profile?.bundles ?? []
    if ((enabled || !previous.includes(name)) && bundleManifest(name, this.profile.dir, this.profile.installAnchor) === undefined) {
      throw new ManagementFailure('not-bundle')
    }
    if (!enabled && previous.includes(name)) {
      if (this.protectsManager(name)) throw new ManagementFailure('management-required')
    }
    if (enabled && !previous.includes(name) && this.protectsManager(name)) {
      throw new ManagementFailure('management-required')
    }
    const bundles = enabled ? [...previous, ...previous.includes(name) ? [] : [name]] : previous.filter(item => item !== name)
    if (JSON.stringify(previous) === JSON.stringify(bundles)) return
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    await saveManifest(this.profile.dir, manifest)
  }

  private bundleRows(name: string): EntryOptions[] {
    const info = bundleManifest(name, this.profile.dir, this.profile.installAnchor)
    if (info?.dsh?.bundle === undefined) return []
    const dir = resolveBundleDir('dsh', name, this.profile.installAnchor, this.profile.dir)
    return flatten(composeEntries([loadOverlayPatches('dsh', join(dir, info.dsh.bundle.patch))]))
  }

  private protectsManager(name: string): boolean {
    return this.bundleRows(name).some(row => protectedModules.has(row.name)
      || protectedEntryIds.has(row.id)
      || `include:${row.id}` === this.ownerEntryId)
  }

  private configure<T>(operation: () => Promise<T>): Promise<T> {
    const hmr = this.ownerContext.get('hmr')
    const apply = () => { this.abort.signal.throwIfAborted(); return operation() }
    return hmr === undefined ? apply() : hmr.runExclusive(apply)
  }

  private async reload(requiredIds: readonly string[] = []): Promise<string[]> {
    if (this.ownerContext.get('hmr') === undefined) return []
    return reconcileProfilePatches(this.ownerContext.root, readProfilePatches('dsh', this.profile), 'dsh', requiredIds)
  }

  private async change(
    operation: (result: ChangeResult) => Promise<ChangeResult['application'] | void>,
    request: Pick<ChangeResult, 'stage' | 'target' | 'enabled'>,
    reason: PluginChange['reason'],
  ): Promise<ChangeResult> {
    return withFileLock(join(this.profile.dir, 'package.json'), async () => {
      this.abort.signal.throwIfAborted()
      const before = this.diskState()
      const result: ChangeResult = { ...request, changed: false,
        application: this.ownerContext.get('hmr') !== undefined ? 'applied' : 'restart-required' }
      try {
        result.application = await operation(result) ?? result.application
      } catch (error) {
        if (error instanceof InstallCancelledError) {
          result.application = 'cancelled'
        } else {
          result.application = 'failed'
          result.error = managementError(error)
        }
      }
      result.changed = before !== this.diskState()
      this.ownerContext.emit('plugin-manager/changed', { reason })
      return result
    }, { waitMs: this.lockWaitMs })
  }

  private diskState(): string {
    return ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'].map((file) => {
      try { return readFileSync(join(this.profile.dir, file), 'utf8') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
      }
    }).join('\0')
  }
}

export default PluginManager
