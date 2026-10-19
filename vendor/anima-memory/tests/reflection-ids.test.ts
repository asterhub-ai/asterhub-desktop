import { describe, expect, test } from "vitest";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import { reflectionUid } from "../src/index.ts";

const scopeFingerprint = "a".repeat(64);
const inputFingerprint = "b".repeat(64);
const responseFingerprint = "c".repeat(64);
const contractVersion = "v1";

function uid(
  kind: Parameters<typeof reflectionUid>[0] = "daily",
  scope = scopeFingerprint,
  input = inputFingerprint,
  contract = contractVersion,
  response = responseFingerprint,
): string {
  return reflectionUid(kind, scope, input, contract, response);
}

describe("reflectionUid", () => {
  test("returns the canonical deterministic UUIDv5 from the exact parts", () => {
    expect(uid()).toBe("29ff7933-8d82-5bcb-a160-8f1a9d9f3cb1");
    expect(uid()).toBe(
      uuidV5FromParts([
        "anima.reflection",
        "v1",
        "daily",
        scopeFingerprint,
        inputFingerprint,
        contractVersion,
        responseFingerprint,
      ]),
    );
  });

  test("changes when any identity part changes", () => {
    const variants = [
      uid("manual"),
      uid("daily", "d".repeat(64)),
      uid("daily", scopeFingerprint, "e".repeat(64)),
      uid("daily", scopeFingerprint, inputFingerprint, "v2"),
      uid("daily", scopeFingerprint, inputFingerprint, contractVersion, "f".repeat(64)),
    ];

    expect(new Set([uid(), ...variants]).size).toBe(6);
  });

  test("rejects invalid runtime inputs", () => {
    expect(() => reflectionUid("hourly" as unknown as Parameters<typeof reflectionUid>[0], scopeFingerprint, inputFingerprint, contractVersion, responseFingerprint)).toThrow(TypeError);
    expect(() => reflectionUid("daily", "A".repeat(64), inputFingerprint, contractVersion, responseFingerprint)).toThrow(TypeError);
    expect(() => reflectionUid("daily", scopeFingerprint, "short", contractVersion, responseFingerprint)).toThrow(TypeError);
    expect(() => reflectionUid("daily", scopeFingerprint, inputFingerprint, "", responseFingerprint)).toThrow(TypeError);
    expect(() => reflectionUid("daily", scopeFingerprint, inputFingerprint, contractVersion, "g".repeat(64))).toThrow(TypeError);
  });
});
