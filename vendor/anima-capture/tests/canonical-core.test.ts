import { describe, expect, test } from "vitest";
import { canonicalize } from "json-canonicalize";
import {
  CaptureSessionFacts,
  CanonicalBuilder,
  SourceEventFacts,
  eventFingerprint,
  profileIdentity,
  projectIdentity,
  sessionIdentity,
  eventIdentity,
  uuidV5FromParts,
  validateSourceFacts,
} from "../src/index.ts";

const capabilities = {
  schema_id: "anima.capture-capabilities/v1.0" as const,
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
};

const sessionFacts: CaptureSessionFacts = {
  installation_uid: "installation-1",
  runtime: { family: "omp", version: "1", adapter_version: "a1" },
  profile: { method: "source", source_id: "profile-1", name: "P" },
  project: { method: "source", normalized_identity: "repo:/x" },
  session: { method: "source", source_id: "session-1" },
  capture_capabilities: capabilities,
};

const message: SourceEventFacts = {
  kind: "message",
  source: { event_name: "message.created", event_id: "event-1", session_id: "session-1" },
  source_sequence: 3,
  source_timestamp: "2026-01-01T00:00:00.000Z",
  role: "user",
  message_origin: "external_user",
  content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "hello" }],
  fidelity: { completeness: "full", missing_fields: [] },
  native_payload: { text: "hello", n: 1 },
};

const ids = (facts = sessionFacts) => ({
  profile: profileIdentity(facts),
  project: projectIdentity(facts),
  session: sessionIdentity(facts, profileIdentity(facts).uid),
  event: eventIdentity(facts, profileIdentity(facts).uid, sessionIdentity(facts, profileIdentity(facts).uid).uid, message),
});

describe("R2B identity vectors", () => {
  test("uses JCS UUIDv5 and fixed profile/project/session/event namespaces", () => {
    expect(uuidV5FromParts(["anima.profile", "v1", "installation-1", "omp", "source", "profile-1"])).toBe(
      "80da13d7-8917-51f0-8344-27c195be1e99",
    );
    const first = ids();
    expect(first.profile).toEqual({
      uid: "80da13d7-8917-51f0-8344-27c195be1e99",
      method: "source",
      fingerprint: "b73cd54ae5899bfb51a07c7489c6de747a2b65284637c2656d051d715cc4d653",
    });
    expect(first.project).toEqual({
      uid: "ae8cd0a3-f65c-54fb-968f-1dd8c0dd156a",
      method: "source",
      fingerprint: "e8833e7e001a80d2b82e248c9bdbce1a7d60215d3dd90ca91ecd86a8509b5fa9",
    });
    expect(first.session).toEqual({
      uid: "4eb7d755-1fd3-5f55-814c-a23e6895af7d",
      method: "source",
      fingerprint: "ca2b3c8556c7bfccaf57d290320db52a8d4bdde893e678a2f612d1a8801bf13f",
    });
    expect(first.event).toEqual({
      uid: "cb7d3769-709a-5cd5-a07d-882a4c18f04a",
      method: "source",
      fingerprint: "0bb46a86827f03269b447652c80e0e2ebc84c65a67224831c307f18e2cbfa215",
    });
  });

  test("separates profile methods and entity namespaces", () => {
    const derived = profileIdentity({ ...sessionFacts, profile: { method: "derived", anchor: "profile-1" } });
    const anchored = profileIdentity({ ...sessionFacts, profile: { method: "generated", generated_anchor: "profile-1" } });
    expect(new Set([ids().profile.uid, derived.uid, anchored.uid]).size).toBe(3);
    expect(new Set([ids().profile.uid, ids().project.uid, ids().session.uid, ids().event.uid]).size).toBe(4);
  });

  test("merges project source and derived normalization but separates markers", () => {
    const source = projectIdentity(sessionFacts);
    const derived = projectIdentity({ ...sessionFacts, project: { method: "derived", normalized_identity: "repo:/x" } });
    const personal = projectIdentity({ ...sessionFacts, project: { method: "personal" } });
    const generated = projectIdentity({ ...sessionFacts, project: { method: "generated", generated_anchor: "repo:/x" } });
    expect(derived.uid).toBe(source.uid);
    expect(derived.fingerprint).toBe(source.fingerprint);
    expect(new Set([source.uid, personal.uid, generated.uid]).size).toBe(3);
  });
  test("supports caller-persisted unanchored generated profile identity", () => {
    const first = profileIdentity({ ...sessionFacts, profile: { method: "generated" } });
    const persisted = profileIdentity({ ...sessionFacts, profile: { method: "generated", generated_uid: first.uid } });
    const fresh = profileIdentity({ ...sessionFacts, profile: { method: "generated" } });
    expect(first.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(persisted.uid).toBe(first.uid);
    expect(persisted.fingerprint).toBe(first.fingerprint);
    expect(fresh.uid).not.toBe(first.uid);
  });
  test("validates generated profile UIDs and anchor exclusivity", () => {
    const validUid = "abcdef12-3456-4abc-89ab-cdef01234567";
    const invalidProfiles = [
      { method: "generated", generated_uid: "not-a-uuid" },
      { method: "generated", generated_uid: "00000000-0000-1000-8000-000000000000" },
      { method: "generated", generated_uid: validUid.toUpperCase() },
      { method: "generated", generated_anchor: "profile-anchor", generated_uid: validUid },
    ];
    for (const profile of invalidProfiles) {
      expect(validateSourceFacts({ ...sessionFacts, profile } as CaptureSessionFacts, message)).toMatchObject({
        ok: false,
        code: "invalid_source_facts",
      });
    }
    expect(
      validateSourceFacts(
        { ...sessionFacts, profile: { method: "generated", generated_anchor: "profile-anchor" } },
        message,
      ).ok,
    ).toBe(true);
    expect(validateSourceFacts({ ...sessionFacts, profile: { method: "generated", generated_uid: validUid } }, message).ok).toBe(true);
  });

  test("accepts empty JSON keys and shared values, while rejecting JSON cycles", () => {
    const emptyKeyPayload = { "": { value: true } };
    expect(validateSourceFacts(sessionFacts, { ...message, native_payload: emptyKeyPayload }).ok).toBe(true);

    const shared = { value: true };
    const nativePayload = { a: shared, b: shared };
    const sharedEvent = { ...message, native_payload: nativePayload };
    expect(validateSourceFacts(sessionFacts, sharedEvent).ok).toBe(true);
    const draft = new CanonicalBuilder({ core_version: "core-test" }).build(sessionFacts, sharedEvent);
    expect(draft.native_payload_json).toBe(canonicalize(nativePayload));

    const direct: Record<string, unknown> = {};
    direct.self = direct;
    expect(validateSourceFacts(sessionFacts, { ...message, native_payload: direct } as SourceEventFacts).ok).toBe(false);

    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    first.second = second;
    second.first = first;
    expect(validateSourceFacts(sessionFacts, { ...message, native_payload: first } as SourceEventFacts).ok).toBe(false);
  });


  test("does not use an unstable source event id for source identity", () => {
    const facts = { ...sessionFacts, capture_capabilities: { ...capabilities, stable_event_id: false } };
    const identity = eventIdentity(facts, profileIdentity(facts).uid, sessionIdentity(facts, profileIdentity(facts).uid).uid, message);
    expect(identity.method).toBe("derived");
  });

});
test("locks derived and anchored profile, session, and event vectors", () => {
  const derivedProfile = profileIdentity({ ...sessionFacts, profile: { method: "derived", anchor: "profile-anchor" } });
  expect(derivedProfile).toEqual({
    uid: "a3bfbd41-c0d6-515c-9cd0-68935dbefc80",
    method: "derived",
    fingerprint: "7e6aa695f5dd9fb18e566492f6717d0c2c12d40eb475ee84be6466834efd06d1",
  });
  const anchoredProfile = profileIdentity({ ...sessionFacts, profile: { method: "generated", generated_anchor: "profile-anchor" } });
  expect(anchoredProfile).toEqual({
    uid: "ba9c6b93-9183-5b95-a25b-804652a5428b",
    method: "generated",
    fingerprint: "15ab6d29b7c4a7a5f23c71cdba2692921c5a61f2a85cefa7df7f5ba04be14a5c",
  });

  const derivedSessionFacts = { ...sessionFacts, session: { method: "derived" as const, anchor: "session-anchor" } };
  const derivedSession = sessionIdentity(derivedSessionFacts, profileIdentity(derivedSessionFacts).uid);
  expect(derivedSession).toEqual({
    uid: "5302b936-551a-5524-847c-0de2b4bee48a",
    method: "derived",
    fingerprint: "79fb4d600520b906cc81c7443f0bc64534779eec038b2c1eb10c866d0652224f",
  });

  const derivedEventFacts = { ...derivedSessionFacts, capture_capabilities: { ...capabilities, stable_event_id: false } };
  const derivedEvent = eventIdentity(derivedEventFacts, profileIdentity(derivedEventFacts).uid, derivedSession.uid, message);
  expect(derivedEvent).toEqual({
    uid: "93b84b13-5c44-5323-800e-87a86c7007cb",
    method: "derived",
    fingerprint: "496a0595b8bd1f16697870888a2d256c8d70c15529d08c666086a80c0ccc54b4",
  });

  const generatedSessionFacts = { ...sessionFacts, session: { method: "generated" as const } };
  const generatedProfileUid = profileIdentity(generatedSessionFacts).uid;
  const generatedSessionA = sessionIdentity(generatedSessionFacts, generatedProfileUid);
  const generatedSessionB = sessionIdentity(generatedSessionFacts, generatedProfileUid);
  expect(generatedSessionA.method).toBe("generated");
  expect(generatedSessionA.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(generatedSessionB.uid).not.toBe(generatedSessionA.uid);

  const { source_sequence: _sourceSequence, ...eventWithoutSequence } = message;
  const generatedEvent = eventIdentity(
    { ...generatedSessionFacts, capture_capabilities: { ...capabilities, stable_event_id: false } },
    generatedProfileUid,
    generatedSessionA.uid,
    eventWithoutSequence,
  );
  expect(generatedEvent.method).toBe("generated");
  expect(generatedEvent.uid).toMatch(/^[0-9a-f-]{36}$/);
});

test("keeps project normalization independent of runtime and profile while separating markers", () => {
  const source = projectIdentity(sessionFacts);
  const sameProject = projectIdentity({
    ...sessionFacts,
    runtime: { family: "other-runtime", adapter_version: "a2" },
    profile: { method: "derived", anchor: "other-profile" },
    project: { method: "derived", normalized_identity: "repo:/x" },
  });
  const personal = projectIdentity({ ...sessionFacts, project: { method: "personal" } });
  const generated = projectIdentity({ ...sessionFacts, project: { method: "generated", generated_anchor: "repo:/x" } });
  expect(sameProject.uid).toBe(source.uid);
  expect(sameProject.fingerprint).toBe(source.fingerprint);
  expect(sameProject.method).toBe("derived");
  expect(personal.uid).not.toBe(source.uid);
  expect(generated.uid).not.toBe(source.uid);
  expect(generated.uid).not.toBe(personal.uid);
});

test("rejects undeclared session facts, capabilities, event facts, and canonical fields", () => {
  const cases: CaptureSessionFacts[] = [
    { ...sessionFacts, runtime: { ...sessionFacts.runtime, extra: true } } as CaptureSessionFacts,
    { ...sessionFacts, profile: ({ ...sessionFacts.profile, extra: true } as unknown) as CaptureSessionFacts["profile"] },
    { ...sessionFacts, project: ({ ...sessionFacts.project, extra: true } as unknown) as CaptureSessionFacts["project"] },
    { ...sessionFacts, session: ({ method: "generated", generated_anchor: "caller-must-not-supply" } as unknown) as CaptureSessionFacts["session"] },
    { ...sessionFacts, capture_capabilities: ({ ...capabilities, extra: true } as unknown) as CaptureSessionFacts["capture_capabilities"] },
  ];
  for (const facts of cases) {
    expect(validateSourceFacts(facts, message)).toMatchObject({ ok: false, code: "invalid_source_facts" });
  }
  const invalidEvent = { ...message, event_uid: "caller-canonical-id" } as SourceEventFacts;
  try {
    new CanonicalBuilder({ core_version: "core-test" }).build(sessionFacts, invalidEvent);
    throw new Error("expected invalid source facts");
  } catch (error) {
    expect(error).toMatchObject({ code: "invalid_source_facts" });
  }

  for (const field of ["event_uid", "ingest_sequence", "captured_at", "runtime_identity"]) {
    const event = { ...message, [field]: field } as SourceEventFacts;
    expect(validateSourceFacts(sessionFacts, event)).toMatchObject({ ok: false, code: "invalid_source_facts" });
  }
});


test("source facts enforce kind, capability, and user-message origin consistency", () => {
  const { message_origin: _messageOrigin, ...messageWithoutOrigin } = message;
  const bad = { ...messageWithoutOrigin, role: "developer" as const };
  expect(validateSourceFacts(sessionFacts, bad).ok).toBe(true);
  expect(validateSourceFacts({ ...sessionFacts, capture_capabilities: { ...capabilities, developer_messages: false } }, bad).ok).toBe(false);
  expect(validateSourceFacts({ ...sessionFacts, capture_capabilities: { ...capabilities, source_sequence: false } }, message).ok).toBe(false);
  expect(validateSourceFacts(sessionFacts, { ...message, message_origin: "runtime_synthetic" }).ok).toBe(true);
  expect(validateSourceFacts(sessionFacts, { ...message, message_origin: undefined }).ok).toBe(false);
  expect(validateSourceFacts({ ...sessionFacts, capture_capabilities: { ...capabilities, user_message_origin: false } }, messageWithoutOrigin).ok).toBe(true);
});

test("rejects empty or non-string installation UID source facts", () => {
  for (const installation_uid of ["", 42]) {
    const facts = { ...sessionFacts, installation_uid } as unknown as CaptureSessionFacts;
    expect(validateSourceFacts(facts, message)).toMatchObject({ ok: false, code: "invalid_source_facts" });
  }
});

test("requires non-empty tool names while allowing explicitly missing partial tool names", () => {
  const toolCall: SourceEventFacts = {
    kind: "tool_call",
    source: { event_name: "tool.call" },
    tool_name: "echo",
    extensions: { "anima.tool.source_call_id": "call-1" },
    content_parts: [],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: {},
  };
  const toolResult: SourceEventFacts = {
    kind: "tool_result",
    source: { event_name: "tool.result" },
    tool_name: "echo",
    outcome: "success",
    correlation: { method: "source", source_tool_call_id: "call-1" },
    content_parts: [],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: {},
  };

  for (const event of [toolCall, toolResult]) {
    for (const tool_name of ["", 7]) {
      expect(validateSourceFacts(sessionFacts, { ...event, tool_name } as unknown as SourceEventFacts)).toMatchObject({
        ok: false,
        code: "invalid_source_facts",
      });
    }
  }

  const partialToolCall = {
    ...toolCall,
    tool_name: undefined,
    extensions: undefined,
    fidelity: { completeness: "partial" as const, missing_fields: ["/tool_name", "/extensions/anima.tool.source_call_id"] },
  };
  const partialToolResult = {
    ...toolResult,
    tool_name: undefined,
    fidelity: { completeness: "partial" as const, missing_fields: ["/tool_name"] },
  };
  expect(validateSourceFacts(sessionFacts, partialToolCall)).toMatchObject({ ok: true });
  expect(validateSourceFacts(sessionFacts, partialToolResult)).toMatchObject({ ok: true });
});

test("builder creates canonical event and fingerprint excludes volatile fields", () => {
  const builder = new CanonicalBuilder({ core_version: "core-test", now: () => "2026-01-01T00:00:01.000Z" });
  const draft = builder.build(sessionFacts, message);
  const event = builder.finalize(draft, 0);
  expect(event.native_payload_json).toBe(canonicalize(message.native_payload));
  const a = eventFingerprint(event);
  const b = eventFingerprint({ ...event, captured_at: "2027-01-01T00:00:00.000Z", ingest_sequence: 9 });
  expect(a).toBe(b);
});
test("validates and round-trips cancelled turn-end facts without adding identity fields", () => {
  const turnEnd: SourceEventFacts = {
    kind: "turn_end",
    source: { event_name: "turn_end", event_id: "turn-end:response-1", session_id: "session-1" },
    turn_index: 4,
    turn_end_status: "cancelled",
    content_parts: [],
    fidelity: { completeness: "full", missing_fields: [] },
    extensions: { "anima.omp.finality_basis": "agent_end_aborted" },
    native_payload: { type: "turn_end", turnIndex: 4, message: { role: "assistant", stopReason: "aborted", responseId: "response-1" } },
  };
  expect(validateSourceFacts(sessionFacts, turnEnd)).toEqual({ ok: true });
  const builder = new CanonicalBuilder({ core_version: "core-test", now: () => "2026-01-01T00:00:01.000Z" });
  const event = builder.finalize(builder.build(sessionFacts, turnEnd), 0);
  expect(event.kind).toBe("turn_end");
  expect(event.turn_index).toBe(4);
  expect(event.turn_end_status).toBe("cancelled");
  expect(event.content_parts).toEqual([]);
  expect(event.native_payload_json).toBe(canonicalize(turnEnd.native_payload));
  expect(event.extensions).toEqual(turnEnd.extensions);
  expect(validateSourceFacts(sessionFacts, { ...turnEnd, turn_index: -1 } as SourceEventFacts).ok).toBe(false);
  expect(validateSourceFacts(sessionFacts, { ...turnEnd, role: "assistant" } as SourceEventFacts).ok).toBe(false);
  expect(validateSourceFacts({ ...sessionFacts, capture_capabilities: { ...capabilities, turn_end_event: false } }, turnEnd).ok).toBe(false);
  expect(validateSourceFacts(sessionFacts, { ...turnEnd, turn_end_status: "unknown" } as unknown as SourceEventFacts).ok).toBe(false);
  expect(
    validateSourceFacts(
      sessionFacts,
      { ...turnEnd, extensions: { "anima.omp.finality_basis": "unknown" } } as unknown as SourceEventFacts,
    ).ok,
  ).toBe(false);
});

test("builder preserves source correlation for Writer resolution", () => {
  const toolResult: SourceEventFacts = {
    kind: "tool_result",
    source: { event_name: "tool.result", session_id: "session-1" },
    outcome: "success",
    tool_name: "echo",
    correlation: { method: "source", source_tool_call_id: "call-1" },
    content_parts: [],
    fidelity: { completeness: "full", missing_fields: [] },
    native_payload: { ok: true },
  };
  const draft = new CanonicalBuilder({ core_version: "core-test" }).build(sessionFacts, toolResult);
  expect(draft.correlation).toEqual({ method: "source", source_tool_call_id: "call-1" });
  expect("target_event_uid" in (draft.correlation ?? {})).toBe(false);
});

test("resolves unanchored generated identities once and reopens with persisted profile UID", () => {
  const generatedFacts: CaptureSessionFacts = {
    ...sessionFacts,
    profile: { method: "generated" },
    project: { method: "generated" },
    session: { method: "generated" },
  };
  const builder = new CanonicalBuilder({ core_version: "core-test", now: () => "2026-01-01T00:00:01.000Z" });
  const opened = builder.openSession(generatedFacts);
  const firstDraft = builder.build(opened, message);
  const reopenedFacts: CaptureSessionFacts = {
    ...generatedFacts,
    profile: { method: "generated", generated_uid: opened.profile_uid },
  };
  const reopened = builder.openSession(reopenedFacts);
  const reopenedDraft = builder.build(reopened, message);
  const fresh = builder.openSession(generatedFacts);

  expect(opened.profile_uid).toBe(firstDraft.runtime_identity.profile_uid);
  expect(reopened.profile_uid).toBe(opened.profile_uid);
  expect(reopened.profile.fingerprint).toBe(opened.profile.fingerprint);
  expect(reopenedDraft.runtime_identity.profile_uid).toBe(opened.profile_uid);
  expect(fresh.profile_uid).not.toBe(opened.profile_uid);
  expect(builder.build(opened, { ...message, source: { ...message.source, event_id: "event-2" } }).project_uid).toBe(firstDraft.project_uid);
  const implicitFirst = builder.build(generatedFacts, message);
  const implicitSecond = builder.build(generatedFacts, { ...message, source: { ...message.source, event_id: "event-3" } });
  expect(implicitSecond.runtime_identity.profile_uid).toBe(implicitFirst.runtime_identity.profile_uid);
  expect(implicitSecond.project_uid).toBe(implicitFirst.project_uid);
  expect(implicitSecond.session_uid).toBe(implicitFirst.session_uid);
  expect(builder.build(opened, { ...message, source: { ...message.source, event_id: "event-2" } }).session_uid).toBe(firstDraft.session_uid);
});
