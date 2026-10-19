import neo4j from "neo4j-driver";
import type * as Neo4j from "neo4j-driver";
import { loadConfig as defaultLoadConfig, type ConfigLoadResult, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import {
  buildPersonalityAggregateSnapshot,
  derivePersonalityUids,
  parsePersonalityAggregate,
  projectPersonality,
  projectPersonalityAnchorUpdate,
} from "./personality-projector.ts";
import {
  PersonalityValidationError,
  type PersonalityAggregateSnapshot,
  type PersonalityAnchorUpdateResult,
  type PersonalityFailure,
  type PersonalityInitResult,
  type PersonalityReadResult,
  type PersonalityStatusResult,
  type TrustedIdentity,
} from "./personality-types.ts";

const PERSONALITY_CONSTRAINTS = [
  { name: "anima_personality_uid_unique", label: "AnimaPersonality", property: "personality_uid" },
  { name: "anima_personality_principal_uid_unique", label: "AnimaPersonality", property: "principal_uid" },
] as const;
const HEALTH_CONSTRAINTS = PERSONALITY_CONSTRAINTS.map(({ name }) => name);
const PERSONALITY_LOOKUP =
  "MATCH (n) WHERE n.personality_uid = $personality_uid OR (n:AnimaPersonality AND n.principal_uid = $principal_uid) RETURN labels(n) AS labels, properties(n) AS properties";
const CREATE_PERSONALITY =
  "CREATE (n:AnimaPersonality) SET n = $properties RETURN n.personality_uid AS personality_uid";
const LOCK_PERSONALITY =
  "MATCH (n:AnimaPersonality {personality_uid: $personality_uid}) SET n.personality_uid = n.personality_uid RETURN n.personality_uid AS personality_uid";
const UPDATE_PERSONALITY_ANCHORS =
  "MATCH (n:AnimaPersonality {personality_uid: $personality_uid}) SET n.anchors_json = $anchors_json, n.updated_at = $updated_at RETURN n.personality_uid AS personality_uid";
const UNAUTHORIZED_MESSAGE = "Personality access is unauthorized." as const;

const DATABASE_ERROR_MESSAGE = "Neo4j personality operation failed." as const;
const IDENTITY_CONFLICT_MESSAGE = "Stored personality identity conflicts with the trusted identity." as const;
const INVALID_IDENTITY_MESSAGE = "Trusted personality identity is invalid." as const;
const INVALID_PERSONALITY_INPUT_MESSAGE = "Personality initialization input or trusted identity is invalid." as const;
const INVALID_ANCHOR_INPUT_MESSAGE = "Personality anchor update input or trusted identity is invalid." as const;
const CLOSED_MESSAGE = "Personality store is closed." as const;

export type Neo4jPersonalityStoreHealth =
  | { status: "starting"; database: null; constraints: readonly [] }
  | { status: "connected"; database: string; constraints: readonly string[] }
  | { status: "degraded" | "closed"; database: null; constraints: readonly [] };

export type PersonalitySnapshotResult =
  | { status: "uninitialized" }
  | { status: "initialized"; snapshot: PersonalityAggregateSnapshot }
  | PersonalityFailure;

export interface Neo4jPersonalityStoreOptions {
  configPath?: string;
  loadConfig?: (configPath?: string) => Promise<ConfigLoadResult>;
  driverFactory?: (config: Neo4jConfig) => Neo4j.Driver;
  clock?: () => Date;
  authorizeBeforeWrite?: (principal_uid: string) => Promise<boolean>;
}

interface QueryRecord {
  get(key: string): unknown;
}

interface QueryResult {
  records: QueryRecord[];
}

interface TransactionLike {
  run(query: string, parameters?: Record<string, unknown>): Promise<QueryResult>;
}
interface SessionLike extends TransactionLike {
  executeRead?<T>(work: (transaction: TransactionLike) => Promise<T>): Promise<T>;
  executeWrite<T>(work: (transaction: TransactionLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function failure(code: PersonalityFailure["code"], message: string): PersonalityFailure {
  return { status: "failed", code, message };
}

async function releaseNeo4jSessionTurn(): Promise<void> {
  // Bun 1.3.14 can defer returning a closed Neo4j session to its pool until the next timer turn.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  return [];
}

function parseLookupResult(
  result: QueryResult,
  uids: { personality_uid: string; principal_uid: string },
): PersonalitySnapshotResult {
  if (result.records.length === 0) return { status: "uninitialized" };
  if (result.records.length !== 1) return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
  const row = result.records[0]!;
  const labels = row.get("labels");
  const properties = row.get("properties");
  const validProperties = properties !== null && typeof properties === "object" && !Array.isArray(properties);
  if (!Array.isArray(labels) || labels.length !== 1 || labels[0] !== "AnimaPersonality" || !validProperties) {
    return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
  }
  try {
    return {
      status: "initialized",
      snapshot: parsePersonalityAggregate(properties as Record<string, unknown>, uids),
    };
  } catch {
    return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
  }
}

function isConstraintViolation(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && code.startsWith("Neo.ClientError.Schema.Constraint");
}

function hasExpectedConstraint(record: QueryRecord, expected: (typeof PERSONALITY_CONSTRAINTS)[number]): boolean {
  const labels = strings(record.get("labelsOrTypes"));
  const properties = strings(record.get("properties"));
  return record.get("name") === expected.name &&
    String(record.get("type")).toUpperCase() === "UNIQUENESS" &&
    String(record.get("entityType")).toUpperCase() === "NODE" &&
    labels.length === 1 && labels[0] === expected.label &&
    properties.length === 1 && properties[0] === expected.property;
}


export class Neo4jPersonalityStore {
  private readonly configPath?: string;
  private readonly configLoader: (configPath?: string) => Promise<ConfigLoadResult>;
  private readonly driverFactory: (config: Neo4jConfig) => Neo4j.Driver;
  private readonly clock: () => Date;
  private driver?: Neo4j.Driver;
  private database?: string;
  private state: Neo4jPersonalityStoreHealth["status"] = "starting";
  private admissionClosed = false;
  private initialization?: Promise<Neo4jPersonalityStoreHealth>;
  private readonly authorizeBeforeWrite?: (principal_uid: string) => Promise<boolean>;
  private closePromise?: Promise<void>;
  private driverClosePromise?: Promise<void>;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(options: Neo4jPersonalityStoreOptions = {}) {
    if (options.authorizeBeforeWrite !== undefined && typeof options.authorizeBeforeWrite !== "function") {
      throw new TypeError("authorizeBeforeWrite must be a function.");
    }
    this.configPath = options.configPath;
    this.configLoader = options.loadConfig ?? defaultLoadConfig;
    this.clock = options.clock ?? (() => new Date());
    this.driverFactory = options.driverFactory ?? ((config) =>
      neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password)));
    this.authorizeBeforeWrite = options.authorizeBeforeWrite;
  }

  health(): Neo4jPersonalityStoreHealth {
    if (this.state === "connected" && this.database !== undefined) {
      return { status: "connected", database: this.database, constraints: HEALTH_CONSTRAINTS };
    }
    if (this.state === "closed") return { status: "closed", database: null, constraints: [] };
    if (this.state === "starting") return { status: "starting", database: null, constraints: [] };
    return { status: "degraded", database: null, constraints: [] };
  }

  initialize(): Promise<Neo4jPersonalityStoreHealth> {
    if (this.admissionClosed) return Promise.resolve(this.health());
    if (this.initialization !== undefined) return this.initialization;
    const initialization = this.track(this.initializeOnce());
    this.initialization = initialization;
    return initialization;
  }

  getStatus(identity: TrustedIdentity): Promise<PersonalityStatusResult> {
    return this.readSnapshot(identity).then((result) => {
      if (result.status === "failed") return result;
      return { initialized: result.status === "initialized" };
    });
  }

  readPersona(identity: TrustedIdentity): Promise<PersonalityReadResult> {
    return this.readSnapshot(identity).then((result) => {
      if (result.status === "failed" || result.status === "uninitialized") return result;
      try {
        return projectPersonality(result.snapshot);
      } catch {
        return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
    });
  }

  initializePersona(identity: TrustedIdentity, input: unknown): Promise<PersonalityInitResult> {
    if (this.admissionClosed || this.state === "closed") {
      return Promise.resolve(failure("core_closed", CLOSED_MESSAGE));
    }
    if (this.state !== "connected" || this.driver === undefined || this.database === undefined) {
      return Promise.resolve(failure("database_error", DATABASE_ERROR_MESSAGE));
    }

    let snapshot: PersonalityAggregateSnapshot;
    try {
      snapshot = buildPersonalityAggregateSnapshot(identity, input, this.clock().toISOString());
    } catch {
      return Promise.resolve(failure("invalid_input", INVALID_PERSONALITY_INPUT_MESSAGE));
    }
    return this.track(this.initializePersonaWrite(snapshot));
  }
  setAnchor(
    identity: TrustedIdentity,
    name: string,
    value: number,
    reason: string,
  ): Promise<PersonalityAnchorUpdateResult> {
    if (this.admissionClosed || this.state === "closed") {
      return Promise.resolve(failure("core_closed", CLOSED_MESSAGE));
    }

    let uids: { personality_uid: string; principal_uid: string };
    try {
      uids = derivePersonalityUids(identity);
      if (typeof name !== "string" || name.length === 0 || name !== name.trim() ||
        typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 ||
        typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error("Invalid anchor update input.");
      }
    } catch {
      return Promise.resolve(failure("invalid_input", INVALID_ANCHOR_INPUT_MESSAGE));
    }

    if (this.state !== "connected" || this.driver === undefined || this.database === undefined) {
      return Promise.resolve(failure("database_error", DATABASE_ERROR_MESSAGE));
    }
    return this.track(this.setAnchorWrite(uids, name, value, reason));
  }


  readSnapshot(identity: TrustedIdentity): Promise<PersonalitySnapshotResult> {
    if (this.admissionClosed || this.state === "closed") {
      return Promise.resolve(failure("core_closed", CLOSED_MESSAGE));
    }
    if (this.state !== "connected" || this.driver === undefined || this.database === undefined) {
      return Promise.resolve(failure("database_error", DATABASE_ERROR_MESSAGE));
    }

    let uids;
    try {
      uids = derivePersonalityUids(identity);
    } catch {
      return Promise.resolve(failure("invalid_input", INVALID_IDENTITY_MESSAGE));
    }

    return this.track(this.lookup(uids));
  }

  close(timeout_ms = 1500): Promise<void> {
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms <= 0) {
      throw new TypeError("timeout_ms must be a positive safe integer.");
    }
    if (this.closePromise !== undefined) return this.closePromise;

    const deadline = performance.now() + timeout_ms;
    this.admissionClosed = true;
    this.state = "closed";
    this.database = undefined;
    const driverClose = this.closeDriver();
    const pending = Promise.allSettled([
      ...(this.initialization === undefined ? [] : [this.initialization]),
      ...this.inFlight,
      driverClose,
    ]);
    this.closePromise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const remaining = deadline - performance.now();
        if (remaining <= 0) return;
        await Promise.race([
          pending.then(() => undefined),
          new Promise<void>((resolve) => {
            const scheduleTimeout = () => {
              const delay = deadline - performance.now();
              if (delay <= 0) {
                resolve();
                return;
              }
              timer = setTimeout(scheduleTimeout, Math.min(delay, 2_147_483_647));
            };
            scheduleTimeout();
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.closePromise;
  }

  private async initializeOnce(): Promise<Neo4jPersonalityStoreHealth> {
    let loaded: ConfigLoadResult;
    try {
      loaded = await this.configLoader(this.configPath);
    } catch {
      return this.markDegraded();
    }
    if (this.admissionClosed) return this.health();
    if (loaded.kind !== "ready") return this.markDegraded();

    try {
      const driver = this.driverFactory(loaded.config);
      this.driver = driver;
      if (this.admissionClosed) {
        await this.closeDriver();
        return this.health();
      }
      await driver.verifyConnectivity();
      if (this.admissionClosed) return this.health();
      const session = driver.session({ database: loaded.config.database }) as unknown as SessionLike;
      try {
        const constraints = await session.run("SHOW CONSTRAINTS");
        for (const expected of PERSONALITY_CONSTRAINTS) {
          if (!constraints.records.some((record) => hasExpectedConstraint(record, expected))) {
            throw new Error("Personality schema verification failed.");
          }
        }
      } finally {
        await session.close();
        await releaseNeo4jSessionTurn();
      }
      if (this.admissionClosed) return this.health();
      this.database = loaded.config.database;
      this.state = "connected";
      return this.health();
    } catch {
      await this.closeDriver();
      return this.markDegraded();
    }
  }

  private async lookup(uids: { personality_uid: string; principal_uid: string }): Promise<PersonalitySnapshotResult> {
    const driver = this.driver;
    const database = this.database;
    if (driver === undefined || database === undefined) {
      return failure("database_error", DATABASE_ERROR_MESSAGE);
    }
    return this.lookupWith(driver, database, uids);
  }

  private async lookupWith(
    driver: Neo4j.Driver,
    database: string,
    uids: { personality_uid: string; principal_uid: string },
  ): Promise<PersonalitySnapshotResult> {
    try {
      const session = driver.session({ database }) as unknown as SessionLike;
      let result: QueryResult;
      try {
        const work = (transaction: TransactionLike) => transaction.run(PERSONALITY_LOOKUP, uids);
        result = session.executeRead === undefined ? await work(session) : await session.executeRead(work);
      } finally {
        await session.close();
        await releaseNeo4jSessionTurn();
      }
      return parseLookupResult(result, uids);
    } catch {
      return failure("database_error", DATABASE_ERROR_MESSAGE);
    }
  }

  private async initializePersonaWrite(snapshot: PersonalityAggregateSnapshot): Promise<PersonalityInitResult> {
    const driver = this.driver;
    const database = this.database;
    if (driver === undefined || database === undefined) {
      return failure("database_error", DATABASE_ERROR_MESSAGE);
    }

    const uids = {
      personality_uid: snapshot.personality_uid,
      principal_uid: snapshot.principal_uid,
    };
    let session: SessionLike | undefined;
    let writeIssued = false;
    let writeError: unknown;
    let failed = false;
    let outcome: "created" | "existing" | "conflict" | PersonalityFailure | undefined;
    let knownCommitted = false;
    try {
      session = driver.session({ database }) as unknown as SessionLike;
      const work = async (
        transaction: TransactionLike,
      ): Promise<"created" | "existing" | "conflict" | PersonalityFailure> => {
        if (writeIssued) throw new Error("Personality write outcome is already uncertain.");
        const current = parseLookupResult(
          await transaction.run(PERSONALITY_LOOKUP, uids),
          uids,
        );
        if (current.status === "initialized") return "existing";
        if (current.status === "failed") return "conflict";

        if (this.authorizeBeforeWrite !== undefined) {
          const authorizationFailure = await this.authorizeWrite(snapshot.principal_uid);
          if (authorizationFailure !== undefined) return authorizationFailure;
        }

        writeIssued = true;
        await transaction.run(CREATE_PERSONALITY, {
          properties: {
            personality_uid: snapshot.personality_uid,
            principal_uid: snapshot.principal_uid,
            rules_json: snapshot.rules_json,
            anchors_json: snapshot.anchors_json,
            created_at: snapshot.created_at,
            updated_at: snapshot.updated_at,
          },
        });
        return "created";
      };
      outcome = await session.executeWrite(work);
      knownCommitted = outcome === "created";
    } catch (error: unknown) {
      failed = true;
      writeError = error;
    } finally {
      if (session !== undefined) {
        try {
          await session.close();
          await releaseNeo4jSessionTurn();
        } catch {
          // A successful executeWrite has already established the committed result.
        }
      }
    }

    if (failed) {
      if (writeIssued && isConstraintViolation(writeError) && !this.admissionClosed) {
        const winner = await this.lookupWith(driver, database, uids);
        if (winner.status === "initialized") return failure("already_initialized", "Personality is already initialized.");
        if (winner.status === "failed" && winner.code === "database_error") return winner;
        return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
      }
      return failure(
        writeIssued && !knownCommitted ? "write_outcome_unknown" : "database_error",
        writeIssued && !knownCommitted ? "Personality initialization outcome is unknown." : DATABASE_ERROR_MESSAGE,
      );
    }

    if (outcome === "existing") return failure("already_initialized", "Personality is already initialized.");
    if (outcome === "conflict") return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
    if (outcome !== undefined && typeof outcome === "object") return outcome;
    if (outcome !== "created") return failure("database_error", DATABASE_ERROR_MESSAGE);
    return { action: "init_commit", rules: snapshot.rules.length, anchors: snapshot.anchors.length };
  }
  private async setAnchorWrite(
    uids: { personality_uid: string; principal_uid: string },
    name: string,
    value: number,
    reason: string,
  ): Promise<PersonalityAnchorUpdateResult> {
    const driver = this.driver;
    const database = this.database;
    if (driver === undefined || database === undefined) {
      return failure("database_error", DATABASE_ERROR_MESSAGE);
    }

    let session: SessionLike | undefined;
    let writeIssued = false;
    let writeError: unknown;
    let failed = false;
    let knownCommitted = false;
    let outcome: PersonalityAnchorUpdateResult | PersonalityFailure | undefined;
    try {
      session = driver.session({ database }) as unknown as SessionLike;
      const work = async (transaction: TransactionLike): Promise<PersonalityAnchorUpdateResult | PersonalityFailure> => {
        if (writeIssued) throw new Error("Personality write outcome is already uncertain.");
        await transaction.run(LOCK_PERSONALITY, { personality_uid: uids.personality_uid });
        const current = parseLookupResult(await transaction.run(PERSONALITY_LOOKUP, uids), uids);
        if (current.status === "uninitialized") return failure("not_initialized", "Personality is not initialized.");
        if (current.status === "failed") return current;

        let at: string;
        try {
          const now = this.clock().toISOString();
          at = now < current.snapshot.updated_at ? current.snapshot.updated_at : now;
        } catch {
          return failure("invalid_input", INVALID_ANCHOR_INPUT_MESSAGE);
        }

        let projection;
        try {
          projection = projectPersonalityAnchorUpdate(current.snapshot, name, value, reason, at);
        } catch (error: unknown) {
          if (error instanceof PersonalityValidationError) {
            return failure(error.code, error.code === "identity_conflict"
              ? IDENTITY_CONFLICT_MESSAGE
              : error.message);
          }
          return failure("identity_conflict", IDENTITY_CONFLICT_MESSAGE);
        }

        if (this.authorizeBeforeWrite !== undefined) {
          const authorizationFailure = await this.authorizeWrite(uids.principal_uid);
          if (authorizationFailure !== undefined) return authorizationFailure;
        }

        writeIssued = true;
        await transaction.run(UPDATE_PERSONALITY_ANCHORS, {
          personality_uid: uids.personality_uid,
          anchors_json: projection.anchors_json,
          updated_at: projection.updated_at,
        });
        return {
          action: "anchor_update",
          name: projection.name,
          old_value: projection.old_value,
          new_value: projection.new_value,
        };
      };
      outcome = await session.executeWrite(work);
      knownCommitted = outcome !== undefined && !("status" in outcome);
    } catch (error: unknown) {
      failed = true;
      writeError = error;
    } finally {
      if (session !== undefined) {
        try {
          await session.close();
          await releaseNeo4jSessionTurn();
        } catch {
          // A successful executeWrite has already established the committed result.
        }
      }
    }

    if (failed) {
      return failure(
        writeIssued && !knownCommitted ? "write_outcome_unknown" : "database_error",
        writeIssued && !knownCommitted ? "Personality anchor update outcome is unknown." : DATABASE_ERROR_MESSAGE,
      );
    }
    if (outcome === undefined) return failure("database_error", DATABASE_ERROR_MESSAGE);
    return outcome;
  }
  private async authorizeWrite(principal_uid: string): Promise<PersonalityFailure | undefined> {
    if (this.admissionClosed) return failure("core_closed", CLOSED_MESSAGE);
    if (this.authorizeBeforeWrite === undefined) return undefined;
    let authorized = false;
    try {
      authorized = await this.authorizeBeforeWrite(principal_uid);
    } catch {
      if (this.admissionClosed) return failure("core_closed", CLOSED_MESSAGE);
      return failure("unauthorized", UNAUTHORIZED_MESSAGE);
    }
    if (this.admissionClosed) return failure("core_closed", CLOSED_MESSAGE);
    return authorized ? undefined : failure("unauthorized", UNAUTHORIZED_MESSAGE);
  }



  private markDegraded(): Neo4jPersonalityStoreHealth {
    if (this.admissionClosed) return this.health();
    this.state = "degraded";
    this.database = undefined;
    return this.health();
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise);
    void promise.then(
      () => this.inFlight.delete(promise),
      () => this.inFlight.delete(promise),
    );
    return promise;
  }

  private closeDriver(): Promise<void> {
    if (this.driverClosePromise !== undefined) return this.driverClosePromise;
    const driver = this.driver;
    this.driver = undefined;
    if (driver === undefined) return Promise.resolve();
    this.driverClosePromise = Promise.resolve().then(() => driver.close()).catch(() => undefined);
    return this.driverClosePromise;
  }
}
