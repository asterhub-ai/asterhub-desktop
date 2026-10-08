import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { DSH_HOME_ENV, expandHomePath } from '@deepseek-ai/dsh-home-paths'

const LEGACY_HOME_DIR_NAME = '.dsh'
const HOME_DIR_NAME = '.asterhub'
const COMPLETION_RECORD = '.asterhub-migration-complete.json'
const RECORD_VERSION = 1

/** Inputs used to prepare a global AsterHub home before any home-relative consumers start. */
export interface PrepareAsterHubHomeOptions {
  /** Operating-system home used for the default `.dsh` and `.asterhub` locations. */
  userHome: string
  /** Highest-precedence configured home; when present, no migration is inspected or performed. */
  configuredHome?: string
  /** Environment mapping consulted for a nonblank `DSH_HOME`; defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** Cancels default migration work while preserving source and staging evidence. */
  signal?: AbortSignal
}

/** Prepared path and work performed by this invocation, not historical migration provenance. */
export interface PrepareAsterHubHomeResult {
  home: string
  /** `copied` only when this call publishes a copy; an already-completed default returns `none`. */
  migration: 'none' | 'copied' | 'explicit'
}

/** Independent populated default roots require an explicit choice; this helper never merges them. */
export class HomeMigrationConflictError extends Error {
  constructor(oldHome: string, newHome: string) {
    super(`AsterHub home migration conflict: both ${oldHome} and ${newHome} contain independent data; preserve both and choose a home explicitly.`)
    this.name = 'HomeMigrationConflictError'
  }
}

interface InventoryEntry {
  path: string
  kind: 'directory' | 'file' | 'symlink'
  digest?: string
  target?: string
  resolvedTarget?: string
  targetKind?: 'directory' | 'file'
  size?: number
  mtimeMs?: number
  links?: number
}

interface CompletionRecord {
  version: 1
  source: '.dsh'
  destination: '.asterhub'
  sourceDigest: string
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('AsterHub home migration aborted')
}

function isPathCollision(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'EEXIST' || error.code === 'ENOTEMPTY'
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Expected a real directory at ${path}`)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function inventory(
  root: string,
  options: { source?: boolean; excludeRecord?: boolean; relocateTo?: string } = {},
): Promise<InventoryEntry[]> {
  const entries: InventoryEntry[] = []
  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const path = join(directory, child.name)
      const key = relative(root, path).split(sep).join('/')
      if (options.excludeRecord && key === COMPLETION_RECORD) continue
      const info = await lstat(path)
      if (info.isSymbolicLink()) {
        const target = await readlink(path)
        const targetPath = resolve(dirname(path), target)
        let inventoryTarget: string
        let resolvedTarget: string
        if (inside(root, targetPath)) {
          inventoryTarget = targetPath
          resolvedTarget = relative(root, targetPath).split(sep).join('/')
        } else if (options.relocateTo !== undefined && inside(options.relocateTo, targetPath)) {
          inventoryTarget = join(root, relative(options.relocateTo, targetPath))
          resolvedTarget = relative(options.relocateTo, targetPath).split(sep).join('/')
        } else {
          throw new Error(`External symlink target at ${path} is outside the home`)
        }
        try {
          const actualTarget = await realpath(inventoryTarget)
          if (!inside(root, actualTarget)) throw new Error(`External symlink target at ${path} resolves outside the home`)
          const targetInfo = await stat(actualTarget)
          if (!targetInfo.isFile() && !targetInfo.isDirectory()) throw new Error(`Unsupported symlink target type at ${path}`)
          entries.push({ path: key, kind: 'symlink', target, resolvedTarget, targetKind: targetInfo.isDirectory() ? 'directory' : 'file', mtimeMs: info.mtimeMs })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Dangling symlink at ${path} cannot be migrated`)
          throw error
        }
      } else if (info.isDirectory()) {
        entries.push({ path: key, kind: 'directory', mtimeMs: info.mtimeMs })
        await visit(path)
      } else if (info.isFile()) {
        const content = await readFile(path)
        const afterRead = await lstat(path)
        if (!afterRead.isFile() || afterRead.size !== info.size || afterRead.mtimeMs !== info.mtimeMs || afterRead.ino !== info.ino) {
          throw new Error(`Source file changed while being read: ${path}`)
        }
        entries.push({
          path: key,
          kind: 'file',
          digest: createHash('sha256').update(content).digest('hex'),
          size: info.size,
          mtimeMs: info.mtimeMs,
          links: info.nlink,
        })
      } else {
        throw new Error(`Unsupported filesystem entry in home: ${path}`)
      }
    }
  }
  await visit(root)
  return entries
}

function digestInventory(entries: readonly InventoryEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}
function digestTree(entries: readonly InventoryEntry[]): string {
  const tree = entries.map(({ path, kind, digest, resolvedTarget, targetKind }) => (
    { path, kind, digest, target: resolvedTarget, targetKind }
  ))
  return createHash('sha256').update(JSON.stringify(tree)).digest('hex')
}

function hasData(entries: readonly InventoryEntry[]): boolean {
  return entries.some(entry => entry.kind !== 'directory')
}

async function copyInventory(
  source: string,
  stage: string,
  destination: string,
  entries: readonly InventoryEntry[],
  options: { alreadyRelocated?: boolean } = {},
): Promise<void> {
  for (const entry of entries) {
    const sourcePath = join(source, ...entry.path.split('/'))
    const targetPath = join(stage, ...entry.path.split('/'))
    if (entry.kind === 'directory') {
      await mkdir(targetPath, { recursive: true })
    } else if (entry.kind === 'file') {
      const sourceInfo = await stat(sourcePath)
      const content = await readFile(sourcePath)
      const afterRead = await stat(sourcePath)
      if (sourceInfo.size !== afterRead.size || sourceInfo.mtimeMs !== afterRead.mtimeMs || sourceInfo.ino !== afterRead.ino
        || createHash('sha256').update(content).digest('hex') !== entry.digest) {
        throw new Error(`Source file changed while staging: ${sourcePath}`)
      }
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, content, { mode: sourceInfo.mode & 0o777, flag: 'wx' })
    } else {
      const linkTarget = entry.target
      const targetKind = entry.targetKind
      if (linkTarget === undefined || targetKind === undefined) throw new Error(`Invalid staged symlink inventory entry: ${entry.path}`)
      let target = linkTarget
      if (isAbsolute(target) && options.alreadyRelocated !== true) target = join(destination, relative(source, resolve(target)))
      await mkdir(dirname(targetPath), { recursive: true })
      const type = targetKind === 'file' ? 'file' : process.platform === 'win32' && isAbsolute(target) ? 'junction' : 'dir'
      await symlink(target, targetPath, type)
    }
  }
}

async function readCompletionRecord(destination: string): Promise<CompletionRecord | undefined> {
  const path = join(destination, COMPLETION_RECORD)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid AsterHub migration record entry at ${path}`)
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid AsterHub migration record at ${path}`)
    const value = raw as Record<string, unknown>
    if (value.version !== RECORD_VERSION || value.source !== LEGACY_HOME_DIR_NAME
      || value.destination !== HOME_DIR_NAME
      || typeof value.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceDigest)) {
      throw new Error(`Invalid or mismatched AsterHub migration record at ${path}`)
    }
    const record: CompletionRecord = {
      version: RECORD_VERSION,
      source: LEGACY_HOME_DIR_NAME,
      destination: HOME_DIR_NAME,
      sourceDigest: value.sourceDigest,
    }
    return record
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}


function resolveExplicit(value: string, userHome: string): string {
  if (value === '~') return userHome
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(userHome, value.slice(2))
  return resolve(expandHomePath(value))
}

export async function prepareAsterHubHome(options: PrepareAsterHubHomeOptions): Promise<PrepareAsterHubHomeResult> {
  const userHome = resolve(options.userHome)
  const env = options.env ?? process.env
  const envHome = env[DSH_HOME_ENV]
  if (options.configuredHome !== undefined) return { home: resolveExplicit(options.configuredHome, userHome), migration: 'explicit' }
  if (envHome !== undefined && envHome.trim().length > 0) return { home: resolveExplicit(envHome, userHome), migration: 'explicit' }
  const canonicalUserHome = await realpath(userHome)

  const oldHome = join(canonicalUserHome, LEGACY_HOME_DIR_NAME)
  const newHome = join(canonicalUserHome, HOME_DIR_NAME)
  const lockPath = join(canonicalUserHome, '.asterhub-home-migration-owner')
  return withFileLock(lockPath, async () => {
    checkAbort(options.signal)
    const destinationExists = await directoryExists(newHome)
    if (destinationExists) {
      const completed = await readCompletionRecord(newHome)
      if (completed !== undefined) return { home: newHome, migration: 'none' }
    }
    let sourceInventory: InventoryEntry[]
    try {
      const sourceExists = await directoryExists(oldHome)
      sourceInventory = sourceExists ? await inventory(oldHome, { source: true }) : []
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`AsterHub home migration stopped before staging; source preserved at ${oldHome}, recovery options at ${newHome}: ${message}`, { cause: error })
    }
    if (sourceInventory.some(entry => entry.path === COMPLETION_RECORD)) {
      throw new Error(`Legacy source uses the reserved migration-record path ${join(oldHome, COMPLETION_RECORD)}; source preserved and no staging directory was created`)
    }
    if (destinationExists) {
      const destinationInventory = await inventory(newHome)
      if (hasData(destinationInventory) && hasData(sourceInventory)) throw new HomeMigrationConflictError(oldHome, newHome)
      if (!hasData(sourceInventory)) return { home: newHome, migration: 'none' }
    } else if (!hasData(sourceInventory)) {
      return { home: newHome, migration: 'none' }
    }

    const stage = await mkdtemp(join(dirname(newHome), '.asterhub-migration-stage-'))
    try {
      checkAbort(options.signal)
      const sourceDigest = digestInventory(sourceInventory)
      const contentDigest = digestTree(sourceInventory)
      await copyInventory(oldHome, stage, newHome, sourceInventory)
      checkAbort(options.signal)
      const finalSourceInventory = await inventory(oldHome, { source: true })
      if (digestInventory(finalSourceInventory) !== sourceDigest) throw new Error(`Source home changed during migration: ${oldHome}`)
      const stagedInventory = await inventory(stage, { relocateTo: newHome })
      if (digestTree(stagedInventory) !== contentDigest) throw new Error(`Staged home verification failed at ${stage}`)
      const completion: CompletionRecord = {
        version: RECORD_VERSION,
        source: LEGACY_HOME_DIR_NAME,
        destination: HOME_DIR_NAME,
        sourceDigest,
      }
      await writeFileAtomic(join(stage, COMPLETION_RECORD), JSON.stringify(completion), { mode: 0o600 })
      checkAbort(options.signal)

      const currentDestinationExists = await directoryExists(newHome)
      if (destinationExists !== currentDestinationExists) throw new Error(`Destination changed before publication: ${newHome}`)
      if (currentDestinationExists && hasData(await inventory(newHome))) throw new HomeMigrationConflictError(oldHome, newHome)
      if (currentDestinationExists) {
        try {
          await rmdir(newHome)
        } catch (error: unknown) {
          if (isPathCollision(error)) throw new HomeMigrationConflictError(oldHome, newHome)
          throw error
        }
      }
      try {
        await mkdir(newHome)
      } catch (error: unknown) {
        if (isPathCollision(error)) throw new HomeMigrationConflictError(oldHome, newHome)
        throw error
      }
      const stageEntries = await inventory(stage, { excludeRecord: true, relocateTo: newHome })
      await copyInventory(stage, newHome, newHome, stageEntries, { alreadyRelocated: true })
      const publishedInventory = await inventory(newHome)
      if (digestTree(publishedInventory) !== contentDigest) throw new Error(`Published home verification failed at ${newHome}`)
      await writeFileAtomic(join(newHome, COMPLETION_RECORD), JSON.stringify(completion), { mode: 0o600 })
      await rm(stage, { recursive: true, force: true })
      return { home: newHome, migration: 'copied' }
    } catch (error) {
      if (error instanceof HomeMigrationConflictError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`AsterHub home migration failed; source preserved at ${oldHome}, staging/recovery evidence at ${stage}: ${message}`, { cause: error })
    }
  }, { waitMs: 30_000 })
}
