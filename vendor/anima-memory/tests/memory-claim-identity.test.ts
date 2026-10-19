import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import {
  decideModelSaveIdentity,
  MemoryClaimIdentityError,
  type ModelSaveIdentityInput,
} from "../src/index.ts";

const principal_uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other_principal_uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const project_uid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const other_project_uid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const event_uid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const other_event_uid = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function input(overrides: Partial<ModelSaveIdentityInput> = {}): ModelSaveIdentityInput {
  return {
    principal_uid,
    project_uid,
    subject: "work",
    kind: "claim",
    statement: "I prefer quiet mornings.",
    evidence_event_uids: [event_uid],
    existing: [],
    ...overrides,
  };
}

function keyFor(value: ModelSaveIdentityInput): string {
  return createHash("sha256")
    .update(
      canonicalize({
        principal_uid: value.principal_uid,
        applicability: { kind: "project", project_uid: value.project_uid },
        subject: value.subject.normalize("NFC").trim(),
        kind: value.kind,
        statement: value.statement.normalize("NFC").trim(),
      }),
      "utf8",
    )
    .digest("hex");
}

describe("decideModelSaveIdentity", () => {
  test("canonicalizes subject and statement with NFC and trimming", () => {
    const first = input({ subject: " cafe\u0301 ", statement: "  e\u0301vidence  " });
    const normalized = input({ subject: "café", statement: "évidence" });

    expect(decideModelSaveIdentity(first)).toEqual(decideModelSaveIdentity(normalized));
    expect(decideModelSaveIdentity(first).claim_key).toBe(keyFor(normalized));
  });

  test("scopes an otherwise identical claim to its principal and project", () => {
    const baseline = decideModelSaveIdentity(input());

    expect(decideModelSaveIdentity(input({ principal_uid: other_principal_uid })).claim_key).not.toBe(
      baseline.claim_key,
    );
    expect(decideModelSaveIdentity(input({ project_uid: other_project_uid })).claim_key).not.toBe(
      baseline.claim_key,
    );
  });

  test("blocks withdrawn matching evidence even when the decision is called again with fresh input", () => {
    const candidate = input({ evidence_event_uids: [event_uid] });
    const withdrawn = {
      claim_key: "0".repeat(64),
      status: "revoked" as const,
      evidence_event_uids: [event_uid],
    };

    expect(decideModelSaveIdentity({ ...candidate, existing: [withdrawn] })).toEqual({
      action: "blocked",
      reason: "withdrawn_lineage",
      claim_key: keyFor(candidate),
    });
  });

  test("keeps a withdrawn claim blocked even when a later event has a new UID", () => {
    const candidate = input({ evidence_event_uids: [other_event_uid] });
    const withdrawn = {
      claim_key: keyFor(candidate),
      status: "superseded" as const,
      evidence_event_uids: [event_uid],
    };

    expect(decideModelSaveIdentity({ ...candidate, existing: [withdrawn] })).toEqual({
      action: "blocked",
      reason: "withdrawn_lineage",
      claim_key: withdrawn.claim_key,
    });
  });

  test("allows unrelated evidence for another claim about the same subject", () => {
    const candidate = input({ statement: "I prefer written plans.", evidence_event_uids: [other_event_uid] });
    const unrelated = {
      claim_key: "1".repeat(64),
      status: "revoked" as const,
      evidence_event_uids: [event_uid],
    };

    expect(decideModelSaveIdentity({ ...candidate, existing: [unrelated] })).toEqual({
      action: "new",
      claim_key: keyFor(candidate),
    });
  });

  test("returns duplicate for active same-key claims unless withdrawn evidence blocks first", () => {
    const candidate = input();
    const active = { claim_key: keyFor(candidate), status: "active" as const, evidence_event_uids: [] };
    const tombstone = {
      claim_key: "2".repeat(64),
      status: "deleted" as const,
      evidence_event_uids: [event_uid],
    };

    expect(decideModelSaveIdentity({ ...candidate, existing: [active] })).toEqual({
      action: "duplicate",
      claim_key: active.claim_key,
    });
    expect(decideModelSaveIdentity({ ...candidate, existing: [active, tombstone] })).toEqual({
      action: "blocked",
      reason: "withdrawn_lineage",
      claim_key: active.claim_key,
    });
  });

  test("rejects malformed shape, UIDs, hashes, and duplicate identifiers", () => {
    const valid = input();
    const duplicateExisting = {
      claim_key: "3".repeat(64),
      status: "active" as const,
      evidence_event_uids: [],
    };

    const { statement: _statement, ...missingStatement } = valid;
    for (const invalid of [
      { ...valid, extra: true },
      missingStatement,
      { ...valid, principal_uid: "bbbbbbbb-bbbb-1bbb-8bbb-bbbbbbbbbbbb" },
      { ...valid, project_uid: project_uid.toUpperCase() },
      { ...valid, subject: " \t " },
      { ...valid, evidence_event_uids: ["not-a-uuid"] },
      { ...valid, evidence_event_uids: [event_uid, event_uid] },
      { ...valid, existing: [duplicateExisting, duplicateExisting] },
      { ...valid, existing: [{ ...duplicateExisting, claim_key: "ABC" }] },
      { ...valid, existing: [{ ...duplicateExisting, evidence_event_uids: [event_uid, event_uid] }] },
    ]) {
      expect(() => decideModelSaveIdentity(invalid)).toThrow(MemoryClaimIdentityError);
    }
  });

  test("does not mutate its input", () => {
    const value = input({
      existing: [{ claim_key: "4".repeat(64), status: "superseded", evidence_event_uids: [] }],
    });
    const before = structuredClone(value);

    decideModelSaveIdentity(value);

    expect(value).toEqual(before);
  });
});
