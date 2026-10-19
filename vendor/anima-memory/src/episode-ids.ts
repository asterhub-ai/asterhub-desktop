import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import type { EpisodeKind, EpisodeState } from "./episode-types.ts";

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type EpisodeClosureKind = "work_validated" | "personal_explicit";

function assertCanonicalUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a canonical lowercase UUID.`);
  }
}

function assertEpisodeKind(value: unknown): asserts value is EpisodeKind {
  if (value !== "work" && value !== "personal") {
    throw new TypeError("episode_kind must be work or personal.");
  }
}

function assertEpisodeState(value: unknown): asserts value is EpisodeState {
  if (value !== "open" && value !== "suspended" && value !== "stable_ended") {
    throw new TypeError("target_state must be open, suspended, or stable_ended.");
  }
}

function assertRevision(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("target_revision must be a safe nonnegative integer.");
  }
}

export function episodeUid(projectUid: string, firstWindowUid: string): string {
  assertCanonicalUuid(projectUid, "projectUid");
  assertCanonicalUuid(firstWindowUid, "firstWindowUid");
  return uuidV5FromParts(["anima.episode", "v1", projectUid, firstWindowUid]);
}

export interface EpisodeDecisionUidInput {
  episode_uid: string;
  episode_kind: EpisodeKind;
  target_revision: number;
  ordered_window_uids: readonly [string, ...string[]];
  target_state: EpisodeState;
  closure_kind_or_null: EpisodeClosureKind | null;
  checkpoint_event_uid_or_null: string | null;
  validation_result_event_uid_or_null: string | null;
  validation_event_uid_or_null: string | null;
}
const EPISODE_DECISION_KEYS = [
  "episode_uid",
  "episode_kind",
  "target_revision",
  "ordered_window_uids",
  "target_state",
  "closure_kind_or_null",
  "checkpoint_event_uid_or_null",
  "validation_result_event_uid_or_null",
  "validation_event_uid_or_null",
] as const;

function assertEpisodeDecisionInput(value: unknown): asserts value is EpisodeDecisionUidInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("episodeDecisionUid input must be an object.");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== EPISODE_DECISION_KEYS.length ||
    keys.some((key) => !(EPISODE_DECISION_KEYS as readonly string[]).includes(key)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError("episodeDecisionUid input must contain exactly the declared fields.");
  }
}

export function episodeDecisionUid(input: EpisodeDecisionUidInput): string {
  assertEpisodeDecisionInput(input);
  assertCanonicalUuid(input.episode_uid, "episode_uid");
  assertEpisodeKind(input.episode_kind);
  assertRevision(input.target_revision);
  assertEpisodeState(input.target_state);

  if (!Array.isArray(input.ordered_window_uids) || input.ordered_window_uids.length === 0) {
    throw new TypeError("ordered_window_uids must be a nonempty list.");
  }
  for (const [index, windowUid] of input.ordered_window_uids.entries()) {
    assertCanonicalUuid(windowUid, `ordered_window_uids[${index}]`);
  }
  if (new Set(input.ordered_window_uids).size !== input.ordered_window_uids.length) {
    throw new TypeError("ordered_window_uids must not contain duplicates.");
  }

  const {
    closure_kind_or_null,
    checkpoint_event_uid_or_null,
    validation_result_event_uid_or_null,
    validation_event_uid_or_null,
  } = input;

  if (closure_kind_or_null !== null && closure_kind_or_null !== "work_validated" && closure_kind_or_null !== "personal_explicit") {
    throw new TypeError("closure_kind_or_null must be work_validated, personal_explicit, or null.");
  }
  if (closure_kind_or_null === "work_validated" && input.episode_kind !== "work") {
    throw new TypeError("work_validated closure requires a work Episode.");
  }
  if (closure_kind_or_null === "personal_explicit" && input.episode_kind !== "personal") {
    throw new TypeError("personal_explicit closure requires a personal Episode.");
  }
  if (checkpoint_event_uid_or_null !== null) {
    assertCanonicalUuid(checkpoint_event_uid_or_null, "checkpoint_event_uid_or_null");
  }
  if (validation_result_event_uid_or_null !== null) {
    assertCanonicalUuid(validation_result_event_uid_or_null, "validation_result_event_uid_or_null");
  }
  if (validation_event_uid_or_null !== null) {
    assertCanonicalUuid(validation_event_uid_or_null, "validation_event_uid_or_null");
  }

  if (input.target_state === "stable_ended") {
    if (closure_kind_or_null === null || checkpoint_event_uid_or_null === null) {
      throw new TypeError("stable_ended decisions require closure and checkpoint evidence.");
    }
    if (closure_kind_or_null === "work_validated" && (validation_result_event_uid_or_null === null || validation_event_uid_or_null === null)) {
      throw new TypeError("work_validated decisions require validation result and validation evidence.");
    }
    if (closure_kind_or_null === "personal_explicit" && (validation_result_event_uid_or_null !== null || validation_event_uid_or_null !== null)) {
      throw new TypeError("personal_explicit decisions cannot include validation evidence.");
    }
  } else if (
    closure_kind_or_null !== null ||
    checkpoint_event_uid_or_null !== null ||
    validation_result_event_uid_or_null !== null ||
    validation_event_uid_or_null !== null
  ) {
    throw new TypeError("non-stable_ended decisions cannot include closure evidence.");
  }

  return uuidV5FromParts([
    "anima.episode-decision",
    "v1",
    input.episode_uid,
    input.episode_kind,
    input.target_revision,
    [...input.ordered_window_uids],
    input.target_state,
    input.closure_kind_or_null,
    input.checkpoint_event_uid_or_null,
    input.validation_result_event_uid_or_null,
    input.validation_event_uid_or_null,
  ]);
}
