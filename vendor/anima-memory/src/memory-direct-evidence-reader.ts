import neo4j from "neo4j-driver";
import type { CanonicalRawEvent } from "@deepseek-ai/anima-capture";
import {
  listProjectOwnership,
  type ProjectOwnershipRecord,
  type ProjectOwnershipScope,
} from "./project-ownership.ts";
import { decodeStoredExternalUserMessage } from "./memory-event-decoder.ts";
import { verifyExternalUserTextEvidence, type ExternalUserTextEvidence } from "./memory-direct-evidence.ts";

const UUID_V4_OR_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OWNERSHIP_SCHEMA = "anima.dev-project-ownership/v1";

export type MemoryGraphEvidenceErrorCode = "identity_conflict" | "source_incomplete" | "evidence_invalid";

const ERROR_MESSAGES: Record<MemoryGraphEvidenceErrorCode, string> = {
  identity_conflict: "Registered Project identity or graph topology conflicts.",
  source_incomplete: "Required graph source is incomplete.",
  evidence_invalid: "External user event evidence is invalid.",
};

export class MemoryGraphEvidenceError extends TypeError {
  readonly code: MemoryGraphEvidenceErrorCode;

  constructor(code: MemoryGraphEvidenceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "MemoryGraphEvidenceError";
    this.code = code;
  }
}

export interface MemoryDirectEvidenceReaderQueryRecord {
  get(key: string): unknown;
}

export interface MemoryDirectEvidenceReaderQueryResult {
  records: MemoryDirectEvidenceReaderQueryRecord[];
}

/** The caller owns the transaction and remains responsible for its lifecycle and commit/rollback. */
export interface MemoryDirectEvidenceReaderTransaction {
  run(query: string, parameters?: Record<string, unknown>): Promise<MemoryDirectEvidenceReaderQueryResult>;
}

export interface ReadRegisteredExternalUserTextEvidenceInput {
  transaction: MemoryDirectEvidenceReaderTransaction;
  scope: ProjectOwnershipScope;
  project_uid: string;
  session_uid: string;
  event_uid: string;
  span: {
    text_part_index: number;
    utf8_start: number;
    utf8_end: number;
    sha256: string;
  };
}

export type RegisteredExternalUserTextEvidence = ExternalUserTextEvidence & {
  principal_uid: string;
  identity_fingerprint: string;
};

/** @internal Shared graph verification for all registered RawEvent evidence readers. */
export interface RegisteredRawEventGraph {
  registeredProject: ProjectOwnershipRecord;
  eventSnapshot: GraphNodeSnapshot;
  nextIngestSequence: number;
}
type DataRecord = Record<string, unknown>;
type GraphNodeSnapshot = { labels: string[]; properties: DataRecord };

function fail(code: MemoryGraphEvidenceErrorCode): never {
  throw new MemoryGraphEvidenceError(code);
}

/** @internal Shared structural guard for graph and persisted payload readers. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: MemoryDirectEvidenceReaderQueryRecord | undefined, key: string): unknown {
  if (record === undefined) return undefined;
  try {
    return record.get(key);
  } catch {
    return undefined;
  }
}

function safeRows(result: unknown): MemoryDirectEvidenceReaderQueryRecord[] {
  if (!isRecord(result) || !Array.isArray(result.records)) fail("source_incomplete");
  return result.records as MemoryDirectEvidenceReaderQueryRecord[];
}

function snapshotNode(result: unknown, malformedCode: MemoryGraphEvidenceErrorCode): GraphNodeSnapshot {
  const rows = safeRows(result);
  if (rows.length === 0) fail("source_incomplete");
  if (rows.length !== 1) fail("identity_conflict");
  const labels = field(rows[0], "labels");
  const properties = field(rows[0], "properties");
  if (
    !Array.isArray(labels) ||
    labels.some((label) => typeof label !== "string") ||
    !isRecord(properties)
  ) fail(malformedCode);
  return { labels: labels as string[], properties };
}

function exactlyLabels(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const remaining = new Set(actual);
  if (remaining.size !== actual.length) return false;
  return expected.every((label) => remaining.has(label));
}

function emptyProperties(value: unknown): boolean {
  return isRecord(value) && Reflect.ownKeys(value).length === 0;
}

function safeNonnegativeInteger(value: unknown): number | undefined {
  let number: number;
  if (neo4j.isInt(value)) number = value.toNumber();
  else if (typeof value === "number") number = value;
  else return undefined;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function isOwnershipRecord(value: unknown, principalUid: string): value is ProjectOwnershipRecord {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 4 &&
    keys.every((key) => typeof key === "string") &&
    Object.keys(value).length === 4 &&
    Object.hasOwn(value, "schema_id") &&
    Object.hasOwn(value, "principal_uid") &&
    Object.hasOwn(value, "project_uid") &&
    Object.hasOwn(value, "identity_fingerprint") &&
    value.schema_id === OWNERSHIP_SCHEMA &&
    value.principal_uid === principalUid &&
    typeof value.project_uid === "string" && UUID_V4_OR_V5.test(value.project_uid) &&
    typeof value.identity_fingerprint === "string" && SHA256.test(value.identity_fingerprint);
}

async function findRegisteredProject(scope: ProjectOwnershipScope, projectUid: string): Promise<ProjectOwnershipRecord> {
  let records: readonly ProjectOwnershipRecord[];
  try {
    records = await listProjectOwnership(scope);
  } catch {
    fail("identity_conflict");
  }

  if (!Array.isArray(records)) fail("identity_conflict");
  const principalUid = scope.principal_uid;
  if (typeof principalUid !== "string" || !UUID_V4.test(principalUid)) fail("identity_conflict");

  let selected: ProjectOwnershipRecord | undefined;
  for (const record of records) {
    if (!isOwnershipRecord(record, principalUid)) fail("identity_conflict");
    if (record.project_uid === projectUid) {
      if (selected !== undefined) fail("identity_conflict");
      selected = record;
    }
  }
  if (selected === undefined) fail("identity_conflict");
  return selected;
}

async function readSingleNode(
  transaction: MemoryDirectEvidenceReaderTransaction,
  query: string,
  parameters: Record<string, unknown>,
  malformedCode: MemoryGraphEvidenceErrorCode,
): Promise<GraphNodeSnapshot> {
  const result = await transaction.run(query, parameters);
  return snapshotNode(result, malformedCode);
}

async function requireUniqueGlobalUid(
  transaction: MemoryDirectEvidenceReaderTransaction,
  query: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const rows = safeRows(await transaction.run(query, parameters));
  if (rows.length !== 1) fail("source_incomplete");
  const count = safeNonnegativeInteger(field(rows[0], "count"));
  if (count === undefined || count === 0) fail("source_incomplete");
  if (count !== 1) fail("identity_conflict");
}

async function readOwnerEdge(
  transaction: MemoryDirectEvidenceReaderTransaction,
  query: string,
  parameters: Record<string, unknown>,
  expectedLabels: readonly string[],
  expectedUidProperty: "project_uid" | "session_uid",
  expectedUid: string,
  expectedProjectUid?: string,
): Promise<void> {
  const rows = safeRows(await transaction.run(query, parameters));
  if (rows.length === 0) fail("source_incomplete");
  if (rows.length !== 1) fail("identity_conflict");
  const ownerLabels = field(rows[0], "owner_labels");
  const ownerProperties = field(rows[0], "owner_properties");
  const relationshipProperties = field(rows[0], "relationship_properties");
  if (
    !Array.isArray(ownerLabels) ||
    ownerLabels.some((label) => typeof label !== "string") ||
    !exactlyLabels(ownerLabels as string[], expectedLabels) ||
    !isRecord(ownerProperties) ||
    ownerProperties[expectedUidProperty] !== expectedUid ||
    (expectedProjectUid !== undefined && ownerProperties.project_uid !== expectedProjectUid) ||
    !emptyProperties(relationshipProperties)
  ) fail("identity_conflict");
}

async function rejectReverseEdges(
  transaction: MemoryDirectEvidenceReaderTransaction,
  query: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const rows = safeRows(await transaction.run(query, parameters));
  if (rows.length !== 0) fail("identity_conflict");
}

/**
 * Resolves one RawEvent only after the same registered-project marker, scoped-first node reads,
 * global UID counts, and bidirectional owner topology used by text evidence have been checked.
 * @internal
 */
export async function readRegisteredRawEventGraph(
  transaction: MemoryDirectEvidenceReaderTransaction,
  scope: ProjectOwnershipScope,
  project_uid: string,
  session_uid: string,
  event_uid: string,
): Promise<RegisteredRawEventGraph> {
  if (
    typeof project_uid !== "string" || !UUID_V4_OR_V5.test(project_uid) ||
    typeof session_uid !== "string" || !UUID_V4_OR_V5.test(session_uid) ||
    typeof event_uid !== "string" || !UUID_V4_OR_V5.test(event_uid)
  ) fail("evidence_invalid");

  const registeredProject = await findRegisteredProject(scope, project_uid);
  const project = await readSingleNode(
    transaction,
    "MATCH (p:Project {project_uid: $project_uid}) RETURN labels(p) AS labels, properties(p) AS properties",
    { project_uid },
    "identity_conflict",
  );
  if (
    !exactlyLabels(project.labels, ["Project"]) ||
    project.properties.project_uid !== project_uid ||
    project.properties.identity_fingerprint !== registeredProject.identity_fingerprint
  ) fail("identity_conflict");

  const session = await readSingleNode(
    transaction,
    "MATCH (s:Session {session_uid: $session_uid, project_uid: $project_uid}) RETURN labels(s) AS labels, properties(s) AS properties",
    { session_uid, project_uid },
    "identity_conflict",
  );
  if (
    !exactlyLabels(session.labels, ["Session"]) ||
    session.properties.session_uid !== session_uid ||
    session.properties.project_uid !== project_uid
  ) fail("identity_conflict");
  await requireUniqueGlobalUid(
    transaction,
    "MATCH (s:Session {session_uid: $session_uid}) RETURN count(s) AS count",
    { session_uid },
  );
  if (!Object.hasOwn(session.properties, "next_ingest_sequence")) fail("source_incomplete");
  const nextIngestSequence = safeNonnegativeInteger(session.properties.next_ingest_sequence);
  if (nextIngestSequence === undefined) fail("identity_conflict");

  const eventSnapshot = await readSingleNode(
    transaction,
    "MATCH (e:RawEvent {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid}) RETURN labels(e) AS labels, properties(e) AS properties",
    { event_uid, project_uid, session_uid },
    "evidence_invalid",
  );
  await requireUniqueGlobalUid(
    transaction,
    "MATCH (e:RawEvent {event_uid: $event_uid}) RETURN count(e) AS count",
    { event_uid },
  );
  await rejectReverseEdges(
    transaction,
    "MATCH (target:Session {session_uid: $session_uid, project_uid: $project_uid})-[r:HAS_SESSION]->(other) RETURN properties(r) AS relationship_properties",
    { session_uid, project_uid },
  );
  await readOwnerEdge(
    transaction,
    "MATCH (owner)-[r:HAS_SESSION]->(target:Session {session_uid: $session_uid, project_uid: $project_uid}) RETURN labels(owner) AS owner_labels, properties(owner) AS owner_properties, properties(r) AS relationship_properties",
    { session_uid, project_uid },
    ["Project"],
    "project_uid",
    project_uid,
  );
  await rejectReverseEdges(
    transaction,
    "MATCH (target:RawEvent {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid})-[r:HAS_EVENT]->(other) RETURN properties(r) AS relationship_properties",
    { event_uid, project_uid, session_uid },
  );
  await readOwnerEdge(
    transaction,
    "MATCH (owner)-[r:HAS_EVENT]->(target:RawEvent {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid}) RETURN labels(owner) AS owner_labels, properties(owner) AS owner_properties, properties(r) AS relationship_properties",
    { event_uid, project_uid, session_uid },
    ["Session"],
    "session_uid",
    session_uid,
    project_uid,
  );
  await rejectReverseEdges(
    transaction,
    "MATCH (owner)-[r:IN_PROJECT]->(source:RawEvent {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid}) RETURN properties(r) AS relationship_properties",
    { event_uid, project_uid, session_uid },
  );
  await readOwnerEdge(
    transaction,
    "MATCH (source:RawEvent {event_uid: $event_uid, project_uid: $project_uid, session_uid: $session_uid})-[r:IN_PROJECT]->(owner) RETURN labels(owner) AS owner_labels, properties(owner) AS owner_properties, properties(r) AS relationship_properties",
    { event_uid, project_uid, session_uid },
    ["Project"],
    "project_uid",
    project_uid,
  );

  return { registeredProject, eventSnapshot, nextIngestSequence };
}

/**
 * Reads a registered Project's external-user text evidence through the supplied transaction.
 * The scope must come from a trusted caller; this function does not authenticate it or turn the
 * underlying Neo4j credentials into tenant authorization. Filesystem registration and graph reads
 * are not atomically bound, so a later write must revalidate within its own transaction.
 */
export async function readRegisteredExternalUserTextEvidence(
  input: ReadRegisteredExternalUserTextEvidenceInput,
): Promise<RegisteredExternalUserTextEvidence> {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.transaction?.run !== "function"
  ) fail("evidence_invalid");
  const { transaction, scope, project_uid, session_uid, event_uid, span } = input;
  if (
    typeof project_uid !== "string" || !UUID_V4_OR_V5.test(project_uid) ||
    typeof session_uid !== "string" || !UUID_V4_OR_V5.test(session_uid) ||
    typeof event_uid !== "string" || !UUID_V4_OR_V5.test(event_uid)
  ) fail("evidence_invalid");

  const { registeredProject, eventSnapshot, nextIngestSequence } = await readRegisteredRawEventGraph(
    transaction,
    scope,
    project_uid,
    session_uid,
    event_uid,
  );
  let decoded: { event: CanonicalRawEvent; stored_fingerprint: string };
  try {
    decoded = decodeStoredExternalUserMessage({ labels: eventSnapshot.labels, properties: eventSnapshot.properties });
  } catch {
    fail("evidence_invalid");
  }
  if (
    decoded.event.event_uid !== event_uid ||
    decoded.event.project_uid !== project_uid ||
    decoded.event.session_uid !== session_uid
  ) fail("identity_conflict");
  if (decoded.event.ingest_sequence >= nextIngestSequence) fail("identity_conflict");

  let evidence: ExternalUserTextEvidence;
  try {
    evidence = verifyExternalUserTextEvidence({
      event: decoded.event,
      stored_fingerprint: decoded.stored_fingerprint,
      span,
    });
  } catch {
    fail("evidence_invalid");
  }

  return {
    ...evidence,
    principal_uid: registeredProject.principal_uid,
    identity_fingerprint: registeredProject.identity_fingerprint,
  };
}
