import { describe, expect, test } from "vitest";
import { EXECUTION_REVIEW_SYSTEM_PROMPT, EXECUTION_REVIEW_SYSTEM_PROMPT_V2, OpenAIReviewModelAdapter, REVIEW_MANUAL_PROMPT_CONTRACT_V2, normalizeReviewEndpoint } from "../src/openai-review-adapter.ts";

const input = {
  input_projection_version: "v1" as const,
  input_fingerprint: "a".repeat(64),
  candidate_uid: "00000000-0000-4000-8000-000000000001",
  execution_uid: "00000000-0000-4000-8000-000000000002",
  project_uid: "00000000-0000-4000-8000-000000000003",
  session_uid: "00000000-0000-4000-8000-000000000004",
  review_contract_version: "v1" as const,
  execution_state: "completed" as const,
  terminal_reason: "final_reply",
  source_fingerprint: "b".repeat(64),
  tool_call_count: 0,
  tool_result_count: 0,
  tool_error_count: 0,
  events: [],
};

function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe("OpenAI review adapter", () => {
  test("normalizes endpoint and sends the fixed request shape", async () => {
    let request: Request | undefined;
    const adapter = new OpenAIReviewModelAdapter({
      endpoint: "https://example.test/v1/",
      apiKey: "secret-key",
      model: "model-v1",
      timeoutMs: 1000,
      fetch: async (input, init) => {
        request = new Request(input, init);
        return response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      },
    });
    await expect(adapter.review(input)).resolves.toEqual({ ok: true });
    expect(request?.url).toBe("https://example.test/v1/chat/completions");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe("Bearer secret-key");
    const body = await request!.json() as Record<string, unknown>;
    expect(body.model).toBe("model-v1");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: EXECUTION_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: expect.any(String) },
    ]);
  });

  test("selects v2 prompt text and includes each behavioral contract", async () => {
    let request: Request | undefined;
    const adapter = new OpenAIReviewModelAdapter({
      endpoint: "https://example.test",
      apiKey: "secret-key",
      model: "model-v2",
      timeoutMs: 1000,
      promptContractVersion: REVIEW_MANUAL_PROMPT_CONTRACT_V2,
      fetch: async (input, init) => {
        request = new Request(input, init);
        return response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      },
    });
    await adapter.review(input);
    const body = await request!.json() as { messages: Array<{ role: string; content: string }> };
    const prompt = body.messages[0]!.content;
    expect(prompt).not.toBe(EXECUTION_REVIEW_SYSTEM_PROMPT);
    expect(prompt).toBe(EXECUTION_REVIEW_SYSTEM_PROMPT_V2);
    for (const requirement of [
      "Evidence arrays contain only input event_uid values",
      "Valid: evidence_event_uids:[E1]. Invalid: evidence_event_uids:[f1].",
      "Default decision: {action:\"skipped\",skip_reason:\"no_reusable_content\"}",
      "A reviewed result has exactly one reusable_practices entry, 1-4 findings",
      "Use reviewed only when direct evidence establishes a conditional, transferable method",
      "For user_cancelled, outcome is cancelled",
      "for session_compact or session_shutdown, outcome is interrupted",
      "decision must be skipped",
      "never infer intent, cause, responsibility, error status, or events after the terminal event",
      "A tool_result error proves only that result was an error; do not attribute a cause",
      "objective and process_summary state only observable events",
    ]) {
      expect(prompt).toContain(requirement);
    }
  });

  test("enforces URL safety and does not include credentials in errors", () => {
    expect(normalizeReviewEndpoint("http://localhost:1234/api")).toBe("http://localhost:1234/api/chat/completions");
    expect(() => normalizeReviewEndpoint("http://example.test/api")).toThrow();
    expect(() => normalizeReviewEndpoint("https://user:password@example.test/api")).toThrow();
    expect(() => new OpenAIReviewModelAdapter({ endpoint: "https://example.test", apiKey: "top-secret", model: "m", timeoutMs: 10 })).not.toThrow();
  });

  test("allows the explicit trusted HTTP host only", () => {
    const endpoint = "http://192.168.31.204:8081/v1";
    expect(() => normalizeReviewEndpoint(endpoint)).toThrow();
    expect(normalizeReviewEndpoint(endpoint, ["192.168.31.204"])).toBe("http://192.168.31.204:8081/v1/chat/completions");
    expect(() => normalizeReviewEndpoint(endpoint, ["192.168.31.205"])).toThrow();
    expect(() => normalizeReviewEndpoint(endpoint, ["192.168.031.204"])).toThrow();
    for (const host of ["", "https://192.168.31.204", "192.168.31.204:8081", "*.example.test", "192.168.31.204/path", "::1", "1.2.3", "0x7f.0.0.1"]) {
      expect(() => new OpenAIReviewModelAdapter({ endpoint: "https://example.test", apiKey: "key", model: "m", timeoutMs: 10, trustedHttpHosts: [host] })).toThrow();
    }
  });

  test("rejects HTTP failures, malformed envelopes, invalid content, and oversized bodies generically", async () => {
    for (const result of [
      response("secret body", 500),
      response(JSON.stringify({ choices: [] })),
      response(JSON.stringify({ choices: [{ message: { content: "" } }] })),
      response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] })),
    ]) {
      const adapter = new OpenAIReviewModelAdapter({ endpoint: "https://example.test", apiKey: "top-secret", model: "m", timeoutMs: 1000, fetch: async () => result });
      await expect(adapter.review(input)).rejects.toThrow(/Review model/);
      await expect(adapter.review(input)).rejects.not.toThrow(/top-secret|secret body/);
    }
    const oversized = new OpenAIReviewModelAdapter({ endpoint: "https://example.test", apiKey: "top-secret", model: "m", timeoutMs: 1000, fetch: async () => response("{}", 200, { "content-length": String(1024 * 1024 + 1) }) });
    await expect(oversized.review(input)).rejects.toThrow(/too large/);
  });

  test("applies the timeout to the request", async () => {
    const adapter = new OpenAIReviewModelAdapter({ endpoint: "https://example.test", apiKey: "secret", model: "m", timeoutMs: 5, fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) });
    await expect(adapter.review(input)).rejects.toThrow("Review model request failed.");
  });
});
