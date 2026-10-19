import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
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

export function recycleSyntheticScope(directory: string): void {
  if (dirname(resolve(directory)) !== resolve(SANDBOX, "users")) {
    throw new Error("Only a synthetic user directory can be recycled.");
  }
  if (!existsSync(directory)) return;
  if (process.platform === "win32") {
    const temporary = resolve(SANDBOX, "temporary");
    mkdirSync(temporary, { recursive: true });
    const result = spawnSync("cmd.exe", ["/c", "move", `"${directory}"`, `"${resolve(temporary, randomUUID())}"`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error("Synthetic user directory could not be moved to temporary storage.");
    return;
  }
  const result = spawnSync("trash-put", [directory]);
  const moved = result.error && "code" in result.error && result.error.code === "ENOENT"
    ? spawnSync("gvfs-trash", [directory]) : result;
  if (moved.error || moved.status !== 0) throw new Error("Synthetic user directory requires manual recycling.");
}
