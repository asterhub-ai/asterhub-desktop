/** Bind parent-specific child evidence into the static first-party migration inventory. */

import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalog } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCatalog, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, createSessionFormatV3ToV4, releasedV4SessionFormatCodec, restoreReleasedV4Artifact, sessionFormatV3ToV4 } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { sessionFormatCatalogOptions } from './generated.ts'

/**
 * Assemble a catalog whose V3→V4 edge knows one parent's historical children.
 * @param children - complete child evidence retained unchanged for the catalog's lifetime; an empty array declares no children.
 * @param targetVersion - optional target format generation cutoff; restricted to 4 for historical migration, or omitted for current format.
 * @returns a catalog with independent restore state per artifact and unchanged current-format readers.
 */
export function createSessionFormatCatalogWithChildren(
  children: readonly SessionFormatJsonValue[],
  targetVersion?: 4,
): SessionFormatCatalog {
  const migration = createSessionFormatV3ToV4(children)
  const migrations = sessionFormatCatalogOptions.migrations.map(edge => edge === sessionFormatV3ToV4 ? migration : edge)
  if (targetVersion === 4) {
    return createSessionFormatCatalog({
      currentVersion: targetVersion,
      codecs: sessionFormatCatalogOptions.codecs.slice(0, targetVersion + 1),
      currentEncoder: releasedV4SessionFormatCodec,
      migrations: migrations.slice(0, targetVersion),
      restoreCurrent: artifact => restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES),
      restoreTransformedCurrent: artifact => restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES),
      restoreCurrentHeader(header) {
        assertReleasedV4Header(header)
        return header
      },
    })
  }
  return createSessionFormatCatalog({
    ...sessionFormatCatalogOptions,
    migrations,
  })
}
