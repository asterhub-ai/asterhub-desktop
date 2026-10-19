import { boundaryWindowUid } from "./ids.ts";
import { BOUNDARY_PROJECTOR_VERSION } from "./version.ts";

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const BOUNDARY_TYPES = ["checkpoint", "compact", "shutdown", "validation", "unknown"] as const;
export type BoundaryType = (typeof BOUNDARY_TYPES)[number];

export type BoundaryProjectorCursorState =
  | { last_ingest_sequence: number; open_window_uid?: never; open_window_start_sequence?: never }
  | {
      last_ingest_sequence: number;
      open_window_uid: string;
      open_window_start_sequence: number;
    };

export type BoundaryProjectorEvent =
  | {
      event_uid: string;
      project_uid: string;
      session_uid: string;
      ingest_sequence: number;
      kind: "boundary";
      boundary_type: BoundaryType;
    }
  | {
      event_uid: string;
      project_uid: string;
      session_uid: string;
      ingest_sequence: number;
      kind: "message" | "tool_call" | "tool_result" | "turn_end";
      boundary_type?: never;
    };

export interface BoundaryProjectorInput {
  cursor: BoundaryProjectorCursorState;
  project_uid: string;
  session_uid: string;
  events: readonly BoundaryProjectorEvent[];
}

interface WindowRangeState {
  start_ingest_sequence: number;
  end_ingest_sequence: number;
  collection_state: "open" | "sealed";
  terminal_event_uid?: string;
  terminal_boundary_type?: BoundaryType;
  decision_status?: "pending";
}

export type BoundaryWindowCreate =
  | {
      window_uid: string;
      project_uid: string;
      session_uid: string;
      start_ingest_sequence: number;
      end_ingest_sequence: number;
      projector_version: typeof BOUNDARY_PROJECTOR_VERSION;
      collection_state: "open";
    }
  | {
      window_uid: string;
      project_uid: string;
      session_uid: string;
      start_ingest_sequence: number;
      end_ingest_sequence: number;
      projector_version: typeof BOUNDARY_PROJECTOR_VERSION;
      collection_state: "sealed";
      terminal_event_uid: string;
      terminal_boundary_type: BoundaryType;
      decision_status: "pending";
    };

export type BoundaryWindowSnapshot = WindowRangeState;

export interface BoundaryWindowUpdate {
  window_uid: string;
  project_uid: string;
  session_uid: string;
  projector_version: typeof BOUNDARY_PROJECTOR_VERSION;
  before: BoundaryWindowSnapshot;
  after: BoundaryWindowSnapshot;
}

export interface BoundaryEventAssignment {
  event_uid: string;
  window_uid: string;
  projector_version: typeof BOUNDARY_PROJECTOR_VERSION;
}

export interface BoundaryProjectorPlan {
  window_creates: BoundaryWindowCreate[];
  open_window_update?: BoundaryWindowUpdate;
  event_assignments: BoundaryEventAssignment[];
  next_cursor_state: BoundaryProjectorCursorState;
  from_ingest_sequence: number;
  through_ingest_sequence: number;
  events_assigned: number;
  windows_created: number;
  windows_updated: number;
}

export type BoundaryProjectorErrorCode = "invalid_input" | "source_incomplete" | "identity_conflict";

export class BoundaryProjectorError extends Error {
  readonly code: BoundaryProjectorErrorCode;

  constructor(code: BoundaryProjectorErrorCode, message: string) {
    super(message);
    this.name = "BoundaryProjectorError";
    this.code = code;
  }
}

function fail(code: BoundaryProjectorErrorCode, message: string): never {
  throw new BoundaryProjectorError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundaryType(value: unknown): value is BoundaryType {
  return typeof value === "string" && (BOUNDARY_TYPES as readonly string[]).includes(value);
}
function isNonBoundaryKind(value: unknown): value is "message" | "tool_call" | "tool_result" | "turn_end" {
  return value === "message" || value === "tool_call" || value === "tool_result" || value === "turn_end";
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail("invalid_input", "Boundary projector input contains an unsupported field.");
  }
}


function validateCursor(
  cursor: unknown,
  project_uid: string,
  session_uid: string,
): BoundaryProjectorCursorState {
  if (!isRecord(cursor)) fail("invalid_input", "Invalid boundary projector cursor.");
  rejectUnknownKeys(cursor, ["last_ingest_sequence", "open_window_uid", "open_window_start_sequence"]);
  const last = cursor.last_ingest_sequence;
  if (!(typeof last === "number" && Number.isSafeInteger(last) && last >= -1)) {
    fail("invalid_input", "Invalid boundary projector cursor sequence.");
  }
  const hasUid = cursor.open_window_uid !== undefined;
  const hasStart = cursor.open_window_start_sequence !== undefined;
  if (hasUid !== hasStart) fail("invalid_input", "Incomplete boundary projector open-window state.");
  if (!hasUid) return { last_ingest_sequence: last };
  if (!isCanonicalUuid(cursor.open_window_uid)) {
    fail("invalid_input", "Invalid boundary projector open-window identity.");
  }
  if (!isSafeNonnegativeInteger(cursor.open_window_start_sequence)) {
    fail("invalid_input", "Invalid boundary projector open-window start.");
  }
  const start = cursor.open_window_start_sequence;
  if (last < 0 || start > last) fail("invalid_input", "Impossible boundary projector open-window range.");
  const expectedUid = boundaryWindowUid(project_uid, session_uid, start);
  if (cursor.open_window_uid !== expectedUid) fail("identity_conflict", "Boundary projector cursor identity conflict.");
  return {
    last_ingest_sequence: last,
    open_window_uid: cursor.open_window_uid,
    open_window_start_sequence: start,
  };
}

function validateEvent(value: unknown, project_uid: string, session_uid: string): BoundaryProjectorEvent {
  if (!isRecord(value)) fail("invalid_input", "Invalid boundary projector event.");
  const commonKeys = ["event_uid", "project_uid", "session_uid", "ingest_sequence", "kind"];
  const kind = value.kind;
  const kindKeys =
    kind === "message"
      ? ["role", "message_origin"]
      : kind === "tool_call"
        ? []
        : kind === "tool_result"
          ? ["outcome", "result_of_event_uid"]
          : kind === "turn_end"
            ? ["turn_index", "turn_end_status"]
            : kind === "boundary"
              ? ["boundary_type"]
              : [];
  rejectUnknownKeys(value, [...commonKeys, ...kindKeys]);
  if (!isCanonicalUuid(value.event_uid)) {
    fail("invalid_input", "Invalid boundary projector event identity.");
  }
  if (!isCanonicalUuid(value.project_uid) || !isCanonicalUuid(value.session_uid)) {
    fail("invalid_input", "Invalid boundary projector event ownership.");
  }
  if (value.project_uid !== project_uid || value.session_uid !== session_uid) {
    fail("identity_conflict", "Boundary projector event ownership conflict.");
  }
  if (!isSafeNonnegativeInteger(value.ingest_sequence)) {
    fail("source_incomplete", "Boundary projector source sequence is invalid.");
  }
  if (kind === "boundary") {
    if (!isBoundaryType(value.boundary_type)) fail("invalid_input", "Invalid canonical boundary type.");
    return {
      event_uid: value.event_uid,
      project_uid,
      session_uid,
      ingest_sequence: value.ingest_sequence,
      kind: "boundary",
      boundary_type: value.boundary_type,
    };
  }
  if (!isNonBoundaryKind(kind)) fail("invalid_input", "Invalid boundary projector event kind.");
  if (kind === "message") {
    if (value.role !== undefined && value.role !== "user" && value.role !== "assistant" && value.role !== "developer" && value.role !== "system" && value.role !== "unknown") {
      fail("invalid_input", "Invalid boundary projector message role.");
    }
    if (value.message_origin !== undefined && value.message_origin !== null && value.message_origin !== "external_user" && value.message_origin !== "runtime_synthetic") {
      fail("invalid_input", "Invalid boundary projector message origin.");
    }
  } else if (kind === "tool_result") {
    if (value.outcome !== undefined && value.outcome !== "success" && value.outcome !== "error" && value.outcome !== "cancelled" && value.outcome !== "unknown") {
      fail("invalid_input", "Invalid boundary projector tool-result outcome.");
    }
    if (value.result_of_event_uid !== undefined && value.result_of_event_uid !== null && !isCanonicalUuid(value.result_of_event_uid)) {
      fail("invalid_input", "Invalid boundary projector result correlation.");
    }
  } else if (kind === "turn_end") {
    if (value.turn_index !== undefined && !isSafeNonnegativeInteger(value.turn_index)) fail("invalid_input", "Invalid boundary projector turn index.");
    if (value.turn_end_status !== undefined && value.turn_end_status !== "nonterminal" && value.turn_end_status !== "final_reply") fail("invalid_input", "Invalid boundary projector turn-end status.");
    if ((value.turn_index === undefined) !== (value.turn_end_status === undefined)) fail("invalid_input", "Incomplete boundary projector turn-end fields.");
  }
  return {
    event_uid: value.event_uid,
    project_uid,
    session_uid,
    ingest_sequence: value.ingest_sequence,
    kind,
  };
}

function validateInput(value: unknown): {
  cursor: BoundaryProjectorCursorState;
  project_uid: string;
  session_uid: string;
  events: BoundaryProjectorEvent[];
} {
  if (!isRecord(value)) fail("invalid_input", "Invalid boundary projector input.");
  rejectUnknownKeys(value, ["cursor", "project_uid", "session_uid", "events"]);
  if (!isCanonicalUuid(value.project_uid)) {
    fail("invalid_input", "Invalid boundary projector project identity.");
  }
  if (!isCanonicalUuid(value.session_uid)) {
    fail("invalid_input", "Invalid boundary projector session identity.");
  }
  const cursor = validateCursor(value.cursor, value.project_uid, value.session_uid);
  if (!Array.isArray(value.events)) fail("invalid_input", "Invalid boundary projector event list.");
  const events: BoundaryProjectorEvent[] = [];
  for (const item of value.events) {
    events.push(validateEvent(item, value.project_uid, value.session_uid));
  }
  for (let index = 0; index < events.length; index += 1) {
    const expected = cursor.last_ingest_sequence + index + 1;
    if (events[index].ingest_sequence !== expected) {
      fail("source_incomplete", "Boundary projector source sequence is not contiguous.");
    }
  }
  const eventUids = new Set<string>();
  for (const current of events) {
    if (eventUids.has(current.event_uid)) fail("identity_conflict", "Duplicate boundary projector event identity.");
    eventUids.add(current.event_uid);
  }
  return { cursor, project_uid: value.project_uid, session_uid: value.session_uid, events };
}

function snapshot(window: WindowRangeState): BoundaryWindowSnapshot {
  if (window.collection_state === "open") {
    return {
      start_ingest_sequence: window.start_ingest_sequence,
      end_ingest_sequence: window.end_ingest_sequence,
      collection_state: "open",
    };
  }
  return {
    start_ingest_sequence: window.start_ingest_sequence,
    end_ingest_sequence: window.end_ingest_sequence,
    collection_state: "sealed",
    terminal_event_uid: window.terminal_event_uid,
    terminal_boundary_type: window.terminal_boundary_type,
    decision_status: "pending",
  };
}

function createWindow(
  window_uid: string,
  project_uid: string,
  session_uid: string,
  window: WindowRangeState,
): BoundaryWindowCreate {
  if (window.collection_state === "open") {
    return {
      window_uid,
      project_uid,
      session_uid,
      start_ingest_sequence: window.start_ingest_sequence,
      end_ingest_sequence: window.end_ingest_sequence,
      projector_version: BOUNDARY_PROJECTOR_VERSION,
      collection_state: "open",
    };
  }
  return {
    window_uid,
    project_uid,
    session_uid,
    start_ingest_sequence: window.start_ingest_sequence,
    end_ingest_sequence: window.end_ingest_sequence,
    projector_version: BOUNDARY_PROJECTOR_VERSION,
    collection_state: "sealed",
    terminal_event_uid: window.terminal_event_uid as string,
    terminal_boundary_type: window.terminal_boundary_type as BoundaryType,
    decision_status: "pending",
  };
}

export function projectBoundary(value: BoundaryProjectorInput): BoundaryProjectorPlan {
  const { cursor, project_uid, session_uid, events } = validateInput(value);
  const window_creates: BoundaryWindowCreate[] = [];
  const event_assignments: BoundaryEventAssignment[] = [];
  let open_window_update: BoundaryWindowUpdate | undefined;
  let existingWindow:
    | { uid: string; before: WindowRangeState; current: WindowRangeState }
    | undefined =
    cursor.open_window_uid === undefined
      ? undefined
      : {
          uid: cursor.open_window_uid,
          before: {
            start_ingest_sequence: cursor.open_window_start_sequence,
            end_ingest_sequence: cursor.last_ingest_sequence,
            collection_state: "open",
          },
          current: {
            start_ingest_sequence: cursor.open_window_start_sequence,
            end_ingest_sequence: cursor.last_ingest_sequence,
            collection_state: "open",
          },
        };
  let newWindow: { uid: string; current: WindowRangeState } | undefined;

  for (const currentEvent of events) {
    if (existingWindow !== undefined) {
      existingWindow.current.end_ingest_sequence = currentEvent.ingest_sequence;
    } else if (newWindow !== undefined) {
      newWindow.current.end_ingest_sequence = currentEvent.ingest_sequence;
    } else {
      newWindow = {
        uid: boundaryWindowUid(project_uid, session_uid, currentEvent.ingest_sequence),
        current: {
          start_ingest_sequence: currentEvent.ingest_sequence,
          end_ingest_sequence: currentEvent.ingest_sequence,
          collection_state: "open",
        },
      };
    }

    const activeWindow = existingWindow ?? newWindow;
    if (activeWindow === undefined) fail("invalid_input", "Boundary projector reached an impossible window state.");
    event_assignments.push({
      event_uid: currentEvent.event_uid,
      window_uid: activeWindow.uid,
      projector_version: BOUNDARY_PROJECTOR_VERSION,
    });

    if (currentEvent.kind === "boundary") {
      activeWindow.current.collection_state = "sealed";
      activeWindow.current.terminal_event_uid = currentEvent.event_uid;
      activeWindow.current.terminal_boundary_type = currentEvent.boundary_type;
      activeWindow.current.decision_status = "pending";
      if (existingWindow !== undefined) {
        open_window_update = {
          window_uid: existingWindow.uid,
          project_uid,
          session_uid,
          projector_version: BOUNDARY_PROJECTOR_VERSION,
          before: snapshot(existingWindow.before),
          after: snapshot(existingWindow.current),
        };
        existingWindow = undefined;
      } else {
        window_creates.push(createWindow(newWindow!.uid, project_uid, session_uid, newWindow!.current));
        newWindow = undefined;
      }
    }
  }

  if (existingWindow !== undefined && events.length > 0) {
    open_window_update = {
      window_uid: existingWindow.uid,
      project_uid,
      session_uid,
      projector_version: BOUNDARY_PROJECTOR_VERSION,
      before: snapshot(existingWindow.before),
      after: snapshot(existingWindow.current),
    };
  }
  if (newWindow !== undefined) {
    window_creates.push(createWindow(newWindow.uid, project_uid, session_uid, newWindow.current));
  }

  const last = events.length === 0 ? cursor.last_ingest_sequence : events[events.length - 1].ingest_sequence;
  const next_cursor_state: BoundaryProjectorCursorState =
    existingWindow !== undefined
      ? {
          last_ingest_sequence: last,
          open_window_uid: existingWindow.uid,
          open_window_start_sequence: existingWindow.current.start_ingest_sequence,
        }
      : newWindow !== undefined && newWindow.current.collection_state === "open"
        ? {
            last_ingest_sequence: last,
            open_window_uid: newWindow.uid,
            open_window_start_sequence: newWindow.current.start_ingest_sequence,
          }
        : { last_ingest_sequence: last };

  return {
    window_creates,
    ...(open_window_update === undefined ? {} : { open_window_update }),
    event_assignments,
    next_cursor_state,
    from_ingest_sequence: cursor.last_ingest_sequence + 1,
    through_ingest_sequence: last,
    events_assigned: events.length,
    windows_created: window_creates.length,
    windows_updated: open_window_update === undefined ? 0 : 1,
  };
}
