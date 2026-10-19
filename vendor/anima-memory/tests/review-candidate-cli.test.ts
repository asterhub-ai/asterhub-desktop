import { describe, expect, test } from "vitest";
import { parseReviewCandidateArgs, parseReviewCandidateConfiguration, runReviewCandidate } from "../src/review-candidate-cli.ts";
import type { ExecutionReviewOperationResult } from "../src/execution-review-types.ts";

const candidate = "00000000-0000-4000-8000-000000000001";
const baseEnv = {
  ANIMA_REVIEW_API_URL: "https://example.test/v1",
  ANIMA_REVIEW_API_KEY: "secret",
  ANIMA_REVIEW_MODEL: "manual-v1",
};

describe("manual review CLI", () => {
  test("parses the exact arguments and owner rules", () => {
    expect(parseReviewCandidateArgs(["--candidate", candidate, "--prompt-contract", "execution-review-manual/v2", "--owner", "  operator  "])).toEqual({ candidate_uid: candidate, prompt_contract_version: "execution-review-manual/v2", owner: "operator" });
    expect(() => parseReviewCandidateArgs(["--candidate", candidate, "--prompt-contract", "execution-review-manual/v1", "--owner", "operator"])).toThrow();
    expect(() => parseReviewCandidateArgs(["--candidate", candidate, "--prompt-contract", "execution-review-manual/v2", "--owner", " \t"])).toThrow();
    expect(() => parseReviewCandidateArgs(["--candidate", candidate, "--prompt-contract", "execution-review-manual/v2", "--owner", "bad\nowner"])).toThrow();
  });

  test("validates environment and timeout bounds", () => {
    expect(parseReviewCandidateConfiguration(baseEnv).timeout_ms).toBe(120000);
    expect(parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_REVIEW_TIMEOUT_MS: "240000" }).timeout_ms).toBe(240000);
    expect(parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_REVIEW_TRUSTED_HTTP_HOST: "192.168.31.204" }).trusted_http_host).toBe("192.168.31.204");
    expect(() => parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_REVIEW_TIMEOUT_MS: "0" })).toThrow();
    expect(() => parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_REVIEW_TIMEOUT_MS: "240001" })).toThrow();
    expect(() => parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_REVIEW_API_KEY: undefined })).toThrow();
    for (const trusted_http_host of ["", "https://192.168.31.204", "192.168.31.204:8081", "*.example.test", "192.168.31.204/path"]) {
      expect(() => parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_REVIEW_TRUSTED_HTTP_HOST: trusted_http_host })).toThrow();
    }
  });

  test("refuses an explicit config outside the repository-local user directory", () => {
    for (const configPath of [
      "E:/AI资源/Anima-rebuild/memory-system/data/anima-memory.db",
      "C:/Users/synthetic/.anima/config.json",
      "../config.json",
    ]) {
      expect(() => parseReviewCandidateConfiguration({ ...baseEnv, ANIMA_MEMORY_CONFIG_PATH: configPath })).toThrow();
    }
  });

  test("passes the optional trusted host to the adapter without printing it", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let adapter: { endpoint: string } | undefined;
    const result: ExecutionReviewOperationResult = { status: "reviewed", candidate_uid: candidate, review_uid: "00000000-0000-4000-8000-000000000099" };
    const exitCode = await runReviewCandidate(
      ["--candidate", candidate, "--prompt-contract", "execution-review-manual/v2", "--owner", "operator"],
      { ...baseEnv, ANIMA_REVIEW_API_URL: "http://192.168.31.204:8081/v1", ANIMA_REVIEW_TRUSTED_HTTP_HOST: "192.168.31.204" },
      {
        writeStdout: (text) => stdout.push(text),
        writeStderr: (text) => stderr.push(text),
        createCore: (receivedAdapter) => {
          adapter = receivedAdapter;
          return { initialize: async () => {}, reviewExecutionCandidate: async () => result, close: async () => {} };
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(adapter?.endpoint).toBe("http://192.168.31.204:8081/v1/chat/completions");
    expect(stdout.join("")).not.toContain("192.168.31.204");
    expect(stderr).toEqual([]);
  });

  test("writes one summary JSON object for a Core result and closes the Core", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let closed = false;
    let received: Record<string, unknown> | undefined;
    const result: ExecutionReviewOperationResult = { status: "reviewed", candidate_uid: candidate, review_uid: "00000000-0000-4000-8000-000000000099" };
    const exitCode = await runReviewCandidate(
      ["--candidate", candidate, "--prompt-contract", "execution-review-manual/v2", "--owner", "operator"],
      baseEnv,
      {
        now: (() => { let value = 100; return () => value += 25; })(),
        writeStdout: (text) => stdout.push(text),
        writeStderr: (text) => stderr.push(text),
        createCore: () => ({
          initialize: async () => {},
          reviewExecutionCandidate: async (input) => { received = input as unknown as Record<string, unknown>; return result; },
          close: async () => { closed = true; },
        }),
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(closed).toBe(true);
    expect(received).toMatchObject({ candidate_uid: candidate, lease_owner: "operator", lease_ttl_ms: 300000, prompt_contract_version: "execution-review-manual/v2", model_ref: "manual-v1" });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toEqual({ candidate_uid: candidate, status: "reviewed", model_ref: "manual-v1", prompt_contract_version: "execution-review-manual/v2", elapsed_ms: 25, review_uid: result.review_uid });
  });

  test("preflight failure produces no stdout and never constructs Core", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let constructed = false;
    const exitCode = await runReviewCandidate([], baseEnv, {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
      createCore: () => { constructed = true; throw new Error("must not construct"); },
    });
    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["review-candidate: preflight\n"]);
    expect(constructed).toBe(false);
  });
});
