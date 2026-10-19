import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { canonicalize } from "json-canonicalize";
import { listActiveServicePrincipals, resolveServiceKey } from "../src/service-key-directory.ts";

const SCHEMA_ID = "anima.service-key-directory/v2";
const PRINCIPAL_A = "13345678-e89b-4d3a-8456-426614174010";
const PRINCIPAL_B = "23345678-e89b-4d3a-8456-426614174020";
const PRINCIPAL_C = "33345678-e89b-4d3a-8456-426614174030";
const PRINCIPAL_D = "43345678-e89b-4d3a-8456-426614174040";
const PRINCIPAL_E = "53345678-e89b-4d3a-8456-426614174050";
const DIRECTORY_A = "73345678-e89b-4d3a-8456-426614174070";
const DIRECTORY_B = "83345678-e89b-4d3a-8456-426614174080";
const DIRECTORY_C = "93345678-e89b-4d3a-8456-426614174090";
const DIRECTORY_D = "a3345678-e89b-4d3a-8456-4266141740a0";
const DIRECTORY_E = "b3345678-e89b-4d3a-8456-4266141740b0";
type Entry = { active: boolean; database: string; directory_id: string; graph_uri: string; key_sha256: string; principal_uid: string };

function key(): string {
  return randomBytes(32).toString("base64url");
}

function graphUri(principal_uid: string): string {
  return `bolt://graph-${principal_uid.replaceAll("-", "")}.example:7687`;
}

function entry(transmittedKey: string, principal_uid: string, directory_id: string, active = true, graph_uri = graphUri(principal_uid)): Entry {
  return {
    active,
    database: "neo4j",
    directory_id,
    graph_uri,
    key_sha256: createHash("sha256").update(transmittedKey, "utf8").digest("hex"),
    principal_uid,
  };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anima-service-key-directory-"));
  for (const directoryId of [DIRECTORY_A, DIRECTORY_B, DIRECTORY_C, DIRECTORY_D, DIRECTORY_E]) {
    await mkdir(join(root, directoryId));
  }
  return root;
}

async function writeManifest(root: string, entries: Entry[], canonical = true): Promise<void> {
  const value = { entries, schema_id: SCHEMA_ID };
  const text = canonical ? canonicalize(value as never) : JSON.stringify(value, null, 2);
  await writeFile(join(root, "keys.json"), text, "utf8");
}

async function replaceManifestAtomically(root: string, entries: Entry[]): Promise<void> {
  const temporary = join(root, `keys-${randomUUID()}.tmp`);
  await writeFile(temporary, canonicalize({ entries, schema_id: SCHEMA_ID } as never), "utf8");
  await rename(temporary, join(root, "keys.json"));
}

async function moveDirectoryAside(root: string, directoryId: string): Promise<void> {
  await rename(join(root, directoryId), join(root, `${directoryId}-unavailable`));
}
describe("service key directory", () => {
  test("lists five active principal bindings once each despite key rotation", async () => {
    const root = await fixture();
    const keyA1 = key();
    const keyA2 = key();
    const keyB = key();
    const keyC = key();
    const keyD = key();
    const keyE = key();
    await writeManifest(root, [
      entry(keyA1, PRINCIPAL_A, DIRECTORY_A),
      entry(keyB, PRINCIPAL_B, DIRECTORY_B),
      entry(keyC, PRINCIPAL_C, DIRECTORY_C),
      entry(keyD, PRINCIPAL_D, DIRECTORY_D),
      entry(keyE, PRINCIPAL_E, DIRECTORY_E),
      entry(keyA2, PRINCIPAL_A, DIRECTORY_A),
    ]);
    await moveDirectoryAside(root, DIRECTORY_B);

    expect(await listActiveServicePrincipals(root)).toEqual({
      status: "ready",
      bindings: [
        { principal_uid: PRINCIPAL_A, directory_id: DIRECTORY_A, database: "neo4j", graph_uri: graphUri(PRINCIPAL_A), users_root: root, directory: join(root, DIRECTORY_A) },
        { principal_uid: PRINCIPAL_B, directory_id: DIRECTORY_B, database: "neo4j", graph_uri: graphUri(PRINCIPAL_B), users_root: root, directory: join(root, DIRECTORY_B) },
        { principal_uid: PRINCIPAL_C, directory_id: DIRECTORY_C, database: "neo4j", graph_uri: graphUri(PRINCIPAL_C), users_root: root, directory: join(root, DIRECTORY_C) },
        { principal_uid: PRINCIPAL_D, directory_id: DIRECTORY_D, database: "neo4j", graph_uri: graphUri(PRINCIPAL_D), users_root: root, directory: join(root, DIRECTORY_D) },
        { principal_uid: PRINCIPAL_E, directory_id: DIRECTORY_E, database: "neo4j", graph_uri: graphUri(PRINCIPAL_E), users_root: root, directory: join(root, DIRECTORY_E) },
      ],
    });
  });

  test("returns an empty roster for a valid empty or all-inactive registry", async () => {
    const root = await fixture();
    await writeManifest(root, []);
    expect(await listActiveServicePrincipals(root)).toEqual({ status: "ready", bindings: [] });

    await writeManifest(root, [entry(key(), PRINCIPAL_A, DIRECTORY_A, false)]);
    expect(await listActiveServicePrincipals(root)).toEqual({ status: "ready", bindings: [] });
  });

  test("rejects v1 manifests and databases other than neo4j", async () => {
    const root = await fixture();
    const transmittedKey = key();
    const currentEntry = entry(transmittedKey, PRINCIPAL_A, DIRECTORY_A);
    const legacyEntry = {
      active: currentEntry.active,
      database: "legacy-database",
      directory_id: currentEntry.directory_id,
      key_sha256: currentEntry.key_sha256,
      principal_uid: currentEntry.principal_uid,
    };
    await writeFile(join(root, "keys.json"), canonicalize({ entries: [legacyEntry], schema_id: "anima.service-key-directory/v1" } as never), "utf8");
    expect(await listActiveServicePrincipals(root)).toEqual({ status: "failed", code: "unavailable" });
    expect(await resolveServiceKey(root, transmittedKey)).toEqual({ status: "failed", code: "unavailable" });

    await writeManifest(root, [{ ...currentEntry, database: "legacy-database" }]);
    expect(await listActiveServicePrincipals(root)).toEqual({ status: "failed", code: "unavailable" });
    expect(await resolveServiceKey(root, transmittedKey)).toEqual({ status: "failed", code: "unavailable" });
  });

  test("requires canonical JSON bytes, including rejection of duplicate JSON keys", async () => {
    const root = await fixture();
    const validKey = key();
    const row = entry(validKey, PRINCIPAL_A, DIRECTORY_A);
    await writeManifest(root, [row], false);
    expect(await resolveServiceKey(root, validKey)).toEqual({ status: "failed", code: "unavailable" });

    const duplicate = `{"entries":[],"entries":[],"schema_id":"${SCHEMA_ID}"}`;
    await writeFile(join(root, "keys.json"), duplicate, "utf8");
    expect(await resolveServiceKey(root, validKey)).toEqual({ status: "failed", code: "unavailable" });
    await writeFile(join(root, "keys.json"), canonicalize({ entries: [], schema_id: SCHEMA_ID } as never), "utf8");
    expect(await resolveServiceKey(root, validKey)).toEqual({ status: "failed", code: "unauthorized" });
  });

  test("resolves shared-database principals to distinct graph instances and preserves a principal URI on rotation", async () => {
    const root = await fixture();
    const keyA1 = key();
    const keyA2 = key();
    const keyB = key();
    await writeManifest(root, [entry(keyA1, PRINCIPAL_A, DIRECTORY_A), entry(keyA2, PRINCIPAL_A, DIRECTORY_A), entry(keyB, PRINCIPAL_B, DIRECTORY_B)]);

    const authorizedA = await resolveServiceKey(root, keyA1);
    const authorizedB = await resolveServiceKey(root, keyB);
    expect(authorizedA).toEqual({ status: "authorized", binding: {
      principal_uid: PRINCIPAL_A,
      directory_id: DIRECTORY_A,
      database: "neo4j",
      graph_uri: graphUri(PRINCIPAL_A),
      users_root: root,
      directory: join(root, DIRECTORY_A),
    } });
    expect(authorizedB).toMatchObject({ status: "authorized", binding: {
      principal_uid: PRINCIPAL_B,
      directory_id: DIRECTORY_B,
      database: "neo4j",
      graph_uri: graphUri(PRINCIPAL_B),
    } });
    expect(authorizedA.status === "authorized" && authorizedB.status === "authorized" && authorizedA.binding.database === authorizedB.binding.database &&
      authorizedA.binding.graph_uri !== authorizedB.binding.graph_uri).toBe(true);

    await replaceManifestAtomically(root, [entry(keyA2, PRINCIPAL_A, DIRECTORY_A), entry(keyB, PRINCIPAL_B, DIRECTORY_B)]);
    expect(await resolveServiceKey(root, keyA1)).toEqual({ status: "failed", code: "unauthorized" });
    expect(await resolveServiceKey(root, keyA2)).toMatchObject({ status: "authorized", binding: {
      principal_uid: PRINCIPAL_A,
      directory_id: DIRECTORY_A,
      database: "neo4j",
      graph_uri: graphUri(PRINCIPAL_A),
    } });
  });

  test("rejects unknown and inactive keys without probing inactive directories", async () => {
    const root = await fixture();
    const inactiveKey = key();
    await writeManifest(root, [entry(inactiveKey, PRINCIPAL_B, DIRECTORY_B, false)]);
    await moveDirectoryAside(root, DIRECTORY_B);
    expect(await resolveServiceKey(root, inactiveKey)).toEqual({ status: "failed", code: "unauthorized" });
    expect(await resolveServiceKey(root, key())).toEqual({ status: "failed", code: "unauthorized" });
  });

  test("rejects malformed keys before inspecting a broken registry and emits only generic statuses", async () => {
    const missing = resolve(join(tmpdir(), `missing-service-registry-${randomUUID()}`));
    const malformed = await resolveServiceKey(missing, "secret-not-a-key");
    expect(malformed).toEqual({ status: "failed", code: "unauthorized" });
    expect(JSON.stringify(malformed)).not.toContain("secret-not-a-key");
    expect(await resolveServiceKey("relative/users", key())).toEqual({ status: "failed", code: "unavailable" });
    expect(await resolveServiceKey(missing, key())).toEqual({ status: "failed", code: "unavailable" });
  });

  test("accepts canonical Bolt schemes and rejects invalid or noncanonical graph URIs", async () => {
    const root = await fixture();
    const transmittedKey = key();
    for (const uri of [
      "https://graph.example:7687",
      "neo4j://graph.example:7687",
      "bolt://graph.example:7687/",
      "bolt://user:password@graph.example:7687",
      "bolt://@graph.example:7687",
      "bolt://graph.example",
      "bolt://graph.example:0",
      "bolt://graph.example:65536",
      "bolt://graph.example:07687",
      "bolt://GRAPH.EXAMPLE:7687",
      "bolt://graph.example:7687?database=neo4j",
      "bolt://graph.example:7687#fragment",
      "bolt://graph.example:7687?",
      "bolt://graph.example:7687#",
      "bolt://:7687",
    ]) {
      await writeManifest(root, [entry(transmittedKey, PRINCIPAL_A, DIRECTORY_A, true, uri)]);
      expect(await listActiveServicePrincipals(root)).toEqual({ status: "failed", code: "unavailable" });
      expect(await resolveServiceKey(root, transmittedKey)).toEqual({ status: "failed", code: "unavailable" });
    }

    const secureUri = "bolt+s://secure-graph.example:17687";
    await writeManifest(root, [entry(transmittedKey, PRINCIPAL_A, DIRECTORY_A, true, secureUri)]);
    expect(await resolveServiceKey(root, transmittedKey)).toMatchObject({
      status: "authorized",
      binding: { database: "neo4j", graph_uri: secureUri },
    });
  });

  test("validates key, principal, directory, and graph URI conflicts across inactive entries", async () => {
    const root = await fixture();
    const keyA = key();
    const keyB = key();
    const a = entry(keyA, PRINCIPAL_A, DIRECTORY_A);
    const duplicateHashInactive = { ...entry(keyA, PRINCIPAL_B, DIRECTORY_B, false), key_sha256: a.key_sha256 };
    const conflictPrincipal = entry(keyB, PRINCIPAL_A, DIRECTORY_B, false);
    const sharedDirectory = entry(keyB, PRINCIPAL_B, DIRECTORY_A, false);
    const sharedGraphUri = entry(keyB, PRINCIPAL_B, DIRECTORY_B, false, graphUri(PRINCIPAL_A));
    const changedPrincipalUri = entry(keyB, PRINCIPAL_A, DIRECTORY_A, false, "bolt://other-graph.example:7687");
    for (const entries of [
      [a, duplicateHashInactive],
      [a, conflictPrincipal],
      [a, sharedDirectory],
      [a, sharedGraphUri],
      [a, changedPrincipalUri],
      [{ ...a, database: "other-database" }],
    ]) {
      await writeManifest(root, entries);
      expect(await resolveServiceKey(root, keyA)).toEqual({ status: "failed", code: "unavailable" });
    }
  });

  test("a broken B directory does not block A, while B fails unavailable", async () => {
    const root = await fixture();
    const keyA = key();
    const keyB = key();
    await writeManifest(root, [entry(keyA, PRINCIPAL_A, DIRECTORY_A), entry(keyB, PRINCIPAL_B, DIRECTORY_B)]);
    await moveDirectoryAside(root, DIRECTORY_B);
    expect(await resolveServiceKey(root, keyA)).toMatchObject({ status: "authorized", binding: { principal_uid: PRINCIPAL_A } });
    expect(await resolveServiceKey(root, keyB)).toEqual({ status: "failed", code: "unavailable" });
  });

  test("rejects a symlinked users root or selected principal directory", async () => {
    const root = await fixture();
    const keyA = key();
    await writeManifest(root, [entry(keyA, PRINCIPAL_A, DIRECTORY_A)]);
    const linkedRoot = join(dirname(root), `service-key-root-link-${randomUUID()}`);
    await symlink(root, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    expect(await resolveServiceKey(linkedRoot, keyA)).toEqual({ status: "failed", code: "unavailable" });

    const moved = join(root, `${DIRECTORY_A}-real`);
    await rename(join(root, DIRECTORY_A), moved);
    await symlink(moved, join(root, DIRECTORY_A), process.platform === "win32" ? "junction" : "dir");
    expect(await resolveServiceKey(root, keyA)).toEqual({ status: "failed", code: "unavailable" });
  });

  test("accepts only canonical unpadded base64url encodings of 32 bytes", async () => {
    const root = await fixture();
    await writeManifest(root, []);
    for (const invalid of ["", "a".repeat(42), "a".repeat(44), "+".repeat(43), "é".repeat(43)]) {
      expect(await resolveServiceKey(root, invalid)).toEqual({ status: "failed", code: "unauthorized" });
    }
    expect(await resolveServiceKey(root, undefined)).toEqual({ status: "failed", code: "unauthorized" });
  });
});
