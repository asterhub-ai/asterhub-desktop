import { describe, expect, test } from "vitest";
import { canonicalize } from "json-canonicalize";
import { automaticReflectionSelector } from "../src/reflection-calendar.ts";
import {
  AutomaticReflectionBatchSizeError,
  buildAutomaticReflectionBatches,
} from "../src/automatic-reflection-batches.ts";
import { buildAutomaticReflectionInput } from "../src/reflection-input-projector.ts";
import type { AutomaticReflectionInput } from "../src/reflection-input-types.ts";
import type { TaskDigest } from "../src/task-digest-types.ts";

const PROJECT_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const selector = automaticReflectionSelector(PROJECT_UID, "daily", "2026-01-01");

function digest(candidate_uid: string, content: string): TaskDigest {
  return {
    candidate_uid,
    execution_uid: `execution-${candidate_uid}`,
    project_uid: PROJECT_UID,
    session_uid: `session-${candidate_uid}`,
    source_fingerprint: `source-${candidate_uid}`,
    terminal: { state: "completed", terminal_reason: "final_reply", event_uid: `end-${candidate_uid}`, position: 1, captured_at: "2026-01-01T00:00:00Z" },
    initiator: { event_uid: `event-${candidate_uid}`, position: 0, content },
    events: [{ event_uid: `event-${candidate_uid}`, position: 0, kind: "message", role: "user", content }, { event_uid: `end-${candidate_uid}`, position: 1, kind: "turn_end", role: "assistant", content: "done" }],
    unsettled_tool_calls: [],
    content_omissions: [],
  };
}

function bytes(value: unknown): number {
  return Buffer.byteLength(canonicalize(value as never), "utf8");
}

function metadataDigest(candidate_uid: string, eventCount: number): TaskDigest {
  const events = Array.from({ length: eventCount }, (_, position) => ({
    event_uid: `${candidate_uid}-metadata-event-${String(position).padStart(6, "0")}`,
    position,
    kind: position === eventCount - 1 ? "turn_end" as const : "message" as const,
    role: position === eventCount - 1 ? "assistant" : "user",
    content: null,
  }));
  const terminal = events[eventCount - 1]!;
  return {
    candidate_uid,
    execution_uid: `execution-${candidate_uid}`,
    project_uid: PROJECT_UID,
    session_uid: `session-${candidate_uid}`,
    source_fingerprint: `source-${candidate_uid}`,
    terminal: {
      state: "completed",
      terminal_reason: "final_reply",
      event_uid: terminal.event_uid,
      position: terminal.position,
      captured_at: "2026-01-01T00:00:00Z",
    },
    initiator: { event_uid: events[0]!.event_uid, position: 0, content: null },
    events,
    unsettled_tool_calls: [],
    content_omissions: [],
  };
}

function batchFingerprints(input: AutomaticReflectionInput, budget: number): string[] {
  return buildAutomaticReflectionBatches(input, budget).map((batch) => batch.input_fingerprint);
}

describe("buildAutomaticReflectionBatches", () => {
  test("accepts the exact full-input byte budget as one batch", () => {
    const input = buildAutomaticReflectionInput(selector, [digest("candidate-a", "hello")]);
    const batches = buildAutomaticReflectionBatches(input, bytes(input));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(input);
  });

  test("splits at one byte below the full-input boundary and preserves all digests", () => {
    const input = buildAutomaticReflectionInput(selector, [digest("candidate-a", "one"), digest("candidate-b", "two")]);
    const limit = bytes(input) - 1;
    const batches = buildAutomaticReflectionBatches(input, limit);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => bytes(batch) <= limit)).toBe(true);
    expect(batches.flatMap((batch) => [...batch.task_digests])).toEqual([...input.task_digests]);
  });

  test("counts canonical UTF-8 bytes including Chinese, emoji, and escaped strings", () => {
    const input = buildAutomaticReflectionInput(selector, [digest("candidate-a", "中文🙂\"\\"), digest("candidate-b", "中文🙂\"\\")]);
    const exact = bytes(input);
    expect(exact).toBeGreaterThan(canonicalize(input as never).length);
    expect(buildAutomaticReflectionBatches(input, exact)).toEqual([input]);
    const batches = buildAutomaticReflectionBatches(input, exact - 1);
    expect(batches.every((batch) => bytes(batch) <= exact - 1)).toBe(true);
    expect(batches.flatMap((batch) => [...batch.task_digests])).toEqual([...input.task_digests]);
  });

  test("uses maximum greedy batch boundaries", () => {
    const input = buildAutomaticReflectionInput(selector, [
      digest("candidate-a", "same"), digest("candidate-b", "same"), digest("candidate-c", "same"), digest("candidate-d", "same"),
    ]);
    const oneDigest = buildAutomaticReflectionInput(selector, [input.task_digests[0]!]);
    const twoDigests = buildAutomaticReflectionInput(selector, input.task_digests.slice(0, 2));
    const limit = bytes(twoDigests);
    const batches = buildAutomaticReflectionBatches(input, limit);
    expect(batches.map((batch) => batch.task_digests.map((item) => item.candidate_uid))).toEqual([
      input.task_digests.slice(0, 2).map((item) => item.candidate_uid),
      input.task_digests.slice(2).map((item) => item.candidate_uid),
    ]);
    expect(bytes(oneDigest)).toBeLessThan(limit);
    expect(batches.every((batch) => bytes(batch) <= limit)).toBe(true);
    expect(batches.flatMap((batch) => [...batch.task_digests])).toEqual([...input.task_digests]);
  });

  test("throws a specific size error when one complete digest cannot fit", () => {
    const input = buildAutomaticReflectionInput(selector, [digest("candidate-too-large", "中文🙂\"\\")]);
    const limit = bytes(input) - 1;
    expect(() => buildAutomaticReflectionBatches(input, limit)).toThrow(AutomaticReflectionBatchSizeError);
    try {
      buildAutomaticReflectionBatches(input, limit);
    } catch (error) {
      expect(error).toBeInstanceOf(AutomaticReflectionBatchSizeError);
      expect((error as Error).message).toContain("candidate-too-large");
      expect((error as Error).message).toContain(`${limit}-byte`);
    }
  });
  test("keeps a complete digest above the soft target as its own batch", () => {
    const input = buildAutomaticReflectionInput(selector, [metadataDigest("large-singleton", 1_000)]);
    const singletonBytes = bytes(input);
    expect(singletonBytes).toBeGreaterThan(65_536);
    expect(singletonBytes).toBeLessThanOrEqual(524_288);
    const batches = buildAutomaticReflectionBatches(input, 524_288);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(input);
  });

  test("rejects a complete digest above the hard budget", () => {
    const input = buildAutomaticReflectionInput(selector, [metadataDigest("hard-budget-singleton", 1_000)]);
    expect(() => buildAutomaticReflectionBatches(input, bytes(input) - 1)).toThrow(AutomaticReflectionBatchSizeError);
  });

  test("keeps an oversized singleton isolated and preserves neighboring digest order", () => {
    const input = buildAutomaticReflectionInput(selector, [
      digest("candidate-a-small", "first"),
      metadataDigest("candidate-b-large", 1_000),
      digest("candidate-c-small", "last"),
    ]);
    const batches = buildAutomaticReflectionBatches(input, 524_288);
    expect(batches.map((batch) => batch.task_digests.map((item) => item.candidate_uid))).toEqual([
      ["candidate-a-small"],
      ["candidate-b-large"],
      ["candidate-c-small"],
    ]);
    expect(batches.flatMap((batch) => batch.task_digests.map((item) => item.candidate_uid))).toEqual(
      input.task_digests.map((item) => item.candidate_uid),
    );
  });

  test("preserves normal multi-batch fingerprints across hard budgets", () => {
    const input = buildAutomaticReflectionInput(selector, [
      metadataDigest("candidate-a", 300),
      metadataDigest("candidate-b", 300),
      metadataDigest("candidate-c", 300),
      metadataDigest("candidate-d", 300),
    ]);
    const fingerprints64k = batchFingerprints(input, 65_536);
    expect(fingerprints64k.length).toBeGreaterThan(1);
    expect(batchFingerprints(input, 524_288)).toEqual(fingerprints64k);
    expect(batchFingerprints(input, 1_048_576)).toEqual(fingerprints64k);
  });
});
