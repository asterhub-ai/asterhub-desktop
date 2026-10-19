import neo4j from "neo4j-driver";
import type * as Neo4j from "neo4j-driver";
import { createHash, randomUUID } from "node:crypto";
import { loadConfig as defaultLoadConfig, type ConfigLoadResult, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import { canonicalize } from "json-canonicalize";
import { boundaryCursorUid, boundaryWindowUid, sessionContinuationDecisionUid } from "./ids.ts";
import {
  BoundaryProjectorError,
  type BoundaryProjectorEvent,
  type BoundaryProjectorPlan,
  type BoundaryProjectorInput,
  type BoundaryWindowSnapshot,
  projectBoundary,
} from "./boundary-projector.ts";
import { BOUNDARY_PROJECTOR_VERSION, EXECUTION_PROJECTOR_VERSION } from "./version.ts";
import { episodeDecisionUid, episodeUid } from "./episode-ids.ts";
import { projectEpisode } from "./episode-projector.ts";
import {
  EpisodeProjectorError,
  type EpisodeBoundaryEvidenceFact,
  type EpisodeClosureFacts,
  type EpisodeContinuationFact,
  type EpisodeSnapshot,
  type EpisodeSuccessfulResultEvidenceFact,
  type EpisodeWindowFact,
  type MaterializeEpisodeClosureInput,
  type MaterializeEpisodeInput,
  type MaterializeEpisodeResult,
  type ProjectEpisodePlan,
} from "./episode-types.ts";
import { ExecutionProjectorError, projectExecutionUnits } from "./execution-projector.ts";
import { projectExecutionReviewCandidates, ExecutionReviewCandidateProjectorError } from "./execution-review-candidate-projector.ts";
import { buildExecutionReviewModelInput } from "./execution-review-input-projector.ts";
import { buildExecutionReviewPlan } from "./execution-review-projector.ts";
import { projectTaskDigest, TaskDigestProjectorError, type TaskDigestProjectionInput } from "./task-digest-projector.ts";
import type { TaskDigest } from "./task-digest-types.ts";
import { readExecutionCandidateSource, type ExecutionCandidateSource } from "./execution-candidate-source-reader.ts";
import { buildAutomaticReflectionBatches, AutomaticReflectionBatchSizeError } from "./automatic-reflection-batches.ts";
import { buildManualCandidateReflectionInput, buildAutomaticReflectionInput } from "./reflection-input-projector.ts";
import { buildManualReflectionPlan, buildAutomaticReflectionPlan, projectAutomaticReflectionModelPlan } from "./reflection-plan-projector.ts";
import { materializeReflectionPlan, materializeManualReflectionPlan, ReflectionMaterializationError } from "./reflection-neo4j-materializer.ts";
import type { ReflectionPersistencePlan } from "./reflection-persistence-types.ts";
import { ReflectionModelContractError, type ReflectionModelAdapter } from "./reflection-model-types.ts";
import { readScopedProjectReflections, ReflectionReadError } from "./reflection-read.ts";
import {
  automaticReflectionScheduleCursorUid,
} from "./automatic-reflection-ids.ts";
import {
  AUTOMATIC_REFLECTION_COMPLETE_PERIOD,
  AUTOMATIC_REFLECTION_KINDS,
  AUTOMATIC_REFLECTION_TIMEZONE,
  automaticReflectionSelector,
  nextAutomaticCursorPeriod,
  parseInstant,
  periodKeyContaining,
  selectorContains,
  selectorDueAt,
  type AutomaticReflectionCursorPeriod,
  type AutomaticReflectionKind,
  type AutomaticReflectionSelector,
} from "./reflection-calendar.ts";
import type { AutomaticReflectionInput } from "./reflection-input-types.ts";
import {
  DAILY_REFLECTION_PROMPT_CONTRACT,
  MONTHLY_REFLECTION_PROMPT_CONTRACT,
  WEEKLY_REFLECTION_PROMPT_CONTRACT,
} from "./reflection-prompt.ts";
import {
  applyMemoryOperationRevision,
  createExactSpanModelMemoryRevision,
  createToolSaveMemoryRevision as writeToolSaveMemoryRevision,
  MemoryRevisionWriteError,
  searchScopedCurrentMemories,
  listRecentScopedCurrentMemories,
} from "./memory-revision-writer.ts";
import { normalizeSaveToolArgs } from "./memory-tool-call-evidence.ts";
import type { MemoryDirectEvidenceReaderTransaction } from "./memory-direct-evidence-reader.ts";
import { listProjectOwnership, type ProjectOwnershipRecord, type ProjectOwnershipScope } from "./project-ownership.ts";
import { AUTOMATIC_REFLECTION_MAX_ATTEMPTS_PER_PROJECT_RUN } from "./automatic-reflection-types.ts";
import type {
  AutomaticReflectionAttempt,
  AutomaticReflectionAttemptCode,
  AutomaticReflectionScheduleCursor,
  RunDueAutomaticReflectionsInput,
  RunDueAutomaticReflectionsResult,
} from "./automatic-reflection-types.ts";
import type { ExecutionRole, ExecutionSourceEvent, ExecutionUnitPlan, ExecutionUnitSnapshot, ProjectExecutionUnitsPlan } from "./execution-types.ts";
import type {
  ExecutionReviewModelAdapter,
  ExecutionReviewOperationResult,
  ReviewCandidateSourceEvent,
  ReviewExecutionCandidateInput,
  ExecutionReviewCandidateWorkflow,
  ExecutionReviewPlan,
} from "./execution-review-types.ts";
import type { ExecutionReviewCandidateSnapshot, ProjectExecutionReviewCandidatesPlan } from "./execution-review-candidate-types.ts";
import type {
  CreateExactSpanModelMemoryInput,
  CreateExactSpanModelMemoryResult,
  CreateToolSaveMemoryInput,
  CreateToolSaveMemoryResult,
  SearchProjectMemoriesInput,
  SearchProjectMemoriesResult,
  ListRecentProjectMemoriesInput,
  ListRecentProjectMemoriesResult,
  ListProjectReflectionsInput,
  ListProjectReflectionsResult,
  ListSessionReviewCandidatesInput,
  ListSessionReviewCandidatesResult,
  MemoryOperationInput,
  MemoryOperationResult,
  GetTaskDigestInput,
  GetTaskDigestResult,
  MaterializeExecutionReviewCandidatesInput,
  MaterializeExecutionReviewCandidatesResult,
  MaterializeExecutionUnitsInput,
  MaterializeExecutionUnitsResult,
  MemoryStore,
  MemoryStoreHealth,
  ProcessSessionInput,
  ProcessSessionResult,
  RecordSessionContinuationInput,
  RecordSessionContinuationResult,
  ReflectManualCandidateInput,
  ReflectManualCandidateResult,
} from "./types.ts";

export interface Neo4jMemoryStoreOptions {
  configPath?: string;
  shutdown_timeout_ms?: number;
  loadConfig?: (configPath?: string) => Promise<ConfigLoadResult>;
  driverFactory?: (config: Neo4jConfig) => Neo4j.Driver;
  reviewModelAdapter?: ExecutionReviewModelAdapter;
  review_model_adapter?: ExecutionReviewModelAdapter;
  reflectionModelAdapter?: ReflectionModelAdapter;
  reflection_model_adapter?: ReflectionModelAdapter;
  projectOwnership?: ProjectOwnershipScope;
  authorizeAutomaticBeforeWrite?: (project_uid: string) => Promise<string | undefined>;
}
const EXPECTED_CONSTRAINTS = [
  { name: "anima_project_uid_unique", label: "Project", property: "project_uid" },
  { name: "anima_session_uid_unique", label: "Session", property: "session_uid" },
  { name: "anima_raw_event_uid_unique", label: "RawEvent", property: "event_uid" },
  { name: "anima_boundary_window_uid_unique", label: "BoundaryWindow", property: "window_uid" },
  { name: "anima_memory_cursor_uid_unique", label: "MemoryCursor", property: "cursor_uid" },
  { name: "anima_episode_uid_unique", label: "Episode", property: "episode_uid" },
  { name: "anima_execution_unit_uid_unique", label: "ExecutionUnit", property: "execution_uid" },
  { name: "anima_execution_review_candidate_uid_unique", label: "ExecutionReviewCandidate", property: "candidate_uid" },
  { name: "anima_execution_review_uid_unique", label: "ExecutionReview", property: "review_uid" },
  { name: "anima_reflection_uid_unique", label: "Reflection", property: "reflection_uid" },
  { name: "anima_reflection_schedule_cursor_uid_unique", label: "ReflectionScheduleCursor", property: "cursor_uid" },
  { name: "anima_memory_subject_uid_unique", label: "MemorySubject", property: "domain_uid" },
  { name: "anima_memory_uid_unique", label: "Memory", property: "memory_uid" },
  { name: "anima_memory_claim_key_unique", label: "Memory", property: "claim_key" },
  { name: "anima_memory_revision_uid_unique", label: "MemoryRevision", property: "revision_uid" },
  { name: "anima_memory_decision_uid_unique", label: "MemoryDecision", property: "decision_uid" },
] as const;

const HEALTH_CONSTRAINTS = [
  "anima_project_uid_unique",
  "anima_session_uid_unique",
  "anima_raw_event_uid_unique",
  "anima_boundary_window_uid_unique",
  "anima_memory_cursor_uid_unique",
  "anima_episode_uid_unique",
  "anima_execution_unit_uid_unique",
  "anima_execution_review_candidate_uid_unique",
  "anima_execution_review_uid_unique",
  "anima_reflection_uid_unique",
  "anima_reflection_schedule_cursor_uid_unique",
  "anima_memory_subject_uid_unique",
  "anima_memory_uid_unique",
  "anima_memory_claim_key_unique",
  "anima_memory_revision_uid_unique",
  "anima_memory_decision_uid_unique",
] as const;


const CANDIDATE_NODE_KEYS = [
  "candidate_uid",
  "execution_uid",
  "project_uid",
  "session_uid",
  "review_contract_version",
  "execution_state",
  "terminal_reason",
  "source_fingerprint",
  "tool_call_count",
  "tool_result_count",
  "tool_error_count",
  "state",
  "created_at",
] as const;


const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_V4_OR_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

const CLOSED_MESSAGE = "Memory store is closed." as const;
const DATABASE_ERROR_MESSAGE = "Neo4j write failed before the memory write boundary." as const;
const UNKNOWN_WRITE_MESSAGE = "Neo4j write outcome is unknown." as const;

const INVALID_MESSAGE = "Memory store input is invalid." as const;
const NOT_FOUND_MESSAGE = "Requested Capture entity was not found." as const;
const IDENTITY_CONFLICT_MESSAGE = "Memory identity or provenance conflicts with Capture." as const;
const SOURCE_INCOMPLETE_MESSAGE = "Capture source is incomplete." as const;
interface QueryRecord {
  get(key: string): unknown;
}

const EVIDENCE_INVALID_MESSAGE = "Continuation evidence is invalid." as const;
const DEGRADED_MESSAGE = "Memory store is degraded." as const;
const REVISION_CONFLICT_MESSAGE = "Memory decision conflicts with an existing decision." as const;
const CONFIRMATION_REQUIRED_MESSAGE = "This memory subject requires user confirmation." as const;
const EPISODE_NOT_FOUND_MESSAGE = "Requested Episode source was not found." as const;
const EPISODE_SOURCE_INCOMPLETE_MESSAGE = "Episode source is incomplete." as const;
const EPISODE_EVIDENCE_INVALID_MESSAGE = "Episode evidence is invalid." as const;
const EPISODE_IDENTITY_CONFLICT_MESSAGE = "Episode identity or provenance conflicts." as const;
const INVALID_TRANSITION_MESSAGE = "Episode transition is invalid." as const;

interface QueryCounters {
  updates(): { nodesCreated?: unknown };
}

interface QuerySummary {
  counters?: QueryCounters;
}

interface QueryResult {
  records: QueryRecord[];
  summary?: QuerySummary;
}

interface AutomaticInternalResult {
  status: "automatic_internal";
}

interface AutomaticAbortResult {
  status: "automatic_error";
  code: AutomaticReflectionAttemptCode;
  message: string;
}

type StoreResult =
  | ProcessSessionResult
  | RecordSessionContinuationResult
  | CreateExactSpanModelMemoryResult
  | ListRecentProjectMemoriesResult
  | ListProjectReflectionsResult
  | ListSessionReviewCandidatesResult
  | CreateToolSaveMemoryResult
  | SearchProjectMemoriesResult
  | MemoryOperationResult
  | MaterializeEpisodeResult
  | MaterializeExecutionUnitsResult
  | MaterializeExecutionReviewCandidatesResult
  | ExecutionReviewOperationResult
  | GetTaskDigestResult
  | ReflectManualCandidateResult
  | AutomaticInternalResult
  | AutomaticAbortResult;
interface TxLike {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
}

interface SessionLike {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
  executeRead?<T>(work: (transaction: TxLike) => Promise<T>): Promise<T>;
  executeWrite?<T>(work: (transaction: TxLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface NodeProperties {
  [key: string]: unknown;
}

interface CursorState {
  cursor_uid: string;
  project_uid: string;
  session_uid: string;
  projector_version: string;
  last_ingest_sequence: number;
  open_window_uid?: string;
  open_window_start_sequence?: number;
}

interface SourceSnapshot {
  project: NodeProperties;
  session: NodeProperties;
  events: BoundaryProjectorEvent[];
  next_ingest_sequence: number;
  cursor?: CursorState;
}

interface AutomaticCursorState extends AutomaticReflectionScheduleCursor {}

interface AutomaticCandidateTerminalRow {
  candidate_uid: string;
  terminal_captured_at: string;
}

interface AutomaticSlot {
  kind: AutomaticReflectionKind;
  period_key: string;
  due_at: string;
}

interface AutomaticTopologyNode {
  element_id: string;
  labels: unknown;
  keys: unknown;
  properties: unknown;
}

interface AutomaticTopologyNode {
  element_id: string;
  labels: unknown;
  keys: unknown;
  properties: unknown;
}

interface AutomaticTopologyOutgoing extends AutomaticTopologyNode {
  link_properties: unknown;
}

interface AutomaticTopologyIncoming {
  owner_element_id: string;
  owner_labels: unknown;
  owner_properties: unknown;
  target_element_id: string;
  target_labels: unknown;
  target_keys: unknown;
  target_properties: unknown;
  link_properties: unknown;
}


class AutomaticAbortError extends Error {
  readonly result: AutomaticAbortResult;

  constructor(code: AutomaticReflectionAttemptCode, message: string) {
    super(message);
    this.name = "AutomaticAbortError";
    this.result = { status: "automatic_error", code, message };
  }
}
interface PreflightSnapshot {
  source: SourceSnapshot;
  has_work: boolean;
}

interface ReviewClaim {
  candidate: ExecutionReviewCandidateWorkflow;
  lease_token: string;
  source_events: readonly ReviewCandidateSourceEvent[];
  terminal?: { skip_reason: string };
  busy?: true;
}


type EpisodeObservation =
  | { present: false }
  | { present: true; revision: number; last_decision_uid: string }
  | { present: true; invalid: true };

interface EpisodeSourceSnapshot {
  project: unknown;
  sessions: unknown[];
  windows: unknown[];
  events: unknown[];
  continuations: unknown[];
}
interface EpisodePass {
  observation: EpisodeObservation;
  episode?: EpisodeSnapshot;
  windows: [EpisodeWindowFact, ...EpisodeWindowFact[]];
  continuations: readonly EpisodeContinuationFact[];
  closure: EpisodeClosureFacts;
  source_snapshot: EpisodeSourceSnapshot;
  deferred_identity_conflict?: boolean;
}
interface EpisodeContinuationLoad {
  facts: readonly EpisodeContinuationFact[];
  identityConflict: boolean;
  source_snapshot: unknown[];
}
interface EpisodeClosureLoad {
  closure: EpisodeClosureFacts;
  identityConflict: boolean;
}
interface ValidMaterializeInput {
  kind: "valid";
  input: MaterializeEpisodeInput;
}

interface InvalidMaterializeInput {
  kind: "invalid";
  result: MaterializeEpisodeResult;
}

class StoreDomainError extends Error {
  readonly code:
    | "invalid_input"
    | "not_found"
    | "source_incomplete"
    | "identity_conflict"
    | "evidence_invalid"
    | "revision_conflict"
    | "confirmation_required"
    | "invalid_transition"
    | "core_closed"
    | "core_degraded";

  constructor(
    code: StoreDomainError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StoreDomainError";
    this.code = code;
  }
}

class TransactionAbort extends Error {
  readonly result: StoreResult;

  constructor(result: StoreResult) {
    super("Memory transaction rejected.");
    this.name = "TransactionAbort";
    this.result = result;
  }
}

class ConcurrentEpisodeMatch extends Error {
  constructor() {
    super("Concurrent Episode creation matched an existing node.");
    this.name = "ConcurrentEpisodeMatch";
  }
}

function field(record: QueryRecord | undefined, key: string): unknown {
  if (record === undefined) return undefined;
  try {
    return record.get(key);
  } catch {
    return undefined;
  }
}

function recordNode(record: QueryRecord | undefined, key: string): NodeProperties | undefined {
  const value = field(record, key);
  if (!isRecord(value)) return undefined;
  const properties = value.properties;
  if (!isRecord(properties)) return undefined;
  return properties;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function propertyEquals(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") return numberValue(actual) === expected;
  return actual === expected;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") return [value];
  return [];
}

function hasExpectedConstraint(record: QueryRecord, expected: (typeof EXPECTED_CONSTRAINTS)[number]): boolean {
  const name = field(record, "name");
  const type = field(record, "type");
  const entityType = field(record, "entityType");
  return (
    name === expected.name &&
    String(type).toUpperCase() === "UNIQUENESS" &&
    String(entityType).toUpperCase() === "NODE" &&
    stringArray(field(record, "labelsOrTypes")).length === 1 &&
    stringArray(field(record, "labelsOrTypes"))[0] === expected.label &&
    stringArray(field(record, "properties")).length === 1 &&
    stringArray(field(record, "properties"))[0] === expected.property
  );
}

function equalIdentity(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return left.execution_uid === right.execution_uid && left.project_uid === right.project_uid && left.session_uid === right.session_uid;
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return undefined;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function validUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_INSTANT_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return day >= 1 && day <= days;
}

function parseExactSpanModelMemoryInput(input: unknown): CreateExactSpanModelMemoryInput | undefined {
  const hasAuthorization = isRecord(input) && Object.hasOwn(input, "authorize_before_write");
  const fields = ["project_uid", "session_uid", "event_uid", "span", "statement", "decision_uid", "now",
    ...(hasAuthorization ? ["authorize_before_write"] : [])];
  const record = exactDataRecord(input, fields);
  if (
    record === undefined ||
    typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
    typeof record.session_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.session_uid) ||
    typeof record.event_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.event_uid) ||
    typeof record.decision_uid !== "string" || !UUID_V4_PATTERN.test(record.decision_uid) ||
    typeof record.statement !== "string" || record.statement.normalize("NFC").trim().length === 0 ||
    (hasAuthorization && typeof record.authorize_before_write !== "function") ||
    !validUtcInstant(record.now)
  ) return undefined;
  const span = exactDataRecord(record.span, ["text_part_index", "utf8_start", "utf8_end", "sha256"]);
  if (
    span === undefined ||
    typeof span.text_part_index !== "number" || !Number.isSafeInteger(span.text_part_index) || span.text_part_index < 0 ||
    typeof span.utf8_start !== "number" || !Number.isSafeInteger(span.utf8_start) || span.utf8_start < 0 ||
    typeof span.utf8_end !== "number" || !Number.isSafeInteger(span.utf8_end) || span.utf8_end <= span.utf8_start ||
    typeof span.sha256 !== "string" || !SHA256_PATTERN.test(span.sha256)
  ) return undefined;
  return {
    project_uid: record.project_uid,
    session_uid: record.session_uid,
    event_uid: record.event_uid,
    span: {
      text_part_index: span.text_part_index,
      utf8_start: span.utf8_start,
      utf8_end: span.utf8_end,
      sha256: span.sha256,
    },
    statement: record.statement,
    decision_uid: record.decision_uid,
    now: record.now,
    ...(hasAuthorization ? { authorize_before_write: record.authorize_before_write as () => Promise<boolean> } : {}),
  };
}

function parseToolSaveMemoryInput(input: unknown): CreateToolSaveMemoryInput | undefined {
  const hasAuthorization = isRecord(input) && Object.hasOwn(input, "authorize_before_write");
  const fields = [
    "project_uid", "session_uid", "event_uid", "tool_call_id", "params", "decision_uid", "now",
    ...(hasAuthorization ? ["authorize_before_write"] : []),
  ];
  const record = exactDataRecord(input, fields);
  if (
    record === undefined ||
    typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
    typeof record.session_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.session_uid) ||
    typeof record.event_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.event_uid) ||
    typeof record.tool_call_id !== "string" || record.tool_call_id.length === 0 ||
    typeof record.decision_uid !== "string" || !UUID_V5_PATTERN.test(record.decision_uid) ||
    !validUtcInstant(record.now) ||
    (hasAuthorization && typeof record.authorize_before_write !== "function")
  ) return undefined;
  try {
    return {
      project_uid: record.project_uid,
      session_uid: record.session_uid,
      event_uid: record.event_uid,
      tool_call_id: record.tool_call_id,
      params: normalizeSaveToolArgs(record.params),
      decision_uid: record.decision_uid,
      now: record.now,
      ...(hasAuthorization ? { authorize_before_write: record.authorize_before_write as () => Promise<boolean> } : {}),
    };
  } catch {
    return undefined;
  }
}

function parseSearchProjectMemoriesInput(input: unknown): SearchProjectMemoriesInput | undefined {
  const record = exactDataRecord(input, ["project_uid", "query", "top_k", "now"]);
  if (
    record === undefined ||
    typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
    typeof record.query !== "string" ||
    typeof record.top_k !== "number" || !Number.isSafeInteger(record.top_k) || record.top_k < 0 ||
    !validUtcInstant(record.now)
  ) return undefined;
  return {
    project_uid: record.project_uid,
    query: record.query,
    top_k: record.top_k,
    now: record.now,
  };
}
function parseListProjectReflectionsInput(input: unknown): ListProjectReflectionsInput | undefined {
  const record = exactDataRecord(input, ["project_uid", "limit", "now"]);
  if (record === undefined ||
      typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
      typeof record.limit !== "number" || !Number.isSafeInteger(record.limit) || record.limit < 0 || record.limit > 5 ||
      !validUtcInstant(record.now)) return undefined;
  return { project_uid: record.project_uid, limit: record.limit, now: record.now };
}


function parseListSessionReviewCandidatesInput(input: unknown): ListSessionReviewCandidatesInput | undefined {
  const record = exactDataRecord(input, ["project_uid", "session_uid", "limit"]);
  if (record === undefined || typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
      typeof record.session_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.session_uid) ||
      typeof record.limit !== "number" || !Number.isSafeInteger(record.limit) || record.limit < 0 || record.limit > 5) return undefined;
  return { project_uid: record.project_uid, session_uid: record.session_uid, limit: record.limit };
}

function parseListRecentProjectMemoriesInput(input: unknown): ListRecentProjectMemoriesInput | undefined {
  const record = exactDataRecord(input, ["project_uid", "limit", "now"]);
  if (
    record === undefined ||
    typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
    typeof record.limit !== "number" || !Number.isSafeInteger(record.limit) || record.limit < 0 || record.limit > 5 ||
    !validUtcInstant(record.now)
  ) return undefined;
  return {
    project_uid: record.project_uid,
    limit: record.limit,
    now: record.now,
  };
}
function parseMemoryOperationInput(input: unknown): MemoryOperationInput | undefined {
  const action = isRecord(input) ? input.action : undefined;
  if (
    action !== "revise" && action !== "revoke" && action !== "set_expiry" &&
    action !== "suspend" && action !== "resume"
  ) return undefined;
  const fields = [
    "project_uid", "session_uid", "operation_event_uid", "tool_call_id", "user_event_uid", "user_span",
    "memory_uid", "expected_revision_uid", "action", "decision_uid", "now",
    ...(action === "revise" ? ["statement"] : []),
    ...(action === "set_expiry" ? ["valid_until"] : []),
    ...(isRecord(input) && Object.hasOwn(input, "authorize_before_write") ? ["authorize_before_write"] : []),
  ];
  const record = exactDataRecord(input, fields);
  const span = exactDataRecord(record?.user_span, ["text_part_index", "utf8_start", "utf8_end", "sha256"]);
  if (
    record === undefined ||
    typeof record.project_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.project_uid) ||
    typeof record.session_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.session_uid) ||
    typeof record.operation_event_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.operation_event_uid) ||
    typeof record.user_event_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.user_event_uid) ||
    typeof record.tool_call_id !== "string" || record.tool_call_id.length === 0 ||
    record.tool_call_id.trim() !== record.tool_call_id ||
    typeof record.memory_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.memory_uid) ||
    typeof record.expected_revision_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.expected_revision_uid) ||
    typeof record.decision_uid !== "string" || !UUID_V4_OR_V5_PATTERN.test(record.decision_uid) ||
    !validUtcInstant(record.now) ||
    span === undefined ||
    typeof span.text_part_index !== "number" || !Number.isSafeInteger(span.text_part_index) || span.text_part_index < 0 ||
    typeof span.utf8_start !== "number" || !Number.isSafeInteger(span.utf8_start) || span.utf8_start < 0 ||
    typeof span.utf8_end !== "number" || !Number.isSafeInteger(span.utf8_end) || span.utf8_end <= span.utf8_start ||
    typeof span.sha256 !== "string" || !SHA256_PATTERN.test(span.sha256) ||
    (action === "revise" && (
      typeof record.statement !== "string" || record.statement.normalize("NFC").trim().length === 0
    )) ||
    (action === "set_expiry" && !validUtcInstant(record.valid_until)) ||
    (Object.hasOwn(record, "authorize_before_write") && typeof record.authorize_before_write !== "function")
  ) return undefined;
  return {
    project_uid: record.project_uid,
    session_uid: record.session_uid,
    operation_event_uid: record.operation_event_uid,
    tool_call_id: record.tool_call_id,
    user_event_uid: record.user_event_uid,
    user_span: {
      text_part_index: span.text_part_index,
      utf8_start: span.utf8_start,
      utf8_end: span.utf8_end,
      sha256: span.sha256,
    },
    memory_uid: record.memory_uid,
    expected_revision_uid: record.expected_revision_uid,
    action,
    ...(action === "revise" ? { statement: record.statement as string } : {}),
    ...(action === "set_expiry" ? { valid_until: record.valid_until as string } : {}),
    decision_uid: record.decision_uid,
    now: record.now,
    ...(Object.hasOwn(record, "authorize_before_write") ? {
      authorize_before_write: record.authorize_before_write as () => Promise<boolean>,
    } : {}),
  };
}

function nodeUid(value: NodeProperties | undefined, property: string): string | undefined {
  return typeof value?.[property] === "string" ? value[property] as string : undefined;
}

function asBoundaryEvent(value: NodeProperties | undefined): BoundaryProjectorEvent | undefined {
  if (value === undefined) return undefined;
  const event_uid = value.event_uid;
  const project_uid = value.project_uid;
  const session_uid = value.session_uid;
  const ingest_sequence = numberValue(value.ingest_sequence);
  if (!canonicalUuid(event_uid) || !canonicalUuid(project_uid) || !canonicalUuid(session_uid) || ingest_sequence === undefined) return undefined;
  if (value.kind === "boundary") {
    if (value.boundary_type !== "checkpoint" && value.boundary_type !== "compact" && value.boundary_type !== "shutdown" && value.boundary_type !== "validation" && value.boundary_type !== "unknown") return undefined;
    return { event_uid, project_uid, session_uid, ingest_sequence, kind: "boundary", boundary_type: value.boundary_type as "checkpoint" | "compact" | "shutdown" | "validation" | "unknown" };
  }
  if (value.kind !== "message" && value.kind !== "tool_call" && value.kind !== "tool_result" && value.kind !== "turn_end") return undefined;
  return { event_uid, project_uid, session_uid, ingest_sequence, kind: value.kind };
}

function cursorFromNode(value: NodeProperties | undefined, strictState = true): CursorState | undefined {
  if (value === undefined) return undefined;
  const cursor_uid = value.cursor_uid;
  const project_uid = value.project_uid;
  const session_uid = value.session_uid;
  const projector_version = value.projector_version;
  const last_ingest_sequence = numberValue(value.last_ingest_sequence);
  if (
    typeof cursor_uid !== "string" ||
    typeof project_uid !== "string" ||
    typeof session_uid !== "string" ||
    typeof projector_version !== "string" ||
    last_ingest_sequence === undefined
  ) return undefined;
  const open_window_uid = value.open_window_uid;
  const open_window_start_sequence = numberValue(value.open_window_start_sequence);
  if ((open_window_uid === undefined) !== (open_window_start_sequence === undefined)) return undefined;
  if (open_window_uid !== undefined && typeof open_window_uid !== "string") return undefined;
  if (strictState && open_window_uid !== undefined && (last_ingest_sequence < 0 || open_window_start_sequence! > last_ingest_sequence)) return undefined;
  return {
    cursor_uid,
    project_uid,
    session_uid,
    projector_version,
    last_ingest_sequence,
    ...(open_window_uid === undefined ? {} : { open_window_uid, open_window_start_sequence: open_window_start_sequence! }),
  };
}


function resultForDomain<T extends StoreResult>(error: StoreDomainError): T {
  return {
    status: "failed",
    code: error.code,
    message: error.message,
  } as T;
}
const TASK_DIGEST_MAX_EVENT_BYTES = 4096;
const TASK_DIGEST_MAX_TOTAL_BYTES = 65536;
const TASK_DIGEST_REDACTION = "[REDACTED]";
const TASK_DIGEST_TRUNCATED = "[TRUNCATED]";

function digestText(properties: NodeProperties): { text: string; omitted: boolean } {
  if (typeof properties.content_parts_json !== "string") throw new Error("RawEvent content_parts_json is missing.");
  let parts: unknown;
  try {
    parts = JSON.parse(properties.content_parts_json);
  } catch {
    throw new Error("RawEvent content_parts_json is malformed.");
  }
  if (!Array.isArray(parts)) throw new Error("RawEvent content_parts_json is malformed.");
  const texts: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) throw new Error("RawEvent content part is malformed.");
    if (part.type === "text") {
      if (typeof part.text !== "string") throw new Error("RawEvent text content is malformed.");
      texts.push(part.text);
    }
  }
  let omitted = false;
  if (typeof properties.fidelity_json === "string") {
    let fidelity: unknown;
    try { fidelity = JSON.parse(properties.fidelity_json); } catch { throw new Error("RawEvent fidelity_json is malformed."); }
    if (isRecord(fidelity) && Array.isArray(fidelity.missing_fields)) {
      omitted = fidelity.missing_fields.includes("/content_parts") || fidelity.missing_fields.includes("/content");
    }
  }
  return { text: texts.join(""), omitted };
}

function digestRedact(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, TASK_DIGEST_REDACTION)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, TASK_DIGEST_REDACTION)
    .replace(/\b(?:api[_ -]?key|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, (match) => {
      const secret = match.match(/(?:"[^"]*"|'[^']*'|[^\s,;]+)$/)?.[0] ?? "";
      return `${match.slice(0, match.length - secret.length)}${TASK_DIGEST_REDACTION}`;
    });
}

function digestLimit(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { text: value, truncated: false };
  const suffixBytes = Buffer.byteLength(TASK_DIGEST_TRUNCATED, "utf8");
  const limit = Math.max(0, maxBytes - suffixBytes);
  let result = "";
  let used = 0;
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (used + size > limit) break;
    result += codePoint;
    used += size;
  }
  return {
    text: Buffer.byteLength(result + TASK_DIGEST_TRUNCATED, "utf8") <= maxBytes ? result + TASK_DIGEST_TRUNCATED : result,
    truncated: true,
  };
}

function buildTaskDigestProjection(source: ExecutionCandidateSource): TaskDigestProjectionInput {
  const { candidate, execution } = source;
  const terminalUid = execution.terminal_event_uid;
  if (terminalUid === null || execution.finalized_by_event_uid !== terminalUid || execution.state !== candidate.execution_state || execution.terminal_reason !== candidate.terminal_reason) {
    throw new StoreDomainError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
  }
  const ordered = [...source.events].sort((left, right) => left.position - right.position);
  if (ordered.length !== execution.event_count || ordered.length === 0 || ordered.some((event, index) => event.position !== index || event.event_uid !== execution.ordered_event_uids[index])) {
    throw new StoreDomainError("source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
  }
  const events: TaskDigestProjectionInput["events"] = [];
  const content_omissions: TaskDigestProjectionInput["content_omissions"] = [];
  let totalBytes = 0;
  let omitRest = false;
  for (const event of ordered) {
    let text: { text: string; omitted: boolean };
    try { text = digestText(event.properties); } catch (error) { throw new StoreDomainError("source_incomplete", error instanceof Error ? error.message : SOURCE_INCOMPLETE_MESSAGE); }
    const limited = digestLimit(digestRedact(text.text), TASK_DIGEST_MAX_EVENT_BYTES);
    let content = limited.text.length > 0 ? limited.text : null;
    let omission: "truncated" | "omitted" | undefined = limited.truncated ? "truncated" : text.omitted ? "omitted" : undefined;
    if (omitRest) {
      content = null;
      omission = "omitted";
    } else if (content !== null) {
      const bytes = Buffer.byteLength(content, "utf8");
      if (totalBytes + bytes > TASK_DIGEST_MAX_TOTAL_BYTES) {
        const remaining = TASK_DIGEST_MAX_TOTAL_BYTES - totalBytes;
        if (remaining > 0) {
          const totalLimited = digestLimit(content, remaining);
          content = totalLimited.text.length > 0 ? totalLimited.text : null;
          totalBytes += Buffer.byteLength(totalLimited.text, "utf8");
        } else {
          content = null;
        }
        omission = "truncated";
        omitRest = true;
      } else totalBytes += bytes;
    }
    if (omission !== undefined) content_omissions.push({ event_uid: event.event_uid, reason: omission });
    const projected: TaskDigestProjectionInput["events"][number] = {
      event_uid: event.event_uid,
      position: event.position,
      kind: event.kind,
      role: event.role,
      content,
    };
    const toolName = event.properties.tool_name;
    if (typeof toolName === "string") projected.tool_name = toolName;
    if (event.kind === "tool_result" && (event.outcome === "success" || event.outcome === "error")) projected.outcome = event.outcome;
    if (event.kind === "tool_result" && typeof event.result_of_event_uid === "string") projected.result_of_event_uid = event.result_of_event_uid;
    events.push(projected);
  }
  const terminalPosition = events.findIndex((event) => event.event_uid === terminalUid);
  if (terminalPosition < 0) throw new StoreDomainError("source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
  const terminalEvent = ordered[terminalPosition]!;
  if (typeof terminalEvent.properties.captured_at !== "string" || terminalEvent.properties.captured_at.length === 0) throw new StoreDomainError("source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
  const initiator = ordered[0]!;
  const initiatorProjection = events[0]!;
  if (initiator.topology_role !== "initiator" || initiator.kind !== "message" || initiator.role !== "user") throw new StoreDomainError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
  const resultTargets = new Set<string>();
  for (const event of ordered) {
    if (event.kind !== "tool_result" || typeof event.result_of_event_uid !== "string") continue;
    if (resultTargets.has(event.result_of_event_uid)) throw new StoreDomainError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    resultTargets.add(event.result_of_event_uid);
  }
  const unsettled_tool_calls = ordered
    .filter((event) => event.kind === "tool_call" && !resultTargets.has(event.event_uid))
    .map((event) => ({ tool_call_event_uid: event.event_uid, terminal_event_uid: terminalUid }));
  return {
    candidate_uid: candidate.candidate_uid,
    execution_uid: candidate.execution_uid,
    project_uid: candidate.project_uid,
    session_uid: candidate.session_uid,
    source_fingerprint: candidate.source_fingerprint,
    terminal: {
      state: execution.state as "completed" | "cancelled" | "interrupted",
      terminal_reason: execution.terminal_reason!,
      event_uid: terminalUid,
      position: terminalPosition,
      captured_at: terminalEvent.properties.captured_at,
    },
    initiator: { event_uid: initiator.event_uid, position: 0, content: initiatorProjection.content },
    events,
    unsettled_tool_calls,
    content_omissions,
  };
}

async function releaseNeo4jSessionTurn(): Promise<void> {
  // Bun 1.3.14 can defer returning a closed Neo4j session to the driver's pool
  // until the next timer turn, stalling an immediately following operation.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function isEpisodeBoundaryType(value: unknown): value is EpisodeWindowFact["terminal_boundary_type"] {
  return value === "checkpoint" || value === "compact" || value === "shutdown" || value === "validation" || value === "unknown";
}

function sameEpisodeObservation(left: EpisodeObservation, right: EpisodeObservation): boolean {
  if (left.present !== right.present) return false;
  if (!left.present || !right.present) return true;
  if ("invalid" in left || "invalid" in right) return "invalid" in left && "invalid" in right;
  return left.revision === right.revision && left.last_decision_uid === right.last_decision_uid;
}
function episodeSourceFingerprint(pass: EpisodePass): string {
  const windows = pass.windows.map(({ assigned_episode_uid: _assigned_episode_uid, ...source }) => source);
  const stable = (items: readonly unknown[]) => [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    windows,
    continuations: pass.continuations,
    closure: pass.closure,
    source_snapshot: {
      project: pass.source_snapshot.project,
      sessions: stable(pass.source_snapshot.sessions),
      windows: stable(pass.source_snapshot.windows),
      events: stable(pass.source_snapshot.events),
      continuations: stable(pass.source_snapshot.continuations),
    },
    deferred_identity_conflict: pass.deferred_identity_conflict === true,
  });
}

export class Neo4jMemoryStore implements MemoryStore {
  private readonly configPath?: string;
  private readonly shutdownTimeoutMs: number;
  private readonly configLoader: (configPath?: string) => Promise<ConfigLoadResult>;
  private readonly driverFactory: (config: Neo4jConfig) => Neo4j.Driver;
  private readonly reviewModelAdapter?: ExecutionReviewModelAdapter;
  private readonly reflectionModelAdapter?: ReflectionModelAdapter;
  private readonly authorizeAutomaticBeforeWrite?: (project_uid: string) => Promise<string | undefined>;
  private driver?: Neo4j.Driver;
  private readonly projectOwnership?: ProjectOwnershipScope;
  private database: string | undefined;
  private initialization?: Promise<MemoryStoreHealth>;
  private closePromise?: Promise<void>;
  private driverClosePromise?: Promise<void>;
  private state: "starting" | "connected" | "degraded" | "closed" = "starting";
  private admissionClosed = false;
  private automaticReflectionScanTail: Promise<void> | undefined;
  constructor(options: Neo4jMemoryStoreOptions = {}) {
    this.configPath = options.configPath;
    if (options.shutdown_timeout_ms !== undefined && (!Number.isSafeInteger(options.shutdown_timeout_ms) || options.shutdown_timeout_ms <= 0)) {
      throw new TypeError("shutdown_timeout_ms must be a positive safe integer.");
    }
    this.shutdownTimeoutMs = options.shutdown_timeout_ms ?? 1500;
    this.configLoader = options.loadConfig ?? defaultLoadConfig;
    this.driverFactory = options.driverFactory ?? ((config) => neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password)));
    this.reviewModelAdapter = options.reviewModelAdapter ?? options.review_model_adapter;
    this.reflectionModelAdapter = options.reflectionModelAdapter ?? options.reflection_model_adapter;
    if (options.authorizeAutomaticBeforeWrite !== undefined && typeof options.authorizeAutomaticBeforeWrite !== "function") {
      throw new TypeError("authorizeAutomaticBeforeWrite must be a function.");
    }
    this.authorizeAutomaticBeforeWrite = options.authorizeAutomaticBeforeWrite;
    this.projectOwnership = options.projectOwnership;
  }

  initialize(): Promise<MemoryStoreHealth> {
    if (this.isClosed()) return Promise.resolve(this.closedHealth());
    if (this.initialization !== undefined) return this.initialization;
    this.initialization = this.initializeOnce().catch(() => {
      if (this.isClosed()) return this.closedHealth();
      this.state = "degraded";
      this.database = undefined;
      return this.errorHealth();
    });
    return this.initialization;
  }

  async processSession(input: ProcessSessionInput): Promise<ProcessSessionResult> {
    const admission = this.admit<ProcessSessionResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateProcessInput(input);
    if (parsed !== undefined) return parsed;

    let preflight: PreflightSnapshot;
    try {
      preflight = await this.readPreflight(input);
    } catch (error: unknown) {
      if (error instanceof StoreDomainError) return resultForDomain(error);
      if (this.isClosed()) return this.closedOperationResult();
      return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    }
    if (this.isClosed()) return this.closedOperationResult();
    if (!preflight.has_work && preflight.source.cursor === undefined) {
      return {
        status: "up_to_date",
        project_uid: input.project_uid,
        session_uid: input.session_uid,
        through_ingest_sequence: preflight.source.next_ingest_sequence - 1,
      };
    }

    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      markWrite();
      const cursorResult = await transaction.run(
        `MERGE (c:MemoryCursor {cursor_uid: $cursor_uid})
         ON CREATE SET c.project_uid = $project_uid,
                       c.session_uid = $session_uid,
                       c.projector_version = $projector_version,
                       c.last_ingest_sequence = -1
         SET c.last_ingest_sequence = c.last_ingest_sequence
         RETURN c AS cursor`,
        {
          cursor_uid: boundaryCursorUid(input.session_uid),
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          projector_version: BOUNDARY_PROJECTOR_VERSION,
        },
      );
      const cursorRecord = cursorResult.records[0];
      const cursor = cursorFromNode(recordNode(cursorRecord, "cursor"));
      if (cursor === undefined) throw this.domain("identity_conflict");
      if (
        cursor.cursor_uid !== boundaryCursorUid(input.session_uid) ||
        cursor.project_uid !== input.project_uid ||
        cursor.session_uid !== input.session_uid ||
        cursor.projector_version !== BOUNDARY_PROJECTOR_VERSION
      ) throw this.domain("identity_conflict");
      if (cursor.last_ingest_sequence < -1) throw this.domain("source_incomplete");

      const source = await this.readSource(transaction, input, cursor);
      if (source.next_ingest_sequence <= cursor.last_ingest_sequence) throw this.domain("source_incomplete");
      const events = source.events.filter((event) => event.ingest_sequence > cursor.last_ingest_sequence);
      if (events.length === 0) {
        return {
          status: "up_to_date",
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          through_ingest_sequence: source.next_ingest_sequence - 1,
        } satisfies ProcessSessionResult;
      }
      const planInput: BoundaryProjectorInput = {
        cursor: cursorToProjectorState(cursor),
        project_uid: input.project_uid,
        session_uid: input.session_uid,
        events,
      };
      let plan: BoundaryProjectorPlan;
      try {
        plan = projectBoundary(planInput);
      } catch (error: unknown) {
        if (error instanceof BoundaryProjectorError) throw this.domain(error.code);
        throw error;
      }
      await this.applyPlan(transaction, markWrite, plan);
      await transaction.run(
        `MATCH (c:MemoryCursor {cursor_uid: $cursor_uid})
         SET c.last_ingest_sequence = $last_ingest_sequence,
             c.open_window_uid = $open_window_uid,
             c.open_window_start_sequence = $open_window_start_sequence`,
        {
          cursor_uid: cursor.cursor_uid,
          last_ingest_sequence: plan.next_cursor_state.last_ingest_sequence,
          open_window_uid: plan.next_cursor_state.open_window_uid ?? null,
          open_window_start_sequence: plan.next_cursor_state.open_window_start_sequence ?? null,
        },
      );
      return {
        status: "processed",
        project_uid: input.project_uid,
        session_uid: input.session_uid,
        from_ingest_sequence: plan.from_ingest_sequence,
        through_ingest_sequence: plan.through_ingest_sequence,
        events_assigned: plan.events_assigned,
        windows_created: plan.windows_created,
        windows_updated: plan.windows_updated,
      } satisfies ProcessSessionResult;
    });
    if (outcome.kind === "domain") return outcome.result as ProcessSessionResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", project_uid: input.project_uid, session_uid: input.session_uid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed") return this.closedOperationResult();
    if (this.isClosed()) return this.closedOperationResult();
    return outcome.result as ProcessSessionResult;
  }

  async materializeExecutionUnits(input: MaterializeExecutionUnitsInput): Promise<MaterializeExecutionUnitsResult> {
    const admission = this.admit<MaterializeExecutionUnitsResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateExecutionInput(input);
    if (parsed !== undefined) return parsed;
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      const identity = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})
         SET s._anima_session_lock = true REMOVE s._anima_session_lock
         RETURN s`,
        { session_uid: input.session_uid },
      );
      if (identity.records.length === 0) throw this.domain("not_found", NOT_FOUND_MESSAGE);
      const source = await this.readExecutionSource(transaction, input);
      let sourcePlan: ProjectExecutionUnitsPlan;
      try {
        sourcePlan = projectExecutionUnits({
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          events: source,
          existing_execution_units: [],
        });
      } catch (error: unknown) {
        if (error instanceof ExecutionProjectorError) throw this.domain(error.code);
        throw error;
      }
      const existing = await this.readExecutionUnits(
        transaction,
        input,
        sourcePlan.unit_plans.map((unitPlan) => unitPlan.after.execution_uid),
      );
      let plan: ProjectExecutionUnitsPlan;
      try {
        plan = projectExecutionUnits({
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          events: source,
          existing_execution_units: existing,
        });
      } catch (error: unknown) {
        if (error instanceof ExecutionProjectorError) throw this.domain(error.code);
        throw error;
      }
      if (plan.execution_units_created === 0 && plan.execution_units_updated === 0 && plan.event_links_created === 0) {
        return {
          status: "up_to_date",
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          through_ingest_sequence: plan.through_ingest_sequence,
        } satisfies MaterializeExecutionUnitsResult;
      }
      await this.authorizeAutomaticWrite(transaction, input.project_uid);
      await this.applyExecutionPlan(transaction, markWrite, plan.unit_plans);
      return {
        status: "materialized",
        project_uid: input.project_uid,
        session_uid: input.session_uid,
        through_ingest_sequence: plan.through_ingest_sequence,
        execution_units_created: plan.execution_units_created,
        execution_units_updated: plan.execution_units_updated,
        event_links_created: plan.event_links_created,
      } satisfies MaterializeExecutionUnitsResult;
    });
    if (outcome.kind === "domain") return outcome.result as MaterializeExecutionUnitsResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", project_uid: input.project_uid, session_uid: input.session_uid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed") return this.closedOperationResult() as MaterializeExecutionUnitsResult;
    if (this.isClosed()) return this.closedOperationResult() as MaterializeExecutionUnitsResult;
    return outcome.result as MaterializeExecutionUnitsResult;
  }
  async materializeExecutionReviewCandidates(input: MaterializeExecutionReviewCandidatesInput): Promise<MaterializeExecutionReviewCandidatesResult> {
    const admission = this.admit<MaterializeExecutionReviewCandidatesResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateReviewCandidateInput(input);
    if (parsed !== undefined) return parsed;
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      const identity = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})
         RETURN s AS session`,
        input,
      );
      if (identity.records.length !== 1) throw this.domain("not_found", NOT_FOUND_MESSAGE);
      const session = recordNode(identity.records[0], "session");
      if (session === undefined || session.project_uid !== input.project_uid || session.session_uid !== input.session_uid) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const source = await this.readExecutionSource(transaction, input);
      let derivedUnits: ProjectExecutionUnitsPlan;
      try {
        derivedUnits = projectExecutionUnits({
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          events: source,
          existing_execution_units: [],
        });
      } catch (error: unknown) {
        if (error instanceof ExecutionProjectorError) throw this.domain(error.code);
        throw error;
      }
      const executions = await this.readExecutionUnits(transaction, input, derivedUnits.unit_plans.map((unitPlan) => unitPlan.after.execution_uid));
      const existingCandidates = await this.readExecutionReviewCandidates(transaction, input);
      let plan: ProjectExecutionReviewCandidatesPlan;
      try {
        plan = projectExecutionReviewCandidates({
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          events: source,
          execution_units: executions,
          existing_candidates: existingCandidates,
        });
      } catch (error: unknown) {
        if (error instanceof ExecutionReviewCandidateProjectorError) throw this.domain(error.code);
        throw error;
      }
      if (plan.candidates_created === 0) {
        return {
          status: "up_to_date",
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          through_ingest_sequence: plan.through_ingest_sequence,
        } satisfies MaterializeExecutionReviewCandidatesResult;
      }
      await this.authorizeAutomaticWrite(transaction, input.project_uid);
      await this.applyExecutionReviewCandidatePlan(transaction, markWrite, plan);
      return {
        status: "materialized",
        project_uid: input.project_uid,
        session_uid: input.session_uid,
        through_ingest_sequence: plan.through_ingest_sequence,
        candidates_created: plan.candidates_created,
        evidence_links_created: plan.evidence_links_created,
      } satisfies MaterializeExecutionReviewCandidatesResult;
    });
    if (outcome.kind === "domain") return outcome.result as MaterializeExecutionReviewCandidatesResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", project_uid: input.project_uid, session_uid: input.session_uid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed") return this.closedOperationResult() as MaterializeExecutionReviewCandidatesResult;
    if (this.isClosed()) return this.closedOperationResult() as MaterializeExecutionReviewCandidatesResult;
    return outcome.result as MaterializeExecutionReviewCandidatesResult;
  }
  async getTaskDigest(input: GetTaskDigestInput): Promise<GetTaskDigestResult> {
    const admission = this.admit<GetTaskDigestResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateTaskDigestInput(input);
    if (parsed !== undefined) return parsed;
    const outcome = await this.runRead(async (transaction) => {
      this.throwIfClosed();
      const source = await readExecutionCandidateSource({
        transaction,
        candidate_uid: input.candidate_uid,
        readExecutionSource: this.readExecutionSource.bind(this),
        readRequestedExecutionUnits: this.readRequestedExecutionUnits.bind(this),
        domain: this.domain.bind(this),
      });
      let projection: TaskDigestProjectionInput;
      try {
        projection = buildTaskDigestProjection(source);
      } catch (error: unknown) {
        if (error instanceof StoreDomainError) throw error;
        throw this.domain("source_incomplete", error instanceof Error ? error.message : SOURCE_INCOMPLETE_MESSAGE);
      }
      try {
        return { status: "found", digest: projectTaskDigest(projection) } satisfies GetTaskDigestResult;
      } catch (error: unknown) {
        throw this.domain("source_incomplete", error instanceof Error ? error.message : SOURCE_INCOMPLETE_MESSAGE);
      }
    });
    if (outcome.kind === "domain") return outcome.result as GetTaskDigestResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "closed") return this.closedTaskDigestResult();
    return outcome.result as GetTaskDigestResult;
  }
  async reflectManualCandidate(input: ReflectManualCandidateInput): Promise<ReflectManualCandidateResult> {
    if (this.state === "closed" || this.admissionClosed) return this.closedReflectManualCandidateResult(input.candidate_uid);
    if (this.state !== "connected") {
      return { status: "failed", candidate_uid: input.candidate_uid, code: "core_degraded", message: DEGRADED_MESSAGE };
    }
    const admission = this.admit<ReflectManualCandidateResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateReflectManualCandidateInput(input);
    if (parsed !== undefined) return parsed;
    if (this.reflectionModelAdapter === undefined) {
      return { status: "failed", code: "model_unavailable", message: "Manual reflection model adapter is unavailable." };
    }
    if (input.model_ref !== this.reflectionModelAdapter.model_ref) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }

    const digestResult = await this.getTaskDigest({ candidate_uid: input.candidate_uid });
    if (digestResult.status === "failed") {
      if (digestResult.code === "core_closed" || digestResult.code === "core_degraded") {
        return { status: "failed", candidate_uid: input.candidate_uid, code: digestResult.code, message: digestResult.message };
      }
      return { status: "failed", code: digestResult.code, message: digestResult.message };
    }

    const modelInput = buildManualCandidateReflectionInput(digestResult.digest);
    if (Buffer.byteLength(canonicalize(modelInput as never), "utf8") > input.max_input_bytes) {
      return { status: "failed", code: "input_too_large", message: "Manual reflection input exceeds max_input_bytes." };
    }

    let response: unknown;
    try {
      response = await this.reflectionModelAdapter.reflect(modelInput);
    } catch {
      return { status: "failed", code: "model_failed", message: "Manual reflection model failed." };
    }

    let plan: ReflectionPersistencePlan;
    try {
      plan = buildManualReflectionPlan({
        model_input: modelInput,
        prompt_contract_version: input.prompt_contract_version,
        model_ref: input.model_ref,
        response,
      });
    } catch (error: unknown) {
      return { status: "failed", code: "invalid_reflection", message: error instanceof Error ? error.message : "Reflection output is invalid." };
    }
    const plannedCandidateUid = input.candidate_uid;
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      const freshSource = await readExecutionCandidateSource({
        transaction,
        candidate_uid: input.candidate_uid,
        readExecutionSource: this.readExecutionSource.bind(this),
        readRequestedExecutionUnits: this.readRequestedExecutionUnits.bind(this),
        domain: this.domain.bind(this),
      });
      let freshProjection: TaskDigestProjectionInput;
      try {
        freshProjection = buildTaskDigestProjection(freshSource);
      } catch (error: unknown) {
        if (error instanceof StoreDomainError) throw error;
        throw this.domain("source_incomplete", error instanceof Error ? error.message : SOURCE_INCOMPLETE_MESSAGE);
      }
      let freshDigest;
      try {
        freshDigest = projectTaskDigest(freshProjection);
      } catch (error: unknown) {
        throw this.domain("source_incomplete", error instanceof Error ? error.message : SOURCE_INCOMPLETE_MESSAGE);
      }
      const freshInput = buildManualCandidateReflectionInput(freshDigest);
      if (freshInput.input_fingerprint !== modelInput.input_fingerprint || freshInput.scope_fingerprint !== modelInput.scope_fingerprint) {
        throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      if (input.authorize_before_write !== undefined) {
        let markerFingerprint: string | undefined;
        try { markerFingerprint = await input.authorize_before_write(); } catch { /* Fail closed on resolver failure. */ }
        if (typeof markerFingerprint !== "string" || !SHA256_PATTERN.test(markerFingerprint)) {
          throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
        const projectIdentity = await transaction.run(
          "MATCH (p:Project {project_uid: $project_uid}) RETURN p.identity_fingerprint AS identity_fingerprint",
          { project_uid: freshDigest.project_uid },
        );
        if (
          projectIdentity.records.length !== 1 ||
          field(projectIdentity.records[0], "identity_fingerprint") !== markerFingerprint
        ) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      markWrite();
      try {
        const materialized = await materializeManualReflectionPlan(transaction, plan);
        return {
          status: materialized.status,
          candidate_uid: input.candidate_uid,
          reflection_uid: materialized.reflection_uid,
        } satisfies ReflectManualCandidateResult;
      } catch (error: unknown) {
        if (error instanceof ReflectionMaterializationError) throw this.domain(error.code, error.message);
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as ReflectManualCandidateResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", candidate_uid: plannedCandidateUid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed") return { status: "failed", candidate_uid: plannedCandidateUid, code: "core_closed", message: CLOSED_MESSAGE };
    return outcome.result as ReflectManualCandidateResult;
  }

  async runDueAutomaticReflections(input: RunDueAutomaticReflectionsInput): Promise<RunDueAutomaticReflectionsResult> {
    if (this.state === "closed" || this.admissionClosed) return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    const previous = this.automaticReflectionScanTail ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.automaticReflectionScanTail = gate;
    await previous;
    try {
      return await this.scanDueAutomaticReflections(input);
    } finally {
      release();
      if (this.automaticReflectionScanTail === gate) this.automaticReflectionScanTail = undefined;
    }
  }

  private async scanDueAutomaticReflections(input: RunDueAutomaticReflectionsInput): Promise<RunDueAutomaticReflectionsResult> {
    if (this.state === "closed" || this.admissionClosed) return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    if (this.state !== "connected") return { status: "failed", code: "core_degraded", message: DEGRADED_MESSAGE };
    const validation = this.validateAutomaticReflectionInput(input);
    if (validation !== undefined) return validation;
    const maxWorkItemsPerProject = Object.hasOwn(input, "max_work_items_per_project")
      ? input.max_work_items_per_project!
      : AUTOMATIC_REFLECTION_MAX_ATTEMPTS_PER_PROJECT_RUN;
    const maxConcurrentProjects = Object.hasOwn(input, "max_concurrent_projects")
      ? input.max_concurrent_projects!
      : 1;
    const nowEpoch = parseInstant(input.now);
    const ownershipScope = this.projectOwnership;
    if (ownershipScope === undefined) {
      return this.isClosed() || this.admissionClosed
        ? { status: "failed", code: "core_closed", message: CLOSED_MESSAGE }
        : { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    let registeredProjects: readonly ProjectOwnershipRecord[];
    try {
      registeredProjects = await listProjectOwnership(ownershipScope);
    } catch {
      return this.isClosed() || this.admissionClosed
        ? { status: "failed", code: "core_closed", message: CLOSED_MESSAGE }
        : { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    if (this.isClosed() || this.admissionClosed) return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    const projectResults: ({ attempts: AutomaticReflectionAttempt[]; has_more: boolean } | undefined)[] = new Array(registeredProjects.length);
    let nextIndex = 0;
    const lane = async (): Promise<void> => {
      while (!(this.state === "closed" || this.admissionClosed)) {
        const index = nextIndex;
        if (index >= registeredProjects.length) return;
        nextIndex += 1;
        const project = registeredProjects[index]!;
        try {
          projectResults[index] = await this.runAutomaticReflectionProject(project, input, nowEpoch, maxWorkItemsPerProject);
        } catch {
          projectResults[index] = {
            attempts: [this.automaticInitializationAttempt(project.project_uid, { code: "database_error", message: DATABASE_ERROR_MESSAGE })],
            has_more: false,
          };
        }
      }
    };
    const lanes = Array.from({ length: Math.min(maxConcurrentProjects, registeredProjects.length) }, () => lane());
    const settled = await Promise.allSettled(lanes);
    if (this.isClosed() || this.admissionClosed) return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    if (settled.some((result) => result.status === "rejected")) {
      return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    }
    const attempts: AutomaticReflectionAttempt[] = [];
    let hasMore = false;
    for (const result of projectResults) {
      if (result === undefined) continue;
      attempts.push(...result.attempts);
      hasMore ||= result.has_more;
    }
    const hasFailure = attempts.some((attempt) => attempt.status === "blocked" || attempt.status === "failed");
    return { status: hasFailure ? "partial" : "completed", now: input.now, attempts, has_more: hasMore };
  }

  private async runAutomaticReflectionProject(
    registeredProject: ProjectOwnershipRecord,
    input: RunDueAutomaticReflectionsInput,
    nowEpoch: number,
    maxWorkItemsPerProject: number,
  ): Promise<{ attempts: AutomaticReflectionAttempt[]; has_more: boolean }> {
    const project_uid = registeredProject.project_uid;
    const attempts: AutomaticReflectionAttempt[] = [];
    let hasMore = false;
    if (this.state === "closed" || this.admissionClosed) return { attempts, has_more: hasMore };
    let cursor: AutomaticCursorState | undefined;
    try {
      if (!await this.verifyAutomaticProjectOwnership(registeredProject)) return { attempts, has_more: hasMore };
      if (this.isClosed() || this.admissionClosed) return { attempts, has_more: hasMore };
      await this.prepareAutomaticReflectionCandidates(project_uid);
      cursor = await this.ensureAutomaticReflectionCursor(project_uid);
    } catch (error: unknown) {
      const failure = this.automaticFailure(error, "database_error");
      attempts.push(this.automaticInitializationAttempt(project_uid, failure));
      return { attempts, has_more: hasMore };
    }
    if (cursor === undefined) return { attempts, has_more: hasMore };
    let projectBlocked = false;
    let successfulSlotCount = 0;
    while (!projectBlocked && !(this.isClosed() || this.admissionClosed)) {
      let slot: AutomaticSlot | undefined;
      try {
        slot = this.selectAutomaticSlot(cursor, nowEpoch);
      } catch (error: unknown) {
        const failure = this.automaticFailure(error, "identity_conflict");
        attempts.push(this.automaticInitializationAttempt(project_uid, failure));
        projectBlocked = true;
        continue;
      }
      if (slot === undefined) break;
      let scope: { model_input?: AutomaticReflectionInput; empty: boolean };
      try {
        scope = await this.readAutomaticReflectionScope(project_uid, slot);
      } catch (error: unknown) {
        const failure = this.automaticFailure(error, "source_incomplete");
        attempts.push(this.automaticSlotAttempt(project_uid, slot, "blocked", failure));
        projectBlocked = true;
        continue;
      }
      if (scope.empty) {
        try {
          const outcome = await this.writeAutomaticReflectionSlot(project_uid, slot, undefined, undefined);
          attempts.push(outcome.attempt);
          if (outcome.new_work) successfulSlotCount += 1;
          cursor = outcome.cursor;
          if (successfulSlotCount >= maxWorkItemsPerProject) {
            try {
              if (this.selectAutomaticSlot(cursor, nowEpoch) !== undefined) hasMore = true;
            } catch (error: unknown) {
              const failure = this.automaticFailure(error, "identity_conflict");
              attempts.push(this.automaticInitializationAttempt(project_uid, failure));
            }
            projectBlocked = true;
          }
          continue;
        } catch (error: unknown) {
          const failure = this.automaticFailure(error, "database_error");
          attempts.push(this.automaticSlotAttempt(project_uid, slot, "failed", failure));
          projectBlocked = true;
          continue;
        }
      }
      const fullInput = scope.model_input;
      if (fullInput === undefined) {
        attempts.push(this.automaticSlotAttempt(project_uid, slot, "blocked", { code: "source_incomplete", message: SOURCE_INCOMPLETE_MESSAGE }));
        projectBlocked = true;
        continue;
      }
      let batches: readonly AutomaticReflectionInput[];
      try {
        batches = buildAutomaticReflectionBatches(fullInput, input.max_input_bytes);
      } catch (error: unknown) {
        const failure = {
          code: error instanceof AutomaticReflectionBatchSizeError ? "input_too_large" as const : "identity_conflict" as const,
          message: error instanceof Error ? error.message : IDENTITY_CONFLICT_MESSAGE,
        };
        attempts.push(this.automaticSlotAttempt(project_uid, slot, "blocked", failure));
        projectBlocked = true;
        continue;
      }
      let batchFailed = false;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const modelInput = batches[batchIndex]!;
        const isFinalBatch = batchIndex === batches.length - 1;
        let plan: ReflectionPersistencePlan | undefined;
        try {
          plan = await this.readAutomaticReflectionPlan(project_uid, slot, modelInput);
        } catch (error: unknown) {
          attempts.push(this.automaticSlotAttempt(project_uid, slot, "blocked", this.automaticFailure(error, "identity_conflict")));
          batchFailed = true;
          break;
        }
        if (plan === undefined) {
          if (this.isClosed() || this.admissionClosed) {
            projectBlocked = true;
            batchFailed = true;
            break;
          }
          if (this.reflectionModelAdapter === undefined) {
            attempts.push(this.automaticSlotAttempt(project_uid, slot, "blocked", { code: "model_unavailable", message: "Automatic reflection model adapter is unavailable." }));
            batchFailed = true;
            break;
          }
          let response: unknown;
          try {
            response = await this.reflectionModelAdapter.reflect(modelInput, { maxInputBytes: input.max_input_bytes });
          } catch (error: unknown) {
            const contractError = error instanceof ReflectionModelContractError ? error : undefined;
            const failure = contractError?.code === "input_too_large"
              ? { code: "input_too_large" as const, message: contractError.message }
              : contractError?.code === "invalid_reflection"
                ? { code: "invalid_reflection" as const, message: contractError.message }
                : { code: "model_failed" as const, message: "Automatic reflection model failed." };
            attempts.push(this.automaticSlotAttempt(project_uid, slot, contractError?.code === "input_too_large" ? "blocked" : "failed", failure));
            batchFailed = true;
            break;
          }
          try {
            plan = projectAutomaticReflectionModelPlan({
              model_input: modelInput,
              prompt_contract_version: this.automaticPromptContract(slot.kind),
              model_ref: this.reflectionModelAdapter.model_ref,
              response,
            });
          } catch (error: unknown) {
            attempts.push(this.automaticSlotAttempt(project_uid, slot, "failed", {
              code: "invalid_reflection",
              message: error instanceof Error ? error.message : "Reflection output is invalid.",
            }));
            batchFailed = true;
            break;
          }
        }
        try {
          const outcome = await this.writeAutomaticReflectionSlot(project_uid, slot, modelInput, plan, fullInput, isFinalBatch, input.max_input_bytes);
          attempts.push(outcome.attempt);
          if (outcome.new_work) successfulSlotCount += 1;
          cursor = outcome.cursor;
          if (outcome.attempt.status === "already_processed") break;
          if (successfulSlotCount >= maxWorkItemsPerProject && !isFinalBatch) {
            hasMore = true;
            projectBlocked = true;
            break;
          }
        } catch (error: unknown) {
          const failure = this.automaticFailure(error, "database_error");
          attempts.push(this.automaticSlotAttempt(project_uid, slot, failure.code === "identity_conflict" ? "blocked" : "failed", failure));
          batchFailed = true;
          break;
        }
      }
      if (batchFailed) {
        projectBlocked = true;
        continue;
      }
      if (successfulSlotCount >= maxWorkItemsPerProject) {
        try {
          if (this.selectAutomaticSlot(cursor, nowEpoch) !== undefined) hasMore = true;
        } catch (error: unknown) {
          attempts.push(this.automaticInitializationAttempt(project_uid, this.automaticFailure(error, "identity_conflict")));
        }
        projectBlocked = true;
      }
    }
    return { attempts, has_more: hasMore };
  }

  async reviewExecutionCandidate(input: ReviewExecutionCandidateInput): Promise<ExecutionReviewOperationResult> {
    if (this.state === "closed" || this.admissionClosed) return this.closedReviewExecutionCandidateResult(input.candidate_uid);
    const admission = this.admit<ExecutionReviewOperationResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateReviewExecutionInput(input);
    if (parsed !== undefined) return parsed;
    if (this.reviewModelAdapter === undefined) return { status: "failed", code: "model_unavailable", message: "Execution review model adapter is unavailable." };

    let claim: ReviewClaim | undefined;
    const claimed = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      const result = await this.claimExecutionReviewCandidate(transaction, markWrite, input);
      if (result.terminal !== undefined) return { status: "skipped", candidate_uid: input.candidate_uid, skip_reason: result.terminal.skip_reason } satisfies ExecutionReviewOperationResult;
      if (result.busy === true) return { status: "busy", candidate_uid: input.candidate_uid } satisfies ExecutionReviewOperationResult;
      claim = result;
      return { status: "indeterminate", candidate_uid: input.candidate_uid, message: "Execution review candidate claimed." } satisfies ExecutionReviewOperationResult;
    });
    if (claimed.kind === "domain") return claimed.result as ExecutionReviewOperationResult;
    if (claimed.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (claimed.kind === "unknown") return { status: "indeterminate", candidate_uid: input.candidate_uid, message: UNKNOWN_WRITE_MESSAGE };
    if (claimed.kind === "closed" || this.isClosed()) return this.closedReviewExecutionCandidateResult(input.candidate_uid);
    if (claimed.kind === "ok" && claimed.result.status !== "indeterminate") return claimed.result;
    if (claim === undefined) return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };

    let modelInput;
    try {
      modelInput = buildExecutionReviewModelInput(claim.candidate, claim.source_events);
    } catch (error: unknown) {
      await this.releaseExecutionReviewCandidate(input.candidate_uid, claim.lease_token);
      return { status: "failed", code: "source_incomplete", message: error instanceof Error ? error.message : SOURCE_INCOMPLETE_MESSAGE };
    }
    let response: unknown;
    try {
      response = await this.reviewModelAdapter.review(modelInput);
    } catch (error: unknown) {
      await this.releaseExecutionReviewCandidate(input.candidate_uid, claim.lease_token);
      return { status: "failed", code: "model_failed", message: "Execution review model failed." };
    }
    if (response === null) {
      await this.releaseExecutionReviewCandidate(input.candidate_uid, claim.lease_token);
      return { status: "failed", code: "model_failed", message: "Execution review model returned null." };
    }
    let reviewPlan: ExecutionReviewPlan;
    try {
      reviewPlan = buildExecutionReviewPlan({
        candidate: claim.candidate,
        model_input: modelInput,
        prompt_contract_version: input.prompt_contract_version,
        model_ref: input.model_ref,
        response,
      });
    } catch (error: unknown) {
      await this.releaseExecutionReviewCandidate(input.candidate_uid, claim.lease_token);
      return { status: "failed", code: "invalid_review", message: error instanceof Error ? error.message : "Execution review output is invalid." };
    }
    const persisted = await this.persistExecutionReview(input, claim.lease_token, reviewPlan);
    return persisted;
  }

  async recordSessionContinuation(input: RecordSessionContinuationInput): Promise<RecordSessionContinuationResult> {
    const admission = this.admit<RecordSessionContinuationResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateContinuationInput(input);
    if (parsed !== undefined) return parsed;
    const decision_uid = sessionContinuationDecisionUid(
      input.project_uid,
      input.session_uid,
      input.previous_session_uid,
      input.checkpoint_event_uid,
    );

    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      const identityResult = await transaction.run(
        `OPTIONAL MATCH (p:Project {project_uid: $project_uid})
         OPTIONAL MATCH (s:Session {session_uid: $session_uid})
         OPTIONAL MATCH (previous:Session {session_uid: $previous_session_uid})
         OPTIONAL MATCH (e:RawEvent {event_uid: $checkpoint_event_uid})
         OPTIONAL MATCH (p)-[has_session:HAS_SESSION]->(s)
         OPTIONAL MATCH (p)-[has_previous:HAS_SESSION]->(previous)
         OPTIONAL MATCH (s)-[has_event:HAS_EVENT]->(e)
         OPTIONAL MATCH (e)-[in_project:IN_PROJECT]->(p)
         RETURN p AS p, s AS s, previous AS previous, e AS e,
                has_session AS has_session, has_previous AS has_previous,
                has_event AS has_event, in_project AS in_project`,
        {
          project_uid: input.project_uid,
          session_uid: input.session_uid,
          previous_session_uid: input.previous_session_uid,
          checkpoint_event_uid: input.checkpoint_event_uid,
        },
      );
      const identity = identityResult.records[0];
      const project = recordNode(identity, "p");
      const current = recordNode(identity, "s");
      const previous = recordNode(identity, "previous");
      const checkpoint = recordNode(identity, "e");
      if (project === undefined || current === undefined || previous === undefined || checkpoint === undefined) {
        throw this.domain("not_found", NOT_FOUND_MESSAGE);
      }
      if (!field(identity, "has_session") || !field(identity, "has_previous") || !field(identity, "has_event") || !field(identity, "in_project")) {
        throw this.domain("source_incomplete");
      }
      if (checkpoint.kind !== "boundary" || checkpoint.boundary_type !== "checkpoint") {
        throw this.domain("evidence_invalid");
      }
      if (
        nodeUid(project, "project_uid") !== input.project_uid ||
        nodeUid(current, "session_uid") !== input.session_uid ||
        nodeUid(previous, "session_uid") !== input.previous_session_uid ||
        nodeUid(current, "project_uid") !== input.project_uid ||
        nodeUid(previous, "project_uid") !== input.project_uid ||
        nodeUid(checkpoint, "event_uid") !== input.checkpoint_event_uid ||
        nodeUid(checkpoint, "project_uid") !== input.project_uid ||
        nodeUid(checkpoint, "session_uid") !== input.session_uid
      ) throw this.domain("identity_conflict");

      const cursorResult = await transaction.run(
        `MATCH (cursor:MemoryCursor {cursor_uid: $cursor_uid})
         SET cursor.last_ingest_sequence = cursor.last_ingest_sequence
         RETURN cursor AS cursor`,
        { cursor_uid: boundaryCursorUid(input.session_uid) },
      );
      const cursor = cursorFromNode(recordNode(cursorResult.records[0], "cursor"), false);
      if (cursor === undefined) throw this.domain("source_incomplete");
      if (
        cursor.project_uid !== input.project_uid ||
        cursor.session_uid !== input.session_uid ||
        cursor.projector_version !== BOUNDARY_PROJECTOR_VERSION ||
        cursor.cursor_uid !== boundaryCursorUid(input.session_uid)
      ) throw this.domain("identity_conflict");
      if (
        cursor.open_window_uid !== undefined &&
        (cursor.open_window_start_sequence === undefined ||
          cursor.open_window_start_sequence < 0 ||
          cursor.open_window_uid !== boundaryWindowUid(input.project_uid, input.session_uid, cursor.open_window_start_sequence))
      ) throw this.domain("identity_conflict");

      const evidenceResult = await transaction.run(
        `MATCH (e:RawEvent {event_uid: $checkpoint_event_uid})-[assignment:IN_BOUNDARY_WINDOW {projector_version: $projector_version}]->(w:BoundaryWindow)
         RETURN assignment AS assignment, w AS w`,
        {
          checkpoint_event_uid: input.checkpoint_event_uid,
          projector_version: BOUNDARY_PROJECTOR_VERSION,
        },
      );
      if (evidenceResult.records.length === 0) throw this.domain("source_incomplete");
      if (evidenceResult.records.length !== 1) throw this.domain("identity_conflict");
      const evidenceRecord = evidenceResult.records[0];
      const assignmentValue = field(evidenceRecord, "assignment");
      const assignment = isRecord(assignmentValue) && isRecord(assignmentValue.properties)
        ? assignmentValue.properties
        : undefined;
      const window = recordNode(evidenceRecord, "w");
      if (
        assignment === undefined ||
        !exactKeys(assignment, ["projector_version"]) ||
        assignment.projector_version !== BOUNDARY_PROJECTOR_VERSION ||
        window === undefined ||
        window.project_uid !== input.project_uid ||
        window.session_uid !== input.session_uid ||
        window.projector_version !== BOUNDARY_PROJECTOR_VERSION
      ) throw this.domain("identity_conflict");
      if (
        window.collection_state !== "sealed" ||
        window.terminal_event_uid !== input.checkpoint_event_uid ||
        window.terminal_boundary_type !== "checkpoint" ||
        window.decision_status !== "pending"
      ) throw this.domain("source_incomplete");

      const outgoingResult = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})-[r:CONTINUES_FROM]->(previous:Session)
         RETURN r AS relation, previous AS previous`,
        { session_uid: input.session_uid },
      );
      if (outgoingResult.records.length > 1) throw this.domain("identity_conflict");
      const outgoing: Array<{ relation: NodeProperties; previous: NodeProperties }> = [];
      for (const record of outgoingResult.records) {
        const relationValue = field(record, "relation");
        const relation = isRecord(relationValue) && isRecord(relationValue.properties) ? relationValue.properties : undefined;
        const outgoingPrevious = recordNode(record, "previous");
        if (relation === undefined || outgoingPrevious === undefined || typeof relation.decision_uid !== "string") {
          throw this.domain("identity_conflict");
        }
        outgoing.push({ relation, previous: outgoingPrevious });
      }
      const expected = {
        decision_uid,
        schema_id: "anima.session-continuation/v1.0",
        method: "explicit_checkpoint",
        evidence_event_uid: input.checkpoint_event_uid,
        project_uid: input.project_uid,
      } as const;
      const existing = outgoing[0];
      if (existing !== undefined) {
        const existingPrevious = nodeUid(existing.previous, "session_uid");
        const matches =
          existingPrevious === input.previous_session_uid &&
          exactKeys(existing.relation, ["decision_uid", "schema_id", "method", "evidence_event_uid", "project_uid"]) &&
          existing.relation.decision_uid === expected.decision_uid &&
          existing.relation.schema_id === expected.schema_id &&
          existing.relation.method === expected.method &&
          existing.relation.evidence_event_uid === expected.evidence_event_uid &&
          existing.relation.project_uid === expected.project_uid;
        if (matches) return { status: "duplicate", decision_uid } satisfies RecordSessionContinuationResult;
        throw this.domain("identity_conflict");
      }
      markWrite();
      await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid}), (previous:Session {session_uid: $previous_session_uid})
         CREATE (s)-[:CONTINUES_FROM {
           decision_uid: $decision_uid,
           schema_id: $schema_id,
           method: $method,
           evidence_event_uid: $evidence_event_uid,
           project_uid: $project_uid
         }]->(previous)`,
        {
          session_uid: input.session_uid,
          previous_session_uid: input.previous_session_uid,

          decision_uid,
          schema_id: expected.schema_id,
          method: expected.method,
          evidence_event_uid: expected.evidence_event_uid,
          project_uid: expected.project_uid,
        },
      );
      return { status: "written", decision_uid } satisfies RecordSessionContinuationResult;
    });
    if (outcome.kind === "domain") return outcome.result as RecordSessionContinuationResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", decision_uid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed") return this.closedContinuationResult();
    if (this.isClosed()) return this.closedContinuationResult();
    return outcome.result as RecordSessionContinuationResult;
  }
  async createExactSpanModelMemoryRevision(
    input: CreateExactSpanModelMemoryInput,
  ): Promise<CreateExactSpanModelMemoryResult> {
    const admission = this.admit<CreateExactSpanModelMemoryResult>();
    if (admission !== undefined) return admission;
    const parsed = parseExactSpanModelMemoryInput(input);
    if (parsed === undefined) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    const scope = this.projectOwnership;
    if (scope === undefined) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }

    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      try {
        return await createExactSpanModelMemoryRevision({
          transaction: transaction as unknown as MemoryDirectEvidenceReaderTransaction,
          scope,
          ...parsed,
          markWrite,
        });
      } catch (error: unknown) {
        if (error instanceof MemoryRevisionWriteError) throw this.domain(error.code);
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as CreateExactSpanModelMemoryResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") {
      return { status: "indeterminate", decision_uid: parsed.decision_uid, message: UNKNOWN_WRITE_MESSAGE };
    }
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    return outcome.result as CreateExactSpanModelMemoryResult;
  }

  async createToolSaveMemoryRevision(
    input: CreateToolSaveMemoryInput,
  ): Promise<CreateToolSaveMemoryResult> {
    const admission = this.admit<CreateToolSaveMemoryResult>();
    if (admission !== undefined) return admission;
    const parsed = parseToolSaveMemoryInput(input);
    if (parsed === undefined) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    const scope = this.projectOwnership;
    if (scope === undefined) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }

    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      try {
        return await writeToolSaveMemoryRevision({
          transaction: transaction as unknown as MemoryDirectEvidenceReaderTransaction,
          scope,
          ...parsed,
          markWrite,
        });
      } catch (error: unknown) {
        if (error instanceof MemoryRevisionWriteError) throw this.domain(error.code);
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as CreateToolSaveMemoryResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") {
      return { status: "indeterminate", decision_uid: parsed.decision_uid, message: UNKNOWN_WRITE_MESSAGE };
    }
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    return outcome.result as CreateToolSaveMemoryResult;
  }

  async applyMemoryOperation(input: MemoryOperationInput): Promise<MemoryOperationResult> {
    const admission = this.admit<MemoryOperationResult>();
    if (admission !== undefined) return admission;
    const parsed = parseMemoryOperationInput(input);
    if (parsed === undefined) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    const scope = this.projectOwnership;
    if (scope === undefined) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      try {
        return await applyMemoryOperationRevision({
          transaction: transaction as unknown as MemoryDirectEvidenceReaderTransaction,
          scope,
          ...parsed,
          markWrite,
        });
      } catch (error: unknown) {
        if (error instanceof MemoryRevisionWriteError) throw this.domain(error.code);
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as MemoryOperationResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") {
      return { status: "indeterminate", decision_uid: parsed.decision_uid, message: UNKNOWN_WRITE_MESSAGE };
    }
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    return outcome.result as MemoryOperationResult;
  }

  async searchProjectMemories(input: SearchProjectMemoriesInput): Promise<SearchProjectMemoriesResult> {
    const admission = this.admit<SearchProjectMemoriesResult>();
    if (admission !== undefined) return admission;
    const parsed = parseSearchProjectMemoriesInput(input);
    if (parsed === undefined) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };

    const scope = this.projectOwnership;
    if (scope === undefined) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    let ownership: readonly ProjectOwnershipRecord[];
    try {
      ownership = await listProjectOwnership(scope);
    } catch {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const registered = ownership.filter((record) => record.project_uid === parsed.project_uid);
    if (
      registered.length !== 1 || registered[0]?.principal_uid !== scope.principal_uid ||
      registered[0]?.schema_id !== "anima.dev-project-ownership/v1"
    ) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const projectOwnership = registered[0]!;
    const emptyResult = (): SearchProjectMemoriesResult => ({
      status: "completed",
      query: parsed.query,
      results: [],
      count: 0,
    });

    const outcome = await this.runRead(async (transaction) => {
      this.throwIfClosed();
      const projectResult = await transaction.run(
        "MATCH (p:Project {project_uid: $project_uid}) RETURN labels(p) AS project_labels, properties(p) AS project_properties",
        { project_uid: parsed.project_uid },
      );
      if (projectResult.records.length === 0) {
        const domain_uid = uuidV5FromParts([
          "anima.memory-subject", "v1", scope.principal_uid, parsed.project_uid, "user",
        ]);
        const domainResult = await transaction.run(
          "MATCH (n) WHERE n.domain_uid = $domain_uid RETURN count(n) AS count",
          { domain_uid },
        );
        if (
          domainResult.records.length !== 1 ||
          numberValue(field(domainResult.records[0], "count")) !== 0
        ) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        return emptyResult();
      }
      const projectProperties = field(projectResult.records[0], "project_properties");
      if (
        projectResult.records.length !== 1 ||
        !this.validProjectIdentity(projectResult.records[0], parsed.project_uid) ||
        !isRecord(projectProperties) ||
        projectProperties.identity_fingerprint !== projectOwnership.identity_fingerprint
      ) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);

      if (parsed.top_k === 0 || parsed.query.normalize("NFC").trim().length === 0) return emptyResult();
      try {
        const results = await searchScopedCurrentMemories({
          transaction: transaction as unknown as MemoryDirectEvidenceReaderTransaction,
          scope,
          ...parsed,
        });
        return { status: "completed", query: parsed.query, results, count: results.length } satisfies SearchProjectMemoriesResult;
      } catch (error: unknown) {
        if (error instanceof MemoryRevisionWriteError) {
          const code = error.code === "invalid_input" || error.code === "source_incomplete" || error.code === "evidence_invalid"
            ? error.code
            : "identity_conflict";
          throw this.domain(code, code === "identity_conflict" ? IDENTITY_CONFLICT_MESSAGE : undefined);
        }
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as SearchProjectMemoriesResult;
    if (outcome.kind === "database") {
      return { status: "failed", code: "database_error", message: "Neo4j memory search failed." };
    }
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    return outcome.result as SearchProjectMemoriesResult;
  }

  async listRecentProjectMemories(input: ListRecentProjectMemoriesInput): Promise<ListRecentProjectMemoriesResult> {
    const admission = this.admit<ListRecentProjectMemoriesResult>();
    if (admission !== undefined) return admission;
    const parsed = parseListRecentProjectMemoriesInput(input);
    if (parsed === undefined) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };

    const scope = this.projectOwnership;
    if (scope === undefined) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    let ownership: readonly ProjectOwnershipRecord[];
    try {
      ownership = await listProjectOwnership(scope);
    } catch {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const registered = ownership.filter((record) => record.project_uid === parsed.project_uid);
    if (
      registered.length !== 1 || registered[0]?.principal_uid !== scope.principal_uid ||
      registered[0]?.schema_id !== "anima.dev-project-ownership/v1"
    ) {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const projectOwnership = registered[0]!;
    const emptyResult = (): ListRecentProjectMemoriesResult => ({
      status: "completed",
      results: [],
      count: 0,
    });

    const outcome = await this.runRead(async (transaction) => {
      this.throwIfClosed();
      const projectResult = await transaction.run(
        "MATCH (p:Project {project_uid: $project_uid}) RETURN labels(p) AS project_labels, properties(p) AS project_properties",
        { project_uid: parsed.project_uid },
      );
      if (projectResult.records.length === 0) {
        const domain_uid = uuidV5FromParts([
          "anima.memory-subject", "v1", scope.principal_uid, parsed.project_uid, "user",
        ]);
        const domainResult = await transaction.run(
          "MATCH (n) WHERE n.domain_uid = $domain_uid RETURN count(n) AS count",
          { domain_uid },
        );
        if (
          domainResult.records.length !== 1 ||
          numberValue(field(domainResult.records[0], "count")) !== 0
        ) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        return emptyResult();
      }
      const projectProperties = field(projectResult.records[0], "project_properties");
      if (
        projectResult.records.length !== 1 ||
        !this.validProjectIdentity(projectResult.records[0], parsed.project_uid) ||
        !isRecord(projectProperties) ||
        projectProperties.identity_fingerprint !== projectOwnership.identity_fingerprint
      ) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);

      if (parsed.limit === 0) return emptyResult();
      try {
        const results = await listRecentScopedCurrentMemories({
          transaction: transaction as unknown as MemoryDirectEvidenceReaderTransaction,
          scope,
          ...parsed,
        });
        return { status: "completed", results, count: results.length } satisfies ListRecentProjectMemoriesResult;
      } catch (error: unknown) {
        if (error instanceof MemoryRevisionWriteError) {
          const code = error.code === "invalid_input" || error.code === "source_incomplete" || error.code === "evidence_invalid"
            ? error.code
            : "identity_conflict";
          throw this.domain(code, code === "identity_conflict" ? IDENTITY_CONFLICT_MESSAGE : undefined);
        }
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as ListRecentProjectMemoriesResult;
    if (outcome.kind === "database") {
      return { status: "failed", code: "database_error", message: "Neo4j memory search failed." };
    }
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    return outcome.result as ListRecentProjectMemoriesResult;
  }

  async listProjectReflections(input: ListProjectReflectionsInput): Promise<ListProjectReflectionsResult> {
    const admission = this.admit<ListProjectReflectionsResult>();
    if (admission !== undefined) return admission;
    const parsed = parseListProjectReflectionsInput(input);
    if (parsed === undefined) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    const scope = this.projectOwnership;
    if (scope === undefined) return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    let ownership: readonly ProjectOwnershipRecord[];
    try { ownership = await listProjectOwnership(scope); }
    catch { return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE }; }
    const registered = ownership.filter((record) => record.project_uid === parsed.project_uid);
    if (registered.length !== 1 || registered[0]?.principal_uid !== scope.principal_uid ||
        registered[0]?.schema_id !== "anima.dev-project-ownership/v1") {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const emptyResult = (): ListProjectReflectionsResult => ({ status: "completed", items: [], count: 0 });
    const outcome = await this.runRead(async (transaction) => {
      this.throwIfClosed();
      const project = await transaction.run(
        "MATCH (p:Project {project_uid: $project_uid}) RETURN labels(p) AS project_labels, properties(p) AS project_properties",
        { project_uid: parsed.project_uid },
      );
      if (project.records.length === 0) {
        const existing = await transaction.run(
          "MATCH (r:Reflection {project_uid: $project_uid}) RETURN count(r) AS count",
          { project_uid: parsed.project_uid },
        );
        if (existing.records.length !== 1 || numberValue(field(existing.records[0], "count")) !== 0) {
          throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
        return emptyResult();
      }
      const properties = field(project.records[0], "project_properties");
      if (project.records.length !== 1 || !this.validProjectIdentity(project.records[0], parsed.project_uid) ||
          !isRecord(properties) || properties.identity_fingerprint !== registered[0]!.identity_fingerprint) {
        throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      if (parsed.limit === 0) return emptyResult();
      try {
        const verified = new Map<string, { project_uid: string; session_uid: string; event_uids: ReadonlySet<string> }>();
        const items = await readScopedProjectReflections(transaction, parsed, async (candidate_uid) => {
          const cached = verified.get(candidate_uid);
          if (cached !== undefined) return cached;
          const source = await readExecutionCandidateSource({
            transaction,
            candidate_uid,
            readExecutionSource: this.readExecutionSource.bind(this),
            readRequestedExecutionUnits: this.readRequestedExecutionUnits.bind(this),
            domain: this.domain.bind(this),
          });
          const result = {
            project_uid: source.candidate.project_uid,
            session_uid: source.candidate.session_uid,
            event_uids: new Set(source.events.map((event) => event.event_uid)),
          };
          verified.set(candidate_uid, result);
          return result;
        });
        return { status: "completed", items, count: items.length } satisfies ListProjectReflectionsResult;
      } catch (error) {
        if (error instanceof ReflectionReadError) throw this.domain(error.code, IDENTITY_CONFLICT_MESSAGE);
        throw error;
      }
    });
    if (outcome.kind === "domain") return outcome.result as ListProjectReflectionsResult;
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    return outcome.result as ListProjectReflectionsResult;
  }

  async listSessionReviewCandidates(input: ListSessionReviewCandidatesInput): Promise<ListSessionReviewCandidatesResult> {
    const admission = this.admit<ListSessionReviewCandidatesResult>();
    if (admission !== undefined) return admission;
    const parsed = parseListSessionReviewCandidatesInput(input);
    if (parsed === undefined) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    const scope = this.projectOwnership;
    if (scope === undefined) return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    let ownership: readonly ProjectOwnershipRecord[];
    try { ownership = await listProjectOwnership(scope); }
    catch { return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE }; }
    const registered = ownership.filter((record) => record.project_uid === parsed.project_uid);
    if (registered.length !== 1 || registered[0]?.principal_uid !== scope.principal_uid ||
        registered[0]?.schema_id !== "anima.dev-project-ownership/v1") {
      return { status: "failed", code: "identity_conflict", message: IDENTITY_CONFLICT_MESSAGE };
    }
    const outcome = await this.runRead(async (transaction) => {
      this.throwIfClosed();
      const owner = await transaction.run(
        `MATCH (p:Project {project_uid: $project_uid})-[link:HAS_SESSION]->(s:Session {session_uid: $session_uid})
         RETURN labels(p) AS project_labels, properties(p) AS project_properties,
                labels(s) AS session_labels, properties(s) AS session_properties`,
        { project_uid: parsed.project_uid, session_uid: parsed.session_uid },
      );
      if (owner.records.length !== 1 || !this.validProjectIdentity(owner.records[0], parsed.project_uid)) {
        throw this.domain("not_found", NOT_FOUND_MESSAGE);
      }
      const project = field(owner.records[0], "project_properties");
      const session = field(owner.records[0], "session_properties");
      const labels = field(owner.records[0], "session_labels");
      if (!isRecord(project) || project.identity_fingerprint !== registered[0]!.identity_fingerprint ||
          !Array.isArray(labels) || labels.length !== 1 || labels[0] !== "Session" ||
          !isRecord(session) || session.session_uid !== parsed.session_uid || session.project_uid !== parsed.project_uid) {
        throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      if (parsed.limit === 0) return { status: "completed", candidates: [], count: 0 } satisfies ListSessionReviewCandidatesResult;
      await this.readExecutionSource(transaction, parsed);
      const candidates = (await this.readExecutionReviewCandidates(transaction, parsed))
        .filter((item) => item.execution_state === "completed");
      if (candidates.length === 0) return { status: "completed", candidates: [], count: 0 } satisfies ListSessionReviewCandidatesResult;
      const units = await this.readRequestedExecutionUnits(transaction, parsed, candidates.map((item) => item.execution_uid));
      const ends = new Map(units.map((unit) => [unit.execution_uid, unit]));
      if (ends.size !== candidates.length) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      for (const candidate of candidates) {
        const unit = ends.get(candidate.execution_uid);
        if (unit?.state !== "completed" || unit.terminal_event_uid === null ||
            !Number.isSafeInteger(unit.end_ingest_sequence)) {
          throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
      }
      candidates.sort((left, right) =>
        ends.get(right.execution_uid)!.end_ingest_sequence - ends.get(left.execution_uid)!.end_ingest_sequence ||
        left.candidate_uid.localeCompare(right.candidate_uid));
      const items = candidates.slice(0, parsed.limit).map((candidate) => {
        const createdAt = typeof candidate.created_at === "string"
          ? candidate.created_at.replace(/\[UTC\]$/u, "") : undefined;
        if (!validUtcInstant(createdAt)) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        return { candidate_uid: candidate.candidate_uid, execution_uid: candidate.execution_uid, created_at: createdAt };
      });
      return { status: "completed", candidates: items, count: items.length } satisfies ListSessionReviewCandidatesResult;
    });
    if (outcome.kind === "domain") return outcome.result as ListSessionReviewCandidatesResult;
    if (outcome.kind === "closed") return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    return outcome.result as ListSessionReviewCandidatesResult;
  }

  async materializeEpisode(input: MaterializeEpisodeInput): Promise<MaterializeEpisodeResult> {
    const admission = this.admit<MaterializeEpisodeResult>();
    if (admission !== undefined) return admission;
    const parsed = this.validateMaterializeInput(input);
    if (parsed.kind === "invalid") return parsed.result;
    const episode_uid = episodeUid(parsed.input.project_uid, parsed.input.window_uids[0]!);
    let firstObservation: EpisodeObservation | undefined;
    let savedEpisodeUid = episode_uid;
    let savedDecisionUid = episode_uid;
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      this.throwIfClosed();
      const firstPass = await this.loadEpisodePass(transaction, parsed.input, episode_uid);
      if (firstObservation === undefined) firstObservation = firstPass.observation;
      savedEpisodeUid = episode_uid;
      this.projectEpisodeOrDomain(parsed.input, firstPass);

      const sortedWindows = [...parsed.input.window_uids].sort();
      for (const window_uid of sortedWindows) {
        await transaction.run(
          `MATCH (w:BoundaryWindow {window_uid: $window_uid})
           SET w.window_uid = w.window_uid`,
          { window_uid },
        );
      }
      const lockedBeforeEpisode = await this.readEpisodeNode(transaction, episode_uid);
      if (lockedBeforeEpisode !== undefined) {
        await transaction.run(
          `MATCH (e:Episode {episode_uid: $episode_uid})
           SET e.episode_uid = e.episode_uid`,
          { episode_uid },
        );
      }

      const lockedPass = await this.loadEpisodePass(transaction, parsed.input, episode_uid);
      const lockedSourceFingerprint = episodeSourceFingerprint(lockedPass);
      const plan = this.projectEpisodeOrDomain(parsed.input, lockedPass);
      savedDecisionUid = plan.decision_uid;
      if (firstObservation !== undefined && !sameEpisodeObservation(firstObservation, lockedPass.observation)) {
        if (plan.result.status !== "duplicate") throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      }
      if (firstObservation?.present === true && lockedPass.observation.present === false) {
        throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      }
      if (plan.result.status === "materialized") {
        savedDecisionUid = plan.decision_uid;
      }
      let effectivePlan = plan;
      if (plan.episode.action !== "verify") {
        try {
          await this.applyEpisodePlan(transaction, markWrite, plan);
        } catch (error: unknown) {
          if (!(error instanceof ConcurrentEpisodeMatch)) throw error;
          const concurrentPass = await this.loadEpisodePass(transaction, parsed.input, episode_uid);
          const concurrentPlan = this.projectEpisodeOrDomain(parsed.input, concurrentPass);
          if (concurrentPlan.result.status !== "duplicate") throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
          await this.verifyEpisodePlan(transaction, concurrentPlan, concurrentPass);
          effectivePlan = concurrentPlan;
        }
      } else {
        await this.verifyEpisodePlan(transaction, plan, lockedPass);
      }

      const finalPass = await this.loadEpisodePass(transaction, parsed.input, episode_uid);
      if (episodeSourceFingerprint(finalPass) !== lockedSourceFingerprint) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const finalPlan = this.projectEpisodeOrDomain(parsed.input, finalPass);
      if (
        finalPlan.result.status !== "duplicate" ||
        finalPlan.new_window_assignments.length !== 0 ||
        finalPlan.new_evidence_links.length !== 0 ||
        finalPlan.decision_uid !== effectivePlan.decision_uid ||
        finalPlan.episode.after.revision !== effectivePlan.episode.after.revision
      ) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      return effectivePlan.result;
    });
    if (outcome.kind === "domain") return outcome.result as MaterializeEpisodeResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", episode_uid: savedEpisodeUid, decision_uid: savedDecisionUid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed") return this.closedMaterializeResult();
    return outcome.result as MaterializeEpisodeResult;
  }

  close(timeout_ms = this.shutdownTimeoutMs): Promise<void> {
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms <= 0) throw new TypeError("timeout_ms must be a positive safe integer.");
    if (this.closePromise !== undefined) return this.closePromise;
    this.admissionClosed = true;
    this.state = "closed";
    const deadline = performance.now() + timeout_ms;
    this.closeDriver();
    const waitFor = async (promise: Promise<unknown>): Promise<void> => {
      const remaining = Math.max(0, deadline - performance.now());
      if (remaining <= 0) return;
      await Promise.race([
        promise.then(() => undefined, () => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, remaining)),
      ]);
    };
    this.closePromise = (async () => {
      if (this.initialization !== undefined) await waitFor(this.initialization);
      if (this.driverClosePromise !== undefined) await waitFor(this.driverClosePromise);
    })();
    return this.closePromise;
  }

  private async initializeOnce(): Promise<MemoryStoreHealth> {
    let loaded: ConfigLoadResult;
    try {
      loaded = await this.configLoader(this.configPath);
    } catch {
      if (this.isClosed()) return this.closedHealth();
      this.state = "degraded";
      return this.errorHealth();
    }
    if (this.isClosed()) return this.closedHealth();
    if (loaded.kind === "disabled") {
      this.state = "degraded";
      return { status: "disabled", database: null, constraints: [] };
    }
    if (loaded.kind === "error") {
      this.state = "degraded";
      return { status: "error", database: null, constraints: [] };
    }
    try {
      const driver = this.driverFactory(loaded.config);
      this.driver = driver;
      if (this.isClosed()) {
        this.closeDriver();
        return this.closedHealth();
      }
      await driver.verifyConnectivity();
      if (this.isClosed()) {
        this.closeDriver();
        return this.closedHealth();
      }
      const session = driver.session({ database: loaded.config.database });
      try {
        const constraints = await session.run("SHOW CONSTRAINTS");
        if (this.isClosed()) {
          this.closeDriver();
          return this.closedHealth();
        }
        for (const expected of EXPECTED_CONSTRAINTS) {
          if (!constraints.records.some((record) => hasExpectedConstraint(record, expected))) throw new Error("schema");
        }
      } finally {
        await session.close();
        await releaseNeo4jSessionTurn();
      }
      if (this.isClosed()) {
        this.closeDriver();
        return this.closedHealth();
      }
      this.database = loaded.config.database;
      this.state = "connected";
      return { status: "connected", database: loaded.config.database, constraints: HEALTH_CONSTRAINTS };
    } catch {
      this.closeDriver();
      if (this.isClosed()) return this.closedHealth();
      this.state = "degraded";
      this.database = undefined;
      return this.errorHealth();
    }
  }

  private async readPreflight(input: ProcessSessionInput): Promise<PreflightSnapshot> {
    const driver = this.driver;
    if (driver === undefined || this.database === undefined) throw new Error("not connected");
    const session = driver.session({ database: this.database }) as unknown as SessionLike;
    try {
      const work = async (transaction: TxLike): Promise<PreflightSnapshot> => {
        const cursorResult = await transaction.run(
          `OPTIONAL MATCH (c:MemoryCursor {cursor_uid: $cursor_uid}) RETURN c AS cursor`,
          { cursor_uid: boundaryCursorUid(input.session_uid) },
        );
        const cursor = cursorFromNode(recordNode(cursorResult.records[0], "cursor"));
        const source = await this.readSource(transaction, input, cursor, true);
        const has_work = source.next_ingest_sequence > (cursor?.last_ingest_sequence ?? -1) + 1;
        return { source, has_work };
      };
      if (session.executeRead !== undefined) return await session.executeRead(work);
      return await work(session);
    } finally {
      await session.close();
      await releaseNeo4jSessionTurn();
    }
  }

  private async readSource(transaction: TxLike, input: ProcessSessionInput, cursor?: CursorState, skipEmptyEvents = false): Promise<SourceSnapshot> {
    this.throwIfClosed();
    const identityResult = await transaction.run(
      `OPTIONAL MATCH (p:Project {project_uid: $project_uid})
       OPTIONAL MATCH (s:Session {session_uid: $session_uid})
       OPTIONAL MATCH (p)-[has_session:HAS_SESSION]->(s)
       RETURN p AS p, s AS s, has_session AS has_session`,
      {
        project_uid: input.project_uid,
        session_uid: input.session_uid,
      },
    );
    const identity = identityResult.records[0];
    const project = recordNode(identity, "p");
    const session = recordNode(identity, "s");
    if (project === undefined || session === undefined) throw this.domain("not_found", NOT_FOUND_MESSAGE);
    if (!field(identity, "has_session")) throw this.domain("source_incomplete");
    if (
      nodeUid(project, "project_uid") !== input.project_uid ||
      nodeUid(session, "session_uid") !== input.session_uid ||
      nodeUid(session, "project_uid") !== input.project_uid
    ) throw this.domain("identity_conflict");
    const next_ingest_sequence = numberValue(session.next_ingest_sequence);
    if (next_ingest_sequence === undefined || next_ingest_sequence < 0) throw this.domain("source_incomplete");
    if (skipEmptyEvents && next_ingest_sequence === 0) return { project, session, events: [], next_ingest_sequence, cursor };

    const eventsResult = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid})
       OPTIONAL MATCH (s)-[has_event:HAS_EVENT]->(e:RawEvent)
       WHERE e.ingest_sequence < $next_ingest_sequence
       OPTIONAL MATCH (e)-[in_project:IN_PROJECT]->(p)
       RETURN e AS e, has_event AS has_event, in_project AS in_project
       ORDER BY e.ingest_sequence, e.event_uid`,
      {
        project_uid: input.project_uid,
        session_uid: input.session_uid,
        next_ingest_sequence,
      },
    );
    const events: BoundaryProjectorEvent[] = [];
    for (const record of eventsResult.records) {
      const eventNode = recordNode(record, "e");
      if (eventNode === undefined) continue;
      if (!field(record, "has_event") || !field(record, "in_project")) throw this.domain("source_incomplete");
      if (
        nodeUid(eventNode, "project_uid") !== input.project_uid ||
        nodeUid(eventNode, "session_uid") !== input.session_uid
      ) throw this.domain("identity_conflict");
      const event = asBoundaryEvent(eventNode);
      if (event === undefined) throw this.domain("source_incomplete");
      events.push(event);
    }
    events.sort((left, right) => left.ingest_sequence - right.ingest_sequence);
    if (events.length < next_ingest_sequence) throw this.domain("source_incomplete");
    const seen = new Set<number>();
    for (const event of events) {
      if (seen.has(event.ingest_sequence)) throw this.domain("source_incomplete");
      seen.add(event.ingest_sequence);
    }
    for (let sequence = 0; sequence < next_ingest_sequence; sequence += 1) {
      if (!seen.has(sequence)) throw this.domain("source_incomplete");
    }
    return { project, session, events, next_ingest_sequence, cursor };
  }

  private async readExecutionSource(transaction: TxLike, input: MaterializeExecutionUnitsInput): Promise<ExecutionSourceEvent[]> {
    const identityResult = await transaction.run(
      `OPTIONAL MATCH (p:Project {project_uid: $project_uid})
       OPTIONAL MATCH (s:Session {session_uid: $session_uid})
       OPTIONAL MATCH (p)-[has_session:HAS_SESSION]->(s)
       RETURN p AS p, s AS s, has_session AS has_session`,
      input,
    );
    const identity = identityResult.records[0];
    const project = recordNode(identity, "p");
    const session = recordNode(identity, "s");
    if (project === undefined || session === undefined) throw this.domain("not_found", NOT_FOUND_MESSAGE);
    if (!field(identity, "has_session")) throw this.domain("source_incomplete");
    if (nodeUid(project, "project_uid") !== input.project_uid || nodeUid(session, "session_uid") !== input.session_uid || nodeUid(session, "project_uid") !== input.project_uid) throw this.domain("identity_conflict");
    const next = numberValue(session.next_ingest_sequence);
    if (next === undefined || next < 0) throw this.domain("source_incomplete");
    // Keep this read on the committed prefix captured by the first read.
    const eventsResult = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid})
       OPTIONAL MATCH (s)-[has_event:HAS_EVENT]->(e:RawEvent)
       WHERE e.ingest_sequence < $next_ingest_sequence
       OPTIONAL MATCH (e)-[in_project:IN_PROJECT]->(p)
       RETURN e AS e, labels(e) AS labels, has_event AS has_event, in_project AS in_project
       ORDER BY e.ingest_sequence, e.event_uid`,
      { ...input, next_ingest_sequence: next },
    );
    const events: ExecutionSourceEvent[] = [];
    for (const record of eventsResult.records) {
      const node = recordNode(record, "e");
      if (node === undefined) continue;
      if (!field(record, "has_event") || !field(record, "in_project")) throw this.domain("source_incomplete");
      if (nodeUid(node, "project_uid") !== input.project_uid || nodeUid(node, "session_uid") !== input.session_uid) throw this.domain("identity_conflict");
      const labels = field(record, "labels");
      const kind = node.kind;
      const expectedLabel = kind === "message" ? "Message" : kind === "tool_call" ? "ToolCall" : kind === "tool_result" ? "ToolResult" : kind === "boundary" ? "BoundarySignal" : kind === "turn_end" ? "TurnEnd" : undefined;
      if (!Array.isArray(labels) || expectedLabel === undefined || !labels.includes("RawEvent") || !labels.includes(expectedLabel)) throw this.domain("identity_conflict");
      const event_uid = nodeUid(node, "event_uid");
      const ingest_sequence = numberValue(node.ingest_sequence);
      if (!canonicalUuid(event_uid) || ingest_sequence === undefined || ingest_sequence < 0) throw this.domain("source_incomplete");
      const fingerprint = node.fingerprint;
      if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint)) throw this.domain("identity_conflict");
      const base = { event_uid, project_uid: input.project_uid, session_uid: input.session_uid, ingest_sequence, fingerprint };
      if (kind === "message") {
        if (node.role !== "user" && node.role !== "assistant" && node.role !== "developer" && node.role !== "system" && node.role !== "unknown") throw this.domain("identity_conflict");
        const origin = node.message_origin === undefined ? null : node.message_origin;
        if (origin !== null && origin !== "external_user" && origin !== "runtime_synthetic") throw this.domain("identity_conflict");
        if (origin !== null && node.role !== "user") throw this.domain("identity_conflict");
        events.push({ ...base, kind: "message", role: node.role as "user" | "assistant" | "developer" | "system" | "unknown", message_origin: origin as "external_user" | "runtime_synthetic" | null });
      } else if (kind === "tool_call") {
        events.push({ ...base, kind: "tool_call" });
      } else if (kind === "tool_result") {
        if (node.outcome !== "success" && node.outcome !== "error" && node.outcome !== "cancelled" && node.outcome !== "unknown") throw this.domain("identity_conflict");
        let targetUid: string | null = null;
        let correlationMethod: string | undefined;
        if (typeof node.correlation_json === "string") {
          let correlation: unknown;
          try { correlation = JSON.parse(node.correlation_json); } catch { throw this.domain("identity_conflict"); }
          if (!isRecord(correlation) || typeof correlation.method !== "string") throw this.domain("identity_conflict");
          correlationMethod = correlation.method;
          const correlationTarget = correlation.target_event_uid ?? correlation.source_tool_call_id;
          if (correlation.method !== "missing" && correlationTarget !== undefined) {
            if (!canonicalUuid(correlationTarget)) throw this.domain("identity_conflict");
            targetUid = correlationTarget;
          }
        }
        if (correlationMethod === undefined) throw this.domain("identity_conflict");
        const resultLinks = await transaction.run(
          `MATCH (e:RawEvent {event_uid: $event_uid})
           OPTIONAL MATCH (e)-[r:RESULT_OF]->(target:RawEvent)
           RETURN target.event_uid AS target_uid, properties(r) AS properties, target AS target`,
          { event_uid },
        );
        const links = resultLinks.records.filter((item) => field(item, "target_uid") !== null && field(item, "target_uid") !== undefined);
        if (links.length > 1 || (targetUid !== null && (links.length !== 1 || field(links[0], "target_uid") !== targetUid)) || (targetUid === null && correlationMethod === "source" && links.length !== 1) || (targetUid === null && correlationMethod === "derived" && links.length !== 1) || (targetUid === null && correlationMethod === "missing" && links.length !== 0) || (targetUid === null && correlationMethod === undefined && links.length !== 0)) throw this.domain("identity_conflict");
        if (links.length === 1 && (!isRecord(field(links[0], "properties")) || Object.keys(field(links[0], "properties") as Record<string, unknown>).length !== 0)) throw this.domain("identity_conflict");
        if (targetUid === null && links.length === 1) targetUid = String(field(links[0], "target_uid"));
        events.push({ ...base, kind: "tool_result", outcome: node.outcome as "success" | "error" | "cancelled" | "unknown", result_of_event_uid: targetUid });
      } else if (kind === "turn_end") {
        const turn_index = numberValue(node.turn_index);
        if (turn_index === undefined || turn_index < 0 || !Number.isSafeInteger(turn_index) || (node.turn_end_status !== "nonterminal" && node.turn_end_status !== "final_reply" && node.turn_end_status !== "cancelled")) throw this.domain("identity_conflict");
        events.push({ ...base, kind: "turn_end", turn_index, turn_end_status: node.turn_end_status as "nonterminal" | "final_reply" | "cancelled" });
      } else if (kind === "boundary") {
        if (node.boundary_type !== "checkpoint" && node.boundary_type !== "compact" && node.boundary_type !== "shutdown" && node.boundary_type !== "validation" && node.boundary_type !== "unknown") throw this.domain("identity_conflict");
        events.push({ ...base, kind: "boundary", boundary_type: node.boundary_type as "checkpoint" | "compact" | "shutdown" | "validation" | "unknown" });
      } else {
        throw this.domain("identity_conflict");
      }
    }
    events.sort((left, right) => left.ingest_sequence - right.ingest_sequence || left.event_uid.localeCompare(right.event_uid));
    if (events.length !== next) throw this.domain("source_incomplete");
    for (let index = 0; index < events.length; index += 1) if (events[index]!.ingest_sequence !== index) throw this.domain("source_incomplete");
    return events;
  }

  private readExecutionUnits(
    transaction: TxLike,
    input: MaterializeExecutionUnitsInput,
    candidateExecutionUids: readonly string[],
  ): Promise<ExecutionUnitSnapshot[]> {
    return this.readExecutionUnitsScoped(transaction, input, candidateExecutionUids, false);
  }

  private readRequestedExecutionUnits(
    transaction: TxLike,
    input: MaterializeExecutionUnitsInput,
    candidateExecutionUids: readonly string[],
  ): Promise<ExecutionUnitSnapshot[]> {
    return this.readExecutionUnitsScoped(transaction, input, candidateExecutionUids, true);
  }

  private async readExecutionUnitsScoped(
    transaction: TxLike,
    input: MaterializeExecutionUnitsInput,
    candidateExecutionUids: readonly string[],
    requestedOnly: boolean,
  ): Promise<ExecutionUnitSnapshot[]> {
    const candidateParameters = { ...input, execution_uids: [...candidateExecutionUids] };
    const ownedQuery = requestedOnly
      ? `UNWIND $execution_uids AS execution_uid
         MATCH (u:ExecutionUnit {execution_uid: execution_uid})
         OPTIONAL MATCH (ownerSession:Session)-[owner:HAS_EXECUTION]->(u)
         RETURN u AS u, labels(u) AS labels, ownerSession.session_uid AS owner_session_uid, properties(owner) AS owner`
      : `MATCH (s:Session {session_uid: $session_uid})-[owner:HAS_EXECUTION]->(u)
         RETURN u AS u, labels(u) AS labels, properties(owner) AS owner`;
    const ownedResult = await transaction.run(
      ownedQuery,
      requestedOnly ? candidateParameters : input,
    );
    const orphanRecords = requestedOnly
      ? []
      : (await transaction.run(
        `UNWIND $execution_uids AS execution_uid
         MATCH (u:ExecutionUnit {execution_uid: execution_uid})
         WHERE NOT EXISTS {
           MATCH (:Session {session_uid: $session_uid})-[:HAS_EXECUTION]->(u)
         }
         RETURN u AS u, labels(u) AS labels, null AS owner`,
        candidateParameters,
      )).records;
    const unitRecords = [...ownedResult.records, ...orphanRecords];
    if (requestedOnly && unitRecords.length !== candidateExecutionUids.length) throw this.domain("identity_conflict");
    const snapshots: ExecutionUnitSnapshot[] = [];
    const seenUnits = new Set<string>();
    const contained = new Set<string>();
    for (const record of unitRecords) {
      const node = recordNode(record, "u");
      if (node === undefined) throw this.domain("identity_conflict");
      const nodeUidValue = node.execution_uid;
      if (typeof nodeUidValue === "string") {
        if (seenUnits.has(nodeUidValue)) throw this.domain("identity_conflict");
        seenUnits.add(nodeUidValue);
      }
      const labels = field(record, "labels");
      if (!Array.isArray(labels) || labels.length !== 1 || labels[0] !== "ExecutionUnit") throw this.domain("identity_conflict");
      const owner = field(record, "owner");
      if (!isRecord(owner) || !exactKeys(owner, ["schema_id"]) || owner.schema_id !== "anima.session-execution-link/v1.0") throw this.domain("identity_conflict");
      if (requestedOnly && field(record, "owner_session_uid") !== input.session_uid) throw this.domain("identity_conflict");
      if (node.project_uid !== input.project_uid || node.session_uid !== input.session_uid) throw this.domain("identity_conflict");
      const nodeKeys = ["execution_uid", "schema_id", "projector_version", "project_uid", "session_uid", "initiator_kind", "initiator_event_uid", "first_tool_call_event_uid", "start_ingest_sequence", "end_ingest_sequence", "event_count", "state", "source_fingerprint"];
      const terminal = node.state === "completed" || node.state === "cancelled" || node.state === "interrupted";
      const expectedNodeKeys = terminal ? [...nodeKeys, "terminal_reason", "terminal_event_uid"] : nodeKeys;
      if (!exactKeys(node, expectedNodeKeys) || node.schema_id !== "anima.execution-unit/v1.0" || node.projector_version !== EXECUTION_PROJECTOR_VERSION) throw this.domain("identity_conflict");
      const execution_uid = node.execution_uid;
      if (!canonicalUuid(execution_uid)) throw this.domain("identity_conflict");
      if (
        (node.state !== "open" && node.state !== "completed" && node.state !== "cancelled" && node.state !== "interrupted") ||
        node.initiator_kind !== "user_request" ||
        !canonicalUuid(node.execution_uid) ||
        !canonicalUuid(node.initiator_event_uid) ||
        !canonicalUuid(node.first_tool_call_event_uid) ||
        !Number.isSafeInteger(numberValue(node.start_ingest_sequence)) ||
        !Number.isSafeInteger(numberValue(node.end_ingest_sequence)) ||
        !Number.isSafeInteger(numberValue(node.event_count)) ||
        (typeof node.source_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(node.source_fingerprint))
      ) throw this.domain("identity_conflict");
      if (
        terminal &&
        (!canonicalUuid(node.terminal_event_uid) ||
          (node.terminal_reason !== "final_reply" && node.terminal_reason !== "user_cancelled" && node.terminal_reason !== "session_compact" && node.terminal_reason !== "session_shutdown"))
      ) throw this.domain("identity_conflict");
      const containsResult = await transaction.run(
        `MATCH (u:ExecutionUnit {execution_uid: $execution_uid})-[r:CONTAINS]->(e:RawEvent)
         RETURN properties(r) AS properties, e.event_uid AS event_uid, e.project_uid AS project_uid, e.session_uid AS session_uid`,
        { execution_uid },
      );
      const contains: Array<{ event_uid: string; position: number; role: ExecutionUnitSnapshot["contains_roles"][number] }> = [];
      for (const item of containsResult.records) {
        const properties = field(item, "properties");
        const event_uid = field(item, "event_uid");
        const position = numberValue(isRecord(properties) ? properties.position : undefined);
        const role = isRecord(properties) ? properties.role : undefined;
        if (!isRecord(properties) || !exactKeys(properties, ["schema_id", "position", "role"]) || properties.schema_id !== "anima.execution-event/v1.0" || !canonicalUuid(event_uid) || position === undefined || !["initiator", "first_tool_call", "member", "terminal"].includes(String(role)) || field(item, "project_uid") !== input.project_uid || field(item, "session_uid") !== input.session_uid) throw this.domain("identity_conflict");
        if (contained.has(event_uid)) throw this.domain("identity_conflict");
        contained.add(event_uid);
        contains.push({ event_uid, position, role: role as ExecutionUnitSnapshot["contains_roles"][number] });
      }
      contains.sort((left, right) => left.position - right.position);
      const firstToolCallPosition = contains.findIndex((item) => item.role === "first_tool_call");
      if (contains.length < 2 || contains[0]!.role !== "initiator" || firstToolCallPosition < 1 || contains.slice(1, firstToolCallPosition).some((item) => item.role !== "member") || contains.slice(firstToolCallPosition + 1, -1).some((item) => item.role !== "member") || (node.state === "open" ? contains.at(-1)!.role === "terminal" : contains.at(-1)!.role !== "terminal")) throw this.domain("identity_conflict");
      if (contains.some((item, index) => item.position !== index)) throw this.domain("identity_conflict");
      const initiatorResult = await transaction.run(
        `MATCH (u:ExecutionUnit {execution_uid: $execution_uid})-[r:INITIATED_BY]->(e:RawEvent)
         RETURN properties(r) AS properties, e.event_uid AS event_uid`,
        { execution_uid },
      );
      if (initiatorResult.records.length !== 1) throw this.domain("identity_conflict");
      const initiatorProperties = field(initiatorResult.records[0], "properties");
      const initiatedBy = field(initiatorResult.records[0], "event_uid");
      if (!isRecord(initiatorProperties) || !exactKeys(initiatorProperties, ["schema_id"]) || initiatorProperties.schema_id !== "anima.execution-initiator/v1.0" || !canonicalUuid(initiatedBy)) throw this.domain("identity_conflict");
      const finalizerResult = await transaction.run(
        `MATCH (u:ExecutionUnit {execution_uid: $execution_uid})-[r:FINALIZED_BY]->(e:RawEvent)
         RETURN properties(r) AS properties, e.event_uid AS event_uid`,
        { execution_uid },
      );
      if (finalizerResult.records.length > 1) throw this.domain("identity_conflict");
      const finalizer = finalizerResult.records[0];
      const finalizedBy = finalizer === undefined ? null : field(finalizer, "event_uid");
      const finalizerProperties = finalizer === undefined ? null : field(finalizer, "properties");
      if (finalizer !== undefined && (!isRecord(finalizerProperties) || !exactKeys(finalizerProperties, ["schema_id", "terminal_reason"]) || finalizerProperties.schema_id !== "anima.execution-terminal/v1.0" || !canonicalUuid(finalizedBy) || finalizerProperties.terminal_reason !== node.terminal_reason)) throw this.domain("identity_conflict");
      if ((node.state === "open") !== (finalizer === undefined)) throw this.domain("identity_conflict");
      const snapshot: ExecutionUnitSnapshot = {
        execution_uid,
        project_uid: String(node.project_uid),
        session_uid: String(node.session_uid),
        initiator_kind: node.initiator_kind as "user_request",
        initiator_event_uid: String(node.initiator_event_uid),
        first_tool_call_event_uid: String(node.first_tool_call_event_uid),
        start_ingest_sequence: numberValue(node.start_ingest_sequence) ?? -1,
        end_ingest_sequence: numberValue(node.end_ingest_sequence) ?? -1,
        event_count: numberValue(node.event_count) ?? -1,
        state: node.state as ExecutionUnitSnapshot["state"],
        source_fingerprint: String(node.source_fingerprint),
        ordered_event_uids: contains.map((item) => item.event_uid),
        contains_roles: contains.map((item) => item.role),
        initiated_by_event_uid: String(initiatedBy),
        finalized_by_event_uid: finalizedBy as string | null,
        terminal_reason: node.terminal_reason === undefined ? null : node.terminal_reason as ExecutionUnitSnapshot["terminal_reason"],
        terminal_event_uid: node.terminal_event_uid === undefined ? null : node.terminal_event_uid as string | null,
      };
      if (snapshot.initiator_event_uid !== snapshot.initiated_by_event_uid || snapshot.ordered_event_uids[snapshot.contains_roles.indexOf("first_tool_call")] !== snapshot.first_tool_call_event_uid) throw this.domain("identity_conflict");
      snapshots.push(snapshot);
    }
    return snapshots;
  }


  private async readExecutionReviewCandidates(
    transaction: TxLike,
    input: MaterializeExecutionReviewCandidatesInput,
  ): Promise<ExecutionReviewCandidateSnapshot[]> {
    const result = await transaction.run(
      `MATCH (c:ExecutionReviewCandidate {project_uid: $project_uid, session_uid: $session_uid})
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
               skip_reason: c.skip_reason} AS candidate`,
      input,
    );
    const candidates: ExecutionReviewCandidateSnapshot[] = [];
    const scopedCandidateUids = new Set<string>();
    for (const record of result.records) {
      const candidateValue = field(record, "candidate");
      if (isRecord(candidateValue) && typeof candidateValue.candidate_uid === "string") scopedCandidateUids.add(candidateValue.candidate_uid);
    }
    const attachedResult = await transaction.run(
      `MATCH (u:ExecutionUnit {project_uid: $project_uid, session_uid: $session_uid})-[r:HAS_REVIEW_CANDIDATE]->(c)
       RETURN labels(c) AS labels, {candidate_uid: c.candidate_uid, execution_uid: c.execution_uid, project_uid: c.project_uid, session_uid: c.session_uid} AS candidate, {execution_uid: u.execution_uid} AS execution, properties(r) AS relation`,
      input,
    );
    for (const attached of attachedResult.records) {
      const labels = field(attached, "labels");
      const candidateValue = field(attached, "candidate");
      const execution = field(attached, "execution");
      const relation = field(attached, "relation");
      if (!Array.isArray(labels) || labels.length !== 1 || labels[0] !== "ExecutionReviewCandidate" || !isRecord(candidateValue) || typeof candidateValue.candidate_uid !== "string" || !scopedCandidateUids.has(candidateValue.candidate_uid) || !isRecord(execution) || candidateValue.execution_uid !== execution.execution_uid || candidateValue.project_uid !== input.project_uid || candidateValue.session_uid !== input.session_uid || !isRecord(relation) || !exactKeys(relation, ["schema_id"]) || relation.schema_id !== "anima.execution-review-candidate-link/v1.0") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
    for (const record of result.records) {
      const labels = field(record, "labels");
      const keys = field(record, "keys");
      const candidateValue = field(record, "candidate");
      if (!Array.isArray(labels) || labels.length !== 1 || labels[0] !== "ExecutionReviewCandidate" || !Array.isArray(keys) || !isRecord(candidateValue)) {
        throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      const candidateRecord: NodeProperties = { ...candidateValue };
      for (const key of ["lease_owner", "lease_token", "lease_until", "leased_at", "reviewed_at", "skip_reason", "rejection_reason"] as const) {
        if (candidateRecord[key] === null || candidateRecord[key] === undefined) delete candidateRecord[key];
      }
      const candidate = this.reviewCandidateFromRecord(candidateRecord, keys.map(String));
      const hasResult = await transaction.run(
        `MATCH (u)-[r:HAS_REVIEW_CANDIDATE]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         RETURN labels(u) AS labels, {execution_uid: u.execution_uid, project_uid: u.project_uid, session_uid: u.session_uid} AS execution, properties(r) AS relation`,
        { candidate_uid: candidate.candidate_uid },
      );
      const reverseHasResult = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[r:HAS_REVIEW_CANDIDATE]->(u)
         RETURN labels(u) AS labels, properties(r) AS relation`,
        { candidate_uid: candidate.candidate_uid },
      );
      if (hasResult.records.length !== 1 || reverseHasResult.records.length !== 0) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const has = hasResult.records[0]!;
      const hasLabels = field(has, "labels");
      const execution = field(has, "execution");
      const hasRelation = field(has, "relation");
      if (!Array.isArray(hasLabels) || hasLabels.length !== 1 || hasLabels[0] !== "ExecutionUnit" || !isRecord(execution) || execution.execution_uid !== candidate.execution_uid || execution.project_uid !== input.project_uid || execution.session_uid !== input.session_uid || !isRecord(hasRelation) || !exactKeys(hasRelation, ["schema_id"]) || hasRelation.schema_id !== "anima.execution-review-candidate-link/v1.0") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const targetResult = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[r:REVIEWS]->(u)
         RETURN labels(u) AS labels, {execution_uid: u.execution_uid, project_uid: u.project_uid, session_uid: u.session_uid} AS execution, properties(r) AS relation`,
        { candidate_uid: candidate.candidate_uid },
      );
      const reverseTargetResult = await transaction.run(
        `MATCH (u)-[r:REVIEWS]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         RETURN labels(u) AS labels, properties(r) AS relation`,
        { candidate_uid: candidate.candidate_uid },
      );
      if (targetResult.records.length !== 1 || reverseTargetResult.records.length !== 0) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const target = targetResult.records[0]!;
      const targetLabels = field(target, "labels");
      const targetExecution = field(target, "execution");
      const targetRelation = field(target, "relation");
      if (!Array.isArray(targetLabels) || targetLabels.length !== 1 || targetLabels[0] !== "ExecutionUnit" || !isRecord(targetExecution) || !equalIdentity(targetExecution, execution) || !isRecord(targetRelation) || !exactKeys(targetRelation, ["schema_id"]) || targetRelation.schema_id !== "anima.execution-review-target/v1.0") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const evidenceResult = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[r:EVIDENCED_BY]->(event)
         RETURN labels(event) AS labels, event.event_uid AS event_uid, event.project_uid AS project_uid, event.session_uid AS session_uid, properties(r) AS relation`,
        { candidate_uid: candidate.candidate_uid },
      );
      const reverseEvidenceResult = await transaction.run(
        `MATCH (event)-[r:EVIDENCED_BY]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         RETURN properties(r) AS relation`,
        { candidate_uid: candidate.candidate_uid },
      );
      if (reverseEvidenceResult.records.length !== 0) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const containsResult = await transaction.run(
        `MATCH (u:ExecutionUnit {execution_uid: $execution_uid})-[r:CONTAINS]->(event:RawEvent)
         RETURN event.event_uid AS event_uid, event.project_uid AS project_uid, event.session_uid AS session_uid, properties(r) AS relation`,
        { execution_uid: candidate.execution_uid },
      );
      if (evidenceResult.records.length !== containsResult.records.length) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const expectedEvidence = new Map<string, { position: number; role: string; project_uid: string; session_uid: string }>();
      for (const contains of containsResult.records) {
        const event_uid = field(contains, "event_uid");
        const relation = field(contains, "relation");
        const position = numberValue(isRecord(relation) ? relation.position : undefined);
        const role = isRecord(relation) ? relation.role : undefined;
        const project_uid = field(contains, "project_uid");
        const session_uid = field(contains, "session_uid");
        if (typeof event_uid !== "string" || position === undefined || typeof role !== "string" || typeof project_uid !== "string" || typeof session_uid !== "string" || !isRecord(relation) || !exactKeys(relation, ["schema_id", "position", "role"]) || relation.schema_id !== "anima.execution-event/v1.0") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        expectedEvidence.set(event_uid, { position, role, project_uid, session_uid });
      }
      const seenEvidence = new Set<string>();
      for (const evidence of evidenceResult.records) {
        const labels = field(evidence, "labels");
        const event_uid = field(evidence, "event_uid");
        const project_uid = field(evidence, "project_uid");
        const session_uid = field(evidence, "session_uid");
        const relation = field(evidence, "relation");
        const expected = typeof event_uid === "string" ? expectedEvidence.get(event_uid) : undefined;
        if (!Array.isArray(labels) || !labels.includes("RawEvent") || typeof event_uid !== "string" || seenEvidence.has(event_uid) || expected === undefined || project_uid !== input.project_uid || session_uid !== input.session_uid || !isRecord(relation) || !exactKeys(relation, ["schema_id", "position", "role"]) || relation.schema_id !== "anima.execution-review-evidence/v1.0" || numberValue(relation.position) !== expected.position || relation.role !== expected.role || expected.project_uid !== input.project_uid || expected.session_uid !== input.session_uid) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        seenEvidence.add(event_uid);
      }
      candidates.push(candidate as unknown as ExecutionReviewCandidateSnapshot);
    }
    return candidates;
  }

  private async claimExecutionReviewCandidate(transaction: TxLike, markWrite: () => void, input: ReviewExecutionCandidateInput): Promise<ReviewClaim> {
    const sourceResult = await transaction.run(
      `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
       OPTIONAL MATCH (c)-[evidence:EVIDENCED_BY]->(event:RawEvent)
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
               skip_reason: c.skip_reason, rejection_reason: c.rejection_reason} AS candidate,
              labels(event) AS event_labels, properties(event) AS event,
              properties(evidence) AS evidence`,
      { candidate_uid: input.candidate_uid },
    );
    if (sourceResult.records.length === 0) throw this.domain("not_found", NOT_FOUND_MESSAGE);
    const first = sourceResult.records[0]!;
    const labels = field(first, "labels");
    const keys = field(first, "keys");
    const rawCandidate = field(first, "candidate");
    if (!Array.isArray(labels) || labels.length !== 1 || labels[0] !== "ExecutionReviewCandidate" || !Array.isArray(keys) || !isRecord(rawCandidate)) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const candidate = this.reviewCandidateFromRecord(rawCandidate, keys.map(String));
    if (candidate.candidate_uid !== input.candidate_uid) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const sourceEvents: ReviewCandidateSourceEvent[] = [];
    const seen = new Set<string>();
    for (const record of sourceResult.records) {
      const eventLabels = field(record, "event_labels");
      const event = field(record, "event");
      const relation = field(record, "evidence");
      if (event === null || event === undefined) continue;
      if (!Array.isArray(eventLabels) || !eventLabels.includes("RawEvent") || !isRecord(event) || !isRecord(relation) || !exactKeys(relation, ["schema_id", "position", "role"]) || relation.schema_id !== "anima.execution-review-evidence/v1.0") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const event_uid = event.event_uid;
      const position = numberValue(relation.position);
      const role = relation.role;
      if (!canonicalUuid(event_uid) || position === undefined || position < 0 || seen.has(event_uid) || typeof event.kind !== "string" || typeof role !== "string" || event.project_uid !== candidate.project_uid || event.session_uid !== candidate.session_uid) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const projected: ReviewCandidateSourceEvent = { event_uid, kind: event.kind, position, role, properties: event };
      if (typeof event.outcome === "string") projected.outcome = event.outcome;
      if (event.message_origin === null || typeof event.message_origin === "string") projected.message_origin = event.message_origin;
      if (typeof event.tool_name === "string") projected.tool_name = event.tool_name;
      if (typeof event.correlation_json === "string") {
        let correlation: unknown;
        try { correlation = JSON.parse(event.correlation_json); } catch { throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE); }
        if (!isRecord(correlation) || typeof correlation.method !== "string") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        const target = correlation.target_event_uid;
        if (target !== undefined && target !== null && !canonicalUuid(target)) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        if (projected.result_of_event_uid === undefined) projected.result_of_event_uid = target === undefined ? null : target as string | null;
      }
      if (event.kind === "tool_result") {
        const resultLinks = await transaction.run(
          `MATCH (event:RawEvent {event_uid: $event_uid})-[:RESULT_OF]->(target:RawEvent)
           RETURN target.event_uid AS target_uid`,
          { event_uid },
        );
        if (resultLinks.records.length > 1) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        const targetUid = field(resultLinks.records[0], "target_uid");
        if (targetUid !== undefined && targetUid !== null && !canonicalUuid(targetUid)) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        projected.result_of_event_uid = targetUid === undefined || targetUid === null ? null : targetUid;
      }
      if (typeof event.boundary_type === "string") projected.boundary_type = event.boundary_type;
      const turnIndex = numberValue(event.turn_index);
      if (turnIndex !== undefined) projected.turn_index = turnIndex;
      if (typeof event.turn_end_status === "string") projected.turn_end_status = event.turn_end_status;
      sourceEvents.push(projected);
    }
    sourceEvents.sort((left, right) => left.position - right.position);
    for (let index = 0; index < sourceEvents.length; index += 1) if (sourceEvents[index]!.position !== index) throw this.domain("source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
    if (sourceEvents.length === 0) throw this.domain("source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
    const identity = await transaction.run(
      `MATCH (owner:ExecutionUnit)-[has:HAS_REVIEW_CANDIDATE]->(c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
       MATCH (c)-[reviews:REVIEWS]->(target:ExecutionUnit)
       RETURN labels(owner) AS owner_labels, properties(has) AS has,
              labels(target) AS target_labels, properties(reviews) AS reviews,
              target.execution_uid AS execution_uid, target.project_uid AS project_uid,
              target.session_uid AS session_uid, target.source_fingerprint AS source_fingerprint`,
      { candidate_uid: input.candidate_uid },
    );
    if (identity.records.length !== 1) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const identityRecord = identity.records[0]!;
    const ownerLabels = field(identityRecord, "owner_labels");
    const targetLabels = field(identityRecord, "target_labels");
    const has = field(identityRecord, "has");
    const reviews = field(identityRecord, "reviews");
    if (!Array.isArray(ownerLabels) || ownerLabels.length !== 1 || ownerLabels[0] !== "ExecutionUnit" || !Array.isArray(targetLabels) || targetLabels.length !== 1 || targetLabels[0] !== "ExecutionUnit" || !isRecord(has) || !exactKeys(has, ["schema_id"]) || has.schema_id !== "anima.execution-review-candidate-link/v1.0" || !isRecord(reviews) || !exactKeys(reviews, ["schema_id"]) || reviews.schema_id !== "anima.execution-review-target/v1.0" || field(identityRecord, "execution_uid") !== candidate.execution_uid || field(identityRecord, "project_uid") !== candidate.project_uid || field(identityRecord, "session_uid") !== candidate.session_uid || field(identityRecord, "source_fingerprint") !== candidate.source_fingerprint) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const leaseToken = randomUUID();
    const claimResult = await transaction.run(
      `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
       WITH c, datetime() AS now
       WITH c, (c.state = "ready" OR (c.state = "leased" AND c.lease_until <= now)) AS claimable, now
       FOREACH (_ IN CASE WHEN claimable THEN [1] ELSE [] END |
         SET c.state = "leased", c.lease_owner = $lease_owner, c.lease_token = $lease_token,
             c.lease_until = now + duration({milliseconds: $lease_ttl_ms}), c.leased_at = now,
             c.reviewed_at = null, c.skip_reason = null, c.rejection_reason = null)
       RETURN claimable AS claimable, c.lease_token AS lease_token`,
      { candidate_uid: input.candidate_uid, lease_owner: input.lease_owner, lease_token: leaseToken, lease_ttl_ms: input.lease_ttl_ms },
    );
    const claimed = claimResult.records[0];
    if (claimed === undefined || field(claimed, "claimable") !== true) {
      if (candidate.state === "reviewed" || candidate.state === "skipped") return { candidate, lease_token: "", source_events: sourceEvents, terminal: { skip_reason: candidate.skip_reason ?? "already_reviewed" } };
      return { candidate, lease_token: "", source_events: sourceEvents, busy: true };
    }
    markWrite();
    const leasedCandidate: ExecutionReviewCandidateWorkflow = { ...candidate, state: "leased", lease_owner: input.lease_owner, lease_token: leaseToken };
    return { candidate: leasedCandidate, lease_token: leaseToken, source_events: sourceEvents };
  }

  private reviewCandidateFromRecord(raw: Record<string, unknown>, keys: readonly string[]): ExecutionReviewCandidateWorkflow {
    const state = raw.state;
    if (state !== "ready" && state !== "leased" && state !== "reviewed" && state !== "skipped") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const immutable = [...CANDIDATE_NODE_KEYS];
    const workflow = state === "ready" ? [] : state === "leased" ? ["lease_owner", "lease_token", "lease_until", "leased_at"] : ["reviewed_at", ...(state === "skipped" ? ["skip_reason"] : [])];
    const expected = [...immutable, ...workflow].sort();
    if (keys.slice().sort().join("|") !== expected.join("|")) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    if (!canonicalUuid(raw.candidate_uid) || !canonicalUuid(raw.execution_uid) || !canonicalUuid(raw.project_uid) || !canonicalUuid(raw.session_uid) || raw.review_contract_version !== "v1" || (raw.execution_state !== "completed" && raw.execution_state !== "cancelled" && raw.execution_state !== "interrupted") || (raw.terminal_reason !== "final_reply" && raw.terminal_reason !== "user_cancelled" && raw.terminal_reason !== "session_compact" && raw.terminal_reason !== "session_shutdown") || typeof raw.source_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(raw.source_fingerprint) || numberValue(raw.tool_call_count) === undefined || numberValue(raw.tool_result_count) === undefined || numberValue(raw.tool_error_count) === undefined) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    if (state === "leased" && (typeof raw.lease_owner !== "string" || typeof raw.lease_token !== "string" || !UUID_PATTERN.test(raw.lease_token) || typeof raw.lease_until !== "string" || typeof raw.leased_at !== "string")) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    if ((state === "reviewed" || state === "skipped") && typeof raw.reviewed_at !== "string") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    if (state === "skipped" && raw.skip_reason !== "no_reusable_content" && raw.skip_reason !== "duplicate_low_value" && raw.skip_reason !== "insufficient_interpretation") throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    return {
      candidate_uid: raw.candidate_uid,
      execution_uid: raw.execution_uid,
      project_uid: raw.project_uid,
      session_uid: raw.session_uid,
      review_contract_version: "v1",
      execution_state: raw.execution_state,
      terminal_reason: raw.terminal_reason,
      source_fingerprint: raw.source_fingerprint,
      tool_call_count: numberValue(raw.tool_call_count)!,
      tool_result_count: numberValue(raw.tool_result_count)!,
      tool_error_count: numberValue(raw.tool_error_count)!,
      state,
      ...(typeof raw.created_at === "string" ? { created_at: raw.created_at } : {}),
      ...(state === "leased" ? { lease_owner: raw.lease_owner, lease_token: raw.lease_token, lease_until: raw.lease_until, leased_at: raw.leased_at } : {}),
      ...(state === "reviewed" || state === "skipped" ? { reviewed_at: raw.reviewed_at, ...(state === "skipped" ? { skip_reason: raw.skip_reason } : {}) } : {}),
    } as ExecutionReviewCandidateWorkflow;
  }

  private async releaseExecutionReviewCandidate(candidate_uid: string, lease_token: string): Promise<void> {
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      const result = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid, state: "leased", lease_token: $lease_token})
         SET c.state = "ready"
         REMOVE c.lease_owner, c.lease_token, c.lease_until, c.leased_at,
                c.reviewed_at, c.skip_reason, c.rejection_reason
         RETURN count(c) AS count`,
        { candidate_uid, lease_token },
      );
      if (numberValue(field(result.records[0], "count")) !== 1) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      markWrite();
      return { status: "indeterminate", candidate_uid, message: "Execution review lease released." } satisfies ExecutionReviewOperationResult;
    });
    void outcome;
  }

  private async persistExecutionReview(input: ReviewExecutionCandidateInput, lease_token: string, plan: ExecutionReviewPlan): Promise<ExecutionReviewOperationResult> {
    const outcome = await this.runWrite(async (transaction, markWrite) => {
      const candidateResult = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         OPTIONAL MATCH (c)-[candidateTarget:REVIEWS]->(u:ExecutionUnit)
         RETURN keys(c) AS keys, properties(c) AS candidate, count(candidateTarget) AS target_count,
                u.execution_uid AS execution_uid, u.project_uid AS project_uid,
                u.session_uid AS session_uid, u.source_fingerprint AS source_fingerprint`,
        { candidate_uid: input.candidate_uid },
      );
      if (candidateResult.records.length !== 1) throw this.domain("not_found", NOT_FOUND_MESSAGE);
      const candidateRecord = candidateResult.records[0]!;
      const current = field(candidateRecord, "candidate");
      if (!isRecord(current) || numberValue(field(candidateRecord, "target_count")) !== 1 || current.state !== "leased" || current.lease_token !== lease_token || current.execution_uid !== plan.facts.execution_uid || current.source_fingerprint !== plan.facts.source_fingerprint || field(candidateRecord, "execution_uid") !== plan.facts.execution_uid || field(candidateRecord, "project_uid") !== plan.facts.project_uid || field(candidateRecord, "session_uid") !== plan.facts.session_uid || field(candidateRecord, "source_fingerprint") !== plan.facts.source_fingerprint) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const evidenceUids = [...new Set(plan.evidence_links.map((link) => link.event_uid))];
      const evidenceCheck = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[:EVIDENCED_BY]->(event:RawEvent)
         WHERE event.event_uid IN $event_uids
         RETURN count(DISTINCT event) AS count`,
        { candidate_uid: input.candidate_uid, event_uids: evidenceUids },
      );
      if (numberValue(field(evidenceCheck.records[0], "count")) !== evidenceUids.length) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const existing = await transaction.run(
        `MATCH (r:ExecutionReview {review_uid: $review_uid})
         RETURN keys(r) AS keys, properties(r) AS review`,
        { review_uid: plan.facts.review_uid },
      );
      if (existing.records.length > 1) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      if (existing.records.length === 1) {
        const existingReview = field(existing.records[0], "review");
        if (!isRecord(existingReview) || Object.entries(plan.facts).some(([key, expected]) => existingReview[key] !== expected && !(expected === null && existingReview[key] === undefined))) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      } else {
        markWrite();
        await transaction.run("CREATE (r:ExecutionReview) SET r = $properties, r.created_at = datetime()", { properties: this.executionReviewNodeProperties(plan) });
        await transaction.run(
          `MATCH (r:ExecutionReview {review_uid: $review_uid}), (u:ExecutionUnit {execution_uid: $execution_uid})
           CREATE (r)-[:REVIEWS {schema_id: $schema_id}]->(u)`,
          { review_uid: plan.facts.review_uid, execution_uid: plan.facts.execution_uid, schema_id: "anima.execution-review-target/v1.0" },
        );
        await transaction.run(
          `MATCH (r:ExecutionReview {review_uid: $review_uid}), (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
           CREATE (r)-[:CREATED_FROM {schema_id: $schema_id}]->(c)`,
          { review_uid: plan.facts.review_uid, candidate_uid: plan.facts.candidate_uid, schema_id: "anima.execution-review-candidate-source/v1.0" },
        );
        for (const evidence of plan.evidence_links) {
          await transaction.run(
            `MATCH (r:ExecutionReview {review_uid: $review_uid}), (event:RawEvent {event_uid: $event_uid})
             CREATE (r)-[:EVIDENCED_BY {
               schema_id: $schema_id, evidence_subject_kind: $evidence_subject_kind,
               evidence_subject_uid: $evidence_subject_uid, evidence_role: $evidence_role,
               position: $position
             }]->(event)`,
            { review_uid: plan.facts.review_uid, ...evidence, schema_id: "anima.execution-review-evidence/v1.0" },
          );
        }
      }
      if (plan.decision === "reviewed") {
        const update = await transaction.run(
          `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid, state: "leased", lease_token: $lease_token})
           SET c.state = "reviewed", c.reviewed_at = datetime()
           REMOVE c.lease_owner, c.lease_token, c.lease_until, c.leased_at,
                  c.skip_reason, c.rejection_reason
           RETURN count(c) AS count`,
          { candidate_uid: input.candidate_uid, lease_token },
        );
        if (numberValue(field(update.records[0], "count")) !== 1) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      } else {
        const update = await transaction.run(
          `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid, state: "leased", lease_token: $lease_token})
           SET c.state = "skipped", c.reviewed_at = datetime(), c.skip_reason = $skip_reason
           REMOVE c.lease_owner, c.lease_token, c.lease_until, c.leased_at,
                  c.rejection_reason
           RETURN count(c) AS count`,
          { candidate_uid: input.candidate_uid, lease_token, skip_reason: plan.skip_reason },
        );
        if (numberValue(field(update.records[0], "count")) !== 1) throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      return plan.decision === "reviewed"
        ? { status: "reviewed", review_uid: plan.facts.review_uid, candidate_uid: input.candidate_uid }
        : { status: "skipped", candidate_uid: input.candidate_uid, skip_reason: plan.skip_reason! };
    });
    if (outcome.kind === "domain") return outcome.result as ExecutionReviewOperationResult;
    if (outcome.kind === "database") return { status: "failed", code: "database_error", message: DATABASE_ERROR_MESSAGE };
    if (outcome.kind === "unknown") return { status: "indeterminate", candidate_uid: input.candidate_uid, message: UNKNOWN_WRITE_MESSAGE };
    if (outcome.kind === "closed" || this.isClosed()) return this.closedReviewExecutionCandidateResult(input.candidate_uid);
    return outcome.result as ExecutionReviewOperationResult;
  }




  private executionReviewNodeProperties(plan: ExecutionReviewPlan): NodeProperties {
    return { ...plan.facts };
  }
  private async applyExecutionReviewCandidatePlan(transaction: TxLike, markWrite: () => void, plan: ProjectExecutionReviewCandidatesPlan): Promise<void> {
    for (const candidatePlan of plan.candidate_plans) {
      if (candidatePlan.node_action !== "create") continue;
      const after = candidatePlan.after;
      markWrite();
      await transaction.run(
        `CREATE (c:ExecutionReviewCandidate)
         SET c = $properties, c.created_at = datetime()`,
        { properties: this.executionReviewCandidateNodeProperties(after) },
      );
      await transaction.run(
        `MATCH (u:ExecutionUnit {execution_uid: $execution_uid}), (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
         CREATE (u)-[:HAS_REVIEW_CANDIDATE {schema_id: $schema_id}]->(c)`,
        { execution_uid: after.execution_uid, candidate_uid: after.candidate_uid, schema_id: "anima.execution-review-candidate-link/v1.0" },
      );
      await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}), (u:ExecutionUnit {execution_uid: $execution_uid})
         CREATE (c)-[:REVIEWS {schema_id: $schema_id}]->(u)`,
        { execution_uid: after.execution_uid, candidate_uid: after.candidate_uid, schema_id: "anima.execution-review-target/v1.0" },
      );
      for (const evidence of candidatePlan.evidence_links) {
        await transaction.run(
          `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid}), (event:RawEvent {event_uid: $event_uid})
           CREATE (c)-[:EVIDENCED_BY {schema_id: $schema_id, position: $position, role: $role}]->(event)`,
          { ...evidence, schema_id: "anima.execution-review-evidence/v1.0" },
        );
      }
    }
  }

  private executionReviewCandidateNodeProperties(snapshot: ExecutionReviewCandidateSnapshot): NodeProperties {
    return {
      candidate_uid: snapshot.candidate_uid,
      execution_uid: snapshot.execution_uid,
      project_uid: snapshot.project_uid,
      session_uid: snapshot.session_uid,
      review_contract_version: snapshot.review_contract_version,
      execution_state: snapshot.execution_state,
      terminal_reason: snapshot.terminal_reason,
      source_fingerprint: snapshot.source_fingerprint,
      tool_call_count: snapshot.tool_call_count,
      tool_result_count: snapshot.tool_result_count,
      tool_error_count: snapshot.tool_error_count,
      state: snapshot.state,
    };
  }

  private async applyExecutionPlan(transaction: TxLike, markWrite: () => void, plans: readonly ExecutionUnitPlan[]): Promise<void> {
    for (const plan of plans) {
      if (plan.node_action === "verify") continue;
      if (plan.node_action === "create") {
        markWrite();
        await transaction.run("CREATE (u:ExecutionUnit) SET u = $properties", { properties: this.executionNodeProperties(plan.after) });
        await transaction.run(
          `MATCH (s:Session {session_uid: $session_uid}), (u:ExecutionUnit {execution_uid: $execution_uid})
           CREATE (s)-[:HAS_EXECUTION {schema_id: $schema_id}]->(u)`,
          { session_uid: plan.owner_link.session_uid, execution_uid: plan.owner_link.execution_uid, schema_id: "anima.session-execution-link/v1.0" },
        );
        await transaction.run(
          `MATCH (u:ExecutionUnit {execution_uid: $execution_uid}), (e:RawEvent {event_uid: $event_uid})
           CREATE (u)-[:INITIATED_BY {schema_id: $schema_id}]->(e)`,
          { ...plan.initiator_link, schema_id: "anima.execution-initiator/v1.0" },
        );
      } else {
        markWrite();
        await transaction.run("MATCH (u:ExecutionUnit {execution_uid: $execution_uid}) SET u = $properties", { execution_uid: plan.after.execution_uid, properties: this.executionNodeProperties(plan.after) });
      }
      for (const link of plan.contains_links) {
        await transaction.run(
          `MATCH (u:ExecutionUnit {execution_uid: $execution_uid}), (e:RawEvent {event_uid: $event_uid})
           CREATE (u)-[:CONTAINS {schema_id: $schema_id, position: $position, role: $role}]->(e)`,
          { ...link, schema_id: "anima.execution-event/v1.0" },
        );
      }
      if (plan.finalizer_link !== null) {
        await transaction.run(
          `MATCH (u:ExecutionUnit {execution_uid: $execution_uid}), (e:RawEvent {event_uid: $event_uid})
           CREATE (u)-[:FINALIZED_BY {schema_id: $schema_id, terminal_reason: $terminal_reason}]->(e)`,
          { ...plan.finalizer_link, schema_id: "anima.execution-terminal/v1.0" },
        );
      }
    }
  }

  private executionNodeProperties(snapshot: ExecutionUnitSnapshot): Record<string, unknown> {
    const properties: Record<string, unknown> = {
      execution_uid: snapshot.execution_uid,
      schema_id: "anima.execution-unit/v1.0",
      projector_version: EXECUTION_PROJECTOR_VERSION,
      project_uid: snapshot.project_uid,
      session_uid: snapshot.session_uid,
      initiator_kind: snapshot.initiator_kind,
      initiator_event_uid: snapshot.initiator_event_uid,
      first_tool_call_event_uid: snapshot.first_tool_call_event_uid,
      start_ingest_sequence: snapshot.start_ingest_sequence,
      end_ingest_sequence: snapshot.end_ingest_sequence,
      event_count: snapshot.event_count,
      state: snapshot.state,
      source_fingerprint: snapshot.source_fingerprint,
    };
    if (snapshot.state !== "open") {
      properties.terminal_reason = snapshot.terminal_reason;
      properties.terminal_event_uid = snapshot.terminal_event_uid;
    }
    return properties;
  }
  private async applyPlan(transaction: TxLike, markWrite: () => void, plan: BoundaryProjectorPlan): Promise<void> {
    for (const create of plan.window_creates) {
      const existingResult = await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid}) RETURN w AS w`,
        { window_uid: create.window_uid },
      );
      const existing = recordNode(existingResult.records[0], "w");

      if (existing === undefined) {
        markWrite();
        await transaction.run(
          `CREATE (w:BoundaryWindow) SET w += $properties`,
          { properties: create },
        );
      } else {
        this.assertWindow(existing, create);
      }
    }
    if (plan.open_window_update !== undefined) {
      const update = plan.open_window_update;
      const existingResult = await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid}) RETURN w AS w`,
        { window_uid: update.window_uid },
      );
      const existing = recordNode(existingResult.records[0], "w");
      if (existing === undefined) throw this.domain("identity_conflict");
      this.assertWindowSnapshot(existing, update.before, update);
      if (JSON.stringify(update.before) !== JSON.stringify(update.after)) {
        markWrite();
        await transaction.run(
          `MATCH (w:BoundaryWindow {window_uid: $window_uid})
           SET w.end_ingest_sequence = $end_ingest_sequence,
               w.collection_state = $collection_state,
               w.terminal_event_uid = $terminal_event_uid,
               w.terminal_boundary_type = $terminal_boundary_type,
               w.decision_status = $decision_status`,
          {
            window_uid: update.window_uid,
            end_ingest_sequence: update.after.end_ingest_sequence,
            collection_state: update.after.collection_state,
            terminal_event_uid: update.after.terminal_event_uid ?? null,
            terminal_boundary_type: update.after.terminal_boundary_type ?? null,
            decision_status: update.after.decision_status ?? null,
          },
        );
      }
    }
    for (const assignment of plan.event_assignments) {
      const assignedResult = await transaction.run(
        `MATCH (e:RawEvent {event_uid: $event_uid})-[r:IN_BOUNDARY_WINDOW {projector_version: $projector_version}]->(w:BoundaryWindow)
         RETURN w AS w`,
        {
          event_uid: assignment.event_uid,
          projector_version: assignment.projector_version,
        },
      );
      if (assignedResult.records.length > 1) throw this.domain("identity_conflict");
      for (const record of assignedResult.records) {
        const assigned = recordNode(record, "w");
        if (assigned !== undefined && nodeUid(assigned, "window_uid") !== assignment.window_uid) {
          throw this.domain("identity_conflict");
        }
      }
      if (assignedResult.records.some((record) => recordNode(record, "w") !== undefined)) continue;
      markWrite();
      await transaction.run(
        `MATCH (e:RawEvent {event_uid: $event_uid}), (w:BoundaryWindow {window_uid: $window_uid})
         CREATE (e)-[:IN_BOUNDARY_WINDOW {projector_version: $projector_version}]->(w)`,
        {
          event_uid: assignment.event_uid,
          window_uid: assignment.window_uid,
          projector_version: assignment.projector_version,
        },
      );
    }
  }

  private assertWindow(value: NodeProperties, expected: Record<string, unknown>): void {
    for (const key of ["window_uid", "project_uid", "session_uid", "start_ingest_sequence", "projector_version", "collection_state", "end_ingest_sequence", "terminal_event_uid", "terminal_boundary_type", "decision_status"]) {
      if (expected[key] !== undefined && !propertyEquals(value[key], expected[key])) throw this.domain("identity_conflict");
    }
    if (expected.collection_state === "open" && (
      value.terminal_event_uid !== undefined ||
      value.terminal_boundary_type !== undefined ||
      value.decision_status !== undefined
    )) throw this.domain("identity_conflict");
  }

  private assertWindowSnapshot(value: NodeProperties, expected: BoundaryWindowSnapshot, update: { window_uid: string; project_uid: string; session_uid: string; projector_version: string }): void {
    if (
      !propertyEquals(value.window_uid, update.window_uid) ||
      !propertyEquals(value.project_uid, update.project_uid) ||
      !propertyEquals(value.session_uid, update.session_uid) ||
      !propertyEquals(value.projector_version, update.projector_version) ||
      !propertyEquals(value.start_ingest_sequence, expected.start_ingest_sequence) ||
      !propertyEquals(value.end_ingest_sequence, expected.end_ingest_sequence) ||
      !propertyEquals(value.collection_state, expected.collection_state)
    ) throw this.domain("identity_conflict");
    if (expected.collection_state === "open" && (
      value.terminal_event_uid !== undefined ||
      value.terminal_boundary_type !== undefined ||
      value.decision_status !== undefined
    )) throw this.domain("identity_conflict");
  }

  private validateMaterializeInput(input: unknown): ValidMaterializeInput | InvalidMaterializeInput {
    const invalid = (): InvalidMaterializeInput => ({
      kind: "invalid",
      result: { status: "failed", code: "invalid_input", message: INVALID_MESSAGE },
    });
    if (!isRecord(input) || !exactKeys(input, ["project_uid", "episode_kind", "window_uids", "closure"])) return invalid();
    if (!canonicalUuid(input.project_uid) || (input.episode_kind !== "work" && input.episode_kind !== "personal")) return invalid();
    if (!Array.isArray(input.window_uids) || input.window_uids.length === 0) return invalid();
    const window_uids: string[] = [];
    for (const uid of input.window_uids) {
      if (!canonicalUuid(uid)) return invalid();
      window_uids.push(uid);
    }
    if (new Set(window_uids).size !== window_uids.length) return invalid();
    if (!isRecord(input.closure) || typeof input.closure.kind !== "string") return invalid();
    const closure = input.closure;
    let copiedClosure: MaterializeEpisodeClosureInput;
    if (closure.kind === "none") {
      if (!exactKeys(closure, ["kind"])) return invalid();
      copiedClosure = { kind: "none" };
    } else if (closure.kind === "work_validated") {
      if (input.episode_kind !== "work" || !exactKeys(closure, ["kind", "checkpoint_event_uid", "validation_result_event_uid", "validation_event_uid"])) return invalid();
      if (!canonicalUuid(closure.checkpoint_event_uid) || !canonicalUuid(closure.validation_result_event_uid) || !canonicalUuid(closure.validation_event_uid)) return invalid();
      copiedClosure = {
        kind: "work_validated",
        checkpoint_event_uid: closure.checkpoint_event_uid,
        validation_result_event_uid: closure.validation_result_event_uid,
        validation_event_uid: closure.validation_event_uid,
      };
    } else if (closure.kind === "personal_explicit") {
      if (input.episode_kind !== "personal" || !exactKeys(closure, ["kind", "checkpoint_event_uid"])) return invalid();
      if (!canonicalUuid(closure.checkpoint_event_uid)) return invalid();
      copiedClosure = { kind: "personal_explicit", checkpoint_event_uid: closure.checkpoint_event_uid };
    } else return invalid();
    return {
      kind: "valid",
      input: {
        project_uid: input.project_uid,
        episode_kind: input.episode_kind,
        window_uids: window_uids as [string, ...string[]],
        closure: copiedClosure,
      },
    };
  }

  private projectEpisodeOrDomain(input: MaterializeEpisodeInput, pass: EpisodePass): ProjectEpisodePlan {
    let plan: ProjectEpisodePlan;
    try {
      plan = projectEpisode({
        project_uid: input.project_uid,
        episode_kind: input.episode_kind,
        windows: pass.windows,
        continuations: pass.continuations,
        closure: pass.closure,
        ...(pass.episode === undefined ? {} : { existing_episode: pass.episode }),
      });
    } catch (error: unknown) {
      if (error instanceof EpisodeProjectorError) {
        if (pass.deferred_identity_conflict && error.code === "invalid_transition") throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        const message =
          error.code === "source_incomplete"
            ? EPISODE_SOURCE_INCOMPLETE_MESSAGE
            : error.code === "evidence_invalid"
              ? EPISODE_EVIDENCE_INVALID_MESSAGE
              : error.code === "identity_conflict"
                ? EPISODE_IDENTITY_CONFLICT_MESSAGE
                : error.code === "invalid_transition"
                  ? INVALID_TRANSITION_MESSAGE
                  : INVALID_MESSAGE;
        throw this.domain(error.code, message);
      }
      throw error;
    }
    if (pass.deferred_identity_conflict || (pass.observation.present && "invalid" in pass.observation)) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    return plan;
  }

  private async readEpisodeNode(transaction: TxLike, episode_uid: string): Promise<NodeProperties | undefined> {
    const result = await transaction.run(
      `MATCH (e:Episode {episode_uid: $episode_uid})
       RETURN properties(e) AS properties`,
      { episode_uid },
    );
    const value = field(result.records[0], "properties");
    return isRecord(value) ? value : undefined;
  }

  private closedMaterializeResult(): MaterializeEpisodeResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }
  private async assertEpisodeRequestedEntities(transaction: TxLike, input: MaterializeEpisodeInput): Promise<void> {
    const project = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})
       RETURN count(p) AS count`,
      { project_uid: input.project_uid },
    );
    if (numberValue(field(project.records[0], "count")) !== 1) throw this.domain("not_found", EPISODE_NOT_FOUND_MESSAGE);
    for (const window_uid of input.window_uids) {
      const window = await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid})
         RETURN count(w) AS count`,
        { window_uid },
      );
      if (numberValue(field(window.records[0], "count")) !== 1) throw this.domain("not_found", EPISODE_NOT_FOUND_MESSAGE);
    }
    const event_uids =
      input.closure.kind === "none"
        ? []
        : input.closure.kind === "personal_explicit"
          ? [input.closure.checkpoint_event_uid]
          : [input.closure.checkpoint_event_uid, input.closure.validation_result_event_uid, input.closure.validation_event_uid];
    for (const event_uid of event_uids) {
      const event = await transaction.run(
        `MATCH (e:RawEvent {event_uid: $event_uid})
         RETURN count(e) AS count`,
        { event_uid },
      );
      if (numberValue(field(event.records[0], "count")) !== 1) throw this.domain("not_found", EPISODE_NOT_FOUND_MESSAGE);
    }
  }

  private async loadEpisodePass(transaction: TxLike, input: MaterializeEpisodeInput, episode_uid: string): Promise<EpisodePass> {
    await this.assertEpisodeRequestedEntities(transaction, input);
    const source = await this.loadEpisodeSource(transaction, input);
    const episodeNode = await this.readEpisodeNode(transaction, episode_uid);
    const observation = this.observationFromNode(episodeNode);
    let episode: EpisodeSnapshot | undefined;
    let reconstructionIdentityConflict = false;
    if (episodeNode !== undefined && !(observation.present && "invalid" in observation)) {
      try {
        episode = await this.reconstructEpisode(transaction, episodeNode, source.windows, input);
      } catch (error: unknown) {
        if (error instanceof StoreDomainError && error.code === "identity_conflict") reconstructionIdentityConflict = true;
        else throw error;
      }
    }
    return { ...source, observation, ...(episode === undefined ? {} : { episode }), ...(reconstructionIdentityConflict ? { deferred_identity_conflict: true } : {}) };
  }

  private observationFromNode(node: NodeProperties | undefined): EpisodeObservation {
    if (node === undefined) return { present: false };
    const revision = numberValue(node.revision);
    const last_decision_uid = node.last_decision_uid;
    if (revision === undefined || revision < 0 || !canonicalUuid(last_decision_uid)) return { present: true, invalid: true };
    return { present: true, revision, last_decision_uid };
  }

  private async loadEpisodeSource(transaction: TxLike, input: MaterializeEpisodeInput): Promise<Omit<EpisodePass, "observation" | "episode">> {
    const projectResult = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})
       RETURN labels(p) AS labels, {project_uid: p.project_uid} AS properties`,
      { project_uid: input.project_uid },
    );
    const project = field(projectResult.records[0], "properties");
    const source_snapshot: EpisodeSourceSnapshot = {
      project: { labels: field(projectResult.records[0], "labels"), properties: project },
      sessions: [],
      windows: [],
      events: [],
      continuations: [],
    };
    if (!isRecord(project)) throw this.domain("not_found", EPISODE_NOT_FOUND_MESSAGE);
    if (project.project_uid !== input.project_uid) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const rawWindows: NodeProperties[] = [];
    for (const window_uid of input.window_uids) {
      const result = await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid})
         RETURN labels(w) AS labels, properties(w) AS properties`,
        { window_uid },
      );
      const value = field(result.records[0], "properties");
      if (!isRecord(value)) throw this.domain("not_found", EPISODE_NOT_FOUND_MESSAGE);
      rawWindows.push(value);
      source_snapshot.windows.push({ labels: field(result.records[0], "labels"), properties: value });
    }
    const windows: EpisodeWindowFact[] = [];
    const eventByUid = new Map<string, NodeProperties>();
    let sourceIncomplete = false;
    let identityConflict = false;
    for (let index = 0; index < rawWindows.length; index += 1) {
      const raw = rawWindows[index]!;
      const window_uid = input.window_uids[index]!;
      if (!exactKeys(raw, ["window_uid", "project_uid", "session_uid", "start_ingest_sequence", "end_ingest_sequence", "projector_version", "collection_state", "terminal_event_uid", "terminal_boundary_type", "decision_status"])) identityConflict = true;
      const project_uid = raw.project_uid;
      const session_uid = raw.session_uid;
      const start = numberValue(raw.start_ingest_sequence);
      const end = numberValue(raw.end_ingest_sequence);
      const terminal_event_uid = raw.terminal_event_uid;
      const terminal_boundary_type = raw.terminal_boundary_type;
      if (!canonicalUuid(project_uid) || !canonicalUuid(session_uid) || !canonicalUuid(terminal_event_uid) || start === undefined || end === undefined || start < 0 || end < start || !isEpisodeBoundaryType(terminal_boundary_type)) {
        identityConflict = true;
        continue;
      }
      if (
        project_uid !== input.project_uid ||
        raw.window_uid !== window_uid ||
        raw.projector_version !== BOUNDARY_PROJECTOR_VERSION ||
        raw.collection_state !== "sealed" ||
        raw.decision_status !== "pending" ||
        (terminal_boundary_type !== "checkpoint" && terminal_boundary_type !== "compact" && terminal_boundary_type !== "shutdown" && terminal_boundary_type !== "validation" && terminal_boundary_type !== "unknown")
      ) identityConflict = true;
      try {
        if (boundaryWindowUid(input.project_uid, session_uid, start) !== window_uid) identityConflict = true;
      } catch {
        identityConflict = true;
      }
      const sessionIdentity = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})
         RETURN labels(s) AS labels, {project_uid: s.project_uid, session_uid: s.session_uid} AS session`,
        { session_uid },
      );
      const storedSession = field(sessionIdentity.records[0], "session");
      if (!isRecord(storedSession)) sourceIncomplete = true;
      source_snapshot.sessions.push({ labels: field(sessionIdentity.records[0], "labels"), properties: storedSession });
      if (isRecord(storedSession) && (storedSession.project_uid !== input.project_uid || storedSession.session_uid !== session_uid)) identityConflict = true;
      const sessionResult = await transaction.run(
        `MATCH (p:Project {project_uid: $project_uid})-[hs:HAS_SESSION]->(s:Session {session_uid: $session_uid})
         RETURN {project_uid: s.project_uid, session_uid: s.session_uid} AS session, properties(hs) AS relation, count(hs) AS relation_count`,
        { project_uid: input.project_uid, session_uid },
      );
      const sessionOwners = await transaction.run(
        `MATCH (owner:Project)-[r:HAS_SESSION]->(s:Session {session_uid: $session_uid})
         RETURN {project_uid: owner.project_uid} AS owner, properties(r) AS relation`,
        { session_uid },
      );
      if (sessionOwners.records.length === 0) sourceIncomplete = true;
      if (sessionOwners.records.length !== 1) identityConflict = true;
      for (const ownerRecord of sessionOwners.records) {
        const owner = field(ownerRecord, "owner");
        if (!isRecord(owner) || owner.project_uid !== input.project_uid || !isRecord(field(ownerRecord, "relation")) || !exactKeys(field(ownerRecord, "relation"), [])) identityConflict = true;
      }
      const reverseSessionEdges = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})-[r:HAS_SESSION]->(p:Project)
         RETURN {project_uid: p.project_uid} AS project, properties(r) AS relation`,
        { session_uid },
      );
      source_snapshot.sessions.push(
        ...sessionResult.records.map((record) => ({ topology: "HAS_SESSION", session: field(record, "session"), relation: field(record, "relation") })),
        ...sessionOwners.records.map((record) => ({ topology: "HAS_SESSION", owner: field(record, "owner"), relation: field(record, "relation") })),
        ...reverseSessionEdges.records.map((record) => ({ topology: "HAS_SESSION_REVERSE", project: field(record, "project"), relation: field(record, "relation") })),
      );
      if (reverseSessionEdges.records.length > 0) identityConflict = true;
      const session = field(sessionResult.records[0], "session");
      const relationCount = numberValue(field(sessionResult.records[0], "relation_count"));
      const relation = field(sessionResult.records[0], "relation");
      if (!isRecord(relation) || !exactKeys(relation, [])) identityConflict = true;
      if (!isRecord(session) || relationCount === undefined || relationCount === 0) sourceIncomplete = true;
      if (relationCount !== undefined && relationCount !== 1) identityConflict = true;
      if (isRecord(session) && (session.project_uid !== input.project_uid || session.session_uid !== session_uid)) identityConflict = true;
      const eventsResult = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})-[he:HAS_EVENT]->(e:RawEvent)
         WHERE e.ingest_sequence >= $start_ingest_sequence AND e.ingest_sequence <= $end_ingest_sequence
         RETURN {event_uid: e.event_uid, project_uid: e.project_uid, session_uid: e.session_uid, ingest_sequence: e.ingest_sequence, kind: e.kind, boundary_type: e.boundary_type, outcome: e.outcome} AS event,
                labels(e) AS labels, properties(he) AS has_event
         ORDER BY e.ingest_sequence, e.event_uid`,
        { session_uid, start_ingest_sequence: start, end_ingest_sequence: end },
      );
      const events: NodeProperties[] = [];
      const seenSequences = new Set<number>();
      for (const eventRecord of eventsResult.records) {
        const event = field(eventRecord, "event");
        if (!isRecord(event)) {
          sourceIncomplete = true;
          continue;
        }
        events.push(event);
        const sequence = numberValue(event.ingest_sequence);
        if (sequence === undefined) sourceIncomplete = true;
        else if (seenSequences.has(sequence)) identityConflict = true;
        else seenSequences.add(sequence);
        const projectEdges = await transaction.run(
          `MATCH (e:RawEvent {event_uid: $event_uid})-[r:IN_PROJECT]->(p:Project)
           RETURN {project_uid: p.project_uid} AS project, properties(r) AS relation`,
          { event_uid: event.event_uid },
        );
        const eventOwners = await transaction.run(
          `MATCH (owner:Session)-[r:HAS_EVENT]->(e:RawEvent {event_uid: $event_uid})
           RETURN {project_uid: owner.project_uid, session_uid: owner.session_uid} AS owner, properties(r) AS relation`,
          { event_uid: event.event_uid },
        );
        const reverseEventEdges = await transaction.run(
          `MATCH (e:RawEvent {event_uid: $event_uid})-[r:HAS_EVENT]->(s:Session)
           RETURN {project_uid: s.project_uid, session_uid: s.session_uid} AS session, properties(r) AS relation`,
          { event_uid: event.event_uid },
        );
        const reverseProjectEdges = await transaction.run(
          `MATCH (p:Project)-[r:IN_PROJECT]->(e:RawEvent {event_uid: $event_uid})
           RETURN {project_uid: p.project_uid} AS project, properties(r) AS relation`,
          { event_uid: event.event_uid },
        );
        source_snapshot.events.push(
          { topology: "EVENT", labels: field(eventRecord, "labels"), event, relation: field(eventRecord, "has_event") },
          ...eventOwners.records.map((record) => ({ topology: "HAS_EVENT", owner: field(record, "owner"), relation: field(record, "relation") })),
          ...projectEdges.records.map((record) => ({ topology: "IN_PROJECT", project: field(record, "project"), relation: field(record, "relation") })),
          ...reverseEventEdges.records.map((record) => ({ topology: "HAS_EVENT_REVERSE", session: field(record, "session"), relation: field(record, "relation") })),
          ...reverseProjectEdges.records.map((record) => ({ topology: "IN_PROJECT_REVERSE", project: field(record, "project"), relation: field(record, "relation") })),
        );
        if (reverseEventEdges.records.length > 0 || reverseProjectEdges.records.length > 0) identityConflict = true;
        if (eventOwners.records.length === 0) sourceIncomplete = true;
        if (eventOwners.records.length !== 1) identityConflict = true;
        for (const ownerRecord of eventOwners.records) {
          const owner = field(ownerRecord, "owner");
          const relation = field(ownerRecord, "relation");
          if (!isRecord(owner) || owner.session_uid !== session_uid || !isRecord(relation) || !exactKeys(relation, [])) identityConflict = true;
        }
        if (projectEdges.records.length === 0) sourceIncomplete = true;
        if (projectEdges.records.length !== 1) identityConflict = true;
        for (const projectEdge of projectEdges.records) {
          const owner = field(projectEdge, "project");
          const relation = field(projectEdge, "relation");
          if (!isRecord(owner) || owner.project_uid !== input.project_uid || !isRecord(relation) || !exactKeys(relation, [])) identityConflict = true;
        }
        const labels = field(eventRecord, "labels");
        const expectedLabel = event.kind === "boundary" ? "BoundarySignal" : event.kind === "tool_call" ? "ToolCall" : event.kind === "tool_result" ? "ToolResult" : event.kind === "message" ? "Message" : undefined;
        if (!canonicalUuid(event.event_uid) || !canonicalUuid(event.project_uid) || !canonicalUuid(event.session_uid) || event.project_uid !== input.project_uid || event.session_uid !== session_uid) identityConflict = true;
        if (!Array.isArray(labels) || !labels.includes("RawEvent") || (expectedLabel !== undefined && !labels.includes(expectedLabel))) sourceIncomplete = true;
        if (expectedLabel !== undefined && Array.isArray(labels) && labels.some((label) => typeof label === "string" && ["BoundarySignal", "ToolCall", "ToolResult", "Message"].includes(label) && label !== expectedLabel)) identityConflict = true;
        const hasEvent = field(eventRecord, "has_event");
        if (!isRecord(hasEvent) || !exactKeys(hasEvent, [])) sourceIncomplete = true;
        if (canonicalUuid(event.event_uid)) eventByUid.set(event.event_uid, event);
      }
      for (let sequence = start; sequence <= end; sequence += 1) {
        if (!seenSequences.has(sequence)) sourceIncomplete = true;
      }
      const incoming = await transaction.run(
        `MATCH (e:RawEvent)-[assignment:IN_BOUNDARY_WINDOW]->(w:BoundaryWindow {window_uid: $window_uid})
         RETURN {event_uid: e.event_uid, project_uid: e.project_uid, session_uid: e.session_uid, ingest_sequence: e.ingest_sequence, kind: e.kind, boundary_type: e.boundary_type, outcome: e.outcome} AS event, properties(assignment) AS assignment`,
        { window_uid },
      );
      const reverseBoundaryAssignments = await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid})-[r:IN_BOUNDARY_WINDOW]->(e:RawEvent)
         RETURN {event_uid: e.event_uid, project_uid: e.project_uid, session_uid: e.session_uid, ingest_sequence: e.ingest_sequence, kind: e.kind, boundary_type: e.boundary_type, outcome: e.outcome} AS event, properties(r) AS assignment`,
        { window_uid },
      );
      source_snapshot.events.push(
        ...incoming.records.map((record) => ({ topology: "IN_BOUNDARY_WINDOW_INCOMING", event: field(record, "event"), relation: field(record, "assignment") })),
        ...reverseBoundaryAssignments.records.map((record) => ({ topology: "IN_BOUNDARY_WINDOW_REVERSE", event: field(record, "event"), relation: field(record, "assignment") })),
      );
      if (reverseBoundaryAssignments.records.length > 0) identityConflict = true;
      const incomingByUid = new Map<string, number>();
      for (const record of incoming.records) {
        const event = field(record, "event");
        const assignment = field(record, "assignment");
        if (!isRecord(event) || !isRecord(assignment)) {
          identityConflict = true;
          continue;
        }
        const uid = event.event_uid;
        if (typeof uid === "string") incomingByUid.set(uid, (incomingByUid.get(uid) ?? 0) + 1);
        if (!exactKeys(assignment, ["projector_version"]) || assignment.projector_version !== BOUNDARY_PROJECTOR_VERSION) identityConflict = true;
        const sequence = numberValue(event.ingest_sequence);
        if (sequence === undefined || sequence < start || sequence > end) identityConflict = true;
      }
      if (incoming.records.length !== events.length) identityConflict = true;
      for (const event of events) {
        const uid = event.event_uid;
        if (typeof uid !== "string" || !incomingByUid.has(uid)) sourceIncomplete = true;
        else if (incomingByUid.get(uid)! !== 1) identityConflict = true;
        const assignmentResult = await transaction.run(
          `MATCH (e:RawEvent {event_uid: $event_uid})-[assignment:IN_BOUNDARY_WINDOW]->(assigned:BoundaryWindow)
           RETURN properties(assigned) AS window, properties(assignment) AS assignment`,
          { event_uid: uid },
        );
        if (assignmentResult.records.length === 0) sourceIncomplete = true;
        if (assignmentResult.records.length !== 1) identityConflict = true;
        for (const record of assignmentResult.records) {
          const assigned = field(record, "window");
          const assignment = field(record, "assignment");
          if (!isRecord(assigned) || assigned.window_uid !== window_uid) identityConflict = true;
          if (!isRecord(assignment) || !exactKeys(assignment, ["projector_version"]) || assignment.projector_version !== BOUNDARY_PROJECTOR_VERSION) identityConflict = true;
          source_snapshot.events.push({ topology: "IN_BOUNDARY_WINDOW", event: uid, window: assigned, relation: assignment });
        }
      }
      const terminal = events.find((event) => numberValue(event.ingest_sequence) === end);
      if (!isRecord(terminal)) sourceIncomplete = true;
      else if (terminal.event_uid !== terminal_event_uid || terminal.kind !== "boundary" || terminal.boundary_type !== terminal_boundary_type) identityConflict = true;
      const incident = await this.readWindowEpisodeAssignments(transaction, window_uid);
      if (incident.conflict) identityConflict = true;
      windows.push({
        window_uid,
        project_uid: input.project_uid,
        session_uid,
        start_ingest_sequence: start,
        end_ingest_sequence: end,
        collection_state: "sealed",
        terminal_event_uid,
        terminal_boundary_type,
        decision_status: "pending",
        projector_version: BOUNDARY_PROJECTOR_VERSION,
        assigned_episode_uid: incident.episode_uid,
      });
    }
    if (sourceIncomplete) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    if (identityConflict && windows.length !== rawWindows.length) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const continuationLoad = await this.loadEpisodeContinuations(transaction, input.project_uid, windows);
    const closureLoad = await this.loadEpisodeClosure(transaction, input, windows, eventByUid);
    source_snapshot.continuations = continuationLoad.source_snapshot;
    return {
      source_snapshot,
      windows: windows as [EpisodeWindowFact, ...EpisodeWindowFact[]],
      continuations: continuationLoad.facts,
      closure: closureLoad.closure,
      ...(identityConflict || continuationLoad.identityConflict || closureLoad.identityConflict ? { deferred_identity_conflict: true } : {}),
    };
  }
  private async readWindowEpisodeAssignments(transaction: TxLike, window_uid: string): Promise<{ episode_uid: string | null; conflict: boolean }> {
    const outgoing = await transaction.run(
      `MATCH (w:BoundaryWindow {window_uid: $window_uid})-[r:IN_EPISODE]->(e)
       RETURN labels(e) AS labels, {episode_uid: e.episode_uid, project_uid: e.project_uid, episode_kind: e.episode_kind, revision: e.revision, state: e.state} AS episode, properties(r) AS relation`,
      { window_uid },
    );
    const incoming = await transaction.run(
      `MATCH (e)-[r:IN_EPISODE]->(w:BoundaryWindow {window_uid: $window_uid})
       RETURN labels(e) AS labels, {episode_uid: e.episode_uid, project_uid: e.project_uid, episode_kind: e.episode_kind, revision: e.revision, state: e.state} AS episode, properties(r) AS relation`,
      { window_uid },
    );
    let conflict = incoming.records.length > 0 || outgoing.records.length > 1;
    let episode_uid: string | null = null;
    for (const record of outgoing.records) {
      const labels = field(record, "labels");
      const episode = field(record, "episode");
      const relation = field(record, "relation");
      if (!Array.isArray(labels) || !labels.includes("Episode") || !isRecord(episode) || !isRecord(relation) || !canonicalUuid(episode.episode_uid)) {
        conflict = true;
        continue;
      }
      episode_uid = episode.episode_uid;
      if (!exactKeys(relation, ["schema_id", "position", "decision_uid", "decision_revision"])) conflict = true;
      if (relation.schema_id !== "anima.episode-window/v1.0" || !canonicalUuid(relation.decision_uid) || numberValue(relation.position) === undefined || numberValue(relation.decision_revision) === undefined) conflict = true;
    }
    for (const record of incoming.records) {
      const labels = field(record, "labels");
      if (!Array.isArray(labels) || !labels.includes("Episode")) conflict = true;
    }
    return { episode_uid, conflict };
  }

  private async loadEpisodeContinuations(transaction: TxLike, project_uid: string, windows: readonly EpisodeWindowFact[]): Promise<EpisodeContinuationLoad> {
    const session_uids = [...new Set(windows.map((window) => window.session_uid))];
    const expected: Array<{ previous_session_uid: string; current_session_uid: string }> = [];
    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1]!;
      const current = windows[index]!;
      if (previous.session_uid !== current.session_uid) {
        const pair = { previous_session_uid: previous.session_uid, current_session_uid: current.session_uid };
        if (!expected.some((item) => item.previous_session_uid === pair.previous_session_uid && item.current_session_uid === pair.current_session_uid)) expected.push(pair);
      }
    }
    const induced = await transaction.run(
      `MATCH (current:Session)-[r:CONTINUES_FROM]->(previous:Session)
       WHERE current.session_uid IN $session_uids AND previous.session_uid IN $session_uids
       RETURN labels(current) AS current_labels, {project_uid: current.project_uid, session_uid: current.session_uid} AS current,
              labels(previous) AS previous_labels, {project_uid: previous.project_uid, session_uid: previous.session_uid} AS previous, properties(r) AS relation`,
      { session_uids },
    );
    let identityConflict = false;
    const inducedPairs = new Set<string>();
    const source_snapshot: unknown[] = induced.records.map((record) => ({ topology: "INDUCED", current_labels: field(record, "current_labels"), current: field(record, "current"), previous_labels: field(record, "previous_labels"), previous: field(record, "previous"), relation: field(record, "relation") }));
    for (const record of induced.records) {
      const current = field(record, "current");
      const previous = field(record, "previous");
      const relation = field(record, "relation");
      if (!isRecord(current) || !isRecord(previous) || !isRecord(relation)) {
        identityConflict = true;
        continue;
      }
      const key = `${previous.session_uid}->${current.session_uid}`;
      if (inducedPairs.has(key)) identityConflict = true;
      inducedPairs.add(key);
      if (!expected.some((item) => `${item.previous_session_uid}->${item.current_session_uid}` === key)) identityConflict = true;
    }
    const facts: EpisodeContinuationFact[] = [];
    for (const pair of expected) {
      const outgoing = await transaction.run(
        `MATCH (current:Session {session_uid: $current_session_uid})-[r:CONTINUES_FROM]->(previous:Session)
         RETURN labels(previous) AS previous_labels, {project_uid: previous.project_uid, session_uid: previous.session_uid} AS previous, properties(r) AS relation`,
        pair,
      );
      source_snapshot.push(...outgoing.records.map((item) => ({ topology: "EXPECTED_OUTGOING", current_session_uid: pair.current_session_uid, previous_labels: field(item, "previous_labels"), previous: field(item, "previous"), relation: field(item, "relation") })));
      if (outgoing.records.length === 0) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
      if (outgoing.records.length !== 1) identityConflict = true;
      const record = outgoing.records[0];
      const previous = field(record, "previous");
      const relation = field(record, "relation");
      if (!isRecord(previous) || !isRecord(relation) || previous.session_uid !== pair.previous_session_uid) {
        identityConflict = true;
        continue;
      }
      const evidence_event_uid = relation.evidence_event_uid;
      const decision_uid = relation.decision_uid;
      if (
        !exactKeys(relation, ["decision_uid", "schema_id", "method", "evidence_event_uid", "project_uid"]) ||
        relation.schema_id !== "anima.session-continuation/v1.0" ||
        relation.method !== "explicit_checkpoint" ||
        relation.project_uid !== project_uid ||
        !canonicalUuid(evidence_event_uid) ||
        !canonicalUuid(decision_uid) ||
        decision_uid !== sessionContinuationDecisionUid(project_uid, pair.current_session_uid, pair.previous_session_uid, evidence_event_uid)
      ) identityConflict = true;
      if (!canonicalUuid(evidence_event_uid) || !canonicalUuid(decision_uid)) {
        identityConflict = true;
        continue;
      }
      const evidence = await this.loadContinuationEvidence(transaction, project_uid, pair.current_session_uid, evidence_event_uid);
      if (evidence.status === "missing") throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
      if (evidence.status === "conflict") identityConflict = true;
      source_snapshot.push(...evidence.snapshot);
      facts.push({
        project_uid,
        current_session_uid: pair.current_session_uid,
        previous_session_uid: pair.previous_session_uid,
        decision_uid: typeof decision_uid === "string" ? decision_uid : "",
        schema_id: "anima.session-continuation/v1.0",
        method: "explicit_checkpoint",
        evidence_event_uid: typeof evidence_event_uid === "string" ? evidence_event_uid : "",
      });
    }
    for (const session_uid of session_uids) {
      const outgoing = await transaction.run(
        `MATCH (current:Session {session_uid: $session_uid})-[r:CONTINUES_FROM]->(previous:Session)
         RETURN labels(previous) AS previous_labels, {project_uid: previous.project_uid, session_uid: previous.session_uid} AS previous, properties(r) AS relation`,
        { session_uid },
      );
      source_snapshot.push(...outgoing.records.map((item) => ({ topology: "OPTIONAL_PREDECESSOR", current_session_uid: session_uid, previous_labels: field(item, "previous_labels"), previous: field(item, "previous"), relation: field(item, "relation") })));
      const expectedCurrent = expected.filter((item) => item.current_session_uid === session_uid);
      if (expectedCurrent.length > 0 && outgoing.records.length !== 1) identityConflict = true;
      if (expectedCurrent.length === 0 && outgoing.records.length > 1) identityConflict = true;
      if (expectedCurrent.length === 0 && outgoing.records.length === 1) {
        const relation = field(outgoing.records[0], "relation");
        const previous = field(outgoing.records[0], "previous");
        const previousUid = isRecord(previous) ? previous.session_uid : undefined;
        if (
          !isRecord(relation) ||
          !isRecord(previous) ||
          typeof previousUid !== "string" ||
          session_uids.includes(previousUid) ||
          !exactKeys(relation, ["decision_uid", "schema_id", "method", "evidence_event_uid", "project_uid"]) ||
          relation.schema_id !== "anima.session-continuation/v1.0" ||
          relation.method !== "explicit_checkpoint" ||
          relation.project_uid !== project_uid ||
          !canonicalUuid(relation.decision_uid) ||
          !canonicalUuid(relation.evidence_event_uid) ||
          relation.decision_uid !== sessionContinuationDecisionUid(project_uid, session_uid, previousUid, relation.evidence_event_uid)
        ) identityConflict = true;
        if (isRecord(relation) && canonicalUuid(relation.evidence_event_uid)) {
          const evidence = await this.loadContinuationEvidence(transaction, project_uid, session_uid, relation.evidence_event_uid);
          if (evidence.status === "missing") throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
          if (evidence.status === "conflict") identityConflict = true;
          source_snapshot.push(...evidence.snapshot);
        }
      }
    }
    return { facts, identityConflict, source_snapshot };
  }

  private async loadContinuationEvidence(transaction: TxLike, project_uid: string, session_uid: string, event_uid: string): Promise<{ status: "ok" | "missing" | "conflict"; snapshot: unknown[] }> {
    const result = await transaction.run(
      `MATCH (s:Session {session_uid: $session_uid})
       OPTIONAL MATCH (s)-[has_event:HAS_EVENT]->(e:RawEvent {event_uid: $event_uid})
       OPTIONAL MATCH (e)-[in_project:IN_PROJECT]->(p:Project {project_uid: $project_uid})
       OPTIONAL MATCH (e)-[assignment:IN_BOUNDARY_WINDOW]->(w:BoundaryWindow)
       RETURN labels(s) AS session_labels, {project_uid: s.project_uid, session_uid: s.session_uid} AS session,
              labels(e) AS event_labels, labels(w) AS window_labels,
              {event_uid: e.event_uid, project_uid: e.project_uid, session_uid: e.session_uid, ingest_sequence: e.ingest_sequence, kind: e.kind, boundary_type: e.boundary_type, outcome: e.outcome} AS event, {window_uid: w.window_uid, project_uid: w.project_uid, session_uid: w.session_uid, start_ingest_sequence: w.start_ingest_sequence, end_ingest_sequence: w.end_ingest_sequence, projector_version: w.projector_version, collection_state: w.collection_state, terminal_event_uid: w.terminal_event_uid, terminal_boundary_type: w.terminal_boundary_type, decision_status: w.decision_status} AS window,
              properties(has_event) AS has_event, properties(in_project) AS in_project,
              properties(assignment) AS assignment`,
      { project_uid, session_uid, event_uid },
    );
    if (result.records.length > 1) return { status: "conflict", snapshot: result.records.map((item) => ({ topology: "CONTINUATION_EVIDENCE", session: field(item, "session"), event: field(item, "event"), window: field(item, "window"), has_event: field(item, "has_event"), in_project: field(item, "in_project"), assignment: field(item, "assignment") })) };
    const record = result.records[0];
    const sessionLabels = field(record, "session_labels");
    const session = field(record, "session");
    const eventLabels = field(record, "event_labels");
    const windowLabels = field(record, "window_labels");
    const event = field(record, "event");
    const window = field(record, "window");
    if (!Array.isArray(sessionLabels) || !sessionLabels.includes("Session") || !isRecord(session) || session.project_uid !== project_uid || session.session_uid !== session_uid) return { status: "conflict", snapshot: [] };
    if (!isRecord(event) || !isRecord(window)) return { status: "missing", snapshot: [] };
    if (!Array.isArray(eventLabels) || !eventLabels.includes("RawEvent") || !Array.isArray(windowLabels) || !windowLabels.includes("BoundaryWindow")) return { status: "missing", snapshot: [] };
    if (!Array.isArray(eventLabels) || !eventLabels.includes("BoundarySignal")) return { status: "missing", snapshot: [] };
    const hasEvent = field(record, "has_event");
    const inProject = field(record, "in_project");
    if (!isRecord(hasEvent) || !exactKeys(hasEvent, []) || !isRecord(inProject) || !exactKeys(inProject, [])) return { status: "missing", snapshot: [] };
    const assignment = field(record, "assignment");
    if (!isRecord(assignment)) return { status: "missing", snapshot: [] };
    if (!exactKeys(assignment, ["projector_version"]) || assignment.projector_version !== BOUNDARY_PROJECTOR_VERSION) return { status: "conflict", snapshot: [] };
    const start = numberValue(window.start_ingest_sequence);
    const end = numberValue(window.end_ingest_sequence);
    const snapshot = [{ topology: "CONTINUATION_EVIDENCE", session, event, window, has_event: hasEvent, in_project: inProject, assignment }];
    if (!exactKeys(window, ["window_uid", "project_uid", "session_uid", "start_ingest_sequence", "end_ingest_sequence", "projector_version", "collection_state", "terminal_event_uid", "terminal_boundary_type", "decision_status"]) || window.collection_state !== "sealed") return { status: "conflict", snapshot };
    if (
      !canonicalUuid(event.event_uid) || !canonicalUuid(event.project_uid) || !canonicalUuid(event.session_uid) ||
      event.project_uid !== project_uid || event.session_uid !== session_uid || event.kind !== "boundary" || event.boundary_type !== "checkpoint" ||
      !canonicalUuid(window.window_uid) || !canonicalUuid(window.project_uid) || !canonicalUuid(window.session_uid) ||
      start === undefined || end === undefined || start < 0 || end < start ||
      window.project_uid !== project_uid || window.session_uid !== session_uid || window.terminal_event_uid !== event_uid ||
      window.terminal_boundary_type !== "checkpoint" ||
      window.decision_status !== "pending" || window.projector_version !== BOUNDARY_PROJECTOR_VERSION ||
      numberValue(event.ingest_sequence) !== end
    ) return { status: "conflict", snapshot };
    try {
      if (boundaryWindowUid(project_uid, session_uid, start) !== window.window_uid) return { status: "conflict", snapshot };
    } catch {
      return { status: "conflict", snapshot };
    }
    return { status: "ok", snapshot };
  }
  private async loadEpisodeClosure(
    transaction: TxLike,
    input: MaterializeEpisodeInput,
    windows: readonly EpisodeWindowFact[],
    eventByUid: Map<string, NodeProperties>,
  ): Promise<EpisodeClosureLoad> {
    const requested: string[] =
      input.closure.kind === "none"
        ? []
        : input.closure.kind === "personal_explicit"
          ? [input.closure.checkpoint_event_uid]
          : [input.closure.checkpoint_event_uid, input.closure.validation_result_event_uid, input.closure.validation_event_uid];
    const requestedNodes = new Map<string, NodeProperties>();
    for (const event_uid of requested) {
      const result = await transaction.run(
        `MATCH (e:RawEvent {event_uid: $event_uid})
         RETURN {event_uid: e.event_uid, project_uid: e.project_uid, session_uid: e.session_uid, ingest_sequence: e.ingest_sequence, kind: e.kind, boundary_type: e.boundary_type, outcome: e.outcome} AS properties`,
        { event_uid },
      );
      const properties = field(result.records[0], "properties");
      if (!isRecord(properties)) throw this.domain("not_found", EPISODE_NOT_FOUND_MESSAGE);
      requestedNodes.set(event_uid, properties);
    }
    if (input.closure.kind === "none") return { closure: { kind: "none" }, identityConflict: false };
    const selectedByEvent = new Map<string, { window: EpisodeWindowFact; sequence: number }>();
    for (const window of windows) {
      for (let sequence = window.start_ingest_sequence; sequence <= window.end_ingest_sequence; sequence += 1) {
        const event = [...eventByUid.values()].find((candidate) => candidate.session_uid === window.session_uid && numberValue(candidate.ingest_sequence) === sequence);
        if (event !== undefined && canonicalUuid(event.event_uid)) selectedByEvent.set(event.event_uid, { window, sequence });
      }
    }
    for (const event_uid of requested) if (!selectedByEvent.has(event_uid)) throw this.domain("evidence_invalid", EPISODE_EVIDENCE_INVALID_MESSAGE);
    const boundaryFact = (event_uid: string): EpisodeBoundaryEvidenceFact => {
      const event = requestedNodes.get(event_uid)!;
      const membership = selectedByEvent.get(event_uid)!;
      const boundary_type = event.boundary_type;
      if (
        event.kind !== "boundary" ||
        (boundary_type !== "checkpoint" && boundary_type !== "validation") ||
        !canonicalUuid(event.event_uid) ||
        !canonicalUuid(event.project_uid) ||
        !canonicalUuid(event.session_uid) ||
        event.project_uid !== input.project_uid ||
        event.session_uid !== membership.window.session_uid
      ) throw this.domain("evidence_invalid", EPISODE_EVIDENCE_INVALID_MESSAGE);
      return {
        event_uid: event.event_uid,
        project_uid: input.project_uid,
        session_uid: membership.window.session_uid,
        window_uid: membership.window.window_uid,
        ingest_sequence: membership.sequence,
        kind: "boundary",
        boundary_type: boundary_type as "checkpoint" | "validation",
      };
    };
    if (input.closure.kind === "personal_explicit") {
      return { closure: { kind: "personal_explicit", checkpoint: boundaryFact(input.closure.checkpoint_event_uid) }, identityConflict: false };
    }
    const checkpoint = boundaryFact(input.closure.checkpoint_event_uid);
    const validation = boundaryFact(input.closure.validation_event_uid);
    const resultNode = requestedNodes.get(input.closure.validation_result_event_uid)!;
    const resultMembership = selectedByEvent.get(input.closure.validation_result_event_uid)!;
    let closureIdentityConflict = false;
    const resultOf = await transaction.run(
      `MATCH (result:RawEvent {event_uid: $result_event_uid})-[r:RESULT_OF]->(call:RawEvent)
       RETURN {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call, properties(r) AS relation`,
      { result_event_uid: input.closure.validation_result_event_uid },
    );
    if (resultOf.records.length === 0) {
      const reverseResultOf = await transaction.run(
        `MATCH (call:RawEvent)-[r:RESULT_OF]->(result:RawEvent {event_uid: $result_event_uid})
         RETURN {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call, properties(r) AS relation`,
        { result_event_uid: input.closure.validation_result_event_uid },
      );
      if (reverseResultOf.records.length > 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    }
    const resultOfConflict = resultOf.records.length !== 1;
    const targetCall = field(resultOf.records[0], "call");
    const resultOfRelation = field(resultOf.records[0], "relation");
    if (!isRecord(targetCall) || !canonicalUuid(targetCall.event_uid)) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    if (!isRecord(resultOfRelation) || !exactKeys(resultOfRelation, [])) closureIdentityConflict = true;
    const tool_call_event_uid = targetCall.event_uid;
    const toolCallTopology = await transaction.run(
      `MATCH (call:RawEvent {event_uid: $event_uid})
       OPTIONAL MATCH (s:Session)-[has_event:HAS_EVENT]->(call)
       OPTIONAL MATCH (call)-[in_project:IN_PROJECT]->(p:Project)
       OPTIONAL MATCH (call)-[assignment:IN_BOUNDARY_WINDOW]->(w:BoundaryWindow)
       RETURN labels(call) AS labels,
              {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call,
              {session_uid: s.session_uid, project_uid: s.project_uid} AS session,
              {project_uid: p.project_uid} AS project, properties(w) AS window,
              properties(has_event) AS has_event, properties(in_project) AS in_project, properties(assignment) AS assignment`,
      { event_uid: tool_call_event_uid },
    );
    if (toolCallTopology.records.length === 0) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    const toolCallRecord = toolCallTopology.records[0]!;
    const toolCallLabels = field(toolCallRecord, "labels");
    const toolCallProperties = field(toolCallRecord, "call");
    const toolCallSession = field(toolCallRecord, "session");
    const toolCallProject = field(toolCallRecord, "project");
    const toolCallWindow = field(toolCallRecord, "window");
    const toolCallHasEvent = field(toolCallRecord, "has_event");
    const toolCallInProject = field(toolCallRecord, "in_project");
    const toolCallAssignment = field(toolCallRecord, "assignment");
    if (!Array.isArray(toolCallLabels) || !toolCallLabels.includes("RawEvent") || !toolCallLabels.includes("ToolCall") || !isRecord(toolCallProperties) || !isRecord(toolCallSession) || !isRecord(toolCallProject) || !isRecord(toolCallWindow) || !isRecord(toolCallHasEvent) || !isRecord(toolCallInProject) || !isRecord(toolCallAssignment)) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    if (!exactKeys(toolCallHasEvent, []) || !exactKeys(toolCallInProject, []) || !exactKeys(toolCallAssignment, ["projector_version"]) || toolCallAssignment.projector_version !== BOUNDARY_PROJECTOR_VERSION) closureIdentityConflict = true;
    if (toolCallTopology.records.length !== 1) closureIdentityConflict = true;
    if (toolCallProperties.project_uid !== input.project_uid || toolCallProperties.session_uid !== resultMembership.window.session_uid || toolCallSession.session_uid !== resultMembership.window.session_uid || toolCallSession.project_uid !== input.project_uid || toolCallProject.project_uid !== input.project_uid) closureIdentityConflict = true;
    const assignedToolCallWindowUid = toolCallWindow.window_uid;
    if (typeof assignedToolCallWindowUid !== "string") throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    if (!windows.some((window) => window.window_uid === assignedToolCallWindowUid)) throw this.domain("evidence_invalid", EPISODE_EVIDENCE_INVALID_MESSAGE);
    const callNode = eventByUid.get(tool_call_event_uid) ?? toolCallProperties;
    if (!isRecord(callNode)) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
    const callMembership = selectedByEvent.get(tool_call_event_uid);
    if (
      callNode.kind !== "tool_call" ||
      !canonicalUuid(callNode.event_uid) ||
      !canonicalUuid(callNode.project_uid) ||
      !canonicalUuid(callNode.session_uid) ||
      numberValue(callNode.ingest_sequence) === undefined
    ) throw this.domain("evidence_invalid", EPISODE_EVIDENCE_INVALID_MESSAGE);
    if (
      resultNode.kind !== "tool_result" ||
      resultNode.outcome !== "success" ||
      !canonicalUuid(resultNode.event_uid) ||
      !canonicalUuid(resultNode.project_uid) ||
      !canonicalUuid(resultNode.session_uid) ||
      resultNode.project_uid !== input.project_uid ||
      resultNode.session_uid !== resultMembership.window.session_uid
    ) throw this.domain("evidence_invalid", EPISODE_EVIDENCE_INVALID_MESSAGE);
    if (
      callMembership === undefined ||
      callMembership.window.session_uid !== resultMembership.window.session_uid ||
      callNode.project_uid !== input.project_uid ||
      callNode.session_uid !== resultMembership.window.session_uid ||
      numberValue(callNode.ingest_sequence) !== callMembership.sequence ||
      callMembership.sequence >= resultMembership.sequence
    ) throw this.domain("evidence_invalid", EPISODE_EVIDENCE_INVALID_MESSAGE);
    const reverseResultOf = await transaction.run(
      `MATCH (call:RawEvent)-[r:RESULT_OF]->(result:RawEvent {event_uid: $result_event_uid})
       RETURN {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call, properties(r) AS relation`,
      { result_event_uid: input.closure.validation_result_event_uid },
    );
    if (reverseResultOf.records.length > 0 || resultOfConflict) closureIdentityConflict = true;
    const validationResult: EpisodeSuccessfulResultEvidenceFact = {
      event_uid: resultNode.event_uid,
      project_uid: resultNode.project_uid,
      session_uid: resultNode.session_uid,
      window_uid: resultMembership.window.window_uid,
      ingest_sequence: resultMembership.sequence,
      kind: "tool_result",
      outcome: "success",
      tool_call_event_uid,
      tool_call_window_uid: callMembership.window.window_uid,
      tool_call_ingest_sequence: callMembership.sequence,
    };
    return { closure: { kind: "work_validated", checkpoint, validation_result: validationResult, validation }, identityConflict: closureIdentityConflict };
  }
  private async reconstructEpisode(
    transaction: TxLike,
    node: NodeProperties,
    windows: readonly EpisodeWindowFact[],
    input: MaterializeEpisodeInput,
  ): Promise<EpisodeSnapshot> {
    if (!canonicalUuid(node.episode_uid)) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const episode_uid = node.episode_uid;
    const expectedEpisodeUid = episodeUid(input.project_uid, input.window_uids[0]!);
    if (episode_uid !== expectedEpisodeUid) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const revision = numberValue(node.revision);
    const window_count = numberValue(node.window_count);
    if (revision === undefined || revision < 0 || window_count === undefined || window_count < 1) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const projectEdges = await transaction.run(
      `MATCH (p)-[r:HAS_EPISODE]->(e:Episode {episode_uid: $episode_uid})
       RETURN labels(p) AS labels, {project_uid: p.project_uid} AS project, properties(r) AS relation`,
      { episode_uid },
    );
    const reverseProjectEdges = await transaction.run(
      `MATCH (e:Episode {episode_uid: $episode_uid})-[r:HAS_EPISODE]->(p)
       RETURN labels(p) AS labels, properties(r) AS relation`,
      { episode_uid },
    );
    if (projectEdges.records.length !== 1 || reverseProjectEdges.records.length > 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const projectEdge = projectEdges.records[0];
    const projectLabels = field(projectEdge, "labels");
    const project = field(projectEdge, "project");
    const projectRelation = field(projectEdge, "relation");
    if (
      !Array.isArray(projectLabels) ||
      !projectLabels.includes("Project") ||
      !isRecord(project) ||
      project.project_uid !== input.project_uid ||
      !isRecord(projectRelation) ||
      !exactKeys(projectRelation, ["schema_id", "creation_decision_uid", "decision_revision"]) ||
      projectRelation.schema_id !== "anima.project-episode-link/v1.0" ||
      !canonicalUuid(projectRelation.creation_decision_uid) ||
      numberValue(projectRelation.decision_revision) !== 0
    ) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const assignmentResult = await transaction.run(
      `MATCH (w)-[r:IN_EPISODE]->(e:Episode {episode_uid: $episode_uid})
       RETURN labels(w) AS labels, properties(w) AS window, properties(r) AS relation`,
      { episode_uid },
    );
    const reverseAssignments = await transaction.run(
      `MATCH (e:Episode {episode_uid: $episode_uid})-[r:IN_EPISODE]->(w)
       RETURN labels(w) AS labels, properties(r) AS relation`,
      { episode_uid },
    );
    if (reverseAssignments.records.length > 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const assignments: Array<{ window_uid: string; position: number; decision_uid: string; decision_revision: number }> = [];
    for (const record of assignmentResult.records) {
      const labels = field(record, "labels");
      const window = field(record, "window");
      const relation = field(record, "relation");
      if (!Array.isArray(labels) || !labels.includes("BoundaryWindow") || !isRecord(window) || !isRecord(relation) || !canonicalUuid(window.window_uid) || !exactKeys(relation, ["schema_id", "position", "decision_uid", "decision_revision"]) || relation.schema_id !== "anima.episode-window/v1.0" || !canonicalUuid(relation.decision_uid)) {
        throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      }
      const position = numberValue(relation.position);
      const decision_revision = numberValue(relation.decision_revision);
      if (position === undefined || decision_revision === undefined || position < 0 || decision_revision < 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      assignments.push({ window_uid: window.window_uid, position, decision_uid: relation.decision_uid, decision_revision });
    }
    assignments.sort((left, right) => left.position - right.position);
    if (assignments.length !== window_count || assignments.some((item, index) => item.position !== index || item.window_uid !== windows[index]?.window_uid)) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const evidenceResult = await transaction.run(
      `MATCH (e:Episode {episode_uid: $episode_uid})-[r:EVIDENCED_BY]->(event)
       RETURN labels(event) AS labels,
              {event_uid: event.event_uid, project_uid: event.project_uid, session_uid: event.session_uid, ingest_sequence: event.ingest_sequence, kind: event.kind, boundary_type: event.boundary_type, outcome: event.outcome} AS event,
              properties(r) AS relation`,
      { episode_uid },
    );
    const reverseEvidence = await transaction.run(
      `MATCH (event)-[r:EVIDENCED_BY]->(e:Episode {episode_uid: $episode_uid})
       RETURN labels(event) AS labels, properties(r) AS relation`,
      { episode_uid },
    );
    if (reverseEvidence.records.length > 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const evidence: Array<{ event_uid: string; role: string; decision_uid: string; decision_revision: number }> = [];
    const historicalBoundaries = new Map<string, EpisodeBoundaryEvidenceFact>();
    const historicalResults = new Map<string, EpisodeSuccessfulResultEvidenceFact>();
    for (const record of evidenceResult.records) {
      const labels = field(record, "labels");
      const event = field(record, "event");
      const relation = field(record, "relation");
      const requiredEvidenceLabel = isRecord(relation) ? (relation.role === "validation_result" ? "ToolResult" : relation.role === "checkpoint" || relation.role === "validation" || relation.role === "suspension" ? "BoundarySignal" : undefined) : undefined;
      if (!Array.isArray(labels) || !labels.includes("RawEvent") || (requiredEvidenceLabel !== undefined && !labels.includes(requiredEvidenceLabel)) || !isRecord(event) || !isRecord(relation) || !canonicalUuid(event.event_uid) || !exactKeys(relation, ["schema_id", "role", "decision_uid", "decision_revision"]) || relation.schema_id !== "anima.episode-evidence/v1.0" || !canonicalUuid(relation.decision_uid) || typeof relation.role !== "string") {
        throw this.domain(requiredEvidenceLabel !== undefined && (!Array.isArray(labels) || !labels.includes(requiredEvidenceLabel)) ? "source_incomplete" : "identity_conflict", requiredEvidenceLabel !== undefined && (!Array.isArray(labels) || !labels.includes(requiredEvidenceLabel)) ? EPISODE_SOURCE_INCOMPLETE_MESSAGE : EPISODE_IDENTITY_CONFLICT_MESSAGE);
      }
      const decision_revision = numberValue(relation.decision_revision);
      if (decision_revision === undefined || decision_revision < 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      evidence.push({ event_uid: event.event_uid, role: relation.role, decision_uid: relation.decision_uid, decision_revision });
      const source = await transaction.run(
        `MATCH (s:Session)-[has_event:HAS_EVENT]->(source:RawEvent {event_uid: $event_uid})
         OPTIONAL MATCH (source)-[in_project:IN_PROJECT]->(p:Project)
         OPTIONAL MATCH (source)-[assignment:IN_BOUNDARY_WINDOW]->(w:BoundaryWindow)
         RETURN labels(source) AS source_labels, labels(s) AS session_labels, labels(p) AS project_labels, labels(w) AS window_labels,
                {event_uid: source.event_uid, project_uid: source.project_uid, session_uid: source.session_uid, ingest_sequence: source.ingest_sequence, kind: source.kind, boundary_type: source.boundary_type, outcome: source.outcome} AS source,
                {project_uid: s.project_uid, session_uid: s.session_uid} AS session,
                {window_uid: w.window_uid, project_uid: w.project_uid, session_uid: w.session_uid, start_ingest_sequence: w.start_ingest_sequence, end_ingest_sequence: w.end_ingest_sequence, projector_version: w.projector_version, collection_state: w.collection_state, terminal_event_uid: w.terminal_event_uid, terminal_boundary_type: w.terminal_boundary_type, decision_status: w.decision_status} AS window,
                {project_uid: p.project_uid} AS project,
                properties(has_event) AS has_event, properties(in_project) AS in_project,
                properties(assignment) AS assignment`,
        { event_uid: event.event_uid },
      );
      if (source.records.length === 0) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
      if (source.records.length !== 1) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const sourceRecord = source.records[0];
      const sourceLabels = field(sourceRecord, "source_labels");
      const sessionLabels = field(sourceRecord, "session_labels");
      const projectLabels = field(sourceRecord, "project_labels");
      const windowLabels = field(sourceRecord, "window_labels");
      const sourceEvent = field(sourceRecord, "source");
      const sourceWindow = field(sourceRecord, "window");
      if (!Array.isArray(sourceLabels) || !sourceLabels.includes("RawEvent") || !Array.isArray(sessionLabels) || !sessionLabels.includes("Session") || !Array.isArray(projectLabels) || !projectLabels.includes("Project") || !Array.isArray(windowLabels) || !windowLabels.includes("BoundaryWindow") || !isRecord(sourceEvent) || !isRecord(sourceWindow) || !isRecord(field(sourceRecord, "has_event")) || !isRecord(field(sourceRecord, "in_project")) || !isRecord(field(sourceRecord, "assignment"))) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
      const sourceHasEvent = field(sourceRecord, "has_event");
      const sourceInProject = field(sourceRecord, "in_project");
      const sourceAssignment = field(sourceRecord, "assignment");
      if ((isRecord(sourceHasEvent) && !exactKeys(sourceHasEvent, [])) || (isRecord(sourceInProject) && !exactKeys(sourceInProject, [])) || (isRecord(sourceAssignment) && !exactKeys(sourceAssignment, ["projector_version"]))) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const sourceProjectUid = sourceEvent.project_uid;
      const sourceSessionUid = sourceEvent.session_uid;
      const sourceSession = field(sourceRecord, "session");
      const sourceProject = field(sourceRecord, "project");
      if (!isRecord(sourceSession) || sourceSession.project_uid !== input.project_uid || sourceSession.session_uid !== sourceSessionUid || !isRecord(sourceProject) || sourceProject.project_uid !== input.project_uid) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const sourceWindowUid = sourceWindow.window_uid;
      if (!canonicalUuid(sourceProjectUid) || !canonicalUuid(sourceSessionUid) || !canonicalUuid(sourceWindowUid) || sourceProjectUid !== input.project_uid || sourceWindow.project_uid !== input.project_uid || !windows.some((window) => window.window_uid === sourceWindowUid && window.session_uid === sourceSessionUid)) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      if (
        (relation.role === "suspension" && (sourceEvent.kind !== "boundary" || sourceEvent.boundary_type !== "shutdown")) ||
        (relation.role === "checkpoint" && (sourceEvent.kind !== "boundary" || sourceEvent.boundary_type !== "checkpoint")) ||
        (relation.role === "validation" && (sourceEvent.kind !== "boundary" || sourceEvent.boundary_type !== "validation")) ||
        (relation.role === "validation_result" && (sourceEvent.kind !== "tool_result" || sourceEvent.outcome !== "success"))
      ) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      if (relation.role === "checkpoint" || relation.role === "validation") {
        const sourceSequence = numberValue(sourceEvent.ingest_sequence);
        if (sourceSequence === undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        historicalBoundaries.set(event.event_uid, {
          event_uid: event.event_uid,
          project_uid: input.project_uid,
          session_uid: sourceSessionUid,
          window_uid: sourceWindowUid,
          ingest_sequence: sourceSequence,
          kind: "boundary",
          boundary_type: relation.role === "checkpoint" ? "checkpoint" : "validation",
        });
      }
      if (relation.role === "validation_result") {
        const resultOf = await transaction.run(
          `MATCH (result:RawEvent {event_uid: $event_uid})-[r:RESULT_OF]->(call:RawEvent)
           RETURN labels(call) AS call_labels,
                  {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call,
                  properties(r) AS relation`,
          { event_uid: event.event_uid },
        );
        if (resultOf.records.length === 0) {
          const reverseResultOf = await transaction.run(
            `MATCH (call:RawEvent)-[r:RESULT_OF]->(result:RawEvent {event_uid: $event_uid})
             RETURN {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call, properties(r) AS relation`,
            { event_uid: event.event_uid },
          );
          if (reverseResultOf.records.length > 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
          throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
        }
        if (resultOf.records.length !== 1) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        const reverseResultOf = await transaction.run(
          `MATCH (call:RawEvent)-[r:RESULT_OF]->(result:RawEvent {event_uid: $event_uid})
           RETURN {event_uid: call.event_uid, project_uid: call.project_uid, session_uid: call.session_uid, ingest_sequence: call.ingest_sequence, kind: call.kind, boundary_type: call.boundary_type, outcome: call.outcome} AS call, properties(r) AS relation`,
          { event_uid: event.event_uid },
        );
        if (reverseResultOf.records.length > 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        const callLabels = field(resultOf.records[0], "call_labels");
        const call = field(resultOf.records[0], "call");
        const resultOfRelation = field(resultOf.records[0], "relation");
        if (!Array.isArray(callLabels) || !callLabels.includes("RawEvent") || !callLabels.includes("ToolCall") || !isRecord(call) || !isRecord(resultOfRelation) || !exactKeys(resultOfRelation, []) || !canonicalUuid(call.event_uid)) {
          throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        }
        const callTopology = await transaction.run(
          `MATCH (s:Session)-[has_event:HAS_EVENT]->(call:RawEvent {event_uid: $event_uid})
           OPTIONAL MATCH (call)-[in_project:IN_PROJECT]->(p:Project)
           OPTIONAL MATCH (call)-[assignment:IN_BOUNDARY_WINDOW]->(w:BoundaryWindow)
           RETURN labels(s) AS session_labels, labels(p) AS project_labels, labels(w) AS window_labels,
                  {project_uid: s.project_uid, session_uid: s.session_uid} AS session,
                  {project_uid: p.project_uid} AS project,
                  {window_uid: w.window_uid, project_uid: w.project_uid, session_uid: w.session_uid, start_ingest_sequence: w.start_ingest_sequence, end_ingest_sequence: w.end_ingest_sequence, projector_version: w.projector_version, collection_state: w.collection_state, terminal_event_uid: w.terminal_event_uid, terminal_boundary_type: w.terminal_boundary_type, decision_status: w.decision_status} AS window,
                  properties(has_event) AS has_event, properties(in_project) AS in_project,
                  properties(assignment) AS assignment`,
          { event_uid: call.event_uid },
        );
        if (callTopology.records.length === 0) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
        if (callTopology.records.length !== 1) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        const callRecord = callTopology.records[0];
        const sessionLabels = field(callRecord, "session_labels");
        const projectLabels = field(callRecord, "project_labels");
        const windowLabels = field(callRecord, "window_labels");
        if (!Array.isArray(sessionLabels) || !sessionLabels.includes("Session") || !Array.isArray(projectLabels) || !projectLabels.includes("Project") || !Array.isArray(windowLabels) || !windowLabels.includes("BoundaryWindow")) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
        const callSession = field(callRecord, "session");
        const callProject = field(callRecord, "project");
        const callWindow = field(callRecord, "window");
        const callHasEvent = field(callRecord, "has_event");
        const callInProject = field(callRecord, "in_project");
        const callAssignment = field(callRecord, "assignment");
        if (!isRecord(callSession) || !isRecord(callProject) || !isRecord(callWindow) || !isRecord(callHasEvent) || !isRecord(callInProject) || !isRecord(callAssignment)) throw this.domain("source_incomplete", EPISODE_SOURCE_INCOMPLETE_MESSAGE);
        if (!exactKeys(callHasEvent, []) || !exactKeys(callInProject, []) || !exactKeys(callAssignment, ["projector_version"]) || callAssignment.projector_version !== BOUNDARY_PROJECTOR_VERSION) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        const callSequence = numberValue(call.ingest_sequence);
        const callWindowUid = callWindow.window_uid;
        if (!canonicalUuid(callWindowUid) || callProject.project_uid !== input.project_uid || callSession.project_uid !== input.project_uid || callSession.session_uid !== sourceSessionUid || callWindow.project_uid !== input.project_uid || callWindow.session_uid !== sourceSessionUid || !windows.some((window) => window.window_uid === callWindowUid && window.session_uid === sourceSessionUid) || callSequence === undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        const resultSequence = numberValue(sourceEvent.ingest_sequence);
        if (resultSequence === undefined || callSequence >= resultSequence) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        historicalResults.set(event.event_uid, {
          event_uid: event.event_uid,
          project_uid: sourceProjectUid,
          session_uid: sourceSessionUid,
          window_uid: sourceWindowUid,
          ingest_sequence: resultSequence,
          kind: "tool_result",
          outcome: "success",
          tool_call_event_uid: call.event_uid,
          tool_call_window_uid: callWindowUid,
          tool_call_ingest_sequence: callSequence,
        });
      }
    }
    const candidateRevisions = new Set<number>([revision]);
    for (const assignment of assignments) candidateRevisions.add(assignment.decision_revision);
    for (const item of evidence) candidateRevisions.add(item.decision_revision);
    for (let index = 0; index <= revision; index += 1) if (!candidateRevisions.has(index)) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    if (candidateRevisions.size !== revision + 1) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const history: EpisodeSnapshot["decision_history"][number][] = [];
    const assignmentDecisionUids: string[] = [];
    const assignmentRevisions: number[] = [];
    for (const assignment of assignments) {
      assignmentDecisionUids.push(assignment.decision_uid);
      assignmentRevisions.push(assignment.decision_revision);
    }
    for (let currentRevision = 0; currentRevision <= revision; currentRevision += 1) {
      const assignmentAtRevision = assignments.filter((assignment) => assignment.decision_revision <= currentRevision);
      const count = assignmentAtRevision.length === 0 ? 0 : Math.max(...assignmentAtRevision.map((assignment) => assignment.position)) + 1;
      if (count === 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const revisionDecisionUids = [
        ...assignments.filter((assignment) => assignment.decision_revision === currentRevision).map((assignment) => assignment.decision_uid),
        ...evidence.filter((item) => item.decision_revision === currentRevision).map((item) => item.decision_uid),
      ];
      if (revisionDecisionUids.length === 0 || revisionDecisionUids.some((uid) => uid !== revisionDecisionUids[0])) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const roleItems = evidence.filter((item) => item.decision_revision === currentRevision);
      const roles = roleItems.map((item) => item.role);
      if (new Set(roles).size !== roles.length) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      let target: EpisodeClosureFacts;
      let state: "open" | "suspended" | "stable_ended";
      if (roles.length === 0) {
        state = "open";
        target = { kind: "none" };
      } else if (roles.length === 1 && roles[0] === "suspension") {
        state = "suspended";
        const suspension = roleItems[0]!;
        target = { kind: "none" };
        const terminal = windows[count - 1]!;
        if (terminal.terminal_boundary_type !== "shutdown" || terminal.terminal_event_uid !== suspension.event_uid) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      } else if (input.episode_kind === "personal" && roles.length === 1 && roles[0] === "checkpoint") {
        state = "stable_ended";
        const checkpoint = roleItems[0]!;
        const checkpointFact = historicalBoundaries.get(checkpoint.event_uid);
        if (checkpointFact === undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        target = { kind: "personal_explicit", checkpoint: checkpointFact };
      } else if (input.episode_kind === "work" && roles.length === 3 && roles.includes("checkpoint") && roles.includes("validation_result") && roles.includes("validation")) {
        state = "stable_ended";
        const checkpoint = roleItems.find((item) => item.role === "checkpoint")!;
        const result = roleItems.find((item) => item.role === "validation_result")!;
        const validation = roleItems.find((item) => item.role === "validation")!;
        const checkpointFact = historicalBoundaries.get(checkpoint.event_uid);
        const validationFact = historicalBoundaries.get(validation.event_uid);
        const resultFact = historicalResults.get(result.event_uid);
        if (checkpointFact === undefined || validationFact === undefined || resultFact === undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
        target = {
          kind: "work_validated",
          checkpoint: checkpointFact,
          validation_result: resultFact,
          validation: validationFact,
        };
      } else throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const targetState = state;
      const targetClosure = target.kind === "none" ? null : target.kind;
      const checkpoint = target.kind === "none" ? null : target.checkpoint.event_uid;
      const validationResult = target.kind === "work_validated" ? target.validation_result.event_uid : null;
      const validation = target.kind === "work_validated" ? target.validation.event_uid : null;
      const expectedDecision = episodeDecisionUid({
        episode_uid,
        episode_kind: input.episode_kind,
        target_revision: currentRevision,
        ordered_window_uids: windows.slice(0, count).map((window) => window.window_uid) as [string, ...string[]],
        target_state: targetState,
        closure_kind_or_null: targetClosure,
        checkpoint_event_uid_or_null: checkpoint,
        validation_result_event_uid_or_null: validationResult,
        validation_event_uid_or_null: validation,
      });
      if (revisionDecisionUids[0] !== expectedDecision) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      if (target.kind === "none" && state === "open") history.push({ revision: currentRevision, decision_uid: expectedDecision, window_count: count, state: "open" });
      else if (state === "suspended") history.push({ revision: currentRevision, decision_uid: expectedDecision, window_count: count, state: "suspended", suspension_event_uid: roleItems[0]!.event_uid });
      else if (target.kind === "personal_explicit") history.push({ revision: currentRevision, decision_uid: expectedDecision, window_count: count, state: "stable_ended", closure_kind: "personal_explicit", checkpoint_event_uid: target.checkpoint.event_uid });
      else if (target.kind === "work_validated") history.push({ revision: currentRevision, decision_uid: expectedDecision, window_count: count, state: "stable_ended", closure_kind: "work_validated", checkpoint_event_uid: target.checkpoint.event_uid, validation_result_event_uid: target.validation_result.event_uid, validation_event_uid: target.validation.event_uid });
      else throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    }
    if (!isRecord(projectRelation) || projectRelation.creation_decision_uid !== history[0]!.decision_uid) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const allowedNodeKeys = node.state === "open"
      ? ["episode_uid", "project_uid", "episode_kind", "first_window_uid", "creation_decision_uid", "schema_id", "projector_version", "last_window_uid", "window_count", "revision", "state", "last_decision_uid"]
      : node.state === "suspended"
        ? ["episode_uid", "project_uid", "episode_kind", "first_window_uid", "creation_decision_uid", "schema_id", "projector_version", "last_window_uid", "window_count", "revision", "state", "last_decision_uid", "suspension_event_uid"]
        : ["episode_uid", "project_uid", "episode_kind", "first_window_uid", "creation_decision_uid", "schema_id", "projector_version", "last_window_uid", "window_count", "revision", "state", "last_decision_uid", "closure_kind", "checkpoint_event_uid", ...(node.closure_kind === "work_validated" ? ["validation_result_event_uid", "validation_event_uid"] : [])];
    if (!exactKeys(node, allowedNodeKeys)) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const first_window_uid = assignments[0]!.window_uid;
    const last_window_uid = assignments[assignments.length - 1]!.window_uid;
    if (node.project_uid !== input.project_uid || node.episode_kind !== input.episode_kind || node.first_window_uid !== first_window_uid || node.last_window_uid !== last_window_uid || numberValue(node.window_count) !== window_count || numberValue(node.revision) !== revision || node.schema_id !== "anima.episode/v1.0" || node.projector_version !== "anima.episode-projector/v1" || node.creation_decision_uid !== history[0]!.decision_uid || node.last_decision_uid !== history[history.length - 1]!.decision_uid || node.state !== history[history.length - 1]!.state) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const final = history[history.length - 1]!;
    if (
      (final.state === "suspended" && node.suspension_event_uid !== final.suspension_event_uid) ||
      (final.state === "stable_ended" && final.closure_kind === "personal_explicit" && (node.closure_kind !== "personal_explicit" || node.checkpoint_event_uid !== final.checkpoint_event_uid)) ||
      (final.state === "stable_ended" && final.closure_kind === "work_validated" && (node.closure_kind !== "work_validated" || node.checkpoint_event_uid !== final.checkpoint_event_uid || node.validation_result_event_uid !== final.validation_result_event_uid || node.validation_event_uid !== final.validation_event_uid))
    ) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    const snapshot: EpisodeSnapshot = {
      episode_uid,
      project_uid: input.project_uid,
      episode_kind: input.episode_kind,
      first_window_uid,
      last_window_uid,
      window_count,
      revision,
      state: final.state,
      creation_decision_uid: history[0]!.decision_uid,
      last_decision_uid: history[history.length - 1]!.decision_uid,
      schema_id: "anima.episode/v1.0",
      projector_version: "anima.episode-projector/v1",
      assigned_window_uids: assignments.map((assignment) => assignment.window_uid),
      assigned_window_decision_uids: assignmentDecisionUids,
      assigned_window_decision_revisions: assignmentRevisions,
      decision_history: history as [EpisodeSnapshot["decision_history"][number], ...EpisodeSnapshot["decision_history"][number][]],
      ...(final.state === "suspended" ? { suspension_event_uid: final.suspension_event_uid } : {}),
      ...(final.state === "stable_ended" && final.closure_kind === "personal_explicit" ? { closure_kind: final.closure_kind, checkpoint_event_uid: final.checkpoint_event_uid } : {}),
      ...(final.state === "stable_ended" && final.closure_kind === "work_validated" ? { closure_kind: final.closure_kind, checkpoint_event_uid: final.checkpoint_event_uid, validation_result_event_uid: final.validation_result_event_uid, validation_event_uid: final.validation_event_uid } : {}),
    };
    return snapshot;
  }
  private async applyEpisodePlan(transaction: TxLike, markWrite: () => void, plan: ProjectEpisodePlan): Promise<void> {

    const after = plan.episode.after;
    const nodeProperties: NodeProperties = {
      episode_uid: after.episode_uid,
      first_window_uid: after.first_window_uid,
      project_uid: after.project_uid,
      episode_kind: after.episode_kind,
      creation_decision_uid: after.creation_decision_uid,
      schema_id: "anima.episode/v1.0",
      projector_version: "anima.episode-projector/v1",
      last_window_uid: after.last_window_uid,
      window_count: after.window_count,
      revision: after.revision,
      state: after.state,
      last_decision_uid: after.last_decision_uid,
      ...(after.state === "suspended" ? { suspension_event_uid: after.suspension_event_uid } : {}),
      ...(after.state === "stable_ended" ? {
        closure_kind: after.closure_kind,
        checkpoint_event_uid: after.checkpoint_event_uid,
        ...(after.closure_kind === "work_validated" ? { validation_result_event_uid: after.validation_result_event_uid, validation_event_uid: after.validation_event_uid } : {}),
      } : {}),
    };
    if (plan.episode.action === "create") {
      const existing = await this.readEpisodeNode(transaction, after.episode_uid);
      if (existing !== undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      const projectLink = await transaction.run(
        `MATCH (p:Project {project_uid: $project_uid})
         OPTIONAL MATCH (p)-[r:HAS_EPISODE]->(e:Episode {episode_uid: $episode_uid})
         RETURN count(r) AS count`,
        { project_uid: after.project_uid, episode_uid: after.episode_uid },
      );
      if (numberValue(field(projectLink.records[0], "count")) !== 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      markWrite();
      const merge = await transaction.run(
        `MERGE (e:Episode {episode_uid: $episode_uid})
         ON CREATE SET e += $properties
         RETURN e AS episode`,
        { episode_uid: after.episode_uid, properties: nodeProperties },
      );
      const created = merge.summary?.counters?.updates().nodesCreated;
      if (numberValue(created) !== 1) {
        if (numberValue(created) === 0) throw new ConcurrentEpisodeMatch();
        throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      }
      await transaction.run(
        `MATCH (p:Project {project_uid: $project_uid}), (e:Episode {episode_uid: $episode_uid})
         CREATE (p)-[:HAS_EPISODE {
           schema_id: "anima.project-episode-link/v1.0",
           creation_decision_uid: $creation_decision_uid,
           decision_revision: 0
         }]->(e)`,
        { project_uid: after.project_uid, episode_uid: after.episode_uid, creation_decision_uid: after.creation_decision_uid },
      );
    } else if (plan.episode.action === "update") {
      const existing = await this.readEpisodeNode(transaction, after.episode_uid);
      if (existing === undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      markWrite();
      await transaction.run(
        `MATCH (e:Episode {episode_uid: $episode_uid})
         REMOVE e.suspension_event_uid, e.closure_kind, e.checkpoint_event_uid,
                e.validation_result_event_uid, e.validation_event_uid
         SET e += $properties`,
        { episode_uid: after.episode_uid, properties: nodeProperties },
      );
    }
    for (const assignment of plan.new_window_assignments) {
      const existing = await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid})
         OPTIONAL MATCH (w)-[r:IN_EPISODE]->(e:Episode)
         RETURN count(r) AS count`,
        { window_uid: assignment.window_uid },
      );
      if (numberValue(field(existing.records[0], "count")) !== 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      await transaction.run(
        `MATCH (w:BoundaryWindow {window_uid: $window_uid}), (e:Episode {episode_uid: $episode_uid})
         CREATE (w)-[:IN_EPISODE {
           schema_id: "anima.episode-window/v1.0",
           position: $position,
           decision_uid: $decision_uid,
           decision_revision: $decision_revision
         }]->(e)`,
        { ...assignment },
      );
    }
    for (const evidence of plan.new_evidence_links) {
      const existing = await transaction.run(
        `MATCH (e:Episode {episode_uid: $episode_uid})
         OPTIONAL MATCH (e)-[r:EVIDENCED_BY]->(event:RawEvent {event_uid: $event_uid})
         RETURN count(r) AS count`,
        { episode_uid: evidence.episode_uid, event_uid: evidence.event_uid },
      );
      if (numberValue(field(existing.records[0], "count")) !== 0) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
      await transaction.run(
        `MATCH (e:Episode {episode_uid: $episode_uid}), (event:RawEvent {event_uid: $event_uid})
         CREATE (e)-[:EVIDENCED_BY {
           schema_id: "anima.episode-evidence/v1.0",
           role: $role,
           decision_uid: $decision_uid,
           decision_revision: $decision_revision
         }]->(event)`,
        { ...evidence },
      );
    }
  }

  private async verifyEpisodePlan(transaction: TxLike, plan: ProjectEpisodePlan, pass: EpisodePass): Promise<void> {
    if (plan.result.status !== "duplicate" || pass.episode === undefined) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
    if (pass.episode.last_decision_uid !== plan.decision_uid || pass.episode.revision !== plan.episode.after.revision) throw this.domain("identity_conflict", EPISODE_IDENTITY_CONFLICT_MESSAGE);
  }

  private validateAutomaticReflectionInput(input: unknown): RunDueAutomaticReflectionsResult | undefined {
    const fields = ["now", "max_input_bytes"];
    if (isRecord(input) && Object.hasOwn(input, "max_work_items_per_project")) fields.push("max_work_items_per_project");
    if (isRecord(input) && Object.hasOwn(input, "max_concurrent_projects")) fields.push("max_concurrent_projects");
    if (!isRecord(input) || !exactKeys(input, fields)) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    const now = input.now;
    const maxInputBytes = input.max_input_bytes;
    const maxWorkItemsPerProject = input.max_work_items_per_project;
    const maxConcurrentProjects = Object.hasOwn(input, "max_concurrent_projects") ? input.max_concurrent_projects : undefined;
    if (typeof now !== "string" || typeof maxInputBytes !== "number" || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > 1048576 ||
        (Object.hasOwn(input, "max_work_items_per_project") &&
          (typeof maxWorkItemsPerProject !== "number" || !Number.isSafeInteger(maxWorkItemsPerProject) || maxWorkItemsPerProject < 1 || maxWorkItemsPerProject > AUTOMATIC_REFLECTION_MAX_ATTEMPTS_PER_PROJECT_RUN)) ||
        (Object.hasOwn(input, "max_concurrent_projects") &&
          (typeof maxConcurrentProjects !== "number" || !Number.isSafeInteger(maxConcurrentProjects) || maxConcurrentProjects < 1 || maxConcurrentProjects > 8))) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    try {
      parseInstant(now);
    } catch {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    return undefined;
  }

  private async prepareAutomaticReflectionCandidates(project_uid: string): Promise<void> {
    const sessionUids = await this.runAutomaticRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (s:Session {project_uid: $project_uid})
         RETURN s.session_uid AS session_uid, s.project_uid AS session_project_uid
         ORDER BY s.session_uid`,
        { project_uid },
      );
      const seen = new Set<string>();
      for (const record of result.records) {
        const sessionUid = field(record, "session_uid");
        if (!canonicalUuid(sessionUid) || field(record, "session_project_uid") !== project_uid || seen.has(sessionUid)) {
          throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
        seen.add(sessionUid);
      }
      return [...seen];
    });
    for (const session_uid of sessionUids) {
      const input = { project_uid, session_uid };
      const units = await this.materializeExecutionUnits(input);
      if (units.status === "failed" || units.status === "indeterminate") {
        throw new AutomaticAbortError(units.status === "failed" && units.code === "identity_conflict"
          ? "identity_conflict" : "source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
      }
      const candidates = await this.materializeExecutionReviewCandidates(input);
      if (candidates.status === "failed" || candidates.status === "indeterminate") {
        throw new AutomaticAbortError(candidates.status === "failed" && candidates.code === "identity_conflict"
          ? "identity_conflict" : "source_incomplete", SOURCE_INCOMPLETE_MESSAGE);
      }
    }
  }
  private async ensureAutomaticReflectionCursor(project_uid: string): Promise<AutomaticCursorState | undefined> {
    let cursor: AutomaticCursorState | undefined;
    let foundNoCandidates = false;
    await this.runAutomaticWrite(async (transaction, markWrite) => {
      markWrite();

      const projectResult = await transaction.run(
        `MATCH (p:Project {project_uid: $project_uid})
         SET p.project_uid = p.project_uid
         RETURN elementId(p) AS project_element_id,
                labels(p) AS project_labels, properties(p) AS project_properties`,
        { project_uid },
      );
      if (projectResult.records.length !== 1 || !this.validProjectIdentity(projectResult.records[0], project_uid)) {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      const project_element_id = field(projectResult.records[0], "project_element_id");
      if (typeof project_element_id !== "string") {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }

      let topology = await this.loadAutomaticCursorTopology(transaction, project_uid);
      const existing = this.validateAutomaticCursorTopology(project_uid, project_element_id, topology);
      if (existing !== undefined) {
        cursor = existing;
        return { status: "automatic_internal" } satisfies AutomaticInternalResult;
      }
      if (topology.outgoing.length > 0 || topology.claimed.length > 0 || topology.incoming.length > 0) {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }

      const rows = await this.readAutomaticCandidateTerminals(transaction, project_uid);
      if (rows.length === 0) {
        foundNoCandidates = true;
        return { status: "automatic_internal" } satisfies AutomaticInternalResult;
      }
      const earliest = rows.reduce((min, row) => {
        const epoch = parseInstant(row.terminal_captured_at);
        return epoch < min ? epoch : min;
      }, Number.POSITIVE_INFINITY);
      const properties = {
        cursor_uid: automaticReflectionScheduleCursorUid(project_uid),
        project_uid,
        schedule_version: "v1",
        timezone: AUTOMATIC_REFLECTION_TIMEZONE,
        next_daily_period: periodKeyContaining("daily", earliest),
        next_weekly_period: periodKeyContaining("weekly", earliest),
        next_monthly_period: periodKeyContaining("monthly", earliest),
      };
      await this.authorizeAutomaticWrite(transaction, project_uid);
      await transaction.run(
        `CREATE (c:ReflectionScheduleCursor)
         SET c = $properties
         WITH c
         MATCH (p:Project {project_uid: $project_uid})
         CREATE (p)-[:HAS_REFLECTION_SCHEDULE]->(c)`,
        { project_uid, properties },
      );
      topology = await this.loadAutomaticCursorTopology(transaction, project_uid);
      cursor = this.validateAutomaticCursorTopology(project_uid, project_element_id, topology);
      if (cursor === undefined) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      return { status: "automatic_internal" } satisfies AutomaticInternalResult;
    });
    return foundNoCandidates ? undefined : cursor;
  }

  private async loadAutomaticCursorTopology(
    transaction: TxLike,
    project_uid: string,
  ): Promise<{ outgoing: AutomaticTopologyOutgoing[]; claimed: AutomaticTopologyNode[]; incoming: AutomaticTopologyIncoming[] }> {
    const cursor_uid = automaticReflectionScheduleCursorUid(project_uid);
    const outgoingResult = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})-[link:HAS_REFLECTION_SCHEDULE]->(target)
       RETURN elementId(target) AS target_element_id,
              labels(target) AS target_labels,
              keys(target) AS target_keys,
              properties(target) AS target_properties,
              properties(link) AS link_properties`,
      { project_uid },
    );
    const outgoing: AutomaticTopologyOutgoing[] = [];
    for (const record of outgoingResult.records) {
      const element_id = field(record, "target_element_id");
      if (typeof element_id !== "string") throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      outgoing.push({
        element_id,
        labels: field(record, "target_labels"),
        keys: field(record, "target_keys"),
        properties: field(record, "target_properties"),
        link_properties: field(record, "link_properties"),
      });
    }

    const claimedResult = await transaction.run(
      `MATCH (c:ReflectionScheduleCursor)
       WHERE c.project_uid = $project_uid OR c.cursor_uid = $cursor_uid
       RETURN elementId(c) AS cursor_element_id,
              labels(c) AS cursor_labels,
              keys(c) AS cursor_keys,
              properties(c) AS cursor_properties`,
      { project_uid, cursor_uid },
    );
    const claimed: AutomaticTopologyNode[] = [];
    for (const record of claimedResult.records) {
      const element_id = field(record, "cursor_element_id");
      if (typeof element_id !== "string") throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      claimed.push({
        element_id,
        labels: field(record, "cursor_labels"),
        keys: field(record, "cursor_keys"),
        properties: field(record, "cursor_properties"),
      });
    }

    const target_element_ids = [...new Set([...outgoing, ...claimed].map((node) => node.element_id))];
    const incoming: AutomaticTopologyIncoming[] = [];
    if (target_element_ids.length > 0) {
      const incomingResult = await transaction.run(
        `MATCH (owner)-[link:HAS_REFLECTION_SCHEDULE]->(target)
         WHERE elementId(target) IN $target_element_ids
         RETURN elementId(owner) AS owner_element_id,
                labels(owner) AS owner_labels,
                properties(owner) AS owner_properties,
                elementId(target) AS target_element_id,
                labels(target) AS target_labels,
                keys(target) AS target_keys,
                properties(target) AS target_properties,
                properties(link) AS link_properties`,
        { target_element_ids },
      );
      for (const record of incomingResult.records) {
        const owner_element_id = field(record, "owner_element_id");
        const target_element_id = field(record, "target_element_id");
        if (typeof owner_element_id !== "string" || typeof target_element_id !== "string") {
          throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
        incoming.push({
          owner_element_id,
          owner_labels: field(record, "owner_labels"),
          owner_properties: field(record, "owner_properties"),
          target_element_id,
          target_labels: field(record, "target_labels"),
          target_keys: field(record, "target_keys"),
          target_properties: field(record, "target_properties"),
          link_properties: field(record, "link_properties"),
        });
      }
    }
    return { outgoing, claimed, incoming };
  }

  private validateAutomaticCursorTopology(
    project_uid: string,
    project_element_id: string,
    topology: { outgoing: AutomaticTopologyOutgoing[]; claimed: AutomaticTopologyNode[]; incoming: AutomaticTopologyIncoming[] },
  ): AutomaticCursorState | undefined {
    if (topology.outgoing.length !== 1 || topology.claimed.length !== 1 || topology.incoming.length !== 1) return undefined;
    const outgoing = topology.outgoing[0]!;
    const claimed = topology.claimed[0]!;
    const incoming = topology.incoming[0]!;
    if (
      outgoing.element_id !== claimed.element_id ||
      incoming.target_element_id !== outgoing.element_id ||
      incoming.owner_element_id !== project_element_id ||
      !Array.isArray(incoming.owner_labels) ||
      incoming.owner_labels.length !== 1 ||
      incoming.owner_labels[0] !== "Project" ||
      !isRecord(incoming.owner_properties) ||
      incoming.owner_properties.project_uid !== project_uid
    ) return undefined;
    const values: Record<string, unknown> = {
      project_labels: incoming.owner_labels,
      project_properties: incoming.owner_properties,
      cursor_labels: outgoing.labels,
      cursor_keys: outgoing.keys,
      cursor_properties: outgoing.properties,
      link_properties: incoming.link_properties,
    };
    return this.parseAutomaticCursorRecord({ get: (key: string) => values[key] }, project_uid);
  }

  private async readAutomaticReflectionCursor(project_uid: string): Promise<AutomaticCursorState> {
    return this.runAutomaticRead(async (transaction) => {
      const projectResult = await transaction.run(
        `MATCH (p:Project {project_uid: $project_uid})
         RETURN elementId(p) AS project_element_id,
                labels(p) AS project_labels, properties(p) AS project_properties`,
        { project_uid },
      );
      const project_element_id = field(projectResult.records[0], "project_element_id");
      if (
        projectResult.records.length !== 1 ||
        typeof project_element_id !== "string" ||
        !this.validProjectIdentity(projectResult.records[0], project_uid)
      ) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      const topology = await this.loadAutomaticCursorTopology(transaction, project_uid);
      const cursor = this.validateAutomaticCursorTopology(project_uid, project_element_id, topology);
      if (cursor === undefined) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      return cursor;
    });
  }

  private async verifyAutomaticProjectOwnership(record: ProjectOwnershipRecord): Promise<boolean> {
    return this.runAutomaticRead(async (transaction) => {
      const projectResult = await transaction.run(
        `OPTIONAL MATCH (p:Project {project_uid: $project_uid})
         RETURN labels(p) AS project_labels, properties(p) AS project_properties,
                CASE WHEN p IS NULL THEN EXISTS { MATCH (n) WHERE n.project_uid = $project_uid }
                     ELSE true END AS has_project_data`,
        { project_uid: record.project_uid },
      );
      const row = projectResult.records[0];
      if (
        projectResult.records.length === 1 &&
        field(row, "project_labels") === null &&
        field(row, "project_properties") === null &&
        field(row, "has_project_data") === false
      ) return false;
      const properties = field(row, "project_properties");
      if (
        projectResult.records.length !== 1 ||
        !this.validProjectIdentity(row, record.project_uid) ||
        !isRecord(properties) ||
        properties.identity_fingerprint !== record.identity_fingerprint
      ) {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      return true;
    });
  }

  private async readAutomaticReflectionScope(
    project_uid: string,
    slot: AutomaticSlot,
  ): Promise<{ model_input?: AutomaticReflectionInput; empty: boolean }> {
    return this.runAutomaticRead(async (transaction) => {
      const scope = await this.collectAutomaticReflectionScope(transaction, project_uid, slot);
      if (scope.digests.length === 0) return { empty: true };
      try {
        return {
          empty: false,
          model_input: buildAutomaticReflectionInput(scope.selector, scope.digests),
        };
      } catch (error: unknown) {
        throw new AutomaticAbortError(
          error instanceof TaskDigestProjectorError ? "source_incomplete" : "identity_conflict",
          error instanceof Error ? error.message : IDENTITY_CONFLICT_MESSAGE,
        );
      }
    });
  }

  private async readAutomaticReflectionPlan(
    project_uid: string,
    slot: AutomaticSlot,
    model_input: AutomaticReflectionInput,
  ): Promise<ReflectionPersistencePlan | undefined> {
    return this.runAutomaticRead((transaction) =>
      this.readStoredAutomaticReflectionPlan(transaction, project_uid, slot, model_input),
    );
  }

  private async readStoredAutomaticReflectionPlan(
    transaction: TxLike,
    project_uid: string,
    slot: AutomaticSlot,
    model_input: AutomaticReflectionInput,
  ): Promise<ReflectionPersistencePlan | undefined> {
    const result = await transaction.run(
      `MATCH (r:Reflection {
         project_uid: $project_uid,
         kind: $kind,
         scope_fingerprint: $scope_fingerprint,
         input_fingerprint: $input_fingerprint
       })
       RETURN properties(r) AS properties`,
      {
        project_uid,
        kind: slot.kind,
        scope_fingerprint: model_input.scope_fingerprint,
        input_fingerprint: model_input.input_fingerprint,
      },
    );
    if (result.records.length === 0) return undefined;
    if (result.records.length !== 1) {
      throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
    const properties = field(result.records[0], "properties");
    if (
      !isRecord(properties) ||
      properties.project_uid !== project_uid ||
      properties.kind !== slot.kind ||
      properties.scope_fingerprint !== model_input.scope_fingerprint ||
      properties.input_fingerprint !== model_input.input_fingerprint ||
      typeof properties.reflection_uid !== "string" ||
      typeof properties.prompt_contract_version !== "string" ||
      typeof properties.model_ref !== "string" ||
      typeof properties.overview_json !== "string" ||
      typeof properties.observations_json !== "string" ||
      typeof properties.open_questions_json !== "string"
    ) {
      throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
    try {
      const response = {
        overview: JSON.parse(properties.overview_json),
        observations: JSON.parse(properties.observations_json),
        open_questions: JSON.parse(properties.open_questions_json),
      };
      const plan = buildAutomaticReflectionPlan({
        model_input,
        prompt_contract_version: properties.prompt_contract_version,
        model_ref: properties.model_ref,
        response,
      });
      if (plan.facts.reflection_uid !== properties.reflection_uid) {
        throw new Error("stored reflection identity does not match its reconstructed plan");
      }
      return plan;
    } catch {
      throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
  }

  private async writeAutomaticReflectionSlot(
    project_uid: string,
    slot: AutomaticSlot,
    model_input: AutomaticReflectionInput | undefined,
    plan: ReflectionPersistencePlan | undefined,
    full_input?: AutomaticReflectionInput,
    final_batch = true,
    max_input_bytes = Number.MAX_SAFE_INTEGER,
  ): Promise<{ attempt: AutomaticReflectionAttempt; cursor: AutomaticCursorState; new_work: boolean }> {
    return this.runAutomaticWrite(async (transaction, markWrite) => {
      markWrite();
      const locked = await this.lockAutomaticReflectionCursor(transaction, project_uid);
      const property = this.automaticCursorProperty(slot.kind);
      if (locked[property] !== slot.period_key) {
        return {
          attempt: { project_uid, kind: slot.kind, period_key: slot.period_key, status: "already_processed" },
          cursor: locked,
          new_work: false,
        };
      }

      const freshScope = await this.collectAutomaticReflectionScope(transaction, project_uid, slot);
      if (model_input === undefined) {
        if (freshScope.digests.length !== 0 || full_input !== undefined || !final_batch) {
          throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
        await this.authorizeAutomaticWrite(transaction, project_uid);
        const cursor = await this.advanceAutomaticReflectionCursor(transaction, project_uid, slot);
        return {
          attempt: { project_uid, kind: slot.kind, period_key: slot.period_key, status: "empty_scope" },
          cursor,
          new_work: true,
        };
      }
      if (freshScope.digests.length === 0 || full_input === undefined) {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      const freshInput = buildAutomaticReflectionInput(freshScope.selector, freshScope.digests);
      if (
        freshInput.input_fingerprint !== full_input.input_fingerprint ||
        freshInput.scope_fingerprint !== full_input.scope_fingerprint
      ) {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      let matchingBatch = false;
      try {
        const freshBatches = buildAutomaticReflectionBatches(freshInput, max_input_bytes);
        const batchIndex = freshBatches.findIndex((batch) =>
          batch.input_fingerprint === model_input.input_fingerprint &&
          canonicalize(batch as never) === canonicalize(model_input as never));
        matchingBatch = batchIndex >= 0 && (batchIndex === freshBatches.length - 1) === final_batch;
      } catch {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      if (!matchingBatch) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);

      const storedPlan = await this.readStoredAutomaticReflectionPlan(transaction, project_uid, slot, model_input);
      const selectedPlan = storedPlan ?? plan;
      if (selectedPlan === undefined) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      await this.authorizeAutomaticWrite(transaction, project_uid);
      try {
        const materialized = await materializeReflectionPlan(transaction, selectedPlan);
        const cursor = final_batch
          ? await this.advanceAutomaticReflectionCursor(transaction, project_uid, slot)
          : locked;
        return {
          attempt: materialized.status === "materialized"
            ? { project_uid, kind: slot.kind, period_key: slot.period_key, status: "materialized", reflection_uid: materialized.reflection_uid }
            : { project_uid, kind: slot.kind, period_key: slot.period_key, status: "up_to_date", reflection_uid: materialized.reflection_uid },
          cursor,
          new_work: materialized.status === "materialized" || final_batch,
        };
      } catch (error: unknown) {
        if (error instanceof ReflectionMaterializationError) {
          throw new AutomaticAbortError(error.code === "not_found" ? "source_incomplete" : "identity_conflict", error.message);
        }
        throw error;
      }
    });
  }

  private async authorizeAutomaticWrite(transaction: TxLike, project_uid: string): Promise<void> {
    if (this.authorizeAutomaticBeforeWrite === undefined) return;
    let marker: string | undefined;
    try {
      marker = await this.authorizeAutomaticBeforeWrite(project_uid);
    } catch {
      throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
    if (typeof marker !== "string" || !SHA256_PATTERN.test(marker)) {
      throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
    const result = await transaction.run(
      "MATCH (p:Project {project_uid: $project_uid}) RETURN p.identity_fingerprint AS fingerprint",
      { project_uid },
    );
    if (result.records.length !== 1 || field(result.records[0], "fingerprint") !== marker) {
      throw this.domain("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    }
  }

  private async lockAutomaticReflectionCursor(transaction: TxLike, project_uid: string): Promise<AutomaticCursorState> {
    const projectResult = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})
       SET p.project_uid = p.project_uid
       RETURN elementId(p) AS project_element_id,
              labels(p) AS project_labels, properties(p) AS project_properties`,
      { project_uid },
    );
    const project_element_id = field(projectResult.records[0], "project_element_id");
    if (
      projectResult.records.length !== 1 ||
      typeof project_element_id !== "string" ||
      !this.validProjectIdentity(projectResult.records[0], project_uid)
    ) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const topology = await this.loadAutomaticCursorTopology(transaction, project_uid);
    const cursor = this.validateAutomaticCursorTopology(project_uid, project_element_id, topology);
    if (cursor === undefined) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    return cursor;
  }

  private async advanceAutomaticReflectionCursor(
    transaction: TxLike,
    project_uid: string,
    slot: AutomaticSlot,
  ): Promise<AutomaticCursorState> {
    const property = this.automaticCursorProperty(slot.kind);
    const next_period = nextAutomaticCursorPeriod(slot.kind, slot.period_key);
    const cursor_uid = automaticReflectionScheduleCursorUid(project_uid);
    await transaction.run(
      `MATCH (c:ReflectionScheduleCursor {cursor_uid: $cursor_uid})
       SET c.${property} = $next_period`,
      { cursor_uid, next_period },
    );
    const result = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})-[link:HAS_REFLECTION_SCHEDULE]->(c:ReflectionScheduleCursor {cursor_uid: $cursor_uid})
       RETURN labels(p) AS project_labels, properties(p) AS project_properties,
              labels(c) AS cursor_labels, keys(c) AS cursor_keys,
              properties(c) AS cursor_properties, properties(link) AS link_properties`,
      { project_uid, cursor_uid },
    );
    if (result.records.length !== 1) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    const cursor = this.parseAutomaticCursorRecord(result.records[0], project_uid);
    if (cursor === undefined) throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    return cursor;
  }

  private async readAutomaticCandidateTerminals(
    transaction: TxLike,
    project_uid: string,
  ): Promise<AutomaticCandidateTerminalRow[]> {
    const result = await transaction.run(
      `MATCH (c:ExecutionReviewCandidate)
       WHERE c.project_uid = $project_uid
         AND (c.state IS NULL OR c.state <> "rejected")
       OPTIONAL MATCH (c)-[terminal:EVIDENCED_BY {role: "terminal"}]->(event:RawEvent)
       RETURN c.candidate_uid AS candidate_uid, c.project_uid AS candidate_project_uid,
              count(event) AS terminal_count,
              collect({event_uid: event.event_uid, captured_at: event.captured_at, position: terminal.position}) AS terminal_events`,
      { project_uid },
    );
    const rows: AutomaticCandidateTerminalRow[] = [];
    const seen = new Set<string>();
    for (const record of result.records) {
      const candidate_uid = field(record, "candidate_uid");
      if (!canonicalUuid(candidate_uid) || field(record, "candidate_project_uid") !== project_uid || seen.has(candidate_uid)) {
        throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      seen.add(candidate_uid);
      const terminal_count = numberValue(field(record, "terminal_count"));
      const terminal_events = field(record, "terminal_events");
      if (terminal_count !== 1 || !Array.isArray(terminal_events) || terminal_events.length !== 1) {
        throw new AutomaticAbortError("invalid_timestamp", "Candidate terminal timestamp is missing or ambiguous.");
      }
      const terminal = terminal_events[0];
      if (!isRecord(terminal) || !canonicalUuid(terminal.event_uid) || typeof terminal.captured_at !== "string") {
        throw new AutomaticAbortError("invalid_timestamp", "Candidate terminal timestamp is malformed.");
      }
      try {
        parseInstant(terminal.captured_at);
        periodKeyContaining("daily", terminal.captured_at);
        periodKeyContaining("weekly", terminal.captured_at);
        periodKeyContaining("monthly", terminal.captured_at);
      } catch {
        throw new AutomaticAbortError("invalid_timestamp", "Candidate terminal timestamp is malformed.");
      }
      rows.push({ candidate_uid, terminal_captured_at: terminal.captured_at });
    }
    return rows;
  }

  private async collectAutomaticReflectionScope(
    transaction: TxLike,
    project_uid: string,
    slot: AutomaticSlot,
  ): Promise<{ selector: AutomaticReflectionSelector; digests: TaskDigest[] }> {
    const selector = automaticReflectionSelector(project_uid, slot.kind, slot.period_key);
    const rows = await this.readAutomaticCandidateTerminals(transaction, project_uid);
    const selected = rows.filter((row) => selectorContains(selector, row.terminal_captured_at));
    const digests: TaskDigest[] = [];
    // Share a session read only within this fresh scope transaction.
    const sessionSources = new Map<string, Promise<ExecutionSourceEvent[]>>();
    const readScopeExecutionSource = (tx: TxLike, sourceInput: MaterializeExecutionUnitsInput): Promise<ExecutionSourceEvent[]> => {
      const key = `${sourceInput.project_uid}\u0000${sourceInput.session_uid}`;
      let source = sessionSources.get(key);
      if (source === undefined) {
        source = this.readExecutionSource(tx, sourceInput);
        sessionSources.set(key, source);
      }
      return source;
    };
    for (const row of selected) {
      const source = await readExecutionCandidateSource({
        transaction,
        candidate_uid: row.candidate_uid,
        readExecutionSource: readScopeExecutionSource,
        readRequestedExecutionUnits: this.readRequestedExecutionUnits.bind(this),
        domain: this.domain.bind(this),
      });
      let projection: TaskDigestProjectionInput;
      try {
        projection = buildTaskDigestProjection(source);
        if (parseInstant(projection.terminal.captured_at) !== parseInstant(row.terminal_captured_at)) {
          throw new AutomaticAbortError("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }
      } catch (error: unknown) {
        if (error instanceof AutomaticAbortError || error instanceof StoreDomainError) throw error;
        throw new AutomaticAbortError(
          error instanceof TaskDigestProjectorError ? "source_incomplete" : "identity_conflict",
          error instanceof Error ? error.message : IDENTITY_CONFLICT_MESSAGE,
        );
      }
      try {
        digests.push(projectTaskDigest(projection));
      } catch (error: unknown) {
        throw new AutomaticAbortError(
          error instanceof TaskDigestProjectorError ? "source_incomplete" : "identity_conflict",
          error instanceof Error ? error.message : IDENTITY_CONFLICT_MESSAGE,
        );
      }
    }
    return { selector, digests };
  }

  private parseAutomaticCursorRecord(record: QueryRecord | undefined, project_uid: string): AutomaticCursorState | undefined {
    const cursorProperties = field(record, "cursor_properties");
    if (cursorProperties === null || cursorProperties === undefined) return undefined;
    const cursorLabels = field(record, "cursor_labels");
    if (!isRecord(cursorProperties)) return undefined;
    const cursorKeys = field(record, "cursor_keys");
    const projectLabels = field(record, "project_labels");
    const projectProperties = field(record, "project_properties");
    const linkProperties = field(record, "link_properties");
    const keys = ["cursor_uid", "project_uid", "schedule_version", "timezone", "next_daily_period", "next_weekly_period", "next_monthly_period"];
    const sortedKeys = [...keys].sort();
    if (
      !Array.isArray(cursorLabels) || cursorLabels.length !== 1 || cursorLabels[0] !== "ReflectionScheduleCursor" ||
      !Array.isArray(projectLabels) || projectLabels.length !== 1 || projectLabels[0] !== "Project" ||
      !Array.isArray(cursorKeys) || cursorKeys.some((key) => typeof key !== "string") ||
      cursorKeys.length !== keys.length || [...cursorKeys].sort().some((key, index) => key !== sortedKeys[index]) ||
      !exactKeys(cursorProperties, keys) ||
      !isRecord(projectProperties) || projectProperties.project_uid !== project_uid ||
      !isRecord(linkProperties) || !exactKeys(linkProperties, [])
    ) return undefined;
    const cursor_uid = cursorProperties.cursor_uid;
    if (
      typeof cursor_uid !== "string" ||
      cursor_uid !== automaticReflectionScheduleCursorUid(project_uid) ||
      cursorProperties.project_uid !== project_uid ||
      cursorProperties.schedule_version !== "v1" ||
      cursorProperties.timezone !== AUTOMATIC_REFLECTION_TIMEZONE
    ) return undefined;
    const parsePeriod = (kind: AutomaticReflectionKind, value: unknown): AutomaticReflectionCursorPeriod | undefined => {
      if (value === AUTOMATIC_REFLECTION_COMPLETE_PERIOD) return value;
      if (typeof value !== "string") return undefined;
      try {
        automaticReflectionSelector(project_uid, kind, value);
        return value;
      } catch {
        return undefined;
      }
    };
    const next_daily_period = parsePeriod("daily", cursorProperties.next_daily_period);
    const next_weekly_period = parsePeriod("weekly", cursorProperties.next_weekly_period);
    const next_monthly_period = parsePeriod("monthly", cursorProperties.next_monthly_period);
    if (next_daily_period === undefined || next_weekly_period === undefined || next_monthly_period === undefined) return undefined;
    return {
      cursor_uid,
      project_uid,
      schedule_version: "v1",
      timezone: AUTOMATIC_REFLECTION_TIMEZONE,
      next_daily_period,
      next_weekly_period,
      next_monthly_period,
    };
  }
  private validProjectIdentity(record: QueryRecord | undefined, project_uid: string): boolean {
    const labels = field(record, "project_labels");
    const properties = field(record, "project_properties");
    return Array.isArray(labels) && labels.length === 1 && labels[0] === "Project" && isRecord(properties) && properties.project_uid === project_uid;
  }

  private selectAutomaticSlot(cursor: AutomaticCursorState, nowEpoch: number): AutomaticSlot | undefined {
    const slots = AUTOMATIC_REFLECTION_KINDS.flatMap((kind) => {
      const period_key = cursor[this.automaticCursorProperty(kind)];
      if (period_key === AUTOMATIC_REFLECTION_COMPLETE_PERIOD) return [];
      const selector = automaticReflectionSelector(cursor.project_uid, kind, period_key);
      return [{ kind, period_key, due_at: selectorDueAt(selector), due_epoch: parseInstant(selectorDueAt(selector)) }];
    }).filter((slot) => slot.due_epoch <= nowEpoch);
    slots.sort((left, right) => left.due_epoch - right.due_epoch || AUTOMATIC_REFLECTION_KINDS.indexOf(left.kind) - AUTOMATIC_REFLECTION_KINDS.indexOf(right.kind));
    const first = slots[0];
    return first === undefined ? undefined : { kind: first.kind, period_key: first.period_key, due_at: first.due_at };
  }

  private automaticCursorProperty(kind: AutomaticReflectionKind): "next_daily_period" | "next_weekly_period" | "next_monthly_period" {
    return kind === "daily" ? "next_daily_period" : kind === "weekly" ? "next_weekly_period" : "next_monthly_period";
  }

  private automaticPromptContract(kind: AutomaticReflectionKind): string {
    return kind === "daily" ? DAILY_REFLECTION_PROMPT_CONTRACT : kind === "weekly" ? WEEKLY_REFLECTION_PROMPT_CONTRACT : MONTHLY_REFLECTION_PROMPT_CONTRACT;
  }

  private automaticInitializationAttempt(project_uid: string, failure: { code: AutomaticReflectionAttemptCode; message: string }): AutomaticReflectionAttempt {
    return { project_uid, status: "blocked", code: failure.code, message: failure.message } as AutomaticReflectionAttempt;
  }

  private automaticSlotAttempt(
    project_uid: string,
    slot: AutomaticSlot,
    status: "blocked" | "failed",
    failure: { code: AutomaticReflectionAttemptCode; message: string },
  ): AutomaticReflectionAttempt {
    return { project_uid, kind: slot.kind, period_key: slot.period_key, status, code: failure.code, message: failure.message };
  }

  private automaticFailure(error: unknown, fallback: AutomaticReflectionAttemptCode): { code: AutomaticReflectionAttemptCode; message: string } {
    if (error instanceof AutomaticAbortError) return error.result;
    if (error instanceof StoreDomainError) {
      const code = error.code === "identity_conflict" ? "identity_conflict" : error.code === "source_incomplete" ? "source_incomplete" : "database_error";
      return { code, message: error.message };
    }
    return { code: fallback, message: fallback === "database_error" ? DATABASE_ERROR_MESSAGE : SOURCE_INCOMPLETE_MESSAGE };
  }

  private async runAutomaticRead<T>(work: (transaction: TxLike) => Promise<T>): Promise<T> {
    const driver = this.driver;
    if (driver === undefined || this.database === undefined) throw new AutomaticAbortError("database_error", DATABASE_ERROR_MESSAGE);
    let session: SessionLike;
    try {
      session = driver.session({ database: this.database }) as unknown as SessionLike;
    } catch {
      throw new AutomaticAbortError("database_error", DATABASE_ERROR_MESSAGE);
    }
    let result: T | undefined;
    let completed = false;
    let operationError: unknown;
    try {
      result = session.executeRead === undefined ? await work(session) : await session.executeRead(work);
      completed = true;
    } catch (error: unknown) {
      operationError = error;
    }
    let closeError: unknown;
    try {
      await session.close();
    } catch (error: unknown) {
      closeError = error;
    }
    try {
      await releaseNeo4jSessionTurn();
    } catch (error: unknown) {
      closeError ??= error;
    }
    if (operationError instanceof AutomaticAbortError || operationError instanceof StoreDomainError) throw operationError;
    if (operationError !== undefined) throw new AutomaticAbortError("database_error", DATABASE_ERROR_MESSAGE);
    if (closeError !== undefined) throw new AutomaticAbortError("database_error", DATABASE_ERROR_MESSAGE);
    if (!completed) throw new AutomaticAbortError("database_error", DATABASE_ERROR_MESSAGE);
    return result as T;
  }

  private async runAutomaticWrite<T>(work: (transaction: TxLike, markWrite: () => void) => Promise<T>): Promise<T> {
    const driver = this.driver;
    if (driver === undefined || this.database === undefined) throw new AutomaticAbortError("database_error", DATABASE_ERROR_MESSAGE);
    let wrote = false;
    const session = driver.session({ database: this.database }) as unknown as SessionLike;
    try {
      const callback = (transaction: TxLike): Promise<T> => work(transaction, () => { wrote = true; });
      return session.executeWrite === undefined ? await callback(session) : await session.executeWrite(callback);
    } catch (error: unknown) {
      if (error instanceof AutomaticAbortError || error instanceof StoreDomainError) throw error;
      if (wrote) throw new AutomaticAbortError("database_error", UNKNOWN_WRITE_MESSAGE);
      throw error;
    } finally {
      try { await session.close(); } catch { /* write outcome is handled above */ }
      await releaseNeo4jSessionTurn();
    }
  }

  private async runRead<T extends StoreResult>(
    work: (transaction: TxLike) => Promise<T>,
  ): Promise<{ kind: "ok"; result: T } | { kind: "domain"; result: StoreResult } | { kind: "database" } | { kind: "closed" }> {
    const driver = this.driver;
    if (driver === undefined || this.database === undefined) return { kind: "database" };
    let session: SessionLike;
    try {
      session = driver.session({ database: this.database }) as unknown as SessionLike;
    } catch {
      return { kind: "database" };
    }
    let domainResult: StoreResult | undefined;
    try {
      const callback = async (transaction: TxLike): Promise<T> => {
        try {
          return await work(transaction);
        } catch (error: unknown) {
          if (error instanceof StoreDomainError) {
            domainResult = resultForDomain(error);
            throw new TransactionAbort(domainResult);
          }
          throw error;
        }
      };
      const result = session.executeRead === undefined ? await callback(session) : await session.executeRead(callback);
      return { kind: "ok", result };
    } catch (error: unknown) {
      if (error instanceof TransactionAbort && domainResult !== undefined) return { kind: "domain", result: domainResult };
      if (this.isClosed()) return { kind: "closed" };
      return { kind: "database" };
    } finally {
      try { await session.close(); } catch { /* read-only close */ }
      await releaseNeo4jSessionTurn();
    }
  }
  private async runWrite<T extends StoreResult>(
    work: (transaction: TxLike, markWrite: () => void) => Promise<T>,
  ): Promise<
    | { kind: "ok"; result: T }
    | { kind: "domain"; result: StoreResult }
    | { kind: "database" }
    | { kind: "unknown" }
    | { kind: "closed" }
  > {
    const driver = this.driver;
    if (driver === undefined || this.database === undefined) return { kind: "database" };
    let session: SessionLike;
    try {
      session = driver.session({ database: this.database }) as unknown as SessionLike;
    } catch {
      return { kind: "database" };
    }
    let writeStarted = false;
    let domainResult: StoreResult | undefined;
    try {
      const callback = async (transaction: TxLike): Promise<T> => {
        try {
          return await work(transaction, () => { writeStarted = true; });
        } catch (error: unknown) {
          if (error instanceof StoreDomainError) {
            domainResult = resultForDomain(error);
            throw new TransactionAbort(domainResult);
          }
          throw error;
        }
      };
      const result = session.executeWrite === undefined ? await callback(session) : await session.executeWrite(callback);
      return { kind: "ok", result };
    } catch (error: unknown) {
      if (error instanceof TransactionAbort && domainResult !== undefined) return { kind: "domain", result: domainResult };
      if (writeStarted) return { kind: "unknown" };
      if (this.isClosed()) return { kind: "closed" };
      return { kind: "database" };
    } finally {
      try {
        await session.close();
      } catch {
        if (writeStarted && !this.isClosed()) domainResult = undefined;
      }
      await releaseNeo4jSessionTurn();
    }
  }
  private validateReflectManualCandidateInput(input: unknown): ReflectManualCandidateResult | undefined {
    const fields = ["candidate_uid", "model_ref", "prompt_contract_version", "max_input_bytes"];
    if (isRecord(input) && Object.hasOwn(input, "authorize_before_write")) fields.push("authorize_before_write");
    if (!isRecord(input) || !exactKeys(input, fields) ||
        (Object.hasOwn(input, "authorize_before_write") && typeof input.authorize_before_write !== "function")) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    const maxInputBytes = input.max_input_bytes;
    if (
      !canonicalUuid(input.candidate_uid) ||
      typeof input.model_ref !== "string" ||
      input.model_ref.length === 0 ||
      input.model_ref.length > 256 ||
      input.prompt_contract_version !== "manual-reflection/v1" ||
      typeof maxInputBytes !== "number" ||
      !Number.isSafeInteger(maxInputBytes) ||
      maxInputBytes < 1 ||
      maxInputBytes > 1048576
    ) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    return undefined;
  }

  private validateTaskDigestInput(input: unknown): GetTaskDigestResult | undefined {
    if (!isRecord(input) || !exactKeys(input, ["candidate_uid"]) || !canonicalUuid(input.candidate_uid)) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    return undefined;
  }

  private validateReviewCandidateInput(input: unknown): MaterializeExecutionReviewCandidatesResult | undefined {
    if (!isRecord(input) || !exactKeys(input, ["project_uid", "session_uid"])) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    if (!canonicalUuid(input.project_uid) || !canonicalUuid(input.session_uid)) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    return undefined;
  }

  private validateReviewExecutionInput(input: unknown): ExecutionReviewOperationResult | undefined {
    if (!isRecord(input) || !exactKeys(input, ["candidate_uid", "lease_owner", "lease_ttl_ms", "prompt_contract_version", "model_ref"])) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    const value = input as unknown as ReviewExecutionCandidateInput;
    if (!canonicalUuid(value.candidate_uid) || typeof value.lease_owner !== "string" || value.lease_owner.length === 0 || value.lease_owner.length > 256 || !Number.isSafeInteger(value.lease_ttl_ms) || value.lease_ttl_ms < 1 || value.lease_ttl_ms > 300000 || typeof value.prompt_contract_version !== "string" || value.prompt_contract_version.length === 0 || typeof value.model_ref !== "string" || value.model_ref.length === 0 || value.model_ref.length > 256) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    return undefined;
  }

  private validateProcessInput(input: unknown): ProcessSessionResult | undefined {
    if (!exactKeys(input, ["project_uid", "session_uid"])) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    const value = input as ProcessSessionInput;
    if (!canonicalUuid(value.project_uid) || !canonicalUuid(value.session_uid)) return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    return undefined;
  }

  private validateContinuationInput(input: unknown): RecordSessionContinuationResult | undefined {
    if (!exactKeys(input, ["project_uid", "session_uid", "previous_session_uid", "checkpoint_event_uid"])) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    const value = input as RecordSessionContinuationInput;
    if (
      !canonicalUuid(value.project_uid) ||
      !canonicalUuid(value.session_uid) ||
      !canonicalUuid(value.previous_session_uid) ||
      !canonicalUuid(value.checkpoint_event_uid) ||
      value.session_uid === value.previous_session_uid
    ) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    return undefined;
  }

  private validateExecutionInput(input: unknown): MaterializeExecutionUnitsResult | undefined {
    if (!isRecord(input) || !exactKeys(input, ["project_uid", "session_uid"])) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    const project_uid = input.project_uid;
    const session_uid = input.session_uid;
    if (!canonicalUuid(project_uid) || !canonicalUuid(session_uid)) {
      return { status: "failed", code: "invalid_input", message: INVALID_MESSAGE };
    }
    return undefined;
  }

  private isClosed(): boolean {
    return this.state === "closed";
  }

  private admit<T extends StoreResult>(): T | undefined {
    if (this.state === "closed" || this.admissionClosed) return this.closedOperationResult() as T;
    if (this.state !== "connected") return { status: "failed", code: "core_degraded", message: DEGRADED_MESSAGE } as T;
    return undefined;
  }

  private throwIfClosed(): void {
    if (this.state === "closed" || this.admissionClosed) throw this.domain("core_closed", CLOSED_MESSAGE);
  }

  private domain(code: StoreDomainError["code"], message?: string): StoreDomainError {
    const messages: Record<StoreDomainError["code"], string> = {
      invalid_input: INVALID_MESSAGE,
      not_found: NOT_FOUND_MESSAGE,
      source_incomplete: SOURCE_INCOMPLETE_MESSAGE,
      identity_conflict: IDENTITY_CONFLICT_MESSAGE,
      evidence_invalid: EVIDENCE_INVALID_MESSAGE,
      revision_conflict: REVISION_CONFLICT_MESSAGE,
      confirmation_required: CONFIRMATION_REQUIRED_MESSAGE,
      invalid_transition: INVALID_TRANSITION_MESSAGE,
      core_closed: CLOSED_MESSAGE,
      core_degraded: DEGRADED_MESSAGE,
    };
    return new StoreDomainError(code, message ?? messages[code]);
  }

  private closedOperationResult(): ProcessSessionResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }
  private closedTaskDigestResult(): GetTaskDigestResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }
  private closedReflectManualCandidateResult(candidate_uid: string): ReflectManualCandidateResult {
    return { status: "failed", candidate_uid, code: "core_closed", message: CLOSED_MESSAGE };
  }

  private closedContinuationResult(): RecordSessionContinuationResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private closedReviewExecutionCandidateResult(candidate_uid: string): ExecutionReviewOperationResult {
    return { status: "failed", code: "core_closed", message: CLOSED_MESSAGE };
  }

  private closedHealth(): MemoryStoreHealth {
    return { status: "closed", database: null, constraints: [] };
  }

  private errorHealth(): MemoryStoreHealth {
    return { status: "error", database: null, constraints: [] };
  }

  private closeDriver(): Promise<void> {
    if (this.driverClosePromise !== undefined) return this.driverClosePromise;
    if (this.driver === undefined) return Promise.resolve();
    try {
      this.driverClosePromise = Promise.resolve(this.driver.close()).catch(() => undefined);
    } catch {
      this.driverClosePromise = Promise.resolve();
    }
    return this.driverClosePromise;
  }
}

function cursorToProjectorState(cursor: CursorState): BoundaryProjectorInput["cursor"] {
  if (cursor.open_window_uid === undefined) return { last_ingest_sequence: cursor.last_ingest_sequence };
  return {
    last_ingest_sequence: cursor.last_ingest_sequence,
    open_window_uid: cursor.open_window_uid,
    open_window_start_sequence: cursor.open_window_start_sequence!,
  };
}
