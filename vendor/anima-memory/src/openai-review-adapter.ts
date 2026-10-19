import { canonicalize } from "json-canonicalize";
import type { ExecutionReviewModelAdapter, ExecutionReviewModelInput } from "./execution-review-types.ts";

export const REVIEW_MANUAL_PROMPT_CONTRACT = "execution-review-manual/v1" as const;
export const EXECUTION_REVIEW_SYSTEM_PROMPT = [
  "You are an execution-review JSON generator. Return one JSON object and no markdown.",
  "The object must contain exactly these top-level keys: outcome, outcome_evidence_event_uids, objective, process_summary, findings, failure_analysis, failure_analysis_evidence_event_uids, reusable_practices, decision.",
  "outcome must be one of: completed, partial, failed, cancelled, interrupted.",
  "outcome_evidence_event_uids must be a nonempty ordered subset of input event_uid values, strictly ascending by input position, with no duplicates.",
  "objective is a string of at most 1000 UTF-16 code units. process_summary is a string of at most 2000 UTF-16 code units.",
  "findings is an array of at most 32 objects. Every finding object must contain exactly finding_uid, kind, statement, evidence_event_uids.",
  "finding_uid must match fN (N is a positive decimal integer) and must be unique. kind must be one of observation, inference, practice. statement is a string of at most 1000 UTF-16 code units.",
  "Every finding evidence_event_uids array must be nonempty, contain only input event_uid values, be strictly ascending by input position, and contain no duplicates.",
  "failure_analysis is null or a string of at most 2000 UTF-16 code units. failure_analysis_evidence_event_uids is null or a nonempty input-event subset, strictly ascending by input position and duplicate-free; the two failure fields must both be null or both be non-null.",
  "reusable_practices is an array of at most 16 objects. Every practice object must contain exactly practice_uid, statement, evidence_event_uids.",
  "practice_uid must match pN (N is a positive decimal integer) and must be unique. statement is a string of at most 1000 UTF-16 code units.",
  "Every practice evidence_event_uids array must be nonempty, ordered, duplicate-free, and contain only evidence from observation or inference findings.",
  "decision must contain exactly action and skip_reason. action must be reviewed or skipped. skip_reason must be null, no_reusable_content, duplicate_low_value, or insufficient_interpretation.",
  "For reviewed, skip_reason must be null. For skipped, skip_reason must be non-null and findings, reusable_practices, failure_analysis, and failure_analysis_evidence_event_uids must all be empty/null.",
  "Do not add any keys. The deterministic Core validator is final.",
].join("\n");
export const REVIEW_MANUAL_PROMPT_CONTRACT_V2 = "execution-review-manual/v2" as const;
export type ReviewPromptContractVersion = typeof REVIEW_MANUAL_PROMPT_CONTRACT | typeof REVIEW_MANUAL_PROMPT_CONTRACT_V2;

export const EXECUTION_REVIEW_SYSTEM_PROMPT_V2 = [
  "You are an execution-review JSON generator. Return one JSON object and no markdown.",
  "The object must contain exactly these top-level keys: outcome, outcome_evidence_event_uids, objective, process_summary, findings, failure_analysis, failure_analysis_evidence_event_uids, reusable_practices, decision.",
  "outcome must be one of: completed, partial, failed, cancelled, interrupted.",
  "outcome_evidence_event_uids must be a nonempty ordered subset of input event_uid values, strictly ascending by input position, with no duplicates.",
  "objective is a string of at most 1000 UTF-16 code units. process_summary is a string of at most 2000 UTF-16 code units.",
  "findings is an array of at most 32 objects. Every finding object must contain exactly finding_uid, kind, statement, evidence_event_uids.",
  "finding_uid must match fN (N is a positive decimal integer) and must be unique. kind must be one of observation, inference, practice. statement is a string of at most 1000 UTF-16 code units.",
  "Every finding evidence_event_uids array must be nonempty, contain only input event_uid values, be strictly ascending by input position, and contain no duplicates.",
  "failure_analysis is null or a string of at most 2000 UTF-16 code units. failure_analysis_evidence_event_uids is null or a nonempty input-event subset, strictly ascending by input position and duplicate-free; the two failure fields must both be null or both be non-null.",
  "reusable_practices is an array of at most 16 objects. Every practice object must contain exactly practice_uid, statement, evidence_event_uids.",
  "practice_uid must match pN (N is a positive decimal integer) and must be unique. statement is a string of at most 1000 UTF-16 code units.",
  "Every practice evidence_event_uids array must be nonempty, ordered, duplicate-free, and contain only evidence from observation or inference findings.",
  "decision must contain exactly action and skip_reason. action must be reviewed or skipped. skip_reason must be null, no_reusable_content, duplicate_low_value, or insufficient_interpretation.",
  "For reviewed, skip_reason must be null. For skipped, skip_reason must be non-null and findings, reusable_practices, failure_analysis, and failure_analysis_evidence_event_uids must all be empty/null.",
  "Evidence arrays contain only input event_uid values. Labels such as f1 and p1 are never evidence. Valid: evidence_event_uids:[E1]. Invalid: evidence_event_uids:[f1].",
  "Default decision: {action:\"skipped\",skip_reason:\"no_reusable_content\"}. A skipped result keeps findings, reusable_practices, failure_analysis, and failure_analysis_evidence_event_uids empty/null; objective and process_summary remain factual and outcome_evidence_event_uids remains present.",
  "A reviewed result has exactly one reusable_practices entry, 1-4 findings, at least one observation or inference finding supporting that practice, no finding with kind practice, and failure_analysis and failure_analysis_evidence_event_uids both null.",
  "Use reviewed only when direct evidence establishes a conditional, transferable method beyond normal tool use. Otherwise keep the default skipped decision.",
  "For user_cancelled, outcome is cancelled; for session_compact or session_shutdown, outcome is interrupted. Outcome evidence must include the terminal event. For any terminal boundary event (user_cancelled, session_compact, or session_shutdown), decision must be skipped: never infer intent, cause, responsibility, error status, or events after the terminal event.",
  "A tool_result error proves only that result was an error; do not attribute a cause. objective and process_summary state only observable events.",
  "Do not add any keys. The deterministic Core validator is final.",
].join("\n");

const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "::1": true };
type ReviewFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface OpenAIReviewAdapterOptions {
  endpoint: string;
  apiKey?: string;
  key?: string;
  model: string;
  timeoutMs?: number;
  timeout?: number;
  fetch?: ReviewFetch;
  trustedHttpHosts?: readonly string[];
  promptContractVersion?: ReviewPromptContractVersion;
}

export class OpenAIReviewModelAdapter implements ExecutionReviewModelAdapter {
  readonly endpoint: string;
  readonly model: string;
  readonly promptContractVersion: ReviewPromptContractVersion;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: ReviewFetch;
  private readonly systemPrompt: string;

  constructor(options: OpenAIReviewAdapterOptions) {
    this.endpoint = normalizeReviewEndpoint(options.endpoint, options.trustedHttpHosts);
    const apiKey = options.apiKey ?? options.key;
    const timeoutMs = options.timeoutMs ?? options.timeout;
    const promptContractVersion = options.promptContractVersion ?? REVIEW_MANUAL_PROMPT_CONTRACT;
    if (typeof apiKey !== "string" || apiKey.length === 0) throw new TypeError("Review API key is required.");
    if (typeof options.model !== "string" || options.model.length === 0) throw new TypeError("Review model is required.");
    if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("Review timeout is invalid.");
    if (promptContractVersion !== REVIEW_MANUAL_PROMPT_CONTRACT && promptContractVersion !== REVIEW_MANUAL_PROMPT_CONTRACT_V2) throw new TypeError("Review prompt contract version is invalid.");
    this.apiKey = apiKey;
    this.model = options.model;
    this.promptContractVersion = promptContractVersion;
    this.systemPrompt = promptContractVersion === REVIEW_MANUAL_PROMPT_CONTRACT_V2 ? EXECUTION_REVIEW_SYSTEM_PROMPT_V2 : EXECUTION_REVIEW_SYSTEM_PROMPT;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async review(input: ExecutionReviewModelInput): Promise<unknown> {
    const controller = new AbortController();
    const deadline = performance.now() + this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = JSON.stringify({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: canonicalize(input as never) },
      ],
    });
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      if (performance.now() >= deadline) throw new Error("Review model request failed.");
      if (!response.ok || response.status < 200 || response.status >= 300) throw new Error("Review model request failed.");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length.trim()) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error("Review model response is too large.");
      const text = await readResponseText(response, MAX_RESPONSE_BYTES, controller.signal);
      if (performance.now() >= deadline) throw new Error("Review model request failed.");
      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error("Review model response is invalid.");
      }
      if (performance.now() >= deadline) throw new Error("Review model request failed.");
      if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length < 1) throw new Error("Review model response is invalid.");
      const first = envelope.choices[0];
      if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string" || first.message.content.length === 0) throw new Error("Review model response is invalid.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(first.message.content);
      } catch {
        throw new Error("Review model response is invalid.");
      }
      if (performance.now() >= deadline) throw new Error("Review model request failed.");
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.message === "Review model response is too large.") throw error;
      throw new Error("Review model request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
export { OpenAIReviewModelAdapter as OpenAICompatibleReviewModelAdapter };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readResponseText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new Error("Review model response is too large.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Review model request failed.")), { once: true });
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abort]);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new Error("Review model response is too large.");
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
export function normalizeReviewTrustedHttpHost(value: string): string {
  if (typeof value !== "string" || value.length === 0 || !/^[\p{L}\p{N}.-]+$/u.test(value)) throw new TypeError("Review trusted HTTP host is invalid.");
  if (/^\d+(?:\.\d+){3}$/u.test(value)) return normalizeReviewIPv4Host(value);
  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) throw new TypeError("Review trusted HTTP host is invalid.");
  let url: URL;
  try {
    url = new URL(`http://${value}`);
  } catch {
    throw new TypeError("Review trusted HTTP host is invalid.");
  }
  if (url.username !== "" || url.password !== "" || url.port !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new TypeError("Review trusted HTTP host is invalid.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^[\x00-\x7F]+$/u.test(value) && host !== value.toLowerCase()) throw new TypeError("Review trusted HTTP host is invalid.");
  if (!host || host.length > 253 || !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) throw new TypeError("Review trusted HTTP host is invalid.");
  return host;
}

function normalizeReviewIPv4Host(value: string): string {
  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((octet) => (octet.length > 1 && octet.startsWith("0")) || Number(octet) > 255)) throw new TypeError("Review trusted HTTP host is invalid.");
  return octets.map((octet) => String(Number(octet))).join(".");
}

function normalizeTrustedHttpHosts(value: readonly string[] | undefined): ReadonlySet<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) throw new TypeError("Review trusted HTTP hosts are invalid.");
  return new Set(value.map(normalizeReviewTrustedHttpHost));
}

export function normalizeReviewEndpoint(value: string, trustedHttpHosts?: readonly string[]): string {
  const trustedHosts = normalizeTrustedHttpHosts(trustedHttpHosts);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Review API URL is invalid.");
  }
  if (!url.protocol || (url.protocol !== "https:" && url.protocol !== "http:")) throw new TypeError("Review API URL is invalid.");
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new TypeError("Review API URL is invalid.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol === "http:" && LOOPBACK_HOSTS[host] !== true && !trustedHosts.has(host)) throw new TypeError("Review API URL must use HTTPS.");
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path}/chat/completions`;
  return url.toString();
}
