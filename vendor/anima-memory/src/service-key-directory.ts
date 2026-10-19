import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { canonicalize } from "json-canonicalize";

const SCHEMA_ID = "anima.service-key-directory/v2" as const;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UNAUTHORIZED = { status: "failed", code: "unauthorized" } as const;
const UNAVAILABLE = { status: "failed", code: "unavailable" } as const;

type Entry = {
  active: boolean;
  database: string;
  directory_id: string;
  graph_uri: string;
  key_sha256: string;
  principal_uid: string;
};

type Authorized = {
  status: "authorized";
  binding: {
    principal_uid: string;
    directory_id: string;
    database: string;
    graph_uri: string;
    users_root: string;
    directory: string;
  };
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validKey(key: unknown): key is string {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return false;
  try {
    const decoded = Buffer.from(key, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === key;
  } catch {
    return false;
  }
}

export function validGraphUri(uri: unknown): uri is string {
  if (typeof uri !== "string") return false;
  try {
    const url = new URL(uri);
    if ((url.protocol !== "bolt:" && url.protocol !== "bolt+s:") ||
      !url.hostname || url.hostname !== url.hostname.toLowerCase() || url.hostname.includes("%") ||
      url.port === "" || url.pathname !== "" || url.search !== "" || url.hash !== "" ||
      url.username !== "" || url.password !== "" || uri.includes("@") || uri.includes("?") || uri.includes("#")) return false;

    const port = Number(url.port);
    return Number.isInteger(port) && port >= 1 && port <= 65535 && url.href === uri;
  } catch {
    return false;
  }
}

function validateManifest(value: unknown): Entry[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const manifest = value as Record<string, unknown>;
  if (!exactKeys(manifest, ["entries", "schema_id"]) || manifest.schema_id !== SCHEMA_ID || !Array.isArray(manifest.entries)) {
    throw new Error();
  }

  const entries: Entry[] = [];
  const principalBindings = new Map<string, { directory_id: string; graph_uri: string; database: string }>();
  const directories = new Map<string, string>();
  const graphUris = new Map<string, string>();
  const hashes = new Set<string>();

  for (const raw of manifest.entries) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    const record = raw as Record<string, unknown>;
    if (!exactKeys(record, ["active", "database", "directory_id", "graph_uri", "key_sha256", "principal_uid"])) throw new Error();
    const { active, database, directory_id, graph_uri, key_sha256, principal_uid } = record;
    if (typeof active !== "boolean" || typeof principal_uid !== "string" || !UUID_V4_PATTERN.test(principal_uid) ||
      typeof directory_id !== "string" || !UUID_V4_PATTERN.test(directory_id) ||
      typeof key_sha256 !== "string" || !SHA256_PATTERN.test(key_sha256) || hashes.has(key_sha256) ||
      database !== "neo4j" || !validGraphUri(graph_uri)) throw new Error();

    const existing = principalBindings.get(principal_uid);
    if (existing && (existing.directory_id !== directory_id || existing.graph_uri !== graph_uri || existing.database !== database)) throw new Error();
    const otherPrincipalForDirectory = directories.get(directory_id);
    if (otherPrincipalForDirectory !== undefined && otherPrincipalForDirectory !== principal_uid) throw new Error();
    const otherPrincipalForGraphUri = graphUris.get(graph_uri);
    if (otherPrincipalForGraphUri !== undefined && otherPrincipalForGraphUri !== principal_uid) throw new Error();

    principalBindings.set(principal_uid, { directory_id, graph_uri, database });
    directories.set(directory_id, principal_uid);
    graphUris.set(graph_uri, principal_uid);
    hashes.add(key_sha256);
    entries.push({ active, database, directory_id, graph_uri, key_sha256, principal_uid });
  }
  return entries;
}

/**
 * Enumerate active principal bindings from the complete, canonical registry.
 * Directory availability is intentionally left to the per-binding consumer.
 */
export async function listActiveServicePrincipals(
  usersRoot: string,
): Promise<{
  status: "ready";
  bindings: Array<{
    principal_uid: string;
    directory_id: string;
    database: string;
    graph_uri: string;
    users_root: string;
    directory: string;
  }>;
} | { status: "failed"; code: "unavailable" }> {
  try {
    if (typeof usersRoot !== "string" || !isAbsolute(usersRoot) || resolve(usersRoot) !== usersRoot) return UNAVAILABLE;
    await assertRealPath(usersRoot, "directory");
    const manifest = await readManifest(usersRoot);
    const entries = validateManifest(manifest);
    const principals = new Set<string>();
    const bindings: Array<{
      principal_uid: string;
      directory_id: string;
      database: string;
      graph_uri: string;
      users_root: string;
      directory: string;
    }> = [];
    for (const entry of entries) {
      if (!entry.active || principals.has(entry.principal_uid)) continue;
      principals.add(entry.principal_uid);
      bindings.push({
        principal_uid: entry.principal_uid,
        directory_id: entry.directory_id,
        database: entry.database,
        graph_uri: entry.graph_uri,
        users_root: usersRoot,
        directory: join(usersRoot, entry.directory_id),
      });
    }
    return { status: "ready", bindings };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Resolve a transmitted service Key against the complete, canonical, read-only registry.
 */
export async function resolveServiceKey(
  usersRoot: string,
  key: unknown,
): Promise<Authorized | { status: "failed"; code: "unauthorized" | "unavailable" }> {
  if (!validKey(key)) return UNAUTHORIZED;
  try {
    if (typeof usersRoot !== "string" || !isAbsolute(usersRoot) || resolve(usersRoot) !== usersRoot) return UNAVAILABLE;
    await assertRealPath(usersRoot, "directory");
    const manifest = await readManifest(usersRoot);
    const entries = validateManifest(manifest);
    const keyHash = createHash("sha256").update(key, "utf8").digest("hex");
    const match = entries.find((entry) => entry.key_sha256 === keyHash);
    if (!match || !match.active) return UNAUTHORIZED;
    const directory = await assertPrincipalDirectory(usersRoot, match.directory_id);
    return {
      status: "authorized",
      binding: {
        principal_uid: match.principal_uid,
        directory_id: match.directory_id,
        database: match.database,
        graph_uri: match.graph_uri,
        users_root: usersRoot,
        directory,
      },
    };
  } catch {
    return UNAVAILABLE;
  }
}

/** Validate every existing path component without following symbolic links or junctions. */
async function assertRealPath(path: string, expectedKind: "directory" | "file"): Promise<void> {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  const rootInfo = await lstat(parsed.root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error();
  const actualRoot = await realpath(parsed.root);
  if (actualRoot !== parsed.root && actualRoot !== parsed.root.slice(0, -1)) throw new Error();

  const components = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error();
    const leaf = index === components.length - 1;
    if (!leaf && !info.isDirectory()) throw new Error();
    if (leaf && expectedKind === "directory" && !info.isDirectory()) throw new Error();
    if (leaf && expectedKind === "file" && !info.isFile()) throw new Error();
    if (await realpath(current) !== current) throw new Error();
  }
}

async function readManifest(usersRoot: string): Promise<unknown> {
  const path = join(usersRoot, "keys.json");
  await assertRealPath(path, "file");
  const pathBeforeOpen = await lstat(path);
  if (!pathBeforeOpen.isFile() || pathBeforeOpen.isSymbolicLink() || await realpath(path) !== path) throw new Error();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== pathBeforeOpen.dev || before.ino !== pathBeforeOpen.ino) throw new Error();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfterRead = await lstat(path);
    if (!pathAfterRead.isFile() || pathAfterRead.dev !== before.dev || pathAfterRead.ino !== before.ino) throw new Error();
    if (await realpath(path) !== path) throw new Error();
    await assertRealPath(path, "file");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    if (canonicalize(parsed as never) !== text) throw new Error();
    return parsed;
  } finally {
    await handle.close();
  }
}

async function assertPrincipalDirectory(usersRoot: string, directoryId: string): Promise<string> {
  const directory = join(usersRoot, directoryId);
  await assertRealPath(directory, "directory");
  return directory;
}
