import type { ReflectionKind, ReflectionOutput } from "./reflection-types.ts";

export const REFLECTION_TARGET_SCHEMA_ID = "anima.reflection-target/v1.0" as const;
export const REFLECTION_EVIDENCE_SCHEMA_ID = "anima.reflection-evidence/v1.0" as const;

export interface ReflectionFacts {
  reflection_uid: string;
  schema_id: string;
  reflection_version: string;
  kind: ReflectionKind;
  project_uid: string;
  scope_json: string;
  scope_fingerprint: string;
  input_projection_version: string;
  input_fingerprint: string;
  reflection_contract_version: string;
  prompt_contract_version: string;
  model_ref: string;
  response_fingerprint: string;
  overview_json: string;
  observations_json: string;
  open_questions_json: string;
}

export interface ReflectionEvidencePlan {
  candidate_uid: string;
  event_uid: string;
  candidate_position: number;
  subject_path: string;
  evidence_index: number;
}

export interface ReflectionPersistencePlan {
  facts: ReflectionFacts;
  readonly target_candidate_uids: readonly string[];
  readonly evidence_links: readonly ReflectionEvidencePlan[];
  output: ReflectionOutput;
}
