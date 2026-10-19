import neo4j from "neo4j-driver";
import type * as Neo4j from "neo4j-driver";
import { canonicalize } from "json-canonicalize";
import { eventFingerprint } from "./event-fingerprint.ts";
import { CanonicalBuilder, CanonicalBuilderError } from "./canonical-builder.ts";
import type {
  CanonicalCorrelation,
  CanonicalRawEvent,
  CanonicalRawEventDraft,
  ResolvedSessionContext,
  SourceCorrelation,
} from "./canonical-types.ts";

export interface RawEventStore {
  executeWrite<T>(work: (transaction: Neo4j.ManagedTransaction) => Promise<T>): Promise<T>;
  isWriteCancelled?(): boolean;
}

export type AppendResult =
  | { status: "written"; event_uid: string; ingest_sequence: number }
  | { status: "duplicate"; event_uid: string; ingest_sequence: number }
  | { status: "indeterminate"; event_uid: string; message: string }
  | {
      status: "failed";
      code:
        | "invalid_source_facts"
        | "queue_full"
        | "core_degraded"
        | "core_closed"
        | "identity_conflict"
        | "correlation_target_missing"
        | "database_error";
      message: string;
    };

type NodeProperties = Record<string, unknown>;
type Transaction = Neo4j.ManagedTransaction;

class WriterAbort extends Error {
  constructor(readonly result: AppendResult) {
    super("raw-event write aborted");
  }
}

const STRUCTURAL_LABELS: Record<CanonicalRawEvent["kind"], string> = {
  message: "Message",
  tool_call: "ToolCall",
  tool_result: "ToolResult",
  boundary: "BoundarySignal",
  turn_end: "TurnEnd",
};

function failed(code: Extract<AppendResult, { status: "failed" }>["code"], message: string): AppendResult {
  return { status: "failed", code, message };
}

function propertyValue(properties: NodeProperties, key: string): unknown {
  return properties[key];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (neo4j.isInt(value)) return value.toNumber();
  return undefined;
}

function sameProperties(actual: NodeProperties, expected: NodeProperties, keys: readonly string[]): boolean {
  return keys.every((key) => propertyValue(actual, key) === propertyValue(expected, key));
}

function nodeProperties(value: unknown): NodeProperties {
  if (value !== null && typeof value === "object" && "properties" in value) {
    const properties = (value as { properties?: unknown }).properties;
    if (properties !== null && typeof properties === "object") return properties as NodeProperties;
  }
  return {};
}
function optionalProperties(event: CanonicalRawEvent): NodeProperties {
  const properties: NodeProperties = {};
  if (event.source_sequence !== undefined) properties.source_sequence = event.source_sequence;
  if (event.source_timestamp !== undefined) properties.source_timestamp = event.source_timestamp;
  if (event.role !== undefined) properties.role = event.role;
  if (event.tool_name !== undefined) properties.tool_name = event.tool_name;
  if (event.outcome !== undefined) properties.outcome = event.outcome;
  if (event.boundary_type !== undefined) properties.boundary_type = event.boundary_type;
  if (event.message_origin !== undefined) properties.message_origin = event.message_origin;
  if (event.turn_index !== undefined) properties.turn_index = event.turn_index;
  if (event.turn_end_status !== undefined) properties.turn_end_status = event.turn_end_status;
  return properties;
}

function eventProperties(event: CanonicalRawEvent, fingerprint: string): NodeProperties {
  const properties: NodeProperties = {
    event_uid: event.event_uid,
    schema_id: event.schema_id,
    event_identity_method: event.event_identity_method,
    session_uid: event.session_uid,
    session_identity_method: event.session_identity_method,
    project_uid: event.project_uid,
    project_identity_method: event.project_identity_method,
    kind: event.kind,
    runtime_identity_json: canonicalize(event.runtime_identity),
    capture_capabilities_json: canonicalize(event.capture_capabilities),
    source_json: canonicalize(event.source),
    ingest_sequence: event.ingest_sequence,
    captured_at: event.captured_at,
    content_parts_json: canonicalize(event.content_parts),
    fidelity_json: canonicalize(event.fidelity),
    native_payload_json: event.native_payload_json,
    fingerprint,
    ...optionalProperties(event),
  };
  if (event.correlation !== undefined) properties.correlation_json = canonicalize(event.correlation);
  if (event.extensions !== undefined) properties.extensions_json = canonicalize(event.extensions);
  if (event.kind === "tool_call") {
    const sourceCallId = event.extensions?.["anima.tool.source_call_id"];
    if (typeof sourceCallId === "string") properties["anima.tool.source_call_id"] = sourceCallId;
  }
  return properties;
}

function correlationResult(correlation: CanonicalCorrelation | undefined): {
  correlation?: CanonicalCorrelation;
  targetEventUid?: string;
  sourceToolCallId?: string;
} {
  if (correlation === undefined) return {};
  return {
    correlation,
    targetEventUid: correlation.method === "missing" ? undefined : correlation.target_event_uid,
    sourceToolCallId: correlation.method === "missing" ? undefined : correlation.source_tool_call_id,
  };
}

interface ResolvedCorrelation {
  correlation?: CanonicalCorrelation;
  targetEventUid?: string;
  sourceToolCallId?: string;
}
export class RawEventWriter {
  constructor(private readonly store: RawEventStore, private readonly builder: CanonicalBuilder) {}

  append(draft: CanonicalRawEventDraft, context: ResolvedSessionContext): Promise<AppendResult> {
    return this.write(draft, context);
  }

  async write(draft: CanonicalRawEventDraft, context: ResolvedSessionContext): Promise<AppendResult> {
    if (
      draft.session_uid !== context.session_uid ||
      draft.project_uid !== context.project_uid ||
      draft.session_identity_method !== context.session.method ||
      draft.project_identity_method !== context.project.method
    ) {
      return failed("identity_conflict", "event provenance does not match the session context.");
    }
    if (this.store.isWriteCancelled?.()) return failed("database_error", "capture write was cancelled.");

    let eventCreateBoundary = false;
    try {
      const result = await this.store.executeWrite((transaction) => this.writeInTransaction(
        transaction,
        draft,
        context,
        () => {
          eventCreateBoundary = true;
        },
      ));
      if (this.store.isWriteCancelled?.() && result.status === "written") {
        return {
          status: "indeterminate",
          event_uid: draft.event_uid,
          message: "Neo4j write outcome is unknown after cancellation.",
        };
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof WriterAbort) return error.result;
      if (error instanceof CanonicalBuilderError && error.code === "invalid_source_facts") {
        return failed("invalid_source_facts", "source facts could not be written.");
      }
      if (eventCreateBoundary) {
        return {
          status: "indeterminate",
          event_uid: draft.event_uid,
          message: "Neo4j write outcome is unknown.",
        };
      }
      return failed("database_error", "Neo4j write failed before the event write boundary.");
    }
  }

  private async writeInTransaction(
    transaction: Transaction,
    draft: CanonicalRawEventDraft,
    context: ResolvedSessionContext,
    markEventCreateBoundary: () => void,
  ): Promise<AppendResult> {
    const projectProperties: NodeProperties = {
      project_uid: context.project_uid,
      identity_fingerprint: context.project.fingerprint,
      created_at: draft.captured_at,
    };
    const projectResult = await transaction.run(
      `MERGE (p:Project {project_uid: $project_uid})
       ON CREATE SET p += $properties
       RETURN p`,
      { project_uid: context.project_uid, properties: projectProperties },
    );
    const project = nodeProperties(projectResult.records[0]?.get("p"));
    if (project.identity_fingerprint !== context.project.fingerprint) {
      throw new WriterAbort(failed("identity_conflict", "project identity conflicts with the existing project."));
    }

    const sessionProperties: NodeProperties = {
      session_uid: context.session_uid,
      session_identity_method: context.session.method,
      identity_fingerprint: context.session.fingerprint,
      project_uid: context.project_uid,
      project_identity_method: context.project.method,
      profile_uid: context.profile_uid,
      profile_identity_method: context.profile.method,
      profile_identity_fingerprint: context.profile.fingerprint,
      runtime_family: context.facts.runtime.family,
      next_ingest_sequence: 0,
      created_at: draft.captured_at,
    };
    if (context.facts.session.method === "source") sessionProperties.source_session_id = context.facts.session.source_id;

    const sessionResult = await transaction.run(
      `MERGE (s:Session {session_uid: $session_uid})
       ON CREATE SET s += $properties
       RETURN s`,
      { session_uid: context.session_uid, properties: sessionProperties },
    );
    const session = nodeProperties(sessionResult.records[0]?.get("s"));
    const sessionKeys = [
      "session_identity_method",
      "identity_fingerprint",
      "project_uid",
      "project_identity_method",
      "profile_uid",
      "profile_identity_method",
      "profile_identity_fingerprint",
      "runtime_family",
      "source_session_id",
    ];
    if (!sameProperties(session, sessionProperties, sessionKeys)) {
      throw new WriterAbort(failed("identity_conflict", "session provenance conflicts with the existing session."));
    }

    // SET acquires the Session write lock; the following read is intentionally
    // separate so duplicate and sequence decisions observe the locked row.
    await transaction.run(
      `MATCH (s:Session {session_uid: $session_uid})
       SET s._anima_session_lock = true
       REMOVE s._anima_session_lock`,
      { session_uid: context.session_uid },
    );

    const resolvedCorrelation = await this.resolveCorrelation(transaction, draft.correlation, context.session_uid);
    const resolvedDraft: CanonicalRawEventDraft =
      resolvedCorrelation.correlation === undefined
        ? { ...draft }
        : { ...draft, correlation: resolvedCorrelation.correlation };
    const fingerprint = eventFingerprint(resolvedDraft as unknown as CanonicalRawEvent);

    const existingResult = await transaction.run(
      `MATCH (e:RawEvent {event_uid: $event_uid})
       RETURN e`,
      { event_uid: draft.event_uid },
    );
    if (existingResult.records.length > 0) {
      const existing = nodeProperties(existingResult.records[0].get("e"));
      const existingSequence = numberValue(existing.ingest_sequence);
      if (existing.fingerprint === fingerprint && existingSequence !== undefined) {
        throw new WriterAbort({ status: "duplicate", event_uid: draft.event_uid, ingest_sequence: existingSequence });
      }
      throw new WriterAbort(failed("identity_conflict", "event identity conflicts with the existing event."));
    }

    if (draft.kind === "tool_call") await this.checkToolCallAnchor(transaction, draft, context.session_uid);

    const sequenceResult = await transaction.run(
      `MATCH (s:Session {session_uid: $session_uid})
       SET s.next_ingest_sequence = s.next_ingest_sequence + 1
       RETURN s.next_ingest_sequence - 1 AS ingest_sequence`,
      { session_uid: context.session_uid },
    );
    const ingestSequence = numberValue(sequenceResult.records[0]?.get("ingest_sequence"));
    if (ingestSequence === undefined) throw new Error("Neo4j returned an invalid ingest sequence.");

    let event: CanonicalRawEvent;
    try {
      event = this.builder.finalize(resolvedDraft, ingestSequence);
    } catch (error: unknown) {
      if (error instanceof CanonicalBuilderError && error.code === "invalid_source_facts") {
        throw new WriterAbort(failed("invalid_source_facts", "source facts could not be written."));
      }
      throw new WriterAbort(failed("database_error", "canonical event validation failed."));
    }

    const properties = eventProperties(event, fingerprint);
    const label = STRUCTURAL_LABELS[event.kind];
    if (this.store.isWriteCancelled?.()) {
      throw new WriterAbort(failed("database_error", "capture write was cancelled."));
    }
    markEventCreateBoundary();
    await transaction.run(
      `CREATE (e:RawEvent:${label}) SET e += $properties RETURN e`,
      { properties },
    );
    if (this.store.isWriteCancelled?.()) {
      throw new WriterAbort({
        status: "indeterminate",
        event_uid: event.event_uid,
        message: "Neo4j write outcome is unknown after cancellation.",
      });
    }
    await transaction.run(
      `MATCH (p:Project {project_uid: $project_uid}), (s:Session {session_uid: $session_uid}), (e:RawEvent {event_uid: $event_uid})
       MERGE (p)-[:HAS_SESSION]->(s)
       MERGE (s)-[:HAS_EVENT]->(e)
       MERGE (e)-[:IN_PROJECT]->(p)`,
      { project_uid: context.project_uid, session_uid: context.session_uid, event_uid: event.event_uid },
    );
    if (resolvedCorrelation.targetEventUid !== undefined) {
      await transaction.run(
        `MATCH (e:RawEvent {event_uid: $event_uid}), (target:RawEvent {event_uid: $target_event_uid})
         MERGE (e)-[:RESULT_OF]->(target)`,
        { event_uid: event.event_uid, target_event_uid: resolvedCorrelation.targetEventUid },
      );
    }
    return { status: "written", event_uid: event.event_uid, ingest_sequence: ingestSequence };
  }

  private async resolveCorrelation(
    transaction: Transaction,
    sourceCorrelation: SourceCorrelation | undefined,
    sessionUid: string,
  ): Promise<ResolvedCorrelation> {
    if (sourceCorrelation === undefined) return {};
    if (sourceCorrelation.method === "missing") {
      return correlationResult({ method: "missing", reason: sourceCorrelation.reason });
    }

    const targetUid = sourceCorrelation.method === "derived" ? sourceCorrelation.target_event_uid : undefined;
    const anchor = sourceCorrelation.source_tool_call_id;
    const targetResult = targetUid === undefined
      ? await transaction.run(
          `MATCH (target:RawEvent {session_uid: $session_uid})
           WHERE target.kind = 'tool_call' AND target.\`anima.tool.source_call_id\` = $source_tool_call_id
           RETURN target.event_uid AS event_uid, target.session_uid AS session_uid, target.kind AS kind,
                  target.\`anima.tool.source_call_id\` AS source_tool_call_id`,
          { session_uid: sessionUid, source_tool_call_id: anchor },
        )
      : await transaction.run(
          `MATCH (target:RawEvent {event_uid: $target_event_uid})
           RETURN target.event_uid AS event_uid, target.session_uid AS session_uid, target.kind AS kind,
                  target.\`anima.tool.source_call_id\` AS source_tool_call_id`,
          { target_event_uid: targetUid },
        );
    const target = targetResult.records[0];
    if (target === undefined) {
      throw new WriterAbort(failed("correlation_target_missing", "correlation target is unavailable."));
    }
    const targetSession = target.get("session_uid");
    const targetKind = target.get("kind");
    const resolvedTarget = target.get("event_uid");
    if (typeof resolvedTarget !== "string") {
      throw new WriterAbort(failed("correlation_target_missing", "correlation target is invalid."));
    }
    if (targetUid !== undefined && (targetSession !== sessionUid || targetKind !== "tool_call")) {
      throw new WriterAbort(
        failed(targetSession !== undefined && targetSession !== sessionUid ? "identity_conflict" : "correlation_target_missing", "correlation target is invalid."),
      );
    }
    if (targetUid !== undefined && anchor !== undefined && target.get("source_tool_call_id") !== undefined && target.get("source_tool_call_id") !== anchor) {
      throw new WriterAbort(failed("identity_conflict", "correlation target identity conflicts."));
    }
    if (sourceCorrelation.method === "source") {
      if (typeof anchor !== "string") throw new WriterAbort(failed("correlation_target_missing", "correlation target is invalid."));
      return correlationResult({ method: "source", target_event_uid: resolvedTarget, source_tool_call_id: anchor });
    }
    return correlationResult({
      method: "derived",
      target_event_uid: resolvedTarget,
      ...(sourceCorrelation.source_tool_call_id === undefined ? {} : { source_tool_call_id: sourceCorrelation.source_tool_call_id }),
      reason: sourceCorrelation.reason,
    });
  }

  private async checkToolCallAnchor(transaction: Transaction, draft: CanonicalRawEventDraft, sessionUid: string): Promise<void> {
    const sourceCallId = draft.extensions?.["anima.tool.source_call_id"];
    if (typeof sourceCallId !== "string") return;
    const result = await transaction.run(
      `MATCH (e:RawEvent {session_uid: $session_uid})
       WHERE e.kind = 'tool_call' AND e.\`anima.tool.source_call_id\` = $source_call_id
       RETURN e.event_uid AS event_uid`,
      { session_uid: sessionUid, source_call_id: sourceCallId },
    );
    const existingEventUid = result.records[0]?.get("event_uid");
    if (existingEventUid !== undefined && existingEventUid !== draft.event_uid) {
      throw new WriterAbort(failed("identity_conflict", "tool-call source identity conflicts with the existing event."));
    }
  }
}

export async function writeRawEvent(
  store: RawEventStore,
  builder: CanonicalBuilder,
  draft: CanonicalRawEventDraft,
  context: ResolvedSessionContext,
): Promise<AppendResult> {
  return new RawEventWriter(store, builder).write(draft, context);
}
