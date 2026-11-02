/** Closed private transports shared by the native subprocess runner. */

/** Bounded Node-shaped error fields allowed across a private runner boundary. */
export interface SerializedRunnerError {
  name: string
  message: string
  code?: string
  syscall?: string
  path?: string
}

/** The only parent-to-runner start message on Windows. */
export interface WindowsStartRequest {
  type: 'start'
  cwd: string
  env: Record<string, string>
  control?: 'pipe'
}

/** The only parent-to-runner control message on Windows. */
export interface WindowsTerminateRequest {
  type: 'terminate'
}

/** Exactly one direct-result branch is sent by a connected Windows runner. */
export type WindowsRunnerResult =
  | { type: 'target-exit'; exitCode: number }
  | { type: 'error'; error: SerializedRunnerError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => allowed.has(key))
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string')
}

function isSerializedRunnerError(value: unknown): value is SerializedRunnerError {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['name', 'message'],
    ['code', 'syscall', 'path'],
  )) return false
  return typeof value.name === 'string'
    && typeof value.message === 'string'
    && (value.code === undefined || typeof value.code === 'string')
    && (value.syscall === undefined || typeof value.syscall === 'string')
    && (value.path === undefined || typeof value.path === 'string')
}

function parseErrorResult(value: Record<string, unknown>): { type: 'error'; error: SerializedRunnerError } {
  if (!hasExactKeys(value, ['type', 'error']) || !isSerializedRunnerError(value.error)) {
    throw new Error('subprocess runner emitted an invalid error result')
  }
  if (value.type !== 'error') {
    throw new Error('subprocess runner emitted an unknown error result')
  }
  return { type: 'error', error: value.error }
}

/**
 * Strictly parse the single Windows start message.
 * @param value - untrusted IPC payload.
 * @returns validated target start request.
 */
export function parseWindowsStartRequest(value: unknown): WindowsStartRequest {
  if (!isRecord(value) || !hasExactKeys(value, ['type', 'cwd', 'env'], ['control'])
    || value.type !== 'start' || typeof value.cwd !== 'string' || !isStringRecord(value.env)
    || (value.control !== undefined && value.control !== 'pipe')) {
    throw new Error('subprocess runner received an invalid Windows start request')
  }
  return { type: 'start', cwd: value.cwd, env: value.env, ...value.control === 'pipe' ? { control: 'pipe' as const } : {} }
}

/**
 * Return true only for the exact, payload-free Windows terminate control.
 * @param value - untrusted IPC payload.
 * @returns whether the payload is the exact terminate request.
 */
export function isWindowsTerminateRequest(value: unknown): value is WindowsTerminateRequest {
  return isRecord(value) && hasExactKeys(value, ['type']) && value.type === 'terminate'
}

/**
 * Strictly parse one of the two Windows direct-result branches.
 * @param value - untrusted IPC payload.
 * @returns validated direct-result message.
 */
export function parseWindowsRunnerResult(value: unknown): WindowsRunnerResult {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('subprocess runner emitted an invalid Windows result')
  }
  if (value.type === 'error') return parseErrorResult(value)
  if (value.type === 'target-exit') {
    const validExitCode = typeof value.exitCode === 'number'
      && Number.isSafeInteger(value.exitCode)
      && value.exitCode >= 0
    if (!hasExactKeys(value, ['type', 'exitCode']) || !validExitCode) {
      throw new Error('subprocess runner emitted an invalid target-exit result')
    }
    return {
      type: 'target-exit',
      exitCode: value.exitCode as number,
    }
  }
  throw new Error(`subprocess runner emitted an unknown Windows result: ${value.type}`)
}

/**
 * Convert an unknown failure into the bounded cross-process error record.
 * @param error - failure caught at the process boundary.
 * @returns bounded serializable error fields.
 */
export function serializeRunnerError(error: unknown): SerializedRunnerError {
  const source = error instanceof Error ? error : new Error(String(error))
  const node = source as NodeJS.ErrnoException & { path?: string }
  return {
    name: source.name,
    message: source.message,
    ...typeof node.code === 'string' ? { code: node.code } : {},
    ...typeof node.syscall === 'string' ? { syscall: node.syscall } : {},
    ...typeof node.path === 'string' ? { path: node.path } : {},
  }
}

/**
 * Rebuild a Node-shaped Error from a strict runner record.
 * @param serialized - validated bounded error fields.
 * @returns reconstructed Error with supported Node fields.
 */
export function deserializeRunnerError(serialized: SerializedRunnerError): Error {
  const error = new Error(serialized.message)
  error.name = serialized.name
  return Object.assign(error, {
    ...serialized.code === undefined ? {} : { code: serialized.code },
    ...serialized.syscall === undefined ? {} : { syscall: serialized.syscall },
    ...serialized.path === undefined ? {} : { path: serialized.path },
  })
}
