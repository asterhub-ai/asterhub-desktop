import type {
  ReflectionEvidenceReference,
  ReflectionObservationKind,
  ReflectionOutput,
} from "./reflection-types.ts";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBSERVATION_UID = /^o[1-9][0-9]*$/;
const QUESTION_UID = /^q[1-9][0-9]*$/;
const OBSERVATION_KINDS: readonly ReflectionObservationKind[] = [
  "theme",
  "friction",
  "improvement",
  "hypothesis",
  "practice",
];

export class ReflectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectionValidationError";
  }
}

export interface ReflectionEvidenceScopeEvent {
  candidate_uid: string;
  event_uid: string;
  candidate_order: number;
  event_position: number;
}

interface ScopeEntry {
  candidate_order: number;
  event_position: number;
}

function fail(message: string): never {
  throw new ReflectionValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compositeKey(candidateUid: string, eventUid: string): string {
  return `${candidateUid}\u0000${eventUid}`;
}

function validateScope(scope: readonly ReflectionEvidenceScopeEvent[]): ReadonlyMap<string, ScopeEntry> {
  if (!Array.isArray(scope) || scope.length === 0) {
    return fail("scope must be nonempty");
  }

  const entries = new Map<string, ScopeEntry>();
  const candidateOrders = new Map<string, number>();
  const orderCandidates = new Map<number, string>();

  for (let index = 0; index < scope.length; index += 1) {
    const item: unknown = scope[index];
    if (!isRecord(item)) {
      return fail(`scope[${index}] must be an object`);
    }
    if (!isCanonicalUuid(item.candidate_uid)) {
      return fail(`scope[${index}].candidate_uid must be a canonical lowercase UUID`);
    }
    if (!isCanonicalUuid(item.event_uid)) {
      return fail(`scope[${index}].event_uid must be a canonical lowercase UUID`);
    }
    if (!isSafeNonnegativeInteger(item.candidate_order)) {
      return fail(`scope[${index}].candidate_order must be a nonnegative safe integer`);
    }
    if (!isSafeNonnegativeInteger(item.event_position)) {
      return fail(`scope[${index}].event_position must be a nonnegative safe integer`);
    }

    const key = compositeKey(item.candidate_uid, item.event_uid);
    if (entries.has(key)) {
      return fail(`scope[${index}] duplicates a candidate/event pair`);
    }

    const priorOrder = candidateOrders.get(item.candidate_uid);
    if (priorOrder !== undefined && priorOrder !== item.candidate_order) {
      return fail(`candidate ${item.candidate_uid} has conflicting candidate_order values`);
    }
    const priorCandidate = orderCandidates.get(item.candidate_order);
    if (priorCandidate !== undefined && priorCandidate !== item.candidate_uid) {
      return fail(`candidate_order ${item.candidate_order} belongs to multiple candidates`);
    }

    candidateOrders.set(item.candidate_uid, item.candidate_order);
    orderCandidates.set(item.candidate_order, item.candidate_uid);
    entries.set(key, {
      candidate_order: item.candidate_order,
      event_position: item.event_position,
    });
  }

  return entries;
}

function validateText(value: unknown, maxLength: number, name: string): string {
  if (typeof value !== "string" || value.length > maxLength) {
    return fail(`${name} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function validateEvidence(
  value: unknown,
  scope: ReadonlyMap<string, ScopeEntry>,
  name: string,
): ReflectionEvidenceReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    return fail(`${name} must be a nonempty array`);
  }

  const result: ReflectionEvidenceReference[] = [];
  const seen = new Set<string>();
  let prior: ScopeEntry | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (!isRecord(item) || !hasExactKeys(item, ["candidate_uid", "event_uid"])) {
      return fail(`${name}[${index}] must contain exactly candidate_uid and event_uid`);
    }
    if (!isCanonicalUuid(item.candidate_uid) || !isCanonicalUuid(item.event_uid)) {
      return fail(`${name}[${index}] must contain canonical lowercase UUIDs`);
    }

    const key = compositeKey(item.candidate_uid, item.event_uid);
    if (seen.has(key)) {
      return fail(`${name}[${index}] duplicates an evidence pair`);
    }
    const entry = scope.get(key);
    if (entry === undefined) {
      return fail(`${name}[${index}] is outside the evidence scope`);
    }
    if (
      prior !== undefined &&
      (entry.candidate_order < prior.candidate_order ||
        (entry.candidate_order === prior.candidate_order && entry.event_position <= prior.event_position))
    ) {
      return fail(`${name} must be strictly ordered by candidate_order and event_position`);
    }

    seen.add(key);
    prior = entry;
    result.push({ candidate_uid: item.candidate_uid, event_uid: item.event_uid });
  }
  return result;
}

function isObservationKind(value: unknown): value is ReflectionObservationKind {
  return typeof value === "string" && OBSERVATION_KINDS.includes(value as ReflectionObservationKind);
}

export function validateReflectionOutput(
  value: unknown,
  scope: readonly ReflectionEvidenceScopeEvent[],
): ReflectionOutput {
  const evidenceScope = validateScope(scope);
  if (!isRecord(value) || !hasExactKeys(value, ["overview", "observations", "open_questions"])) {
    return fail("output must contain exactly overview, observations, and open_questions");
  }

  if (!isRecord(value.overview) || !hasExactKeys(value.overview, ["text", "evidence"])) {
    return fail("overview must contain exactly text and evidence");
  }
  const overviewText = validateText(value.overview.text, 4000, "overview.text");
  const overviewEvidence = validateEvidence(value.overview.evidence, evidenceScope, "overview.evidence");

  if (!Array.isArray(value.observations) || value.observations.length > 64) {
    return fail("observations must be an array of at most 64 items");
  }
  const observationUids = new Set<string>();
  const observations = value.observations.map((item, index) => {
    if (!isRecord(item) || !hasExactKeys(item, ["observation_uid", "kind", "text", "evidence"])) {
      return fail(`observations[${index}] has an invalid shape`);
    }
    if (typeof item.observation_uid !== "string" || !OBSERVATION_UID.test(item.observation_uid)) {
      return fail(`observations[${index}].observation_uid is invalid`);
    }
    if (observationUids.has(item.observation_uid)) {
      return fail(`observations[${index}].observation_uid is duplicated`);
    }
    observationUids.add(item.observation_uid);
    if (!isObservationKind(item.kind)) {
      return fail(`observations[${index}].kind is invalid`);
    }
    return {
      observation_uid: item.observation_uid,
      kind: item.kind,
      text: validateText(item.text, 1000, `observations[${index}].text`),
      evidence: validateEvidence(item.evidence, evidenceScope, `observations[${index}].evidence`),
    };
  });

  if (!Array.isArray(value.open_questions) || value.open_questions.length > 32) {
    return fail("open_questions must be an array of at most 32 items");
  }
  const questionUids = new Set<string>();
  const openQuestions = value.open_questions.map((item, index) => {
    if (!isRecord(item) || !hasExactKeys(item, ["question_uid", "text", "evidence"])) {
      return fail(`open_questions[${index}] has an invalid shape`);
    }
    if (typeof item.question_uid !== "string" || !QUESTION_UID.test(item.question_uid)) {
      return fail(`open_questions[${index}].question_uid is invalid`);
    }
    if (questionUids.has(item.question_uid)) {
      return fail(`open_questions[${index}].question_uid is duplicated`);
    }
    questionUids.add(item.question_uid);
    return {
      question_uid: item.question_uid,
      text: validateText(item.text, 1000, `open_questions[${index}].text`),
      evidence: validateEvidence(item.evidence, evidenceScope, `open_questions[${index}].evidence`),
    };
  });

  return {
    overview: { text: overviewText, evidence: overviewEvidence },
    observations,
    open_questions: openQuestions,
  };
}
