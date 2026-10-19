import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { automaticReflectionSelector, compareInstants, selectorContains } from "./reflection-calendar.ts";
import { projectTaskDigest } from "./task-digest-projector.ts";
import type {
  TaskDigest,
  TaskDigestContentOmission,
  TaskDigestEvent,
  TaskDigestInitiator,
  TaskDigestTerminal,
  TaskDigestUnsettledToolCall,
} from "./task-digest-types.ts";
import {
  REFLECTION_INPUT_PROJECTION_VERSION,
  type AutomaticReflectionInput,
  type ManualCandidateReflectionInput,
} from "./reflection-input-types.ts";
import type { AutomaticReflectionSelector } from "./reflection-calendar.ts";

const AUTOMATIC_SELECTOR_KEYS = ["kind", "project_uid", "timezone", "period_key", "start_at", "end_at"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateAutomaticSelector(value: unknown): asserts value is AutomaticReflectionSelector {
  if (!isRecord(value)) {
    throw new TypeError("selector must be a non-array object");
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...AUTOMATIC_SELECTOR_KEYS].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError("selector must contain exactly the canonical calendar keys");
  }
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value as never), "utf8").digest("hex");
}

function cloneTaskDigestInput(digest: TaskDigest) {
  return {
    candidate_uid: digest.candidate_uid,
    execution_uid: digest.execution_uid,
    project_uid: digest.project_uid,
    session_uid: digest.session_uid,
    source_fingerprint: digest.source_fingerprint,
    terminal: { ...digest.terminal } satisfies TaskDigestTerminal,
    initiator: { ...digest.initiator } satisfies TaskDigestInitiator,
    events: digest.events.map((event) => ({ ...event }) satisfies TaskDigestEvent),
    unsettled_tool_calls: digest.unsettled_tool_calls.map((item) => ({ ...item }) satisfies TaskDigestUnsettledToolCall),
    content_omissions: digest.content_omissions.map((omission) => ({ ...omission }) satisfies TaskDigestContentOmission),
  };
}

export function buildManualCandidateReflectionInput(digest: TaskDigest): ManualCandidateReflectionInput {
  const validatedDigest = projectTaskDigest(cloneTaskDigestInput(digest));
  const selector = {
    kind: "candidate" as const,
    candidate_uid: validatedDigest.candidate_uid,
  };
  const task_digests: readonly [TaskDigest] = [validatedDigest];
  const fingerprintPayload = {
    reflection_kind: "manual" as const,
    input_projection_version: REFLECTION_INPUT_PROJECTION_VERSION,
    selector,
    task_digests,
  };

  return {
    reflection_kind: "manual",
    input_projection_version: REFLECTION_INPUT_PROJECTION_VERSION,
    input_fingerprint: sha256Canonical(fingerprintPayload),
    scope_fingerprint: sha256Canonical(selector),
    selector,
    task_digests,
  };
}

export function buildAutomaticReflectionInput(
  selector: AutomaticReflectionSelector,
  digests: readonly TaskDigest[],
): AutomaticReflectionInput {
  validateAutomaticSelector(selector);
  const canonicalSelector = automaticReflectionSelector(selector.project_uid, selector.kind, selector.period_key);
  if (canonicalize(selector as never) !== canonicalize(canonicalSelector as never)) {
    throw new TypeError("selector does not match its deterministic calendar projection");
  }
  if (!Array.isArray(digests) || digests.length === 0) {
    throw new TypeError("digests must be nonempty");
  }

  const candidateUids = new Set<string>();
  const projected = digests.map((digest) => {
    const validatedDigest = projectTaskDigest(cloneTaskDigestInput(digest));
    if (candidateUids.has(validatedDigest.candidate_uid)) {
      throw new TypeError(`duplicate candidate UID: ${validatedDigest.candidate_uid}`);
    }
    candidateUids.add(validatedDigest.candidate_uid);
    if (validatedDigest.project_uid !== canonicalSelector.project_uid) {
      throw new TypeError(`digest project does not match selector: ${validatedDigest.candidate_uid}`);
    }
    if (!selectorContains(canonicalSelector, validatedDigest.terminal.captured_at)) {
      throw new TypeError(`digest terminal is outside selector window: ${validatedDigest.candidate_uid}`);
    }
    return validatedDigest;
  });

  projected.sort((left, right) => {
    const instantOrder = compareInstants(left.terminal.captured_at, right.terminal.captured_at);
    if (instantOrder !== 0) return instantOrder;
    if (left.candidate_uid === right.candidate_uid) return 0;
    return left.candidate_uid < right.candidate_uid ? -1 : 1;
  });
  const [firstDigest, ...remainingDigests] = projected;
  if (firstDigest === undefined) {
    throw new TypeError("digests must be nonempty");
  }
  const task_digests: readonly [TaskDigest, ...TaskDigest[]] = [firstDigest, ...remainingDigests];
  const fingerprintPayload = {
    reflection_kind: canonicalSelector.kind,
    input_projection_version: REFLECTION_INPUT_PROJECTION_VERSION,
    selector: canonicalSelector,
    task_digests,
  };
  return {
    reflection_kind: canonicalSelector.kind,
    input_projection_version: REFLECTION_INPUT_PROJECTION_VERSION,
    input_fingerprint: sha256Canonical(fingerprintPayload),
    scope_fingerprint: sha256Canonical(canonicalSelector),
    selector: canonicalSelector,
    task_digests,
  };
}
