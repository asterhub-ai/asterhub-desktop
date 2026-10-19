import neo4j from "neo4j-driver";
import type * as Neo4j from "neo4j-driver";
import { loadConfig as defaultLoadConfig, type ConfigLoadResult, type Neo4jConfig } from "./config.ts";

export interface Neo4jStoreOptions {
  configPath?: string;
  shutdown_timeout_ms?: number;
  loadConfig?: (configPath?: string) => Promise<ConfigLoadResult>;
  driverFactory?: (config: Neo4jConfig) => Neo4j.Driver;
  requireDatabaseIdentity?: boolean;
  expectedDatabaseId?: string;
}
export type HealthResult =
  | {
      status: "connected";
      database: string;
      constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"];
      message: "Neo4j connection is healthy.";
    }
  | {
      status: "disabled" | "error" | "closed";
      database: null;
      constraints: [];
      message:
        | "Neo4j configuration is unavailable."
        | "Neo4j configuration is invalid."
        | "Neo4j connection failed."
        | "Neo4j store is closed.";
    };

const EXPECTED_CONSTRAINTS = [
  { name: "anima_project_uid_unique", label: "Project", property: "project_uid" },
  { name: "anima_session_uid_unique", label: "Session", property: "session_uid" },
  { name: "anima_raw_event_uid_unique", label: "RawEvent", property: "event_uid" },
] as const;
// Schema changes are provisioned by an administrator; the application account only verifies them.

type ConstraintRecord = {
  get(key: string): unknown;
};

function constraintField(record: ConstraintRecord, key: string): unknown {
  try {
    return record.get(key);
  } catch {
    return undefined;
  }
}

function constraintList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

function hasExpectedConstraint(record: ConstraintRecord, expected: (typeof EXPECTED_CONSTRAINTS)[number]): boolean {
  return (
    constraintField(record, "name") === expected.name &&
    String(constraintField(record, "type")).toUpperCase() === "UNIQUENESS" &&
    String(constraintField(record, "entityType")).toUpperCase() === "NODE" &&
    constraintList(constraintField(record, "labelsOrTypes")).length === 1 &&
    constraintList(constraintField(record, "labelsOrTypes"))[0] === expected.label &&
    constraintList(constraintField(record, "properties")).length === 1 &&
    constraintList(constraintField(record, "properties"))[0] === expected.property
  );
}

export class Neo4jStore {
  private readonly configPath?: string;
  private readonly shutdownTimeoutMs: number;
  private readonly configLoader: (configPath?: string) => Promise<ConfigLoadResult>;
  private readonly driverFactory: (config: Neo4jConfig) => Neo4j.Driver;
  private readonly requireDatabaseIdentity: boolean;
  private readonly expectedDatabaseId?: string;
  private databaseId?: string;
  private driver?: Neo4j.Driver;
  private initialization?: Promise<HealthResult>;
  private closePromise?: Promise<void>;
  private driverClosePromise?: Promise<void>;
  private closed = false;
  private writesCancelled = false;
  private writesReady = false;
  private database?: string;

  constructor(configPathOrOptions?: string | Neo4jStoreOptions) {
    const options = typeof configPathOrOptions === "string" ? { configPath: configPathOrOptions } : configPathOrOptions;
    this.configPath = options?.configPath;
    this.shutdownTimeoutMs = Number.isSafeInteger(options?.shutdown_timeout_ms) && (options?.shutdown_timeout_ms ?? 0) > 0
      ? options!.shutdown_timeout_ms!
      : 1500;
    this.configLoader = options?.loadConfig ?? defaultLoadConfig;
    this.requireDatabaseIdentity = options?.requireDatabaseIdentity === true || options?.expectedDatabaseId !== undefined;
    this.expectedDatabaseId = options?.expectedDatabaseId;
    this.driverFactory = options?.driverFactory ?? ((config) => neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password)));
  }

  initialize(): Promise<HealthResult> {
    if (this.closed) {
      return Promise.resolve({ status: "closed", database: null, constraints: [], message: "Neo4j store is closed." });
    }
    if (this.initialization === undefined) {
      this.initialization = this.initializeOnce().catch((): HealthResult => (
        this.closed
          ? { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." }
          : { status: "error", database: null, constraints: [], message: "Neo4j connection failed." }
      ));
    }
    return this.initialization;
  }

  isWriteCancelled(): boolean {
    return this.closed || this.writesCancelled;
  }

  cancelWrites(): void {
    this.writesCancelled = true;
  }

  getDatabaseId(): string | undefined {
    return !this.closed && this.writesReady ? this.databaseId : undefined;
  }

  /**
   * Run one managed Neo4j transaction after initialize() has connected the store.
   * The callback is deliberately given only the transaction, keeping all graph
   * writes inside the caller's atomic boundary.
   */
  async executeWrite<T>(work: (transaction: Neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
    if (this.isWriteCancelled() || !this.writesReady || this.driver === undefined) throw new Error("Neo4j store is not connected.");
    const session = this.driver.session({ database: this.database });
    try {
      return await session.executeWrite(async (transaction) => {
        if (this.isWriteCancelled()) throw new Error("Neo4j store is not connected.");
        if (this.requireDatabaseIdentity) await this.verifyTransactionDatabaseIdentity(transaction);
        if (this.isWriteCancelled()) throw new Error("Neo4j store is not connected.");
        return work(transaction);
      });
    } finally {
      await session.close();
    }
  }

  async executeRead<T>(work: (transaction: Neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
    if (this.closed || !this.writesReady || this.driver === undefined) throw new Error("Neo4j store is not connected.");
    const session = this.driver.session({ database: this.database });
    try {
      return await session.executeRead(async (transaction) => {
        if (this.closed) throw new Error("Neo4j store is not connected.");
        if (this.requireDatabaseIdentity) await this.verifyTransactionDatabaseIdentity(transaction);
        if (this.closed) throw new Error("Neo4j store is not connected.");
        return work(transaction);
      });
    } finally {
      await session.close();
    }
  }

  close(timeoutMs = this.shutdownTimeoutMs): Promise<void> {
    this.closed = true;
    this.writesCancelled = true;
    if (this.closePromise !== undefined) return this.closePromise;
    const deadline = performance.now() + Math.max(0, timeoutMs);
    // Start closing an already-created driver before waiting on initialization.
    this.closeDriver();
    this.closePromise = (async () => {
      const remaining = (): number => Math.max(0, deadline - performance.now());
      const waitFor = async (promise: Promise<unknown>): Promise<void> => {
        const timeout = remaining();
        if (timeout <= 0) return;
        await Promise.race([
          promise.then(() => undefined, () => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, timeout)),
        ]);
      };
      if (this.initialization !== undefined) await waitFor(this.initialization);
      if (this.driverClosePromise !== undefined) await waitFor(this.driverClosePromise);
    })();
    return this.closePromise;
  }

  private closeDriver(): Promise<void> {
    if (this.driverClosePromise !== undefined) return this.driverClosePromise;
    if (this.driver === undefined) return Promise.resolve();
    try {
      this.driverClosePromise = Promise.resolve(this.driver.close()).catch(() => {});
    } catch {
      this.driverClosePromise = Promise.resolve();
    }
    return this.driverClosePromise;
  }

  private async initializeOnce(): Promise<HealthResult> {
    const loaded = await this.configLoader(this.configPath);
    if (this.closed) return { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." };
    if (loaded.kind === "disabled") {
      return { status: "disabled", database: null, constraints: [], message: loaded.reason };
    }
    if (loaded.kind === "error") {
      return { status: "error", database: null, constraints: [], message: loaded.reason };
    }

    if (this.closed) return { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." };

    try {
      const driver = this.driverFactory(loaded.config);
      this.driver = driver;
      if (this.closed) {
        this.closeDriver();
        return { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." };
      }

      await driver.verifyConnectivity();
      if (this.closed) {
        this.closeDriver();
        return { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." };
      }

      this.database = loaded.config.database;
      const session = driver.session({ database: loaded.config.database });
      let databaseId: string | undefined;
      try {
        if (this.requireDatabaseIdentity) {
          const identity = await session.run("CALL db.info() YIELD id, name RETURN id, name");
          databaseId = this.parseDatabaseIdentity(identity.records, loaded.config.database);
        }
        const constraints = await session.run("SHOW CONSTRAINTS");
        for (const expected of EXPECTED_CONSTRAINTS) {
          if (!constraints.records.some((record) => hasExpectedConstraint(record, expected))) {
            throw new Error("Neo4j constraint schema verification failed.");
          }
        }
      } finally {
        await session.close();
      }
      if (this.closed) {
        this.closeDriver();
        return { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." };
      }
      this.databaseId = databaseId;
      this.writesReady = true;
      return {
        status: "connected",
        database: loaded.config.database,
        constraints: ["anima_project_uid_unique", "anima_session_uid_unique", "anima_raw_event_uid_unique"],
        message: "Neo4j connection is healthy.",
      };
    } catch {
      this.closeDriver();
      if (this.closed) {
        return { status: "closed", database: null, constraints: [], message: "Neo4j store is closed." };
      }
      return { status: "error", database: null, constraints: [], message: "Neo4j connection failed." };
    }
  }

  private parseDatabaseIdentity(records: readonly ConstraintRecord[], configuredDatabase: string): string {
    if (records.length !== 1) throw new Error("Neo4j database identity verification failed.");
    const id = constraintField(records[0]!, "id");
    const name = constraintField(records[0]!, "name");
    if (typeof id !== "string" || id.length === 0 || name !== configuredDatabase) {
      throw new Error("Neo4j database identity verification failed.");
    }
    if (this.expectedDatabaseId !== undefined && id !== this.expectedDatabaseId) {
      throw new Error("Neo4j database identity verification failed.");
    }
    return id;
  }

  private async verifyTransactionDatabaseIdentity(transaction: Neo4j.ManagedTransaction): Promise<void> {
    const identity = await transaction.run("CALL db.info() YIELD id, name RETURN id, name");
    const id = this.parseDatabaseIdentity(identity.records, this.database!);
    if (id !== this.databaseId) throw new Error("Neo4j database identity verification failed.");
  }
}
