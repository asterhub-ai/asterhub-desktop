import { readFile } from "node:fs/promises";

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

export type ConfigLoadResult =
  | { kind: "ready"; config: Neo4jConfig }
  | { kind: "disabled"; reason: "Neo4j configuration is unavailable." }
  | { kind: "error"; reason: "Neo4j configuration is invalid." };

const UNAVAILABLE = "Neo4j configuration is unavailable." as const;
const INVALID = "Neo4j configuration is invalid." as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseConfig(value: unknown): Neo4jConfig | undefined {
  if (!isRecord(value)) return undefined;
  const neo4j = value.neo4j;
  if (!isRecord(neo4j) || !hasExactKeys(neo4j, ["uri", "username", "password", "database"])) return undefined;
  if (
    typeof neo4j.uri !== "string" || neo4j.uri.length === 0 ||
    typeof neo4j.username !== "string" || neo4j.username.length === 0 ||
    typeof neo4j.password !== "string" || neo4j.password.length === 0 ||
    typeof neo4j.database !== "string" || neo4j.database.length === 0
  ) return undefined;
  return {
    uri: neo4j.uri,
    username: neo4j.username,
    password: neo4j.password,
    database: neo4j.database,
  };
}

export async function loadConfig(configPath?: string): Promise<ConfigLoadResult> {
  if (configPath === undefined) return { kind: "disabled", reason: UNAVAILABLE };
  const path = configPath;
  try {
    const text = await readFile(path, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: "error", reason: INVALID };
    }
    const config = parseConfig(value);
    return config === undefined ? { kind: "error", reason: INVALID } : { kind: "ready", config };
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "ENOENT") return { kind: "disabled", reason: UNAVAILABLE };
    return { kind: "error", reason: INVALID };
  }
}
