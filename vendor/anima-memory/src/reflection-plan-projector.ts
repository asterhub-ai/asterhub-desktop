import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import {
  buildAutomaticReflectionInput,
  buildManualCandidateReflectionInput,
} from "./reflection-input-projector.ts";
import type { ReflectionModelInput } from "./reflection-input-types.ts";
import {
  DAILY_REFLECTION_PROMPT_CONTRACT,
  MANUAL_REFLECTION_PROMPT_CONTRACT,
  MONTHLY_REFLECTION_PROMPT_CONTRACT,
  WEEKLY_REFLECTION_PROMPT_CONTRACT,
} from "./reflection-prompt.ts";
import { reflectionUid } from "./reflection-ids.ts";
import {
  REFLECTION_CONTRACT_VERSION,
  REFLECTION_SCHEMA_ID,
  REFLECTION_VERSION,
  type ReflectionOutput,
} from "./reflection-types.ts";
import { validateReflectionOutput, type ReflectionEvidenceScopeEvent } from "./reflection-projector.ts";
import {
  type ReflectionEvidencePlan,
  type ReflectionFacts,
  type ReflectionPersistencePlan,
} from "./reflection-persistence-types.ts";

export class ReflectionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectionPlanError";
  }
}

type ScopeEntry = {
  candidate_order: number;
  event_position: number;
};

type AutomaticReflectionPlanInput = {
  model_input: Extract<ReflectionModelInput, { reflection_kind: "daily" | "weekly" | "monthly" }>;
  prompt_contract_version: string;
  model_ref: string;
  response: unknown;
};

function fail(message: string): never {
  throw new ReflectionPlanError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireModelInputKind(input: unknown, allowedKinds: readonly ReflectionModelInput["reflection_kind"][]): void {
  if (!isRecord(input) || !isRecord(input.model_input)) {
    return fail("reflection plan input must contain a model_input object");
  }
  const kind = input.model_input.reflection_kind;
  if (typeof kind !== "string" || !allowedKinds.includes(kind as ReflectionModelInput["reflection_kind"])) {
    return fail("reflection plan input has an incompatible reflection kind");
  }
}

function requireTargetCardinality(plan: ReflectionPersistencePlan, kind: "manual" | "automatic"): void {
  const planKind = plan.facts.kind;
  if (kind === "manual" && planKind !== "manual") {
    return fail("manual reflection plans must have kind manual");
  }
  if (kind === "automatic" && planKind !== "daily" && planKind !== "weekly" && planKind !== "monthly") {
    return fail("automatic reflection plans must have a daily, weekly, or monthly kind");
  }
  if (!Array.isArray(plan.target_candidate_uids) || plan.target_candidate_uids.length === 0) {
    return fail("reflection plan must identify at least one target candidate");
  }
  if (new Set(plan.target_candidate_uids).size !== plan.target_candidate_uids.length) {
    return fail("reflection plan target candidate UIDs must be unique");
  }
  if (kind === "manual" && plan.target_candidate_uids.length !== 1) {
    return fail("manual reflection plans must identify exactly one target candidate");
  }
}

function canonical(value: unknown): string {
  return canonicalize(value as never);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function requireNonemptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${name} must be a nonempty string`);
  }
  return value;
}

function compositeKey(candidate_uid: string, event_uid: string): string {
  return `${candidate_uid}\u0000${event_uid}`;
}

function normalizeModelEvidenceOrder(
  response: unknown,
  entries: ReadonlyMap<string, ScopeEntry>,
): unknown {
  if (!isRecord(response)) return response;
  let normalizedRoot: Record<string, unknown> | undefined;

  const normalizeHolder = (holder: unknown): unknown => {
    if (!isRecord(holder) || !Array.isArray(holder.evidence)) return holder;
    let prior: ScopeEntry | undefined;
    let alreadyOrdered = true;
    for (const reference of holder.evidence) {
      if (!isRecord(reference) || typeof reference.candidate_uid !== "string" || typeof reference.event_uid !== "string") {
        return holder;
      }
      const entry = entries.get(compositeKey(reference.candidate_uid, reference.event_uid));
      if (entry === undefined) return holder;
      if (
        prior !== undefined &&
        (entry.candidate_order < prior.candidate_order ||
          (entry.candidate_order === prior.candidate_order && entry.event_position <= prior.event_position))
      ) {
        alreadyOrdered = false;
      }
      prior = entry;
    }
    if (alreadyOrdered) return holder;

    const evidence = [...holder.evidence].sort((left, right) => {
      const leftEntry = entries.get(compositeKey(left.candidate_uid as string, left.event_uid as string))!;
      const rightEntry = entries.get(compositeKey(right.candidate_uid as string, right.event_uid as string))!;
      return leftEntry.candidate_order - rightEntry.candidate_order ||
        leftEntry.event_position - rightEntry.event_position;
    });
    return { ...holder, evidence };
  };

  const overview = normalizeHolder(response.overview);
  if (overview !== response.overview) {
    normalizedRoot = { ...response };
    normalizedRoot.overview = overview;
  }
  for (const key of ["observations", "open_questions"] as const) {
    const holders = response[key];
    if (!Array.isArray(holders)) continue;
    let normalizedHolders: unknown[] | undefined;
    for (let index = 0; index < holders.length; index += 1) {
      const normalized = normalizeHolder(holders[index]);
      if (normalized !== holders[index]) {
        normalizedHolders ??= [...holders];
        normalizedHolders[index] = normalized;
      }
    }
    if (normalizedHolders !== undefined) {
      normalizedRoot ??= { ...response };
      normalizedRoot[key] = normalizedHolders;
    }
  }
  return normalizedRoot ?? response;
}

function expectedPromptContract(kind: ReflectionModelInput["reflection_kind"]): string {
  switch (kind) {
    case "manual":
      return MANUAL_REFLECTION_PROMPT_CONTRACT;
    case "daily":
      return DAILY_REFLECTION_PROMPT_CONTRACT;
    case "weekly":
      return WEEKLY_REFLECTION_PROMPT_CONTRACT;
    case "monthly":
      return MONTHLY_REFLECTION_PROMPT_CONTRACT;
  }
}

function rebuildReflectionInput(input: ReflectionModelInput): ReflectionModelInput {
  if (input.reflection_kind === "manual") {
    const digest = input.task_digests[0];
    if (digest === undefined || input.task_digests.length !== 1) {
      return fail("manual model_input must contain exactly one task digest");
    }
    return buildManualCandidateReflectionInput(digest);
  }
  return buildAutomaticReflectionInput(input.selector, input.task_digests);
}

function buildScope(model_input: ReflectionModelInput): {
  scope: ReflectionEvidenceScopeEvent[];
  entries: ReadonlyMap<string, ScopeEntry>;
} {
  const scope: ReflectionEvidenceScopeEvent[] = [];
  const entries = new Map<string, ScopeEntry>();
  for (let candidateOrder = 0; candidateOrder < model_input.task_digests.length; candidateOrder += 1) {
    const digest = model_input.task_digests[candidateOrder]!;
    for (const event of digest.events) {
      const item = {
        candidate_uid: digest.candidate_uid,
        event_uid: event.event_uid,
        candidate_order: candidateOrder,
        event_position: event.position,
      };
      scope.push(item);
      entries.set(compositeKey(item.candidate_uid, item.event_uid), item);
    }
  }
  if (scope.length === 0) {
    return fail("model_input evidence scope must be nonempty");
  }
  return { scope, entries };
}

function evidenceLinks(
  output: ReflectionOutput,
  entries: ReadonlyMap<string, ScopeEntry>,
): ReflectionEvidencePlan[] {
  const links: ReflectionEvidencePlan[] = [];
  const addSubject = (
    subject_path: string,
    evidence: readonly { candidate_uid: string; event_uid: string }[],
  ): void => {
    evidence.forEach((reference, evidence_index) => {
      const entry = entries.get(compositeKey(reference.candidate_uid, reference.event_uid));
      if (entry === undefined) {
        return fail(`validated evidence is missing from scope: ${subject_path}`);
      }
      links.push({
        candidate_uid: reference.candidate_uid,
        event_uid: reference.event_uid,
        candidate_position: entry.event_position,
        subject_path,
        evidence_index,
      });
    });
  };

  addSubject("overview", output.overview.evidence);
  for (const observation of output.observations) {
    addSubject(`observations/${observation.observation_uid}`, observation.evidence);
  }
  for (const question of output.open_questions) {
    addSubject(`open_questions/${question.question_uid}`, question.evidence);
  }
  return links;
}

function buildPlan(input: {
  model_input: ReflectionModelInput;
  prompt_contract_version: string;
  model_ref: string;
  response: unknown;
}, canonicalizeModelEvidence = false): ReflectionPersistencePlan {
  const suppliedModelInput = input.model_input;
  const rebuiltModelInput = rebuildReflectionInput(suppliedModelInput);
  if (canonical(rebuiltModelInput) !== canonical(suppliedModelInput)) {
    return fail("model_input does not match its deterministic projection");
  }

  const expectedContract = expectedPromptContract(rebuiltModelInput.reflection_kind);
  if (input.prompt_contract_version !== expectedContract) {
    return fail(`prompt_contract_version must be ${expectedContract}`);
  }
  const model_ref = requireNonemptyString(input.model_ref, "model_ref");
  const { scope, entries } = buildScope(rebuiltModelInput);
  const response = canonicalizeModelEvidence
    ? normalizeModelEvidenceOrder(input.response, entries)
    : input.response;
  const output = validateReflectionOutput(response, scope);
  const response_fingerprint = fingerprint(output);
  const reflection_uid = reflectionUid(
    rebuiltModelInput.reflection_kind,
    rebuiltModelInput.scope_fingerprint,
    rebuiltModelInput.input_fingerprint,
    REFLECTION_CONTRACT_VERSION,
    response_fingerprint,
  );
  const project_uid = rebuiltModelInput.task_digests[0]!.project_uid;

  const facts: ReflectionFacts = {
    reflection_uid,
    schema_id: REFLECTION_SCHEMA_ID,
    reflection_version: REFLECTION_VERSION,
    kind: rebuiltModelInput.reflection_kind,
    project_uid,
    scope_json: canonical(rebuiltModelInput.selector),
    scope_fingerprint: rebuiltModelInput.scope_fingerprint,
    input_projection_version: rebuiltModelInput.input_projection_version,
    input_fingerprint: rebuiltModelInput.input_fingerprint,
    reflection_contract_version: REFLECTION_CONTRACT_VERSION,
    prompt_contract_version: input.prompt_contract_version,
    model_ref,
    response_fingerprint,
    overview_json: canonical(output.overview),
    observations_json: canonical(output.observations),
    open_questions_json: canonical(output.open_questions),
  };

  return {
    facts,
    target_candidate_uids: rebuiltModelInput.task_digests.map((digest) => digest.candidate_uid),
    evidence_links: evidenceLinks(output, entries),
    output,
  };
}

export function buildReflectionPlan(input: {
  model_input: ReflectionModelInput;
  prompt_contract_version: string;
  model_ref: string;
  response: unknown;
}): ReflectionPersistencePlan {
  try {
    return buildPlan(input);
  } catch (error) {
    if (error instanceof ReflectionPlanError) throw error;
    const message = error instanceof Error ? error.message : "invalid reflection persistence input";
    throw new ReflectionPlanError(message);
  }
}

export function buildManualReflectionPlan(input: {
  model_input: Extract<ReflectionModelInput, { reflection_kind: "manual" }>;
  prompt_contract_version: string;
  model_ref: string;
  response: unknown;
}): ReflectionPersistencePlan {
  try {
    requireModelInputKind(input, ["manual"]);
    const plan = buildReflectionPlan(input);
    requireTargetCardinality(plan, "manual");
    return plan;
  } catch (error) {
    if (error instanceof ReflectionPlanError) throw error;
    const message = error instanceof Error ? error.message : "invalid manual reflection persistence input";
    throw new ReflectionPlanError(message);
  }
}

export function buildAutomaticReflectionPlan(input: AutomaticReflectionPlanInput): ReflectionPersistencePlan {
  try {
    requireModelInputKind(input, ["daily", "weekly", "monthly"]);
    const plan = buildReflectionPlan(input);
    requireTargetCardinality(plan, "automatic");
    return plan;
  } catch (error) {
    if (error instanceof ReflectionPlanError) throw error;
    const message = error instanceof Error ? error.message : "invalid automatic reflection persistence input";
    throw new ReflectionPlanError(message);
  }
}

export function projectAutomaticReflectionModelPlan(
  input: AutomaticReflectionPlanInput,
): ReflectionPersistencePlan {
  try {
    requireModelInputKind(input, ["daily", "weekly", "monthly"]);
    const plan = buildPlan(input, true);
    requireTargetCardinality(plan, "automatic");
    return plan;
  } catch (error) {
    if (error instanceof ReflectionPlanError) throw error;
    const message = error instanceof Error ? error.message : "invalid automatic reflection persistence input";
    throw new ReflectionPlanError(message);
  }
}
