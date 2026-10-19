import { uuidV5FromParts } from "@deepseek-ai/anima-capture";

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertCanonicalUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a canonical lowercase UUID.`);
  }
}

export function automaticReflectionScheduleCursorUid(project_uid: string): string {
  assertCanonicalUuid(project_uid, "project_uid");
  return uuidV5FromParts(["anima.reflection-schedule-cursor", "v1", project_uid]);
}
