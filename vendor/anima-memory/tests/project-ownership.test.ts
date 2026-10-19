import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "json-canonicalize";
import { listProjectOwnership, registerProjectOwnership, type ProjectOwnershipScope } from "../src/project-ownership.ts";

const USERS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/project-ownership-tests/users");
const FINGERPRINT = "a".repeat(64);

function scope(principal_uid: string, directory_id = principal_uid): ProjectOwnershipScope {
  return { users_root: USERS_ROOT, directory_id, principal_uid, directory: join(USERS_ROOT, directory_id) };
}

async function ensureDirectory(path: string, mode?: number): Promise<void> {
  try {
    if (mode === undefined) await mkdir(path);
    else await mkdir(path, { mode });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(path) !== path) {
    throw new Error("Synthetic project-ownership fixtures must remain inside real .anima-dev directories.");
  }
}

async function prepareData(target: ProjectOwnershipScope): Promise<void> {
  await ensureDirectory(dirname(USERS_ROOT));
  await ensureDirectory(USERS_ROOT);
  await ensureDirectory(target.directory);
  await ensureDirectory(join(target.directory, "data"));
}

describe("project ownership registry", () => {
  test("returns empty for a valid data directory without a projects child and does not create it", async () => {
    const target = scope("13345678-e89b-4d3a-8456-426614174010");
    await prepareData(target);

    expect(await listProjectOwnership(target)).toEqual([]);
    await expect(readFile(join(target.directory, "data", "projects"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("supports a directory UUID distinct from the principal and preserves idempotent registration", async () => {
    const target = scope("23345678-e89b-4d3a-8456-426614174020", "73345678-e89b-4d3a-8456-426614174070");
    const project_uid = "83345678-e89b-4d3a-8456-426614174080";
    await prepareData(target);

    await Promise.all([
      registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }),
      registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }),
    ]);
    await expect(registerProjectOwnership(target, { project_uid, identity_fingerprint: "b".repeat(64) })).rejects.toThrow(/conflicting identity/);
    const records = await listProjectOwnership(target);
    expect(records).toEqual([{
      schema_id: "anima.dev-project-ownership/v1",
      principal_uid: target.principal_uid,
      project_uid,
      identity_fingerprint: FINGERPRINT,
    }]);
    expect(await readFile(join(target.directory, "data", "projects", `${project_uid}.json`), "utf8"))
      .toBe(canonicalize(records[0] as never));
  });

  test("denial or callback failure leaves no marker and permits an authorized retry", async () => {
    for (const outcome of ["false", "throw"] as const) {
      const target = scope(randomUUID());
      const project_uid = randomUUID();
      await prepareData(target);

      await expect(registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }, async () => {
        if (outcome === "throw") throw new Error("private authorization detail");
        return false;
      })).rejects.toThrow();
      expect(await listProjectOwnership(target)).toEqual([]);

      await registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }, async () => true);
      expect(await listProjectOwnership(target)).toHaveLength(1);

      await expect(registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }, async () => false))
        .rejects.toThrow();
      expect(await listProjectOwnership(target)).toHaveLength(1);
    }
  });

  test("checks a second in-flight caller's authorization after shared publication", async () => {
    const target = scope(randomUUID());
    const project_uid = randomUUID();
    await prepareData(target);
    let resolveFirstAuthorization!: (authorized: boolean) => void;
    let signalFirstAuthorization!: () => void;
    const firstAuthorizationStarted = new Promise<void>((resolve) => {
      signalFirstAuthorization = resolve;
    });
    const first = registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }, async () => {
      signalFirstAuthorization();
      return new Promise<boolean>((resolve) => {
        resolveFirstAuthorization = resolve;
      });
    });
    await firstAuthorizationStarted;

    const second = registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT }, async () => {
      return false;
    });
    const secondResult = second.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    resolveFirstAuthorization(true);

    await first;
    const result = await secondResult;
    expect(result.status).toBe("rejected");
    expect(await listProjectOwnership(target)).toHaveLength(1);
  });

  test("ignores stale journal entries while listing and registering", async () => {
    const target = scope(randomUUID());
    const project_uid = randomUUID();
    const journal = join(target.directory, "data", "project-registration-journal");
    await prepareData(target);
    await ensureDirectory(journal, 0o700);
    const stalePath = join(journal, "crashed-registration.json");
    await writeFile(stalePath, "{\"schema_id\":", { flag: "wx" });

    expect(await listProjectOwnership(target)).toEqual([]);
    await registerProjectOwnership(target, { project_uid, identity_fingerprint: FINGERPRINT });
    expect(await listProjectOwnership(target)).toEqual([{
      schema_id: "anima.dev-project-ownership/v1",
      principal_uid: target.principal_uid,
      project_uid,
      identity_fingerprint: FINGERPRINT,
    }]);
  });

  test("racing processes cannot replace a conflicting published identity", async () => {
    const target = scope(randomUUID());
    const project_uid = randomUUID();
    const identities = [
      { project_uid, identity_fingerprint: "b".repeat(64) },
      { project_uid, identity_fingerprint: "c".repeat(64) },
    ];
    await prepareData(target);
    const moduleUrl = new URL("../src/project-ownership.ts", import.meta.url).href;
    const attempts = identities.map((identity) => {
      const source = [
        `import { registerProjectOwnership } from ${JSON.stringify(moduleUrl)};`,
        `const scope = ${JSON.stringify(target)};`,
        `const identity = ${JSON.stringify(identity)};`,
        `console.log("READY");`,
        `const gate = Promise.withResolvers();`,
        `process.stdin.once("data", gate.resolve);`,
        `await gate.promise;`,
        `try { await registerProjectOwnership(scope, identity); console.log("RESULT:registered"); }`,
        `catch (error) { console.log("RESULT:rejected:" + (error instanceof Error ? error.message : String(error))); }`,
      ].join("\n");
      const child = spawn(process.execPath, ["--eval", source], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let ready = false;
      const readySignal = Promise.withResolvers<void>();
      const isReady = readySignal.promise;
      const finishedSignal = Promise.withResolvers<{ code: number | null; stdout: string; stderr: string }>();
      const finished = finishedSignal.promise;
      child.on("close", (code) => {
        if (!ready) readySignal.reject(new Error(`Registrar exited before readiness: ${stderr}`));
        finishedSignal.resolve({ code, stdout, stderr });
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (!ready && stdout.includes("READY")) {
          ready = true;
          readySignal.resolve();
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => readySignal.reject(error));
      return { child, isReady, finished };
    });
    await Promise.all(attempts.map(({ isReady }) => isReady));
    for (const { child } of attempts) child.stdin.end("go");
    const results = await Promise.all(attempts.map(async ({ finished }) => {
      const outcome = await finished;
      expect(outcome.code).toBe(0);
      return outcome.stdout.match(/^RESULT:(.*)$/m)?.[1] ?? "";
    }));

    expect(results.filter((result) => result === "registered")).toHaveLength(1);
    expect(results.filter((result) => result.startsWith("rejected:"))).toHaveLength(1);
    const records = await listProjectOwnership(target);
    expect(records).toHaveLength(1);
    expect(identities.map(({ identity_fingerprint }) => identity_fingerprint)).toContain(records[0]!.identity_fingerprint);
    expect(await readFile(join(target.directory, "data", "projects", `${project_uid}.json`), "utf8"))
      .toBe(canonicalize(records[0] as never));
  });

  test("fails closed on a malformed marker", async () => {
    const target = scope("43345678-e89b-4d3a-8456-426614174040");
    const project_uid = "53345678-e89b-4d3a-8456-426614174050";
    const projects = join(target.directory, "data", "projects");
    await prepareData(target);
    await ensureDirectory(projects);
    await writeFile(join(projects, `${project_uid}.json`), "{\"schema_id\":");

    await expect(listProjectOwnership(target)).rejects.toThrow(/malformed JSON/);
  });

  test("rejects missing, relative, mismatched, and malformed ownership scope fields", async () => {
    const target = scope("63345678-e89b-4d3a-8456-426614174060");
    const missingRoot = { ...target, users_root: undefined } as unknown as ProjectOwnershipScope;
    await expect(listProjectOwnership(missingRoot)).rejects.toThrow(/users_root/);
    await expect(listProjectOwnership({ ...target, users_root: ".anima-dev/users" })).rejects.toThrow(/absolute path/);
    await expect(listProjectOwnership({ ...target, users_root: join(USERS_ROOT, "other") })).rejects.toThrow(/direct scope/);
    await expect(listProjectOwnership({ ...target, directory_id: undefined } as unknown as ProjectOwnershipScope))
      .rejects.toThrow(/directory_id/);
    await expect(listProjectOwnership({ ...target, directory_id: "not-a-uuid" })).rejects.toThrow(/directory_id/);
    await expect(listProjectOwnership({ ...target, directory_id: "73345678-e89b-4d3a-8456-426614174070" })).rejects.toThrow(/direct scope/);
    await expect(listProjectOwnership({ ...target, directory: join(USERS_ROOT, target.directory_id, "nested") }))
      .rejects.toThrow(/direct scope/);
  });

  test("rejects a users_root reached through a symlink", async () => {
    const target = scope("73345678-e89b-4d3a-8456-426614174070", "83345678-e89b-4d3a-8456-426614174080");
    await prepareData(target);
    const linkedRoot = join(dirname(USERS_ROOT), `users-link-${randomUUID()}`);
    await symlink(USERS_ROOT, linkedRoot, process.platform === "win32" ? "junction" : "dir");

    await expect(listProjectOwnership({
      ...target,
      users_root: linkedRoot,
      directory: join(linkedRoot, target.directory_id),
    })).rejects.toThrow(/symbolic links/);
  });
});
