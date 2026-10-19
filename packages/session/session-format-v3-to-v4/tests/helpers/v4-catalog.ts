/** Frozen V4 test catalog; current production reads advance to V5. */
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalog } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { releasedV0SessionFormatCodec, sessionFormatV0ToV1 } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { releasedV1SessionFormatCodec, sessionFormatV1ToV2 } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { releasedV2SessionFormatCodec, sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import {
  assertReleasedV4Header, releasedV3SessionFormatCodec, releasedV4SessionFormatCodec,
  restoreReleasedV4Artifact, createSessionFormatV3ToV4,
} from '../../src/index.ts'

/**
 * Build the released V4 edge for specifications and fixtures that must not follow the current writer.
 * @param children - Complete V3 child evidence required by V3-to-V4 migration.
 * @returns An independent V0-to-V4 catalog with no V5 interpretation.
 */
export function v4Catalog(children: readonly SessionFormatJsonValue[] = []) {
  const migration = createSessionFormatV3ToV4(children)
  return createSessionFormatCatalog({
    currentVersion: 4,
    codecs: [releasedV0SessionFormatCodec, releasedV1SessionFormatCodec, releasedV2SessionFormatCodec,
      releasedV3SessionFormatCodec, releasedV4SessionFormatCodec],
    currentEncoder: releasedV4SessionFormatCodec,
    migrations: [sessionFormatV0ToV1, sessionFormatV1ToV2, sessionFormatV2ToV3, migration],
    restoreCurrent: artifact => restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES),
    restoreTransformedCurrent: artifact => restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES),
    restoreCurrentHeader(header) {
      assertReleasedV4Header(header)
      return header
    },
  })
}
