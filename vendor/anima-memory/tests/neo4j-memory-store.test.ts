import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import neo4j from "neo4j-driver";
import { CanonicalBuilder, eventFingerprint, uuidV5FromParts, type CanonicalRawEvent, type CaptureSessionFacts, type SourceEventFacts } from "@deepseek-ai/anima-capture";
import { canonicalize } from "json-canonicalize";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Neo4jConfig } from "@deepseek-ai/anima-capture/config";
import { recycleSyntheticScope, syntheticConfigPath } from "./dev-config.ts";
import {
  boundaryCursorUid,
  boundaryWindowUid,
  sessionContinuationDecisionUid,
} from "../src/index.ts";
import { Neo4jMemoryStore } from "../src/neo4j-memory-store.ts";
import { registerProjectOwnership, type ProjectOwnershipScope } from "../src/project-ownership.ts";
import type { CreateExactSpanModelMemoryInput, MemoryOperationInput } from "../src/types.ts";
import { memoryOperationConfirmation } from "../src/memory-operation-intent.ts";

type EventKind = "message" | "tool_call" | "tool_result" | "boundary" | "turn_end";
type BoundaryType = "checkpoint" | "compact" | "shutdown" | "validation" | "unknown";

type CaptureEvent = {
  event_uid: string;
  ingest_sequence: number;
  kind: EventKind;
  boundary_type?: BoundaryType;
};

type CaptureFixture = {
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  profile_uid: string;
  events: CaptureEvent[];
};

type MemoryGraph = {
  cursor: Record<string, unknown> | null;
  windows: Array<Record<string, unknown>>;
  assignments: Array<{
    event_uid: string;
    window_uid: string;
    projector_version: string;
  }>;
  continuations: Array<{
    decision_uid: string;
    previous_session_uid: string;
    evidence_event_uid: string;
    project_uid: string;
    schema_id: string;
    method: string;
  }>;
  semantic_nodes: number;
};

type CaptureSnapshot = {
  project: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  has_session: number;
  has_event: number;
  in_project: number;
};

const store = new Neo4jMemoryStore({ configPath: syntheticConfigPath() });
let directConfig: Neo4jConfig | undefined;
let directDriver: neo4j.Driver | undefined;
let directDatabase: string | undefined;
let semanticNodeBaseline: { episodes: number; projectStages: number } | undefined;
let semanticNodeAfterInitialize: { episodes: number; projectStages: number } | undefined;

const MEMORY_CONSTRAINTS = [
  "anima_project_uid_unique",
  "anima_session_uid_unique",
  "anima_raw_event_uid_unique",
  "anima_boundary_window_uid_unique",
  "anima_memory_cursor_uid_unique",
  "anima_episode_uid_unique",
  "anima_execution_unit_uid_unique",
  "anima_execution_review_candidate_uid_unique",
  "anima_execution_review_uid_unique",
  "anima_reflection_uid_unique",
  "anima_reflection_schedule_cursor_uid_unique",
  "anima_memory_subject_uid_unique",
  "anima_memory_uid_unique",
  "anima_memory_claim_key_unique",
  "anima_memory_revision_uid_unique",
  "anima_memory_decision_uid_unique",
] as const;

const STRUCTURAL_LABEL: Record<EventKind, string> = {
  message: "Message",
  tool_call: "ToolCall",
  tool_result: "ToolResult",
  boundary: "BoundarySignal",
  turn_end: "TurnEnd",
};

function fixture(events: Array<Pick<CaptureEvent, "kind" | "boundary_type">> = []): CaptureFixture {
  const project_uid = randomUUID();
  const session_uid = randomUUID();
  return {
    fixture_run_id: randomUUID(),
    project_uid,
    session_uid,
    profile_uid: randomUUID(),
    events: events.map((event, ingest_sequence) => ({
      event_uid: randomUUID(),
      ingest_sequence,
      kind: event.kind,
      ...(event.boundary_type === undefined ? {} : { boundary_type: event.boundary_type }),
    })),
  };
}

type RecentMemoryFixtureEvent = {
  labels: readonly string[];
  properties: Record<string, unknown>;
  text?: string;
  span?: CreateExactSpanModelMemoryInput["span"];
};

type RecentMemoryFixture = {
  fixture_run_id: string;
  project_uid: string;
  session_uid: string;
  session_source_id: string;
  identity_fingerprint: string;
  scope: ProjectOwnershipScope;
  builder: CanonicalBuilder;
  context: ReturnType<CanonicalBuilder["openSession"]>;
  events: RecentMemoryFixtureEvent[];
  alpha: RecentMemoryFixtureEvent;
  beta: RecentMemoryFixtureEvent;
  expired: RecentMemoryFixtureEvent;
  revoked: RecentMemoryFixtureEvent;
  gamma: RecentMemoryFixtureEvent;
  alphaRevision: RecentMemoryFixtureEvent;
  gammaRevision: RecentMemoryFixtureEvent;
};

function recentMemoryScope(): ProjectOwnershipScope {
  const principal_uid = randomUUID();
  let directory_id = randomUUID();
  while (directory_id === principal_uid) directory_id = randomUUID();
  const users_root = resolve(dirname(fileURLToPath(import.meta.url)), "../../.anima-dev/neo4j-memory-store-tests/users");
  return {
    users_root,
    directory_id,
    directory: resolve(users_root, directory_id),
    principal_uid,
  };
}

function recentMemoryEventProperties(event: CanonicalRawEvent): Record<string, unknown> {
  return {
    event_uid: event.event_uid,
    schema_id: event.schema_id,
    event_identity_method: event.event_identity_method,
    session_uid: event.session_uid,
    session_identity_method: event.session_identity_method,
    project_uid: event.project_uid,
    project_identity_method: event.project_identity_method,
    kind: event.kind,
    runtime_identity_json: canonicalize(event.runtime_identity as never),
    capture_capabilities_json: canonicalize(event.capture_capabilities as never),
    source_json: canonicalize(event.source as never),
    ingest_sequence: event.ingest_sequence,
    captured_at: event.captured_at,
    content_parts_json: canonicalize(event.content_parts as never),
    fidelity_json: canonicalize(event.fidelity as never),
    native_payload_json: event.native_payload_json,
    fingerprint: eventFingerprint(event),
    ...(event.kind === "tool_call" ? {
      tool_name: event.tool_name,
      extensions_json: canonicalize(event.extensions as never),
      "anima.tool.source_call_id": event.extensions?.["anima.tool.source_call_id"],
    } : { role: event.role, message_origin: event.message_origin }),
  };
}

function recentMemoryFixture(): RecentMemoryFixture {
  const fixture_run_id = randomUUID();
  const scope = recentMemoryScope();
  const compact = randomUUID().replaceAll("-", "");
  const identity_fingerprint = compact + compact;
  const session_source_id = randomUUID();
  const facts: CaptureSessionFacts = {
    installation_uid: fixture_run_id,
    runtime: { family: "omp", version: "1", adapter_version: "recent-memory-test" },
    profile: { method: "source", source_id: randomUUID() },
    project: { method: "source", normalized_identity: `repo:/recent-memory/${fixture_run_id}` },
    session: { method: "source", source_id: session_source_id },
    capture_capabilities: {
      schema_id: "anima.capture-capabilities/v1.0",
      stable_session_id: true,
      stable_event_id: true,
      stable_tool_call_id: true,
      final_assistant_message: true,
      final_tool_result: true,
      developer_messages: true,
      multimodal_content: true,
      source_sequence: true,
      source_timestamp: true,
      compact_event: true,
      shutdown_event: true,
      user_message_origin: true,
      turn_end_event: true,
    },
  };
  const builder = new CanonicalBuilder({
    core_version: "recent-memory-test",
    now: () => "2026-09-20T00:00:00.000Z",
  });
  const context = builder.openSession(facts);
  const events: RecentMemoryFixtureEvent[] = [];
  const addUserMessage = (text: string): RecentMemoryFixtureEvent => {
    const source: SourceEventFacts = {
      kind: "message",
      source: { event_name: "message.created", event_id: randomUUID(), session_id: session_source_id },
      role: "user",
      message_origin: "external_user",
      content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text }],
      fidelity: { completeness: "full", missing_fields: [] },
      native_payload: { fixture_run_id },
    };
    const event = builder.finalize(builder.build(context, source), events.length);
    const bytes = Buffer.from(text, "utf8");
    const fixtureEvent: RecentMemoryFixtureEvent = {
      labels: ["RawEvent", "Message"],
      properties: recentMemoryEventProperties(event),
      text,
      span: {
        text_part_index: 0,
        utf8_start: 0,
        utf8_end: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
    events.push(fixtureEvent);
    return fixtureEvent;
  };

  const alpha = addUserMessage("Alpha original");
  const beta = addUserMessage("Beta memory");
  const expired = addUserMessage("Expired memory");
  const revoked = addUserMessage("Revoked memory");
  const gamma = addUserMessage("Gamma original");
  const alphaRevision = addUserMessage("Alpha revised; 在成都喝茶和散步，记录雨后街道。");
  const gammaRevision = addUserMessage("Gamma revised 成都散步");

  return {
    fixture_run_id,
    project_uid: context.project_uid,
    session_uid: context.session_uid,
    session_source_id,
    identity_fingerprint,
    builder,
    context,
    gamma,
    scope,
    events,
    alpha,
    beta,
    expired,
    revoked,
    alphaRevision,
    gammaRevision,
  };
}

async function seedRecentMemoryFixture(value: RecentMemoryFixture): Promise<void> {
  await mkdir(resolve(value.scope.directory, "data"), { recursive: true });
  await registerProjectOwnership(value.scope, {
    project_uid: value.project_uid,
    identity_fingerprint: value.identity_fingerprint,
  });
  await directWrite(async (transaction) => {
    await transaction.run("CREATE (p:Project) SET p = $properties", {
      properties: {
        project_uid: value.project_uid,
        identity_fingerprint: value.identity_fingerprint,
        fixture_run_id: value.fixture_run_id,
      },
    });
    await transaction.run("CREATE (s:Session) SET s = $properties", {
      properties: {
        session_uid: value.session_uid,
        project_uid: value.project_uid,
        next_ingest_sequence: value.events.length,
        fixture_run_id: value.fixture_run_id,
      },
    });
    await transaction.run(
      "MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}) CREATE (p)-[:HAS_SESSION]->(s)",
      { project_uid: value.project_uid, session_uid: value.session_uid },
    );
    for (const item of value.events) {
      const labels = item.labels.includes("Message") ? ":Message" : item.labels.includes("ToolCall") ? ":ToolCall" : "";
      await transaction.run(`CREATE (e:RawEvent${labels}) SET e = $properties`, { properties: item.properties });
      await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}), (e:RawEvent {event_uid: $event_uid})
         CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)`,
        {
          project_uid: value.project_uid,
          session_uid: value.session_uid,
          event_uid: item.properties.event_uid,
        },
      );
    }
  });
}

async function appendRecentFixtureEvent(
  fixture: RecentMemoryFixture,
  source: SourceEventFacts,
  text?: string,
): Promise<RecentMemoryFixtureEvent> {
  const event = fixture.builder.finalize(fixture.builder.build(fixture.context, source), fixture.events.length);
  const labels = source.kind === "tool_call" ? ["RawEvent", "ToolCall"] : ["RawEvent", "Message"];
  const bytes = text === undefined ? undefined : Buffer.from(text, "utf8");
  const appended: RecentMemoryFixtureEvent = {
    labels, properties: recentMemoryEventProperties(event),
    ...(text === undefined ? {} : {
      text,
      span: {
        text_part_index: 0, utf8_start: 0, utf8_end: bytes!.byteLength,
        sha256: createHash("sha256").update(bytes!).digest("hex"),
      },
    }),
  };
  await directWrite(async (transaction) => {
    await transaction.run(`CREATE (e:RawEvent${source.kind === "tool_call" ? ":ToolCall" : ":Message"}) SET e = $properties`,
      { properties: appended.properties });
    await transaction.run(
      `MATCH (s:Session {session_uid: $session_uid}), (p:Project {project_uid: $project_uid}),
             (e:RawEvent {event_uid: $event_uid})
       CREATE (s)-[:HAS_EVENT]->(e) CREATE (e)-[:IN_PROJECT]->(p)
       SET s.next_ingest_sequence = $next_ingest_sequence`,
      { session_uid: fixture.session_uid, project_uid: fixture.project_uid, event_uid: event.event_uid,
        next_ingest_sequence: fixture.events.length + 1 },
    );
  });
  fixture.events.push(appended);
  return appended;
}

async function appendRecentMemoryUserText(fixture: RecentMemoryFixture, text: string): Promise<RecentMemoryFixtureEvent> {
  return appendRecentFixtureEvent(fixture, {
    kind: "message",
    source: { event_name: "message.created", event_id: randomUUID(), session_id: fixture.session_source_id },
    role: "user", message_origin: "external_user",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { fixture_run_id: fixture.fixture_run_id },
  }, text);
}

async function appendRecentMemoryOperation(
  fixture: RecentMemoryFixture,
  memory_uid: string,
  expected_revision_uid: string,
  action: MemoryOperationInput["action"],
  extra: Pick<MemoryOperationInput, "statement" | "valid_until"> = {},
): Promise<RecentMemoryFixtureEvent> {
  const toolCallId = randomUUID();
  const input = {
    memory_uid, expected_revision_uid, action,
    ...(action === "revise" ? { statement: extra.statement } : {}),
    ...(action === "set_expiry" ? { valid_until: extra.valid_until } : {}),
  };
  const source: SourceEventFacts = {
    kind: "tool_call",
    source: { event_name: "tool_call", event_id: `tool-call:${toolCallId}`, session_id: fixture.session_source_id },
    tool_name: "anima_memory_operation",
    content_parts: [{ schema_id: "anima.content-part/v1.0", type: "json", part_index: 0, value_json: canonicalize(input as never) }],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { type: "tool_call", toolCallId, toolName: "anima_memory_operation", input: input as never },
    extensions: { "anima.tool.source_call_id": toolCallId },
  };
  return appendRecentFixtureEvent(fixture, source);
}

function exactSpanMemoryInput(
  fixtureData: RecentMemoryFixture,
  source: RecentMemoryFixtureEvent,
  now: string,
): CreateExactSpanModelMemoryInput {
  if (source.text === undefined || source.span === undefined) throw new Error("recent-memory evidence event is incomplete");
  return {
    project_uid: fixtureData.project_uid,
    session_uid: fixtureData.session_uid,
    event_uid: String(source.properties.event_uid),
    span: source.span,
    statement: source.text,
    decision_uid: randomUUID(),
    now,
  };
}

function memoryOperationInput(
  fixtureData: RecentMemoryFixture,
  userEvent: RecentMemoryFixtureEvent,
  operationEvent: RecentMemoryFixtureEvent,
  memory_uid: string,
  expected_revision_uid: string,
  action: MemoryOperationInput["action"],
  now: string,
  extra: Pick<MemoryOperationInput, "statement" | "valid_until"> = {},
): MemoryOperationInput {
  if (userEvent.span === undefined) throw new Error("recent-memory operation evidence event is incomplete");
  return {
    project_uid: fixtureData.project_uid,
    session_uid: fixtureData.session_uid,
    operation_event_uid: String(operationEvent.properties.event_uid),
    tool_call_id: String(operationEvent.properties["anima.tool.source_call_id"]),
    user_event_uid: String(userEvent.properties.event_uid),
    user_span: userEvent.span,
    memory_uid,
    expected_revision_uid,
    action,
    decision_uid: randomUUID(),
    now,
    ...extra,
  };
}

function event(kind: EventKind, boundary_type?: BoundaryType): Pick<CaptureEvent, "kind" | "boundary_type"> {
  return boundary_type === undefined ? { kind } : { kind, boundary_type };
}

function numberValue(value: unknown): number {
  return neo4j.isInt(value) ? value.toNumber() : Number(value);
}

function normalize(value: unknown): unknown {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)]));
  }
  return value;
}

function normalizedRecord(value: unknown): Record<string, unknown> {
  return normalize(value) as Record<string, unknown>;
}

async function withDirectSession<T>(work: (session: neo4j.Session) => Promise<T>): Promise<T> {
  if (directConfig === undefined || directDatabase === undefined) {
    throw new Error("R3A actual Neo4j fixture config is not initialized.");
  }
  directDriver ??= neo4j.driver(
    directConfig.uri,
    neo4j.auth.basic(directConfig.username, directConfig.password),
  );
  const session = directDriver.session({ database: directDatabase });
  try {
    return await work(session);
  } finally {
    await session.close();
    // Bun 1.3.14 returns this session to the pool on the next timer turn.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function directRead<T>(work: (runner: Pick<neo4j.ManagedTransaction, "run">) => Promise<T>): Promise<T> {
  return withDirectSession((session) => work(session));
}
async function directWrite<T>(work: (transaction: neo4j.ManagedTransaction) => Promise<T>): Promise<T> {
  return withDirectSession((session) => session.executeWrite(work));
}


function projectProperties(fixtureData: CaptureFixture): Record<string, unknown> {
  return {
    project_uid: fixtureData.project_uid,
    identity_fingerprint: `synthetic-project-${fixtureData.project_uid}`,
    created_at: "2026-09-20T00:00:00.000Z",
    fixture_run_id: fixtureData.fixture_run_id,
  };
}

function sessionProperties(fixtureData: CaptureFixture): Record<string, unknown> {
  return {
    session_uid: fixtureData.session_uid,
    session_identity_method: "source",
    identity_fingerprint: `synthetic-session-${fixtureData.session_uid}`,
    project_uid: fixtureData.project_uid,
    project_identity_method: "derived",
    profile_uid: fixtureData.profile_uid,
    profile_identity_method: "derived",
    profile_identity_fingerprint: `synthetic-profile-${fixtureData.profile_uid}`,
    runtime_family: "r3a-test",
    source_session_id: `synthetic-session-${fixtureData.session_uid}`,
    next_ingest_sequence: fixtureData.events.length,
    created_at: "2026-09-20T00:00:00.000Z",
    fixture_run_id: fixtureData.fixture_run_id,
  };
}

function eventProperties(fixtureData: CaptureFixture, item: CaptureEvent): Record<string, unknown> {
  return {
    event_uid: item.event_uid,
    schema_id: "anima.raw-event/v1.0",
    event_identity_method: "source",
    session_uid: fixtureData.session_uid,
    session_identity_method: "source",
    project_uid: fixtureData.project_uid,
    project_identity_method: "derived",
    kind: item.kind,
    runtime_identity_json: JSON.stringify({
      schema_id: "anima.runtime-identity/v1.0",
      installation_uid: fixtureData.fixture_run_id,
      runtime_family: "r3a-test",
      adapter_version: "r3a-test",
      core_version: "capture-test",
      profile_uid: fixtureData.profile_uid,
      profile_identity_method: "derived",
    }),
    capture_capabilities_json: JSON.stringify({
      schema_id: "anima.capture-capabilities/v1.0",
      stable_session_id: true,
      stable_event_id: true,
      stable_tool_call_id: true,
      final_assistant_message: true,
      final_tool_result: true,
      developer_messages: true,
      multimodal_content: true,
      source_sequence: true,
      source_timestamp: true,
      compact_event: true,
      shutdown_event: true,
      user_message_origin: true,
      turn_end_event: true,
    }),
    source_json: JSON.stringify({
      event_name: `synthetic.${item.kind}`,
      event_id: item.event_uid,
      session_id: fixtureData.session_uid,
    }),
    ingest_sequence: item.ingest_sequence,
    captured_at: "2026-09-20T00:00:00.000Z",
    content_parts_json: JSON.stringify([]),
    fidelity_json: JSON.stringify({ completeness: "full", missing_fields: [] }),
    native_payload_json: JSON.stringify({ fixture_run_id: fixtureData.fixture_run_id, event_uid: item.event_uid }),
    fingerprint: `synthetic-event-${item.event_uid}`,
    fixture_run_id: fixtureData.fixture_run_id,
    ...(item.boundary_type === undefined ? {} : { boundary_type: item.boundary_type }),
  };
}

async function seedCapture(
  fixtureData: CaptureFixture,
  projectAlreadySeeded = false,
  omitEventRelationships = false,
): Promise<void> {
  await directWrite(async (transaction) => {
    if (!projectAlreadySeeded) {
      await transaction.run(
        "CREATE (p:Project) SET p += $properties",
        { properties: projectProperties(fixtureData) },
      );
    }
    await transaction.run(
      "CREATE (s:Session) SET s += $properties",
      { properties: sessionProperties(fixtureData) },
    );
    await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid})
       CREATE (p)-[:HAS_SESSION]->(s)`,
      { project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid },
    );
    for (const item of fixtureData.events) {
      await transaction.run(
        `CREATE (e:RawEvent:${STRUCTURAL_LABEL[item.kind]}) SET e += $properties`,
        { properties: eventProperties(fixtureData, item) },
      );
      if (omitEventRelationships) continue;
      await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid}),
              (p:Project {project_uid: $project_uid}),
              (e:RawEvent {event_uid: $event_uid})
         CREATE (s)-[:HAS_EVENT]->(e)
         CREATE (e)-[:IN_PROJECT]->(p)`,
        {
          project_uid: fixtureData.project_uid,
          session_uid: fixtureData.session_uid,
          event_uid: item.event_uid,
        },
      );
    }
  });
}

async function appendCaptureEvents(fixtureData: CaptureFixture, additions: Array<Pick<CaptureEvent, "kind" | "boundary_type">>): Promise<CaptureEvent[]> {
  const added = additions.map((item, offset) => ({
    event_uid: randomUUID(),
    ingest_sequence: fixtureData.events.length + offset,
    kind: item.kind,
    ...(item.boundary_type === undefined ? {} : { boundary_type: item.boundary_type }),
  }));
  await directWrite(async (transaction) => {
    for (const item of added) {
      await transaction.run(
        `CREATE (e:RawEvent:${STRUCTURAL_LABEL[item.kind]}) SET e += $properties`,
        { properties: eventProperties(fixtureData, item) },
      );
      await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid}),
              (p:Project {project_uid: $project_uid}),
              (e:RawEvent {event_uid: $event_uid})
         CREATE (s)-[:HAS_EVENT]->(e)
         CREATE (e)-[:IN_PROJECT]->(p)`,
        {
          project_uid: fixtureData.project_uid,
          session_uid: fixtureData.session_uid,
          event_uid: item.event_uid,
        },
      );
    }
    await transaction.run(
      `MATCH (s:Session {session_uid: $session_uid})
       SET s.next_ingest_sequence = $next_ingest_sequence`,
      { session_uid: fixtureData.session_uid, next_ingest_sequence: fixtureData.events.length + added.length },
    );
  });
  fixtureData.events.push(...added);
  return added;
}

async function mutateCapture(cypher: string, parameters: Record<string, unknown> = {}): Promise<void> {
  await directWrite(async (transaction) => {
    await transaction.run(cypher, parameters);
  });
}

async function captureSnapshot(fixtureData: CaptureFixture): Promise<CaptureSnapshot> {
  return directRead(async (transaction) => {
    const project = await transaction.run(
      "MATCH (p:Project {project_uid: $project_uid}) RETURN properties(p) AS properties",
      { project_uid: fixtureData.project_uid },
    );
    const session = await transaction.run(
      "MATCH (s:Session {session_uid: $session_uid}) RETURN properties(s) AS properties",
      { session_uid: fixtureData.session_uid },
    );
    const events = await transaction.run(
      `MATCH (e:RawEvent {fixture_run_id: $fixture_run_id})
       RETURN properties(e) AS properties ORDER BY e.ingest_sequence, e.event_uid`,
      { fixture_run_id: fixtureData.fixture_run_id },
    );
    const topology = await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid})
       OPTIONAL MATCH (p)-[has_session:HAS_SESSION]->(s:Session {session_uid: $session_uid})
       OPTIONAL MATCH (s)-[has_event:HAS_EVENT]->(e:RawEvent {fixture_run_id: $fixture_run_id})
       OPTIONAL MATCH (e)-[in_project:IN_PROJECT]->(p)
       RETURN count(DISTINCT has_session) AS has_session,
              count(DISTINCT has_event) AS has_event,
              count(DISTINCT in_project) AS in_project`,
      {
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        fixture_run_id: fixtureData.fixture_run_id,
      },
    );
    const topologyRecord = topology.records[0];
    return {
      project: project.records[0] === undefined ? null : normalizedRecord(project.records[0].get("properties")),
      session: session.records[0] === undefined ? null : normalizedRecord(session.records[0].get("properties")),
      events: events.records.map((record) => normalizedRecord(record.get("properties"))),
      has_session: numberValue(topologyRecord?.get("has_session") ?? 0),
      has_event: numberValue(topologyRecord?.get("has_event") ?? 0),
      in_project: numberValue(topologyRecord?.get("in_project") ?? 0),
    };
  });
}

async function memoryGraph(fixtureData: CaptureFixture, previous_session_uid?: string): Promise<MemoryGraph> {
  return directRead(async (transaction) => {
    const cursor = await transaction.run(
      `MATCH (c:MemoryCursor {session_uid: $session_uid})
       RETURN properties(c) AS properties`,
      { session_uid: fixtureData.session_uid },
    );
    const windows = await transaction.run(
      `MATCH (w:BoundaryWindow {project_uid: $project_uid, session_uid: $session_uid})
       RETURN properties(w) AS properties ORDER BY w.start_ingest_sequence`,
      { project_uid: fixtureData.project_uid, session_uid: fixtureData.session_uid },
    );
    const assignments = await transaction.run(
      `MATCH (e:RawEvent {fixture_run_id: $fixture_run_id})-[r:IN_BOUNDARY_WINDOW]->(w:BoundaryWindow)
       RETURN e.event_uid AS event_uid, w.window_uid AS window_uid, r.projector_version AS projector_version
       ORDER BY e.ingest_sequence`,
      { fixture_run_id: fixtureData.fixture_run_id },
    );
    const continuationQuery = previous_session_uid === undefined
      ? `MATCH (s:Session {session_uid: $session_uid})-[r:CONTINUES_FROM]->(p:Session)
         RETURN r.decision_uid AS decision_uid, p.session_uid AS previous_session_uid,
                r.evidence_event_uid AS evidence_event_uid, r.project_uid AS project_uid,
                r.schema_id AS schema_id, r.method AS method`
      : `MATCH (s:Session {session_uid: $session_uid})-[r:CONTINUES_FROM]->(p:Session {session_uid: $previous_session_uid})
         RETURN r.decision_uid AS decision_uid, p.session_uid AS previous_session_uid,
                r.evidence_event_uid AS evidence_event_uid, r.project_uid AS project_uid,
                r.schema_id AS schema_id, r.method AS method`;
    const continuations = await transaction.run(continuationQuery, {
      session_uid: fixtureData.session_uid,
      ...(previous_session_uid === undefined ? {} : { previous_session_uid }),
    });
    const semantic = await transaction.run(
      `MATCH (n)
       WHERE (n:Episode OR n:ProjectStage)
         AND (n.project_uid = $project_uid OR n.session_uid = $session_uid OR n.fixture_run_id = $fixture_run_id)
       RETURN count(n) AS count`,
      {
        project_uid: fixtureData.project_uid,
        session_uid: fixtureData.session_uid,
        fixture_run_id: fixtureData.fixture_run_id,
      },
    );
    return {
      cursor: cursor.records[0] === undefined ? null : normalizedRecord(cursor.records[0].get("properties")),
      windows: windows.records.map((record) => normalizedRecord(record.get("properties"))),
      assignments: assignments.records.map((record) => ({
        event_uid: String(record.get("event_uid")),
        window_uid: String(record.get("window_uid")),
        projector_version: String(record.get("projector_version")),
      })),
      continuations: continuations.records.map((record) => ({
        decision_uid: String(record.get("decision_uid")),
        previous_session_uid: String(record.get("previous_session_uid")),
        evidence_event_uid: String(record.get("evidence_event_uid")),
        project_uid: String(record.get("project_uid")),
        schema_id: String(record.get("schema_id")),
        method: String(record.get("method")),
      })),
      semantic_nodes: numberValue(semantic.records[0]?.get("count") ?? 0),
    };
  });
}

async function countMemoryArtifacts(fixtureData: CaptureFixture): Promise<{ cursors: number; windows: number; assignments: number }> {
  return directRead(async (transaction) => {
    const parameters = {
      cursor_uid: boundaryCursorUid(fixtureData.session_uid),
      project_uid: fixtureData.project_uid,
      session_uid: fixtureData.session_uid,
      fixture_run_id: fixtureData.fixture_run_id,
    };
    if (fixtureData.events.length === 0) {
      const cursorResult = await transaction.run(
        `MATCH (c:MemoryCursor {cursor_uid: $cursor_uid})
         RETURN count(c) AS cursors`,
        parameters,
      );
      const cursors = numberValue(cursorResult.records[0]?.get("cursors") ?? 0);
      const assignmentResult = await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid})
         OPTIONAL MATCH (s)-[:HAS_EVENT]->(e:RawEvent)-[r:IN_BOUNDARY_WINDOW]->(:BoundaryWindow)
         WHERE e.fixture_run_id = $fixture_run_id
         RETURN count(r) AS assignments`,
        parameters,
      );
      return {
        cursors,
        windows: 0,
        assignments: numberValue(assignmentResult.records[0]?.get("assignments") ?? 0),
      };
    }
    const result = await transaction.run(
      `CALL {
         MATCH (c:MemoryCursor {cursor_uid: $cursor_uid})
         RETURN count(c) AS cursors
       }
       CALL {
         MATCH (w:BoundaryWindow {project_uid: $project_uid, session_uid: $session_uid})
         RETURN count(w) AS windows
       }
       CALL {
         MATCH (s:Session {session_uid: $session_uid})-[:HAS_EVENT]->(e:RawEvent)
         WHERE e.fixture_run_id = $fixture_run_id
         MATCH (e)-[r:IN_BOUNDARY_WINDOW]->(:BoundaryWindow)
         RETURN count(r) AS assignments
       }
       RETURN cursors, windows, assignments`,
      parameters,
    );
    const record = result.records[0];
    return {
      cursors: numberValue(record?.get("cursors") ?? 0),
      windows: numberValue(record?.get("windows") ?? 0),
      assignments: numberValue(record?.get("assignments") ?? 0),
    };
  });
}

async function semanticNodeCounts(): Promise<{ episodes: number; projectStages: number }> {
  return directRead(async (transaction) => {
    const result = await transaction.run(
      `CALL {
         MATCH (n:Episode)
         RETURN count(n) AS episodes
       }
       CALL {
         MATCH (n:ProjectStage)
         RETURN count(n) AS project_stages
       }
       RETURN episodes, project_stages`,
    );
    return {
      episodes: numberValue(result.records[0]?.get("episodes") ?? 0),
      projectStages: numberValue(result.records[0]?.get("project_stages") ?? 0),
    };
  });
}

async function expectNoSemanticNodes(_fixtureData: CaptureFixture): Promise<void> {
  if (semanticNodeBaseline === undefined) throw new Error("Semantic-node baseline is not initialized.");
  await expect(semanticNodeCounts()).resolves.toEqual(semanticNodeBaseline);
}

async function expectCaptureUnchanged(fixtureData: CaptureFixture, before: CaptureSnapshot): Promise<void> {
  await expect(captureSnapshot(fixtureData)).resolves.toEqual(before);
}

async function checkpointFixture(): Promise<{ project_uid: string; previous: CaptureFixture; current: CaptureFixture; checkpoint: CaptureEvent }> {
  const project_uid = randomUUID();
  const previous = fixture([event("message")]);
  const current = fixture([event("message"), event("boundary", "checkpoint")]);
  previous.project_uid = project_uid;
  current.project_uid = project_uid;
  await seedCapture(previous);
  await seedCapture(current, true);
  const checkpoint = current.events[1];
  if (checkpoint === undefined) throw new Error("checkpoint fixture did not create its evidence event");
  return { project_uid, previous, current, checkpoint };
}

beforeAll(async () => {
  const loaded = await loadConfig(syntheticConfigPath());
  if (loaded.kind !== "ready") {
    throw new Error(`R3A actual Neo4j fixture config is required; Capture config was ${loaded.kind}: ${loaded.reason}`);
  }
  const config: Neo4jConfig = loaded.config;
  directConfig = config;
  directDatabase = config.database;
  semanticNodeBaseline = await semanticNodeCounts();

  const health = await store.initialize();
  if (health.status !== "connected") {
    throw new Error(`R3A actual Neo4j is required; Memory Store health was ${health.status}.`);
  }
  semanticNodeAfterInitialize = await semanticNodeCounts();
});

afterAll(async () => {
  await store.close(1500);
  if (directDriver !== undefined) await directDriver.close();
});

describe("Neo4jMemoryStore actual Neo4j behavior", () => {
  test("verifies exact constraint metadata entries and reports fixed health ordering", async () => {
    const health = await store.initialize();
    expect(health).toMatchObject({ status: "connected", database: directDatabase });
    expect(health.constraints).toEqual([...MEMORY_CONSTRAINTS]);

    const metadata = await directRead(async (transaction) => {
      const result = await transaction.run(
        `SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties
         WHERE name IN $names
         RETURN name, type, entityType, labelsOrTypes, properties`,
        { names: [...MEMORY_CONSTRAINTS] },
      );
      return result.records.map((record) => ({
        name: String(record.get("name")),
        type: String(record.get("type")),
        entityType: String(record.get("entityType")),
        labelsOrTypes: normalize(record.get("labelsOrTypes")),
        properties: normalize(record.get("properties")),
      })).sort((left, right) => left.name.localeCompare(right.name));
    });
    expect(metadata).toEqual([
      { name: "anima_boundary_window_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["BoundaryWindow"], properties: ["window_uid"] },
      { name: "anima_episode_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Episode"], properties: ["episode_uid"] },
      { name: "anima_execution_review_candidate_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["ExecutionReviewCandidate"], properties: ["candidate_uid"] },
      { name: "anima_execution_review_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["ExecutionReview"], properties: ["review_uid"] },
      { name: "anima_execution_unit_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["ExecutionUnit"], properties: ["execution_uid"] },
      { name: "anima_memory_cursor_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["MemoryCursor"], properties: ["cursor_uid"] },
      { name: "anima_memory_claim_key_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Memory"], properties: ["claim_key"] },
      { name: "anima_memory_decision_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["MemoryDecision"], properties: ["decision_uid"] },
      { name: "anima_memory_revision_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["MemoryRevision"], properties: ["revision_uid"] },
      { name: "anima_memory_subject_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["MemorySubject"], properties: ["domain_uid"] },
      { name: "anima_memory_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Memory"], properties: ["memory_uid"] },
      { name: "anima_project_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Project"], properties: ["project_uid"] },
      { name: "anima_raw_event_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["RawEvent"], properties: ["event_uid"] },
      { name: "anima_reflection_schedule_cursor_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["ReflectionScheduleCursor"], properties: ["cursor_uid"] },
      { name: "anima_reflection_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Reflection"], properties: ["reflection_uid"] },
      { name: "anima_session_uid_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["Session"], properties: ["session_uid"] },
    ].sort((left, right) => left.name.localeCompare(right.name)));
  }, { timeout: 30_000 });

  test("round-trips current revisions, expiry, revoke, suspension, and rejects corrupted operation evidence", async () => {
    const data = recentMemoryFixture();
    const emptyProjectUid = randomUUID();
    const emptyFingerprintRaw = randomUUID().replaceAll("-", "");
    const emptyIdentityFingerprint = emptyFingerprintRaw + emptyFingerprintRaw;
    const storeWithScope = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      projectOwnership: data.scope,
    });
    let seeded = false;
    try {
      seeded = true;
      await seedRecentMemoryFixture(data);
      expect((await storeWithScope.initialize()).status).toBe("connected");

      const deniedInput = {
        ...exactSpanMemoryInput(data, data.alpha, "2026-09-19T23:59:00.000Z"),
        authorize_before_write: async () => false,
      };
      await expect(storeWithScope.createExactSpanModelMemoryRevision(deniedInput)).resolves.toMatchObject({
        status: "failed", code: "identity_conflict",
      });
      const deniedDecision = await directRead((transaction) => transaction.run(
        "MATCH (d:MemoryDecision {decision_uid: $decision_uid}) RETURN count(d) AS count",
        { decision_uid: deniedInput.decision_uid },
      ));
      expect(numberValue(deniedDecision.records[0]?.get("count"))).toBe(0);

      const save = async (source: RecentMemoryFixtureEvent, now: string) => {
        const result = await storeWithScope.createExactSpanModelMemoryRevision(exactSpanMemoryInput(data, source, now));
        if (result.status !== "written") throw new Error(`Expected a written fixture memory, got ${JSON.stringify(result)}.`);
        return result;
      };
      const alpha = await save(data.alpha, "2026-09-20T00:00:00.000Z");
      const beta = await save(data.beta, "2026-09-22T00:00:00.000Z");
      const expired = await save(data.expired, "2026-09-22T00:00:00.000Z");
      const revoked = await save(data.revoked, "2026-09-22T00:00:00.000Z");
      const gamma = await save(data.gamma, "2026-09-21T00:00:00.000Z");

      const alphaOperation = await appendRecentMemoryOperation(data, alpha.memory_uid, alpha.revision_uid, "revise", { statement: data.alphaRevision.text! });
      const alphaOperationInput = memoryOperationInput(
        data, data.alphaRevision, alphaOperation, alpha.memory_uid, alpha.revision_uid, "revise", "2026-09-23T12:00:00.000Z",
        { statement: data.alphaRevision.text! },
      );
      await expect(storeWithScope.applyMemoryOperation({
        ...alphaOperationInput,
        tool_call_id: ` ${alphaOperationInput.tool_call_id}`,
      })).resolves.toMatchObject({ status: "failed", code: "invalid_input" });
      const beforeWrongId = await storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid, limit: 5, now: "2026-09-23T12:00:00.000Z",
      });
      if (beforeWrongId.status !== "completed") throw new Error("Expected a completed listing before the wrong-ID operation.");
      expect(beforeWrongId.results.find(({ id }) => id === alpha.memory_uid)?.revision_uid).toBe(alpha.revision_uid);
      const wrongIdInput = { ...alphaOperationInput, tool_call_id: `${alphaOperationInput.tool_call_id}-wrong` };
      await expect(storeWithScope.applyMemoryOperation(wrongIdInput)).resolves.toMatchObject({
        status: "failed", code: "evidence_invalid",
      });
      const afterWrongId = await storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid, limit: 5, now: "2026-09-23T12:00:00.000Z",
      });
      if (afterWrongId.status !== "completed") throw new Error("Expected a completed listing after the wrong-ID operation.");
      expect(afterWrongId.results.find(({ id }) => id === alpha.memory_uid)?.revision_uid).toBe(alpha.revision_uid);
      const wrongDecision = await directWrite((transaction) => transaction.run(
        "MATCH (d:MemoryDecision {decision_uid: $decision_uid}) RETURN count(d) AS count",
        { decision_uid: wrongIdInput.decision_uid },
      ));
      expect(numberValue(wrongDecision.records[0]?.get("count"))).toBe(0);
      const revisedAlpha = await storeWithScope.applyMemoryOperation(alphaOperationInput);
      expect(revisedAlpha).toMatchObject({ status: "written", memory_uid: alpha.memory_uid });
      if (revisedAlpha.status !== "written") throw new Error("Expected the current revision to be written.");
      const repeatedSource = await appendRecentMemoryUserText(data, data.alpha.text!);
      const repeatedInput = {
        ...exactSpanMemoryInput(data, repeatedSource, "2026-09-23T12:00:01.000Z"),
        decision_uid: randomUUID(),
      };
      await expect(storeWithScope.createExactSpanModelMemoryRevision(repeatedInput)).resolves.toMatchObject({
        status: "failed", code: "revision_conflict",
      });
      const afterRepeatedOriginal = await storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid, limit: 5, now: "2026-09-23T12:00:01.000Z",
      });
      if (afterRepeatedOriginal.status !== "completed") throw new Error("A rejected duplicate must leave the current memory readable.");
      expect(afterRepeatedOriginal.results.find(({ id }) => id === alpha.memory_uid)?.revision_uid).toBe(revisedAlpha.revision_uid);
      const rejectedDecision = await directWrite((transaction) => transaction.run(
        "MATCH (d:MemoryDecision {decision_uid: $decision_uid}) RETURN count(d) AS count",
        { decision_uid: repeatedInput.decision_uid },
      ));
      expect(numberValue(rejectedDecision.records[0]?.get("count"))).toBe(0);
      const gammaOperation = await appendRecentMemoryOperation(data, gamma.memory_uid, gamma.revision_uid, "revise", { statement: data.gammaRevision.text! });
      const revisedGamma = await storeWithScope.applyMemoryOperation(memoryOperationInput(
        data, data.gammaRevision, gammaOperation, gamma.memory_uid, gamma.revision_uid, "revise", "2026-09-23T12:00:00.000Z",
        { statement: data.gammaRevision.text! },
      ));
      expect(revisedGamma).toMatchObject({ status: "written", memory_uid: gamma.memory_uid });
      const expirationCommand = await appendRecentMemoryUserText(data, memoryOperationConfirmation({
        action: "set_expiry", memory_uid: expired.memory_uid, expected_revision_uid: expired.revision_uid,
        valid_until: "2026-09-23T13:00:00.000Z",
      }));
      const expirationOperation = await appendRecentMemoryOperation(data, expired.memory_uid, expired.revision_uid, "set_expiry", { valid_until: "2026-09-23T13:00:00.000Z" });
      const expiredResult = await storeWithScope.applyMemoryOperation(memoryOperationInput(
        data, expirationCommand, expirationOperation, expired.memory_uid, expired.revision_uid, "set_expiry",
        "2026-09-23T11:00:00.000Z", { valid_until: "2026-09-23T13:00:00.000Z" },
      ));
      expect(expiredResult).toMatchObject({ status: "written", memory_uid: expired.memory_uid });
      const revokeCommand = await appendRecentMemoryUserText(data, memoryOperationConfirmation({
        action: "revoke", memory_uid: revoked.memory_uid, expected_revision_uid: revoked.revision_uid,
      }));
      const revokeOperation = await appendRecentMemoryOperation(data, revoked.memory_uid, revoked.revision_uid, "revoke");
      const revokedResult = await storeWithScope.applyMemoryOperation(memoryOperationInput(
        data, revokeCommand, revokeOperation, revoked.memory_uid, revoked.revision_uid, "revoke", "2026-09-23T11:00:00.000Z",
      ));
      expect(revokedResult).toMatchObject({ status: "written", memory_uid: revoked.memory_uid });

      await registerProjectOwnership(data.scope, {
        project_uid: emptyProjectUid,
        identity_fingerprint: emptyIdentityFingerprint,
      });
      await directWrite((transaction) => transaction.run("CREATE (p:Project) SET p = $properties", {
        properties: {
          project_uid: emptyProjectUid,
          identity_fingerprint: emptyIdentityFingerprint,
          fixture_run_id: data.fixture_run_id,
        },
      }));

      const now = "2026-09-24T00:00:00.000Z";
      const listed = await storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid,
        limit: 5,
        now,
      });
      expect(listed.status).toBe("completed");
      if (listed.status !== "completed") throw new Error("Expected recent memory listing to complete.");
      const sameTimeIds = [alpha.memory_uid, gamma.memory_uid].sort();
      expect(listed.results.map(({ id }) => id)).toEqual([...sameTimeIds, beta.memory_uid]);
      expect(listed.count).toBe(3);
      expect(listed.results.find(({ id }) => id === alpha.memory_uid)).toMatchObject({
        revision_uid: revisedAlpha.revision_uid,
        narrative: "Alpha revised; 在成都喝茶和散步，记录雨后街道。",
        created_at: "2026-09-23T12:00:00.000Z",
      });
      for (const [query, ids] of [
        ["Alpha", [alpha.memory_uid]],
        ["original", []],
        ["memory", [beta.memory_uid]],
        ["Expired", []],
        ["Revoked", []],
      ] as const) {
        const result = await storeWithScope.searchProjectMemories({
          project_uid: data.project_uid, query, top_k: 5, now,
        });
        expect(result.status).toBe("completed");
        if (result.status === "completed") expect(result.results.map(({ id }) => id)).toEqual([...ids]);
      }
      const chineseMatch = await storeWithScope.searchProjectMemories({
        project_uid: data.project_uid, query: "成都散步", top_k: 5, now,
      });
      expect(chineseMatch).toMatchObject({
        status: "completed",
        results: [
          { id: gamma.memory_uid, revision_uid: revisedGamma.status === "written" ? revisedGamma.revision_uid : undefined },
          { id: alpha.memory_uid, revision_uid: revisedAlpha.revision_uid },
        ],
      });
      await expect(storeWithScope.searchProjectMemories({
        project_uid: data.project_uid, query: "成都散步", top_k: 1, now,
      })).resolves.toMatchObject({
        status: "completed", results: [{ id: gamma.memory_uid }], count: 1,
      });
      const chineseMiss = await storeWithScope.searchProjectMemories({
        project_uid: data.project_uid, query: "火星编程", top_k: 5, now,
      });
      expect(chineseMiss).toMatchObject({ status: "completed", results: [], count: 0 });


      await expect(storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid,
        limit: 0,
        now,
      })).resolves.toEqual({ status: "completed", results: [], count: 0 });
      await expect(storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid,
        limit: 1,
        now,
      })).resolves.toMatchObject({ status: "completed", count: 1, results: [{ id: sameTimeIds[0] }] });
      await expect(storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid,
        limit: 5,
        now,
      })).resolves.toMatchObject({ status: "completed", count: 3 });
      for (const limit of [-1, 6, 1.5]) {
        await expect(storeWithScope.listRecentProjectMemories({
          project_uid: data.project_uid,
          limit,
          now,
        } as never)).resolves.toEqual({ status: "failed", code: "invalid_input", message: "Memory store input is invalid." });
      }
      await expect(storeWithScope.listRecentProjectMemories({
        project_uid: randomUUID(),
        limit: 5,
        now,
      })).resolves.toEqual({
        status: "failed",
        code: "identity_conflict",
        message: "Memory identity or provenance conflicts with Capture.",
      });
      await expect(storeWithScope.listRecentProjectMemories({
        project_uid: emptyProjectUid,
        limit: 5,
        now,
      })).resolves.toEqual({ status: "completed", results: [], count: 0 });
      await expect(storeWithScope.searchProjectMemories({
        project_uid: data.project_uid,
        query: "",
        top_k: 5,
        now,
      })).resolves.toEqual({ status: "completed", query: "", results: [], count: 0 });
      const pendingSave = await appendRecentMemoryUserText(data, "Restored save");
      const suspendUser = await appendRecentMemoryUserText(data, memoryOperationConfirmation({
        action: "suspend", memory_uid: beta.memory_uid, expected_revision_uid: beta.revision_uid,
      }));
      const suspendCall = await appendRecentMemoryOperation(data, beta.memory_uid, beta.revision_uid, "suspend");
      await expect(storeWithScope.applyMemoryOperation(memoryOperationInput(
        data, suspendUser, suspendCall, beta.memory_uid, beta.revision_uid, "suspend", "2026-09-24T01:00:00.000Z",
      ))).resolves.toMatchObject({ status: "written" });
      await expect(storeWithScope.createExactSpanModelMemoryRevision(
        exactSpanMemoryInput(data, pendingSave, "2026-09-24T01:01:00.000Z"),
      )).resolves.toMatchObject({ status: "failed", code: "confirmation_required" });
      const resumeUser = await appendRecentMemoryUserText(data, memoryOperationConfirmation({
        action: "resume", memory_uid: beta.memory_uid, expected_revision_uid: beta.revision_uid,
      }));
      const resumeCall = await appendRecentMemoryOperation(data, beta.memory_uid, beta.revision_uid, "resume");
      await expect(storeWithScope.applyMemoryOperation(memoryOperationInput(
        data, resumeUser, resumeCall, beta.memory_uid, beta.revision_uid, "resume", "2026-09-24T01:02:00.000Z",
      ))).resolves.toMatchObject({ status: "written" });
      const savedAfterResume = await storeWithScope.createExactSpanModelMemoryRevision(
        exactSpanMemoryInput(data, pendingSave, "2026-09-24T01:03:00.000Z"),
      );
      expect(savedAfterResume.status).toBe("written");
      if (savedAfterResume.status === "written") {
        await expect(storeWithScope.searchProjectMemories({
          project_uid: data.project_uid, query: "Restored", top_k: 5, now: "2026-09-24T01:04:00.000Z",
        })).resolves.toMatchObject({ status: "completed", results: [{ id: savedAfterResume.memory_uid }] });
      }
      if (revokedResult.status !== "written") throw new Error("Expected an operation decision to inspect.");
      const tampered = await directWrite((transaction) => transaction.run(
        `MATCH (d:MemoryDecision {decision_uid: $decision_uid})-[operationLink:EVIDENCED_BY]->(operation:RawEvent {event_uid: $operation_uid}),
               (d)-[userLink:EVIDENCED_BY]->(:RawEvent {event_uid: $user_uid})
         DELETE userLink
         CREATE (d)-[duplicate:EVIDENCED_BY]->(operation)
         SET duplicate = properties(operationLink)
         RETURN count(duplicate) AS count`,
        {
          decision_uid: revokedResult.decision_uid,
          operation_uid: revokeOperation.properties.event_uid,
          user_uid: revokeCommand.properties.event_uid,
        },
      ));
      expect(numberValue(tampered.records[0]?.get("count"))).toBe(1);
      await expect(storeWithScope.listRecentProjectMemories({
        project_uid: data.project_uid, limit: 5, now: "2026-09-24T01:04:00.000Z",
      })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    } finally {
      try {
        await storeWithScope.close(1500);
        if (seeded) {
          await directWrite((transaction) => transaction.run(
            "MATCH (n) WHERE n.project_uid IN $project_uids DETACH DELETE n",
            { project_uids: [data.project_uid, emptyProjectUid] },
          ));
        }
      } finally {
        recycleSyntheticScope(data.scope.directory);
      }
    }
  }, { timeout: 120_000 });

  test("rolls back tool saves when authorization is revoked", async () => {
    const data = recentMemoryFixture();
    const storeWithScope = new Neo4jMemoryStore({
      configPath: syntheticConfigPath(),
      projectOwnership: data.scope,
    });
    let seeded = false;
    try {
      seeded = true;
      await seedRecentMemoryFixture(data);
      expect((await storeWithScope.initialize()).status).toBe("connected");

      const toolCallId = randomUUID();
      const params = { narrative: "This save is revoked before creation." };
      const source: SourceEventFacts = {
        kind: "tool_call",
        source: { event_name: "tool_call", event_id: `tool-call:${toolCallId}`, session_id: data.session_source_id },
        tool_name: "anima_save",
        content_parts: [{
          schema_id: "anima.content-part/v1.0",
          type: "json",
          part_index: 0,
          value_json: canonicalize(params as never),
        }],
        fidelity: { completeness: "full", missing_fields: [] },
        native_payload: { type: "tool_call", toolCallId, toolName: "anima_save", input: params },
        extensions: { "anima.tool.source_call_id": toolCallId },
      };
      const toolCall = await appendRecentFixtureEvent(data, source);
      const decision_uid = uuidV5FromParts([
        "anima.tool-save-decision", "v1", data.scope.principal_uid, data.session_uid, toolCallId,
      ]);
      const saveInput = {
        project_uid: data.project_uid,
        session_uid: data.session_uid,
        event_uid: String(toolCall.properties.event_uid),
        tool_call_id: toolCallId,
        params,
        decision_uid,
        now: "2026-09-24T02:00:00.000Z",
      };
      let authorizationChecks = 0;
      await expect(storeWithScope.createToolSaveMemoryRevision({
        ...saveInput,
        authorize_before_write: async () => ++authorizationChecks < 3,
      })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
      await expect(storeWithScope.createToolSaveMemoryRevision({
        ...saveInput,
        authorize_before_write: async () => { throw new Error("authorization revoked"); },
      })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });

      const artifacts = await directRead((transaction) => transaction.run(
        `MATCH (n)
         WHERE n.project_uid = $project_uid AND
           (n:MemorySubject OR n:Memory OR n:MemoryRevision OR n:MemoryDecision)
         RETURN count(n) AS count`,
        { project_uid: data.project_uid },
      ));
      expect(numberValue(artifacts.records[0]?.get("count"))).toBe(0);
    } finally {
      try {
        await storeWithScope.close(1500);
        if (seeded) {
          await directWrite((transaction) => transaction.run(
            "MATCH (n) WHERE n.project_uid = $project_uid DETACH DELETE n",
            { project_uid: data.project_uid },
          ));
        }
      } finally {
        recycleSyntheticScope(data.scope.directory);
      }
    }
  }, { timeout: 30_000 });

  test("constraint initialization leaves Episode and ProjectStage counts unchanged", () => {
    if (semanticNodeBaseline === undefined || semanticNodeAfterInitialize === undefined) {
      throw new Error("Semantic-node initialization counts are not initialized.");
    }
    expect(semanticNodeAfterInitialize).toEqual(semanticNodeBaseline);
  });

  test("leaves an empty Capture Session artifact-free", async () => {
    const data = fixture();
    await seedCapture(data);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "up_to_date",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      through_ingest_sequence: -1,
    });
    await expect(countMemoryArtifacts(data)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });
    await expectNoSemanticNodes(data);
  }, { timeout: 30_000 });

  test("creates first, multi-event, and consecutive-boundary windows with deterministic graph provenance", async () => {
    const data = fixture([
      event("message"),
      event("tool_call"),
      event("boundary", "checkpoint"),
      event("boundary", "compact"),
      event("message"),
    ]);
    await seedCapture(data);
    const sourceBefore = await captureSnapshot(data);

    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "processed",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      from_ingest_sequence: 0,
      through_ingest_sequence: 4,
      events_assigned: 5,
      windows_created: 3,
      windows_updated: 0,
    });

    const graph = await memoryGraph(data);
    expect(graph.cursor).toMatchObject({
      cursor_uid: boundaryCursorUid(data.session_uid),
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      projector_version: "anima.boundary-projector/v1",
      last_ingest_sequence: 4,
      open_window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 4),
      open_window_start_sequence: 4,
    });
    expect(graph.windows).toEqual([
      {
        window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 0),
        project_uid: data.project_uid,
        session_uid: data.session_uid,
        start_ingest_sequence: 0,
        end_ingest_sequence: 2,
        projector_version: "anima.boundary-projector/v1",
        collection_state: "sealed",
        terminal_event_uid: data.events[2]?.event_uid,
        terminal_boundary_type: "checkpoint",
        decision_status: "pending",
      },
      {
        window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 3),
        project_uid: data.project_uid,
        session_uid: data.session_uid,
        start_ingest_sequence: 3,
        end_ingest_sequence: 3,
        projector_version: "anima.boundary-projector/v1",
        collection_state: "sealed",
        terminal_event_uid: data.events[3]?.event_uid,
        terminal_boundary_type: "compact",
        decision_status: "pending",
      },
      {
        window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 4),
        project_uid: data.project_uid,
        session_uid: data.session_uid,
        start_ingest_sequence: 4,
        end_ingest_sequence: 4,
        projector_version: "anima.boundary-projector/v1",
        collection_state: "open",
      },
    ]);
    expect(graph.assignments).toEqual(data.events.map((item, index) => ({
      event_uid: item.event_uid,
      window_uid: boundaryWindowUid(data.project_uid, data.session_uid, index < 3 ? 0 : index === 3 ? 3 : 4),
      projector_version: "anima.boundary-projector/v1",
    })));
    expect(graph.semantic_nodes).toBe(0);
    await expectCaptureUnchanged(data, sourceBefore);
  }, { timeout: 30_000 });

  test("extends an open window, seals it, opens the next one, and converges on replay", async () => {
    const data = fixture([event("message")]);
    await seedCapture(data);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "processed",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      from_ingest_sequence: 0,
      through_ingest_sequence: 0,
      events_assigned: 1,
      windows_created: 1,
      windows_updated: 0,
    });

    await appendCaptureEvents(data, [event("boundary", "checkpoint"), event("message")]);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "processed",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      from_ingest_sequence: 1,
      through_ingest_sequence: 2,
      events_assigned: 2,
      windows_created: 1,
      windows_updated: 1,
    });
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "up_to_date",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      through_ingest_sequence: 2,
    });

    const graph = await memoryGraph(data);
    expect(graph.windows).toEqual([
      expect.objectContaining({
        window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 0),
        start_ingest_sequence: 0,
        end_ingest_sequence: 1,
        collection_state: "sealed",
        terminal_event_uid: data.events[1]?.event_uid,
        terminal_boundary_type: "checkpoint",
        decision_status: "pending",
      }),
      expect.objectContaining({
        window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 2),
        start_ingest_sequence: 2,
        end_ingest_sequence: 2,
        collection_state: "open",
      }),
    ]);
    expect(graph.assignments).toHaveLength(3);
    expect(graph.assignments.map((item) => item.window_uid)).toEqual([
      boundaryWindowUid(data.project_uid, data.session_uid, 0),
      boundaryWindowUid(data.project_uid, data.session_uid, 0),
      boundaryWindowUid(data.project_uid, data.session_uid, 2),
    ]);
  }, { timeout: 30_000 });

  test("seals compact, shutdown, validation, checkpoint, and unknown boundaries as pending windows only", async () => {
    for (const boundary_type of ["compact", "shutdown", "checkpoint", "validation", "unknown"] as const) {
      const data = fixture([event("boundary", boundary_type)]);
      await seedCapture(data);
      await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toMatchObject({
        status: "processed",
        events_assigned: 1,
        windows_created: 1,
        windows_updated: 0,
      });
      const graph = await memoryGraph(data);
      expect(graph.windows).toEqual([expect.objectContaining({
        collection_state: "sealed",
        terminal_boundary_type: boundary_type,
        terminal_event_uid: data.events[0]?.event_uid,
        decision_status: "pending",
      })]);
      expect(graph.continuations).toEqual([]);
      await expectNoSemanticNodes(data);
    }
  }, { timeout: 30_000 });

  test("rejects gap, duplicate, and non-integer source sequences without creating memory artifacts", async () => {
    const gap = fixture([event("message"), event("message")]);
    gap.events[1]!.ingest_sequence = 2;
    await seedCapture(gap);
    const gapBefore = await captureSnapshot(gap);
    await expect(store.processSession({ project_uid: gap.project_uid, session_uid: gap.session_uid })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });
    await expect(countMemoryArtifacts(gap)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });
    await expectCaptureUnchanged(gap, gapBefore);

    const duplicate = fixture([event("message"), event("message")]);
    duplicate.events[1]!.ingest_sequence = 0;
    await seedCapture(duplicate);
    await expect(store.processSession({ project_uid: duplicate.project_uid, session_uid: duplicate.session_uid })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });
    await expect(countMemoryArtifacts(duplicate)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });

    const nonInteger = fixture([event("message")]);
    nonInteger.events[0]!.ingest_sequence = 0.5;
    await seedCapture(nonInteger);
    await expect(store.processSession({ project_uid: nonInteger.project_uid, session_uid: nonInteger.session_uid })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });
    await expect(countMemoryArtifacts(nonInteger)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });
  }, { timeout: 30_000 });

  test("limits projection to the captured Session high-water and processes later events on the next call", async () => {
    const data = fixture([event("message"), event("message")]);
    await seedCapture(data);
    await mutateCapture(
      `MATCH (s:Session {session_uid: $session_uid})
       SET s.next_ingest_sequence = $next_ingest_sequence`,
      { session_uid: data.session_uid, next_ingest_sequence: 1 },
    );

    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "processed",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      from_ingest_sequence: 0,
      through_ingest_sequence: 0,
      events_assigned: 1,
      windows_created: 1,
      windows_updated: 0,
    });
    await expect(memoryGraph(data)).resolves.toMatchObject({
      cursor: expect.objectContaining({ last_ingest_sequence: 0 }),
      assignments: [{
        event_uid: data.events[0]?.event_uid,
        window_uid: boundaryWindowUid(data.project_uid, data.session_uid, 0),
        projector_version: "anima.boundary-projector/v1",
      }],
    });
    await expect(countMemoryArtifacts(data)).resolves.toEqual({ cursors: 1, windows: 1, assignments: 1 });

    await mutateCapture(
      `MATCH (s:Session {session_uid: $session_uid})
       SET s.next_ingest_sequence = $next_ingest_sequence`,
      { session_uid: data.session_uid, next_ingest_sequence: 2 },
    );
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toEqual({
      status: "processed",
      project_uid: data.project_uid,
      session_uid: data.session_uid,
      from_ingest_sequence: 1,
      through_ingest_sequence: 1,
      events_assigned: 1,
      windows_created: 0,
      windows_updated: 1,
    });
    await expect(memoryGraph(data)).resolves.toMatchObject({
      cursor: expect.objectContaining({ last_ingest_sequence: 1 }),
      assignments: [
        expect.objectContaining({ event_uid: data.events[0]?.event_uid }),
        expect.objectContaining({ event_uid: data.events[1]?.event_uid }),
      ],
    });
    await expect(countMemoryArtifacts(data)).resolves.toEqual({ cursors: 1, windows: 1, assignments: 2 });
  }, { timeout: 30_000 });

  test("returns source_incomplete when HAS_SESSION is missing before conflicting Session ownership", async () => {
    const data = fixture([event("message")]);
    const wrong_project_uid = randomUUID();
    await directWrite(async (transaction) => {
      await transaction.run(
        "CREATE (p:Project) SET p += $properties",
        { properties: projectProperties(data) },
      );
      await transaction.run(
        "CREATE (s:Session) SET s += $properties",
        { properties: { ...sessionProperties(data), project_uid: wrong_project_uid } },
      );
      const item = data.events[0];
      if (item === undefined) throw new Error("missing-HAS_SESSION fixture did not create its event");
      await transaction.run(
        `CREATE (e:RawEvent:${STRUCTURAL_LABEL[item.kind]}) SET e += $properties`,
        { properties: eventProperties(data, item) },
      );
      await transaction.run(
        `MATCH (s:Session {session_uid: $session_uid}),
              (p:Project {project_uid: $project_uid}),
              (e:RawEvent {event_uid: $event_uid})
         CREATE (s)-[:HAS_EVENT]->(e)
         CREATE (e)-[:IN_PROJECT]->(p)`,
        {
          project_uid: data.project_uid,
          session_uid: data.session_uid,
          event_uid: item.event_uid,
        },
      );
    });
    const sourceBefore = await captureSnapshot(data);

    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toMatchObject({
      status: "failed",
      code: "source_incomplete",
    });
    await expect(countMemoryArtifacts(data)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });
    await expect(memoryGraph(data)).resolves.toMatchObject({ cursor: null, windows: [], assignments: [] });
    await expectCaptureUnchanged(data, sourceBefore);
  }, { timeout: 30_000 });

  test("returns source_incomplete for missing Capture relationships and rolls back the first cursor", async () => {
    const data = fixture([event("message")]);
    await seedCapture(data, false, true);
    const sourceBefore = await captureSnapshot(data);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });
    await expect(countMemoryArtifacts(data)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });
    await expectCaptureUnchanged(data, sourceBefore);
  }, { timeout: 30_000 });

  test("returns identity_conflict for Capture property/topology provenance corruption and preserves source properties", async () => {
    const data = fixture([event("message")]);
    await seedCapture(data);
    await mutateCapture(
      "MATCH (s:Session {session_uid: $session_uid}) SET s.project_uid = $wrong_project_uid",
      { session_uid: data.session_uid, wrong_project_uid: randomUUID() },
    );
    const sourceBefore = await captureSnapshot(data);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    await expect(countMemoryArtifacts(data)).resolves.toEqual({ cursors: 0, windows: 0, assignments: 0 });
    await expectCaptureUnchanged(data, sourceBefore);
  }, { timeout: 30_000 });
  test("rejects an assignment pointing at another window and rolls back the attempted extension", async () => {
    const data = fixture([event("message")]);
    await seedCapture(data);
    await store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid });
    await appendCaptureEvents(data, [event("message")]);
    const secondEvent = data.events[1];
    if (secondEvent === undefined) throw new Error("assignment-conflict fixture did not create its second event");
    const conflicting_window_uid = randomUUID();
    await mutateCapture(
      `MATCH (e:RawEvent {event_uid: $event_uid})
       CREATE (w:BoundaryWindow {
         window_uid: $window_uid,
         project_uid: $project_uid,
         session_uid: $session_uid,
         start_ingest_sequence: 99,
         end_ingest_sequence: 99,
         projector_version: "anima.boundary-projector/v1",
         collection_state: "open",
         fixture_run_id: $fixture_run_id
       })
       CREATE (e)-[:IN_BOUNDARY_WINDOW {projector_version: "anima.boundary-projector/v1"}]->(w)`,
      {
        event_uid: secondEvent.event_uid,
        window_uid: conflicting_window_uid,
        project_uid: data.project_uid,
        session_uid: data.session_uid,
        fixture_run_id: data.fixture_run_id,
      },
    );
    const before = await memoryGraph(data);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    await expect(memoryGraph(data)).resolves.toEqual(before);
  }, { timeout: 30_000 });


  test("converges two concurrent process calls without duplicate windows or assignments", async () => {
    const data = fixture([event("message"), event("boundary", "checkpoint"), event("message")]);
    await seedCapture(data);
    const results = await Promise.all([
      store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid }),
      store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid }),
    ]);
    expect(results.filter((result) => result.status === "processed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "up_to_date")).toHaveLength(1);
    const graph = await memoryGraph(data);
    expect(graph.windows).toHaveLength(2);
    expect(graph.assignments).toHaveLength(3);
    expect(new Set(graph.assignments.map((item) => item.event_uid)).size).toBe(3);
  }, { timeout: 30_000 });

  test("keeps Capture properties unchanged and leaves only pending shutdown evidence without continuation", async () => {
    const data = fixture([event("message"), event("boundary", "shutdown")]);
    await seedCapture(data);
    const sourceBefore = await captureSnapshot(data);
    await expect(store.processSession({ project_uid: data.project_uid, session_uid: data.session_uid })).resolves.toMatchObject({ status: "processed", events_assigned: 2 });
    const graph = await memoryGraph(data);
    expect(graph.windows).toEqual([expect.objectContaining({
      collection_state: "sealed",
      terminal_boundary_type: "shutdown",
      decision_status: "pending",
    })]);
    expect(graph.continuations).toEqual([]);
    await expectCaptureUnchanged(data, sourceBefore);
  }, { timeout: 30_000 });

  test("writes one explicit continuation and returns duplicate on exact replay", async () => {
    const data = await checkpointFixture();
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    const input = {
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    };
    const decision_uid = sessionContinuationDecisionUid(
      input.project_uid,
      input.session_uid,
      input.previous_session_uid,
      input.checkpoint_event_uid,
    );
    await expect(store.recordSessionContinuation(input)).resolves.toEqual({ status: "written", decision_uid });
    await expect(store.recordSessionContinuation(input)).resolves.toEqual({ status: "duplicate", decision_uid });
    const graph = await memoryGraph(data.current, data.previous.session_uid);
    expect(graph.continuations).toEqual([{
      decision_uid,
      previous_session_uid: data.previous.session_uid,
      evidence_event_uid: data.checkpoint.event_uid,
      project_uid: data.project_uid,
      schema_id: "anima.session-continuation/v1.0",
      method: "explicit_checkpoint",
    }]);
    expect(graph.semantic_nodes).toBe(0);
  }, { timeout: 30_000 });

  test("converges concurrent identical continuation requests to written plus duplicate", async () => {
    const data = await checkpointFixture();
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    const input = {
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    };
    const results = await Promise.all([
      store.recordSessionContinuation(input),
      store.recordSessionContinuation(input),
    ]);
    expect(results.filter((result) => result.status === "written")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(1);
    expect((await memoryGraph(data.current)).continuations).toHaveLength(1);
  }, { timeout: 30_000 });

  test("converges concurrent conflicting predecessor requests to written plus identity_conflict", async () => {
    const data = await checkpointFixture();
    const otherPrevious = fixture([event("message")]);
    otherPrevious.project_uid = data.project_uid;
    await seedCapture(otherPrevious, true);
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    const base = {
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    };
    const results = await Promise.all([
      store.recordSessionContinuation({ ...base, previous_session_uid: data.previous.session_uid }),
      store.recordSessionContinuation({ ...base, previous_session_uid: otherPrevious.session_uid }),
    ]);
    expect(results.filter((result) => result.status === "written")).toHaveLength(1);
    expect(results.filter((result) => result.status === "failed" && result.code === "identity_conflict")).toHaveLength(1);
    expect((await memoryGraph(data.current)).continuations).toHaveLength(1);
  }, { timeout: 30_000 });

  test("rejects checkpoint evidence assigned to multiple v1 windows", async () => {
    const data = await checkpointFixture();
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    await mutateCapture(
      `MATCH (e:RawEvent {event_uid: $event_uid})
       CREATE (w:BoundaryWindow {
         window_uid: $window_uid,
         project_uid: $project_uid,
         session_uid: $session_uid,
         start_ingest_sequence: $ingest_sequence,
         end_ingest_sequence: $ingest_sequence,
         projector_version: $projector_version,
         collection_state: "open",
         fixture_run_id: $fixture_run_id
       })
       CREATE (e)-[:IN_BOUNDARY_WINDOW {projector_version: $projector_version}]->(w)`,
      {
        event_uid: data.checkpoint.event_uid,
        window_uid: randomUUID(),
        project_uid: data.project_uid,
        session_uid: data.current.session_uid,
        ingest_sequence: data.checkpoint.ingest_sequence,
        projector_version: "anima.boundary-projector/v1",
        fixture_run_id: data.current.fixture_run_id,
      },
    );
    await expect(store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
    expect((await memoryGraph(data.current)).continuations).toEqual([]);
  }, { timeout: 30_000 });

  test("rejects a continuation relation with extra properties", async () => {
    const data = await checkpointFixture();
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    const decision_uid = sessionContinuationDecisionUid(
      data.project_uid,
      data.current.session_uid,
      data.previous.session_uid,
      data.checkpoint.event_uid,
    );
    await mutateCapture(
      `MATCH (s:Session {session_uid: $session_uid}), (previous:Session {session_uid: $previous_session_uid})
       CREATE (s)-[:CONTINUES_FROM {
         decision_uid: $decision_uid,
         schema_id: "anima.session-continuation/v1.0",
         method: "explicit_checkpoint",
         evidence_event_uid: $checkpoint_event_uid,
         project_uid: $project_uid,
         unexpected: "corrupt"
       }]->(previous)`,
      {
        session_uid: data.current.session_uid,
        previous_session_uid: data.previous.session_uid,
        decision_uid,
        checkpoint_event_uid: data.checkpoint.event_uid,
        project_uid: data.project_uid,
      },
    );
    await expect(store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    })).resolves.toMatchObject({ status: "failed", code: "identity_conflict" });
  }, { timeout: 30_000 });

  test("applies source and evidence failure precedence before ownership conflicts", async () => {
    const data = await checkpointFixture();
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    const disconnected_event_uid = randomUUID();
    await mutateCapture(
      `CREATE (:RawEvent {
         event_uid: $event_uid,
         project_uid: $wrong_project_uid,
         session_uid: $wrong_session_uid,
         kind: "message",
         fixture_run_id: $fixture_run_id
       })`,
      {
        event_uid: disconnected_event_uid,
        wrong_project_uid: randomUUID(),
        wrong_session_uid: randomUUID(),
        fixture_run_id: data.current.fixture_run_id,
      },
    );
    await expect(store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: disconnected_event_uid,
    })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });

    await mutateCapture(
      `MATCH (e:RawEvent {event_uid: $event_uid})
       SET e.kind = "message",
           e.project_uid = $wrong_project_uid`,
      {
        event_uid: data.checkpoint.event_uid,
        wrong_project_uid: randomUUID(),
      },
    );
    await expect(store.recordSessionContinuation({
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    })).resolves.toMatchObject({ status: "failed", code: "evidence_invalid" });
  }, { timeout: 30_000 });


  test("rejects self-link, missing nodes, cross-project lineage, bad evidence, and unprojected checkpoint evidence", async () => {
    const data = await checkpointFixture();
    await store.processSession({ project_uid: data.current.project_uid, session_uid: data.current.session_uid });
    const base = {
      project_uid: data.project_uid,
      session_uid: data.current.session_uid,
      previous_session_uid: data.previous.session_uid,
      checkpoint_event_uid: data.checkpoint.event_uid,
    };
    await expect(store.recordSessionContinuation({ ...base, previous_session_uid: data.current.session_uid })).resolves.toMatchObject({ status: "failed", code: "invalid_input" });
    await expect(store.recordSessionContinuation({ ...base, previous_session_uid: randomUUID() })).resolves.toMatchObject({ status: "failed", code: "not_found" });

    const otherProject = fixture([event("message")]);
    await seedCapture(otherProject);
    await expect(store.recordSessionContinuation({ ...base, previous_session_uid: otherProject.session_uid })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });

    const nonCheckpoint = data.current.events[0];
    if (nonCheckpoint === undefined) throw new Error("current fixture did not create a non-checkpoint event");
    await expect(store.recordSessionContinuation({ ...base, checkpoint_event_uid: nonCheckpoint.event_uid })).resolves.toMatchObject({ status: "failed", code: "evidence_invalid" });
    await expect(store.recordSessionContinuation({ ...base, checkpoint_event_uid: randomUUID() })).resolves.toMatchObject({ status: "failed", code: "not_found" });

    const unprojected = await appendCaptureEvents(data.current, [event("boundary", "checkpoint")]);
    const unprojectedCheckpoint = unprojected[0];
    if (unprojectedCheckpoint === undefined) throw new Error("unprojected checkpoint fixture did not create evidence");
    await expect(store.recordSessionContinuation({ ...base, checkpoint_event_uid: unprojectedCheckpoint.event_uid })).resolves.toMatchObject({ status: "failed", code: "source_incomplete" });
  }, { timeout: 30_000 });
  test("creates no Episode or ProjectStage nodes", async () => {
    if (semanticNodeBaseline === undefined) throw new Error("Semantic-node baseline is not initialized.");
    await expect(semanticNodeCounts()).resolves.toEqual(semanticNodeBaseline);
  }, { timeout: 30_000 });
});
