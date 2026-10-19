import neo4j from "neo4j-driver";

export type Neo4jInstanceBootstrapConfig = {
  uri: string;
  username: string;
  password: string;
  database: "neo4j";
};

export type Neo4jInstanceBootstrapOptions = {
  driverFactory?: (config: Neo4jInstanceBootstrapConfig) => BootstrapDriver;
};

type ExpectedConstraint = {
  name: string;
  label: string;
  property: string;
};

type QueryRecord = { get(key: string): unknown };
type QueryResult = { records: readonly QueryRecord[] };
type BootstrapSession = {
  run(query: string): Promise<QueryResult>;
  close(): Promise<void>;
};
type BootstrapDriver = {
  session(options: { database: string }): BootstrapSession;
  close(): Promise<void>;
};

const EXPECTED_CONSTRAINTS: readonly ExpectedConstraint[] = [
  { name: "anima_project_uid_unique", label: "Project", property: "project_uid" },
  { name: "anima_session_uid_unique", label: "Session", property: "session_uid" },
  { name: "anima_raw_event_uid_unique", label: "RawEvent", property: "event_uid" },
  { name: "anima_boundary_window_uid_unique", label: "BoundaryWindow", property: "window_uid" },
  { name: "anima_memory_cursor_uid_unique", label: "MemoryCursor", property: "cursor_uid" },
  { name: "anima_execution_unit_uid_unique", label: "ExecutionUnit", property: "execution_uid" },
  { name: "anima_execution_review_candidate_uid_unique", label: "ExecutionReviewCandidate", property: "candidate_uid" },
  { name: "anima_episode_uid_unique", label: "Episode", property: "episode_uid" },
  { name: "anima_execution_review_uid_unique", label: "ExecutionReview", property: "review_uid" },
  { name: "anima_reflection_uid_unique", label: "Reflection", property: "reflection_uid" },
  { name: "anima_reflection_schedule_cursor_uid_unique", label: "ReflectionScheduleCursor", property: "cursor_uid" },
  { name: "anima_memory_subject_uid_unique", label: "MemorySubject", property: "domain_uid" },
  { name: "anima_memory_uid_unique", label: "Memory", property: "memory_uid" },
  { name: "anima_memory_claim_key_unique", label: "Memory", property: "claim_key" },
  { name: "anima_memory_revision_uid_unique", label: "MemoryRevision", property: "revision_uid" },
  { name: "anima_memory_decision_uid_unique", label: "MemoryDecision", property: "decision_uid" },
  { name: "anima_personality_uid_unique", label: "AnimaPersonality", property: "personality_uid" },
  { name: "anima_personality_principal_uid_unique", label: "AnimaPersonality", property: "principal_uid" },
];

function assertDatabaseInfo(result: QueryResult): string {
  const record = result.records.length === 1 ? result.records[0] : undefined;
  if (record === undefined) {
    throw new Error("Neo4j db.info() did not return exactly one database record.");
  }
  const name: unknown = record.get("name");
  const id: unknown = record.get("id");
  if (name !== "neo4j" || typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Neo4j db.info() did not identify the expected neo4j database.");
  }
  return id;
}

function assertExpectedConstraints(result: QueryResult): void {
  const expectedByName: Record<string, ExpectedConstraint> = Object.create(null);
  for (const constraint of EXPECTED_CONSTRAINTS) expectedByName[constraint.name] = constraint;
  const foundByName = new Set<string>();

  for (const record of result.records) {
    const name: unknown = record.get("name");
    if (typeof name !== "string" || expectedByName[name] === undefined) continue;
    if (foundByName.has(name)) {
      throw new Error(`Neo4j constraint metadata contains a duplicate ${name} constraint.`);
    }
    foundByName.add(name);

    const expected = expectedByName[name];
    const type: unknown = record.get("type");
    const entityType: unknown = record.get("entityType");
    const labelsOrTypes: unknown = record.get("labelsOrTypes");
    const properties: unknown = record.get("properties");
    if (
      type !== "UNIQUENESS" ||
      entityType !== "NODE" ||
      !Array.isArray(labelsOrTypes) ||
      labelsOrTypes.length !== 1 ||
      labelsOrTypes[0] !== expected.label ||
      !Array.isArray(properties) ||
      properties.length !== 1 ||
      properties[0] !== expected.property
    ) {
      throw new Error(`Neo4j constraint metadata is invalid for ${name}.`);
    }
  }

  if (foundByName.size !== EXPECTED_CONSTRAINTS.length) {
    const missing = EXPECTED_CONSTRAINTS.find((constraint) => !foundByName.has(constraint.name));
    throw new Error(`Neo4j constraint metadata is missing ${missing?.name ?? "an expected constraint"}.`);
  }
}

/** Initialize and verify the schema on one new, per-user Neo4j Community database. */
export async function bootstrapNeo4jInstance(
  config: Neo4jInstanceBootstrapConfig,
  options: Neo4jInstanceBootstrapOptions = {},
): Promise<{ database_id: string }> {
  if (config.database !== "neo4j") {
    throw new Error("Neo4j instance bootstrap only supports the neo4j database.");
  }

  const driverFactory = options.driverFactory ?? ((candidate) =>
    neo4j.driver(candidate.uri, neo4j.auth.basic(candidate.username, candidate.password)));
  let driver: BootstrapDriver | undefined;
  let session: BootstrapSession | undefined;

  try {
    driver = driverFactory(config);
    session = driver.session({ database: config.database });

    // Verify the selected database and credentials before any schema mutation.
    const databaseId = assertDatabaseInfo(await session.run("CALL db.info()"));
    for (const constraint of EXPECTED_CONSTRAINTS) {
      await session.run(
        `CREATE CONSTRAINT ${constraint.name} IF NOT EXISTS FOR (n:${constraint.label}) REQUIRE n.${constraint.property} IS UNIQUE`,
      );
    }
    assertExpectedConstraints(await session.run("SHOW CONSTRAINTS"));
    return { database_id: databaseId };
  } finally {
    try {
      await session?.close();
    } finally {
      await driver?.close();
    }
  }
}
