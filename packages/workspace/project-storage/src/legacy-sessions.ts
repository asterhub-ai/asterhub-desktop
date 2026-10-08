/**
 * Byte-for-byte legacy Session generation staging and adoption for AsterHub projects.
 * @module
 */

import { createHash, randomBytes } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  LegacyProjectProposal,
  PortableProjectManifest,
  ProjectLegacyAdopter,
} from './types.ts'

export interface LegacyAdoptionOptions {
  /** Optional custom attachments source root. */
  legacyAttachmentsRoot?: string
}

/** Encode a raw string segment to a filesystem-safe directory name. */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/** Build the filesystem-safe key for a project path. */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

interface LocatedSession {
  readonly id: SessionId
  readonly sourceDir: string
  readonly relativeProjectKey: string
  readonly generationFiles: readonly string[]
}

async function findSessionInSource(
  sourceRoot: string,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<LocatedSession> {
  signal?.throwIfAborted()
  const encodedId = encodeSegment(sessionId)
  const candidateDirect = join(sourceRoot, encodedId)
  const candidatePlain = join(sourceRoot, String(sessionId))

  async function checkDir(dir: string, relKey: string): Promise<LocatedSession | undefined> {
    try {
      const dirStat = await stat(dir)
      if (!dirStat.isDirectory()) return undefined
      const entries = await readdir(dir, { withFileTypes: true })
      const generationFiles: string[] = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const name = entry.name
        if (
          (name.startsWith('session.') || name.startsWith('session'))
          && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd'))
          && !name.includes('.tmp')
        ) {
          generationFiles.push(entry.name)
        }
      }
      if (generationFiles.length === 0) return undefined
      return { id: sessionId, sourceDir: dir, relativeProjectKey: relKey, generationFiles }
    } catch {
      return undefined
    }
  }

  // 1. Direct match under sourceRoot
  const directMatch = await checkDir(candidateDirect, 'default')
    ?? await checkDir(candidatePlain, 'default')
  if (directMatch !== undefined) return directMatch

  // 2. Search under subdirectories (e.g. grouped project directories like --cwd--)
  try {
    const rootEntries = await readdir(sourceRoot, { withFileTypes: true })
    for (const entry of rootEntries) {
      signal?.throwIfAborted()
      if (!entry.isDirectory()) continue
      const subCandidate = join(sourceRoot, entry.name, encodedId)
      const subMatch = await checkDir(subCandidate, entry.name)
      if (subMatch !== undefined) return subMatch
      const subPlain = join(sourceRoot, entry.name, String(sessionId))
      const subPlainMatch = await checkDir(subPlain, entry.name)
      if (subPlainMatch !== undefined) return subPlainMatch
    }
  } catch (error: unknown) {
    throw new Error(`failed to read legacy source root "${sourceRoot}": ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(`legacy session "${sessionId}" not found under source root "${sourceRoot}"`)
}

async function copyAndVerifyFile(sourceFile: string, targetFile: string): Promise<void> {
  const sourceBytes = await readFile(sourceFile)
  const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex')
  await mkdir(dirname(targetFile), { recursive: true, mode: 0o700 })
  await cp(sourceFile, targetFile)
  const stagedBytes = await readFile(targetFile)
  const stagedDigest = createHash('sha256').update(stagedBytes).digest('hex')
  if (sourceBytes.length !== stagedBytes.length || sourceDigest !== stagedDigest) {
    throw new Error(`staged copy corrupted for file "${basename(sourceFile)}": digest mismatch`)
  }
}

/**
 * Create a ProjectLegacyAdopter that stages legacy session generations byte-for-byte,
 * verifies headers and integrity, and atomically publishes into the destination project's `.aster/sessions`.
 *
 * @param options - optional adoption configuration.
 * @returns a verified ProjectLegacyAdopter function.
 */
export function createLegacyAdopter(_options?: LegacyAdoptionOptions): ProjectLegacyAdopter {
  return async (proposal: LegacyProjectProposal, destinationRoot: string, signal?: AbortSignal): Promise<PortableProjectManifest> => {
    signal?.throwIfAborted()

    const stagingId = `.stage-adoption-${Date.now()}-${randomBytes(4).toString('hex')}`
    const stagingDir = join(destinationRoot, '.aster', stagingId)
    const stagedSessionsDir = join(stagingDir, 'sessions')
    const finalSessionsDir = join(destinationRoot, '.aster', 'sessions')

    await mkdir(stagedSessionsDir, { recursive: true, mode: 0o700 })

    try {
      // 1. Locate every proposal session in the legacy source root
      const locatedSessions: LocatedSession[] = []
      for (const record of proposal.sessions) {
        signal?.throwIfAborted()
        const located = await findSessionInSource(proposal.sourceRoot, record.id, signal)
        locatedSessions.push(located)
      }

      // 2. Stage each session generation byte-for-byte and verify digests
      for (const located of locatedSessions) {
        signal?.throwIfAborted()
        const destRelDir = located.relativeProjectKey
        const destSessionDir = join(stagedSessionsDir, destRelDir, encodeSegment(located.id))
        await mkdir(destSessionDir, { recursive: true, mode: 0o700 })

        for (const genFile of located.generationFiles) {
          signal?.throwIfAborted()
          const srcPath = join(located.sourceDir, genFile)
          const dstPath = join(destSessionDir, genFile)
          await copyAndVerifyFile(srcPath, dstPath)
        }
      }

      // 3. Move/publish staged sessions into final .aster/sessions
      await mkdir(finalSessionsDir, { recursive: true, mode: 0o700 })
      const stagedEntries = await readdir(stagedSessionsDir, { withFileTypes: true })
      for (const entry of stagedEntries) {
        signal?.throwIfAborted()
        const src = join(stagedSessionsDir, entry.name)
        const dst = join(finalSessionsDir, entry.name)
        await cp(src, dst, { recursive: true })
      }

      // 4. Clean up staging directory
      await rm(stagingDir, { recursive: true, force: true })

      // 5. Construct and return validated portable manifest
      return {
        schemaVersion: 1,
        id: proposal.projectId,
        title: proposal.title,
        createdAt: Date.now(),
        sessions: proposal.sessions,
        sessionOrder: proposal.sessionOrder,
        pinnedSessionIds: proposal.pinnedSessionIds,
        archivedSessionIds: proposal.archivedSessionIds,
      }
    } catch (error) {
      // Clean up staging on any failure; never touch legacy source
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }
}
