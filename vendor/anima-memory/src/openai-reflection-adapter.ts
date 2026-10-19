import { canonicalize } from "json-canonicalize";
import { buildManualReflectionSystemPrompt } from "./reflection-prompt.ts";
import type { ReflectionModelInput } from "./reflection-input-types.ts";
import {
  buildAutomaticReflectionWireSystemPrompt,
  decodeAutomaticReflectionModelOutput,
  encodeAutomaticReflectionModelInput,
} from "./automatic-reflection-wire.ts";
import type { ReflectionModelAdapter, ReflectionModelRequestOptions } from "./reflection-model-types.ts";
import { ReflectionModelContractError } from "./reflection-model-types.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "::1": true };

type ReflectionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAIReflectionModelAdapterOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  trustedHttpHosts?: readonly string[];
}

export class OpenAIReflectionModelAdapter implements ReflectionModelAdapter {
  readonly endpoint: string;
  readonly model: string;
  readonly model_ref: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: ReflectionFetch;

  constructor(options: OpenAIReflectionModelAdapterOptions) {
    this.endpoint = normalizeReflectionEndpoint(options.endpoint, options.trustedHttpHosts);
    if (typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new TypeError("Reflection API key is required.");
    }
    if (typeof options.model !== "string" || options.model.length === 0) {
      throw new TypeError("Reflection model is required.");
    }
    if (typeof options.timeoutMs !== "number" || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new TypeError("Reflection timeout is invalid.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.model_ref = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = globalThis.fetch;
  }

  readonly reflect = async (input: ReflectionModelInput, options?: ReflectionModelRequestOptions): Promise<unknown> => {
    if (options !== undefined && (
      typeof options.maxInputBytes !== "number" ||
      !Number.isSafeInteger(options.maxInputBytes) ||
      options.maxInputBytes < 1 ||
      options.maxInputBytes > MAX_INPUT_BYTES
    )) {
      throw new TypeError("Reflection max_input_bytes is invalid.");
    }
    const controller = new AbortController();
    const deadline = performance.now() + this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const automatic = input.reflection_kind !== "manual";
      const encoded = automatic ? encodeAutomaticReflectionModelInput(input) : undefined;
      const userContent = canonicalize(encoded?.payload ?? input);
      const inputBudget = options?.maxInputBytes ?? (automatic ? MAX_INPUT_BYTES : undefined);
      if (inputBudget !== undefined && new TextEncoder().encode(userContent).byteLength > inputBudget) {
        throw new ReflectionModelContractError(
          "input_too_large",
          automatic
            ? "Automatic reflection model wire input exceeds max_input_bytes"
            : "Reflection model input exceeds max_input_bytes",
        );
      }
      const body = JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: automatic ? buildAutomaticReflectionWireSystemPrompt(input.reflection_kind) : buildManualReflectionSystemPrompt() },
          { role: "user", content: userContent },
        ],
      });
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      if (performance.now() >= deadline || !response.ok || response.status < 200 || response.status >= 300) {
        throw new Error("Reflection model request failed.");
      }

      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length.trim()) || Number(length) > MAX_RESPONSE_BYTES)) {
        throw new Error("Reflection model request failed.");
      }
      const text = await readResponseText(response, MAX_RESPONSE_BYTES, controller.signal);
      if (performance.now() >= deadline) throw new Error("Reflection model request failed.");

      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error("Reflection model request failed.");
      }
      if (performance.now() >= deadline) throw new Error("Reflection model request failed.");

      if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length < 1) {
        throw new Error("Reflection model request failed.");
      }
      const first = envelope.choices[0];
      if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string" || first.message.content.length === 0) {
        throw new Error("Reflection model request failed.");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(first.message.content);
      } catch {
        throw new Error("Reflection model request failed.");
      }
      if (performance.now() >= deadline) throw new Error("Reflection model request failed.");
      const output = encoded === undefined ? parsed : decodeAutomaticReflectionModelOutput(parsed, encoded.evidenceReferences);
      if (performance.now() >= deadline) throw new Error("Reflection model request failed.");
      return output;
    } catch (error: unknown) {
      if (error instanceof ReflectionModelContractError) throw error;
      throw new Error("Reflection model request failed.");
    } finally {
      clearTimeout(timeout);
    }
  };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readResponseText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new Error("Reflection model request failed.");
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Reflection model request failed.")), { once: true });
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abort]);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new Error("Reflection model request failed.");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function normalizeReflectionTrustedHttpHost(value: string): string {
  if (typeof value !== "string" || value.length === 0 || !/^[\p{L}\p{N}.-]+$/u.test(value)) {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }
  if (/^\d+(?:\.\d+){3}$/u.test(value)) return normalizeReflectionIPv4Host(value);
  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }

  let url: URL;
  try {
    url = new URL(`http://${value}`);
  } catch {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }
  if (url.username !== "" || url.password !== "" || url.port !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^[\x00-\x7F]+$/u.test(value) && host !== value.toLowerCase()) {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }
  if (!host || host.length > 253 || !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }
  return host;
}

function normalizeReflectionIPv4Host(value: string): string {
  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((octet) => (octet.length > 1 && octet.startsWith("0")) || Number(octet) > 255)) {
    throw new TypeError("Reflection trusted HTTP host is invalid.");
  }
  return octets.map((octet) => String(Number(octet))).join(".");
}

function normalizeTrustedHttpHosts(value: readonly string[] | undefined): ReadonlySet<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) throw new TypeError("Reflection trusted HTTP hosts are invalid.");
  return new Set(value.map(normalizeReflectionTrustedHttpHost));
}

export function normalizeReflectionEndpoint(value: string, trustedHttpHosts?: readonly string[]): string {
  const trustedHosts = normalizeTrustedHttpHosts(trustedHttpHosts);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Reflection API URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Reflection API URL is invalid.");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new TypeError("Reflection API URL is invalid.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol === "http:" && LOOPBACK_HOSTS[host] !== true && !trustedHosts.has(host)) {
    throw new TypeError("Reflection API URL must use HTTPS.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path}/chat/completions`;
  return url.toString();
}
