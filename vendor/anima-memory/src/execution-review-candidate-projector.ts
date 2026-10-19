import { canonicalize } from "json-canonicalize";
import { executionReviewCandidateUid, executionSourceFingerprint, executionUnitUid } from "./execution-ids.ts";
import {
  type ExecutionRole,
  type ExecutionSourceEvent,
  type ExecutionTerminalReason,
  type ExecutionUnitSnapshot,
} from "./execution-types.ts";
import {
  REVIEW_CONTRACT_VERSION,
  type ExecutionReviewCandidateProjectorErrorCode,
  type ExecutionReviewCandidateSnapshot,
  type ExecutionReviewCandidatePlan,
  type ProjectExecutionReviewCandidatesInput,
  type ProjectExecutionReviewCandidatesPlan,
  type ExecutionReviewEvidenceLinkPlan,
  ExecutionReviewCandidateProjectorError,
} from "./execution-review-candidate-types.ts";
export { ExecutionReviewCandidateProjectorError } from "./execution-review-candidate-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_COMMON_KEYS = ["event_uid", "project_uid", "session_uid", "ingest_sequence", "fingerprint", "kind"] as const;
const SOURCE_KIND_KEYS = {
  message: ["role", "message_origin"],
  tool_call: [],
  tool_result: ["outcome", "result_of_event_uid"],
  boundary: ["boundary_type"],
  turn_end: ["turn_index", "turn_end_status"],
} as const;
const UNIT_KEYS = [
  "execution_uid", "project_uid", "session_uid", "initiator_kind", "initiator_event_uid", "first_tool_call_event_uid",
  "start_ingest_sequence", "end_ingest_sequence", "event_count", "state", "source_fingerprint", "ordered_event_uids",
  "contains_roles", "initiated_by_event_uid", "finalized_by_event_uid", "terminal_reason", "terminal_event_uid",
] as const;
const CANDIDATE_KEYS = [
  "candidate_uid", "execution_uid", "project_uid", "session_uid", "review_contract_version", "execution_state",
  "terminal_reason", "source_fingerprint", "tool_call_count", "tool_result_count", "tool_error_count", "state",
] as const;
const CANDIDATE_WORKFLOW_KEYS = [
  "lease_owner", "lease_token", "lease_until", "leased_at", "reviewed_at", "skip_reason", "rejection_reason",
] as const;
const CANDIDATE_KEYS_WITH_CREATED_AT = [...CANDIDATE_KEYS, "created_at"] as const;

function fail(code: ExecutionReviewCandidateProjectorErrorCode, message: string): never {
  throw new ExecutionReviewCandidateProjectorError(code, message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function equal(left: unknown, right: unknown): boolean {
  return canonicalize(left as never) === canonicalize(right as never);
}
function candidateProjected(candidate: ExecutionReviewCandidateSnapshot): Omit<ExecutionReviewCandidateSnapshot, "state" | "created_at" | "lease_owner" | "lease_token" | "lease_until" | "leased_at" | "reviewed_at" | "skip_reason" | "rejection_reason"> {
  const {
    state: _state,
    created_at: _created_at,
    lease_owner: _lease_owner,
    lease_token: _lease_token,
    lease_until: _lease_until,
    leased_at: _leased_at,
    reviewed_at: _reviewed_at,
    skip_reason: _skip_reason,
    rejection_reason: _rejection_reason,
    ...projected
  } = candidate;
  return projected;
}
function expectedState(reason: ExecutionTerminalReason): ExecutionReviewCandidateSnapshot["execution_state"] {
  if (reason === "final_reply") return "completed";
  if (reason === "user_cancelled") return "cancelled";
  return "interrupted";
}
function expectedReason(event: ExecutionSourceEvent): ExecutionTerminalReason | undefined {
  if (event.kind === "turn_end" && event.turn_end_status === "final_reply") return "final_reply";
  if (event.kind === "turn_end" && event.turn_end_status === "cancelled") return "user_cancelled";
  if (event.kind === "boundary" && event.boundary_type === "compact") return "session_compact";
  if (event.kind === "boundary" && event.boundary_type === "shutdown") return "session_shutdown";
  return undefined;
}

function validateSourceEvent(value: unknown, project_uid: string, session_uid: string, expectedSequence: number): ExecutionSourceEvent {
  if (!isRecord(value)) fail("invalid_input", "Execution source event is malformed.");
  const kind = value.kind;
  if (kind !== "message" && kind !== "tool_call" && kind !== "tool_result" && kind !== "boundary" && kind !== "turn_end") {
    fail("invalid_input", "Execution source event kind is invalid.");
  }
  if (!exactKeys(value, [...SOURCE_COMMON_KEYS, ...SOURCE_KIND_KEYS[kind]])) fail("invalid_input", "Execution source event contains unsupported fields.");
  if (!canonicalUuid(value.event_uid) || !canonicalUuid(value.project_uid) || !canonicalUuid(value.session_uid)) fail("invalid_input", "Execution source event identity is malformed.");
  if (value.project_uid !== project_uid || value.session_uid !== session_uid) fail("identity_conflict", "Execution source event ownership conflicts.");
  if (!safeInteger(value.ingest_sequence) || value.ingest_sequence < 0 || value.ingest_sequence !== expectedSequence) fail("source_incomplete", "Execution source ingest sequence is not contiguous.");
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) fail("invalid_input", "Execution source fingerprint is malformed.");
  if (kind === "message") {
    if (!(value.role === "user" || value.role === "assistant" || value.role === "developer" || value.role === "system" || value.role === "unknown")) fail("invalid_input", "Execution message role is invalid.");
    if (!(value.message_origin === null || value.message_origin === "external_user" || value.message_origin === "runtime_synthetic")) fail("invalid_input", "Execution message origin is invalid.");
    if (value.message_origin !== null && value.role !== "user") fail("invalid_input", "Only user messages may carry an origin.");
  } else if (kind === "tool_result") {
    if (!(value.outcome === "success" || value.outcome === "error" || value.outcome === "cancelled" || value.outcome === "unknown")) fail("invalid_input", "Execution tool-result outcome is invalid.");
    if (value.result_of_event_uid !== null && !canonicalUuid(value.result_of_event_uid)) fail("invalid_input", "Execution result correlation identity is malformed.");
  } else if (kind === "turn_end") {
    if (!safeInteger(value.turn_index) || value.turn_index < 0 || !(value.turn_end_status === "nonterminal" || value.turn_end_status === "final_reply" || value.turn_end_status === "cancelled")) fail("invalid_input", "Execution turn-end fields are invalid.");
  } else if (kind === "boundary" && !(value.boundary_type === "checkpoint" || value.boundary_type === "compact" || value.boundary_type === "shutdown" || value.boundary_type === "validation" || value.boundary_type === "unknown")) {
    fail("invalid_input", "Execution boundary fields are invalid.");
  }
  return value as unknown as ExecutionSourceEvent;
}

function validateUnit(value: unknown, project_uid: string, session_uid: string): ExecutionUnitSnapshot {
  if (!isRecord(value) || !exactKeys(value, UNIT_KEYS)) fail("invalid_input", "Execution snapshot contains unsupported fields.");
  for (const key of ["execution_uid", "project_uid", "session_uid", "initiator_event_uid", "first_tool_call_event_uid", "initiated_by_event_uid"] as const) {
    if (!canonicalUuid(value[key])) fail("invalid_input", "Execution snapshot identity is malformed.");
  }
  if (value.project_uid !== project_uid || value.session_uid !== session_uid) fail("identity_conflict", "Execution snapshot ownership conflicts.");
  if (value.initiator_kind !== "user_request" || !safeInteger(value.start_ingest_sequence) || value.start_ingest_sequence < 0 || !safeInteger(value.end_ingest_sequence) || !safeInteger(value.event_count)) fail("invalid_input", "Execution snapshot range is invalid.");
  if (value.end_ingest_sequence < value.start_ingest_sequence || value.event_count < 2 || value.end_ingest_sequence - value.start_ingest_sequence + 1 !== value.event_count) fail("identity_conflict", "Execution snapshot range conflicts with its topology.");
  if (typeof value.source_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.source_fingerprint)) fail("invalid_input", "Execution snapshot fingerprint is malformed.");
  if (!Array.isArray(value.ordered_event_uids) || !Array.isArray(value.contains_roles) || value.ordered_event_uids.length !== value.event_count || value.contains_roles.length !== value.event_count) fail("identity_conflict", "Execution snapshot event topology conflicts with its range.");
  if (value.ordered_event_uids.some((uid) => !canonicalUuid(uid)) || value.contains_roles.some((role) => role !== "initiator" && role !== "first_tool_call" && role !== "member" && role !== "terminal")) fail("invalid_input", "Execution snapshot event topology is malformed.");
  const firstToolCallPosition = value.contains_roles.indexOf("first_tool_call");
  if (value.contains_roles[0] !== "initiator" || firstToolCallPosition < 1 || value.ordered_event_uids[firstToolCallPosition] !== value.first_tool_call_event_uid || value.initiator_event_uid !== value.initiated_by_event_uid) fail("identity_conflict", "Execution snapshot initiator topology conflicts.");
  if (value.finalized_by_event_uid !== null && !canonicalUuid(value.finalized_by_event_uid)) fail("invalid_input", "Execution snapshot terminal identity is malformed.");
  if (value.terminal_event_uid !== null && !canonicalUuid(value.terminal_event_uid)) fail("invalid_input", "Execution snapshot terminal identity is malformed.");
  if (value.state !== "open" && value.state !== "completed" && value.state !== "cancelled" && value.state !== "interrupted") fail("invalid_input", "Execution snapshot state is invalid.");
  if (value.state === "open") {
    if (value.finalized_by_event_uid !== null || value.terminal_reason !== null || value.terminal_event_uid !== null || value.contains_roles.includes("terminal")) fail("identity_conflict", "Open execution snapshot contains terminal fields.");
  } else {
    if (value.finalized_by_event_uid === null || value.terminal_event_uid === null || value.finalized_by_event_uid !== value.terminal_event_uid || (value.terminal_reason !== "final_reply" && value.terminal_reason !== "user_cancelled" && value.terminal_reason !== "session_compact" && value.terminal_reason !== "session_shutdown") || value.contains_roles.at(-1) !== "terminal" || value.terminal_event_uid !== value.ordered_event_uids.at(-1)) fail("identity_conflict", "Terminal execution snapshot is malformed.");
  }
  return value as unknown as ExecutionUnitSnapshot;
}

function validateCandidate(value: unknown, project_uid: string, session_uid: string): ExecutionReviewCandidateSnapshot {
  if (!isRecord(value)) fail("invalid_input", "Execution review candidate contains unsupported fields.");
  const allowedKeys = new Set<string>([...CANDIDATE_KEYS, "created_at", ...CANDIDATE_WORKFLOW_KEYS]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) fail("invalid_input", "Execution review candidate contains unsupported fields.");
  if (!canonicalUuid(value.candidate_uid) || !canonicalUuid(value.execution_uid) || !canonicalUuid(value.project_uid) || !canonicalUuid(value.session_uid)) fail("invalid_input", "Execution review candidate identity is malformed.");
  if (value.lease_owner !== undefined && typeof value.lease_owner !== "string") fail("invalid_input", "Leased candidate workflow fields are malformed.");
  if (value.lease_token !== undefined && typeof value.lease_token !== "string") fail("invalid_input", "Leased candidate workflow fields are malformed.");
  if (value.lease_until !== undefined && typeof value.lease_until !== "string") fail("invalid_input", "Leased candidate workflow fields are malformed.");
  if (value.leased_at !== undefined && typeof value.leased_at !== "string") fail("invalid_input", "Leased candidate workflow fields are malformed.");
  if (value.reviewed_at !== undefined && typeof value.reviewed_at !== "string") fail("invalid_input", "Terminal candidate workflow fields are malformed.");
  if (value.skip_reason !== undefined && value.skip_reason !== "no_reusable_content" && value.skip_reason !== "duplicate_low_value" && value.skip_reason !== "insufficient_interpretation") fail("invalid_input", "Terminal candidate workflow fields are malformed.");
  return value as unknown as ExecutionReviewCandidateSnapshot;
}

function expectedRoles(length: number, firstToolCallPosition: number): ExecutionRole[] {
  return Array.from({ length }, (_, position) => position === length - 1 ? "terminal" : position === 0 ? "initiator" : position === firstToolCallPosition ? "first_tool_call" : "member");
}

function projectCandidate(unit: ExecutionUnitSnapshot, events: readonly ExecutionSourceEvent[], project_uid: string, session_uid: string): { snapshot: ExecutionReviewCandidateSnapshot; evidence_links: readonly ExecutionReviewEvidenceLinkPlan[] } {
  if (unit.state === "open") throw new Error("open units are ignored");
  const start = unit.start_ingest_sequence;
  const end = unit.end_ingest_sequence;
  const sourceSlice = events.slice(start, end + 1);
  if (sourceSlice.length !== unit.event_count || sourceSlice.some((event, index) => event.event_uid !== unit.ordered_event_uids[index] || event.ingest_sequence !== start + index)) fail("source_incomplete", "Execution source does not cover the complete unit range.");
  if (executionSourceFingerprint(project_uid, session_uid, sourceSlice) !== unit.source_fingerprint) fail("identity_conflict", "Execution source fingerprint conflicts with ExecutionUnit.");
  const first = sourceSlice[0];
  if (first === undefined || first.kind !== "message" || first.role !== "user" || first.message_origin !== "external_user" || unit.initiator_event_uid !== first.event_uid || unit.initiated_by_event_uid !== first.event_uid) fail("identity_conflict", "Execution initiator provenance conflicts.");
  const firstToolCallPosition = sourceSlice.findIndex((event) => event.kind === "tool_call");
  if (firstToolCallPosition < 1 || sourceSlice[firstToolCallPosition]?.event_uid !== unit.first_tool_call_event_uid || unit.execution_uid !== executionUnitUid(project_uid, session_uid, first.event_uid, unit.first_tool_call_event_uid)) fail("identity_conflict", "Execution identity conflicts with source topology.");
  const roles = expectedRoles(sourceSlice.length, firstToolCallPosition);
  if (!equal(roles, unit.contains_roles)) fail("identity_conflict", "Execution role topology conflicts with source topology.");
  const terminal = sourceSlice.at(-1);
  const reason = terminal === undefined ? undefined : expectedReason(terminal);
  if (reason === undefined || unit.terminal_event_uid !== terminal?.event_uid || unit.finalized_by_event_uid !== terminal?.event_uid || unit.terminal_reason !== reason || expectedState(reason) !== unit.state) fail("identity_conflict", "Execution terminal provenance conflicts with source topology.");
  const calls = new Set(sourceSlice.filter((event) => event.kind === "tool_call").map((event) => event.event_uid));
  const settled = new Set<string>();
  let tool_result_count = 0;
  let tool_error_count = 0;
  for (const event of sourceSlice) {
    if (event.kind === "tool_result") {
      tool_result_count += 1;
      if (event.outcome === "error") tool_error_count += 1;
      if (event.result_of_event_uid !== null) {
        if (!calls.has(event.result_of_event_uid)) fail("identity_conflict", "Execution result correlation points outside the unit.");
        if (settled.has(event.result_of_event_uid)) fail("identity_conflict", "Execution result correlation settles a tool call more than once.");
        settled.add(event.result_of_event_uid);
      }
    }
  }
  if (reason === "final_reply" && settled.size !== calls.size) fail("source_incomplete", "Completed execution contains an unsettled tool call.");
  const candidate_uid = executionReviewCandidateUid(unit.execution_uid, unit.source_fingerprint);
  const snapshot: ExecutionReviewCandidateSnapshot = {
    candidate_uid,
    execution_uid: unit.execution_uid,
    project_uid,
    session_uid,
    review_contract_version: REVIEW_CONTRACT_VERSION,
    execution_state: unit.state,
    terminal_reason: reason,
    source_fingerprint: unit.source_fingerprint,
    tool_call_count: calls.size,
    tool_result_count,
    tool_error_count,
    state: "ready",
  };
  const evidence_links = sourceSlice.map((event, position) => ({ candidate_uid, event_uid: event.event_uid, position, role: roles[position]! }));
  return { snapshot, evidence_links };
}

export function projectExecutionReviewCandidates(input: ProjectExecutionReviewCandidatesInput): ProjectExecutionReviewCandidatesPlan {
  if (!isRecord(input) || !exactKeys(input, ["project_uid", "session_uid", "events", "execution_units", "existing_candidates"])) fail("invalid_input", "Execution review candidate projector input contains unsupported fields.");
  if (!canonicalUuid(input.project_uid) || !canonicalUuid(input.session_uid)) fail("invalid_input", "Execution review candidate ownership is malformed.");
  if (!Array.isArray(input.events) || !Array.isArray(input.execution_units) || !Array.isArray(input.existing_candidates)) fail("invalid_input", "Execution review candidate projector collections are invalid.");
  const events: ExecutionSourceEvent[] = [];
  const eventUids = new Set<string>();
  for (const [index, value] of input.events.entries()) {
    const event = validateSourceEvent(value, input.project_uid, input.session_uid, index);
    if (eventUids.has(event.event_uid)) fail("identity_conflict", "Execution source event identity is duplicated.");
    eventUids.add(event.event_uid);
    events.push(event);
  }
  const units = input.execution_units.map((unit) => validateUnit(unit, input.project_uid, input.session_uid));
  const unitUids = new Set<string>();
  for (const unit of units) {
    if (unitUids.has(unit.execution_uid)) fail("identity_conflict", "Execution snapshot identity is duplicated.");
    unitUids.add(unit.execution_uid);
  }
  const orderedUnits = [...units].sort((left, right) => left.start_ingest_sequence - right.start_ingest_sequence);
  for (let index = 1; index < orderedUnits.length; index += 1) {
    if (orderedUnits[index]!.start_ingest_sequence <= orderedUnits[index - 1]!.end_ingest_sequence) fail("identity_conflict", "Execution snapshots overlap in source range.");
  }
  const existing = input.existing_candidates.map((candidate) => validateCandidate(candidate, input.project_uid, input.session_uid));
  const existingByUid = new Map<string, ExecutionReviewCandidateSnapshot>();
  for (const candidate of existing) {
    if (existingByUid.has(candidate.candidate_uid)) fail("identity_conflict", "Execution review candidate identity is duplicated.");
    existingByUid.set(candidate.candidate_uid, candidate);
  }
  const expectedCandidateUids = new Set<string>();
  for (const unit of units) {
    if (unit.state !== "open") expectedCandidateUids.add(executionReviewCandidateUid(unit.execution_uid, unit.source_fingerprint));
  }
  for (const candidate of existing) {
    if (!expectedCandidateUids.has(candidate.candidate_uid)) fail("identity_conflict", "Existing execution review candidate is absent from source terminal units.");
  }
  const plans: ExecutionReviewCandidatePlan[] = [];
  for (const unit of units) {
    if (unit.state === "open") continue;
    const projected = projectCandidate(unit, events, input.project_uid, input.session_uid);
    const prior = existingByUid.get(projected.snapshot.candidate_uid);
    if (prior !== undefined) {
      if (!equal(candidateProjected(prior), candidateProjected(projected.snapshot))) fail("identity_conflict", "Existing execution review candidate conflicts with immutable projection.");
      plans.push({ node_action: "verify", before: prior, after: { ...projected.snapshot, state: prior.state }, has_review_candidate_link: null, reviews_link: null, evidence_links: [] });
    } else {
      plans.push({ node_action: "create", after: projected.snapshot, has_review_candidate_link: { candidate_uid: projected.snapshot.candidate_uid, execution_uid: unit.execution_uid }, reviews_link: { candidate_uid: projected.snapshot.candidate_uid, execution_uid: unit.execution_uid }, evidence_links: projected.evidence_links });
    }
  }
  return {
    through_ingest_sequence: events.at(-1)?.ingest_sequence ?? -1,
    candidate_plans: plans,
    candidates_created: plans.filter((plan) => plan.node_action === "create").length,
    evidence_links_created: plans.reduce((total, plan) => total + plan.evidence_links.length, 0),
  };
}
