import { canonicalize } from "json-canonicalize";
import { executionSourceFingerprint, executionUnitUid } from "./execution-ids.ts";
import {
  type ExecutionContainsLink,
  type ExecutionFinalizerLink,
  type ExecutionProjectorErrorCode,
  type ExecutionRole,
  type ExecutionSourceEvent,
  type ExecutionUnitPlan,
  type ExecutionUnitSnapshot,
  type ProjectExecutionUnitsInput,
  type ProjectExecutionUnitsPlan,
  type ExecutionTerminalReason,
} from "./execution-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const COMMON_SOURCE_KEYS = [
  "event_uid",
  "project_uid",
  "session_uid",
  "ingest_sequence",
  "fingerprint",
  "kind",
] as const;
const SOURCE_KIND_KEYS = {
  message: ["role", "message_origin"],
  tool_call: [],
  tool_result: ["outcome", "result_of_event_uid"],
  boundary: ["boundary_type"],
  turn_end: ["turn_index", "turn_end_status"],
} as const;
const SNAPSHOT_KEYS = [
  "execution_uid", "project_uid", "session_uid", "initiator_kind", "initiator_event_uid", "first_tool_call_event_uid",
  "start_ingest_sequence", "end_ingest_sequence", "event_count", "state", "source_fingerprint", "ordered_event_uids",
  "contains_roles", "initiated_by_event_uid", "finalized_by_event_uid", "terminal_reason", "terminal_event_uid",
] as const;

export class ExecutionProjectorError extends Error {
  readonly code: ExecutionProjectorErrorCode;
  constructor(code: ExecutionProjectorErrorCode, message: string) {
    super(message);
    this.name = "ExecutionProjectorError";
    this.code = code;
  }
}

function fail(code: ExecutionProjectorErrorCode, message: string): never {
  throw new ExecutionProjectorError(code, message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function equal(left: unknown, right: unknown): boolean {
  return canonicalize(left as never) === canonicalize(right as never);
}
function terminalReasonForBoundary(value: ExecutionSourceEvent & { kind: "boundary" }): ExecutionTerminalReason | undefined {
  if (value.boundary_type === "compact") return "session_compact";
  if (value.boundary_type === "shutdown") return "session_shutdown";
  return undefined;
}
function stateForTerminalReason(reason: ExecutionTerminalReason): ExecutionUnitSnapshot["state"] {
  if (reason === "final_reply") return "completed";
  if (reason === "user_cancelled") return "cancelled";
  return "interrupted";
}
function roleFor(index: number, firstCallIndex: number, terminal: boolean): ExecutionRole {
  if (terminal) return "terminal";
  if (index === 0) return "initiator";
  if (index === firstCallIndex) return "first_tool_call";
  return "member";
}

function validateSourceEvent(value: unknown, project_uid: string, session_uid: string, expectedSequence: number): ExecutionSourceEvent {
  if (!isRecord(value)) fail("invalid_input", "Execution source event contains unsupported fields.");
  const kind = value.kind;
  if (kind !== "message" && kind !== "tool_call" && kind !== "tool_result" && kind !== "boundary" && kind !== "turn_end") {
    fail("invalid_input", "Execution source event kind is invalid.");
  }
  if (!exactKeys(value, [...COMMON_SOURCE_KEYS, ...SOURCE_KIND_KEYS[kind]])) fail("invalid_input", "Execution source event contains unsupported fields.");
  if (!canonicalUuid(value.event_uid) || !canonicalUuid(value.project_uid) || !canonicalUuid(value.session_uid)) fail("invalid_input", "Execution source event identity is malformed.");
  if (value.project_uid !== project_uid || value.session_uid !== session_uid) fail("identity_conflict", "Execution source event ownership conflicts.");
  if (!safeInteger(value.ingest_sequence) || value.ingest_sequence < 0 || value.ingest_sequence !== expectedSequence) fail("source_incomplete", "Execution source ingest sequence is not contiguous.");
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) fail("invalid_input", "Execution source fingerprint is malformed.");
  if (kind === "message") {
    if (!["user", "assistant", "developer", "system", "unknown"].includes(String(value.role))) fail("invalid_input", "Execution message source fields are invalid.");
    if (!(value.message_origin === null || value.message_origin === "external_user" || value.message_origin === "runtime_synthetic")) fail("invalid_input", "Execution message origin is invalid.");
    if (value.message_origin !== null && value.role !== "user") fail("invalid_input", "Only user messages may carry an origin.");
    return value as unknown as ExecutionSourceEvent;
  }
  if (kind === "tool_call") return value as unknown as ExecutionSourceEvent;
  if (kind === "tool_result") {
    if (!["success", "error", "cancelled", "unknown"].includes(String(value.outcome))) fail("invalid_input", "Execution tool-result source fields are invalid.");
    if (value.result_of_event_uid !== null && !canonicalUuid(value.result_of_event_uid)) fail("invalid_input", "Execution result correlation identity is malformed.");
    return value as unknown as ExecutionSourceEvent;
  }
  if (kind === "turn_end") {
    const turnIndex = value.turn_index;
    const turnEndStatus = value.turn_end_status;
    if (typeof turnIndex !== "number" || !Number.isSafeInteger(turnIndex) || turnIndex < 0 || (turnEndStatus !== "nonterminal" && turnEndStatus !== "final_reply" && turnEndStatus !== "cancelled")) {
      fail("invalid_input", "Execution turn-end source fields are invalid.");
    }
  }
  if (kind === "boundary" && !["checkpoint", "compact", "shutdown", "validation", "unknown"].includes(String(value.boundary_type))) fail("invalid_input", "Execution boundary source fields are invalid.");
  return value as unknown as ExecutionSourceEvent;
}

function validateSnapshot(value: unknown, project_uid: string, session_uid: string): ExecutionUnitSnapshot {
  if (!isRecord(value) || !exactKeys(value, SNAPSHOT_KEYS)) fail("invalid_input", "Execution snapshot contains unsupported fields.");
  for (const key of ["execution_uid", "project_uid", "session_uid", "initiator_event_uid", "first_tool_call_event_uid", "initiated_by_event_uid"] as const) {
    if (!canonicalUuid(value[key])) fail("invalid_input", "Execution snapshot identity is malformed.");
  }
  if (value.project_uid !== project_uid || value.session_uid !== session_uid) fail("identity_conflict", "Execution snapshot ownership conflicts.");
  if (value.initiator_kind !== "user_request" || !safeInteger(value.start_ingest_sequence) || value.start_ingest_sequence < 0 || !safeInteger(value.end_ingest_sequence) || !safeInteger(value.event_count)) fail("invalid_input", "Execution snapshot range is invalid.");
  if (value.end_ingest_sequence < value.start_ingest_sequence || value.event_count < 2 || value.end_ingest_sequence - value.start_ingest_sequence + 1 !== value.event_count) fail("identity_conflict", "Execution snapshot range conflicts with its event topology.");
  if (typeof value.source_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.source_fingerprint)) fail("invalid_input", "Execution snapshot fingerprint is malformed.");
  if (!Array.isArray(value.ordered_event_uids) || !Array.isArray(value.contains_roles)) fail("invalid_input", "Execution snapshot event topology is invalid.");
  if (value.ordered_event_uids.length !== value.event_count || value.contains_roles.length !== value.event_count) fail("identity_conflict", "Execution snapshot event topology conflicts with its range.");
  const firstToolCallIndex = value.contains_roles.indexOf("first_tool_call");
  if (value.ordered_event_uids.some((item) => !canonicalUuid(item)) || value.contains_roles.some((item) => !["initiator", "first_tool_call", "member", "terminal"].includes(String(item)))) fail("invalid_input", "Execution snapshot event topology is invalid.");
  if (value.contains_roles[0] !== "initiator" || firstToolCallIndex < 1 || value.ordered_event_uids[firstToolCallIndex] !== value.first_tool_call_event_uid) fail("identity_conflict", "Execution snapshot event topology conflicts with its initiator.");
  if (value.finalized_by_event_uid !== null && !canonicalUuid(value.finalized_by_event_uid)) fail("invalid_input", "Execution snapshot terminal identity is malformed.");
  if (value.terminal_event_uid !== null && !canonicalUuid(value.terminal_event_uid)) fail("invalid_input", "Execution snapshot terminal identity is malformed.");
  const terminalState = value.state === "open" || value.state === "completed" || value.state === "cancelled" || value.state === "interrupted";
  if (!terminalState) fail("invalid_input", "Execution snapshot state is invalid.");
  if (value.state === "open") {
    if (value.finalized_by_event_uid !== null || value.terminal_reason !== null || value.terminal_event_uid !== null || value.contains_roles.includes("terminal")) fail("identity_conflict", "Open execution snapshot contains terminal fields.");
  } else {
    if (!value.finalized_by_event_uid || !value.terminal_event_uid || value.finalized_by_event_uid !== value.terminal_event_uid || !["final_reply", "user_cancelled", "session_compact", "session_shutdown"].includes(String(value.terminal_reason))) fail("identity_conflict", "Terminal execution snapshot fields are invalid.");
    if (value.contains_roles.at(-1) !== "terminal" || value.terminal_event_uid !== value.ordered_event_uids.at(-1)) fail("identity_conflict", "Terminal execution snapshot topology is invalid.");
    if (stateForTerminalReason(value.terminal_reason as ExecutionTerminalReason) !== value.state) fail("identity_conflict", "Execution state and terminal reason conflict.");
  }
  return value as unknown as ExecutionUnitSnapshot;
}

interface BuiltUnit {
  events: ExecutionSourceEvent[];
  terminalReason: ExecutionTerminalReason | null;
}

function buildUnits(events: readonly ExecutionSourceEvent[]): BuiltUnit[] {
  const units: BuiltUnit[] = [];
  let candidateUser: ExecutionSourceEvent | undefined;
  let candidateStartIndex: number | undefined;
  let active: BuiltUnit | undefined;
  let pending = new Set<string>();
  let calls = new Map<string, ExecutionSourceEvent>();
  for (const [index, event] of events.entries()) {
    if (active === undefined) {
      if (event.kind === "message" && event.role === "user" && event.message_origin === "external_user") {
        candidateUser = event;
        candidateStartIndex = index;
      } else if (event.kind === "turn_end" && (event.turn_end_status === "final_reply" || event.turn_end_status === "cancelled")) {
        candidateUser = undefined;
        candidateStartIndex = undefined;
      } else if (event.kind === "boundary" && (event.boundary_type === "compact" || event.boundary_type === "shutdown")) {
        candidateUser = undefined;
        candidateStartIndex = undefined;
      } else if (event.kind === "tool_call" && candidateUser !== undefined && candidateStartIndex !== undefined) {
        const backfill = events.slice(candidateStartIndex, index + 1);
        active = { events: [...backfill], terminalReason: null };
        pending = new Set(backfill.filter((item): item is ExecutionSourceEvent & { kind: "tool_call" } => item.kind === "tool_call").map((item) => item.event_uid));
        calls = new Map(backfill.filter((item): item is ExecutionSourceEvent & { kind: "tool_call" } => item.kind === "tool_call").map((item) => [item.event_uid, item]));
        candidateUser = undefined;
        candidateStartIndex = undefined;
      }
      continue;
    }

    active.events.push(event);
    if (event.kind === "tool_call") {
      pending.add(event.event_uid);
      calls.set(event.event_uid, event);
    } else if (event.kind === "tool_result" && event.result_of_event_uid !== null) {
      const target = calls.get(event.result_of_event_uid);
      if (target !== undefined) {
        if (pending.has(target.event_uid)) pending.delete(target.event_uid);
        else fail("identity_conflict", "Execution result correlation settles a tool call more than once.");
      } else {
        const known = events.find((item) => item.event_uid === event.result_of_event_uid);
        if (known?.kind === "tool_call") fail("identity_conflict", "Execution result correlation targets a call outside the open unit.");
      }
    }
    let terminalReason: ExecutionTerminalReason | undefined;
    if (event.kind === "turn_end") {
      if (event.turn_end_status === "cancelled") terminalReason = "user_cancelled";
      else if (event.turn_end_status === "final_reply" && pending.size === 0) terminalReason = "final_reply";
    } else if (event.kind === "boundary") {
      terminalReason = terminalReasonForBoundary(event);
    }
    if (terminalReason !== undefined) {
      active.terminalReason = terminalReason;
      units.push(active);
      active = undefined;
      pending = new Set();
      calls = new Map();
    }
  }
  if (active !== undefined) units.push(active);
  return units;
}

function snapshotFor(project_uid: string, session_uid: string, unit: BuiltUnit): ExecutionUnitSnapshot {
  const first = unit.events[0]!;
  const firstCallIndex = unit.events.findIndex((event) => event.kind === "tool_call");
  const firstCall = unit.events[firstCallIndex]!;
  const execution_uid = executionUnitUid(project_uid, session_uid, first.event_uid, firstCall.event_uid);
  const terminal = unit.terminalReason !== null;
  const finalEvent = terminal ? unit.events.at(-1)! : null;
  const contains_roles = unit.events.map((_, index) => roleFor(index, firstCallIndex, terminal && index === unit.events.length - 1));
  return {
    execution_uid,
    project_uid,
    session_uid,
    initiator_kind: "user_request",
    initiator_event_uid: first.event_uid,
    first_tool_call_event_uid: firstCall.event_uid,
    start_ingest_sequence: first.ingest_sequence,
    end_ingest_sequence: unit.events.at(-1)!.ingest_sequence,
    event_count: unit.events.length,
    state: terminal ? stateForTerminalReason(unit.terminalReason!) : "open",
    source_fingerprint: executionSourceFingerprint(project_uid, session_uid, unit.events),
    ordered_event_uids: unit.events.map((event) => event.event_uid),
    contains_roles,
    initiated_by_event_uid: first.event_uid,
    finalized_by_event_uid: finalEvent?.event_uid ?? null,
    terminal_reason: unit.terminalReason,
    terminal_event_uid: finalEvent?.event_uid ?? null,
  };
}

function containsLinks(snapshot: ExecutionUnitSnapshot, from: number): ExecutionContainsLink[] {
  return snapshot.ordered_event_uids.slice(from).map((event_uid, offset) => ({
    execution_uid: snapshot.execution_uid,
    event_uid,
    position: from + offset,
    role: snapshot.contains_roles[from + offset]!,
  }));
}
function finalizerLink(snapshot: ExecutionUnitSnapshot): ExecutionFinalizerLink | null {
  if (snapshot.finalized_by_event_uid === null || snapshot.terminal_reason === null) return null;
  return { execution_uid: snapshot.execution_uid, event_uid: snapshot.finalized_by_event_uid, terminal_reason: snapshot.terminal_reason };
}

export function projectExecutionUnits(input: ProjectExecutionUnitsInput): ProjectExecutionUnitsPlan {
  if (!isRecord(input) || !exactKeys(input, ["project_uid", "session_uid", "events", "existing_execution_units"])) fail("invalid_input", "Execution projector input contains unsupported fields.");
  if (!canonicalUuid(input.project_uid) || !canonicalUuid(input.session_uid)) fail("invalid_input", "Execution projector ownership is malformed.");
  if (!Array.isArray(input.events) || !Array.isArray(input.existing_execution_units)) fail("invalid_input", "Execution projector collections are invalid.");
  const events = input.events.map((event, index) => validateSourceEvent(event, input.project_uid, input.session_uid, index));
  const existing = input.existing_execution_units.map((snapshot) => validateSnapshot(snapshot, input.project_uid, input.session_uid));
  const existingByUid = new Map<string, ExecutionUnitSnapshot>();
  for (const snapshot of existing) {
    if (existingByUid.has(snapshot.execution_uid)) fail("identity_conflict", "Execution snapshot identity is duplicated.");
    existingByUid.set(snapshot.execution_uid, snapshot);
  }
  for (const before of existing) {
    const sourceSlice = events.slice(before.start_ingest_sequence, before.end_ingest_sequence + 1);
    const firstCall = sourceSlice.find((event) => event.kind === "tool_call");
    if (
      sourceSlice.length !== before.event_count ||
      sourceSlice.some((event, index) => event.event_uid !== before.ordered_event_uids[index]) ||
      before.initiated_by_event_uid !== sourceSlice[0]?.event_uid ||
      firstCall === undefined ||
      before.first_tool_call_event_uid !== firstCall.event_uid ||
      before.execution_uid !== executionUnitUid(input.project_uid, input.session_uid, sourceSlice[0]!.event_uid, firstCall.event_uid) ||
      before.source_fingerprint !== executionSourceFingerprint(input.project_uid, input.session_uid, sourceSlice)
    ) fail("identity_conflict", "Existing ExecutionUnit conflicts with deterministic source topology.");
  }
  const built = buildUnits(events);
  const derived = built.map((unit) => snapshotFor(input.project_uid, input.session_uid, unit)).sort((left, right) => left.start_ingest_sequence - right.start_ingest_sequence || left.execution_uid.localeCompare(right.execution_uid));
  const plans: ExecutionUnitPlan[] = [];
  const matched = new Set<string>();
  for (const after of derived) {
    const before = existingByUid.get(after.execution_uid);
    if (before === undefined) {
      plans.push({
        node_action: "create",
        after,
        owner_link: { session_uid: after.session_uid, execution_uid: after.execution_uid },
        initiator_link: { execution_uid: after.execution_uid, event_uid: after.initiator_event_uid },
        contains_links: containsLinks(after, 0),
        finalizer_link: finalizerLink(after),
      });
      continue;
    }
    matched.add(after.execution_uid);
    if (before.state === "completed" || before.state === "cancelled" || before.state === "interrupted") {
      if (!equal(before, after)) fail("identity_conflict", "Terminal ExecutionUnit cannot be extended or changed.");
      plans.push({ node_action: "verify", before, after, owner_link: null, initiator_link: null, contains_links: [], finalizer_link: null });
      continue;
    }
    const prefix = before.ordered_event_uids.every((event_uid, index) => after.ordered_event_uids[index] === event_uid);
    if (!prefix || before.event_count > after.event_count || before.end_ingest_sequence >= after.end_ingest_sequence && !equal(before, after)) fail("identity_conflict", "ExecutionUnit source topology overlaps or rewrites existing history.");
    if (equal(before, after)) {
      plans.push({ node_action: "verify", before, after, owner_link: null, initiator_link: null, contains_links: [], finalizer_link: null });
    } else {
      plans.push({ node_action: "update", before, after, owner_link: null, initiator_link: null, contains_links: containsLinks(after, before.event_count), finalizer_link: finalizerLink(after) });
    }
  }
  for (const snapshot of existing) {
    if (!matched.has(snapshot.execution_uid) && !derived.some((item) => item.execution_uid === snapshot.execution_uid)) fail("identity_conflict", "Existing ExecutionUnit is absent from source replay.");
  }
  return {
    through_ingest_sequence: events.at(-1)?.ingest_sequence ?? -1,
    unit_plans: plans,
    execution_units_created: plans.filter((plan) => plan.node_action === "create").length,
    execution_units_updated: plans.filter((plan) => plan.node_action === "update").length,
    event_links_created: plans.reduce((count, plan) => count + plan.contains_links.length, 0),
  };
}
