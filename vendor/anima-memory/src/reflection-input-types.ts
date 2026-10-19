import type { AutomaticReflectionKind, AutomaticReflectionSelector } from "./reflection-calendar.ts";
import type { TaskDigest } from "./task-digest-types.ts";

export const REFLECTION_INPUT_PROJECTION_VERSION = "v1" as const;

export interface ManualCandidateReflectionSelector {
  kind: "candidate";
  candidate_uid: string;
}

export interface ManualCandidateReflectionInput {
  reflection_kind: "manual";
  input_projection_version: "v1";
  input_fingerprint: string;
  scope_fingerprint: string;
  selector: ManualCandidateReflectionSelector;
  readonly task_digests: readonly [TaskDigest];
}

export interface AutomaticReflectionInput {
  reflection_kind: AutomaticReflectionKind;
  input_projection_version: "v1";
  input_fingerprint: string;
  scope_fingerprint: string;
  selector: AutomaticReflectionSelector;
  readonly task_digests: readonly [TaskDigest, ...TaskDigest[]];
}

export type ReflectionModelInput = ManualCandidateReflectionInput | AutomaticReflectionInput;
