import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import { BOUNDARY_PROJECTOR_VERSION } from "./version.ts";

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertCanonicalUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a canonical lowercase UUID.`);
  }
}
function assertBoundaryWindowStartIngestSequence(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("start_ingest_sequence must be a safe nonnegative integer.");
  }
}

export function boundaryCursorUid(session_uid: string): string {
  assertCanonicalUuid(session_uid, "session_uid");
  return uuidV5FromParts(["anima.memory-cursor", "v1", BOUNDARY_PROJECTOR_VERSION, session_uid]);
}

export function boundaryWindowUid(project_uid: string, session_uid: string, start_ingest_sequence: number): string {
  assertCanonicalUuid(project_uid, "project_uid");
  assertCanonicalUuid(session_uid, "session_uid");
  assertBoundaryWindowStartIngestSequence(start_ingest_sequence);
  return uuidV5FromParts([
    "anima.boundary-window",
    "v1",
    BOUNDARY_PROJECTOR_VERSION,
    project_uid,
    session_uid,
    start_ingest_sequence,
  ]);
}

export function sessionContinuationDecisionUid(
  project_uid: string,
  session_uid: string,
  previous_session_uid: string,
  checkpoint_event_uid: string,
): string {
  assertCanonicalUuid(project_uid, "project_uid");
  assertCanonicalUuid(session_uid, "session_uid");
  assertCanonicalUuid(previous_session_uid, "previous_session_uid");
  assertCanonicalUuid(checkpoint_event_uid, "checkpoint_event_uid");
  return uuidV5FromParts([
    "anima.session-continuation",
    "v1",
    project_uid,
    session_uid,
    previous_session_uid,
    checkpoint_event_uid,
  ]);
}
