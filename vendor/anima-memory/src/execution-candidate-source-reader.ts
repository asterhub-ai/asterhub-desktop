import neo4j from "neo4j-driver";
import { projectExecutionReviewCandidates, ExecutionReviewCandidateProjectorError } from "./execution-review-candidate-projector.ts";
import type { ExecutionReviewCandidateSnapshot } from "./execution-review-candidate-types.ts";
import type { ExecutionRole, ExecutionSourceEvent, ExecutionUnitSnapshot } from "./execution-types.ts";
import type { MaterializeExecutionUnitsInput } from "./types.ts";

export interface ExecutionCandidateSourceReaderTransaction {
  run(query: string, parameters?: Record<string, unknown>): Promise<ExecutionCandidateSourceReaderQueryResult>;
}

export interface ExecutionCandidateSourceReaderQueryRecord {
  get(key: string): unknown;
}

export interface ExecutionCandidateSourceReaderQueryResult {
  records: ExecutionCandidateSourceReaderQueryRecord[];
}

export type ExecutionCandidateSourceReaderDomainCode = "invalid_input" | "not_found" | "source_incomplete" | "identity_conflict";

export interface ExecutionCandidateSourceReaderInput {
  transaction: ExecutionCandidateSourceReaderTransaction;
  candidate_uid: string;
  readExecutionSource: (
    transaction: ExecutionCandidateSourceReaderTransaction,
    input: Pick<MaterializeExecutionUnitsInput, "project_uid" | "session_uid">,
  ) => Promise<ExecutionSourceEvent[]>;
  readRequestedExecutionUnits: (
    transaction: ExecutionCandidateSourceReaderTransaction,
    input: Pick<MaterializeExecutionUnitsInput, "project_uid" | "session_uid">,
    candidateExecutionUids: readonly string[],
  ) => Promise<ExecutionUnitSnapshot[]>;
  domain: (code: ExecutionCandidateSourceReaderDomainCode, message?: string) => Error;
}

type ExecutionMessageRole = "user" | "assistant" | "developer" | "system" | "unknown";

const CANDIDATE_BASE_KEYS = [
  "candidate_uid", "execution_uid", "project_uid", "session_uid", "review_contract_version",
  "execution_state", "terminal_reason", "source_fingerprint", "tool_call_count",
  "tool_result_count", "tool_error_count", "state", "created_at",
] as const;
const CANDIDATE_WORKFLOW_KEYS = {
  ready: [],
  leased: ["lease_owner", "lease_token", "lease_until", "leased_at"],
  reviewed: ["reviewed_at"],
  skipped: ["reviewed_at", "skip_reason"],
} as const;


function exactStringKeys(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || actual.some((key) => typeof key !== "string")) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validSkipReason(value: unknown): value is "no_reusable_content" | "duplicate_low_value" | "insufficient_interpretation" {
  return value === "no_reusable_content" || value === "duplicate_low_value" || value === "insufficient_interpretation";
}

function validCandidateWorkflow(candidate: Record<string, unknown>, state: keyof typeof CANDIDATE_WORKFLOW_KEYS): boolean {
  if (!nonemptyString(candidate.created_at)) return false;
  if (state === "leased") {
    return nonemptyString(candidate.lease_owner) &&
      canonicalUuid(candidate.lease_token) &&
      nonemptyString(candidate.lease_until) &&
      nonemptyString(candidate.leased_at);
  }
  if (state === "reviewed") return nonemptyString(candidate.reviewed_at);
  if (state === "skipped") return nonemptyString(candidate.reviewed_at) && validSkipReason(candidate.skip_reason);
  return true;
}

export type ExecutionCandidateSourceEvent = Omit<ExecutionSourceEvent, "role"> & {
  position: number;
  role: ExecutionRole | ExecutionMessageRole;
  topology_role: ExecutionRole;
  message_origin?: "external_user" | "runtime_synthetic" | null;
  outcome?: "success" | "error" | "cancelled" | "unknown";
  result_of_event_uid?: string | null;
  boundary_type?: "checkpoint" | "compact" | "shutdown" | "validation" | "unknown";
  turn_index?: number;
  turn_end_status?: "nonterminal" | "final_reply" | "cancelled";
  properties: Record<string, unknown>;
};

export interface ExecutionCandidateSource {
  candidate: ExecutionReviewCandidateSnapshot;
  execution: ExecutionUnitSnapshot;
  events: readonly ExecutionCandidateSourceEvent[];
}

interface NodeProperties {
  [key: string]: unknown;
}

function field(record: ExecutionCandidateSourceReaderQueryRecord | undefined, key: string): unknown {
  if (record === undefined) return undefined;
  try {
    return record.get(key);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function numberValue(value: unknown): number | undefined {
  if (neo4j.isInt(value)) {
    const number = value.toNumber();
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fail(input: ExecutionCandidateSourceReaderInput, code: ExecutionCandidateSourceReaderDomainCode, message: string): never {
  throw input.domain(code, message);
}

export async function readExecutionCandidateSource(input: ExecutionCandidateSourceReaderInput): Promise<ExecutionCandidateSource> {
  const { transaction, candidate_uid } = input;
  const candidateCheck = await transaction.run(
    `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
     OPTIONAL MATCH (event:RawEvent)-[reverse:EVIDENCED_BY]->(c)
     RETURN c.state AS state, count(reverse) AS reverse_count`,
    { candidate_uid },
  );
  if (candidateCheck.records.length !== 1) fail(input, "not_found", "Requested Capture entity was not found.");
  const candidateState = field(candidateCheck.records[0], "state");
  if (candidateState !== "ready" && candidateState !== "leased" && candidateState !== "reviewed" && candidateState !== "skipped" && candidateState !== "rejected") {
    fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  }
  if (candidateState === "rejected" || numberValue(field(candidateCheck.records[0], "reverse_count")) !== 0) {
    fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  }
  const candidateResult = await transaction.run(
    `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
     RETURN labels(c) AS labels, keys(c) AS keys,
            {candidate_uid: c.candidate_uid, execution_uid: c.execution_uid,
             project_uid: c.project_uid, session_uid: c.session_uid,
             review_contract_version: c.review_contract_version,
             execution_state: c.execution_state, terminal_reason: c.terminal_reason,
             source_fingerprint: c.source_fingerprint,
             tool_call_count: c.tool_call_count, tool_result_count: c.tool_result_count,
             tool_error_count: c.tool_error_count, state: c.state,
             created_at: toString(c.created_at), lease_owner: c.lease_owner,
             lease_token: c.lease_token, lease_until: toString(c.lease_until),
             leased_at: toString(c.leased_at), reviewed_at: toString(c.reviewed_at),
             skip_reason: c.skip_reason} AS properties`,
    { candidate_uid },
  );
  if (candidateResult.records.length !== 1) fail(input, "not_found", "Requested Capture entity was not found.");
  const candidateRecord = candidateResult.records[0]!;
  const candidateLabels = field(candidateRecord, "labels");
  const candidateKeys = field(candidateRecord, "keys");
  const candidateProperties = field(candidateRecord, "properties");
  if (!Array.isArray(candidateLabels) || candidateLabels.length !== 1 || candidateLabels[0] !== "ExecutionReviewCandidate" || !isRecord(candidateProperties)) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  if (candidateState !== "ready" && candidateState !== "leased" && candidateState !== "reviewed" && candidateState !== "skipped") fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  const expectedCandidateKeys = [...CANDIDATE_BASE_KEYS, ...CANDIDATE_WORKFLOW_KEYS[candidateState]];
  if (!exactStringKeys(candidateKeys, expectedCandidateKeys)) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  const candidate = {
    candidate_uid: candidateProperties.candidate_uid,
    execution_uid: candidateProperties.execution_uid,
    project_uid: candidateProperties.project_uid,
    session_uid: candidateProperties.session_uid,
    review_contract_version: candidateProperties.review_contract_version,
    execution_state: candidateProperties.execution_state,
    terminal_reason: candidateProperties.terminal_reason,
    source_fingerprint: candidateProperties.source_fingerprint,
    tool_call_count: numberValue(candidateProperties.tool_call_count) ?? -1,
    tool_result_count: numberValue(candidateProperties.tool_result_count) ?? -1,
    tool_error_count: numberValue(candidateProperties.tool_error_count) ?? -1,
    state: candidateState,
    created_at: candidateProperties.created_at,
    ...(candidateState === "leased" ? {
      lease_owner: candidateProperties.lease_owner,
      lease_token: candidateProperties.lease_token,
      lease_until: candidateProperties.lease_until,
      leased_at: candidateProperties.leased_at,
    } : {}),
    ...(candidateState === "reviewed" || candidateState === "skipped" ? { reviewed_at: candidateProperties.reviewed_at } : {}),
    ...(candidateState === "skipped" ? { skip_reason: candidateProperties.skip_reason } : {}),
  } as unknown as ExecutionReviewCandidateSnapshot;
  if (
    candidateProperties.state !== candidateState ||
    candidate.candidate_uid !== candidate_uid ||
    !canonicalUuid(candidate.candidate_uid) ||
    !canonicalUuid(candidate.execution_uid) ||
    !canonicalUuid(candidate.project_uid) ||
    !canonicalUuid(candidate.session_uid) ||
    candidate.review_contract_version !== "v1" ||
    (candidate.execution_state !== "completed" && candidate.execution_state !== "cancelled" && candidate.execution_state !== "interrupted") ||
    (candidate.terminal_reason !== "final_reply" && candidate.terminal_reason !== "user_cancelled" && candidate.terminal_reason !== "session_shutdown" && candidate.terminal_reason !== "session_compact") ||
    typeof candidate.source_fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(candidate.source_fingerprint) ||
    !Number.isSafeInteger(numberValue(candidate.tool_call_count)) ||
    !Number.isSafeInteger(numberValue(candidate.tool_result_count)) ||
    !Number.isSafeInteger(numberValue(candidate.tool_error_count)) ||
    !validCandidateWorkflow(candidate as unknown as Record<string, unknown>, candidateState)
  ) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");

  const ownerResult = await transaction.run(
    `MATCH (owner:ExecutionUnit)-[r:HAS_REVIEW_CANDIDATE]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
     RETURN labels(owner) AS labels, properties(owner) AS properties, properties(r) AS relation`,
    { candidate_uid },
  );
  const targetResult = await transaction.run(
    `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[r:REVIEWS]->(target:ExecutionUnit)
     RETURN labels(target) AS labels, properties(target) AS properties, properties(r) AS relation`,
    { candidate_uid },
  );
  if (ownerResult.records.length !== 1 || targetResult.records.length !== 1) fail(input, "source_incomplete", "Capture source is incomplete.");
  const ownerRecord = ownerResult.records[0]!;
  const targetRecord = targetResult.records[0]!;
  const ownerLabels = field(ownerRecord, "labels");
  const targetLabels = field(targetRecord, "labels");
  const ownerProperties = field(ownerRecord, "properties");
  const targetProperties = field(targetRecord, "properties");
  const ownerRelation = field(ownerRecord, "relation");
  const targetRelation = field(targetRecord, "relation");
  if (
    !Array.isArray(ownerLabels) || ownerLabels.length !== 1 || ownerLabels[0] !== "ExecutionUnit" ||
    !Array.isArray(targetLabels) || targetLabels.length !== 1 || targetLabels[0] !== "ExecutionUnit" ||
    !isRecord(ownerProperties) || !isRecord(targetProperties) || !isRecord(ownerRelation) || !isRecord(targetRelation) ||
    !exactKeys(ownerRelation, ["schema_id"]) || ownerRelation.schema_id !== "anima.execution-review-candidate-link/v1.0" ||
    !exactKeys(targetRelation, ["schema_id"]) || targetRelation.schema_id !== "anima.execution-review-target/v1.0" ||
    ownerProperties.execution_uid !== candidate.execution_uid || targetProperties.execution_uid !== candidate.execution_uid ||
    ownerProperties.project_uid !== candidate.project_uid || targetProperties.project_uid !== candidate.project_uid ||
    ownerProperties.session_uid !== candidate.session_uid || targetProperties.session_uid !== candidate.session_uid ||
    ownerProperties.source_fingerprint !== candidate.source_fingerprint || targetProperties.source_fingerprint !== candidate.source_fingerprint
  ) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");

  const evidenceResult = await transaction.run(
    `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[r:EVIDENCED_BY]->(event:RawEvent)
     RETURN labels(event) AS labels, properties(event) AS event, properties(r) AS relation`,
    { candidate_uid },
  );
  if (evidenceResult.records.length !== Number(candidateProperties.event_count ?? targetProperties.event_count ?? evidenceResult.records.length)) {
    if (evidenceResult.records.length === 0) fail(input, "source_incomplete", "Capture source is incomplete.");
  }
  const evidenceByPosition = new Map<number, { event_uid: string; role: ExecutionRole; properties: NodeProperties }>();
  for (const record of evidenceResult.records) {
    const labels = field(record, "labels");
    const event = field(record, "event");
    const relation = field(record, "relation");
    if (!Array.isArray(labels) || !isRecord(event) || !isRecord(relation) || !exactKeys(relation, ["schema_id", "position", "role"]) || relation.schema_id !== "anima.execution-review-evidence/v1.0" || !canonicalUuid(event.event_uid) || !Number.isSafeInteger(numberValue(relation.position)) || !["initiator", "first_tool_call", "member", "terminal"].includes(String(relation.role))) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
    const position = numberValue(relation.position)!;
    if (evidenceByPosition.has(position)) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
    evidenceByPosition.set(position, { event_uid: event.event_uid, role: relation.role as ExecutionRole, properties: event });
  }
  const eventCount = numberValue(targetProperties.event_count);
  if (eventCount === undefined || eventCount < 2 || evidenceByPosition.size !== eventCount) fail(input, "source_incomplete", "Capture source is incomplete.");
  const source = await input.readExecutionSource(transaction, { project_uid: candidate.project_uid, session_uid: candidate.session_uid });
  const sourceByUid = new Map(source.map((event) => [event.event_uid, event]));
  const orderedEvidence = [...evidenceByPosition.entries()].sort((left, right) => left[0] - right[0]);
  if (orderedEvidence.some(([position, item], index) => position !== index || sourceByUid.get(item.event_uid) === undefined)) fail(input, "source_incomplete", "Capture source is incomplete.");
  const executions = await input.readRequestedExecutionUnits(transaction, { project_uid: candidate.project_uid, session_uid: candidate.session_uid }, [candidate.execution_uid]);
  if (executions.length !== 1) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  const execution = executions[0]!;
  const events: ExecutionCandidateSourceEvent[] = orderedEvidence.map(([, evidence], position) => {
    const sourceEvent = sourceByUid.get(evidence.event_uid)!;
    return {
      ...sourceEvent,
      position,
      role: sourceEvent.kind === "message" ? sourceEvent.role : evidence.role,
      topology_role: evidence.role,
      properties: evidence.properties,
    };
  });
  if (
    execution.execution_uid !== candidate.execution_uid ||
    execution.source_fingerprint !== candidate.source_fingerprint ||
    execution.event_count !== eventCount ||
    events.some((event, position) => execution.ordered_event_uids[position] !== event.event_uid || execution.contains_roles[position] !== event.topology_role)
  ) fail(input, "identity_conflict", "Memory identity or provenance conflicts with Capture.");
  try {
    projectExecutionReviewCandidates({
      project_uid: candidate.project_uid,
      session_uid: candidate.session_uid,
      events: source,
      execution_units: [execution],
      existing_candidates: [candidate],
    });
  } catch (error: unknown) {
    if (error instanceof ExecutionReviewCandidateProjectorError) throw input.domain(error.code, error.message);
    throw error;
  }
  return { candidate, execution, events };
}
