import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SANDBOX = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev");

export function syntheticConfigPath(): string {
  const configured = process.env.ANIMA_DEV_TEST_CONFIG_PATH;
  if (!configured) throw new Error("Repository-local synthetic Neo4j config is required.");
  const sandbox = realpathSync(SANDBOX);
  const path = realpathSync(configured);
  const inside = relative(sandbox, path);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error("Synthetic Neo4j config must be inside the development sandbox.");
  }
  const config = JSON.parse(readFileSync(path, "utf8")) as { neo4j?: { database?: unknown } };
  if (typeof config?.neo4j?.database !== "string" || !config.neo4j.database.startsWith("anima-personality-test-")) {
    throw new Error("Only an isolated synthetic Neo4j database is allowed.");
  }
  return path;
}
