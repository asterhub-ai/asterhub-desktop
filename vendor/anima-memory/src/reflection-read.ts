import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import neo4j from "neo4j-driver";
import { reflectionUid } from "./reflection-ids.ts";
import { REFLECTION_NODE_KEYS } from "./reflection-neo4j-materializer.ts";
import { REFLECTION_EVIDENCE_SCHEMA_ID, REFLECTION_TARGET_SCHEMA_ID } from "./reflection-persistence-types.ts";
import { validateReflectionOutput } from "./reflection-projector.ts";
import { REFLECTION_SCHEMA_ID, type ReflectionKind, type ReflectionOutput } from "./reflection-types.ts";
import type { ProjectReflectionSummary } from "./types.ts";

type RecordValue = Record<string, unknown>;
type Row = { get(key: string): unknown };
export interface ReflectionReadTransaction {
  run(query: string, parameters: Record<string, unknown>): Promise<{ records: Row[] }>;
}
export class ReflectionReadError extends Error {
  constructor(readonly code: "invalid_input" | "identity_conflict") {
    super("Reflection graph is unavailable or inconsistent.");
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const KINDS = ["manual", "daily", "weekly", "monthly"] as const;
function fail(): never { throw new ReflectionReadError("identity_conflict"); }
function obj(value: unknown): value is RecordValue { return value !== null && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : undefined;
  if (obj(value) && typeof value.toNumber === "function") {
    const converted = value.toNumber();
    return typeof converted === "number" && Number.isSafeInteger(converted) ? converted : undefined;
  }
  return undefined;
}
function exact(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function rowValue(row: Row, key: string): unknown { return row.get(key); }
function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || text.length > 1_048_576) fail();
  try { return JSON.parse(text); } catch { return fail(); }
}
function validInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}
function decodeOutput(properties: RecordValue): ReflectionOutput {
  const overview = parseJson(properties.overview_json);
  const observations = parseJson(properties.observations_json);
  const open_questions = parseJson(properties.open_questions_json);
  if (!obj(overview) || !Array.isArray(observations) || !Array.isArray(open_questions) ||
      observations.length > 64 || open_questions.length > 32) fail();
  return { overview, observations, open_questions } as unknown as ReflectionOutput;
}
function references(output: ReflectionOutput): Array<{ path: string; index: number; candidate_uid: string; event_uid: string }> {
  const subjects: Array<{ path: string; value: unknown }> = [{ path: "overview", value: output.overview }];
  for (const observation of output.observations) {
    if (!obj(observation) || typeof observation.observation_uid !== "string") fail();
    subjects.push({ path: `observations/${observation.observation_uid}`, value: observation });
  }
  for (const question of output.open_questions) {
    if (!obj(question) || typeof question.question_uid !== "string") fail();
    subjects.push({ path: `open_questions/${question.question_uid}`, value: question });
  }
  const result: Array<{ path: string; index: number; candidate_uid: string; event_uid: string }> = [];
  for (const { path, value } of subjects) {
    if (!obj(value) || !Array.isArray(value.evidence) || value.evidence.length === 0) fail();
    value.evidence.forEach((ref: unknown, index) => {
      if (!obj(ref) || !exact(ref, ["candidate_uid", "event_uid"]) ||
          typeof ref.candidate_uid !== "string" || !UUID.test(ref.candidate_uid) ||
          typeof ref.event_uid !== "string" || !UUID.test(ref.event_uid)) fail();
      result.push({ path, index, candidate_uid: ref.candidate_uid, event_uid: ref.event_uid });
    });
  }
  return result;
}

function candidateRanks(
  refs: readonly { path: string; candidate_uid: string }[],
  candidates: ReadonlyMap<string, string>,
): Map<string, number> {
  const edges = new Map([...candidates.keys()].map((uid) => [uid, new Set<string>()]));
  const indegree = new Map([...candidates.keys()].map((uid) => [uid, 0]));
  const lastByPath = new Map<string, string>();
  for (const ref of refs) {
    if (!candidates.has(ref.candidate_uid)) fail();
    const previous = lastByPath.get(ref.path);
    if (previous !== undefined && previous !== ref.candidate_uid && !edges.get(previous)!.has(ref.candidate_uid)) {
      edges.get(previous)!.add(ref.candidate_uid);
      indegree.set(ref.candidate_uid, indegree.get(ref.candidate_uid)! + 1);
    }
    lastByPath.set(ref.path, ref.candidate_uid);
  }
  const result = new Map<string, number>();
  while (result.size < candidates.size) {
    const next = [...indegree.entries()].filter(([uid, degree]) => degree === 0 && !result.has(uid))
      .map(([uid]) => uid).sort()[0];
    if (next === undefined) fail();
    result.set(next, result.size);
    for (const uid of edges.get(next)!) indegree.set(uid, indegree.get(uid)! - 1);
  }
  return result;
}

/** Caller must have verified this Project's filesystem ownership and graph fingerprint. */
export async function readScopedProjectReflections(
  transaction: ReflectionReadTransaction,
  input: { project_uid: string; limit: number; now: string },
  verifyCandidate: (candidate_uid: string) => Promise<{ project_uid: string; session_uid: string; event_uids: ReadonlySet<string> }>,
): Promise<ProjectReflectionSummary[]> {
  if (!UUID.test(input.project_uid) || !Number.isSafeInteger(input.limit) || input.limit < 0 || input.limit > 5 || !validInstant(input.now)) {
    throw new ReflectionReadError("invalid_input");
  }
  if (input.limit === 0) return [];
  const cutoff = new Date(Date.parse(input.now) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await transaction.run(
    `MATCH (r:Reflection {project_uid: $project_uid})
     WITH r, CASE WHEN r.created_at ENDS WITH '[UTC]'
       THEN left(r.created_at, size(r.created_at) - 5) ELSE r.created_at END AS created_at
     WHERE created_at >= $cutoff AND created_at <= $now
     RETURN labels(r) AS labels, keys(r) AS keys, properties(r) AS properties
     ORDER BY created_at DESC, r.reflection_uid ASC LIMIT $limit`,
    { ...input, limit: neo4j.int(input.limit), cutoff },
  );
  if (result.records.length > input.limit) fail();
  const summaries: ProjectReflectionSummary[] = [];
  for (const record of result.records) {
    const labels = rowValue(record, "labels");
    const keys = rowValue(record, "keys");
    const properties = rowValue(record, "properties");
    const createdAt = obj(properties) && typeof properties.created_at === "string"
      ? properties.created_at.replace(/\[UTC\]$/u, "") : undefined;
    if (!Array.isArray(labels) || labels.length !== 1 || labels[0] !== "Reflection" ||
        !Array.isArray(keys) || !keys.every((key) => typeof key === "string") ||
        keys.length !== REFLECTION_NODE_KEYS.length || !REFLECTION_NODE_KEYS.every((key) => keys.includes(key)) ||
        !obj(properties) || !exact(properties, REFLECTION_NODE_KEYS) ||
        properties.schema_id !== REFLECTION_SCHEMA_ID || properties.project_uid !== input.project_uid ||
        !validInstant(createdAt) || createdAt > input.now || createdAt < cutoff ||
        typeof properties.kind !== "string" || !KINDS.includes(properties.kind as ReflectionKind) ||
        typeof properties.reflection_uid !== "string" || !UUID.test(properties.reflection_uid) ||
        typeof properties.scope_fingerprint !== "string" || !HASH.test(properties.scope_fingerprint) ||
        typeof properties.input_fingerprint !== "string" || !HASH.test(properties.input_fingerprint) ||
        typeof properties.response_fingerprint !== "string" || !HASH.test(properties.response_fingerprint) ||
        typeof properties.reflection_contract_version !== "string") fail();
    const selector = parseJson(properties.scope_json);
    if (!obj(selector) || (properties.kind === "manual"
      ? selector.kind !== "candidate" || typeof selector.candidate_uid !== "string" || !UUID.test(selector.candidate_uid)
      : selector.project_uid !== input.project_uid)) fail();
    const output = decodeOutput(properties);
    const responseFingerprint = createHash("sha256").update(canonicalize(output as never), "utf8").digest("hex");
    if (responseFingerprint !== properties.response_fingerprint || reflectionUid(
      properties.kind as ReflectionKind, properties.scope_fingerprint, properties.input_fingerprint,
      properties.reflection_contract_version, responseFingerprint,
    ) !== properties.reflection_uid) fail();
    const targets = await transaction.run(
      `MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:REFLECTS_ON]->(c)
       RETURN labels(c) AS labels, properties(c) AS candidate, properties(link) AS link`,
      { reflection_uid: properties.reflection_uid },
    );
    const candidates = new Map<string, string>();
    const candidateEvents = new Map<string, ReadonlySet<string>>();
    for (const target of targets.records) {
      const targetLabels = rowValue(target, "labels");
      const candidate = rowValue(target, "candidate");
      const link = rowValue(target, "link");
      if (!Array.isArray(targetLabels) || targetLabels.length !== 1 || targetLabels[0] !== "ExecutionReviewCandidate" ||
          !obj(candidate) || !obj(link) || !exact(link, ["schema_id"]) || link.schema_id !== REFLECTION_TARGET_SCHEMA_ID ||
          typeof candidate.candidate_uid !== "string" || !UUID.test(candidate.candidate_uid) ||
          typeof candidate.session_uid !== "string" || !UUID.test(candidate.session_uid) ||
          !["ready", "leased", "reviewed", "skipped"].includes(String(candidate.state)) ||
          candidate.project_uid !== input.project_uid || candidates.has(candidate.candidate_uid)) fail();
      const verified = await verifyCandidate(candidate.candidate_uid);
      if (verified.project_uid !== input.project_uid || verified.session_uid !== candidate.session_uid) fail();
      candidateEvents.set(candidate.candidate_uid, verified.event_uids);
      candidates.set(candidate.candidate_uid, candidate.session_uid);
    }
    if (candidates.size === 0 || (properties.kind === "manual" &&
      (candidates.size !== 1 || !candidates.has((selector as RecordValue).candidate_uid as string)))) fail();
    const evidence = await transaction.run(
      `MATCH (r:Reflection {reflection_uid: $reflection_uid})-[link:EVIDENCED_BY]->(event)
       RETURN labels(event) AS labels, properties(event) AS event, properties(link) AS link`,
      { reflection_uid: properties.reflection_uid },
    );
    const refs = references(output);
    if (evidence.records.length !== refs.length) fail();
    const expected = new Map(refs.map((ref) => [`${ref.path}\u0000${ref.index}`, ref]));
    if (expected.size !== refs.length) fail();
    const candidateOrder = candidateRanks(refs, candidates);
    const scope: Array<{ candidate_uid: string; event_uid: string; candidate_order: number; event_position: number }> = [];
    const scopePositions = new Map<string, number>();
    for (const evidenceRow of evidence.records) {
      const evidenceLabels = rowValue(evidenceRow, "labels");
      const event = rowValue(evidenceRow, "event");
      const link = rowValue(evidenceRow, "link");
      if (!Array.isArray(evidenceLabels) || !evidenceLabels.includes("RawEvent") || !obj(event) || !obj(link) ||
          !exact(link, ["schema_id", "subject_path", "evidence_index", "candidate_position"]) ||
          link.schema_id !== REFLECTION_EVIDENCE_SCHEMA_ID || typeof link.subject_path !== "string" ||
          integer(link.evidence_index) === undefined || integer(link.evidence_index)! < 0 ||
          integer(link.candidate_position) === undefined || integer(link.candidate_position)! < 0) fail();
      const key = `${link.subject_path}\u0000${integer(link.evidence_index)}`;
      const ref = expected.get(key);
      if (ref === undefined || event.event_uid !== ref.event_uid || event.project_uid !== input.project_uid ||
          event.session_uid !== candidates.get(ref.candidate_uid) ||
          candidateEvents.get(ref.candidate_uid)?.has(ref.event_uid) !== true) fail();
      expected.delete(key);
      const matched = await transaction.run(
        `MATCH (c:ExecutionReviewCandidate {candidate_uid: $candidate_uid})-[edge:EVIDENCED_BY]->
         (event:RawEvent {event_uid: $event_uid}) RETURN count(edge) AS count, collect(edge.position) AS positions`,
        { candidate_uid: ref.candidate_uid, event_uid: ref.event_uid },
      );
      const matchedRow = matched.records[0];
      const positions = matchedRow === undefined ? undefined : rowValue(matchedRow, "positions");
      if (matchedRow === undefined || integer(rowValue(matchedRow, "count")) !== 1 ||
          !Array.isArray(positions) || positions.length !== 1 ||
          integer(positions[0]) !== integer(link.candidate_position)) fail();
      const pair = `${ref.candidate_uid}\u0000${ref.event_uid}`;
      const position = integer(link.candidate_position)!;
      const prior = scopePositions.get(pair);
      if (prior !== undefined && prior !== position) fail();
      if (prior === undefined) {
        scopePositions.set(pair, position);
        scope.push({ candidate_uid: ref.candidate_uid, event_uid: ref.event_uid,
          candidate_order: candidateOrder.get(ref.candidate_uid)!, event_position: position });
      }
    }
    if (expected.size !== 0) fail();
    try { validateReflectionOutput(output, scope); } catch { fail(); }
    summaries.push({ reflection_uid: properties.reflection_uid, kind: properties.kind as ReflectionKind,
      created_at: createdAt, overview: output.overview.text });
  }
  return summaries;
}
