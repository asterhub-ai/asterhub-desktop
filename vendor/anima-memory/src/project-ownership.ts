import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { canonicalize } from "json-canonicalize";

export type ProjectOwnershipScope = {
  users_root: string;
  directory_id: string;
  directory: string;
  principal_uid: string;
};

export type ProjectOwnershipRecord = {
  schema_id: "anima.dev-project-ownership/v1";
  principal_uid: string;
  project_uid: string;
  identity_fingerprint: string;
};

const SCHEMA_ID = "anima.dev-project-ownership/v1" as const;
const PRINCIPAL_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const MARKER_NAME_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const inFlightRegistrations = new Map<string, { canonical: string; promise: Promise<void> }>();

type ProjectIdentity = { project_uid: string; identity_fingerprint: string };

function fail(message: string): never {
  throw new Error(`Project ownership: ${message}`);
}

function assertPrincipalUid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !PRINCIPAL_UID_PATTERN.test(value)) {
    fail("principal_uid must be a lowercase UUIDv4.");
  }
}

function assertProjectUid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !PROJECT_UID_PATTERN.test(value)) {
    fail("project_uid must be a lowercase UUIDv4 or UUIDv5.");
  }
}

function assertFingerprint(value: unknown): asserts value is string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    fail("identity_fingerprint must be 64 lowercase hexadecimal characters.");
  }
}

function assertScope(scope: ProjectOwnershipScope): string {
  if (scope === null || typeof scope !== "object") fail("scope is invalid.");
  assertPrincipalUid(scope.principal_uid);
  if (typeof scope.users_root !== "string" || scope.users_root.length === 0 || !isAbsolute(scope.users_root)) {
    fail("scope.users_root must be an absolute path.");
  }
  const usersRoot = resolve(scope.users_root);
  if (typeof scope.directory_id !== "string" || !PRINCIPAL_UID_PATTERN.test(scope.directory_id)) {
    fail("scope.directory_id must be a lowercase UUIDv4.");
  }
  if (typeof scope.directory !== "string" || scope.directory.length === 0) fail("scope.directory is invalid.");
  const suppliedDirectory = resolve(scope.directory);
  if (dirname(suppliedDirectory) !== usersRoot || basename(suppliedDirectory) !== scope.directory_id) {
    fail("scope.directory must be the direct scope.directory_id child of scope.users_root.");
  }
  return suppliedDirectory;
}

function canonical(value: ProjectOwnershipRecord): string {
  return canonicalize(value as never);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * lstat and realpath every existing component. Exact string equality also preserves
 * case on Windows instead of relying on its case-insensitive path comparison.
 */
async function assertPath(path: string, expectedKind: "directory" | "file"): Promise<void> {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  const rootInfo = await lstat(parsed.root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail("filesystem root is not a regular directory.");
  const actualRoot = await realpath(parsed.root);
  if (actualRoot !== parsed.root && actualRoot !== parsed.root.slice(0, -1)) {
    fail("filesystem root resolves through a different path or case.");
  }
  const components = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (isMissing(error)) fail("a required filesystem component is missing.");
      throw error;
    }
    if (info.isSymbolicLink()) fail("symbolic links and junctions are not allowed.");
    const isLeaf = index === components.length - 1;
    if (!isLeaf && !info.isDirectory()) fail("an ancestor is not a directory.");
    if (isLeaf && expectedKind === "directory" && !info.isDirectory()) fail("an expected directory is not a directory.");
    if (isLeaf && expectedKind === "file" && !info.isFile()) fail("an expected marker is not a regular file.");
    const actual = await realpath(current);
    if (actual !== current) fail("filesystem component resolves through a different path or case.");
  }
}

async function assertBaseDirectories(scope: ProjectOwnershipScope): Promise<{ data: string; projects: string }> {
  const directory = assertScope(scope);
  await assertPath(resolve(scope.users_root), "directory");
  await assertPath(directory, "directory");
  const data = join(directory, "data");
  await assertPath(data, "directory");
  return { data, projects: join(data, "projects") };
}

async function ensureDirectory(path: string, mode?: number): Promise<void> {
  try {
    if (mode === undefined) await mkdir(path);
    else await mkdir(path, { mode });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
  }
  await assertPath(path, "directory");
  if (mode !== undefined && process.platform !== "win32" && ((await lstat(path)).mode & 0o077) !== 0) {
    fail("journal directory permissions are not private.");
  }
}

async function syncDirectoryOnLinux(directory: string): Promise<void> {
  if (process.platform !== "linux") return;
  await assertPath(directory, "directory");
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validateRecord(value: unknown, principalUid: string, expectedProjectUid: string): ProjectOwnershipRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("marker JSON must be an object.");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 4 || keys[0] !== "identity_fingerprint" || keys[1] !== "principal_uid" || keys[2] !== "project_uid" || keys[3] !== "schema_id") {
    fail("marker must contain exactly the four ownership fields.");
  }
  if (record.schema_id !== SCHEMA_ID) fail("marker schema_id is invalid.");
  const recordPrincipalUid = record.principal_uid;
  const recordProjectUid = record.project_uid;
  const identityFingerprint = record.identity_fingerprint;
  assertPrincipalUid(recordPrincipalUid);
  assertProjectUid(recordProjectUid);
  assertFingerprint(identityFingerprint);
  if (recordPrincipalUid !== principalUid || recordProjectUid !== expectedProjectUid) {
    fail("marker identity does not match its directory and filename.");
  }
  return {
    schema_id: SCHEMA_ID,
    principal_uid: recordPrincipalUid,
    project_uid: recordProjectUid,
    identity_fingerprint: identityFingerprint,
  };
}

async function readCanonicalRecord(path: string, principalUid: string, expectedProjectUid: string): Promise<{ record: ProjectOwnershipRecord; text: string }> {
  await assertPath(path, "file");
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags);
  let bytes: Buffer;
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile()) fail("ownership marker is not a regular file.");
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  // Recheck after opening so a replacement during the read cannot silently pass.
  await assertPath(path, "file");
  const text = bytes.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("ownership marker contains malformed JSON.");
  }
  const record = validateRecord(parsed, principalUid, expectedProjectUid);
  if (canonical(record) !== text) fail("ownership marker is not byte-for-byte canonical JSON.");
  return { record, text };
}

async function authorizeRegistration(authorizeBeforePublish?: () => Promise<boolean>): Promise<void> {
  if (authorizeBeforePublish === undefined) return;
  let authorized: boolean;
  try {
    authorized = await authorizeBeforePublish();
  } catch {
    fail("registration is not authorized.");
  }
  if (authorized !== true) fail("registration is not authorized.");
}

async function registerOnce(
  scope: ProjectOwnershipScope,
  record: ProjectOwnershipRecord,
  encoded: string,
  authorizeBeforePublish?: () => Promise<boolean>,
): Promise<void> {
  const { data, projects } = await assertBaseDirectories(scope);
  const journalDirectory = join(data, "project-registration-journal");
  await ensureDirectory(projects);
  const markerPath = join(projects, `${record.project_uid}.json`);
  const existing = (await listProjectOwnership(scope)).find(({ project_uid }) => project_uid === record.project_uid);
  if (existing !== undefined) {
    if (canonical(existing) !== encoded) fail("project UID is already registered with conflicting identity.");
    await authorizeRegistration(authorizeBeforePublish);
    return;
  }
  await ensureDirectory(journalDirectory, 0o700);
  let journalPath: string;
  let handle: FileHandle;
  while (true) {
    journalPath = join(journalDirectory, `${randomUUID()}.json`);
    try {
      handle = await open(journalPath, "wx", 0o600);
      break;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  try {
    await handle.writeFile(encoded, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertPath(journalPath, "file");
  await syncDirectoryOnLinux(journalDirectory);
  await authorizeRegistration(authorizeBeforePublish);
  try {
    await link(journalPath, markerPath);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
    const existing = await readCanonicalRecord(markerPath, record.principal_uid, record.project_uid);
    if (existing.text !== encoded) fail("project UID is already registered with conflicting identity.");
  }
  await assertPath(markerPath, "file");
  await syncDirectoryOnLinux(projects);
}

export async function registerProjectOwnership(
  scope: ProjectOwnershipScope,
  identity: ProjectIdentity,
  authorizeBeforePublish?: () => Promise<boolean>,
): Promise<void> {
  const directory = assertScope(scope);
  assertProjectUid(identity?.project_uid);
  assertFingerprint(identity?.identity_fingerprint);
  const record: ProjectOwnershipRecord = {
    schema_id: SCHEMA_ID,
    principal_uid: scope.principal_uid,
    project_uid: identity.project_uid,
    identity_fingerprint: identity.identity_fingerprint,
  };
  const encoded = canonical(record);
  const markerPath = join(directory, "data", "projects", `${record.project_uid}.json`);
  const active = inFlightRegistrations.get(markerPath);
  if (active !== undefined) {
    if (active.canonical !== encoded) fail("project UID is already being registered with conflicting identity.");
    await active.promise;
    await authorizeRegistration(authorizeBeforePublish);
    return;
  }
  const promise = registerOnce(scope, record, encoded, authorizeBeforePublish);
  inFlightRegistrations.set(markerPath, { canonical: encoded, promise });
  try {
    await promise;
  } finally {
    if (inFlightRegistrations.get(markerPath)?.promise === promise) inFlightRegistrations.delete(markerPath);
  }
}

export async function listProjectOwnership(scope: ProjectOwnershipScope): Promise<readonly ProjectOwnershipRecord[]> {
  const { projects } = await assertBaseDirectories(scope);
  try {
    await lstat(projects);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  await assertPath(projects, "directory");
  const names = await readdir(projects);
  const records: ProjectOwnershipRecord[] = [];
  for (const name of names) {
    const match = MARKER_NAME_PATTERN.exec(name);
    if (match === null) fail("projects directory contains an unrecognized entry.");
    const projectUid = match[1]!;
    const { record } = await readCanonicalRecord(join(projects, name), scope.principal_uid, projectUid);
    records.push(record);
  }
  records.sort((left, right) => left.project_uid < right.project_uid ? -1 : left.project_uid > right.project_uid ? 1 : 0);
  return records;
}
