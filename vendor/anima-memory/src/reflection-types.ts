export const REFLECTION_VERSION = "v1" as const;
export const REFLECTION_CONTRACT_VERSION = "v1" as const;
export const REFLECTION_SCHEMA_ID = "anima.reflection/v1.0" as const;

export type ReflectionKind = "daily" | "weekly" | "monthly" | "manual";
export type ReflectionObservationKind =
  | "theme"
  | "friction"
  | "improvement"
  | "hypothesis"
  | "practice";

export interface ReflectionEvidenceReference {
  candidate_uid: string;
  event_uid: string;
}

export interface ReflectionOverview {
  text: string;
  readonly evidence: readonly ReflectionEvidenceReference[];
}

export interface ReflectionObservation {
  observation_uid: string;
  kind: ReflectionObservationKind;
  text: string;
  readonly evidence: readonly ReflectionEvidenceReference[];
}

export interface ReflectionOpenQuestion {
  question_uid: string;
  text: string;
  readonly evidence: readonly ReflectionEvidenceReference[];
}

export interface ReflectionOutput {
  overview: ReflectionOverview;
  readonly observations: readonly ReflectionObservation[];
  readonly open_questions: readonly ReflectionOpenQuestion[];
}
