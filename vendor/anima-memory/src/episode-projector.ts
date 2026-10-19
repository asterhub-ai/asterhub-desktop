import { boundaryWindowUid, sessionContinuationDecisionUid } from "./ids.ts";
import { episodeDecisionUid, episodeUid } from "./episode-ids.ts";
import { EpisodeProjectorError, type EpisodeBoundaryEvidenceFact, type EpisodeClosureFacts, type EpisodeContinuationFact, type EpisodeDecisionHistoryEntry, type EpisodeEvidenceLinkPlan, type EpisodeKind, type EpisodeSnapshot, type EpisodeState, type EpisodeSuccessfulResultEvidenceFact, type EpisodeWindowAssignmentPlan, type EpisodeWindowFact, type ProjectEpisodeInput, type ProjectEpisodePlan } from "./episode-types.ts";
import { EPISODE_PROJECTOR_VERSION } from "./version.ts";


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WINDOW_KEYS = ["window_uid", "project_uid", "session_uid", "start_ingest_sequence", "end_ingest_sequence", "collection_state", "terminal_event_uid", "terminal_boundary_type", "decision_status", "projector_version", "assigned_episode_uid"] as const;
const BOUNDARY_KEYS = ["event_uid", "project_uid", "session_uid", "window_uid", "ingest_sequence", "kind", "boundary_type"] as const;
const RESULT_KEYS = ["event_uid", "project_uid", "session_uid", "window_uid", "ingest_sequence", "kind", "outcome", "tool_call_event_uid", "tool_call_window_uid", "tool_call_ingest_sequence"] as const;
const CONTINUATION_KEYS = ["project_uid", "current_session_uid", "previous_session_uid", "decision_uid", "schema_id", "method", "evidence_event_uid"] as const;
const INPUT_KEYS = ["project_uid", "episode_kind", "windows", "continuations", "closure", "existing_episode"] as const;
const SNAPSHOT_BASE_KEYS = ["episode_uid", "project_uid", "episode_kind", "first_window_uid", "last_window_uid", "window_count", "revision", "state", "creation_decision_uid", "last_decision_uid", "schema_id", "projector_version", "assigned_window_uids", "assigned_window_decision_uids", "assigned_window_decision_revisions", "decision_history"] as const;

interface NormalizedInput {
  project_uid: string;
  episode_kind: EpisodeKind;
  windows: EpisodeWindowFact[];
  continuations: EpisodeContinuationFact[];
  closure: EpisodeClosureFacts;
  existing_episode?: EpisodeSnapshot;
}

interface TargetState {
  state: EpisodeState;
  closure_kind: "work_validated" | "personal_explicit" | null;
  checkpoint_event_uid: string | null;
  validation_result_event_uid: string | null;
  validation_event_uid: string | null;
  suspension_event_uid: string | null;
}

interface SourceResult {
  windows: EpisodeWindowFact[];
  continuations: EpisodeContinuationFact[];
  identityConflictMessage?: string;
}

type AnyRecord = Record<string, unknown>;

function fail(code: EpisodeProjectorError["code"], message: string): never {
  throw new EpisodeProjectorError(message, code);
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: AnyRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function keysExactly(value: AnyRecord, allowed: readonly string[], code: EpisodeProjectorError["code"] = "invalid_input"): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(code, "Episode projector input contains an unsupported field.");
  }
}

function requireKeys(value: AnyRecord, required: readonly string[], code: EpisodeProjectorError["code"]): void {
  for (const key of required) {
    if (!has(value, key)) fail(code, "Episode projector input is missing a required field.");
  }
}

function canonical(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function safeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateUuid(value: unknown, code: EpisodeProjectorError["code"] = "invalid_input"): string {
  if (!canonical(value)) fail(code, "Episode projector input contains a malformed UUID.");
  return value;
}

function validateSequence(value: unknown, code: EpisodeProjectorError["code"] = "invalid_input"): number {
  if (!safeInt(value)) fail(code, "Episode projector input contains an invalid sequence.");
  return value;
}

function copyBoundary(value: AnyRecord): EpisodeBoundaryEvidenceFact {
  keysExactly(value, BOUNDARY_KEYS);
  requireKeys(value, BOUNDARY_KEYS, "source_incomplete");
  const event_uid = validateUuid(value.event_uid);
  const project_uid = validateUuid(value.project_uid);
  const session_uid = validateUuid(value.session_uid);
  const window_uid = validateUuid(value.window_uid);
  const ingest_sequence = validateSequence(value.ingest_sequence);
  return {
    event_uid,
    project_uid,
    session_uid,
    window_uid,
    ingest_sequence,
    kind: value.kind as "boundary",
    boundary_type: value.boundary_type as "checkpoint" | "validation",
  };
}

function copyResult(value: AnyRecord): EpisodeSuccessfulResultEvidenceFact {
  keysExactly(value, RESULT_KEYS);
  requireKeys(value, RESULT_KEYS, "source_incomplete");
  const event_uid = validateUuid(value.event_uid);
  const project_uid = validateUuid(value.project_uid);
  const session_uid = validateUuid(value.session_uid);
  const window_uid = validateUuid(value.window_uid);
  const ingest_sequence = validateSequence(value.ingest_sequence);
  if (value.tool_call_event_uid === undefined || value.tool_call_window_uid === undefined || value.tool_call_ingest_sequence === undefined) {
    fail("source_incomplete", "ToolResult is missing RESULT_OF provenance.");
  }
  const tool_call_event_uid = validateUuid(value.tool_call_event_uid);
  const tool_call_window_uid = validateUuid(value.tool_call_window_uid);
  const tool_call_ingest_sequence = validateSequence(value.tool_call_ingest_sequence);
  return {
    event_uid,
    project_uid,
    session_uid,
    window_uid,
    ingest_sequence,
    kind: value.kind as "tool_result",
    outcome: value.outcome as "success",
    tool_call_event_uid,
    tool_call_window_uid,
    tool_call_ingest_sequence,
  };
}

function copyWindow(value: AnyRecord): EpisodeWindowFact {
  keysExactly(value, WINDOW_KEYS);
  requireKeys(value, WINDOW_KEYS, "source_incomplete");
  const window_uid = validateUuid(value.window_uid);
  const project_uid = validateUuid(value.project_uid);
  const session_uid = validateUuid(value.session_uid);
  const start_ingest_sequence = validateSequence(value.start_ingest_sequence);
  const end_ingest_sequence = validateSequence(value.end_ingest_sequence);
  if (start_ingest_sequence > end_ingest_sequence) fail("invalid_input", "Window range is reversed.");
  if (value.collection_state !== "sealed" || value.decision_status !== "pending" || value.projector_version !== "anima.boundary-projector/v1") {
    fail("invalid_input", "Window does not carry the frozen R3A sealed shape.");
  }
  if (!["checkpoint", "compact", "shutdown", "validation", "unknown"].includes(value.terminal_boundary_type as string)) {
    fail("invalid_input", "Window contains an invalid terminal boundary type.");
  }
  const terminal_event_uid = validateUuid(value.terminal_event_uid);
  const assigned_episode_uid = value.assigned_episode_uid === null ? null : validateUuid(value.assigned_episode_uid);
  return {
    window_uid,
    project_uid,
    session_uid,
    start_ingest_sequence,
    end_ingest_sequence,
    collection_state: "sealed",
    terminal_event_uid,
    terminal_boundary_type: value.terminal_boundary_type as EpisodeWindowFact["terminal_boundary_type"],
    decision_status: "pending",
    projector_version: "anima.boundary-projector/v1",
    assigned_episode_uid,
  };
}

function copyContinuation(value: AnyRecord): EpisodeContinuationFact {
  keysExactly(value, CONTINUATION_KEYS);
  requireKeys(value, CONTINUATION_KEYS, "invalid_input");
  const project_uid = validateUuid(value.project_uid);
  const current_session_uid = validateUuid(value.current_session_uid);
  const previous_session_uid = validateUuid(value.previous_session_uid);
  const decision_uid = validateUuid(value.decision_uid);
  const evidence_event_uid = validateUuid(value.evidence_event_uid);
  if (value.schema_id !== "anima.session-continuation/v1.0" || value.method !== "explicit_checkpoint") {
    fail("invalid_input", "Continuation does not carry the frozen R3A schema.");
  }
  return { project_uid, current_session_uid, previous_session_uid, decision_uid, schema_id: "anima.session-continuation/v1.0", method: "explicit_checkpoint", evidence_event_uid };
}

function copyClosure(value: unknown): EpisodeClosureFacts {
  if (!isRecord(value)) fail("invalid_input", "Invalid Episode closure.");
  if (!has(value, "kind")) fail("invalid_input", "Episode closure is missing its kind.");
  if (value.kind === "none") {
    keysExactly(value, ["kind"]);
    return { kind: "none" };
  }
  if (value.kind === "work_validated") {
    keysExactly(value, ["kind", "checkpoint", "validation_result", "validation"]);
    const checkpoint = value.checkpoint === undefined ? undefined : copyBoundaryObject(value.checkpoint);
    const validation_result = value.validation_result === undefined ? undefined : copyResultObject(value.validation_result);
    const validation = value.validation === undefined ? undefined : copyBoundaryObject(value.validation);
    return { kind: "work_validated", checkpoint: checkpoint as EpisodeBoundaryEvidenceFact, validation_result: validation_result as EpisodeSuccessfulResultEvidenceFact, validation: validation as EpisodeBoundaryEvidenceFact };
  }
  if (value.kind === "personal_explicit") {
    keysExactly(value, ["kind", "checkpoint"]);
    const checkpoint = value.checkpoint === undefined ? undefined : copyBoundaryObject(value.checkpoint);
    return { kind: "personal_explicit", checkpoint: checkpoint as EpisodeBoundaryEvidenceFact };
  }
  fail("invalid_input", "Episode closure kind is invalid.");
}

function copyBoundaryObject(value: unknown): EpisodeBoundaryEvidenceFact {
  if (!isRecord(value)) fail("source_incomplete", "Boundary evidence is absent or malformed.");
  return copyBoundary(value);
}

function copyResultObject(value: unknown): EpisodeSuccessfulResultEvidenceFact {
  if (!isRecord(value)) fail("source_incomplete", "ToolResult evidence is absent or malformed.");
  return copyResult(value);
}
function validatePublicBoundaryValues(value: AnyRecord): void {
  keysExactly(value, BOUNDARY_KEYS);
  for (const key of ["event_uid", "project_uid", "session_uid", "window_uid"] as const) {
    if (has(value, key) && value[key] !== undefined) validateUuid(value[key]);
  }
  if (has(value, "ingest_sequence") && value.ingest_sequence !== undefined) validateSequence(value.ingest_sequence);
}

function validatePublicResultValues(value: AnyRecord): void {
  keysExactly(value, RESULT_KEYS);
  for (const key of ["event_uid", "project_uid", "session_uid", "window_uid"] as const) {
    if (has(value, key) && value[key] !== undefined) validateUuid(value[key]);
  }
  if (has(value, "ingest_sequence") && value.ingest_sequence !== undefined) validateSequence(value.ingest_sequence);
  if (has(value, "tool_call_event_uid") && value.tool_call_event_uid !== undefined) validateUuid(value.tool_call_event_uid);
  if (has(value, "tool_call_window_uid") && value.tool_call_window_uid !== undefined) validateUuid(value.tool_call_window_uid);
  if (has(value, "tool_call_ingest_sequence") && value.tool_call_ingest_sequence !== undefined) validateSequence(value.tool_call_ingest_sequence);
}

function validatePublicWindowValues(value: AnyRecord): void {
  keysExactly(value, WINDOW_KEYS);
  for (const key of ["window_uid", "project_uid", "session_uid", "terminal_event_uid"] as const) {
    if (has(value, key) && value[key] !== undefined) validateUuid(value[key]);
  }
  const start_ingest_sequence = has(value, "start_ingest_sequence") && value.start_ingest_sequence !== undefined ? validateSequence(value.start_ingest_sequence) : undefined;
  const end_ingest_sequence = has(value, "end_ingest_sequence") && value.end_ingest_sequence !== undefined ? validateSequence(value.end_ingest_sequence) : undefined;
  if (start_ingest_sequence !== undefined && end_ingest_sequence !== undefined && start_ingest_sequence > end_ingest_sequence) {
    fail("invalid_input", "Window range is reversed.");
  }
  if (has(value, "collection_state") && value.collection_state !== "sealed") fail("invalid_input", "Window collection state is invalid.");
  if (has(value, "decision_status") && value.decision_status !== "pending") fail("invalid_input", "Window decision status is invalid.");
  if (has(value, "projector_version") && value.projector_version !== "anima.boundary-projector/v1") fail("invalid_input", "Window projector version is invalid.");
  const terminal_boundary_type = value.terminal_boundary_type;
  if (
    has(value, "terminal_boundary_type") &&
    terminal_boundary_type !== "checkpoint" &&
    terminal_boundary_type !== "compact" &&
    terminal_boundary_type !== "shutdown" &&
    terminal_boundary_type !== "validation" &&
    terminal_boundary_type !== "unknown"
  ) {
    fail("invalid_input", "Window terminal boundary type is invalid.");
  }
  if (has(value, "assigned_episode_uid") && value.assigned_episode_uid !== null && value.assigned_episode_uid !== undefined) {
    validateUuid(value.assigned_episode_uid);
  }
}

function validatePublicContinuationValues(value: AnyRecord): void {
  keysExactly(value, CONTINUATION_KEYS);
  for (const key of ["project_uid", "current_session_uid", "previous_session_uid", "decision_uid", "evidence_event_uid"] as const) {
    if (has(value, key) && value[key] !== undefined) validateUuid(value[key]);
  }
  if (has(value, "schema_id") && value.schema_id !== "anima.session-continuation/v1.0") fail("invalid_input", "Continuation schema is invalid.");
  if (has(value, "method") && value.method !== "explicit_checkpoint") fail("invalid_input", "Continuation method is invalid.");
}

function validatePublicInputShape(input: AnyRecord): void {
  keysExactly(input, INPUT_KEYS);
  requireKeys(input, ["project_uid", "episode_kind", "windows", "continuations", "closure"], "invalid_input");
  if (has(input, "existing_episode") && input.existing_episode === undefined) fail("invalid_input", "existing_episode cannot be undefined when present.");
  validateUuid(input.project_uid);
  if (input.episode_kind !== "work" && input.episode_kind !== "personal") fail("invalid_input", "Episode kind is invalid.");
  if (!Array.isArray(input.windows) || input.windows.length === 0) fail("invalid_input", "Episode windows must be nonempty.");
  if (!Array.isArray(input.continuations)) fail("invalid_input", "Episode continuations must be a list.");
  for (const value of input.windows) {
    if (!isRecord(value)) fail("invalid_input", "Invalid Episode Window fact.");
    validatePublicWindowValues(value);
  }
  for (const value of input.continuations) {
    if (!isRecord(value)) fail("invalid_input", "Invalid Session continuation fact.");
    validatePublicContinuationValues(value);
  }
  if (!isRecord(input.closure)) fail("invalid_input", "Invalid Episode closure.");
  if (!has(input.closure, "kind")) fail("invalid_input", "Episode closure is missing its kind.");
  if (input.closure.kind === "none") {
    keysExactly(input.closure, ["kind"]);
    return;
  }
  if (input.closure.kind === "work_validated") {
    keysExactly(input.closure, ["kind", "checkpoint", "validation_result", "validation"]);
    if (isRecord(input.closure.checkpoint)) validatePublicBoundaryValues(input.closure.checkpoint);
    if (isRecord(input.closure.validation_result)) validatePublicResultValues(input.closure.validation_result);
    if (isRecord(input.closure.validation)) validatePublicBoundaryValues(input.closure.validation);
    return;
  }
  if (input.closure.kind === "personal_explicit") {
    keysExactly(input.closure, ["kind", "checkpoint"]);
    if (isRecord(input.closure.checkpoint)) validatePublicBoundaryValues(input.closure.checkpoint);
    return;
  }
  fail("invalid_input", "Episode closure kind is invalid.");
}

function validatePublicInput(input: unknown): NormalizedInput {
  if (!isRecord(input)) fail("invalid_input", "Invalid Episode projector input.");
  validatePublicInputShape(input);
  const project_uid = validateUuid(input.project_uid);
  if (input.episode_kind !== "work" && input.episode_kind !== "personal") fail("invalid_input", "Episode kind is invalid.");
  if (!Array.isArray(input.windows) || input.windows.length === 0) fail("invalid_input", "Episode windows must be nonempty.");
  if (!Array.isArray(input.continuations)) fail("invalid_input", "Episode continuations must be a list.");
  const windows = input.windows.map((value) => {
    if (!isRecord(value)) fail("invalid_input", "Invalid Episode Window fact.");
    return copyWindow(value);
  });
  const continuations = input.continuations.map((value) => {
    if (!isRecord(value)) fail("invalid_input", "Invalid Session continuation fact.");
    return copyContinuation(value);
  });
  const closure = copyClosure(input.closure);
  return { project_uid, episode_kind: input.episode_kind, windows, continuations, closure, existing_episode: input.existing_episode === undefined ? undefined : input.existing_episode as EpisodeSnapshot };
}


function validateWindowSource(project_uid: string, episode_kind: EpisodeKind, windows: EpisodeWindowFact[], continuations: EpisodeContinuationFact[]): SourceResult {
  const seenWindows = new Set<string>();
  const seenSessions = new Set<string>();
  const transitions: Array<[string, string]> = [];
  let previous: EpisodeWindowFact | undefined;
  let continuationTopologyConflict = false;
  let identityConflictMessage: string | undefined;
  const rememberIdentityConflict = (message: string): void => {
    if (identityConflictMessage === undefined) identityConflictMessage = message;
  };
  const rememberContinuationTopologyConflict = (message: string): void => {
    continuationTopologyConflict = true;
    rememberIdentityConflict(message);
  };
  for (const window of windows) {
    if (window.project_uid !== project_uid) rememberIdentityConflict("Window Project ownership conflicts with the input Project.");
    if (seenWindows.has(window.window_uid)) rememberIdentityConflict("Episode Window identity is duplicated.");
    seenWindows.add(window.window_uid);
    let expectedUid: string | undefined;
    try {
      expectedUid = boundaryWindowUid(project_uid, window.session_uid, window.start_ingest_sequence);
    } catch {
      rememberIdentityConflict("Window identity cannot be rederived.");
    }
    if (expectedUid !== undefined && window.window_uid !== expectedUid) rememberIdentityConflict("Window identity does not match its R3A boundary identity.");
    if (previous !== undefined) {
      if (window.session_uid === previous.session_uid) {
        if (window.start_ingest_sequence !== previous.end_ingest_sequence + 1) rememberIdentityConflict("Same-Session Windows are not contiguous.");
      } else {
        transitions.push([previous.session_uid, window.session_uid]);
        if (seenSessions.has(window.session_uid)) {
          rememberContinuationTopologyConflict("Session re-entry is not allowed.");
        }
      }
    }
    if (!seenSessions.has(window.session_uid)) seenSessions.add(window.session_uid);
    previous = window;
  }
  const pairSeen = new Set<string>();
  const supplied = new Map<string, EpisodeContinuationFact>();
  for (const fact of continuations) {
    if (fact.project_uid !== project_uid) rememberContinuationTopologyConflict("Continuation Project ownership conflicts with the input Project.");
    if (fact.current_session_uid === fact.previous_session_uid) rememberContinuationTopologyConflict("Continuation cannot connect a Session to itself.");
    const key = `${fact.previous_session_uid}->${fact.current_session_uid}`;
    if (pairSeen.has(key)) {
      rememberContinuationTopologyConflict("Continuation relation is duplicated.");
      continue;
    }
    pairSeen.add(key);
    if (supplied.has(key)) {
      rememberContinuationTopologyConflict("Continuation relation is conflicting.");
      continue;
    }
    supplied.set(key, fact);
  }
  const expectedPairs = new Set(transitions.map(([previousSession, currentSession]) => `${previousSession}->${currentSession}`));
  for (const key of supplied.keys()) {
    if (!expectedPairs.has(key)) rememberContinuationTopologyConflict("Continuation facts do not match the selected Session chain.");
  }
  for (const [previousSession, currentSession] of transitions) {
    const key = `${previousSession}->${currentSession}`;
    const fact = supplied.get(key);
    if (fact === undefined) {
      if (continuationTopologyConflict) rememberIdentityConflict("Continuation topology conflicts with the selected Session chain.");
      else fail("source_incomplete", "Selected Session transition lacks its exact continuation fact.");
      continue;
    }
    let expectedDecision: string | undefined;
    try {
      expectedDecision = sessionContinuationDecisionUid(project_uid, currentSession, previousSession, fact.evidence_event_uid);
    } catch {
      rememberIdentityConflict("Continuation decision identity cannot be rederived.");
    }
    if (expectedDecision !== undefined && fact.decision_uid !== expectedDecision) rememberIdentityConflict("Continuation decision identity conflicts with its evidence.");
  }
  const first = windows[0]!;
  let derivedEpisodeUid: string | undefined;
  try {
    derivedEpisodeUid = episodeUid(project_uid, first.window_uid);
  } catch {
    rememberIdentityConflict("Episode identity cannot be rederived from the first Window.");
  }
  for (const window of windows) {
    if (window.assigned_episode_uid !== null && derivedEpisodeUid !== undefined && window.assigned_episode_uid !== derivedEpisodeUid) {
      rememberIdentityConflict("Window is assigned to another Episode.");
    }
  }
  void episode_kind;
  return identityConflictMessage === undefined ? { windows, continuations } : { windows, continuations, identityConflictMessage };
}

function selectedWindow(windows: EpisodeWindowFact[], uid: string): { window: EpisodeWindowFact; position: number } {
  const position = windows.findIndex((item) => item.window_uid === uid);
  if (position < 0) fail("evidence_invalid", "Evidence does not belong to a selected Window.");
  return { window: windows[position]!, position };
}

function checkBoundaryMembership(fact: EpisodeBoundaryEvidenceFact, windows: EpisodeWindowFact[]): { window: EpisodeWindowFact; position: number } {
  const selected = selectedWindow(windows, fact.window_uid);
  if (fact.project_uid !== selected.window.project_uid || fact.session_uid !== selected.window.session_uid || fact.ingest_sequence < selected.window.start_ingest_sequence || fact.ingest_sequence > selected.window.end_ingest_sequence) {
    fail("evidence_invalid", "Boundary evidence ownership or range is invalid.");
  }
  if (fact.kind !== "boundary") fail("evidence_invalid", "Evidence Event is not a Boundary.");
  return selected;
}

function checkResultMembership(fact: EpisodeSuccessfulResultEvidenceFact, windows: EpisodeWindowFact[]): { window: EpisodeWindowFact; position: number } {
  const selected = selectedWindow(windows, fact.window_uid);
  if (fact.project_uid !== selected.window.project_uid || fact.session_uid !== selected.window.session_uid || fact.ingest_sequence < selected.window.start_ingest_sequence || fact.ingest_sequence > selected.window.end_ingest_sequence) {
    fail("evidence_invalid", "ToolResult evidence ownership or range is invalid.");
  }
  if (fact.kind !== "tool_result" || fact.outcome !== "success") fail("evidence_invalid", "ToolResult evidence is not a successful ToolResult.");
  return selected;
}

function validateClosureEvidence(closure: EpisodeClosureFacts, episode_kind: EpisodeKind, project_uid: string, windows: EpisodeWindowFact[]): TargetState {
  const finalWindow = windows[windows.length - 1]!;
  if (closure.kind === "none") {
    if (finalWindow.terminal_boundary_type === "shutdown") {
      return { state: "suspended", closure_kind: null, checkpoint_event_uid: null, validation_result_event_uid: null, validation_event_uid: null, suspension_event_uid: finalWindow.terminal_event_uid };
    }
    return { state: "open", closure_kind: null, checkpoint_event_uid: null, validation_result_event_uid: null, validation_event_uid: null, suspension_event_uid: null };
  }
  if (closure.kind === "personal_explicit") {
    if (episode_kind !== "personal") fail("evidence_invalid", "Personal closure cannot close a work Episode.");
    if (closure.checkpoint === undefined) fail("source_incomplete", "Personal closure lacks checkpoint evidence.");
    const checkpoint = checkBoundaryMembership(closure.checkpoint, windows);
    if (closure.checkpoint.boundary_type !== "checkpoint" || checkpoint.position !== windows.length - 1 || closure.checkpoint.ingest_sequence !== finalWindow.end_ingest_sequence || closure.checkpoint.event_uid !== finalWindow.terminal_event_uid || finalWindow.terminal_boundary_type !== "checkpoint") {
      fail("evidence_invalid", "Personal checkpoint is not the terminal boundary of the final Window.");
    }
    return { state: "stable_ended", closure_kind: "personal_explicit", checkpoint_event_uid: closure.checkpoint.event_uid, validation_result_event_uid: null, validation_event_uid: null, suspension_event_uid: null };
  }
  if (episode_kind !== "work") fail("evidence_invalid", "Work closure cannot close a personal Episode.");
  if (closure.checkpoint === undefined || closure.validation_result === undefined || closure.validation === undefined) fail("source_incomplete", "Work closure lacks required evidence.");
  const checkpoint = checkBoundaryMembership(closure.checkpoint, windows);
  const result = checkResultMembership(closure.validation_result, windows);
  const validation = checkBoundaryMembership(closure.validation, windows);
  if (closure.checkpoint.boundary_type !== "checkpoint" || closure.validation.boundary_type !== "validation") fail("evidence_invalid", "Work closure evidence has an incorrect boundary type.");
  if (result.position !== windows.length - 1 || result.window.session_uid !== finalWindow.session_uid || validation.position !== windows.length - 1 || closure.validation.ingest_sequence !== finalWindow.end_ingest_sequence || closure.validation.event_uid !== finalWindow.terminal_event_uid || finalWindow.terminal_boundary_type !== "validation") {
    fail("evidence_invalid", "Work validation evidence is not bound to the terminal final Window.");
  }
  if (closure.validation_result.ingest_sequence + 1 !== closure.validation.ingest_sequence) fail("evidence_invalid", "Validation boundary is not immediately after the ToolResult.");
  if (closure.validation_result.tool_call_window_uid === closure.validation_result.window_uid && closure.validation_result.tool_call_ingest_sequence >= closure.validation_result.ingest_sequence) fail("evidence_invalid", "ToolResult RESULT_OF provenance is invalid.");
  const call = selectedWindow(windows, closure.validation_result.tool_call_window_uid);
  if (closure.validation_result.project_uid !== project_uid || closure.validation_result.tool_call_window_uid !== call.window.window_uid || call.window.project_uid !== project_uid || call.window.session_uid !== closure.validation_result.session_uid || closure.validation_result.tool_call_ingest_sequence < call.window.start_ingest_sequence || closure.validation_result.tool_call_ingest_sequence > call.window.end_ingest_sequence) {
    fail("evidence_invalid", "ToolCall provenance is outside the selected source.");
  }
  if (call.position > result.position || (call.position === result.position && closure.validation_result.tool_call_ingest_sequence >= closure.validation_result.ingest_sequence)) fail("evidence_invalid", "ToolResult RESULT_OF provenance is invalid.");
  if (checkpoint.position > result.position || (checkpoint.window.session_uid === result.window.session_uid && closure.checkpoint.ingest_sequence >= closure.validation_result.ingest_sequence)) fail("evidence_invalid", "Checkpoint does not precede the validation result.");
  return { state: "stable_ended", closure_kind: "work_validated", checkpoint_event_uid: closure.checkpoint.event_uid, validation_result_event_uid: closure.validation_result.event_uid, validation_event_uid: closure.validation.event_uid, suspension_event_uid: null };
}

function closureFromHistory(entry: EpisodeDecisionHistoryEntry): { closure_kind: TargetState["closure_kind"]; checkpoint_event_uid: string | null; validation_result_event_uid: string | null; validation_event_uid: string | null; suspension_event_uid: string | null } {
  if (entry.state === "open") return { closure_kind: null, checkpoint_event_uid: null, validation_result_event_uid: null, validation_event_uid: null, suspension_event_uid: null };
  if (entry.state === "suspended") return { closure_kind: null, checkpoint_event_uid: null, validation_result_event_uid: null, validation_event_uid: null, suspension_event_uid: entry.suspension_event_uid };
  if (entry.closure_kind === "work_validated") return { closure_kind: "work_validated", checkpoint_event_uid: entry.checkpoint_event_uid, validation_result_event_uid: entry.validation_result_event_uid, validation_event_uid: entry.validation_event_uid, suspension_event_uid: null };
  return { closure_kind: "personal_explicit", checkpoint_event_uid: entry.checkpoint_event_uid, validation_result_event_uid: null, validation_event_uid: null, suspension_event_uid: null };
}

function targetEqualsSnapshot(target: TargetState, snapshot: EpisodeSnapshot): boolean {
  return target.state === snapshot.state && target.closure_kind === (snapshot.closure_kind ?? null) && target.checkpoint_event_uid === (snapshot.checkpoint_event_uid ?? null) && target.validation_result_event_uid === (snapshot.validation_result_event_uid ?? null) && target.validation_event_uid === (snapshot.validation_event_uid ?? null) && target.suspension_event_uid === (snapshot.suspension_event_uid ?? null);
}

function cloneHistoryEntry(entry: EpisodeDecisionHistoryEntry): EpisodeDecisionHistoryEntry {
  return { ...entry } as EpisodeDecisionHistoryEntry;
}

function cloneSnapshot(snapshot: EpisodeSnapshot): EpisodeSnapshot {
  return { ...snapshot, assigned_window_uids: [...snapshot.assigned_window_uids], assigned_window_decision_uids: [...snapshot.assigned_window_decision_uids], assigned_window_decision_revisions: [...snapshot.assigned_window_decision_revisions], decision_history: snapshot.decision_history.map(cloneHistoryEntry) as [EpisodeDecisionHistoryEntry, ...EpisodeDecisionHistoryEntry[]] };
}

function entryKeys(state: EpisodeState, closure_kind?: "work_validated" | "personal_explicit"): readonly string[] {
  if (state === "open") return ["revision", "decision_uid", "window_count", "state"];
  if (state === "suspended") return ["revision", "decision_uid", "window_count", "state", "suspension_event_uid"];
  if (closure_kind === "work_validated") return ["revision", "decision_uid", "window_count", "state", "closure_kind", "checkpoint_event_uid", "validation_result_event_uid", "validation_event_uid"];
  return ["revision", "decision_uid", "window_count", "state", "closure_kind", "checkpoint_event_uid"];
}

function historyEntryFromTarget(revision: number, decision_uid: string, window_count: number, target: TargetState): EpisodeDecisionHistoryEntry {
  if (target.state === "open") return { revision, decision_uid, window_count, state: "open" };
  if (target.state === "suspended") return { revision, decision_uid, window_count, state: "suspended", suspension_event_uid: target.suspension_event_uid! };
  if (target.closure_kind === "work_validated") return { revision, decision_uid, window_count, state: "stable_ended", closure_kind: "work_validated", checkpoint_event_uid: target.checkpoint_event_uid!, validation_result_event_uid: target.validation_result_event_uid!, validation_event_uid: target.validation_event_uid! };
  return { revision, decision_uid, window_count, state: "stable_ended", closure_kind: "personal_explicit", checkpoint_event_uid: target.checkpoint_event_uid! };
}

function decisionFor(episode_uid: string, episode_kind: EpisodeKind, revision: number, windows: EpisodeWindowFact[], target: TargetState): string {
  return episodeDecisionUid({
    episode_uid,
    episode_kind,
    target_revision: revision,
    ordered_window_uids: windows.map((window) => window.window_uid) as [string, ...string[]],
    target_state: target.state,
    closure_kind_or_null: target.closure_kind,
    checkpoint_event_uid_or_null: target.checkpoint_event_uid,
    validation_result_event_uid_or_null: target.validation_result_event_uid,
    validation_event_uid_or_null: target.validation_event_uid,
  });
}

function validateSnapshot(value: unknown, project_uid: string, episode_kind: EpisodeKind, windows: EpisodeWindowFact[]): EpisodeSnapshot {
  if (!isRecord(value)) fail("identity_conflict", "Existing Episode snapshot is malformed.");
  const raw = value;
  if (!has(raw, "state")) fail("identity_conflict", "Existing Episode snapshot is missing state.");
  const state = raw.state;
  if (state !== "open" && state !== "suspended" && state !== "stable_ended") fail("identity_conflict", "Existing Episode state is invalid.");
  let closure_kind: "work_validated" | "personal_explicit" | undefined;
  if (state === "stable_ended") {
    closure_kind = raw.closure_kind as typeof closure_kind;
    if (closure_kind !== "work_validated" && closure_kind !== "personal_explicit") fail("identity_conflict", "Existing stable Episode closure is invalid.");
  }
  const allowed = state === "open" ? SNAPSHOT_BASE_KEYS : state === "suspended" ? [...SNAPSHOT_BASE_KEYS, "suspension_event_uid"] : closure_kind === "work_validated" ? [...SNAPSHOT_BASE_KEYS, "closure_kind", "checkpoint_event_uid", "validation_result_event_uid", "validation_event_uid"] : [...SNAPSHOT_BASE_KEYS, "closure_kind", "checkpoint_event_uid"];
  keysExactly(raw, allowed, "identity_conflict");
  requireKeys(raw, SNAPSHOT_BASE_KEYS, "identity_conflict");
  for (const key of allowed.slice(SNAPSHOT_BASE_KEYS.length)) requireKeys(raw, [key], "identity_conflict");
  const episode_uid_value = validateUuid(raw.episode_uid, "identity_conflict");
  const snapshot_project_uid = validateUuid(raw.project_uid, "identity_conflict");
  const first_window_uid = validateUuid(raw.first_window_uid, "identity_conflict");
  const last_window_uid = validateUuid(raw.last_window_uid, "identity_conflict");
  const creation_decision_uid = validateUuid(raw.creation_decision_uid, "identity_conflict");
  const last_decision_uid = validateUuid(raw.last_decision_uid, "identity_conflict");
  if (snapshot_project_uid !== project_uid || raw.episode_kind !== episode_kind || raw.schema_id !== "anima.episode/v1.0" || raw.projector_version !== EPISODE_PROJECTOR_VERSION) fail("identity_conflict", "Existing Episode immutable identity conflicts with the source.");
  const window_count = raw.window_count;
  const revision = raw.revision;
  if (!safeInt(window_count) || window_count < 1 || !safeInt(revision)) fail("identity_conflict", "Existing Episode counters are invalid.");
  if (!Array.isArray(raw.assigned_window_uids) || raw.assigned_window_uids.length === 0 || !Array.isArray(raw.assigned_window_decision_uids) || !Array.isArray(raw.assigned_window_decision_revisions) || !Array.isArray(raw.decision_history)) fail("identity_conflict", "Existing Episode arrays are malformed.");
  const assigned_window_uids = raw.assigned_window_uids.map((uid) => validateUuid(uid, "identity_conflict"));
  const assigned_decision_uids = raw.assigned_window_decision_uids.map((uid) => validateUuid(uid, "identity_conflict"));
  const assigned_revisions = raw.assigned_window_decision_revisions.map((item) => {
    if (!safeInt(item)) fail("identity_conflict", "Existing Episode assignment revision is invalid.");
    return item;
  });
  if (window_count !== assigned_window_uids.length || assigned_decision_uids.length !== assigned_window_uids.length || assigned_revisions.length !== assigned_window_uids.length || assigned_window_uids.length > windows.length) fail("identity_conflict", "Existing Episode assignment arrays are incoherent.");
  if (new Set(assigned_window_uids).size !== assigned_window_uids.length) fail("identity_conflict", "Existing Episode assignments contain duplicate Windows.");
  for (let i = 0; i < assigned_window_uids.length; i += 1) if (assigned_window_uids[i] !== windows[i]!.window_uid) fail("identity_conflict", "Existing Episode assignments are not the selected Window prefix.");
  if (first_window_uid !== assigned_window_uids[0] || last_window_uid !== assigned_window_uids[assigned_window_uids.length - 1]) fail("identity_conflict", "Existing Episode Window endpoints are incoherent.");
  let derivedEpisodeUid: string;
  try {
    derivedEpisodeUid = episodeUid(project_uid, first_window_uid);
  } catch {
    fail("identity_conflict", "Existing Episode identity cannot be rederived.");
  }
  if (episode_uid_value !== derivedEpisodeUid) fail("identity_conflict", "Existing Episode identity is not derivable.");
  const historyRaw = raw.decision_history as unknown[];
  if (historyRaw.length !== revision + 1 || historyRaw.length === 0) fail("identity_conflict", "Existing Episode decision history is not contiguous.");
  const history: EpisodeDecisionHistoryEntry[] = [];
  let priorCount = 0;
  for (let index = 0; index < historyRaw.length; index += 1) {
    const item = historyRaw[index];
    if (!isRecord(item) || item.revision !== index || item.revision !== index || !safeInt(item.window_count) || item.window_count < 1 || item.window_count > window_count || item.window_count < priorCount || typeof item.decision_uid !== "string" || !canonical(item.decision_uid) || (item.state !== "open" && item.state !== "suspended" && item.state !== "stable_ended")) fail("identity_conflict", "Existing Episode history entry is malformed.");
    const itemState = item.state as EpisodeState;
    let itemClosure: "work_validated" | "personal_explicit" | undefined;
    if (itemState === "stable_ended") {
      itemClosure = item.closure_kind as typeof itemClosure;
      if (itemClosure !== "work_validated" && itemClosure !== "personal_explicit") fail("identity_conflict", "Existing stable history closure is malformed.");
    }
    keysExactly(item, entryKeys(itemState, itemClosure), "identity_conflict");
    const itemEntry = item as unknown as EpisodeDecisionHistoryEntry;
    if (itemState === "suspended") {
      validateUuid(item.suspension_event_uid, "identity_conflict");
      const prefixWindow = windows[item.window_count - 1]!;
      if (prefixWindow.terminal_boundary_type !== "shutdown" || prefixWindow.terminal_event_uid !== item.suspension_event_uid) fail("identity_conflict", "Suspended history is not bound to a shutdown Window.");
    } else if (itemState === "stable_ended") {
      validateUuid(item.checkpoint_event_uid, "identity_conflict");
      if (itemClosure === "work_validated") {
        validateUuid(item.validation_result_event_uid, "identity_conflict");
        validateUuid(item.validation_event_uid, "identity_conflict");
      }
    } else if (windows[item.window_count - 1]!.terminal_boundary_type === "shutdown") {
      fail("identity_conflict", "Open history cannot end at a shutdown Window.");
    }
    let expected: string;
    try {
      const historyTarget = closureFromHistory(itemEntry);
      expected = episodeDecisionUid({
        episode_uid: episode_uid_value,
        episode_kind,
        target_revision: index,
        ordered_window_uids: windows.slice(0, item.window_count).map((window) => window.window_uid) as [string, ...string[]],
        target_state: itemState,
        closure_kind_or_null: historyTarget.closure_kind,
        checkpoint_event_uid_or_null: historyTarget.checkpoint_event_uid,
        validation_result_event_uid_or_null: historyTarget.validation_result_event_uid,
        validation_event_uid_or_null: historyTarget.validation_event_uid,
      });
    } catch {
      fail("identity_conflict", "Existing history decision identity cannot be rederived.");
    }
    if (item.decision_uid !== expected) fail("identity_conflict", "Existing history decision identity is forged.");
    history.push({ ...itemEntry } as EpisodeDecisionHistoryEntry);
    priorCount = item.window_count as number;
  }
  for (let i = 1; i < history.length; i += 1) {
    const previousEntry = history[i - 1]!;
    if (previousEntry.state !== "suspended") continue;
    const currentEntry = history[i]!;
    if (currentEntry.window_count <= previousEntry.window_count) fail("identity_conflict", "Suspended history must resume with additional Windows.");
    const previousTerminalWindow = windows[previousEntry.window_count - 1]!;
    const firstResumedWindow = windows[previousEntry.window_count]!;
    if (firstResumedWindow.session_uid === previousTerminalWindow.session_uid) fail("identity_conflict", "Suspended history must resume in a new Session.");
  }
  if (history.some((entry, index) => entry.state === "stable_ended" && index !== history.length - 1)) fail("identity_conflict", "Stable-ended history cannot be followed by another revision.");
  for (let i = 1; i < history.length; i += 1) {
    const previousEntry = history[i - 1]!;
    const currentEntry = history[i]!;
    const previousTarget = closureFromHistory(previousEntry);
    const currentTarget = closureFromHistory(currentEntry);
    const changedEvidence = previousEntry.state !== currentEntry.state || previousEntry.window_count !== currentEntry.window_count || previousTarget.closure_kind !== currentTarget.closure_kind || previousTarget.checkpoint_event_uid !== currentTarget.checkpoint_event_uid || previousTarget.validation_result_event_uid !== currentTarget.validation_result_event_uid || previousTarget.validation_event_uid !== currentTarget.validation_event_uid || previousTarget.suspension_event_uid !== currentTarget.suspension_event_uid;
    if (!changedEvidence) fail("identity_conflict", "Existing Episode history contains an empty revision.");
  }
  const finalEntry = history[history.length - 1]!;
  if (last_decision_uid !== finalEntry.decision_uid) fail("identity_conflict", "Existing Episode last decision identity does not match its final history entry.");
  for (let position = 0; position < assigned_window_uids.length; position += 1) {
    const introducingIndex = history.findIndex((entry) => entry.window_count >= position + 1);
    if (introducingIndex < 0 || assigned_decision_uids[position] !== history[introducingIndex]!.decision_uid || assigned_revisions[position] !== history[introducingIndex]!.revision) fail("identity_conflict", "Existing Window assignment provenance is forged.");
  }
  if (creation_decision_uid !== history[0]!.decision_uid || assigned_decision_uids[0] !== history[0]!.decision_uid) fail("identity_conflict", "Existing Episode creation decision provenance is forged.");
  if (state !== finalEntry.state) fail("identity_conflict", "Existing Episode state does not match its final history entry.");
  const finalTarget = closureFromHistory(finalEntry);
  if (finalTarget.closure_kind !== (raw.closure_kind ?? null) || finalTarget.checkpoint_event_uid !== (raw.checkpoint_event_uid ?? null) || finalTarget.validation_result_event_uid !== (raw.validation_result_event_uid ?? null) || finalTarget.validation_event_uid !== (raw.validation_event_uid ?? null) || finalTarget.suspension_event_uid !== (raw.suspension_event_uid ?? null)) fail("identity_conflict", "Existing Episode closure fields do not match history.");
  if (state === "suspended") validateUuid(raw.suspension_event_uid, "identity_conflict");
  if (state === "stable_ended") {
    validateUuid(raw.checkpoint_event_uid, "identity_conflict");
    if (closure_kind === "work_validated") {
      validateUuid(raw.validation_result_event_uid, "identity_conflict");
      validateUuid(raw.validation_event_uid, "identity_conflict");
      if (episode_kind !== "work") fail("identity_conflict", "Work closure is incompatible with Episode kind.");
    } else if (episode_kind !== "personal") fail("identity_conflict", "Personal closure is incompatible with Episode kind.");
  }
  if (state === "stable_ended") {
    const finalWindow = windows[window_count - 1]!;
    if (closure_kind === "work_validated") {
      if (finalWindow.terminal_boundary_type !== "validation" || finalWindow.terminal_event_uid !== raw.validation_event_uid) fail("identity_conflict", "Existing work closure is not bound to the terminal validation Window.");
    } else if (finalWindow.terminal_boundary_type !== "checkpoint" || finalWindow.terminal_event_uid !== raw.checkpoint_event_uid) {
      fail("identity_conflict", "Existing personal closure is not bound to the terminal checkpoint Window.");
    }
  }
  return {
    episode_uid: episode_uid_value,
    project_uid: snapshot_project_uid,
    episode_kind,
    first_window_uid,
    last_window_uid,
    window_count,
    revision,
    state: state as EpisodeState,
    creation_decision_uid,
    last_decision_uid,
    schema_id: "anima.episode/v1.0",
    projector_version: EPISODE_PROJECTOR_VERSION,
    assigned_window_uids,
    assigned_window_decision_uids: assigned_decision_uids,
    assigned_window_decision_revisions: assigned_revisions,
    decision_history: history as [EpisodeDecisionHistoryEntry, ...EpisodeDecisionHistoryEntry[]],
    ...(state === "suspended" ? { suspension_event_uid: raw.suspension_event_uid as string } : {}),
    ...(state === "stable_ended" ? { closure_kind, checkpoint_event_uid: raw.checkpoint_event_uid as string, ...(closure_kind === "work_validated" ? { validation_result_event_uid: raw.validation_result_event_uid as string, validation_event_uid: raw.validation_event_uid as string } : {}) } : {}),
  };
}

function createSnapshot(episode_uid: string, project_uid: string, episode_kind: EpisodeKind, windows: EpisodeWindowFact[], revision: number, decision_uid: string, target: TargetState, history: EpisodeDecisionHistoryEntry[], assignedDecisionUids: string[], assignedRevisions: number[]): EpisodeSnapshot {
  return {
    episode_uid,
    project_uid,
    episode_kind,
    first_window_uid: windows[0]!.window_uid,
    last_window_uid: windows[windows.length - 1]!.window_uid,
    window_count: windows.length,
    revision,
    state: target.state,
    creation_decision_uid: history[0]!.decision_uid,
    last_decision_uid: decision_uid,
    schema_id: "anima.episode/v1.0",
    projector_version: EPISODE_PROJECTOR_VERSION,
    assigned_window_uids: windows.map((window) => window.window_uid),
    assigned_window_decision_uids: assignedDecisionUids,
    assigned_window_decision_revisions: assignedRevisions,
    decision_history: history as [EpisodeDecisionHistoryEntry, ...EpisodeDecisionHistoryEntry[]],
    ...(target.state === "suspended" ? { suspension_event_uid: target.suspension_event_uid! } : {}),
    ...(target.state === "stable_ended" ? { closure_kind: target.closure_kind!, checkpoint_event_uid: target.checkpoint_event_uid!, ...(target.closure_kind === "work_validated" ? { validation_result_event_uid: target.validation_result_event_uid!, validation_event_uid: target.validation_event_uid! } : {}) } : {}),
  };
}

function evidenceLinks(episode_uid: string, target: TargetState, decision_uid: string, revision: number): EpisodeEvidenceLinkPlan[] {
  if (target.state === "suspended") return [{ episode_uid, event_uid: target.suspension_event_uid!, role: "suspension", decision_uid, decision_revision: revision }];
  if (target.state !== "stable_ended") return [];
  if (target.closure_kind === "personal_explicit") return [{ episode_uid, event_uid: target.checkpoint_event_uid!, role: "checkpoint", decision_uid, decision_revision: revision }];
  return [
    { episode_uid, event_uid: target.checkpoint_event_uid!, role: "checkpoint", decision_uid, decision_revision: revision },
    { episode_uid, event_uid: target.validation_result_event_uid!, role: "validation_result", decision_uid, decision_revision: revision },
    { episode_uid, event_uid: target.validation_event_uid!, role: "validation", decision_uid, decision_revision: revision },
  ];
}

export function projectEpisode(input: ProjectEpisodeInput): ProjectEpisodePlan {
  const normalized = validatePublicInput(input);
  const source = validateWindowSource(normalized.project_uid, normalized.episode_kind, normalized.windows, normalized.continuations);
  const target = validateClosureEvidence(normalized.closure, normalized.episode_kind, normalized.project_uid, source.windows);
  if (source.identityConflictMessage !== undefined) fail("identity_conflict", source.identityConflictMessage);
  const firstEpisodeUid = episodeUid(normalized.project_uid, source.windows[0]!.window_uid);
  const existing = normalized.existing_episode === undefined ? undefined : validateSnapshot(normalized.existing_episode, normalized.project_uid, normalized.episode_kind, source.windows);
  if (existing !== undefined) {
    for (let index = 0; index < source.windows.length; index += 1) {
      const assigned = source.windows[index]!.assigned_episode_uid;
      if (assigned === firstEpisodeUid && index >= existing.window_count) fail("identity_conflict", "Selected Window assignment exceeds the existing Episode prefix.");
    }
  } else if (source.windows.some((window) => window.assigned_episode_uid === firstEpisodeUid)) {
    fail("identity_conflict", "Selected Window is already assigned without its Episode snapshot.");
  }
  const materialWindowChange = existing === undefined || source.windows.length !== existing.window_count || source.windows.some((window, index) => window.window_uid !== existing.assigned_window_uids[index]);
  const materialStateChange = existing === undefined || !targetEqualsSnapshot(target, existing);
  if (existing?.state === "stable_ended" && (materialWindowChange || materialStateChange)) fail("invalid_transition", "Stable-ended Episodes are immutable.");
  if (existing?.state === "suspended" && materialWindowChange && source.windows.length > existing.window_count && source.windows[existing.window_count]!.session_uid === source.windows[existing.window_count - 1]!.session_uid) fail("invalid_transition", "Suspended Episodes resume only in a new continued Session.");
  const revision = existing === undefined ? 0 : (materialWindowChange || materialStateChange ? existing.revision + 1 : existing.revision);
  const decision_uid = decisionFor(firstEpisodeUid, normalized.episode_kind, revision, source.windows, target);
  if (existing !== undefined && !materialWindowChange && !materialStateChange) {
    if (decision_uid !== existing.last_decision_uid) fail("identity_conflict", "Exact replay decision does not match the existing Episode.");
    const after = cloneSnapshot(existing);
    return {
      decision_uid,
      episode: { action: "verify", before: cloneSnapshot(existing), after },
      new_window_assignments: [],
      new_evidence_links: [],
      result: { status: "duplicate", decision_uid, episode_uid: firstEpisodeUid, state: after.state, revision: after.revision, windows_assigned: 0, evidence_links_created: 0 },
    };
  }
  const currentEntry = historyEntryFromTarget(revision, decision_uid, source.windows.length, target);
  const history = existing === undefined ? [currentEntry] : [...existing.decision_history.map(cloneHistoryEntry), currentEntry];
  const assignedDecisionUids = existing === undefined ? source.windows.map(() => decision_uid) : [...existing.assigned_window_decision_uids, ...source.windows.slice(existing.window_count).map(() => decision_uid)];
  const assignedRevisions = existing === undefined ? source.windows.map(() => 0) : [...existing.assigned_window_decision_revisions, ...source.windows.slice(existing.window_count).map(() => revision)];
  const after = createSnapshot(firstEpisodeUid, normalized.project_uid, normalized.episode_kind, source.windows, revision, decision_uid, target, history, assignedDecisionUids, assignedRevisions);
  const new_window_assignments: EpisodeWindowAssignmentPlan[] = source.windows.slice(existing?.window_count ?? 0).map((window, index) => ({ window_uid: window.window_uid, episode_uid: firstEpisodeUid, position: (existing?.window_count ?? 0) + index, decision_uid, decision_revision: revision }));
  const candidateEvidenceLinks = evidenceLinks(firstEpisodeUid, target, decision_uid, revision);
  const new_evidence_links = existing?.state === "suspended" && target.state === "suspended" && existing.suspension_event_uid === target.suspension_event_uid ? [] : candidateEvidenceLinks;
  return {
    decision_uid,
    episode: { action: existing === undefined ? "create" : "update", ...(existing === undefined ? {} : { before: cloneSnapshot(existing) }), after },
    new_window_assignments,
    new_evidence_links,
    result: { status: "materialized", decision_uid, episode_uid: firstEpisodeUid, state: after.state, revision, windows_assigned: new_window_assignments.length, evidence_links_created: new_evidence_links.length },
  };
}
