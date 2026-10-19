import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import {
  EXECUTION_REVIEW_INPUT_PROJECTION_VERSION,
  type ExecutionReviewCandidateWorkflow,
  type ExecutionReviewModelEvent,
  type ExecutionReviewModelInput,
  type ReviewCandidateSourceEvent,
} from "./execution-review-types.ts";
import { ExecutionReviewValidationError } from "./execution-review-types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_EVENT_BYTES = 4096;
const MAX_TOTAL_BYTES = 65536;
const REDACTION = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sourceFailure(message: string): never {
  throw new ExecutionReviewValidationError(message);
}
function redact(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, REDACTION)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, REDACTION)
    .replace(/\b(?:api[_ -]?key|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, (match) => {
      const separator = match.match(/\s*[:=]\s*/)?.[0] ?? "=";
      return match.slice(0, match.length - (match.match(/(?:"[^"]*"|'[^']*'|[^\s,;]+)$/)?.[0].length ?? 0)) + REDACTION;
    });
}
function utf8Prefix(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return { text: value, truncated: false };
  const suffixBytes = Buffer.byteLength(TRUNCATED, "utf8");
  const limit = Math.max(0, maxBytes - suffixBytes);
  let result = "";
  let used = 0;
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (used + size > limit) break;
    result += codePoint;
    used += size;
  }
  if (Buffer.byteLength(result + TRUNCATED, "utf8") <= maxBytes) return { text: result + TRUNCATED, truncated: true };
  return { text: result, truncated: true };
}
function eventText(properties: Record<string, unknown>): string {
  const raw = properties.content_parts_json;
  if (typeof raw !== "string") sourceFailure("RawEvent content_parts_json is missing.");
  let parts: unknown;
  try {
    parts = JSON.parse(raw);
  } catch {
    sourceFailure("RawEvent content_parts_json is malformed.");
  }
  if (!Array.isArray(parts)) sourceFailure("RawEvent content_parts_json is malformed.");
  const texts: string[] = [];
  for (const part of parts) {
    if (!record(part)) sourceFailure("RawEvent content part is malformed.");
    if (part.type === "text") {
      if (typeof part.text !== "string") sourceFailure("RawEvent text content is malformed.");
      texts.push(part.text);
    }
  }
  return texts.join("");
}
function projectionEvent(event: ReviewCandidateSourceEvent): ExecutionReviewModelEvent {
  const properties = event.properties;
  const projected: ExecutionReviewModelEvent = {
    event_uid: event.event_uid,
    kind: event.kind,
    position: event.position,
    role: event.role,
  };
  if (event.outcome !== undefined) projected.outcome = event.outcome;
  if (event.message_origin !== undefined) projected.message_origin = event.message_origin;
  if (event.tool_name !== undefined) projected.tool_name = event.tool_name;
  if (event.result_of_event_uid !== undefined) projected.result_of_event_uid = event.result_of_event_uid;
  if (event.boundary_type !== undefined) projected.boundary_type = event.boundary_type;
  if (event.turn_index !== undefined) projected.turn_index = event.turn_index;
  if (event.turn_end_status !== undefined) projected.turn_end_status = event.turn_end_status;
  const content = redact(eventText(properties));
  const eventLimit = utf8Prefix(content, MAX_EVENT_BYTES);
  if (eventLimit.text.length > 0) projected.content = eventLimit.text;
  if (eventLimit.truncated) projected.content_omitted = false;
  return projected;
}

export function buildExecutionReviewModelInput(candidate: ExecutionReviewCandidateWorkflow, sourceEvents: readonly ReviewCandidateSourceEvent[]): ExecutionReviewModelInput {
  if (!record(candidate) || !UUID.test(candidate.candidate_uid) || !UUID.test(candidate.execution_uid) || !UUID.test(candidate.project_uid) || !UUID.test(candidate.session_uid) || !UUID.test(candidate.candidate_uid)) sourceFailure("Candidate identity is malformed.");
  if (typeof candidate.source_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(candidate.source_fingerprint)) sourceFailure("Candidate source fingerprint is malformed.");
  const ordered = [...sourceEvents].sort((left, right) => left.position - right.position);
  const seen = new Set<string>();
  const events: ExecutionReviewModelEvent[] = [];
  let totalBytes = 0;
  let omitRest = false;
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]!.position !== index) sourceFailure("Candidate evidence positions are incomplete.");
  }
  for (const event of ordered) {
    if (!UUID.test(event.event_uid) || !Number.isSafeInteger(event.position) || event.position < 0 || seen.has(event.event_uid)) sourceFailure("Candidate evidence is malformed.");
    seen.add(event.event_uid);
    const projected = projectionEvent(event);
    if (omitRest) {
      delete projected.content;
      projected.content_omitted = true;
    } else if (projected.content !== undefined) {
      const bytes = Buffer.byteLength(projected.content, "utf8");
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        const remaining = MAX_TOTAL_BYTES - totalBytes;
        if (remaining > 0) {
          const limited = utf8Prefix(projected.content, remaining);
          projected.content = limited.text;
          projected.content_omitted = true;
          totalBytes += Buffer.byteLength(limited.text, "utf8");
        } else {
          delete projected.content;
          projected.content_omitted = true;
        }
        omitRest = true;
      } else {
        totalBytes += bytes;
      }
    }
    events.push(projected);
  }
  const withoutFingerprint = {
    input_projection_version: EXECUTION_REVIEW_INPUT_PROJECTION_VERSION,
    candidate_uid: candidate.candidate_uid,
    execution_uid: candidate.execution_uid,
    project_uid: candidate.project_uid,
    session_uid: candidate.session_uid,
    review_contract_version: candidate.review_contract_version,
    execution_state: candidate.execution_state,
    terminal_reason: candidate.terminal_reason,
    source_fingerprint: candidate.source_fingerprint,
    tool_call_count: candidate.tool_call_count,
    tool_result_count: candidate.tool_result_count,
    tool_error_count: candidate.tool_error_count,
    events,
  };
  const input_fingerprint = createHash("sha256").update(canonicalize(withoutFingerprint as never), "utf8").digest("hex");
  return { ...withoutFingerprint, input_fingerprint };
}
export const projectExecutionReviewInput = buildExecutionReviewModelInput;
