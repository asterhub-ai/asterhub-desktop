import { createHash, randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PortableProjectManifest, ProjectBindingRevision, ProjectId, ProjectSessionRecord } from './types.ts'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Validate and brand an RFC 4122 project UUID. */
export function ProjectId(value: string): ProjectId {
  if (!uuidPattern.test(value)) throw new TypeError(`invalid project id: ${value}`)
  return brandString<ProjectId>(value.toLowerCase())
}

/** Validate and brand one binding revision UUID. */
export function ProjectBindingRevision(value: string): ProjectBindingRevision {
  if (!uuidPattern.test(value)) throw new TypeError(`invalid project binding revision: ${value}`)
  return brandString<ProjectBindingRevision>(value.toLowerCase())
}

/** Validate a project-relative working directory; paths are portable `/`-separated data. */
export function validateRelativeCwd(value: string): string {
  if (value === '.') return value
  if (value.length === 0 || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[a-z]:/i.test(value)) {
    throw new TypeError(`invalid project-relative cwd: ${value}`)
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '..' || part === '.')) throw new TypeError(`invalid project-relative cwd: ${value}`)
  return parts.join('/')
}

/** Build a complete empty portable manifest. */
export function createManifest(input: { id?: ProjectId; title: string; createdAt?: number }): PortableProjectManifest {
  const title = validateTitle(input.title)
  const id = input.id ?? ProjectId(randomUUID())
  const createdAt = input.createdAt ?? Date.now()
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new TypeError('invalid manifest createdAt')
  return { schemaVersion: 1, id, title, createdAt, sessions: [], sessionOrder: [], pinnedSessionIds: [], archivedSessionIds: [] }
}

/** Validate, encode and freeze a Session record's portable directory. */
export function projectSessionRecord(id: string, relativeCwd: string): ProjectSessionRecord {
  if (id.length === 0 || id.includes('\0')) throw new TypeError('invalid session id')
  return { id: SessionId(id), relativeCwd: validateRelativeCwd(relativeCwd) }
}

/** Compute the SHA-256 digest used by project-open confirmation. */
export function manifestDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Parse JSON while rejecting duplicate or prototype-sensitive object keys. */
export function parseStrictJson(text: string): unknown {
  const value: unknown = JSON.parse(text, (key, item: unknown) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new TypeError(`forbidden JSON key ${key}`)
    return item
  })
  assertNoDuplicateJsonKeys(text)
  return value
}

/** Parse strict bounded JSON and validate every manifest field and relationship. */
export function decodeManifest(bytes: Uint8Array, maxBytes = 1024 * 1024): PortableProjectManifest {
  if (bytes.byteLength > maxBytes) throw new RangeError('project metadata exceeds configured size limit')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const value = parseStrictJson(text)
  if (!isObject(value)) throw new TypeError('project metadata must be an object')
  if (value.schemaVersion !== 1) throw new RangeError(`unsupported project metadata schema version: ${String(value.schemaVersion)}`)
  const keys = Object.keys(value).sort()
  const expected = ['archivedSessionIds', 'createdAt', 'id', 'pinnedSessionIds', 'schemaVersion', 'sessionOrder', 'sessions', 'title'].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new TypeError('project metadata has missing or unexpected fields')
  const id = ProjectId(string(value.id, 'id'))
  const title = validateTitle(string(value.title, 'title'))
  if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new TypeError('invalid manifest createdAt')
  if (!Array.isArray(value.sessions) || !Array.isArray(value.sessionOrder) || !Array.isArray(value.pinnedSessionIds) || !Array.isArray(value.archivedSessionIds)) throw new TypeError('manifest membership fields must be arrays')
  const rawSessions: unknown[] = value.sessions
  const rawSessionOrder: unknown[] = value.sessionOrder
  const rawPinnedSessionIds: unknown[] = value.pinnedSessionIds
  const rawArchivedSessionIds: unknown[] = value.archivedSessionIds
  const sessions = rawSessions.map((record: unknown) => {
    if (!isObject(record) || Object.keys(record).sort().join(',') !== 'id,relativeCwd') throw new TypeError('invalid Session record')
    return projectSessionRecord(string(record.id, 'session id'), string(record.relativeCwd, 'relative cwd'))
  })
  const ids = sessions.map(record => record.id)
  if (new Set(ids).size !== ids.length) throw new TypeError('duplicate Session ownership in manifest')
  const sessionOrder = idList(rawSessionOrder, 'sessionOrder')
  const pinnedSessionIds = idList(rawPinnedSessionIds, 'pinnedSessionIds')
  const archivedSessionIds = idList(rawArchivedSessionIds, 'archivedSessionIds')
  const owned = new Set(ids)
  if (sessionOrder.length !== ids.length || sessionOrder.some(item => !owned.has(item)) || new Set(sessionOrder).size !== ids.length) throw new TypeError('sessionOrder must contain each owned Session exactly once')
  if (pinnedSessionIds.some(item => !owned.has(item)) || archivedSessionIds.some(item => !owned.has(item))) throw new TypeError('pin/archive state references an unowned Session')
  if (pinnedSessionIds.some(item => archivedSessionIds.includes(item))) throw new TypeError('archived Sessions cannot be pinned')
  return { schemaVersion: 1, id, title, createdAt: value.createdAt, sessions, sessionOrder, pinnedSessionIds, archivedSessionIds }
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function string(value: unknown, name: string): string { if (typeof value !== 'string') throw new TypeError(`invalid ${name}`); return value }
function idList(value: unknown[], name: string) {
  const ids = value.map(item => SessionId(string(item, name)))
  if (new Set(ids).size !== ids.length) throw new TypeError(`duplicate ${name}`)
  return ids
}
function validateTitle(value: string): string {
  const title = value.trim()
  if (title.length === 0 || title.length > 256 || title.includes('\0')) throw new TypeError('invalid project title')
  return title
}
function assertNoDuplicateJsonKeys(text: string): void {
  let cursor = 0
  const whitespace = (): void => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor += 1 }
  const stringValue = (): string => {
    const start = cursor
    cursor += 1
    while (cursor < text.length) {
      const char = text[cursor]
      cursor += 1
      if (char === '\\') cursor += 1
      else if (char === '"') {
        const value: unknown = JSON.parse(text.slice(start, cursor))
        if (typeof value !== 'string') throw new SyntaxError('invalid JSON object key')
        return value
      }
    }
    throw new SyntaxError('unterminated JSON string')
  }
  const parseValue = (depth: number): void => {
    if (depth > 64) throw new RangeError('project metadata nesting exceeds limit')
    whitespace()
    if (text[cursor] === '{') {
      cursor += 1
      whitespace()
      const keys: Record<string, true> = {}
      if (text[cursor] === '}') { cursor += 1; return }
      while (cursor < text.length) {
        whitespace()
        const key = stringValue()
        if (Object.hasOwn(keys, key)) throw new TypeError(`duplicate JSON key: ${key}`)
        keys[key] = true
        whitespace()
        cursor += 1
        parseValue(depth + 1)
        whitespace()
        const delimiter = text[cursor]
        cursor += 1
        if (delimiter === '}') return
      }
      throw new SyntaxError('unterminated JSON object')
    }
    if (text[cursor] === '[') {
      cursor += 1
      whitespace()
      if (text[cursor] === ']') { cursor += 1; return }
      while (cursor < text.length) {
        parseValue(depth + 1)
        whitespace()
        const delimiter = text[cursor]
        cursor += 1
        if (delimiter === ']') return
      }
      throw new SyntaxError('unterminated JSON array')
    }
    if (text[cursor] === '"') { stringValue(); return }
    while (cursor < text.length && !/[\s,\]}]/.test(text[cursor] ?? '')) cursor += 1
  }
  parseValue(0)
  whitespace()
  if (cursor !== text.length) throw new SyntaxError('unexpected trailing JSON data')
}
