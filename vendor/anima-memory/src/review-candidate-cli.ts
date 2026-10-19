import { MemoryCore } from "./memory-core.ts";
import { normalizeReviewTrustedHttpHost, OpenAIReviewModelAdapter, REVIEW_MANUAL_PROMPT_CONTRACT_V2 } from "./openai-review-adapter.ts";
import type { ExecutionReviewOperationResult } from "./execution-review-types.ts";
import { realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 120_000;
const LEASE_TTL_MS = 300_000;
const FIXED_PROMPT_CONTRACT = REVIEW_MANUAL_PROMPT_CONTRACT_V2;

type Environment = Record<string, string | undefined>;

export interface ReviewCandidateArguments {
  candidate_uid: string;
  prompt_contract_version: typeof FIXED_PROMPT_CONTRACT;
  owner: string;
}

export interface ReviewCandidateConfiguration {
  api_url: string;
  api_key: string;
  model: string;
  config_path?: string;
  timeout_ms: number;
  trusted_http_host?: string;
}

export class ReviewCandidatePreflightError extends Error {
  constructor() {
    super("Review candidate preflight failed.");
    this.name = "ReviewCandidatePreflightError";
  }
}

export function parseReviewCandidateArgs(argv: readonly string[]): ReviewCandidateArguments {
  if (argv.length !== 6) throw new ReviewCandidatePreflightError();
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--candidate" && flag !== "--prompt-contract" && flag !== "--owner") || value === undefined || value.length === 0 || values[flag] !== undefined) throw new ReviewCandidatePreflightError();
    values[flag] = value;
  }
  const candidate_uid = values["--candidate"]!;
  const prompt_contract_version = values["--prompt-contract"];
  const ownerRaw = values["--owner"]!;
  if (/[\u0000-\u001f\u007f]/u.test(ownerRaw)) throw new ReviewCandidatePreflightError();
  const owner = ownerRaw.trim();
  if (candidate_uid.length === 0 || /[\u0000-\u001f\u007f]/u.test(candidate_uid) || prompt_contract_version !== FIXED_PROMPT_CONTRACT || owner.length === 0 || owner.length > 256) throw new ReviewCandidatePreflightError();
  return { candidate_uid, prompt_contract_version: FIXED_PROMPT_CONTRACT, owner };
}

function developmentConfigPath(value: string): string {
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const users = join(checkout, ".anima-dev", "users");
  const target = resolve(value);
  const lexical = relative(users, target);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[/\\]config\.json$/.test(lexical)) {
    throw new ReviewCandidatePreflightError();
  }
  try {
    const realCheckout = realpathSync(checkout);
    const realUsers = realpathSync(users);
    const realTarget = realpathSync(target);
    if (realUsers !== join(realCheckout, ".anima-dev", "users") || relative(realUsers, realTarget) !== lexical) {
      throw new ReviewCandidatePreflightError();
    }
    return realTarget;
  } catch {
    throw new ReviewCandidatePreflightError();
  }
}

export function parseReviewCandidateConfiguration(env: Environment): ReviewCandidateConfiguration {
  const api_url = env.ANIMA_REVIEW_API_URL;
  const api_key = env.ANIMA_REVIEW_API_KEY;
  const model = env.ANIMA_REVIEW_MODEL;
  const timeoutRaw = env.ANIMA_REVIEW_TIMEOUT_MS;
  const trustedHttpHostRaw = env.ANIMA_REVIEW_TRUSTED_HTTP_HOST;
  if (api_url === undefined || api_key === undefined || model === undefined || api_url.length === 0 || api_key.length === 0 || model.length === 0) throw new ReviewCandidatePreflightError();
  let timeout_ms = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw !== undefined) {
    if (!/^\d+$/u.test(timeoutRaw)) throw new ReviewCandidatePreflightError();
    timeout_ms = Number(timeoutRaw);
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 240_000) throw new ReviewCandidatePreflightError();
  }
  let trusted_http_host: string | undefined;
  if (trustedHttpHostRaw !== undefined) {
    try {
      trusted_http_host = normalizeReviewTrustedHttpHost(trustedHttpHostRaw);
    } catch {
      throw new ReviewCandidatePreflightError();
    }
  }
  return {
    api_url,
    api_key,
    model,
    ...(env.ANIMA_MEMORY_CONFIG_PATH === undefined ? {} : { config_path: developmentConfigPath(env.ANIMA_MEMORY_CONFIG_PATH) }),
    ...(trusted_http_host === undefined ? {} : { trusted_http_host }),
    timeout_ms,
  };
}

export interface ReviewCandidateRunDependencies {
  createCore?: (adapter: OpenAIReviewModelAdapter, configPath?: string) => ReviewCoreLike;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
  now?: () => number;
}

interface ReviewCoreLike {
  initialize(): Promise<void>;
  reviewExecutionCandidate(input: { candidate_uid: string; lease_owner: string; lease_ttl_ms: number; prompt_contract_version: string; model_ref: string }): Promise<ExecutionReviewOperationResult>;
  close(): Promise<void>;
}

export async function runReviewCandidate(
  argv: readonly string[],
  env: Environment = process.env,
  dependencies: ReviewCandidateRunDependencies = {},
): Promise<number> {
  const writeStdout = dependencies.writeStdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = dependencies.writeStderr ?? ((text: string) => process.stderr.write(text));
  let args: ReviewCandidateArguments;
  let config: ReviewCandidateConfiguration;
  try {
    args = parseReviewCandidateArgs(argv);
    config = parseReviewCandidateConfiguration(env);
  } catch {
    writeStderr("review-candidate: preflight\n");
    return 2;
  }
  let adapter: OpenAIReviewModelAdapter;
  try {
    adapter = new OpenAIReviewModelAdapter({
      endpoint: config.api_url,
      apiKey: config.api_key,
      model: config.model,
      timeoutMs: config.timeout_ms,
      promptContractVersion: FIXED_PROMPT_CONTRACT,
      ...(config.trusted_http_host === undefined ? {} : { trustedHttpHosts: [config.trusted_http_host] }),
    });
  } catch {
    writeStderr("review-candidate: preflight\n");
    return 2;
  }
  let core: ReviewCoreLike;
  try {
    core = dependencies.createCore?.(adapter, config.config_path) ?? new MemoryCore({ configPath: config.config_path, reviewModelAdapter: adapter });
  } catch {
    writeStderr("review-candidate: preflight\n");
    return 2;
  }
  const started = (dependencies.now ?? (() => performance.now()))();
  try {
    await core.initialize();
    const result = await core.reviewExecutionCandidate({
      candidate_uid: args.candidate_uid,
      lease_owner: args.owner,
      lease_ttl_ms: LEASE_TTL_MS,
      prompt_contract_version: args.prompt_contract_version,
      model_ref: config.model,
    });
    const elapsed_ms = Math.max(0, Math.round((dependencies.now ?? (() => performance.now()))() - started));
    const output: Record<string, unknown> = {
      candidate_uid: args.candidate_uid,
      status: result.status,
      model_ref: config.model,
      prompt_contract_version: args.prompt_contract_version,
      elapsed_ms,
    };
    if (result.status === "reviewed") output.review_uid = result.review_uid;
    else if (result.status === "skipped") output.skip_reason = result.skip_reason;
    else if (result.status === "failed") output.code = result.code;
    writeStdout(`${JSON.stringify(output)}\n`);
    return exitCodeForResult(result);
  } catch {
    writeStderr("review-candidate: runtime\n");
    return 5;
  } finally {
    try {
      await core.close();
    } catch {
      // Core close is best effort; no credential or input details are emitted.
    }
  }
}

function exitCodeForResult(result: ExecutionReviewOperationResult): number {
  if (result.status === "reviewed" || result.status === "skipped") return 0;
  if (result.status === "busy" || result.status === "failed" && (result.code === "source_incomplete" || result.code === "identity_conflict")) return 3;
  if (result.status === "failed" && (result.code === "model_unavailable" || result.code === "model_failed" || result.code === "invalid_review")) return 4;
  if (result.status === "failed" && (result.code === "invalid_input" || result.code === "not_found")) return 2;
  return 5;
}

if (import.meta.main) {
  const exitCode = await runReviewCandidate(process.argv.slice(2));
  process.exitCode = exitCode;
}
