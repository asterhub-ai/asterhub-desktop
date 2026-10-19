import { describe, expect, test } from "vitest";
import {
  OpenAIReflectionModelAdapter,
  normalizeReflectionEndpoint,
} from "../src/openai-reflection-adapter.ts";
import type { ManualCandidateReflectionInput } from "../src/reflection-input-types.ts";
import { canonicalize } from "json-canonicalize";
import { automaticReflectionSelector } from "../src/reflection-calendar.ts";
import { encodeAutomaticReflectionModelInput } from "../src/automatic-reflection-wire.ts";
import { ReflectionModelContractError } from "../src/reflection-model-types.ts";
import type { AutomaticReflectionInput } from "../src/reflection-input-types.ts";

const input: ManualCandidateReflectionInput = {
  reflection_kind: "manual",
  input_projection_version: "v1",
  input_fingerprint: "a".repeat(64),
  scope_fingerprint: "b".repeat(64),
  selector: {
    kind: "candidate",
    candidate_uid: "00000000-0000-4000-8000-000000000001",
  },
  task_digests: [
    {
      candidate_uid: "00000000-0000-4000-8000-000000000001",
      execution_uid: "00000000-0000-4000-8000-000000000002",
      project_uid: "00000000-0000-4000-8000-000000000003",
      session_uid: "00000000-0000-4000-8000-000000000004",
      source_fingerprint: "c".repeat(64),
      terminal: {
        state: "completed",
        terminal_reason: "final_reply",
        event_uid: "00000000-0000-4000-8000-000000000005",
        position: 1,
        captured_at: "2026-01-01T00:00:00.000Z",
      },
      initiator: {
        event_uid: "00000000-0000-4000-8000-000000000006",
        position: 0,
        content: "start",
      },
      events: [],
      unsettled_tool_calls: [],
      content_omissions: [],
    },
  ],
};

const automaticInput: AutomaticReflectionInput = {
  reflection_kind: "daily",
  input_projection_version: "v1",
  input_fingerprint: "d".repeat(64),
  scope_fingerprint: "e".repeat(64),
  selector: automaticReflectionSelector(
    "00000000-0000-4000-8000-000000000003",
    "daily",
    "2026-01-01",
  ),
  task_digests: [{
    ...input.task_digests[0],
    events: [{
      event_uid: "00000000-0000-4000-8000-000000000007",
      position: 2,
      kind: "message",
      role: "assistant",
      content: "private material must stay out of the model wire payload",
    }],
  }],
};

function modelResponse(content: unknown): Response {
  return response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
}

function loopbackServer(handler: (request: Request) => Promise<Response> | Response): Bun.Server<"http"> {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
}

function adapterFor(server: Bun.Server<"http">): OpenAIReflectionModelAdapter {
  return new OpenAIReflectionModelAdapter({
    endpoint: `http://127.0.0.1:${server.port}/v1`,
    apiKey: "loopback-test-key",
    model: "loopback-model",
    timeoutMs: 1000,
  });
}

function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe("OpenAI reflection adapter", () => {
  test("uses authenticated JSON transport without following redirects", async () => {
    const originalFetch = globalThis.fetch;
    let request: Request | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }));
    }) as unknown as typeof fetch;
    try {
      const adapter = new OpenAIReflectionModelAdapter({
        endpoint: "https://example.test/v1/",
        apiKey: "secret-key",
        model: "model-v1",
        timeoutMs: 1000,
      });
      await expect(adapter.reflect(input)).resolves.toEqual({ ok: true });
      expect(request?.url).toBe("https://example.test/v1/chat/completions");
      expect(request?.method).toBe("POST");
      expect(request?.redirect).toBe("error");
      expect(request?.headers.get("authorization")).toBe("Bearer secret-key");
      const body = await request!.json() as Record<string, unknown>;
      expect(body.response_format).toEqual({ type: "json_object" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });


  test("returns the parsed content untouched", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => response(JSON.stringify({ choices: [{ message: { content: '[1,{"ok":true}]' } }] }))) as unknown as typeof fetch;
    try {
      const adapter = new OpenAIReflectionModelAdapter({ endpoint: "https://example.test", apiKey: "key", model: "m", timeoutMs: 1000 });
      await expect(adapter.reflect(input)).resolves.toEqual([1, { ok: true }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects unsafe endpoints and accepts only the exact trusted HTTP host", () => {
    let unsafeError: unknown;
    try {
      new OpenAIReflectionModelAdapter({ endpoint: "http://lan.example", apiKey: "secret-key", model: "m", timeoutMs: 1000 });
    } catch (error) {
      unsafeError = error;
    }
    expect(unsafeError).toBeInstanceOf(Error);
    expect((unsafeError as Error).message).not.toContain("secret-key");
    expect(() => normalizeReflectionEndpoint("http://lan.example/v1", ["lan.example"])).not.toThrow();
    expect(() => normalizeReflectionEndpoint("http://other.lan.example/v1", ["lan.example"])).toThrow();
    expect(() => normalizeReflectionEndpoint("https://user:secret@example.test/v1")).toThrow();
    expect(() => normalizeReflectionEndpoint("https://example.test/v1?api_key=secret")).toThrow();
  });

  test("uses generic errors without leaking key or response body", async () => {
    const originalFetch = globalThis.fetch;
    const secret = "super-secret-key";
    const bodies = [
      response("private response body", 500),
      response(JSON.stringify({ nope: true })),
      response("not-json"),
      response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] })),
    ];
    try {
      for (const body of bodies) {
        globalThis.fetch = (async () => body) as unknown as typeof fetch;
        const adapter = new OpenAIReflectionModelAdapter({ endpoint: "https://example.test", apiKey: secret, model: "m", timeoutMs: 1000 });
        const error = await adapter.reflect(input).catch((value: unknown) => value);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain("private response body");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects a response over the one MiB limit", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => response("{}", 200, { "content-length": String(1024 * 1024 + 1) })) as unknown as typeof fetch;
    try {
      const adapter = new OpenAIReflectionModelAdapter({ endpoint: "https://example.test", apiKey: "secret-key", model: "m", timeoutMs: 1000 });
      await expect(adapter.reflect(input)).rejects.toThrow("Reflection model request failed.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends automatic evidence handles over loopback and restores canonical UUID pairs", async () => {
    let requestCount = 0;
    let userContent = "";
    const server = loopbackServer(async (request) => {
      requestCount += 1;
      const body = await request.json() as { messages: Array<{ role: string; content: string }> };
      userContent = body.messages.find((message) => message.role === "user")?.content ?? "";
      const payload = JSON.parse(userContent) as { task_digests: Array<{ events: Array<{ evidence_ref: string }> }> };
      const evidenceRef = payload.task_digests[0].events[0].evidence_ref;
      return modelResponse({
        overview: { text: "summary", evidence: [evidenceRef] },
        observations: [],
        open_questions: [],
      });
    });
    try {
      const result = await adapterFor(server).reflect(automaticInput);
      const payload = JSON.parse(userContent) as {
        model_wire_contract: string;
        task_digests: Array<{ events: Array<Record<string, unknown>> }>;
      };
      expect(payload.model_wire_contract).toBe("automatic-reflection-evidence-ref/v1");
      expect(payload.task_digests[0].events[0].evidence_ref).toBe("e1");
      expect(payload.task_digests[0].events[0].event_uid).toBe("00000000-0000-4000-8000-000000000007");
      expect(userContent).toContain("private material");
      expect(result).toEqual({
        overview: {
          text: "summary",
          evidence: [{
            candidate_uid: automaticInput.task_digests[0].candidate_uid,
            event_uid: "00000000-0000-4000-8000-000000000007",
          }],
        },
        observations: [],
        open_questions: [],
      });
      expect(requestCount).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("rejects unknown and legacy evidence without exposing source identifiers", async () => {
    const secretUid = "00000000-0000-4000-8000-000000000007";
    for (const evidence of [
      ["e999"],
      [{ candidate_uid: automaticInput.task_digests[0].candidate_uid, event_uid: secretUid }],
    ]) {
      const server = loopbackServer(() => modelResponse({
        overview: { text: "summary", evidence },
        observations: [],
        open_questions: [],
      }));
      try {
        const error = await adapterFor(server).reflect(automaticInput).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ReflectionModelContractError);
        expect((error as Error).message).toMatch(/model evidence has an invalid shape|model evidence is outside the evidence scope/);
        expect((error as Error).message).not.toContain(secretUid);
        expect((error as Error).message).not.toContain("private material");
      } finally {
        server.stop(true);
      }
    }
  });

  test("applies the budget to canonical wire bytes before loopback fetch", async () => {
    let requestCount = 0;
    const server = loopbackServer(() => {
      requestCount += 1;
      return modelResponse({ overview: { text: "summary", evidence: ["e1"] }, observations: [], open_questions: [] });
    });
    try {
      const encoded = encodeAutomaticReflectionModelInput(automaticInput);
      const wireBytes = new TextEncoder().encode(canonicalize(encoded.payload)).byteLength;
      expect(wireBytes).toBeGreaterThan(new TextEncoder().encode(canonicalize(automaticInput)).byteLength);
      const adapter = adapterFor(server);
      await adapter.reflect(automaticInput, { maxInputBytes: wireBytes });
      expect(requestCount).toBe(1);
      const error = await adapter.reflect(automaticInput, { maxInputBytes: wireBytes - 1 }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ReflectionModelContractError);
      expect((error as ReflectionModelContractError).code).toBe("input_too_large");
      expect(requestCount).toBe(1);
    } finally {
      server.stop(true);
    }
  });
});
