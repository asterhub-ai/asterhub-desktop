export interface TrustedIdentity {
  principal_uid: string;
}

export interface PersonalityIdentityUids {
  principal_uid: string;
  personality_uid: string;
}

export type PersonalityRuleType = "identity" | "core_value" | "safety_rail";
export type PersonalityAnchorValueType = "numeric" | "qualitative" | "immutable";

export interface PersonalityRuleInput {
  rule_type: PersonalityRuleType;
  name: string;
  content: string;
}

export interface PersonalityAnchorInput {
  name: string;
  dimension: string;
  value_type?: PersonalityAnchorValueType;
  initial_value: string;
  drift_threshold?: number;
}

export interface PersonalityInitInput {
  rules: readonly PersonalityRuleInput[];
  anchors: readonly PersonalityAnchorInput[];
}

export interface PersonalityRule {
  rule_type: PersonalityRuleType;
  name: string;
  content: string;
  sort_order: number;
}

export type PersonalityValue = number | string;

export interface PersonalityTrajectoryEntry {
  at: string;
  from: PersonalityValue | null;
  to: PersonalityValue;
  reason: string;
}

export interface PersonalityAnchor {
  name: string;
  dimension: string;
  value_type: PersonalityAnchorValueType;
  current_value: PersonalityValue;
  drift_threshold: number;
  evolution_trajectory: readonly PersonalityTrajectoryEntry[];
  last_checked: string;
}

export interface ValidatedPersonalityInit {
  rules: readonly PersonalityRule[];
  anchors: readonly PersonalityAnchor[];
  rules_json: string;
  anchors_json: string;
  created_at: string;
  updated_at: string;
}

export interface PersonalityAggregateSnapshot extends PersonalityIdentityUids {
  rules_json: string;
  anchors_json: string;
  created_at: string;
  updated_at: string;
  rules: readonly PersonalityRule[];
  anchors: readonly PersonalityAnchor[];
}

export type PersonalityFailureCode =
  | "unauthorized"
  | "unavailable"
  | "invalid_input"
  | "already_initialized"
  | "not_initialized"
  | "anchor_not_found"
  | "immutable_anchor"
  | "identity_conflict"
  | "database_error"
  | "write_outcome_unknown"
  | "core_closed";

export interface PersonalityFailure {
  status: "failed";
  code: PersonalityFailureCode;
  message: string;
}

export type PersonalityStatusResult = { initialized: boolean } | PersonalityFailure;

export type PersonalityInitResult =
  | { action: "init_commit"; rules: number; anchors: number }
  | PersonalityFailure;

export type PersonalityAnchorUpdateResult =
  | { action: "anchor_update"; name: string; old_value: number; new_value: number }
  | PersonalityFailure;

export type PersonalityReadResult =
  | { status: "uninitialized" }
  | { status: "initialized"; immutable_rules: readonly PersonalityRule[]; anchors: readonly PersonalityAnchor[] }
  | PersonalityFailure;

export type PersonalityResult =
  | PersonalityStatusResult
  | PersonalityInitResult
  | PersonalityAnchorUpdateResult
  | PersonalityReadResult;

export type PersonalityValidationErrorCode = "invalid_input" | "identity_conflict" | "anchor_not_found" | "immutable_anchor";

export class PersonalityValidationError extends Error {
  readonly code: PersonalityValidationErrorCode;

  constructor(code: PersonalityValidationErrorCode, message: string) {
    super(message);
    this.name = "PersonalityValidationError";
    this.code = code;
  }
}
