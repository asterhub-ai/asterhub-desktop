import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import type { ReflectionKind } from "./reflection-types.ts";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const REFLECTION_KINDS: readonly ReflectionKind[] = ["manual", "daily", "weekly", "monthly"];

function assertReflectionKind(value: unknown): asserts value is ReflectionKind {
  if (!REFLECTION_KINDS.includes(value as ReflectionKind)) {
    throw new TypeError("kind must be manual, daily, weekly, or monthly.");
  }
}

function assertFingerprint(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase 64-hex string.`);
  }
}

function assertContractVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("reflectionContractVersion must be a nonempty string.");
  }
}

export function reflectionUid(
  kind: ReflectionKind,
  scopeFingerprint: string,
  inputFingerprint: string,
  reflectionContractVersion: string,
  responseFingerprint: string,
): string {
  assertReflectionKind(kind);
  assertFingerprint(scopeFingerprint, "scopeFingerprint");
  assertFingerprint(inputFingerprint, "inputFingerprint");
  assertContractVersion(reflectionContractVersion);
  assertFingerprint(responseFingerprint, "responseFingerprint");

  return uuidV5FromParts([
    "anima.reflection",
    "v1",
    kind,
    scopeFingerprint,
    inputFingerprint,
    reflectionContractVersion,
    responseFingerprint,
  ]);
}
