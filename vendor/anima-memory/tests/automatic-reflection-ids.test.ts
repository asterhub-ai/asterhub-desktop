import { describe, expect, test } from "vitest";
import { uuidV5FromParts } from "@deepseek-ai/anima-capture";
import { automaticReflectionScheduleCursorUid } from "../src/index.ts";

const project_uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other_project_uid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("automaticReflectionScheduleCursorUid", () => {
  test("is deterministic from the frozen UUIDv5 parts", () => {
    expect(automaticReflectionScheduleCursorUid(project_uid)).toBe(automaticReflectionScheduleCursorUid(project_uid));
    expect(automaticReflectionScheduleCursorUid(project_uid)).toBe(
      uuidV5FromParts(["anima.reflection-schedule-cursor", "v1", project_uid]),
    );
  });

  test("differentiates projects", () => {
    expect(automaticReflectionScheduleCursorUid(project_uid)).not.toBe(
      automaticReflectionScheduleCursorUid(other_project_uid),
    );
  });

  test("rejects malformed or non-canonical project UIDs", () => {
    expect(() => automaticReflectionScheduleCursorUid("not-a-uuid")).toThrow(TypeError);
    expect(() => automaticReflectionScheduleCursorUid(project_uid.toUpperCase())).toThrow(TypeError);
    expect(() => automaticReflectionScheduleCursorUid("00000000-0000-4000-8000-00000000000z")).toThrow(TypeError);
  });
});
