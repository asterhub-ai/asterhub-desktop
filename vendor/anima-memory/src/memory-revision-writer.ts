import { createHash } from "node:crypto";
import neo4j from "neo4j-driver";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import { canonicalize } from "json-canonicalize";
import {
  decideModelSaveIdentity,
  MemoryClaimIdentityError,
  type ModelSaveIdentityResult,
} from "./memory-claim-identity.ts";
import {
  MemoryGraphEvidenceError,
  readRegisteredExternalUserTextEvidence,
  readRegisteredRawEventGraph,
  type MemoryDirectEvidenceReaderTransaction,
  type RegisteredExternalUserTextEvidence,
} from "./memory-direct-evidence-reader.ts";
import {
  readRegisteredSaveToolCallEvidence,
  type NormalizedSaveArgs,
  type RegisteredSaveToolCallEvidence,
} from "./memory-tool-call-evidence.ts";
import { decodeStoredToolCall } from "./memory-event-decoder.ts";
import { verifyMemoryOperationToolCall } from "./memory-operation-tool-evidence.ts";
import { memoryOperationConfirmation } from "./memory-operation-intent.ts";
import type { MemoryOperationInput, MemoryOperationResult, ProjectMemorySearchResult } from "./types.ts";
import type { ProjectOwnershipScope } from "./project-ownership.ts";

export type MemoryRevisionWriteErrorCode =
  | "invalid_input"
  | "identity_conflict"
  | "source_incomplete"
  | "evidence_invalid"
  | "revision_conflict"
  | "confirmation_required";

const ERROR_MESSAGES: Record<MemoryRevisionWriteErrorCode, string> = {
  invalid_input: "Memory revision input is invalid.",
  identity_conflict: "Memory identity or graph topology conflicts.",
  source_incomplete: "Required graph evidence is incomplete.",
  evidence_invalid: "External user text evidence is invalid.",
  revision_conflict: "Memory decision conflicts with an existing decision.",
  confirmation_required: "This memory subject requires user confirmation.",
};

export class MemoryRevisionWriteError extends Error {
  readonly code: MemoryRevisionWriteErrorCode;

  constructor(code: MemoryRevisionWriteErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "MemoryRevisionWriteError";
    this.code = code;
  }
}

export interface ExactSpanModelMemoryRevisionSpan {
  text_part_index: number;
  utf8_start: number;
  utf8_end: number;
  sha256: string;
}

export interface CreateExactSpanModelMemoryRevisionInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  project_uid: string;
  session_uid: string;
  event_uid: string;
  span: ExactSpanModelMemoryRevisionSpan;
  statement: string;
  decision_uid: string;
  now: string;
  /** Reauthorize a model-authored write immediately before graph mutation. */
  authorize_before_write?: () => Promise<boolean>;
  markWrite: () => void;
}

export interface CreateToolSaveMemoryRevisionInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  project_uid: string;
  session_uid: string;
  event_uid: string;
  tool_call_id: string;
  params: unknown;
  decision_uid: string;
  now: string;
  authorize_before_write?: () => Promise<boolean>;
  markWrite: () => void;
}


export interface SearchScopedCurrentMemoriesInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  project_uid: string;
  query: string;
  top_k: number;
  now: string;
}

export interface ListRecentScopedCurrentMemoriesInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  project_uid: string;
  limit: number;
  now: string;
}


export type CreateToolSaveMemoryRevisionResult = CreateExactSpanModelMemoryRevisionResult;

export interface CreateExactSpanModelMemoryRevisionResult {
  status: "written" | "duplicate";
  decision_uid: string;
  memory_uid: string;
  revision_uid: string;
}
export interface CreateMemoryOperationRevisionInput extends MemoryOperationInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  markWrite: () => void;
}
const INPUT_FIELDS = [
  "transaction", "scope", "project_uid", "session_uid", "event_uid", "span", "statement", "decision_uid", "now", "markWrite",
] as const;
const TOOL_SAVE_INPUT_FIELDS = [
  "transaction", "scope", "project_uid", "session_uid", "event_uid", "tool_call_id", "params", "decision_uid", "now", "markWrite",
] as const;
const SEARCH_INPUT_FIELDS = ["transaction", "scope", "project_uid", "query", "top_k", "now"] as const;
const LIST_RECENT_INPUT_FIELDS = ["transaction", "scope", "project_uid", "limit", "now"] as const;
const SCOPE_FIELDS = ["users_root", "directory_id", "directory", "principal_uid"] as const;
const SPAN_FIELDS = ["text_part_index", "utf8_start", "utf8_end", "sha256"] as const;
const UUID_V4_OR_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const DOMAIN_KEYS = ["domain_uid", "principal_uid", "project_uid", "subject", "model_save_suspended", "generation"] as const;
const MEMORY_KEYS = [
  "memory_uid", "lineage_uid", "domain_uid", "principal_uid", "project_uid", "subject", "claim_key", "kind", "state",
  "current_revision_uid", "revision_number", "evidence_event_uids", "created_at",
] as const;
const REVISION_KEYS = [
  "revision_uid", "memory_uid", "lineage_uid", "domain_uid", "principal_uid", "project_uid", "decision_uid", "decision_basis_sha",
  "revision_number", "statement", "kind", "reason", "epistemic_kind", "provenance", "scope", "applicability_kind", "state", "valid_from", "created_at",
] as const;
const DECISION_KEYS = ["decision_uid", "proposal_sha", "principal_uid", "project_uid", "domain_uid", "memory_uid", "revision_uid", "status", "created_at"] as const;
const MEMORY_KINDS = ["claim"] as const;
const MEMORY_STATES = ["active", "superseded", "revoked", "deleted"] as const;
const MEMORY_OPERATIONS = ["revise", "revoke", "set_expiry", "suspend", "resume"] as const;
const TOOL_SAVE_FIELDS = ["save_type", "title", "narrative", "context", "principle", "tags"] as const;
const TOOL_SAVE_REVISION_KEYS = [...REVISION_KEYS, ...TOOL_SAVE_FIELDS] as const;
const OPERATION_REVISION_KEYS = [...REVISION_KEYS, "operation", "expected_revision_uid", "operation_event_uid", "user_event_uid", "user_span_text_part_index", "user_span_utf8_start", "user_span_utf8_end", "user_span_sha256"] as const;
const OPERATION_TOOL_REVISION_KEYS = [...OPERATION_REVISION_KEYS, ...TOOL_SAVE_FIELDS] as const;
const DOMAIN_AUDIT_KEYS = [...DOMAIN_KEYS, "subject_operation_decision_uid"] as const;
const OPERATION_DECISION_BASE_KEYS = [...DECISION_KEYS, "operation", "expected_revision_uid", "operation_event_uid", "user_event_uid", "user_span_text_part_index", "user_span_utf8_start", "user_span_utf8_end", "user_span_sha256", "generation"] as const;
const OPERATION_EVENT_RELATION_KEYS = ["schema_id", "position", "evidence_kind"] as const;
const OPERATION_EVIDENCE_RELATION_KEYS = ["schema_id", "position", "evidence_kind", "text_part_index", "utf8_start", "utf8_end", "sha256"] as const;
const DOMAIN_RELATION_KEYS = ["schema_id"] as const;
const REVISION_RELATION_KEYS = ["revision_number"] as const;
const EVIDENCE_RELATION_KEYS = ["schema_id", "position", "text_part_index", "utf8_start", "utf8_end", "sha256"] as const;
const TOOL_EVIDENCE_RELATION_KEYS = ["schema_id", "position", "json_part_index", "tool_call_id", "normalized_args_sha256"] as const;
const VALID_DOMAIN_LABELS = ["MemorySubject", "Memory", "MemoryRevision", "MemoryDecision"] as const;
// Legacy type tiers break ties only after text relevance; this is not RRF fusion.
const SEARCH_TYPE_WEIGHTS = new Map([
  ["pattern", 3], ["judgment", 2.5], ["insight", 2.5], ["relationship", 2],
  ["anchor", 1.8], ["narrative", 1.2], ["experience", 1],
  ["knowledge", 0.8], ["lesson", 0.8], ["operation", 0.3],
]);

type DataRecord = Record<string, unknown>;
type GraphNode = { labels: string[]; properties: DataRecord };
type MemoryEntry = { properties: DataRecord; revisions: Map<string, DataRecord> };
type DomainState = {
  domain: DataRecord;
  memories: Map<string, MemoryEntry>;
  decisions: Map<string, DataRecord>;
};

function fail(code: MemoryRevisionWriteErrorCode): never {
  throw new MemoryRevisionWriteError(code);
}

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(value: unknown, fields: readonly string[]): DataRecord | undefined {
  if (!isRecord(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== fields.length || ownKeys.some((key) => typeof key !== "string" || !fields.includes(key))) return undefined;
  const result: DataRecord = Object.create(null) as DataRecord;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return undefined;
    result[field] = descriptor.value;
  }
  return result;
}

function exactKeys(value: unknown, fields: readonly string[]): value is DataRecord {
  if (!isRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === fields.length && ownKeys.every((key) => typeof key === "string" && fields.includes(key));
}

function recordValue(record: unknown, key: string): unknown {
  if (!isRecord(record)) return undefined;
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function records(result: unknown): Array<{ get(key: string): unknown }> {
  const found = recordValue(result, "records");
  if (!Array.isArray(found)) fail("identity_conflict");
  return found as Array<{ get(key: string): unknown }>;
}

function field(record: { get(key: string): unknown } | undefined, key: string): unknown {
  if (record === undefined) return undefined;
  try {
    return record.get(key);
  } catch {
    return undefined;
  }
}

function nodeSnapshot(labels: unknown, properties: unknown): GraphNode | undefined {
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string") || !isRecord(properties)) return undefined;
  return { labels: labels as string[], properties };
}

function exactLabels(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((label) => actual.includes(label));
}

function safeInteger(value: unknown): number | undefined {
  if (neo4j.isInt(value)) {
    const number = value.toNumber();
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_OR_V5.test(value);
}

function validUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_INSTANT.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day >= 1 && day <= days;
}

function compareUtcInstants(left: string, right: string): number {
  const leftMatch = UTC_INSTANT.exec(left)!;
  const rightMatch = UTC_INSTANT.exec(right)!;
  const leftKey = `${leftMatch[1]}-${leftMatch[2]}-${leftMatch[3]}T${leftMatch[4]}:${leftMatch[5]}:${leftMatch[6]}.${(leftMatch[7] ?? "").padEnd(9, "0")}Z`;
  const rightKey = `${rightMatch[1]}-${rightMatch[2]}-${rightMatch[3]}T${rightMatch[4]}:${rightMatch[5]}:${rightMatch[6]}.${(rightMatch[7] ?? "").padEnd(9, "0")}Z`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}

function toolSaveProposalSha(
  principalUid: string,
  projectUid: string,
  sessionUid: string,
  eventUid: string,
  toolCallId: string,
  normalizedArgsSha256: string,
  statement: string,
): string {
  return createHash("sha256").update(canonicalize({
    principal_uid: principalUid,
    project_uid: projectUid,
    session_uid: sessionUid,
    event_uid: eventUid,
    tool_call_id: toolCallId,
    normalized_args_sha256: normalizedArgsSha256,
    statement,
    subject: "user",
    kind: "claim",
    provenance: "tool_invocation",
    scope: "contextual_until_reassessed",
  }), "utf8").digest("hex");
}

function toolSaveDecisionUid(principalUid: string, sessionUid: string, toolCallId: string): string {
  return uuidV5FromParts(["anima.tool-save-decision", "v1", principalUid, sessionUid, toolCallId]);
}

function toolSaveRevisionKeys(properties: unknown): readonly string[] {
  const p = isRecord(properties) ? properties : undefined;
  const reason = p?.reason;
  const base = reason === "model_exact_span" ? REVISION_KEYS
    : reason === "tool_save" ? TOOL_SAVE_REVISION_KEYS
      : reason === "user_revision" ? (p !== undefined && Object.hasOwn(p, "save_type") ? OPERATION_TOOL_REVISION_KEYS : OPERATION_REVISION_KEYS)
        : fail("identity_conflict");
  return p !== undefined && Object.hasOwn(p, "valid_until") ? [...base, "valid_until"] : base;
}

function toolSaveFields(args: NormalizedSaveArgs): {
  save_type: string;
  title: string;
  narrative: string;
  context: string;
  principle: string;
  tags: string[];
} {
  return {
    save_type: args.type,
    title: args.title.trim(),
    narrative: args.narrative.trim(),
    context: args.context,
    principle: args.principle,
    tags: args.tags,
  };
}

function sameToolSaveFields(revision: DataRecord, args: NormalizedSaveArgs): boolean {
  const expected = toolSaveFields(args);
  return revision.save_type === expected.save_type &&
    revision.title === expected.title &&
    revision.narrative === expected.narrative &&
    revision.context === expected.context &&
    revision.principle === expected.principle &&
    Array.isArray(revision.tags) &&
    revision.tags.length === expected.tags.length &&
    revision.tags.every((tag, index) => tag === expected.tags[index]);
}
function modelExactSpanProposalSha(
  principalUid: string,
  projectUid: string,
  sessionUid: string,
  eventUid: string,
  span: ExactSpanModelMemoryRevisionSpan,
  statement: string,
): string {
  return createHash("sha256").update(canonicalize({
    principal_uid: principalUid,
    project_uid: projectUid,
    session_uid: sessionUid,
    event_uid: eventUid,
    span: {
      text_part_index: span.text_part_index,
      utf8_start: span.utf8_start,
      utf8_end: span.utf8_end,
      sha256: span.sha256,
    },
    statement_normalized: statement,
    subject: "user",
    kind: "claim",
    epistemic_kind: "hypothesis",
    provenance: "model_authored",
    scope: "contextual_until_reassessed",
  }), "utf8").digest("hex");
}

function parseInput(input: unknown): CreateExactSpanModelMemoryRevisionInput {
  const authorizeBeforeWrite = recordValue(input, "authorize_before_write");
  const fields = [
    ...INPUT_FIELDS,
    ...(authorizeBeforeWrite === undefined ? [] : ["authorize_before_write"]),
  ];
  const record = exactRecord(input, fields);
  if (record === undefined || typeof recordValue(record.transaction, "run") !== "function") fail("invalid_input");
  const scope = exactRecord(record.scope, SCOPE_FIELDS);
  if (
    scope === undefined || typeof scope.directory !== "string" || scope.directory.length === 0 ||
    typeof scope.principal_uid !== "string" || !UUID_V4.test(scope.principal_uid)
  ) fail("invalid_input");
  if (!isUuid(record.project_uid) || !isUuid(record.session_uid) || !isUuid(record.event_uid)) fail("invalid_input");
  const span = exactRecord(record.span, SPAN_FIELDS);
  if (
    span === undefined ||
    !Number.isSafeInteger(span.text_part_index) || (span.text_part_index as number) < 0 ||
    !Number.isSafeInteger(span.utf8_start) || (span.utf8_start as number) < 0 ||
    !Number.isSafeInteger(span.utf8_end) || (span.utf8_end as number) <= (span.utf8_start as number) ||
    typeof span.sha256 !== "string" || !SHA256.test(span.sha256)
  ) fail("invalid_input");
  if (typeof record.statement !== "string" || record.statement.normalize("NFC").trim().length === 0) fail("invalid_input");
  if (typeof record.decision_uid !== "string" || !UUID_V4.test(record.decision_uid) || !validUtcInstant(record.now)) fail("invalid_input");
  if (typeof record.markWrite !== "function"
    || (authorizeBeforeWrite !== undefined && typeof record.authorize_before_write !== "function")) fail("invalid_input");
  return {
    transaction: record.transaction as MemoryDirectEvidenceReaderTransaction,
    scope: scope as unknown as ProjectOwnershipScope,
    project_uid: record.project_uid as string,
    session_uid: record.session_uid as string,
    event_uid: record.event_uid as string,
    span: span as unknown as ExactSpanModelMemoryRevisionSpan,
    statement: record.statement as string,
    decision_uid: record.decision_uid as string,
    now: record.now as string,
    ...(authorizeBeforeWrite === undefined ? {} : { authorize_before_write: record.authorize_before_write as () => Promise<boolean> }),
    markWrite: record.markWrite as () => void,
  };
}

function parseToolSaveInput(input: unknown): CreateToolSaveMemoryRevisionInput {
  const authorizeBeforeWrite = recordValue(input, "authorize_before_write");
  const fields = [
    ...TOOL_SAVE_INPUT_FIELDS,
    ...(authorizeBeforeWrite === undefined ? [] : ["authorize_before_write"]),
  ];
  const record = exactRecord(input, fields);
  if (record === undefined || typeof recordValue(record.transaction, "run") !== "function") fail("invalid_input");
  const scope = exactRecord(record.scope, SCOPE_FIELDS);
  if (
    scope === undefined || typeof scope.directory !== "string" || scope.directory.length === 0 ||
    typeof scope.principal_uid !== "string" || !UUID_V4.test(scope.principal_uid)
  ) fail("invalid_input");
  if (
    !isUuid(record.project_uid) || !isUuid(record.session_uid) || !isUuid(record.event_uid) ||
    typeof record.tool_call_id !== "string" || record.tool_call_id.length === 0
  ) fail("invalid_input");
  if (
    typeof record.decision_uid !== "string" || !isUuid(record.decision_uid) || !validUtcInstant(record.now) ||
    (authorizeBeforeWrite !== undefined && typeof record.authorize_before_write !== "function")
  ) fail("invalid_input");
  if (typeof record.markWrite !== "function") fail("invalid_input");
  return {
    transaction: record.transaction as MemoryDirectEvidenceReaderTransaction,
    scope: scope as unknown as ProjectOwnershipScope,
    project_uid: record.project_uid as string,
    session_uid: record.session_uid as string,
    event_uid: record.event_uid as string,
    tool_call_id: record.tool_call_id as string,
    params: record.params,
    decision_uid: record.decision_uid as string,
    now: record.now as string,
    ...(authorizeBeforeWrite === undefined
      ? {}
      : { authorize_before_write: record.authorize_before_write as () => Promise<boolean> }),
    markWrite: record.markWrite as () => void,
  };
}

async function authorizeToolSaveBeforeWrite(authorize: () => Promise<boolean>): Promise<void> {
  let authorized: boolean;
  try {
    authorized = await authorize();
  } catch {
    fail("identity_conflict");
  }
  if (authorized !== true) fail("identity_conflict");
}

function parseMemoryOperationInput(input: unknown): CreateMemoryOperationRevisionInput {
  const action = recordValue(input, "action");
  if (typeof action !== "string" || !MEMORY_OPERATIONS.includes(action as (typeof MEMORY_OPERATIONS)[number])) {
    fail("invalid_input");
  }
  const fields = [
    "transaction", "scope", "project_uid", "session_uid", "operation_event_uid", "tool_call_id", "user_event_uid", "user_span",
    "memory_uid", "expected_revision_uid", "action", "decision_uid", "now", "markWrite",
    ...(action === "revise" ? ["statement"] : []),
    ...(action === "set_expiry" ? ["valid_until"] : []),
    ...(recordValue(input, "authorize_before_write") !== undefined ? ["authorize_before_write"] : []),
  ];
  const record = exactRecord(input, fields);
  if (record === undefined || typeof recordValue(record.transaction, "run") !== "function") fail("invalid_input");
  const scope = exactRecord(record.scope, SCOPE_FIELDS);
  const span = exactRecord(record.user_span, SPAN_FIELDS);
  if (
    scope === undefined || typeof scope.directory !== "string" || scope.directory.length === 0 ||
    typeof scope.principal_uid !== "string" || !UUID_V4.test(scope.principal_uid) ||
    !isUuid(record.project_uid) || !isUuid(record.session_uid) ||
    !isUuid(record.operation_event_uid) || !isUuid(record.user_event_uid) ||
    !isUuid(record.memory_uid) || !isUuid(record.expected_revision_uid) ||
    typeof record.tool_call_id !== "string" || record.tool_call_id.length === 0 ||
    record.tool_call_id.trim() !== record.tool_call_id ||
    typeof record.decision_uid !== "string" || !isUuid(record.decision_uid) ||
    !validUtcInstant(record.now) || typeof record.markWrite !== "function" ||
    span === undefined ||
    !Number.isSafeInteger(span.text_part_index) || (span.text_part_index as number) < 0 ||
    !Number.isSafeInteger(span.utf8_start) || (span.utf8_start as number) < 0 ||
    !Number.isSafeInteger(span.utf8_end) || (span.utf8_end as number) <= (span.utf8_start as number) ||
    typeof span.sha256 !== "string" || !SHA256.test(span.sha256)
  ) fail("invalid_input");
  if (
    action === "revise" &&
    (typeof record.statement !== "string" || record.statement.normalize("NFC").trim().length === 0)
  ) fail("invalid_input");
  if (
    action === "set_expiry" &&
    (!validUtcInstant(record.valid_until) || compareUtcInstants(record.valid_until, record.now as string) <= 0)
  ) fail("invalid_input");
  if (Object.hasOwn(record, "authorize_before_write") && typeof record.authorize_before_write !== "function") fail("invalid_input");
  return {
    transaction: record.transaction as MemoryDirectEvidenceReaderTransaction,
    scope: scope as unknown as ProjectOwnershipScope,
    project_uid: record.project_uid as string,
    session_uid: record.session_uid as string,
    tool_call_id: record.tool_call_id as string,
    operation_event_uid: record.operation_event_uid as string,
    user_event_uid: record.user_event_uid as string,
    user_span: span as unknown as MemoryOperationInput["user_span"],
    memory_uid: record.memory_uid as string,
    expected_revision_uid: record.expected_revision_uid as string,
    action: action as MemoryOperationInput["action"],
    ...(action === "revise" ? { statement: record.statement as string } : {}),
    ...(action === "set_expiry" ? { valid_until: record.valid_until as string } : {}),
    decision_uid: record.decision_uid as string,
    now: record.now as string,
    ...(Object.hasOwn(record, "authorize_before_write") ? {
      authorize_before_write: record.authorize_before_write as () => Promise<boolean>,
    } : {}),
    markWrite: record.markWrite as () => void,
  };
}

function mapEvidenceError(error: unknown): never {
  if (error instanceof MemoryGraphEvidenceError) {
    if (error.code === "identity_conflict") fail("identity_conflict");
    if (error.code === "source_incomplete") fail("source_incomplete");
    fail("evidence_invalid");
  }
  throw error;
}

function requireProperties(properties: unknown, fields: readonly string[]): asserts properties is DataRecord {
  if (!exactKeys(properties, fields)) fail("identity_conflict");
}

function relationshipHas(value: unknown, fields: readonly string[], expected: Record<string, unknown>): boolean {
  if (!exactKeys(value, fields)) return false;
  return Object.entries(expected).every(([key, item]) => value[key] === item);
}

function validateDomain(node: GraphNode, principalUid: string, projectUid: string, domainUid: string): DataRecord {
  if (!exactLabels(node.labels, ["MemorySubject"])) fail("identity_conflict");
  const p = node.properties;
  requireProperties(p, Object.hasOwn(p, "subject_operation_decision_uid") ? DOMAIN_AUDIT_KEYS : DOMAIN_KEYS);
  const generation = safeInteger(p.generation);
  if (
    p.domain_uid !== domainUid || p.principal_uid !== principalUid || p.project_uid !== projectUid || p.subject !== "user" ||
    typeof p.model_save_suspended !== "boolean" || generation === undefined || generation < 0 ||
    (Object.hasOwn(p, "subject_operation_decision_uid") && !isUuid(p.subject_operation_decision_uid))
  ) fail("identity_conflict");
  return p;
}

function validateMemory(properties: unknown, principalUid: string, projectUid: string, domainUid: string): DataRecord {
  requireProperties(properties, MEMORY_KEYS);
  const p = properties;
  if (
    !isUuid(p.memory_uid) || p.lineage_uid !== p.memory_uid || p.domain_uid !== domainUid || p.principal_uid !== principalUid ||
    p.project_uid !== projectUid || p.subject !== "user" || typeof p.claim_key !== "string" || !SHA256.test(p.claim_key) ||
    typeof p.kind !== "string" || !MEMORY_KINDS.includes(p.kind as (typeof MEMORY_KINDS)[number]) ||
    typeof p.state !== "string" || !MEMORY_STATES.includes(p.state as (typeof MEMORY_STATES)[number]) ||
    !isUuid(p.current_revision_uid) || (safeInteger(p.revision_number) ?? 0) < 1 ||
    !Array.isArray(p.evidence_event_uids) || p.evidence_event_uids.length === 0 || p.evidence_event_uids.some((uid) => !isUuid(uid)) ||
    new Set(p.evidence_event_uids).size !== p.evidence_event_uids.length || !validUtcInstant(p.created_at)
  ) fail("identity_conflict");
  return p;
}

function validateRevision(properties: unknown, memory: DataRecord, principalUid: string, projectUid: string, domainUid: string): DataRecord {
  requireProperties(properties, toolSaveRevisionKeys(properties));
  const p = properties;
  const commonInvalid =
    !isUuid(p.revision_uid) || p.memory_uid !== memory.memory_uid || p.lineage_uid !== memory.lineage_uid || p.domain_uid !== domainUid ||
    p.principal_uid !== principalUid || p.project_uid !== projectUid || !isUuid(p.decision_uid) ||
    typeof p.decision_basis_sha !== "string" || !SHA256.test(p.decision_basis_sha) || (safeInteger(p.revision_number) ?? 0) < 1 ||
    typeof p.statement !== "string" || p.statement !== p.statement.trim() || p.kind !== "claim" ||
    p.epistemic_kind !== "hypothesis" || p.scope !== "contextual_until_reassessed" || p.applicability_kind !== "project" ||
    typeof p.state !== "string" || !MEMORY_STATES.includes(p.state as (typeof MEMORY_STATES)[number]) ||
    !validUtcInstant(p.valid_from) || !validUtcInstant(p.created_at) ||
    (Object.hasOwn(p, "valid_until") && (
      !validUtcInstant(p.valid_until) || compareUtcInstants(p.valid_from as string, p.valid_until as string) >= 0
    ));
  if (commonInvalid) fail("identity_conflict");
  if (p.reason === "model_exact_span") {
    if (
      !UUID_V4.test(p.decision_uid as string) || p.statement !== (p.statement as string).normalize("NFC") ||
      p.provenance !== "model_authored"
    ) fail("identity_conflict");
  } else if (p.reason === "tool_save") {
    validateToolSaveRevision(p);
  } else if (p.reason === "user_revision") {
    const partIndex = safeInteger(p.user_span_text_part_index);
    const spanStart = safeInteger(p.user_span_utf8_start);
    const spanEnd = safeInteger(p.user_span_utf8_end);
    if (
      p.provenance !== "user_operation" || p.statement !== (p.statement as string).normalize("NFC") ||
      !MEMORY_OPERATIONS.slice(0, 3).includes(p.operation as (typeof MEMORY_OPERATIONS)[number]) ||
      !isUuid(p.expected_revision_uid) || !isUuid(p.operation_event_uid) || !isUuid(p.user_event_uid) ||
      partIndex === undefined || partIndex < 0 ||
      spanStart === undefined || spanStart < 0 ||
      spanEnd === undefined || spanEnd <= spanStart ||
      typeof p.user_span_sha256 !== "string" || !SHA256.test(p.user_span_sha256) ||
      (p.operation === "revise" && p.state !== "active") ||
      (p.operation === "revoke" && p.state !== "revoked") ||
      (p.operation === "set_expiry" && (p.state !== "active" || !Object.hasOwn(p, "valid_until")))
    ) fail("identity_conflict");
    if (Object.hasOwn(p, "save_type")) validateToolSaveRevision(p, true);
    if (p.operation === "revise" && Object.hasOwn(p, "save_type") && p.narrative !== p.statement) fail("identity_conflict");
  } else {
    fail("identity_conflict");
  }
  return p;
}

function validateToolSaveRevision(p: DataRecord, operation = false): void {
  if (
    p.provenance !== (operation ? "user_operation" : "tool_invocation") ||
    typeof p.save_type !== "string" ||
    typeof p.title !== "string" || p.title !== p.title.trim() ||
    typeof p.narrative !== "string" || p.narrative !== p.narrative.trim() ||
    typeof p.context !== "string" || typeof p.principle !== "string" ||
    !Array.isArray(p.tags) || p.tags.some((tag) => typeof tag !== "string")
  ) fail("identity_conflict");
}

function operationDecisionKeys(properties: unknown): readonly string[] {
  if (!isRecord(properties)) return OPERATION_DECISION_BASE_KEYS;
  return properties.operation === "revise"
    ? [...OPERATION_DECISION_BASE_KEYS, "statement"]
    : properties.operation === "set_expiry"
      ? [...OPERATION_DECISION_BASE_KEYS, "valid_until"]
      : OPERATION_DECISION_BASE_KEYS;
}
function validateDecision(properties: unknown, principalUid: string, projectUid: string, domainUid: string): DataRecord {
  requireProperties(properties, isRecord(properties) && Object.hasOwn(properties, "operation") ? operationDecisionKeys(properties) : DECISION_KEYS);
  const p = properties;
  if (
    typeof p.decision_uid !== "string" || !isUuid(p.decision_uid) || typeof p.proposal_sha !== "string" || !SHA256.test(p.proposal_sha) ||
    p.principal_uid !== principalUid || p.project_uid !== projectUid || p.domain_uid !== domainUid ||
    !isUuid(p.memory_uid) || !isUuid(p.revision_uid) || (p.status !== "written" && p.status !== "duplicate") || !validUtcInstant(p.created_at)
  ) fail("identity_conflict");
  return p;
}

async function readNodesWithProperty(
  transaction: MemoryDirectEvidenceReaderTransaction,
  property: "domain_uid" | "decision_uid",
  uid: string,
): Promise<GraphNode[]> {
  const labelMatch = property === "decision_uid" ? "MATCH (n:MemoryDecision)" : "MATCH (n)";
  const result = await transaction.run(
    `${labelMatch} WHERE n.${property} = $uid RETURN labels(n) AS labels, properties(n) AS properties`,
    { uid },
  );
  return records(result).map((record) => {
    const node = nodeSnapshot(field(record, "labels"), field(record, "properties"));
    if (node === undefined) fail("identity_conflict");
    return node;
  });
}

async function zeroCount(
  transaction: MemoryDirectEvidenceReaderTransaction,
  query: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const result = records(await transaction.run(query, parameters));
  if (result.length !== 1 || safeInteger(field(result[0], "count")) !== 0) fail("identity_conflict");
}

type VerifiedOperationEvidence = {
  operation_sequence: number;
  user_sequence: number;
  user_text: string;
};

function operationSpan(properties: DataRecord): MemoryOperationInput["user_span"] | undefined {
  const text_part_index = safeInteger(properties.user_span_text_part_index);
  const utf8_start = safeInteger(properties.user_span_utf8_start);
  const utf8_end = safeInteger(properties.user_span_utf8_end);
  if (
    text_part_index === undefined || utf8_start === undefined || utf8_end === undefined ||
    typeof properties.user_span_sha256 !== "string"
  ) return undefined;
  return {
    text_part_index,
    utf8_start,
    utf8_end,
    sha256: properties.user_span_sha256,
  };
}

function memoryOperationProposalSha(
  principalUid: string,
  projectUid: string,
  sessionUid: string,
  memoryUid: string,
  properties: DataRecord,
): string {
  const span = operationSpan(properties);
  if (span === undefined) fail("identity_conflict");
  return createHash("sha256").update(canonicalize({
    principal_uid: principalUid,
    project_uid: projectUid,
    session_uid: sessionUid,
    memory_uid: memoryUid,
    expected_revision_uid: properties.expected_revision_uid,
    action: properties.operation,
    operation_event_uid: properties.operation_event_uid,
    user_event_uid: properties.user_event_uid,
    user_span: span,
    ...(properties.operation === "revise" ? { statement: properties.statement } : {}),
    ...(properties.operation === "set_expiry" ? { valid_until: properties.valid_until } : {}),
  }), "utf8").digest("hex");
}

function operationToolCallId(eventSnapshot: unknown): string {
  let payload: unknown;
  try {
    const decoded = decodeStoredToolCall(eventSnapshot);
    payload = JSON.parse(decoded.event.native_payload_json);
  } catch { fail("evidence_invalid"); }
  if (!isRecord(payload) || typeof payload.toolCallId !== "string" || payload.toolCallId.length === 0) {
    fail("evidence_invalid");
  }
  return payload.toolCallId;
}

async function verifyMemoryOperationEvidence(
  transaction: MemoryDirectEvidenceReaderTransaction,
  scope: ProjectOwnershipScope,
  principalUid: string,
  projectUid: string,
  sessionUid: string,
  properties: DataRecord,
  toolCallId: string | undefined,
): Promise<VerifiedOperationEvidence> {
  const span = operationSpan(properties);
  if (
    span === undefined || typeof properties.operation_event_uid !== "string" ||
    typeof properties.user_event_uid !== "string" || !isUuid(properties.operation_event_uid) ||
    !isUuid(properties.user_event_uid)
  ) fail("identity_conflict");
  let operationGraph;
  let userGraph;
  let userEvidence: RegisteredExternalUserTextEvidence;
  try {
    [operationGraph, userGraph] = await Promise.all([
      readRegisteredRawEventGraph(transaction, scope, projectUid, sessionUid, properties.operation_event_uid),
      readRegisteredRawEventGraph(transaction, scope, projectUid, sessionUid, properties.user_event_uid),
    ]);
    userEvidence = await readRegisteredExternalUserTextEvidence({
      transaction,
      scope,
      project_uid: projectUid,
      session_uid: sessionUid,
      event_uid: properties.user_event_uid,
      span,
    });
  } catch (error) {
    mapEvidenceError(error);
  }
  if (
    operationGraph.registeredProject.principal_uid !== principalUid ||
    userGraph.registeredProject.principal_uid !== principalUid ||
    operationGraph.eventSnapshot.properties.project_uid !== projectUid ||
    userGraph.eventSnapshot.properties.project_uid !== projectUid ||
    operationGraph.eventSnapshot.properties.session_uid !== sessionUid ||
    userGraph.eventSnapshot.properties.session_uid !== sessionUid ||
    !operationGraph.eventSnapshot.labels.includes("RawEvent") || !userGraph.eventSnapshot.labels.includes("RawEvent") ||
    userEvidence.principal_uid !== principalUid || userEvidence.project_uid !== projectUid ||
    userEvidence.session_uid !== sessionUid || userEvidence.event_uid !== properties.user_event_uid ||
    userEvidence.text_part_index !== span.text_part_index || userEvidence.utf8_start !== span.utf8_start ||
    userEvidence.utf8_end !== span.utf8_end || userEvidence.sha256 !== span.sha256
  ) fail("identity_conflict");
  try {
    verifyMemoryOperationToolCall(operationGraph, {
      tool_call_id: toolCallId ?? operationToolCallId(operationGraph.eventSnapshot),
      project_uid: projectUid,
      session_uid: sessionUid,
      operation_event_uid: properties.operation_event_uid as string,
      memory_uid: properties.memory_uid as string,
      expected_revision_uid: properties.expected_revision_uid as string,
      action: properties.operation as MemoryOperationInput["action"],
      ...(properties.operation === "revise" ? { statement: properties.statement as string } : {}),
      ...(properties.operation === "set_expiry" ? { valid_until: properties.valid_until as string } : {}),
    });
  } catch {
    fail("evidence_invalid");
  }
  const operationSequence = safeInteger(operationGraph.eventSnapshot.properties.ingest_sequence);
  const userSequence = safeInteger(userGraph.eventSnapshot.properties.ingest_sequence);
  if (operationSequence === undefined || userSequence === undefined) fail("source_incomplete");
  if (properties.operation !== "revise") {
    let confirmation: string;
    try {
      confirmation = memoryOperationConfirmation({
        action: properties.operation as MemoryOperationInput["action"],
        memory_uid: properties.memory_uid as string,
        expected_revision_uid: properties.expected_revision_uid as string,
        ...(properties.operation === "set_expiry" ? { valid_until: properties.valid_until as string } : {}),
      });
    } catch { fail("evidence_invalid"); }
    if (userEvidence.text.normalize("NFC").trim() !== confirmation) fail("evidence_invalid");
  }
  if (operationSequence <= userSequence) fail("evidence_invalid");
  return { operation_sequence: operationSequence, user_sequence: userSequence, user_text: userEvidence.text };
}

function operationEvidenceRelation(
  position: number,
  evidenceKind: "operation" | "user_text",
  span: MemoryOperationInput["user_span"],
): Record<string, unknown> {
  return evidenceKind === "operation"
    ? {
      schema_id: "anima.memory-operation-evidence/v1",
      position,
      evidence_kind: evidenceKind,
    }
    : {
      schema_id: "anima.memory-operation-evidence/v1",
      position,
      evidence_kind: evidenceKind,
      text_part_index: neo4j.int(span.text_part_index),
      utf8_start: neo4j.int(span.utf8_start),
      utf8_end: neo4j.int(span.utf8_end),
      sha256: span.sha256,
    };
}

async function authorizeMemoryOperationWrite(input: CreateMemoryOperationRevisionInput): Promise<void> {
  if (input.authorize_before_write === undefined) return;
  let authorized = false;
  try { authorized = await input.authorize_before_write(); } catch { /* Fail closed on resolver failure. */ }
  if (!authorized) fail("identity_conflict");
}

async function loadDomainState(
  transaction: MemoryDirectEvidenceReaderTransaction,
  scope: ProjectOwnershipScope,
  domainNodes: readonly GraphNode[],
  principalUid: string,
  projectUid: string,
  domainUid: string,
): Promise<DomainState> {
  const domainMatches = domainNodes.filter((node) => node.labels.includes("MemorySubject"));
  if (domainMatches.length !== 1) fail("identity_conflict");
  for (const node of domainNodes) if (!VALID_DOMAIN_LABELS.some((label) => exactLabels(node.labels, [label]))) fail("identity_conflict");
  const domain = validateDomain(domainMatches[0]!, principalUid, projectUid, domainUid);
  const memories = new Map<string, MemoryEntry>();
  const revisions = new Map<string, { memoryUid: string; properties: DataRecord }>();
  const decisions = new Map<string, DataRecord>();

  for (const node of domainNodes) {
    if (exactLabels(node.labels, ["Memory"])) {
      const memory = validateMemory(node.properties, principalUid, projectUid, domainUid);
      const uid = memory.memory_uid as string;
      if (memories.has(uid)) fail("identity_conflict");
      memories.set(uid, { properties: memory, revisions: new Map() });
    } else if (exactLabels(node.labels, ["MemoryRevision"])) {
      requireProperties(node.properties, toolSaveRevisionKeys(node.properties));
    } else if (exactLabels(node.labels, ["MemoryDecision"])) {
      const decision = validateDecision(node.properties, principalUid, projectUid, domainUid);
      const uid = decision.decision_uid as string;
      if (decisions.has(uid)) fail("identity_conflict");
      decisions.set(uid, decision);
    }
  }

  const memoryLinks = records(await transaction.run(
    "MATCH (owner)-[r:HAS_MEMORY]->(m) WHERE owner.domain_uid = $domain_uid OR m.domain_uid = $domain_uid RETURN labels(owner) AS owner_labels, properties(owner) AS owner, labels(m) AS memory_labels, properties(m) AS memory, properties(r) AS relation",
    { domain_uid: domainUid },
  ));
  const memoryOwners = new Map<string, number>();
  for (const row of memoryLinks) {
    const ownerLabels = field(row, "owner_labels");
    const owner = field(row, "owner");
    const memoryLabels = field(row, "memory_labels");
    const memory = field(row, "memory");
    const relation = field(row, "relation");
    if (
      !Array.isArray(ownerLabels) || !exactLabels(ownerLabels as string[], ["MemorySubject"]) || !isRecord(owner) ||
      owner.domain_uid !== domainUid || !Array.isArray(memoryLabels) || !exactLabels(memoryLabels as string[], ["Memory"]) ||
      !isRecord(memory) || memory.domain_uid !== domainUid ||
      !relationshipHas(relation, DOMAIN_RELATION_KEYS, { schema_id: "anima.memory-domain/v1" })
    ) fail("identity_conflict");
    const uid = memory.memory_uid;
    if (typeof uid !== "string" || !memories.has(uid)) fail("identity_conflict");
    memoryOwners.set(uid, (memoryOwners.get(uid) ?? 0) + 1);
  }
  for (const uid of memories.keys()) if (memoryOwners.get(uid) !== 1) fail("identity_conflict");
  await zeroCount(transaction,
    "MATCH (m)-[r:HAS_MEMORY]->(d:MemorySubject {domain_uid: $domain_uid}) RETURN count(r) AS count",
    { domain_uid: domainUid },
  );

  const revisionLinks = records(await transaction.run(
    "MATCH (owner)-[r:HAS_REVISION]->(v) WHERE owner.domain_uid = $domain_uid OR v.domain_uid = $domain_uid RETURN labels(owner) AS memory_labels, properties(owner) AS memory, labels(v) AS revision_labels, properties(v) AS revision, properties(r) AS relation",
    { domain_uid: domainUid },
  ));
  const revisionOwners = new Map<string, number>();
  for (const row of revisionLinks) {
    const memoryLabels = field(row, "memory_labels");
    const memory = field(row, "memory");
    const revisionLabels = field(row, "revision_labels");
    const revision = field(row, "revision");
    const relation = field(row, "relation");
    if (
      !Array.isArray(memoryLabels) || !exactLabels(memoryLabels as string[], ["Memory"]) || !isRecord(memory) ||
      memory.domain_uid !== domainUid || !Array.isArray(revisionLabels) || !exactLabels(revisionLabels as string[], ["MemoryRevision"]) ||
      !isRecord(revision) || !exactKeys(relation, REVISION_RELATION_KEYS)
    ) fail("identity_conflict");
    const memoryUid = memory.memory_uid;
    if (typeof memoryUid !== "string") fail("identity_conflict");
    const entry = memories.get(memoryUid);
    if (entry === undefined) fail("identity_conflict");
    const validRevision = validateRevision(revision, entry.properties, principalUid, projectUid, domainUid);
    const revisionUid = validRevision.revision_uid as string;
    const linkNumber = safeInteger(recordValue(relation, "revision_number"));
    if (linkNumber === undefined || linkNumber !== safeInteger(validRevision.revision_number) || revisions.has(revisionUid)) fail("identity_conflict");
    revisions.set(revisionUid, { memoryUid, properties: validRevision });
    entry.revisions.set(revisionUid, validRevision);
    revisionOwners.set(revisionUid, (revisionOwners.get(revisionUid) ?? 0) + 1);
  }
  for (const node of domainNodes) {
    if (exactLabels(node.labels, ["MemoryRevision"])) {
      const uid = node.properties.revision_uid;
      if (typeof uid !== "string") fail("identity_conflict");
      const linked = revisions.get(uid);
      if (
        linked === undefined ||
        toolSaveRevisionKeys(linked.properties).some((key) => {
          if (key === "revision_number") return false;
          const linkedValue = linked.properties[key];
          const nodeValue = node.properties[key];
          if (Array.isArray(linkedValue)) {
            return !Array.isArray(nodeValue) || linkedValue.length !== nodeValue.length ||
              linkedValue.some((value, index) => value !== nodeValue[index]);
          }
          if (neo4j.isInt(linkedValue) || neo4j.isInt(nodeValue)) {
            const linkedNumber = safeInteger(linkedValue);
            return linkedNumber === undefined || linkedNumber !== safeInteger(nodeValue);
          }
          return linkedValue !== nodeValue;
        }) ||
        safeInteger(linked.properties.revision_number) !== safeInteger(node.properties.revision_number)
      ) fail("identity_conflict");
    }
  }
  for (const [revisionUid] of revisions) if (revisionOwners.get(revisionUid) !== 1) fail("identity_conflict");
  for (const [memoryUid, entry] of memories) {
    const count = safeInteger(entry.properties.revision_number);
    const numbers = [...entry.revisions.values()].map((revision) => safeInteger(revision.revision_number));
    if (count === undefined || numbers.length !== count || !sameSet(numbers.map(String), Array.from({ length: count }, (_, index) => String(index + 1)))) fail("identity_conflict");
  }
  await zeroCount(transaction,
    "MATCH (v)-[r:HAS_REVISION]->(m:Memory {domain_uid: $domain_uid}) RETURN count(r) AS count",
    { domain_uid: domainUid },
  );

  const currentLinks = records(await transaction.run(
    "MATCH (m:Memory)-[r:CURRENT_REVISION]->(v) WHERE m.domain_uid = $domain_uid OR v.domain_uid = $domain_uid RETURN properties(m) AS memory, labels(v) AS revision_labels, properties(v) AS revision, properties(r) AS relation",
    { domain_uid: domainUid },
  ));
  const currentCounts = new Map<string, number>();
  for (const row of currentLinks) {
    const memory = field(row, "memory");
    const revisionLabels = field(row, "revision_labels");
    const revision = field(row, "revision");
    if (
      !isRecord(memory) || !Array.isArray(revisionLabels) ||
      !exactLabels(revisionLabels as string[], ["MemoryRevision"]) ||
      !isRecord(revision) || !exactKeys(field(row, "relation"), [])
    ) fail("identity_conflict");
    const memoryUid = memory.memory_uid;
    const revisionUid = revision.revision_uid;
    if (typeof memoryUid !== "string" || typeof revisionUid !== "string") fail("identity_conflict");
    const entry = memories.get(memoryUid);
    const pointedRevision = entry?.revisions.get(revisionUid);
    if (
      entry === undefined || pointedRevision === undefined || entry.properties.current_revision_uid !== revisionUid ||
      safeInteger(revision.revision_number) !== safeInteger(entry.properties.revision_number) ||
      revision.state !== entry.properties.state || revision.kind !== entry.properties.kind ||
      pointedRevision.state !== entry.properties.state || pointedRevision.kind !== entry.properties.kind
    ) fail("identity_conflict");
    currentCounts.set(memoryUid, (currentCounts.get(memoryUid) ?? 0) + 1);
  }
  for (const uid of memories.keys()) if (currentCounts.get(uid) !== 1) fail("identity_conflict");
  await zeroCount(transaction,
    "MATCH (source)-[r:CURRENT_REVISION]->(m:Memory) WHERE m.domain_uid = $domain_uid OR source.domain_uid = $domain_uid RETURN count(r) AS count",
    { domain_uid: domainUid },
  );

  const evidenceLinks = records(await transaction.run(
    "MATCH (v:MemoryRevision)-[r:EVIDENCED_BY]->(e) WHERE v.domain_uid = $domain_uid RETURN properties(v) AS revision, properties(r) AS relation, labels(e) AS event_labels, properties(e) AS event",
    { domain_uid: domainUid },
  ));
  const revisionEvidence = new Map<string, Array<{ eventUid: string; position: number }>>();
  const memoryEvidence = new Map<string, Set<string>>();
  const verifiedSpans = new Map<string, RegisteredExternalUserTextEvidence>();
  for (const row of evidenceLinks) {
    const revision = field(row, "revision");
    const relation = field(row, "relation");
    const eventLabels = field(row, "event_labels");
    const event = field(row, "event");
    if (!isRecord(revision) || !Array.isArray(eventLabels) || !isRecord(event)) fail("identity_conflict");
    const revisionUid = revision.revision_uid;
    const memoryUid = revision.memory_uid;
    if (typeof revisionUid !== "string" || typeof memoryUid !== "string") fail("identity_conflict");
    const entry = memories.get(memoryUid);
    const eventUid = event.event_uid;
    const position = safeInteger(recordValue(relation, "position"));
    if (
      entry === undefined || !entry.revisions.has(revisionUid) ||
      typeof eventUid !== "string" || !isUuid(eventUid) || event.project_uid !== projectUid || !isUuid(event.session_uid) ||
      position === undefined || position < 0 ||
      !(entry.properties.evidence_event_uids as string[]).includes(eventUid)
    ) fail("identity_conflict");
    const linkedRevision = revisions.get(revisionUid)?.properties;
    if (linkedRevision === undefined) fail("identity_conflict");

    if (linkedRevision.reason === "model_exact_span") {
      if (
        !exactKeys(relation, EVIDENCE_RELATION_KEYS) ||
        !exactLabels(eventLabels as string[], ["RawEvent", "Message"]) ||
        relation.schema_id !== "anima.memory-evidence/v1"
      ) fail("identity_conflict");
      const textIndex = safeInteger(recordValue(relation, "text_part_index"));
      const start = safeInteger(recordValue(relation, "utf8_start"));
      const end = safeInteger(recordValue(relation, "utf8_end"));
      if (
        textIndex === undefined || textIndex < 0 || start === undefined || start < 0 ||
        end === undefined || end <= start || typeof relation.sha256 !== "string" || !SHA256.test(relation.sha256)
      ) fail("identity_conflict");
      const spanKey = `${eventUid}:${textIndex}:${start}:${end}:${relation.sha256}`;
      let verified = verifiedSpans.get(spanKey);
      if (verified === undefined) {
        try {
          verified = await readRegisteredExternalUserTextEvidence({
            transaction,
            scope,
            project_uid: projectUid,
            session_uid: event.session_uid as string,
            event_uid: eventUid,
            span: {
              text_part_index: textIndex,
              utf8_start: start,
              utf8_end: end,
              sha256: relation.sha256 as string,
            },
          });
        } catch (error) {
          if (error instanceof MemoryGraphEvidenceError) fail("identity_conflict");
          throw error;
        }
        if (
          verified.principal_uid !== principalUid || verified.project_uid !== projectUid ||
          verified.session_uid !== event.session_uid || verified.event_uid !== eventUid
        ) fail("identity_conflict");
        verifiedSpans.set(spanKey, verified);
      }
      const revisionStatement = linkedRevision.statement;
      if (typeof revisionStatement !== "string" || verified.text.normalize("NFC").trim() !== revisionStatement) fail("identity_conflict");
      const expectedProposalSha = modelExactSpanProposalSha(
        principalUid,
        projectUid,
        verified.session_uid,
        verified.event_uid,
        {
          text_part_index: verified.text_part_index,
          utf8_start: verified.utf8_start,
          utf8_end: verified.utf8_end,
          sha256: verified.sha256,
        },
        revisionStatement,
      );
      if (linkedRevision.decision_basis_sha !== expectedProposalSha) fail("identity_conflict");
    } else if (linkedRevision.reason === "tool_save") {
      if (
        !exactKeys(relation, TOOL_EVIDENCE_RELATION_KEYS) ||
        !exactLabels(eventLabels as string[], ["RawEvent", "ToolCall"]) ||
        relation.schema_id !== "anima.memory-evidence/v1" || safeInteger(relation.json_part_index) !== 0 ||
        typeof relation.tool_call_id !== "string" || relation.tool_call_id.length === 0 ||
        typeof relation.normalized_args_sha256 !== "string" || !SHA256.test(relation.normalized_args_sha256)
      ) fail("identity_conflict");
      let capturedParams: unknown;
      try {
        const decoded = decodeStoredToolCall({ labels: eventLabels, properties: event });
        const parts = decoded.event.content_parts;
        if (
          parts.length !== 1 || parts[0]?.type !== "json" || parts[0].part_index !== 0 ||
          typeof parts[0].value_json !== "string"
        ) fail("identity_conflict");
        capturedParams = JSON.parse(parts[0].value_json);
      } catch {
        fail("identity_conflict");
      }
      let verified: RegisteredSaveToolCallEvidence;
      try {
        verified = await readRegisteredSaveToolCallEvidence({
          transaction,
          scope,
          project_uid: projectUid,
          session_uid: event.session_uid as string,
          event_uid: eventUid,
          tool_call_id: relation.tool_call_id,
          params: capturedParams,
        });
      } catch (error) {
        if (error instanceof MemoryGraphEvidenceError) fail("identity_conflict");
        throw error;
      }
      if (
        verified.source_kind !== "tool_invocation" || verified.principal_uid !== principalUid ||
        verified.project_uid !== projectUid || verified.session_uid !== event.session_uid ||
        verified.event_uid !== eventUid || verified.normalized_args_sha256 !== relation.normalized_args_sha256 ||
        !sameToolSaveFields(linkedRevision, verified.normalized_save_args)
      ) fail("identity_conflict");
      const statement = verified.normalized_save_args.narrative.trim() || verified.normalized_save_args.title.trim();
      const expectedDecisionUid = toolSaveDecisionUid(principalUid, verified.session_uid, relation.tool_call_id);
      const expectedProposalSha = toolSaveProposalSha(
        principalUid,
        projectUid,
        verified.session_uid,
        eventUid,
        relation.tool_call_id,
        verified.normalized_args_sha256,
        statement,
      );
      if (
        linkedRevision.statement !== statement || linkedRevision.decision_uid !== expectedDecisionUid ||
        linkedRevision.decision_basis_sha !== expectedProposalSha
      ) fail("identity_conflict");
    } else if (linkedRevision.reason === "user_revision") {
      if (
        (!isRecord(relation) || !exactKeys(relation, relation.evidence_kind === "operation" ? OPERATION_EVENT_RELATION_KEYS : OPERATION_EVIDENCE_RELATION_KEYS)) ||
        !Array.isArray(eventLabels) || !eventLabels.includes("RawEvent") ||
        relation.schema_id !== "anima.memory-operation-evidence/v1"
      ) fail("identity_conflict");
      const span = operationSpan(linkedRevision);
      const expectedEventUid = position === 0 ? linkedRevision.operation_event_uid : linkedRevision.user_event_uid;
      const expectedKind = position === 0 ? "operation" : "user_text";
      if (
        span === undefined || (position !== 0 && position !== 1) || eventUid !== expectedEventUid ||
        relation.evidence_kind !== expectedKind ||
        (position === 0 && relation.evidence_kind !== "operation") ||
        (position === 1 && (
          safeInteger(relation.text_part_index) !== span.text_part_index ||
          safeInteger(relation.utf8_start) !== span.utf8_start ||
          safeInteger(relation.utf8_end) !== span.utf8_end || relation.sha256 !== span.sha256
        ))
      ) fail("identity_conflict");
      const operationEvidence = await verifyMemoryOperationEvidence(
        transaction, scope, principalUid, projectUid, event.session_uid as string, linkedRevision, undefined,
      );
      if (
        linkedRevision.operation === "revise" &&
        operationEvidence.user_text.normalize("NFC").trim() !== linkedRevision.statement
      ) fail("identity_conflict");
      const expectedProposalSha = memoryOperationProposalSha(
        principalUid, projectUid, event.session_uid as string, memoryUid, linkedRevision,
      );
      if (linkedRevision.decision_basis_sha !== expectedProposalSha) fail("identity_conflict");
    } else {
      fail("identity_conflict");
    }

    const linked = revisionEvidence.get(revisionUid) ?? [];
    linked.push({ eventUid, position });
    revisionEvidence.set(revisionUid, linked);
    const evidenceUids = memoryEvidence.get(memoryUid) ?? new Set<string>();
    evidenceUids.add(eventUid);
    memoryEvidence.set(memoryUid, evidenceUids);
  }
  for (const [revisionUid, revision] of revisions) {
    const links = revisionEvidence.get(revisionUid) ?? [];
    if (
      revision.properties.reason === "user_revision"
        ? links.length !== 2 || !sameSet(links.map(({ position }) => String(position)), ["0", "1"])
        : links.length !== 1 || links[0]?.position !== 0
    ) fail("identity_conflict");
    if (revision.memoryUid !== revision.properties.memory_uid) fail("identity_conflict");
  }
  for (const [, revisionEntry] of revisions) {
    const revision = revisionEntry.properties;
    if (revision.reason !== "user_revision") continue;
    const entry = memories.get(revisionEntry.memoryUid);
    const previous = entry?.revisions.get(revision.expected_revision_uid as string);
    if (
      entry === undefined || previous === undefined ||
      safeInteger(previous.revision_number) === undefined ||
      safeInteger(revision.revision_number) !== safeInteger(previous.revision_number)! + 1
    ) fail("identity_conflict");
    if (revision.operation !== "revise" && revision.statement !== previous.statement) fail("identity_conflict");
    const previousWasToolSave = Object.hasOwn(previous, "save_type");
    if (previousWasToolSave !== Object.hasOwn(revision, "save_type")) fail("identity_conflict");
    if (previousWasToolSave && TOOL_SAVE_FIELDS.some((key) => {
      const before = key === "narrative" && revision.operation === "revise" ? revision.statement : previous[key];
      const after = revision[key];
      return Array.isArray(before)
        ? !Array.isArray(after) || before.length !== after.length || before.some((value, index) => value !== after[index])
        : before !== after;
    })) fail("identity_conflict");
    if (revision.operation !== "set_expiry" && revision.valid_until !== previous.valid_until) fail("identity_conflict");
  }
  for (const [memoryUid, entry] of memories) {
    const evidenceUids = [...(memoryEvidence.get(memoryUid) ?? new Set<string>())];
    if (!sameSet(evidenceUids, entry.properties.evidence_event_uids as string[])) fail("identity_conflict");
    if (entry.properties.state === "active") {
      const currentRevision = entry.revisions.get(entry.properties.current_revision_uid as string);
      if (currentRevision === undefined || currentRevision.kind !== entry.properties.kind) fail("identity_conflict");
      const identity = decideModelSaveIdentity({
        principal_uid: principalUid,
        project_uid: projectUid,
        subject: "user",
        kind: "claim",
        statement: currentRevision.statement as string,
        evidence_event_uids: entry.properties.evidence_event_uids as string[],
        existing: [],
      });
      if (currentRevision.reason !== "user_revision" && identity.claim_key !== entry.properties.claim_key) fail("identity_conflict");
    }
  }
  await zeroCount(transaction,
    "MATCH (e)-[r:EVIDENCED_BY]->(v:MemoryRevision) WHERE v.domain_uid = $domain_uid RETURN count(r) AS count",
    { domain_uid: domainUid },
  );

  const operationDecisionEvidencePositions = new Map<string, number>();
  const operationDecisionEvidence = records(await transaction.run(
    "MATCH (d:MemoryDecision)-[r:EVIDENCED_BY]->(e) WHERE d.domain_uid = $domain_uid RETURN properties(d) AS decision, properties(r) AS relation, labels(e) AS event_labels, properties(e) AS event",
    { domain_uid: domainUid },
  ));
  for (const row of operationDecisionEvidence) {
    const decision = field(row, "decision");
    const relation = field(row, "relation");
    const eventLabels = field(row, "event_labels");
    const event = field(row, "event");
    if (
      !isRecord(decision) || !isRecord(event) || !Array.isArray(eventLabels) ||
      !Object.hasOwn(decision, "operation") ||
      (!isRecord(relation) || !exactKeys(relation, relation.evidence_kind === "operation" ? OPERATION_EVENT_RELATION_KEYS : OPERATION_EVIDENCE_RELATION_KEYS)) ||
      relation.schema_id !== "anima.memory-operation-evidence/v1" || !eventLabels.includes("RawEvent")
    ) fail("identity_conflict");
    const decisionUid = decision.decision_uid;
    const position = safeInteger(relation.position);
    const span = operationSpan(decision);
    if (typeof decisionUid !== "string" || !decisions.has(decisionUid) || span === undefined || (position !== 0 && position !== 1)) {
      fail("identity_conflict");
    }
    const expectedUid = position === 0 ? decision.operation_event_uid : decision.user_event_uid;
    const expectedKind = position === 0 ? "operation" : "user_text";
    if (event.event_uid !== expectedUid || relation.evidence_kind !== expectedKind) fail("identity_conflict");
    const seen = operationDecisionEvidencePositions.get(decisionUid) ?? 0;
    const bit = 1 << position;
    if (seen & bit) fail("identity_conflict");
    operationDecisionEvidencePositions.set(decisionUid, seen | bit);
    if (position === 0) {
      if (relation.evidence_kind !== "operation") fail("identity_conflict");
    } else if (
      safeInteger(relation.text_part_index) !== span.text_part_index ||
      safeInteger(relation.utf8_start) !== span.utf8_start ||
      safeInteger(relation.utf8_end) !== span.utf8_end || relation.sha256 !== span.sha256
    ) fail("identity_conflict");
    await verifyMemoryOperationEvidence(
      transaction, scope, principalUid, projectUid, event.session_uid as string, decision, undefined,
    );
    if (
      decision.proposal_sha !== memoryOperationProposalSha(
        principalUid, projectUid, event.session_uid as string, decision.memory_uid as string, decision,
      )
    ) fail("identity_conflict");
  }
  for (const [decisionUid, decision] of decisions) {
    const positions = operationDecisionEvidencePositions.get(decisionUid);
    if (Object.hasOwn(decision, "operation") ? positions !== 3 : positions !== undefined) fail("identity_conflict");
  }
  await zeroCount(transaction,
    "MATCH (e)-[r:EVIDENCED_BY]->(d:MemoryDecision) WHERE d.domain_uid = $domain_uid RETURN count(r) AS count",
    { domain_uid: domainUid },
  );

  const seenOperationGenerations = new Set<number>();
  let latestSubjectStateDecision: DataRecord | undefined;
  let latestSubjectStateGeneration = -1;
  const domainGeneration = safeInteger(domain.generation);
  for (const decision of decisions.values()) {
    if (!Object.hasOwn(decision, "operation")) continue;
    const operationGeneration = safeInteger(decision.generation);
    if (
      operationGeneration === undefined || operationGeneration > domainGeneration! ||
      seenOperationGenerations.has(operationGeneration)
    ) fail("identity_conflict");
    seenOperationGenerations.add(operationGeneration);
    if (decision.operation === "suspend" || decision.operation === "resume") {
      if (operationGeneration > latestSubjectStateGeneration) {
        latestSubjectStateGeneration = operationGeneration;
        latestSubjectStateDecision = decision;
      }
    }
  }
  if (latestSubjectStateDecision === undefined) {
    if (domain.model_save_suspended !== false || Object.hasOwn(domain, "subject_operation_decision_uid")) fail("identity_conflict");
  } else if (
    domain.subject_operation_decision_uid !== latestSubjectStateDecision.decision_uid ||
    domain.model_save_suspended !== (latestSubjectStateDecision.operation === "suspend")
  ) fail("identity_conflict");

  for (const [decisionUid, decision] of decisions) {
    const entry = memories.get(decision.memory_uid as string);
    const revision = entry?.revisions.get(decision.revision_uid as string);
    if (entry === undefined || revision === undefined) fail("identity_conflict");
    if (Object.hasOwn(decision, "operation")) {
      const expectedRevision = entry.revisions.get(decision.expected_revision_uid as string);
      if (expectedRevision === undefined) fail("identity_conflict");
      if (decision.operation === "suspend" || decision.operation === "resume") {
        if (decision.revision_uid !== decision.expected_revision_uid) fail("identity_conflict");
      } else if (decision.status === "written") {
        if (
          revision.reason !== "user_revision" || revision.decision_uid !== decisionUid ||
          revision.decision_basis_sha !== decision.proposal_sha ||
          revision.revision_uid !== uuidV5FromParts(["anima.memory-operation-revision", "v1", decision.memory_uid as string, decisionUid]) ||
          revision.operation !== decision.operation || revision.expected_revision_uid !== decision.expected_revision_uid ||
          revision.operation_event_uid !== decision.operation_event_uid || revision.user_event_uid !== decision.user_event_uid ||
          safeInteger(revision.user_span_text_part_index) !== safeInteger(decision.user_span_text_part_index) ||
          safeInteger(revision.user_span_utf8_start) !== safeInteger(decision.user_span_utf8_start) ||
          safeInteger(revision.user_span_utf8_end) !== safeInteger(decision.user_span_utf8_end) ||
          revision.user_span_sha256 !== decision.user_span_sha256 ||
          (decision.operation === "revise" && revision.statement !== decision.statement) ||
          (decision.operation === "set_expiry" && revision.valid_until !== decision.valid_until)
        ) fail("identity_conflict");
      } else if (decision.revision_uid !== decision.expected_revision_uid) {
        fail("identity_conflict");
      }
      continue;
    }
    if (decision.status === "written") {
      if (
        revision.decision_uid !== decisionUid || revision.decision_basis_sha !== decision.proposal_sha ||
        revision.revision_uid !== uuidV5FromParts(["anima.memory-revision", "v1", decision.memory_uid as string, decisionUid])
      ) fail("identity_conflict");
    } else {
      const expected = decideModelSaveIdentity({
        principal_uid: principalUid,
        project_uid: projectUid,
        subject: "user",
        kind: "claim",
        statement: revision.statement as string,
        evidence_event_uids: entry.properties.evidence_event_uids as string[],
        existing: [],
      });
      if (entry.properties.claim_key !== expected.claim_key) fail("identity_conflict");
    }
  }
  for (const [revisionUid, revision] of revisions) {
    const originalDecision = decisions.get(revision.properties.decision_uid as string);
    if (
      originalDecision === undefined || originalDecision.status !== "written" ||
      originalDecision.memory_uid !== revision.memoryUid || originalDecision.revision_uid !== revisionUid ||
      originalDecision.proposal_sha !== revision.properties.decision_basis_sha
    ) fail("identity_conflict");
  }

  return { domain, memories, decisions };
}

export async function searchScopedCurrentMemories(
  input: SearchScopedCurrentMemoriesInput,
): Promise<ProjectMemorySearchResult[]> {
  let parsed: SearchScopedCurrentMemoriesInput;
  try {
    const record = exactRecord(input, SEARCH_INPUT_FIELDS);
    const scope = exactRecord(record?.scope, SCOPE_FIELDS);
    if (
      record === undefined || typeof recordValue(record.transaction, "run") !== "function" ||
      scope === undefined || typeof scope.directory !== "string" || scope.directory.length === 0 ||
      typeof scope.principal_uid !== "string" || !UUID_V4.test(scope.principal_uid) ||
      !isUuid(record.project_uid) || typeof record.query !== "string" ||
      !Number.isSafeInteger(record.top_k) || (record.top_k as number) < 0 || !validUtcInstant(record.now)
    ) fail("invalid_input");
    parsed = {
      transaction: record.transaction as MemoryDirectEvidenceReaderTransaction,
      scope: scope as unknown as ProjectOwnershipScope,
      project_uid: record.project_uid,
      query: record.query,
      top_k: record.top_k as number,
      now: record.now,
    };
  } catch (error) {
    if (error instanceof MemoryRevisionWriteError) throw error;
    fail("invalid_input");
  }

  const query = parsed.query.normalize("NFC").trim().toLowerCase();
  if (query.length === 0 || parsed.top_k === 0) return [];

  const domainUid = uuidV5FromParts([
    "anima.memory-subject", "v1", parsed.scope.principal_uid, parsed.project_uid, "user",
  ]);
  const domainNodes = await readNodesWithProperty(parsed.transaction, "domain_uid", domainUid);
  if (domainNodes.length === 0) return [];
  const state = await loadDomainState(
    parsed.transaction,
    parsed.scope,
    domainNodes,
    parsed.scope.principal_uid,
    parsed.project_uid,
    domainUid,
  );

  const tokens = [...new Set(query.split(/\s+/u).filter((token) => token.length > 0))];
  const fallbackTerms: string[] = [];
  for (const match of query.matchAll(/\p{Script=Han}+/gu)) {
    const segment = match[0];
    const characters = Array.from(segment);
    if (characters.length <= 2) {
      fallbackTerms.push(segment);
      continue;
    }
    for (let index = 0; index < characters.length - 1; index += 1) {
      fallbackTerms.push(characters[index] + characters[index + 1]);
    }
  }
  const matches: Array<{
    result: ProjectMemorySearchResult;
    fullQueryMatch: boolean;
    tokenHits: number;
    preferredTokenHits: number;
    fallbackTokenHits: number;
    typeWeight: number;
  }> = [];
  for (const [memoryUid, entry] of state.memories) {
    if (entry.properties.state !== "active") continue;
    const currentUid = entry.properties.current_revision_uid as string;
    const revision = entry.revisions.get(currentUid);
    if (
      revision === undefined || revision.state !== "active" ||
      compareUtcInstants(revision.valid_from as string, parsed.now) > 0 ||
      (Object.hasOwn(revision, "valid_until") && compareUtcInstants(revision.valid_until as string, parsed.now) <= 0)
    ) continue;

    const isToolSave = Object.hasOwn(revision, "save_type");
    const type = isToolSave ? revision.save_type as string : "experience";
    const title = isToolSave ? revision.title as string : "";
    const narrative = isToolSave ? revision.narrative as string : revision.statement as string;
    const context = isToolSave ? revision.context as string : "";
    const principle = isToolSave ? revision.principle as string : "";
    const tags = isToolSave ? [...revision.tags as string[]] : [];
    const preferredFields = [type, title, ...tags].map((value) => value.normalize("NFC").trim().toLowerCase());
    const otherFields = [narrative, context, principle].map((value) => value.normalize("NFC").trim().toLowerCase());
    const searchable = [...preferredFields, ...otherFields];
    const fullQueryMatch = searchable.some((fieldValue) => fieldValue.includes(query));
    const matchedTokens = tokens.filter((token) => searchable.some((fieldValue) => fieldValue.includes(token)));
    let fallbackTokenHits = 0;
    if (!fullQueryMatch && matchedTokens.length === 0) {
      for (const token of fallbackTerms) {
        if (searchable.some((fieldValue) => fieldValue.includes(token))) fallbackTokenHits += 1;
      }
      if (fallbackTokenHits === 0) continue;
    }
    const preferredTokenHits = matchedTokens.filter((token) =>
      preferredFields.some((fieldValue) => fieldValue.includes(token)),
    ).length;
    matches.push({
      result: {
        id: memoryUid,
        revision_uid: currentUid,
        type,
        title,
        narrative,
        context,
        principle,
        tags,
        created_at: revision.created_at as string,
        epistemic_kind: "hypothesis",
        provenance: revision.provenance as ProjectMemorySearchResult["provenance"],
        applicability: { kind: "project", project_uid: parsed.project_uid },
      },
      fullQueryMatch,
      tokenHits: matchedTokens.length,
      preferredTokenHits,
      fallbackTokenHits,
      typeWeight: SEARCH_TYPE_WEIGHTS.get(type) ?? 1,
    });
  }

  matches.sort((left, right) =>
    Number(left.fallbackTokenHits > 0) - Number(right.fallbackTokenHits > 0) ||
    Number(right.fullQueryMatch) - Number(left.fullQueryMatch) ||
    right.tokenHits - left.tokenHits ||
    right.preferredTokenHits - left.preferredTokenHits ||
    right.fallbackTokenHits - left.fallbackTokenHits ||
    right.typeWeight - left.typeWeight ||
    compareUtcInstants(right.result.created_at, left.result.created_at) ||
    (left.result.id < right.result.id ? -1 : left.result.id > right.result.id ? 1 : 0),
  );
  return matches.slice(0, parsed.top_k).map(({ result }) => result);
}

export async function listRecentScopedCurrentMemories(
  input: ListRecentScopedCurrentMemoriesInput,
): Promise<ProjectMemorySearchResult[]> {
  let parsed: ListRecentScopedCurrentMemoriesInput;
  try {
    const record = exactRecord(input, LIST_RECENT_INPUT_FIELDS);
    const scope = exactRecord(record?.scope, SCOPE_FIELDS);
    if (
      record === undefined || typeof recordValue(record.transaction, "run") !== "function" ||
      scope === undefined || typeof scope.directory !== "string" || scope.directory.length === 0 ||
      typeof scope.principal_uid !== "string" || !UUID_V4.test(scope.principal_uid) ||
      !isUuid(record.project_uid) ||
      !Number.isSafeInteger(record.limit) || (record.limit as number) < 0 || (record.limit as number) > 5 ||
      !validUtcInstant(record.now)
    ) fail("invalid_input");
    parsed = {
      transaction: record.transaction as MemoryDirectEvidenceReaderTransaction,
      scope: scope as unknown as ProjectOwnershipScope,
      project_uid: record.project_uid,
      limit: record.limit as number,
      now: record.now,
    };
  } catch (error) {
    if (error instanceof MemoryRevisionWriteError) throw error;
    fail("invalid_input");
  }

  if (parsed.limit === 0) return [];
  const domainUid = uuidV5FromParts([
    "anima.memory-subject", "v1", parsed.scope.principal_uid, parsed.project_uid, "user",
  ]);
  const domainNodes = await readNodesWithProperty(parsed.transaction, "domain_uid", domainUid);
  if (domainNodes.length === 0) return [];
  const state = await loadDomainState(
    parsed.transaction,
    parsed.scope,
    domainNodes,
    parsed.scope.principal_uid,
    parsed.project_uid,
    domainUid,
  );
  const matches: Array<{ result: ProjectMemorySearchResult; revisionCreatedAt: string }> = [];
  for (const [memoryUid, entry] of state.memories) {
    if (entry.properties.state !== "active") continue;
    const revision = entry.revisions.get(entry.properties.current_revision_uid as string);
    if (
      revision === undefined || revision.state !== "active" ||
      compareUtcInstants(revision.valid_from as string, parsed.now) > 0 ||
      (Object.hasOwn(revision, "valid_until") && compareUtcInstants(revision.valid_until as string, parsed.now) <= 0)
    ) continue;

    const isToolSave = Object.hasOwn(revision, "save_type");
    matches.push({
      result: {
        id: memoryUid,
        revision_uid: revision.revision_uid as string,
        type: isToolSave ? revision.save_type as string : "experience",
        title: isToolSave ? revision.title as string : "",
        narrative: isToolSave ? revision.narrative as string : revision.statement as string,
        context: isToolSave ? revision.context as string : "",
        principle: isToolSave ? revision.principle as string : "",
        tags: isToolSave ? [...revision.tags as string[]] : [],
        created_at: revision.created_at as string,
        epistemic_kind: "hypothesis",
        provenance: revision.provenance as ProjectMemorySearchResult["provenance"],
        applicability: { kind: "project", project_uid: parsed.project_uid },
      },
      revisionCreatedAt: revision.created_at as string,
    });
  }
  matches.sort((left, right) =>
    compareUtcInstants(right.revisionCreatedAt, left.revisionCreatedAt) ||
    (left.result.id < right.result.id ? -1 : left.result.id > right.result.id ? 1 : 0),
  );
  return matches.slice(0, parsed.limit).map(({ result }) => result);
}

export async function createExactSpanModelMemoryRevision(
  input: CreateExactSpanModelMemoryRevisionInput,
): Promise<CreateExactSpanModelMemoryRevisionResult> {
  let parsedInput: CreateExactSpanModelMemoryRevisionInput;
  try {
    parsedInput = parseInput(input);
  } catch (error) {
    if (error instanceof MemoryRevisionWriteError) throw error;
    fail("invalid_input");
  }
  input = parsedInput;
  const statement = input.statement.normalize("NFC").trim();
  let evidence: RegisteredExternalUserTextEvidence;
  try {
    evidence = await readRegisteredExternalUserTextEvidence({
      transaction: input.transaction,
      scope: input.scope,
      project_uid: input.project_uid,
      session_uid: input.session_uid,
      event_uid: input.event_uid,
      span: input.span,
    });
  } catch (error) {
    mapEvidenceError(error);
  }
  if (statement !== evidence.text.normalize("NFC").trim()) fail("evidence_invalid");

  const principalUid = evidence.principal_uid;
  const projectUid = input.project_uid;
  const subject = "user" as const;
  const domainUid = uuidV5FromParts(["anima.memory-subject", "v1", principalUid, projectUid, subject]);
  const proposalSha = modelExactSpanProposalSha(
    principalUid,
    projectUid,
    evidence.session_uid,
    evidence.event_uid,
    {
      text_part_index: evidence.text_part_index,
      utf8_start: evidence.utf8_start,
      utf8_end: evidence.utf8_end,
      sha256: evidence.sha256,
    },
    statement,
  );
  let identity: ModelSaveIdentityResult;
  try {
    identity = decideModelSaveIdentity({
      principal_uid: principalUid,
      project_uid: projectUid,
      subject,
      kind: "claim",
      statement,
      evidence_event_uids: [input.event_uid],
      existing: [],
    });
  } catch (error) {
    if (error instanceof MemoryClaimIdentityError) fail("invalid_input");
    throw error;
  }
  const claimKey = identity.claim_key;
  const memoryUid = uuidV5FromParts(["anima.memory", "v1", claimKey]);
  const revisionUid = uuidV5FromParts(["anima.memory-revision", "v1", memoryUid, input.decision_uid]);

  const oldDecisionNodes = await readNodesWithProperty(input.transaction, "decision_uid", input.decision_uid);
  if (oldDecisionNodes.length > 1) fail("identity_conflict");
  if (oldDecisionNodes.length === 1) {
    const oldNode = oldDecisionNodes[0]!;
    if (!exactLabels(oldNode.labels, ["MemoryDecision"])) fail("identity_conflict");
    const old = oldNode.properties;
    requireProperties(old, DECISION_KEYS);
    if (
      old.decision_uid !== input.decision_uid || !isUuid(old.memory_uid) || !isUuid(old.revision_uid) ||
      typeof old.proposal_sha !== "string" || !SHA256.test(old.proposal_sha) ||
      (old.status !== "written" && old.status !== "duplicate") || !validUtcInstant(old.created_at)
    ) fail("identity_conflict");
    if (
      old.principal_uid !== principalUid || old.project_uid !== projectUid ||
      old.domain_uid !== domainUid || old.proposal_sha !== proposalSha
    ) fail("revision_conflict");
    const graphNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
    const state = await loadDomainState(input.transaction, input.scope, graphNodes, principalUid, projectUid, domainUid);
    const decision = state.decisions.get(input.decision_uid);
    if (decision === undefined || DECISION_KEYS.some((key) => decision[key] !== old[key])) fail("identity_conflict");
    if (decision.memory_uid !== memoryUid || decision.proposal_sha !== proposalSha) fail("revision_conflict");
    const target = state.memories.get(memoryUid);
    const targetRevision = target?.revisions.get(decision.revision_uid as string);
    if (target === undefined || targetRevision === undefined || target.properties.claim_key !== claimKey) fail("identity_conflict");
    if (decision.status === "written" && decision.revision_uid !== revisionUid) fail("identity_conflict");
    return {
      status: decision.status as "written" | "duplicate",
      decision_uid: input.decision_uid,
      memory_uid: memoryUid,
      revision_uid: decision.revision_uid as string,
    };
  }

  const existingNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
  let subjectCount = 0;
  for (const node of existingNodes) {
    if (!VALID_DOMAIN_LABELS.some((label) => exactLabels(node.labels, [label]))) fail("identity_conflict");
    if (exactLabels(node.labels, ["MemorySubject"])) subjectCount += 1;
  }
  if (subjectCount > 1) fail("identity_conflict");

  if (input.authorize_before_write !== undefined) await authorizeToolSaveBeforeWrite(input.authorize_before_write);
  input.markWrite();
  const merged = await input.transaction.run(
    `MERGE (domain:MemorySubject {domain_uid: $domain_uid})
     ON CREATE SET domain += $initial_properties
     SET domain.generation = domain.generation
     RETURN labels(domain) AS labels, properties(domain) AS properties`,
    {
      domain_uid: domainUid,
      initial_properties: {
        domain_uid: domainUid,
        principal_uid: principalUid,
        project_uid: projectUid,
        subject,
        model_save_suspended: false,
        generation: neo4j.int(0),
      },
    },
  );
  const mergedRows = records(merged);
  if (mergedRows.length !== 1) fail("identity_conflict");
  const domainNode = nodeSnapshot(field(mergedRows[0], "labels"), field(mergedRows[0], "properties"));
  if (domainNode === undefined) fail("identity_conflict");
  const lockedDomain = validateDomain(domainNode, principalUid, projectUid, domainUid);
  const graphNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
  const state = await loadDomainState(input.transaction, input.scope, graphNodes, principalUid, projectUid, domainUid);
  if (
    lockedDomain.model_save_suspended !== state.domain.model_save_suspended ||
    safeInteger(lockedDomain.generation) !== safeInteger(state.domain.generation)
  ) fail("identity_conflict");
  const concurrentlyCommitted = state.decisions.get(input.decision_uid);
  if (concurrentlyCommitted !== undefined) {
    if (
      concurrentlyCommitted.proposal_sha !== proposalSha ||
      concurrentlyCommitted.memory_uid !== memoryUid ||
      concurrentlyCommitted.principal_uid !== principalUid ||
      concurrentlyCommitted.project_uid !== projectUid ||
      concurrentlyCommitted.domain_uid !== domainUid
    ) fail("revision_conflict");
    const target = state.memories.get(memoryUid);
    const targetRevision = target?.revisions.get(concurrentlyCommitted.revision_uid as string);
    if (target === undefined || targetRevision === undefined || target.properties.claim_key !== claimKey) fail("identity_conflict");
    if (concurrentlyCommitted.status === "written" && concurrentlyCommitted.revision_uid !== revisionUid) fail("identity_conflict");
    return {
      status: concurrentlyCommitted.status as "written" | "duplicate",
      decision_uid: input.decision_uid,
      memory_uid: memoryUid,
      revision_uid: concurrentlyCommitted.revision_uid as string,
    };
  }
  if (lockedDomain.model_save_suspended === true) fail("confirmation_required");

  const existing = [...state.memories.values()].map(({ properties }) => ({
    claim_key: properties.claim_key as string,
    status: properties.state as "active" | "superseded" | "revoked" | "deleted",
    evidence_event_uids: properties.evidence_event_uids as string[],
  }));
  let decision: ModelSaveIdentityResult;
  try {
    decision = decideModelSaveIdentity({
      principal_uid: principalUid,
      project_uid: projectUid,
      subject,
      kind: "claim",
      statement,
      evidence_event_uids: [input.event_uid],
      existing,
    });
  } catch (error) {
    if (error instanceof MemoryClaimIdentityError) fail("identity_conflict");
    throw error;
  }
  if (decision.action === "blocked") fail("confirmation_required");

  const collisionResult = await input.transaction.run(
    "MATCH (m:Memory) WHERE m.claim_key = $claim_key OR m.memory_uid = $memory_uid RETURN labels(m) AS labels, properties(m) AS properties",
    { claim_key: claimKey, memory_uid: memoryUid },
  );
  const collisionRows = records(collisionResult);
  const sameClaim = [...state.memories.values()].find(({ properties }) => properties.claim_key === claimKey);
  if ((sameClaim === undefined && collisionRows.length !== 0) || (sameClaim !== undefined && collisionRows.length !== 1)) fail("identity_conflict");
  for (const row of collisionRows) {
    const node = nodeSnapshot(field(row, "labels"), field(row, "properties"));
    if (
      node === undefined || !exactLabels(node.labels, ["Memory"]) || node.properties.memory_uid !== memoryUid ||
      node.properties.claim_key !== claimKey || node.properties.domain_uid !== domainUid || !state.memories.has(memoryUid)
    ) fail("identity_conflict");
  }

  if (decision.action === "duplicate") {
    const target = state.memories.get(memoryUid);
    if (target === undefined || target.properties.claim_key !== claimKey || target.properties.state !== "active") fail("identity_conflict");
    const targetRevisionUid = target.properties.current_revision_uid as string;
    const targetRevision = target.revisions.get(targetRevisionUid);
    if (targetRevision === undefined) fail("identity_conflict");
    if (targetRevision.reason !== "model_exact_span" || targetRevision.statement !== statement) fail("revision_conflict");
    await input.transaction.run(
      "CREATE (d:MemoryDecision) SET d = $properties",
      {
        properties: {
          decision_uid: input.decision_uid,
          proposal_sha: proposalSha,
          principal_uid: principalUid,
          project_uid: projectUid,
          domain_uid: domainUid,
          memory_uid: memoryUid,
          revision_uid: targetRevisionUid,
          status: "duplicate",
          created_at: input.now,
        },
      },
    );
    return { status: "duplicate", decision_uid: input.decision_uid, memory_uid: memoryUid, revision_uid: targetRevisionUid };
  }

  if (state.memories.has(memoryUid)) fail("identity_conflict");
  const generation = safeInteger(lockedDomain.generation);
  if (generation === undefined || generation >= Number.MAX_SAFE_INTEGER) fail("identity_conflict");
  const revisionUidForWrite = revisionUid;
  const memoryProperties = {
    memory_uid: memoryUid,
    lineage_uid: memoryUid,
    domain_uid: domainUid,
    principal_uid: principalUid,
    project_uid: projectUid,
    subject,
    claim_key: claimKey,
    kind: "claim",
    state: "active",
    current_revision_uid: revisionUidForWrite,
    revision_number: neo4j.int(1),
    evidence_event_uids: [input.event_uid],
    created_at: input.now,
  };
  const revisionProperties = {
    revision_uid: revisionUidForWrite,
    memory_uid: memoryUid,
    lineage_uid: memoryUid,
    domain_uid: domainUid,
    principal_uid: principalUid,
    project_uid: projectUid,
    decision_uid: input.decision_uid,
    decision_basis_sha: proposalSha,
    revision_number: neo4j.int(1),
    statement,
    kind: "claim",
    reason: "model_exact_span",
    epistemic_kind: "hypothesis",
    provenance: "model_authored",
    scope: "contextual_until_reassessed",
    applicability_kind: "project",
    state: "active",
    valid_from: input.now,
    created_at: input.now,
  };
  const decisionProperties = {
    decision_uid: input.decision_uid,
    proposal_sha: proposalSha,
    principal_uid: principalUid,
    project_uid: projectUid,
    domain_uid: domainUid,
    memory_uid: memoryUid,
    revision_uid: revisionUidForWrite,
    status: "written",
    created_at: input.now,
  };
  const created = await input.transaction.run(
    `MATCH (domain:MemorySubject {domain_uid: $domain_uid}),
           (event:RawEvent {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid})
     CREATE (memory:Memory) SET memory = $memory_properties
     CREATE (revision:MemoryRevision) SET revision = $revision_properties
     CREATE (decision:MemoryDecision) SET decision = $decision_properties
     CREATE (domain)-[:HAS_MEMORY {schema_id: 'anima.memory-domain/v1'}]->(memory)
     CREATE (memory)-[:HAS_REVISION {revision_number: 1}]->(revision)
     CREATE (memory)-[:CURRENT_REVISION]->(revision)
     CREATE (revision)-[:EVIDENCED_BY {
       schema_id: 'anima.memory-evidence/v1', position: 0,
       text_part_index: $text_part_index, utf8_start: $utf8_start, utf8_end: $utf8_end, sha256: $span_sha256
     }]->(event)
     SET domain.generation = domain.generation + 1
     RETURN count(memory) AS memories, count(revision) AS revisions, count(decision) AS decisions, count(event) AS events`,
    {
      domain_uid: domainUid,
      memory_properties: memoryProperties,
      revision_properties: revisionProperties,
      decision_properties: decisionProperties,
      event_uid: input.event_uid,
      project_uid: projectUid,
      session_uid: input.session_uid,
      text_part_index: neo4j.int(input.span.text_part_index),
      utf8_start: neo4j.int(input.span.utf8_start),
      utf8_end: neo4j.int(input.span.utf8_end),
      span_sha256: input.span.sha256,
    },
  );
  const createdRows = records(created);
  if (
    createdRows.length !== 1 || safeInteger(field(createdRows[0], "memories")) !== 1 ||
    safeInteger(field(createdRows[0], "revisions")) !== 1 || safeInteger(field(createdRows[0], "decisions")) !== 1 ||
    safeInteger(field(createdRows[0], "events")) !== 1
  ) fail("identity_conflict");
  return { status: "written", decision_uid: input.decision_uid, memory_uid: memoryUid, revision_uid: revisionUidForWrite };
}

export async function createToolSaveMemoryRevision(
  input: CreateToolSaveMemoryRevisionInput,
): Promise<CreateToolSaveMemoryRevisionResult> {
  let parsedInput: CreateToolSaveMemoryRevisionInput;
  try {
    parsedInput = parseToolSaveInput(input);
  } catch (error) {
    if (error instanceof MemoryRevisionWriteError) throw error;
    fail("invalid_input");
  }
  input = parsedInput;
  let evidence: RegisteredSaveToolCallEvidence;
  try {
    evidence = await readRegisteredSaveToolCallEvidence({
      transaction: input.transaction,
      scope: input.scope,
      project_uid: input.project_uid,
      session_uid: input.session_uid,
      event_uid: input.event_uid,
      tool_call_id: input.tool_call_id,
      params: input.params,
    });
  } catch (error) {
    mapEvidenceError(error);
  }

  const principalUid = evidence.principal_uid;
  const projectUid = input.project_uid;
  const sessionUid = evidence.session_uid;
  const eventUid = evidence.event_uid;
  if (
    evidence.source_kind !== "tool_invocation" || principalUid !== input.scope.principal_uid ||
    evidence.project_uid !== projectUid || sessionUid !== input.session_uid || eventUid !== input.event_uid
  ) fail("identity_conflict");
  const expectedDecisionUid = toolSaveDecisionUid(principalUid, sessionUid, input.tool_call_id);
  if (input.decision_uid !== expectedDecisionUid) fail("invalid_input");
  const saveArgs = evidence.normalized_save_args;
  const statement = saveArgs.narrative.trim() || saveArgs.title.trim();
  const subject = "user" as const;
  const domainUid = uuidV5FromParts(["anima.memory-subject", "v1", principalUid, projectUid, subject]);
  const proposalSha = toolSaveProposalSha(
    principalUid,
    projectUid,
    sessionUid,
    eventUid,
    input.tool_call_id,
    evidence.normalized_args_sha256,
    statement,
  );
  let identity: ModelSaveIdentityResult;
  try {
    identity = decideModelSaveIdentity({
      principal_uid: principalUid,
      project_uid: projectUid,
      subject,
      kind: "claim",
      statement,
      evidence_event_uids: [eventUid],
      existing: [],
    });
  } catch (error) {
    if (error instanceof MemoryClaimIdentityError) fail("invalid_input");
    throw error;
  }
  const claimKey = identity.claim_key;
  const memoryUid = uuidV5FromParts(["anima.memory", "v1", claimKey]);
  const revisionUid = uuidV5FromParts(["anima.memory-revision", "v1", memoryUid, expectedDecisionUid]);
  if (input.authorize_before_write !== undefined) await authorizeToolSaveBeforeWrite(input.authorize_before_write);

  const oldDecisionNodes = await readNodesWithProperty(input.transaction, "decision_uid", expectedDecisionUid);
  if (oldDecisionNodes.length > 1) fail("identity_conflict");
  if (oldDecisionNodes.length === 1) {
    const oldNode = oldDecisionNodes[0]!;
    if (!exactLabels(oldNode.labels, ["MemoryDecision"])) fail("identity_conflict");
    const old = oldNode.properties;
    requireProperties(old, DECISION_KEYS);
    if (
      old.decision_uid !== expectedDecisionUid || !isUuid(old.memory_uid) || !isUuid(old.revision_uid) ||
      typeof old.proposal_sha !== "string" || !SHA256.test(old.proposal_sha) ||
      (old.status !== "written" && old.status !== "duplicate") || !validUtcInstant(old.created_at)
    ) fail("identity_conflict");
    if (
      old.principal_uid !== principalUid || old.project_uid !== projectUid ||
      old.domain_uid !== domainUid || old.proposal_sha !== proposalSha
    ) fail("revision_conflict");
    const graphNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
    const state = await loadDomainState(input.transaction, input.scope, graphNodes, principalUid, projectUid, domainUid);
    const decision = state.decisions.get(expectedDecisionUid);
    if (decision === undefined || DECISION_KEYS.some((key) => decision[key] !== old[key])) fail("identity_conflict");
    if (decision.memory_uid !== memoryUid || decision.proposal_sha !== proposalSha) fail("revision_conflict");
    const target = state.memories.get(memoryUid);
    const targetRevision = target?.revisions.get(decision.revision_uid as string);
    if (target === undefined || targetRevision === undefined || target.properties.claim_key !== claimKey) fail("identity_conflict");
    if (decision.status === "written" && decision.revision_uid !== revisionUid) fail("identity_conflict");
    return {
      status: decision.status as "written" | "duplicate",
      decision_uid: expectedDecisionUid,
      memory_uid: memoryUid,
      revision_uid: decision.revision_uid as string,
    };
  }

  const existingNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
  let subjectCount = 0;
  for (const node of existingNodes) {
    if (!VALID_DOMAIN_LABELS.some((label) => exactLabels(node.labels, [label]))) fail("identity_conflict");
    if (exactLabels(node.labels, ["MemorySubject"])) subjectCount += 1;
  }
  if (subjectCount > 1) fail("identity_conflict");

  if (input.authorize_before_write !== undefined) await authorizeToolSaveBeforeWrite(input.authorize_before_write);
  input.markWrite();
  const merged = await input.transaction.run(
    `MERGE (domain:MemorySubject {domain_uid: $domain_uid})
     ON CREATE SET domain += $initial_properties
     SET domain.generation = domain.generation
     RETURN labels(domain) AS labels, properties(domain) AS properties`,
    {
      domain_uid: domainUid,
      initial_properties: {
        domain_uid: domainUid,
        principal_uid: principalUid,
        project_uid: projectUid,
        subject,
        model_save_suspended: false,
        generation: neo4j.int(0),
      },
    },
  );
  const mergedRows = records(merged);
  if (mergedRows.length !== 1) fail("identity_conflict");
  const domainNode = nodeSnapshot(field(mergedRows[0], "labels"), field(mergedRows[0], "properties"));
  if (domainNode === undefined) fail("identity_conflict");
  const lockedDomain = validateDomain(domainNode, principalUid, projectUid, domainUid);
  const graphNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
  const state = await loadDomainState(input.transaction, input.scope, graphNodes, principalUid, projectUid, domainUid);
  if (
    lockedDomain.model_save_suspended !== state.domain.model_save_suspended ||
    safeInteger(lockedDomain.generation) !== safeInteger(state.domain.generation)
  ) fail("identity_conflict");
  const concurrentlyCommitted = state.decisions.get(expectedDecisionUid);
  if (concurrentlyCommitted !== undefined) {
    if (
      concurrentlyCommitted.proposal_sha !== proposalSha ||
      concurrentlyCommitted.memory_uid !== memoryUid ||
      concurrentlyCommitted.principal_uid !== principalUid ||
      concurrentlyCommitted.project_uid !== projectUid ||
      concurrentlyCommitted.domain_uid !== domainUid
    ) fail("revision_conflict");
    const target = state.memories.get(memoryUid);
    const targetRevision = target?.revisions.get(concurrentlyCommitted.revision_uid as string);
    if (target === undefined || targetRevision === undefined || target.properties.claim_key !== claimKey) fail("identity_conflict");
    if (concurrentlyCommitted.status === "written" && concurrentlyCommitted.revision_uid !== revisionUid) fail("identity_conflict");
    return {
      status: concurrentlyCommitted.status as "written" | "duplicate",
      decision_uid: expectedDecisionUid,
      memory_uid: memoryUid,
      revision_uid: concurrentlyCommitted.revision_uid as string,
    };
  }
  if (lockedDomain.model_save_suspended === true) fail("confirmation_required");

  const existing = [...state.memories.values()].map(({ properties }) => ({
    claim_key: properties.claim_key as string,
    status: properties.state as "active" | "superseded" | "revoked" | "deleted",
    evidence_event_uids: properties.evidence_event_uids as string[],
  }));
  let decision: ModelSaveIdentityResult;
  try {
    decision = decideModelSaveIdentity({
      principal_uid: principalUid,
      project_uid: projectUid,
      subject,
      kind: "claim",
      statement,
      evidence_event_uids: [eventUid],
      existing,
    });
  } catch (error) {
    if (error instanceof MemoryClaimIdentityError) fail("identity_conflict");
    throw error;
  }
  if (decision.action === "blocked") fail("confirmation_required");

  const collisionResult = await input.transaction.run(
    "MATCH (m:Memory) WHERE m.claim_key = $claim_key OR m.memory_uid = $memory_uid RETURN labels(m) AS labels, properties(m) AS properties",
    { claim_key: claimKey, memory_uid: memoryUid },
  );
  const collisionRows = records(collisionResult);
  const sameClaim = [...state.memories.values()].find(({ properties }) => properties.claim_key === claimKey);
  if ((sameClaim === undefined && collisionRows.length !== 0) || (sameClaim !== undefined && collisionRows.length !== 1)) fail("identity_conflict");
  for (const row of collisionRows) {
    const node = nodeSnapshot(field(row, "labels"), field(row, "properties"));
    if (
      node === undefined || !exactLabels(node.labels, ["Memory"]) || node.properties.memory_uid !== memoryUid ||
      node.properties.claim_key !== claimKey || node.properties.domain_uid !== domainUid || !state.memories.has(memoryUid)
    ) fail("identity_conflict");
  }

  if (decision.action === "duplicate") {
    const target = state.memories.get(memoryUid);
    if (target === undefined || target.properties.claim_key !== claimKey || target.properties.state !== "active") fail("identity_conflict");
    const targetRevisionUid = target.properties.current_revision_uid as string;
    const targetRevision = target.revisions.get(targetRevisionUid);
    if (targetRevision === undefined) fail("identity_conflict");
    if (targetRevision.reason !== "tool_save" || !sameToolSaveFields(targetRevision, saveArgs)) fail("revision_conflict");
    if (input.authorize_before_write !== undefined) await authorizeToolSaveBeforeWrite(input.authorize_before_write);
    await input.transaction.run(
      "CREATE (d:MemoryDecision) SET d = $properties",
      {
        properties: {
          decision_uid: expectedDecisionUid,
          proposal_sha: proposalSha,
          principal_uid: principalUid,
          project_uid: projectUid,
          domain_uid: domainUid,
          memory_uid: memoryUid,
          revision_uid: targetRevisionUid,
          status: "duplicate",
          created_at: input.now,
        },
      },
    );
    return { status: "duplicate", decision_uid: expectedDecisionUid, memory_uid: memoryUid, revision_uid: targetRevisionUid };
  }

  if (state.memories.has(memoryUid)) fail("identity_conflict");
  const generation = safeInteger(lockedDomain.generation);
  if (generation === undefined || generation >= Number.MAX_SAFE_INTEGER) fail("identity_conflict");
  const revisionProperties = {
    revision_uid: revisionUid,
    memory_uid: memoryUid,
    lineage_uid: memoryUid,
    domain_uid: domainUid,
    principal_uid: principalUid,
    project_uid: projectUid,
    decision_uid: expectedDecisionUid,
    decision_basis_sha: proposalSha,
    revision_number: neo4j.int(1),
    statement,
    kind: "claim",
    reason: "tool_save",
    epistemic_kind: "hypothesis",
    provenance: "tool_invocation",
    scope: "contextual_until_reassessed",
    applicability_kind: "project",
    state: "active",
    valid_from: input.now,
    created_at: input.now,
    ...toolSaveFields(saveArgs),
  };
  const memoryProperties = {
    memory_uid: memoryUid,
    lineage_uid: memoryUid,
    domain_uid: domainUid,
    principal_uid: principalUid,
    project_uid: projectUid,
    subject,
    claim_key: claimKey,
    kind: "claim",
    state: "active",
    current_revision_uid: revisionUid,
    revision_number: neo4j.int(1),
    evidence_event_uids: [eventUid],
    created_at: input.now,
  };
  const decisionProperties = {
    decision_uid: expectedDecisionUid,
    proposal_sha: proposalSha,
    principal_uid: principalUid,
    project_uid: projectUid,
    domain_uid: domainUid,
    memory_uid: memoryUid,
    revision_uid: revisionUid,
    status: "written",
    created_at: input.now,
  };
  if (input.authorize_before_write !== undefined) await authorizeToolSaveBeforeWrite(input.authorize_before_write);
  const created = await input.transaction.run(
    `MATCH (domain:MemorySubject {domain_uid: $domain_uid}),
           (event:RawEvent:ToolCall {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid})
     CREATE (memory:Memory) SET memory = $memory_properties
     CREATE (revision:MemoryRevision) SET revision = $revision_properties
     CREATE (decision:MemoryDecision) SET decision = $decision_properties
     CREATE (domain)-[:HAS_MEMORY {schema_id: 'anima.memory-domain/v1'}]->(memory)
     CREATE (memory)-[:HAS_REVISION {revision_number: 1}]->(revision)
     CREATE (memory)-[:CURRENT_REVISION]->(revision)
     CREATE (revision)-[:EVIDENCED_BY {
       schema_id: 'anima.memory-evidence/v1', position: 0, json_part_index: 0,
       tool_call_id: $tool_call_id, normalized_args_sha256: $normalized_args_sha256
     }]->(event)
     SET domain.generation = domain.generation + 1
     RETURN count(memory) AS memories, count(revision) AS revisions, count(decision) AS decisions, count(event) AS events`,
    {
      domain_uid: domainUid,
      memory_properties: memoryProperties,
      revision_properties: revisionProperties,
      decision_properties: decisionProperties,
      event_uid: eventUid,
      project_uid: projectUid,
      session_uid: sessionUid,
      tool_call_id: input.tool_call_id,
      normalized_args_sha256: evidence.normalized_args_sha256,
    },
  );
  const createdRows = records(created);
  if (
    createdRows.length !== 1 || safeInteger(field(createdRows[0], "memories")) !== 1 ||
    safeInteger(field(createdRows[0], "revisions")) !== 1 || safeInteger(field(createdRows[0], "decisions")) !== 1 ||
    safeInteger(field(createdRows[0], "events")) !== 1
  ) fail("identity_conflict");
  return { status: "written", decision_uid: expectedDecisionUid, memory_uid: memoryUid, revision_uid: revisionUid };
}

export async function applyMemoryOperationRevision(
  input: CreateMemoryOperationRevisionInput,
): Promise<MemoryOperationResult> {
  let parsed: CreateMemoryOperationRevisionInput;
  try {
    parsed = parseMemoryOperationInput(input);
  } catch (error) {
    if (error instanceof MemoryRevisionWriteError) throw error;
    fail("invalid_input");
  }
  input = parsed;
  const principalUid = input.scope.principal_uid;
  const projectUid = input.project_uid;
  const domainUid = uuidV5FromParts(["anima.memory-subject", "v1", principalUid, projectUid, "user"]);
  const subjectNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
  if (subjectNodes.length === 0) fail("revision_conflict");
  if (subjectNodes.filter((node) => exactLabels(node.labels, ["MemorySubject"])).length !== 1) fail("identity_conflict");

  await authorizeMemoryOperationWrite(input);
  input.markWrite();
  const lockResult = await input.transaction.run(
    `MATCH (domain:MemorySubject {domain_uid: $domain_uid})
     SET domain.generation = domain.generation
     RETURN labels(domain) AS labels, properties(domain) AS properties`,
    { domain_uid: domainUid },
  );
  const lockRows = records(lockResult);
  if (lockRows.length !== 1) fail("identity_conflict");
  const lockedNode = nodeSnapshot(field(lockRows[0], "labels"), field(lockRows[0], "properties"));
  if (lockedNode === undefined) fail("identity_conflict");
  const lockedDomain = validateDomain(lockedNode, principalUid, projectUid, domainUid);
  const graphNodes = await readNodesWithProperty(input.transaction, "domain_uid", domainUid);
  const state = await loadDomainState(input.transaction, input.scope, graphNodes, principalUid, projectUid, domainUid);
  if (
    lockedDomain.model_save_suspended !== state.domain.model_save_suspended ||
    safeInteger(lockedDomain.generation) !== safeInteger(state.domain.generation)
  ) fail("identity_conflict");
  const target = state.memories.get(input.memory_uid);
  if (target === undefined) fail("revision_conflict");
  const previousRevisionUid = target.properties.current_revision_uid as string;
  const previousRevision = target.revisions.get(previousRevisionUid);
  if (previousRevision === undefined) fail("identity_conflict");
  const normalizedStatement = input.action === "revise" ? input.statement!.normalize("NFC").trim() : undefined;
  const operationProperties: DataRecord = {
    memory_uid: input.memory_uid,
    operation: input.action,
    expected_revision_uid: input.expected_revision_uid,
    operation_event_uid: input.operation_event_uid,
    user_event_uid: input.user_event_uid,
    user_span_text_part_index: neo4j.int(input.user_span.text_part_index),
    user_span_utf8_start: neo4j.int(input.user_span.utf8_start),
    user_span_utf8_end: neo4j.int(input.user_span.utf8_end),
    user_span_sha256: input.user_span.sha256,
    ...(input.action === "revise" ? { statement: normalizedStatement } : {}),
    ...(input.action === "set_expiry" ? { valid_until: input.valid_until } : {}),
  };
  let verifiedEvidence: VerifiedOperationEvidence;
  try {
    verifiedEvidence = await verifyMemoryOperationEvidence(
      input.transaction, input.scope, principalUid, projectUid, input.session_uid, operationProperties, input.tool_call_id,
    );
  } catch (error) {
    if (error instanceof MemoryRevisionWriteError) throw error;
    fail("evidence_invalid");
  }
  if (
    input.action === "revise" &&
    verifiedEvidence.user_text.normalize("NFC").trim() !== normalizedStatement
  ) fail("evidence_invalid");
  const proposalSha = memoryOperationProposalSha(
    principalUid, projectUid, input.session_uid, input.memory_uid, operationProperties,
  );
  const oldDecisionNodes = await readNodesWithProperty(input.transaction, "decision_uid", input.decision_uid);
  if (oldDecisionNodes.length > 1) fail("identity_conflict");
  const existingDecision = state.decisions.get(input.decision_uid);
  if (existingDecision !== undefined) {
    if (
      existingDecision.proposal_sha !== proposalSha ||
      existingDecision.principal_uid !== principalUid || existingDecision.project_uid !== projectUid ||
      existingDecision.domain_uid !== domainUid || existingDecision.memory_uid !== input.memory_uid
    ) fail("revision_conflict");
    return {
      status: existingDecision.status as "written" | "duplicate",
      decision_uid: input.decision_uid,
      memory_uid: input.memory_uid,
      revision_uid: existingDecision.revision_uid as string,
    };
  }
  if (oldDecisionNodes.length !== 0) {
    const old = oldDecisionNodes[0]!;
    if (!exactLabels(old.labels, ["MemoryDecision"])) fail("identity_conflict");
    fail("revision_conflict");
  }
  if (previousRevisionUid !== input.expected_revision_uid) fail("revision_conflict");
  if (
    target.properties.state === "deleted" || target.properties.state === "superseded" ||
    ((input.action === "revise" || input.action === "set_expiry") && target.properties.state === "revoked")
  ) fail("revision_conflict");
  const generation = safeInteger(state.domain.generation);
  if (generation === undefined || generation >= Number.MAX_SAFE_INTEGER) fail("identity_conflict");
  const nextGeneration = generation + 1;


  if ((input.action === "revise" || input.action === "revoke" || input.action === "set_expiry") &&
      !(input.action === "revoke" && target.properties.state === "revoked") &&
      (compareUtcInstants(input.now, previousRevision.valid_from as string) < 0 ||
       (typeof previousRevision.valid_until === "string" && compareUtcInstants(input.now, previousRevision.valid_until) >= 0))) {
    fail("revision_conflict");
  }
  const isSubjectStateOperation = input.action === "suspend" || input.action === "resume";
  const noStateChange =
    (input.action === "suspend" && state.domain.model_save_suspended === true) ||
    (input.action === "resume" && state.domain.model_save_suspended === false) ||
    (input.action === "revoke" && target.properties.state === "revoked");
  const resultStatus = noStateChange ? "duplicate" : "written";
  const revisionUid = noStateChange || isSubjectStateOperation
    ? previousRevisionUid
    : uuidV5FromParts(["anima.memory-operation-revision", "v1", input.memory_uid, input.decision_uid]);
  const decisionProperties: DataRecord = {
    decision_uid: input.decision_uid,
    proposal_sha: proposalSha,
    principal_uid: principalUid,
    project_uid: projectUid,
    domain_uid: domainUid,
    memory_uid: input.memory_uid,
    revision_uid: revisionUid,
    status: resultStatus,
    created_at: input.now,
    ...operationProperties,
    generation: neo4j.int(nextGeneration),
  };
  const opRelation = operationEvidenceRelation(0, "operation", input.user_span);
  const textRelation = operationEvidenceRelation(1, "user_text", input.user_span);

  await authorizeMemoryOperationWrite(input);
  if (isSubjectStateOperation || noStateChange) {
    const suspended = input.action === "suspend"
      ? true
      : input.action === "resume"
        ? false
        : state.domain.model_save_suspended as boolean;
    const result = await input.transaction.run(
      `MATCH (domain:MemorySubject {domain_uid: $domain_uid}),
             (memory:Memory {memory_uid: $memory_uid, domain_uid: $domain_uid}),
             (revision:MemoryRevision {revision_uid: $expected_revision_uid, memory_uid: $memory_uid, domain_uid: $domain_uid}),
             (operation:RawEvent {event_uid: $operation_event_uid, project_uid: $project_uid, session_uid: $session_uid}),
             (user:RawEvent {event_uid: $user_event_uid, project_uid: $project_uid, session_uid: $session_uid})
       WHERE memory.current_revision_uid = $expected_revision_uid
       CREATE (decision:MemoryDecision) SET decision = $decision_properties
       CREATE (decision)-[operationEvidence:EVIDENCED_BY]->(operation)
       SET operationEvidence = $operation_relation
       CREATE (decision)-[userEvidence:EVIDENCED_BY]->(user)
       SET userEvidence = $user_relation
       SET domain.model_save_suspended = $suspended,
           domain.subject_operation_decision_uid = CASE WHEN $record_subject_state THEN $decision_uid ELSE domain.subject_operation_decision_uid END,
           domain.generation = domain.generation + 1
       RETURN count(decision) AS decisions, count(operation) AS operation_events, count(user) AS user_events`,
      {
        domain_uid: domainUid,
        memory_uid: input.memory_uid,
        expected_revision_uid: input.expected_revision_uid,
        operation_event_uid: input.operation_event_uid,
        user_event_uid: input.user_event_uid,
        project_uid: projectUid,
        session_uid: input.session_uid,
        decision_properties: decisionProperties,
        operation_relation: opRelation,
        user_relation: textRelation,
        suspended,
        record_subject_state: isSubjectStateOperation,
        decision_uid: input.decision_uid,
      },
    );
    const rows = records(result);
    if (
      rows.length !== 1 || safeInteger(field(rows[0], "decisions")) !== 1 ||
      safeInteger(field(rows[0], "operation_events")) !== 1 || safeInteger(field(rows[0], "user_events")) !== 1
    ) fail("identity_conflict");
    return { status: resultStatus, decision_uid: input.decision_uid, memory_uid: input.memory_uid, revision_uid: revisionUid };
  }

  const oldRevisionNumber = safeInteger(target.properties.revision_number);
  if (oldRevisionNumber === undefined || oldRevisionNumber >= Number.MAX_SAFE_INTEGER) fail("identity_conflict");
  const nextRevisionNumber = oldRevisionNumber + 1;
  const newState = input.action === "revoke" ? "revoked" : "active";
  const revisionStatement = input.action === "revise"
    ? normalizedStatement!
    : previousRevision.statement as string;
  const revisionProperties: DataRecord = {
    revision_uid: revisionUid,
    memory_uid: input.memory_uid,
    lineage_uid: target.properties.lineage_uid,
    domain_uid: domainUid,
    principal_uid: principalUid,
    project_uid: projectUid,
    decision_uid: input.decision_uid,
    decision_basis_sha: proposalSha,
    revision_number: neo4j.int(nextRevisionNumber),
    statement: revisionStatement,
    kind: target.properties.kind,
    reason: "user_revision",
    epistemic_kind: "hypothesis",
    provenance: "user_operation",
    scope: "contextual_until_reassessed",
    applicability_kind: "project",
    state: newState,
    valid_from: input.now,
    created_at: input.now,
    operation: input.action,
    expected_revision_uid: input.expected_revision_uid,
    operation_event_uid: input.operation_event_uid,
    user_event_uid: input.user_event_uid,
    user_span_text_part_index: neo4j.int(input.user_span.text_part_index),
    user_span_utf8_start: neo4j.int(input.user_span.utf8_start),
    user_span_utf8_end: neo4j.int(input.user_span.utf8_end),
    user_span_sha256: input.user_span.sha256,
    ...(input.action === "set_expiry"
      ? { valid_until: input.valid_until }
      : Object.hasOwn(previousRevision, "valid_until") ? { valid_until: previousRevision.valid_until } : {}),
    ...(Object.hasOwn(previousRevision, "save_type")
      ? Object.fromEntries(TOOL_SAVE_FIELDS.map((key) => [
        key, key === "narrative" && input.action === "revise" ? normalizedStatement : previousRevision[key],
      ]))
      : {}),
  };
  const memoryEvidenceUids = [...new Set([
    ...(target.properties.evidence_event_uids as string[]),
    input.operation_event_uid,
    input.user_event_uid,
  ])];
  const created = await input.transaction.run(
    `MATCH (domain:MemorySubject {domain_uid: $domain_uid}),
           (memory:Memory {memory_uid: $memory_uid, domain_uid: $domain_uid})-[current:CURRENT_REVISION]->(previous:MemoryRevision {revision_uid: $expected_revision_uid, memory_uid: $memory_uid, domain_uid: $domain_uid}),
           (operation:RawEvent {event_uid: $operation_event_uid, project_uid: $project_uid, session_uid: $session_uid}),
           (user:RawEvent {event_uid: $user_event_uid, project_uid: $project_uid, session_uid: $session_uid})
     CREATE (revision:MemoryRevision) SET revision = $revision_properties
     CREATE (decision:MemoryDecision) SET decision = $decision_properties
     CREATE (memory)-[:HAS_REVISION {revision_number: $revision_number}]->(revision)
     DELETE current
     CREATE (memory)-[:CURRENT_REVISION]->(revision)
     CREATE (revision)-[operationEvidence:EVIDENCED_BY]->(operation)
     SET operationEvidence = $operation_relation
     CREATE (revision)-[userEvidence:EVIDENCED_BY]->(user)
     SET userEvidence = $user_relation
     CREATE (decision)-[decisionOperationEvidence:EVIDENCED_BY]->(operation)
     SET decisionOperationEvidence = $operation_relation
     CREATE (decision)-[decisionUserEvidence:EVIDENCED_BY]->(user)
     SET decisionUserEvidence = $user_relation
     SET memory.current_revision_uid = $revision_uid,
         memory.revision_number = $revision_number,
         memory.state = $memory_state,
         memory.evidence_event_uids = $evidence_event_uids,
         domain.generation = domain.generation + 1
     RETURN count(revision) AS revisions, count(decision) AS decisions,
            count(operation) AS operation_events, count(user) AS user_events`,
    {
      domain_uid: domainUid,
      memory_uid: input.memory_uid,
      expected_revision_uid: input.expected_revision_uid,
      operation_event_uid: input.operation_event_uid,
      user_event_uid: input.user_event_uid,
      project_uid: projectUid,
      session_uid: input.session_uid,
      revision_uid: revisionUid,
      revision_number: neo4j.int(nextRevisionNumber),
      memory_state: newState,
      evidence_event_uids: memoryEvidenceUids,
      revision_properties: revisionProperties,
      decision_properties: decisionProperties,
      operation_relation: opRelation,
      user_relation: textRelation,
    },
  );
  const rows = records(created);
  if (
    rows.length !== 1 || safeInteger(field(rows[0], "revisions")) !== 1 ||
    safeInteger(field(rows[0], "decisions")) !== 1 ||
    safeInteger(field(rows[0], "operation_events")) !== 1 ||
    safeInteger(field(rows[0], "user_events")) !== 1
  ) fail("identity_conflict");
  return { status: "written", decision_uid: input.decision_uid, memory_uid: input.memory_uid, revision_uid: revisionUid };
}
