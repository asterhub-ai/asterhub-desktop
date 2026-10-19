import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLAIM_KEY_PATTERN = /^[0-9a-f]{64}$/;
const INPUT_FIELDS = [
  "principal_uid",
  "project_uid",
  "subject",
  "kind",
  "statement",
  "evidence_event_uids",
  "existing",
] as const;
const EXISTING_FIELDS = ["claim_key", "status", "evidence_event_uids"] as const;
const CLAIM_KINDS: Record<string, true> = {
  shared_experience: true,
  claim: true,
  strategy: true,
  commitment: true,
};
const EXISTING_STATUSES: Record<string, true> = {
  active: true,
  superseded: true,
  revoked: true,
  deleted: true,
};
const WITHDRAWN_STATUSES: Record<string, true> = { superseded: true, revoked: true, deleted: true };

type ModelSaveClaimKind = "shared_experience" | "claim" | "strategy" | "commitment";
type ExistingModelSaveClaimStatus = "active" | "superseded" | "revoked" | "deleted";

type ExistingModelSaveClaim = {
  claim_key: string;
  status: ExistingModelSaveClaimStatus;
  evidence_event_uids: string[];
};

export type ModelSaveIdentityInput = {
  principal_uid: string;
  project_uid: string;
  subject: string;
  kind: ModelSaveClaimKind;
  statement: string;
  evidence_event_uids: string[];
  existing: ExistingModelSaveClaim[];
};

export type ModelSaveIdentityResult =
  | { action: "blocked"; reason: "withdrawn_lineage"; claim_key: string }
  | { action: "duplicate"; claim_key: string }
  | { action: "new"; claim_key: string };

export class MemoryClaimIdentityError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "MemoryClaimIdentityError";
  }
}

function fail(message: string): never {
  throw new MemoryClaimIdentityError(message);
}

function assertRecordWithExactFields(
  value: unknown,
  fields: readonly string[],
  name: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${name} must be a plain object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) {
    fail(`${name} must contain exactly: ${fields.join(", ")}.`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail(`${name}.${field} is required.`);
    }
  }
}

function assertUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    fail(`${name} must be a canonical lowercase UUID.`);
  }
}

function assertUuidV4(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    fail(`${name} must be a canonical lowercase UUIDv4.`);
  }
}

function assertUniqueUuidArray(value: unknown, name: string, nonempty: boolean): asserts value is string[] {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    fail(`${name} must be ${nonempty ? "a nonempty" : "an"} array of unique canonical lowercase UUIDs.`);
  }
  const seen = new Set<string>();
  for (const uid of value) {
    assertUuid(uid, `${name} item`);
    if (seen.has(uid)) {
      fail(`${name} must not contain duplicate UIDs.`);
    }
    seen.add(uid);
  }
}

function validateInput(input: unknown): asserts input is ModelSaveIdentityInput {
  assertRecordWithExactFields(input, INPUT_FIELDS, "input");
  assertUuidV4(input.principal_uid, "principal_uid");
  assertUuid(input.project_uid, "project_uid");

  for (const field of ["subject", "statement"] as const) {
    const value = input[field];
    if (typeof value !== "string" || value.normalize("NFC").trim().length === 0) {
      fail(`${field} must be a nonempty string after NFC normalization and trimming.`);
    }
  }
  if (typeof input.kind !== "string" || !Object.hasOwn(CLAIM_KINDS, input.kind)) {
    fail("kind must be shared_experience, claim, strategy, or commitment.");
  }
  assertUniqueUuidArray(input.evidence_event_uids, "evidence_event_uids", true);
  if (!Array.isArray(input.existing)) {
    fail("existing must be an array.");
  }
  const claimKeys = new Set<string>();
  for (let index = 0; index < input.existing.length; index += 1) {
    const existing = input.existing[index];
    const name = `existing[${index}]`;
    assertRecordWithExactFields(existing, EXISTING_FIELDS, name);
    if (typeof existing.claim_key !== "string" || !CLAIM_KEY_PATTERN.test(existing.claim_key)) {
      fail(`${name}.claim_key must be a 64-character lowercase SHA-256 hash.`);
    }
    if (claimKeys.has(existing.claim_key)) {
      fail("existing must not contain duplicate claim_key values.");
    }
    claimKeys.add(existing.claim_key);
    if (typeof existing.status !== "string" || !Object.hasOwn(EXISTING_STATUSES, existing.status)) {
      fail(`${name}.status must be active, superseded, revoked, or deleted.`);
    }
    assertUniqueUuidArray(existing.evidence_event_uids, `${name}.evidence_event_uids`, false);
  }
}

export function decideModelSaveIdentity(input: unknown): ModelSaveIdentityResult {
  validateInput(input);

  const subject = input.subject.normalize("NFC").trim();
  const statement = input.statement.normalize("NFC").trim();
  const claim_key = createHash("sha256")
    .update(
      canonicalize({
        principal_uid: input.principal_uid,
        applicability: { kind: "project", project_uid: input.project_uid },
        subject,
        kind: input.kind,
        statement,
      }),
      "utf8",
    )
    .digest("hex");
  const newEvidence = new Set(input.evidence_event_uids);

  if (
    input.existing.some(
      (existing) =>
        Object.hasOwn(WITHDRAWN_STATUSES, existing.status) &&
        (existing.claim_key === claim_key || existing.evidence_event_uids.some((uid) => newEvidence.has(uid))),
    )
  ) {
    return { action: "blocked", reason: "withdrawn_lineage", claim_key };
  }
  if (input.existing.some((existing) => existing.status === "active" && existing.claim_key === claim_key)) {
    return { action: "duplicate", claim_key };
  }
  return { action: "new", claim_key };
}
