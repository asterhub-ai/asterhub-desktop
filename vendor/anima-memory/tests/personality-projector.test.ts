import { describe, expect, test } from "vitest";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import { canonicalize } from "json-canonicalize";
import {
  REQUIRED_PERSONALITY_ANCHORS,
  buildPersonalityAggregateSnapshot,
  derivePersonalityUids,
  parsePersonalityAggregate,
  projectPersonality,
  projectPersonalityAnchorUpdate,
  renderPersonalityContext,
  renderRecentPersonalityTexture,
  validatePersonalityInitInput,
} from "../src/personality-projector.ts";
import {
  PersonalityValidationError,
  type PersonalityAnchorInput,
  type PersonalityAggregateSnapshot,
  type PersonalityInitInput,
  type PersonalityValidationErrorCode,
  type TrustedIdentity,
} from "../src/personality-types.ts";

const AT_1 = "2026-09-23T10:00:00.000Z";
const AT_2 = "2026-09-23T10:05:00.000Z";
const TENANT: TrustedIdentity = { principal_uid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

function validInit(extras: readonly PersonalityAnchorInput[] = []): PersonalityInitInput {
  return {
    rules: [
      { rule_type: "identity", name: "称呼", content: "使用用户确认的称呼。" },
      { rule_type: "core_value", name: "", content: "以事实和安全规则优先。" },
      { rule_type: "safety_rail", name: "", content: "不得泄露密钥。" },
    ],
    anchors: [
      ...REQUIRED_PERSONALITY_ANCHORS.map(({ name, dimension }) => ({ name, dimension, initial_value: "0.5" })),
      ...extras,
    ],
  };
}

function buildSnapshot(input: PersonalityInitInput = validInit()): PersonalityAggregateSnapshot {
  return buildPersonalityAggregateSnapshot(TENANT, input, AT_1);
}

function nodeProperties(snapshot: PersonalityAggregateSnapshot): Record<string, unknown> {
  return {
    personality_uid: snapshot.personality_uid,
    principal_uid: snapshot.principal_uid,
    rules_json: snapshot.rules_json,
    anchors_json: snapshot.anchors_json,
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at,
  };
}

function expectCode(operation: () => unknown, code: PersonalityValidationErrorCode): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(PersonalityValidationError);
  expect((error as PersonalityValidationError).code).toBe(code);
}

function changedAnchors(
  snapshot: PersonalityAggregateSnapshot,
  mutate: (anchors: Record<string, unknown>[]) => void,
): Record<string, unknown> {
  const node = nodeProperties(snapshot);
  const anchors = JSON.parse(snapshot.anchors_json) as Record<string, unknown>[];
  mutate(anchors);
  node.anchors_json = canonicalize(anchors as never);
  return node;
}

describe("personality identity and initialization projection", () => {
  test("derives stable v2 graph UIDs from UUIDv4 principals", () => {
    const principalUid = TENANT.principal_uid;
    const expected = {
      principal_uid: principalUid,
      personality_uid: uuidV5FromParts(["anima.personality", "v2", principalUid]),
    };
    expect(derivePersonalityUids(TENANT)).toEqual(expected);
    expect(derivePersonalityUids({ principal_uid: principalUid })).toEqual(expected);

    const otherPrincipal = derivePersonalityUids({ principal_uid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(otherPrincipal.personality_uid).not.toBe(expected.personality_uid);
    expect(otherPrincipal.principal_uid).not.toBe(principalUid);
  });

  test("rejects malformed principals and extra trusted identity fields", () => {
    expectCode(() => derivePersonalityUids({ principal_uid: "not-a-uuid" }), "invalid_input");
    expectCode(() => derivePersonalityUids({ principal_uid: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" }), "invalid_input");
    expectCode(() => derivePersonalityUids({ principal_uid: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }), "invalid_input");
    expectCode(() => derivePersonalityUids({ ...TENANT, legacy: true } as never), "invalid_input");
  });

  test("normalizes seven required anchors, all rule categories, and deterministic JSON", () => {
    const normalized = validatePersonalityInitInput(validInit([
      { name: "名字", dimension: "身份", value_type: "immutable", initial_value: "墨墨" },
      { name: "表达习惯", dimension: "表达", value_type: "qualitative", initial_value: "温和" },
    ]), AT_1);
    expect(normalized.rules.map((rule) => rule.rule_type)).toEqual(["identity", "core_value", "safety_rail"]);
    expect(normalized.rules.map((rule) => rule.sort_order)).toEqual([0, 1, 2]);
    expect(normalized.anchors).toHaveLength(9);
    expect(normalized.anchors.map(({ dimension, name }) => `${dimension}\u0000${name}`)).toEqual(
      [...normalized.anchors]
        .map(({ dimension, name }) => `${dimension}\u0000${name}`)
        .sort(),
    );
    expect(normalized.rules_json).toBe(canonicalize(JSON.parse(normalized.rules_json) as never));
    expect(normalized.anchors_json).toBe(canonicalize(JSON.parse(normalized.anchors_json) as never));
    expect(normalized.anchors.every((anchor) => anchor.drift_threshold === 0.15)).toBe(true);
    expect(normalized.anchors.every((anchor) => anchor.evolution_trajectory[0]?.reason === "init")).toBe(true);
    expect(normalized.anchors.find((anchor) => anchor.name === "名字")?.value_type).toBe("immutable");
  });

  test("accepts prototype-named optional anchors through initialization and stored parsing", () => {
    const snapshot = buildSnapshot(validInit(
      ["constructor", "toString", "__proto__"].map((name) => ({
        name,
        dimension: "附加",
        initial_value: "0.5",
      })),
    ));
    const parsed = parsePersonalityAggregate(nodeProperties(snapshot), TENANT);
    expect(parsed.anchors.map((anchor) => anchor.name)).toEqual(
      expect.arrayContaining(["constructor", "toString", "__proto__"]),
    );
  });

  test("requires a named identity rule and rejects duplicate, empty, sparse, or unsupported rule input", () => {
    const duplicateRules = validInit();
    duplicateRules.rules = [
      ...duplicateRules.rules,
      { rule_type: "identity", name: "称呼", content: "重复身份规则。" },
    ];
    expectCode(() => validatePersonalityInitInput(duplicateRules, AT_1), "invalid_input");

    const noIdentity = validInit();
    noIdentity.rules = [{ rule_type: "core_value", name: "", content: "有效内容。" }];
    expectCode(() => validatePersonalityInitInput(noIdentity, AT_1), "invalid_input");

    const emptyRules = validInit();
    emptyRules.rules = [];
    expectCode(() => validatePersonalityInitInput(emptyRules, AT_1), "invalid_input");

    const blankContent = validInit();
    blankContent.rules = [{ rule_type: "identity", name: "称呼", content: "  " }];
    expectCode(() => validatePersonalityInitInput(blankContent, AT_1), "invalid_input");

    const unsupported = validInit();
    unsupported.rules = [{ rule_type: "other", name: "规则", content: "有效内容。" } as never];
    expectCode(() => validatePersonalityInitInput(unsupported, AT_1), "invalid_input");

    const sparseRules = validInit();
    const sparse = [...sparseRules.rules];
    delete sparse[0];
    sparseRules.rules = sparse;
    expectCode(() => validatePersonalityInitInput(sparseRules, AT_1), "invalid_input");
  });

  test("rejects incomplete, duplicate, wrong-dimension, or out-of-range required anchors atomically", () => {
    const incomplete = validInit();
    incomplete.anchors = incomplete.anchors.slice(1);
    expectCode(() => validatePersonalityInitInput(incomplete, AT_1), "invalid_input");
    const emptyAnchors = validInit();
    emptyAnchors.anchors = [];
    expectCode(() => validatePersonalityInitInput(emptyAnchors, AT_1), "invalid_input");

    const duplicate = validInit();
    duplicate.anchors = [...duplicate.anchors, duplicate.anchors[0]!];
    expectCode(() => validatePersonalityInitInput(duplicate, AT_1), "invalid_input");

    const wrongDimension = validInit();
    wrongDimension.anchors = wrongDimension.anchors.map((anchor) =>
      anchor.name === "直接度" ? { ...anchor, dimension: "决策偏好" } : anchor,
    );
    expectCode(() => validatePersonalityInitInput(wrongDimension, AT_1), "invalid_input");

    const tooLarge = validInit();
    tooLarge.anchors = tooLarge.anchors.map((anchor) =>
      anchor.name === "直接度" ? { ...anchor, initial_value: "1.5" } : anchor,
    );
    expectCode(() => validatePersonalityInitInput(tooLarge, AT_1), "invalid_input");

    const notNumber = validInit();
    notNumber.anchors = notNumber.anchors.map((anchor) =>
      anchor.name === "直接度" ? { ...anchor, initial_value: "NaN" } : anchor,
    );
    expectCode(() => validatePersonalityInitInput(notNumber, AT_1), "invalid_input");

    const numericAsNumber = validInit();
    numericAsNumber.anchors = numericAsNumber.anchors.map((anchor) =>
      anchor.name === "直接度" ? { ...anchor, initial_value: 0.5 as unknown as string } : anchor,
    );
    expectCode(() => validatePersonalityInitInput(numericAsNumber, AT_1), "invalid_input");
  });

  test("accepts decimal-string endpoints and defaults only optional anchor type and drift threshold", () => {
    const input = validInit();
    input.anchors = input.anchors.map((anchor) =>
      anchor.name === "直接度" ? { ...anchor, initial_value: " 1 " } : anchor,
    );
    const normalized = validatePersonalityInitInput(input, AT_1);
    const directness = normalized.anchors.find((anchor) => anchor.name === "直接度")!;
    expect(directness.current_value).toBe(1);
    expect(directness.value_type).toBe("numeric");
    expect(directness.drift_threshold).toBe(0.15);
    expect(normalized.anchors.every((anchor) => anchor.value_type === "numeric")).toBe(true);
  });
});

describe("strict personality aggregate parsing", () => {
  test("accepts a canonical aggregate with either trusted identity form and rejects mismatches", () => {
    const snapshot = buildSnapshot();
    const properties = nodeProperties(snapshot);
    const parsed = parsePersonalityAggregate(properties, TENANT);
    const parsedWithUids = parsePersonalityAggregate(properties, {
      personality_uid: snapshot.personality_uid,
      principal_uid: snapshot.principal_uid,
    });
    expect(parsed.personality_uid).toBe(snapshot.personality_uid);
    expect(parsed.anchors).toHaveLength(7);
    expect(parsedWithUids.principal_uid).toBe(snapshot.principal_uid);
    expectCode(
      () => parsePersonalityAggregate(properties, { personality_uid: snapshot.personality_uid, principal_uid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      "identity_conflict",
    );
    expectCode(
      () => parsePersonalityAggregate(properties, { personality_uid: snapshot.personality_uid, principal_uid: snapshot.principal_uid, legacy: true } as never),
      "invalid_input",
    );
    expectCode(
      () => parsePersonalityAggregate(properties, { principal_uid: "not-a-uuid" }),
      "invalid_input",
    );
  });

  test("rejects noncanonical JSON and unexpected top-level or nested keys", () => {
    const snapshot = buildSnapshot();
    const noncanonical = nodeProperties(snapshot);
    noncanonical.rules_json = ` ${snapshot.rules_json}`;
    expectCode(() => parsePersonalityAggregate(noncanonical, TENANT), "identity_conflict");

    const extraNodeKey = nodeProperties(snapshot);
    extraNodeKey.label = "AnimaPersonality";
    expectCode(() => parsePersonalityAggregate(extraNodeKey, TENANT), "identity_conflict");

    const extraRule = nodeProperties(snapshot);
    const rules = JSON.parse(snapshot.rules_json) as Record<string, unknown>[];
    rules[0]!.unexpected = true;
    extraRule.rules_json = canonicalize(rules as never);
    expectCode(() => parsePersonalityAggregate(extraRule, TENANT), "identity_conflict");

    const extraTrajectoryKey = changedAnchors(snapshot, (anchors) => {
      const trajectory = anchors[0]!.evolution_trajectory as Record<string, unknown>[];
      trajectory[0]!.extra = "unexpected";
    });
    expectCode(() => parsePersonalityAggregate(extraTrajectoryKey, TENANT), "identity_conflict");
  });

  test("rejects unsorted anchors, an incomplete required axis, and invalid trajectory timestamps", () => {
    const snapshot = buildSnapshot();
    const unsorted = changedAnchors(snapshot, (anchors) => anchors.reverse());
    expectCode(() => parsePersonalityAggregate(unsorted, TENANT), "identity_conflict");

    const incomplete = changedAnchors(snapshot, (anchors) => {
      anchors.splice(anchors.findIndex((anchor) => anchor.name === "直接度"), 1);
    });
    expectCode(() => parsePersonalityAggregate(incomplete, TENANT), "identity_conflict");

    const invalidTimestamp = changedAnchors(snapshot, (anchors) => {
      const trajectory = anchors[0]!.evolution_trajectory as Record<string, unknown>[];
      trajectory[0]!.at = "yesterday";
    });
    expectCode(() => parsePersonalityAggregate(invalidTimestamp, TENANT), "identity_conflict");
  });
});

describe("personality anchor and persona projection", () => {
  test("appends update history and returns a canonical replacement aggregate field", () => {
    const snapshot = buildSnapshot();
    const update = projectPersonalityAnchorUpdate(snapshot, "直接度", 0.8, "老板要求更直接。", AT_2);
    expect(update.action).toBe("anchor_update");
    expect(update.name).toBe("直接度");
    expect(update.old_value).toBe(0.5);
    expect(update.new_value).toBe(0.8);
    expect(update.updated_at).toBe(AT_2);
    expect(update.anchors_json).toBe(canonicalize(JSON.parse(update.anchors_json) as never));
    const updated = parsePersonalityAggregate({
      ...nodeProperties(snapshot),
      anchors_json: update.anchors_json,
      updated_at: update.updated_at,
    }, TENANT);
    const anchor = updated.anchors.find((item) => item.name === "直接度")!;
    expect(anchor.current_value).toBe(0.8);
    expect(anchor.evolution_trajectory).toEqual([
      { at: AT_1, from: null, to: 0.5, reason: "init" },
      { at: AT_2, from: 0.5, to: 0.8, reason: "老板要求更直接。" },
    ]);
  });

  test("matches anchor names case-sensitively and rejects missing, nonnumeric, immutable, and invalid updates", () => {
    const snapshot = buildSnapshot(validInit([
      { name: "表达习惯", dimension: "表达", value_type: "qualitative", initial_value: "温和" },
      { name: "名字", dimension: "身份", value_type: "immutable", initial_value: "墨墨" },
      { name: "Tone", dimension: "测试", initial_value: "0.5" },
    ]));
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "直接度 ", 0.6, "reason", AT_2), "invalid_input");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "tone", 0.6, "reason", AT_2), "anchor_not_found");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "directness", 0.6, "reason", AT_2), "anchor_not_found");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "表达习惯", 0.6, "reason", AT_2), "invalid_input");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "名字", 0.6, "reason", AT_2), "immutable_anchor");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "直接度", Number.NaN, "reason", AT_2), "invalid_input");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "直接度", 1.5, "reason", AT_2), "invalid_input");
    expectCode(() => projectPersonalityAnchorUpdate(snapshot, "直接度", 0.6, "  ", AT_2), "invalid_input");
  });

  test("projects only stored persona rules and anchors without claiming memories or texture", () => {
    const snapshot = buildSnapshot();
    const projection = projectPersonality(snapshot);
    expect(projection.status).toBe("initialized");
    if (projection.status !== "initialized") throw new Error("Expected initialized persona projection.");
    expect(projection.immutable_rules.map((rule) => rule.rule_type)).toEqual(["identity", "core_value", "safety_rail"]);
    expect(projection.anchors).toHaveLength(7);
    expect(Object.keys(projection).sort()).toEqual(["anchors", "immutable_rules", "status"]);
    const context = renderPersonalityContext(snapshot);
    expect(context).toContain("[身份]");
    expect(context).toContain("[核心价值观]");
    expect(context).toContain("[安全底线]");
    expect(context).toContain("[人格参数]");
    expect(context).not.toContain("recent_memories");
    expect(context).not.toContain("personality_texture");
  });

  test("shows only recent user-supplied anchor changes as unconfirmed texture", () => {
    const initial = buildSnapshot();
    expect(renderRecentPersonalityTexture(initial, "2026-09-24T10:00:00.000Z")).toBeUndefined();
    const update = projectPersonalityAnchorUpdate(initial, "直接度", 0.73, "请更直接", AT_2);
    const updated = parsePersonalityAggregate({
      ...nodeProperties(initial), anchors_json: update.anchors_json, updated_at: update.updated_at,
    }, TENANT);
    const texture = renderRecentPersonalityTexture(updated, "2026-09-24T10:00:00.000Z");
    expect(texture).toContain("近期人格调整");
    expect(texture).toContain("请更直接");
    expect(texture).toContain('"from":0.5,"to":0.73');
    expect(texture).toContain("不作为新指令");
    expect(renderRecentPersonalityTexture(updated, "2026-10-02T10:00:00.000Z")).toBeUndefined();
  });
});
