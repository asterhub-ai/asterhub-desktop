import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";

const temporaryDirectories: string[] = [];
const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/test-fixtures/capture-config");

async function temporaryDirectory(): Promise<string> {
  await mkdir(TEST_ROOT, { recursive: true });
  const directory = await mkdtemp(join(TEST_ROOT, "case-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const result = spawnSync("python", ["-c", "import sys, send2trash; send2trash.send2trash(sys.argv[1])", directory], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    assert.equal(result.status, 0, "Python send2trash is required to recycle test fixtures.");
  }
});

async function configFile(value: string): Promise<string> {
  const directory = await temporaryDirectory();
  const path = join(directory, "config.json");
  await writeFile(path, value, "utf8");
  return path;
}

describe("loadConfig", () => {
  it("returns disabled without an explicit path", async () => {
    assert.deepEqual(
      await loadConfig(),
      { kind: "disabled", reason: "Neo4j configuration is unavailable." },
    );
  });
  it("returns disabled for a missing file", async () => {
    const directory = await temporaryDirectory();
    const result = await loadConfig(join(directory, "missing.json"));
    assert.deepEqual(result, { kind: "disabled", reason: "Neo4j configuration is unavailable." });
  });

  it("returns an error for malformed JSON", async () => {
    const path = await configFile("{");
    const result = await loadConfig(path);
    assert.deepEqual(result, { kind: "error", reason: "Neo4j configuration is invalid." });
  });

  it("returns an error for missing, empty, or wrongly typed fields", async () => {
    const values = [
      { neo4j: { uri: "bolt://localhost", username: "neo4j", password: "secret" } },
      { neo4j: { uri: "bolt://localhost", username: "neo4j", password: "", database: "neo4j" } },
      { neo4j: { uri: "bolt://localhost", username: "neo4j", password: "secret", database: 42 } },
    ];
    for (const value of values) {
      const result = await loadConfig(await configFile(JSON.stringify(value)));
      assert.deepEqual(result, { kind: "error", reason: "Neo4j configuration is invalid." });
    }
  });

  it("returns the exact ready shape for legal configuration", async () => {
    const config = {
      uri: "neo4j://127.0.0.1:7687",
      username: "neo4j",
      password: "test-password",
      database: "neo4j",
    };
    const result = await loadConfig(await configFile(JSON.stringify({ neo4j: config })));
    assert.deepEqual(result, { kind: "ready", config });
  });

  it("accepts unrelated root siblings", async () => {
    const config = {
      uri: "neo4j://127.0.0.1:7687",
      username: "neo4j",
      password: "test-password",
      database: "neo4j",
    };
    const result = await loadConfig(await configFile(JSON.stringify({
      memory: { backendUrl: "http://127.0.0.1:8000" },
      neo4j: config,
    })));
    assert.deepEqual(result, { kind: "ready", config });
  });

  it("does not expose credentials in errors or serialized result health data", async () => {
    const password = "test-password-that-must-not-leak";
    const invalid = await loadConfig(await configFile(JSON.stringify({ neo4j: { password } })));
    assert.equal(JSON.stringify(invalid).includes(password), false);
    const directory = await temporaryDirectory();
    const unavailable = await loadConfig(join(directory, "missing.json"));
    assert.equal(JSON.stringify(unavailable).includes(password), false);
  });
});
