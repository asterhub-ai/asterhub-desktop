import {
  REFLECTION_EVIDENCE_SCHEMA_ID,
  REFLECTION_TARGET_SCHEMA_ID,
  type ReflectionEvidencePlan,
  type ReflectionFacts,
  type ReflectionPersistencePlan,
} from "./reflection-persistence-types.ts";

type QueryRecord = { get(key: string): unknown };
type QueryResult = { records: readonly QueryRecord[] };
export type ReflectionTransaction = {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
};

export type ReflectionMaterializationErrorCode = "not_found" | "identity_conflict";

export class ReflectionMaterializationError extends Error {
  readonly code: ReflectionMaterializationErrorCode;

  constructor(code: ReflectionMaterializationErrorCode, message: string) {
    super(message);
    this.name = "ReflectionMaterializationError";
    this.code = code;
  }
}

export type ReflectionMaterializationResult =
  | { status: "materialized"; reflection_uid: string; evidence_count: number }
  | { status: "up_to_date"; reflection_uid: string; evidence_count: number };

const FACT_KEYS = [
  "reflection_uid",
  "schema_id",
  "reflection_version",
  "kind",
  "project_uid",
  "scope_json",
  "scope_fingerprint",
  "input_projection_version",
  "input_fingerprint",
  "reflection_contract_version",
  "prompt_contract_version",
  "model_ref",
  "response_fingerprint",
  "overview_json",
  "observations_json",
  "open_questions_json",
] as const satisfies readonly (keyof ReflectionFacts)[];
const NODE_KEYS = [...FACT_KEYS, "created_at"] as const;
export const REFLECTION_NODE_KEYS: readonly string[] = NODE_KEYS;

function field(record: QueryRecord | undefined, key: string): unknown {
  return record?.get(key);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : undefined;
  }
  if (value !== null && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const converted = value.toNumber();
    return typeof converted === "number" && Number.isFinite(converted) ? converted : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function fail(code: ReflectionMaterializationErrorCode, message: string): never {
  throw new ReflectionMaterializationError(code, message);
}
function factsProperties(facts: ReflectionFacts): Record<string, unknown> {
  if (!exactKeys(facts as unknown as Record<string, unknown>, FACT_KEYS)) {
    return fail("identity_conflict", "Reflection facts contain unsupported properties.");
  }
  return Object.fromEntries(FACT_KEYS.map((key) => [key, facts[key]]));
}

function expectedEvidenceKey(link: ReflectionEvidencePlan): string {
  return JSON.stringify([link.candidate_uid, link.event_uid, link.candidate_position, link.subject_path, link.evidence_index]);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function actualEvidenceKey(event_uid: unknown, relation: unknown, candidate_uid: string): string | undefined {
  if (typeof event_uid !== "string" || !isRecord(relation) || !exactKeys(relation, [
    "schema_id",
    "subject_path",
    "evidence_index",
    "candidate_position",
  ])) return undefined;
  const candidate_position = numberValue(relation.candidate_position);
  const evidence_index = numberValue(relation.evidence_index);
  if (
    relation.schema_id !== REFLECTION_EVIDENCE_SCHEMA_ID ||
    typeof relation.subject_path !== "string" ||
    candidate_position === undefined ||
    !isSafeNonnegativeInteger(candidate_position) ||
    evidence_index === undefined ||
    !isSafeNonnegativeInteger(evidence_index)
  ) return undefined;
  return JSON.stringify([candidate_uid, event_uid, candidate_position, relation.subject_path, evidence_index]);
}

function validatePlan(plan: ReflectionPersistencePlan): {
  facts: ReflectionFacts;
  target_candidate_uids: readonly string[];
  evidence_links: readonly ReflectionEvidencePlan[];
} {
  if (!isRecord(plan) || !isRecord(plan.facts)) {
    fail("identity_conflict", "Reflection persistence plan is malformed.");
  }
  const facts = plan.facts as ReflectionFacts;
  const target_candidate_uids = plan.target_candidate_uids;
  const evidence_links = plan.evidence_links;
  if (facts.kind !== "manual" && facts.kind !== "daily" && facts.kind !== "weekly" && facts.kind !== "monthly") {
    fail("identity_conflict", "Reflection persistence plan has an unsupported kind.");
  }
  if (!Array.isArray(target_candidate_uids) || target_candidate_uids.length === 0) {
    fail("identity_conflict", "Reflection persistence plan must identify at least one target candidate.");
  }
  if (facts.kind === "manual" && target_candidate_uids.length !== 1) {
    fail("identity_conflict", "Manual reflection persistence plans must identify exactly one target candidate.");
  }
  if (target_candidate_uids.some((candidate_uid) => !isCanonicalUuid(candidate_uid))) {
    fail("identity_conflict", "Reflection target candidate UID is not a canonical lowercase UUID.");
  }
  if (new Set(target_candidate_uids).size !== target_candidate_uids.length) {
    fail("identity_conflict", "Reflection target candidate UIDs must be unique.");
  }
  if (!Array.isArray(evidence_links)) {
    fail("identity_conflict", "Reflection persistence plan evidence links are malformed.");
  }
  const targetSet = new Set(target_candidate_uids);
  for (const evidence of evidence_links) {
    if (
      !isRecord(evidence) ||
      !isCanonicalUuid(evidence.candidate_uid) ||
      !targetSet.has(evidence.candidate_uid) ||
      !isCanonicalUuid(evidence.event_uid) ||
      !isSafeNonnegativeInteger(evidence.candidate_position) ||
      typeof evidence.subject_path !== "string" ||
      !isSafeNonnegativeInteger(evidence.evidence_index)
    ) {
      fail("identity_conflict", "Reflection evidence link conflicts with the persistence plan.");
    }
  }
  return { facts, target_candidate_uids, evidence_links };
}

function validateManualPlanBoundary(plan: unknown): asserts plan is ReflectionPersistencePlan {
  if (!isRecord(plan) || !isRecord(plan.facts)) {
    fail("identity_conflict", "Manual reflection persistence plan is malformed.");
  }
  if (plan.facts.kind !== "manual") {
    fail("identity_conflict", "Manual reflection persistence plans must have kind manual.");
  }
  const target_candidate_uids = plan.target_candidate_uids;
  if (
    !Array.isArray(target_candidate_uids) ||
    target_candidate_uids.length !== 1 ||
    new Set(target_candidate_uids).size !== 1
  ) {
    fail("identity_conflict", "Manual reflection persistence plans must identify exactly one unique target candidate.");
  }
}

async function verifyCandidateAndSource(
  transaction: ReflectionTransaction,
  plan: ReflectionPersistencePlan,
  target_candidate_uids: readonly string[],
  evidence_links: readonly ReflectionEvidencePlan[],
): Promise<void> {
  for (const target_uid of target_candidate_uids) {
    const candidateResult = await transaction.run(
      `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
       RETURN count(c) AS count, collect(c.project_uid) AS project_uids`,
      { candidate_uid: target_uid },
    );
    const candidateRecord = candidateResult.records[0];
    const candidateCount = numberValue(field(candidateRecord, "count"));
    const projectUids = field(candidateRecord, "project_uids");
    if (candidateCount === 0) fail("not_found", "Reflection target candidate was not found.");
    if (
      candidateCount !== 1 ||
      !Array.isArray(projectUids) ||
      projectUids.length !== 1 ||
      projectUids[0] !== plan.facts.project_uid
    ) {
      fail("identity_conflict", "Reflection target candidate identity conflicts with the persistence plan.");
    }
  }

  for (const evidence of evidence_links) {
    const evidenceResult = await transaction.run(
      `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
             -[r:EVIDENCED_BY {position: $candidate_position}]->
             (event:RawEvent {event_uid: $event_uid})
       RETURN count(r) AS count`,
      {
        candidate_uid: evidence.candidate_uid,
        candidate_position: evidence.candidate_position,
        event_uid: evidence.event_uid,
      },
    );
    if (numberValue(field(evidenceResult.records[0], "count")) !== 1) {
      fail("identity_conflict", "Reflection evidence source conflicts with the persistence plan.");
    }
  }
}

async function readExisting(transaction: ReflectionTransaction, reflection_uid: string): Promise<{ keys: unknown; properties: unknown } | undefined> {
  const result = await transaction.run(
    `MATCH (r:Reflection {reflection_uid: $reflection_uid})
     RETURN keys(r) AS keys, properties(r) AS properties`,
    { reflection_uid },
  );
  if (result.records.length === 0) return undefined;
  if (result.records.length !== 1) fail("identity_conflict", "Reflection identity is duplicated.");
  return { keys: field(result.records[0], "keys"), properties: field(result.records[0], "properties") };
}

function verifyNode(existing: { keys: unknown; properties: unknown }, facts: ReflectionFacts): void {
  const keys = existing.keys;
  const properties = existing.properties;
  if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === "string") || !exactKeys(Object.fromEntries(keys.map((key) => [key, true])), NODE_KEYS)) {
    fail("identity_conflict", "Reflection node properties conflict with the persistence plan.");
  }
  if (!isRecord(properties) || typeof properties.created_at !== "string" || properties.created_at.length === 0) {
    fail("identity_conflict", "Reflection node properties conflict with the persistence plan.");
  }
  for (const key of FACT_KEYS) {
    if (properties[key] !== facts[key]) fail("identity_conflict", "Reflection node properties conflict with the persistence plan.");
  }
}

async function verifyTopology(
  transaction: ReflectionTransaction,
  plan: ReflectionPersistencePlan,
  target_candidate_uids: readonly string[],
  evidence_links: readonly ReflectionEvidencePlan[],
): Promise<void> {
  const targetResult = await transaction.run(
    `MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:REFLECTS_ON]->(candidate)
     RETURN labels(candidate) AS labels, candidate.candidate_uid AS candidate_uid, properties(link) AS relation`,
    { reflection_uid: plan.facts.reflection_uid },
  );
  if (targetResult.records.length !== target_candidate_uids.length) {
    fail("identity_conflict", "Reflection target topology conflicts with the persistence plan.");
  }
  const expectedTargets = new Set(target_candidate_uids);
  const actualTargets = new Map<string, number>();
  for (const target of targetResult.records) {
    const labels = field(target, "labels");
    const candidate_uid = field(target, "candidate_uid");
    const relation = field(target, "relation");
    if (
      !Array.isArray(labels) ||
      !labels.includes("ExecutionReviewCandidate") ||
      typeof candidate_uid !== "string" ||
      !expectedTargets.has(candidate_uid) ||
      !isRecord(relation) ||
      !exactKeys(relation, ["schema_id"]) ||
      relation.schema_id !== REFLECTION_TARGET_SCHEMA_ID
    ) {
      fail("identity_conflict", "Reflection target topology conflicts with the persistence plan.");
    }
    actualTargets.set(candidate_uid, (actualTargets.get(candidate_uid) ?? 0) + 1);
  }
  if (
    actualTargets.size !== expectedTargets.size ||
    [...expectedTargets].some((candidate_uid) => actualTargets.get(candidate_uid) !== 1)
  ) {
    fail("identity_conflict", "Reflection target topology conflicts with the persistence plan.");
  }

  const evidenceResult = await transaction.run(
    `MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:EVIDENCED_BY]->(event)
     RETURN labels(event) AS labels, event.event_uid AS event_uid, properties(link) AS relation`,
    { reflection_uid: plan.facts.reflection_uid },
  );
  if (evidenceResult.records.length !== evidence_links.length) {
    fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
  }
  const expected = new Map<string, number>();
  for (const link of evidence_links) {
    const key = expectedEvidenceKey(link);
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  for (const record of evidenceResult.records) {
    const labels = field(record, "labels");
    const event_uid = field(record, "event_uid");
    const relation = field(record, "relation");
    if (!Array.isArray(labels) || !labels.includes("RawEvent")) {
      fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
    }
    if (typeof event_uid !== "string" || !isRecord(relation)) {
      fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
    }
    const candidate_position = numberValue(relation.candidate_position);
    if (candidate_position === undefined || !isSafeNonnegativeInteger(candidate_position)) {
      fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
    }
    const sourceResult = await transaction.run(
      `MATCH (candidate:ExecutionReviewCandidate)-[:EVIDENCED_BY {position: $candidate_position}]->
             (event:RawEvent {event_uid: $event_uid})
       WHERE candidate.candidate_uid IN $candidate_uids
       RETURN collect(candidate.candidate_uid) AS candidate_uids`,
      {
        candidate_position,
        event_uid,
        candidate_uids: target_candidate_uids,
      },
    );
    const sourceCandidateUids = field(sourceResult.records[0], "candidate_uids");
    if (!Array.isArray(sourceCandidateUids) || sourceCandidateUids.length !== 1 || typeof sourceCandidateUids[0] !== "string") {
      fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
    }
    const key = actualEvidenceKey(event_uid, relation, sourceCandidateUids[0]);
    if (key === undefined) fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
    const remaining = expected.get(key) ?? 0;
    if (remaining === 0) fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
    if (remaining === 1) expected.delete(key);
    else expected.set(key, remaining - 1);
  }
  if (expected.size !== 0) fail("identity_conflict", "Reflection evidence topology conflicts with the persistence plan.");
}

export async function materializeReflectionPlan(
  transaction: ReflectionTransaction,
  plan: ReflectionPersistencePlan,
): Promise<ReflectionMaterializationResult> {
  const validated = validatePlan(plan);
  const { facts, target_candidate_uids, evidence_links } = validated;
  if (!isCanonicalUuid(facts.reflection_uid) || !isCanonicalUuid(facts.project_uid)) {
    fail("identity_conflict", "Reflection facts contain a non-canonical UUID.");
  }
  const properties = factsProperties(facts);
  await verifyCandidateAndSource(transaction, plan, target_candidate_uids, evidence_links);

  const existing = await readExisting(transaction, facts.reflection_uid);
  if (existing !== undefined) {
    verifyNode(existing, facts);
    await verifyTopology(transaction, plan, target_candidate_uids, evidence_links);
    return { status: "up_to_date", reflection_uid: facts.reflection_uid, evidence_count: evidence_links.length };
  }

  await transaction.run(
    `CREATE (r:Reflection)
     SET r = $properties, r.created_at = toString(datetime({timezone: "UTC"}))`,
    { properties },
  );
  for (const candidate_uid of target_candidate_uids) {
    await transaction.run(
      `MATCH (r:Reflection {reflection_uid: $reflection_uid}),
            (candidate:ExecutionReviewCandidate {candidate_uid: $candidate_uid})
       CREATE (r)-[:REFLECTS_ON {schema_id: $schema_id}]->(candidate)`,
      { reflection_uid: facts.reflection_uid, candidate_uid, schema_id: REFLECTION_TARGET_SCHEMA_ID },
    );
  }
  for (const evidence of evidence_links) {
    await transaction.run(
      `MATCH (r:Reflection {reflection_uid: $reflection_uid}),
            (event:RawEvent {event_uid: $event_uid})
       CREATE (r)-[:EVIDENCED_BY {
         schema_id: $schema_id,
         subject_path: $subject_path,
         evidence_index: $evidence_index,
         candidate_position: $candidate_position
       }]->(event)`,
      { reflection_uid: facts.reflection_uid, ...evidence, schema_id: REFLECTION_EVIDENCE_SCHEMA_ID },
    );
  }
  return { status: "materialized", reflection_uid: facts.reflection_uid, evidence_count: evidence_links.length };
}

export async function materializeManualReflectionPlan(
  transaction: ReflectionTransaction,
  plan: ReflectionPersistencePlan,
): Promise<ReflectionMaterializationResult> {
  try {
    validateManualPlanBoundary(plan);
  } catch (error) {
    if (error instanceof ReflectionMaterializationError) throw error;
    const message = error instanceof Error ? error.message : "invalid manual reflection persistence plan";
    throw new ReflectionMaterializationError("identity_conflict", message);
  }
  return materializeReflectionPlan(transaction, plan);
}
