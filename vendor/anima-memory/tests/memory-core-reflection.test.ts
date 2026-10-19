import { describe, expect, test } from "vitest";
import type {
  MemoryStore,
  MemoryStoreHealth,
  ReflectManualCandidateInput,
  ReflectManualCandidateResult,
} from "../src/types.ts";
import { MemoryCore } from "../src/memory-core.ts";

const connectedHealth: MemoryStoreHealth = {
  status: "connected",
  database: "neo4j",
  constraints: [],
};

const input: ReflectManualCandidateInput = {
  candidate_uid: "candidate-1",
  model_ref: "model-1",
  prompt_contract_version: "manual-reflection/v1",
  max_input_bytes: 4096,
};

const materialized: ReflectManualCandidateResult = {
  status: "materialized",
  candidate_uid: input.candidate_uid,
  reflection_uid: "reflection-1",
};

function storeWith(reflectManualCandidate?: MemoryStore["reflectManualCandidate"]): MemoryStore {
  return {
    initialize: async () => connectedHealth,
    processSession: async () => ({ status: "indeterminate", project_uid: "", session_uid: "", message: "unused" }),
    recordSessionContinuation: async () => ({ status: "indeterminate", decision_uid: "", message: "unused" }),
    materializeEpisode: async () => ({ status: "indeterminate", decision_uid: "", message: "unused" }),
    getTaskDigest: async () => ({ status: "failed", code: "not_found", message: "unused" }),
    materializeExecutionUnits: async () => ({ status: "indeterminate", project_uid: "", session_uid: "", message: "unused" }),
    ...(reflectManualCandidate === undefined ? {} : { reflectManualCandidate }),
    close: async () => {},
  } as unknown as MemoryStore;
}

describe("MemoryCore manual reflection forwarding", () => {
  test("forwards the exact input and returns the exact store result when ready", async () => {
    let received: ReflectManualCandidateInput | undefined;
    const store = storeWith(async (value) => {
      received = value;
      return materialized;
    });
    const core = new MemoryCore({ store });

    await core.initialize();
    const result = await core.reflectManualCandidate(input);

    expect(received).toBe(input);
    expect(result).toBe(materialized);
  });

  test("maps an absent optional store method to model_unavailable", async () => {
    const core = new MemoryCore({ store: storeWith() });
    await core.initialize();

    await expect(core.reflectManualCandidate(input)).resolves.toEqual({
      status: "failed",
      code: "model_unavailable",
      message: "Manual reflection model adapter is unavailable.",
    });
  });

  test("rejects admission while starting with candidate identity preserved", async () => {
    const store = storeWith(async () => materialized);
    const core = new MemoryCore({ store });

    await expect(core.reflectManualCandidate(input)).resolves.toEqual({
      status: "failed",
      code: "core_degraded",
      candidate_uid: input.candidate_uid,
      message: "Memory core is not ready.",
    });
  });

  test("maps both synchronous throws and rejected store operations to database_error", async () => {
    const syncThrowing = new MemoryCore({
      store: storeWith(() => {
        throw new Error("sync failure");
      }),
    });
    await syncThrowing.initialize();
    await expect(syncThrowing.reflectManualCandidate(input)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });

    const rejecting = new MemoryCore({
      store: storeWith(async () => {
        throw new Error("async failure");
      }),
    });
    await rejecting.initialize();
    await expect(rejecting.reflectManualCandidate(input)).resolves.toEqual({
      status: "failed",
      code: "database_error",
      message: "Memory store operation failed.",
    });
  });

  test("rejects admission after close with candidate identity preserved", async () => {
    let calls = 0;
    const core = new MemoryCore({
      store: storeWith(async () => {
        calls += 1;
        return materialized;
      }),
    });
    await core.close();

    await expect(core.reflectManualCandidate(input)).resolves.toEqual({
      status: "failed",
      code: "core_closed",
      candidate_uid: input.candidate_uid,
      message: "Memory core is closed.",
    });
    expect(calls).toBe(0);
  });
});
