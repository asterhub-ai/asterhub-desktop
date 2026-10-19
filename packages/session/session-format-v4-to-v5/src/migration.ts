/** V5 preserves released V4 records and admits Anima context and local-graph operation events. */

import {
  defineSessionFormatMigration, SessionFormatError, isSessionFormatJsonObject, sessionFormatCount,
} from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatEvent, SessionFormatEventRun, SessionFormatHeader,
  SessionFormatMigrationContext, SessionFormatMigrationStage, SessionFormatMigrationStageInput,
} from '@deepseek-ai/dsh-session-format'
import { releasedV4SessionFormatCodec, assertReleasedV4Header, restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'

/**
 * Require the complete V4 header fields and admit only the V5 version marker.
 * @param header - JSON header from one physical Session record.
 * @returns the validated V5 Session header.
 */
export function assertReleasedV5Header(header: unknown): asserts header is SessionFormatHeader {
  if (!isSessionFormatJsonObject(header) || header.version !== 5) throw new SessionFormatError('expected format v5 header')
  assertReleasedV4Header({ ...header, version: 4 })
}

/**
 * Validate current V5 data using the installed event and message vocabulary.
 * @param artifact - V5 logical header and event stream.
 * @param knownEventTypes - event types understood by the installed Session package.
 * @returns the same V5 data after released V4 relationship checks and current Session validation.
 */
export function restoreReleasedV5Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertReleasedV5Header(artifact.header)
  const v4 = restoreReleasedV4Artifact({ ...artifact, header: { ...artifact.header, version: 4 } }, knownEventTypes)
  const restored = { ...v4, header: artifact.header }
  if (restored.header.version !== SESSION_FORMAT_VERSION) throw new SessionFormatError('installed Session writer is not V5')
  return restored
}

/** Adjacent migration retains every V4 event and inherited cut at its original position. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5', fromVersion: 4, toVersion: 5,
  migrateHeader(header: SessionFormatHeader) {
    assertReleasedV4Header(header)
    const migrated = { ...header, version: 5 }
    assertReleasedV5Header(migrated)
    return migrated
  },
  createStage(input: SessionFormatMigrationStageInput) { return new V4ToV5Stage(input) },
  validateTargetHeader: assertReleasedV5Header,
})

/** One-pass identity transformation for already accepted, dense V4 event data. */
class V4ToV5Stage implements SessionFormatMigrationStage {
  private nextSeq = 0
  private inherited: number | undefined

  constructor(input: SessionFormatMigrationStageInput) {
    if (input.sourceHeader.version !== 4 || input.targetHeader.version !== 5) throw new SessionFormatError('V4-to-V5 migration received mismatched headers')
    this.inherited = input.sourceInheritedEventCount ?? (input.sourceHeader.isSeeded ? undefined : 0)
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.nextSeq) throw new SessionFormatError('V4 source events must remain dense')
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data.inherited === true) {
      this.inherited = event.seq
    }
    context.emitEvent(event)
    this.nextSeq += 1
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    if (run.firstSeq !== this.nextSeq) throw new SessionFormatError('V4 source event runs must remain dense')
    context.emitRun(run)
    this.nextSeq += sessionFormatCount(run.eventCount, 'format v4 event run length')
  }

  finish(_context: SessionFormatMigrationContext): number {
    if (this.inherited === undefined) throw new SessionFormatError('Seeded V4 Session is missing its inherited event cut')
    return this.inherited
  }
}

/** V5 logical events retain the released V4 physical row encoding. */
export const releasedV5SessionFormatCodec = {
  version: 5,
  decodeHeader(value: unknown) {
    assertPhysicalVersion(value, 5)
    const v4 = releasedV4SessionFormatCodec.decodeHeader({ ...value, version: 4 })
    return { ...v4, version: 5 }
  },
  createDecoder(value: unknown, recovery: Parameters<typeof releasedV4SessionFormatCodec.createDecoder>[1]) {
    assertPhysicalVersion(value, 5)
    const decoder = releasedV4SessionFormatCodec.createDecoder({ ...value, version: 4 }, recovery)
    return { ...decoder, header: { ...decoder.header, version: 5 } }
  },
  encodeHeader(header: SessionFormatHeader, inheritedEventCount: number) {
    assertReleasedV5Header(header)
    const v4 = releasedV4SessionFormatCodec.encodeHeader({ ...header, version: 4 }, inheritedEventCount)
    return { ...v4, version: 5 }
  },
  encodeEvent(event: SessionFormatEvent) { return releasedV4SessionFormatCodec.encodeEvent(event) },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder

function assertPhysicalVersion(value: unknown, version: number): asserts value is import('@deepseek-ai/dsh-session-format').SessionFormatJsonObject {
  if (!isSessionFormatJsonObject(value) || value.version !== version) throw new SessionFormatError(`expected format v${String(version)} physical header`)
}
