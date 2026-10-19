import { describe, expect, test } from "vitest";
import { memoryOperationConfirmation } from "../src/memory-operation-intent.ts";

const target = {
  memory_uid: "11111111-1111-4111-8111-111111111111",
  expected_revision_uid: "22222222-2222-4222-8222-222222222222",
};

describe("memory operation user confirmation", () => {
  test("binds each destructive action to the exact target and expected revision", () => {
    expect(memoryOperationConfirmation({ ...target, action: "revoke" })).toBe(
      `确认 Anima revoke ${target.memory_uid} ${target.expected_revision_uid}`,
    );
    expect(memoryOperationConfirmation({ ...target, action: "suspend" })).toBe(
      `确认 Anima suspend ${target.memory_uid} ${target.expected_revision_uid}`,
    );
    expect(memoryOperationConfirmation({ ...target, action: "resume" })).toBe(
      `确认 Anima resume ${target.memory_uid} ${target.expected_revision_uid}`,
    );
  });
  test("includes the requested expiration instant and rejects a missing deadline", () => {
    expect(memoryOperationConfirmation({ ...target, action: "set_expiry", valid_until: "2026-09-25T00:00:00Z" })).toBe(
      `确认 Anima set_expiry ${target.memory_uid} ${target.expected_revision_uid} 2026-09-25T00:00:00Z`,
    );
    expect(() => memoryOperationConfirmation({ ...target, action: "set_expiry" })).toThrow();
  });
});
