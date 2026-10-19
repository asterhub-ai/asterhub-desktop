import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import type { ExecutionSourceEvent } from "./execution-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function assertCanonicalUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new TypeError(`${name} must be a canonical lowercase UUID.`);
}

export function executionUnitUid(
  project_uid: string,
  session_uid: string,
  initiator_event_uid: string,
  first_tool_call_event_uid: string,
): string {
  assertCanonicalUuid(project_uid, "project_uid");
  assertCanonicalUuid(session_uid, "session_uid");
  assertCanonicalUuid(initiator_event_uid, "initiator_event_uid");
  assertCanonicalUuid(first_tool_call_event_uid, "first_tool_call_event_uid");
  return uuidV5FromParts([
    "anima.execution-unit",
    "v1",
    project_uid,
    session_uid,
    initiator_event_uid,
    first_tool_call_event_uid,
  ]);
}
export function executionReviewCandidateUid(execution_uid: string, source_fingerprint: string): string {
  assertCanonicalUuid(execution_uid, "execution_uid");
  if (typeof source_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(source_fingerprint)) {
    throw new TypeError("source_fingerprint must be a lowercase 64-hex string.");
  }
  return uuidV5FromParts([
    "anima.execution-review-candidate",
    "v1",
    execution_uid,
    source_fingerprint,
  ]);
}
export function executionReviewUid(candidate_uid: string, prompt_contract_version: string, response_fingerprint: string): string {
  assertCanonicalUuid(candidate_uid, "candidate_uid");
  if (typeof prompt_contract_version !== "string" || prompt_contract_version.length === 0) throw new TypeError("prompt_contract_version must be non-empty.");
  if (typeof response_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(response_fingerprint)) throw new TypeError("response_fingerprint must be a lowercase 64-hex string.");
  return uuidV5FromParts(["anima.execution-review", "v1", candidate_uid, prompt_contract_version, response_fingerprint]);
}

export function executionSourceFingerprint(
  project_uid: string,
  session_uid: string,
  events: readonly ExecutionSourceEvent[],
): string {
  assertCanonicalUuid(project_uid, "project_uid");
  assertCanonicalUuid(session_uid, "session_uid");
  for (const event of events) {
    if (typeof event.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(event.fingerprint)) throw new TypeError("event fingerprints must be lowercase 64-hex strings.");
  }
  const value = [
    "anima.execution-source",
    "v1",
    project_uid,
    session_uid,
    events.map((event) => [event.event_uid, event.ingest_sequence, event.fingerprint]),
  ];
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
