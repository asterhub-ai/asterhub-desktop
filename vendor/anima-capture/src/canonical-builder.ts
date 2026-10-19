import { canonicalize } from "json-canonicalize";
import { eventFingerprint } from "./event-fingerprint.ts";
import { eventIdentity, resolveIdentityContext } from "./identity.ts";
import type {
  CanonicalRawEvent,
  CanonicalRawEventDraft,
  CaptureCapabilities,
  CaptureSessionFacts,
  ResolvedSessionContext,
  RuntimeIdentity,
  SourceEventFacts,
} from "./canonical-types.ts";
import { validateCanonicalRawEvent, validateCaptureSessionFacts, validateSourceFacts } from "./protocol-validator.ts";

export interface CanonicalBuilderOptions {
  core_version: string;
  now?: () => string;
}

export class CanonicalBuilderError extends Error {
  readonly code: "invalid_source_facts" | "invalid_canonical_event";

  constructor(code: CanonicalBuilderError["code"], message: string) {
    super(message);
    this.name = "CanonicalBuilderError";
    this.code = code;
  }
}

export class CanonicalBuilder {
  private readonly coreVersion: string;
  private readonly now: () => string;
  private readonly implicitContexts = new WeakMap<CaptureSessionFacts, ResolvedSessionContext>();

  constructor(options: CanonicalBuilderOptions) {
    this.coreVersion = options.core_version;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Open one identity context; reuse its identities for every event in the session. */
  openSession(facts: CaptureSessionFacts): ResolvedSessionContext {
    const validation = validateCaptureSessionFacts(facts);
    if (!validation.ok) throw new CanonicalBuilderError("invalid_source_facts", validation.message ?? "invalid source facts");
    return resolveIdentityContext(facts);
  }

  resolveSession(facts: CaptureSessionFacts): ResolvedSessionContext {
    return this.openSession(facts);
  }

  private implicitSession(facts: CaptureSessionFacts): ResolvedSessionContext {
    const existing = this.implicitContexts.get(facts);
    if (existing !== undefined) return existing;
    const resolved = this.openSession(facts);
    this.implicitContexts.set(facts, resolved);
    return resolved;
  }

  build(facts: CaptureSessionFacts, source: SourceEventFacts, context?: ResolvedSessionContext): CanonicalRawEventDraft;
  build(context: ResolvedSessionContext, source: SourceEventFacts): CanonicalRawEventDraft;
  build(
    factsOrContext: CaptureSessionFacts | ResolvedSessionContext,
    source: SourceEventFacts,
    context?: ResolvedSessionContext,
  ): CanonicalRawEventDraft {
    const resolved = "facts" in factsOrContext ? factsOrContext : context ?? this.implicitSession(factsOrContext);
    const facts = resolved.facts;
    const sourceValidation = validateSourceFacts(facts as CaptureSessionFacts, source);
    if (!sourceValidation.ok) throw new CanonicalBuilderError("invalid_source_facts", sourceValidation.message ?? "invalid source facts");
    if (!this.coreVersion) throw new CanonicalBuilderError("invalid_source_facts", "core_version must be non-empty");

    const event = eventIdentity(facts, resolved.profile_uid, resolved.session_uid, source);
    const runtime: RuntimeIdentity = {
      schema_id: "anima.runtime-identity/v1.0",
      installation_uid: facts.installation_uid,
      runtime_family: facts.runtime.family,
      adapter_version: facts.runtime.adapter_version,
      core_version: this.coreVersion,
      profile_uid: resolved.profile_uid,
      profile_identity_method: resolved.profile.method,
      ...(facts.runtime.version === undefined ? {} : { runtime_version: facts.runtime.version }),
      ...(facts.profile.name === undefined ? {} : { profile_name: facts.profile.name }),
    };
    return {
      schema_id: "anima.raw-event/v1.0",
      event_uid: event.uid,
      event_identity_method: event.method,
      session_uid: resolved.session_uid,
      session_identity_method: resolved.session.method,
      project_uid: resolved.project_uid,
      project_identity_method: resolved.project.method,
      kind: source.kind,
      runtime_identity: runtime,
      capture_capabilities: structuredClone(facts.capture_capabilities) as CaptureCapabilities,
      source: structuredClone(source.source),
      captured_at: this.now(),
      content_parts: structuredClone(source.content_parts),
      fidelity: structuredClone(source.fidelity),
      native_payload_json: canonicalize(source.native_payload),
      ...(source.source_sequence === undefined ? {} : { source_sequence: source.source_sequence }),
      ...(source.source_timestamp === undefined ? {} : { source_timestamp: source.source_timestamp }),
      ...(source.role === undefined ? {} : { role: source.role }),
      ...(source.tool_name === undefined ? {} : { tool_name: source.tool_name }),
      ...(source.outcome === undefined ? {} : { outcome: source.outcome }),
      ...(source.correlation === undefined ? {} : { correlation: structuredClone(source.correlation) }),
      ...(source.boundary_type === undefined ? {} : { boundary_type: source.boundary_type }),
      ...(source.message_origin === undefined ? {} : { message_origin: source.message_origin }),
      ...(source.turn_index === undefined ? {} : { turn_index: source.turn_index }),
      ...(source.turn_end_status === undefined ? {} : { turn_end_status: source.turn_end_status }),
      ...(source.extensions === undefined ? {} : { extensions: structuredClone(source.extensions) }),
    };
  }

  finalize(draft: CanonicalRawEventDraft, ingestSequence: number): CanonicalRawEvent {
    if (!Number.isInteger(ingestSequence) || ingestSequence < 0) throw new CanonicalBuilderError("invalid_canonical_event", "ingest_sequence must be a non-negative integer");
    if (draft.correlation?.method === "source" && !("target_event_uid" in draft.correlation)) {
      throw new CanonicalBuilderError("invalid_canonical_event", "source correlation must be resolved by Writer");
    }
    const event = { ...draft, ingest_sequence: ingestSequence } as CanonicalRawEvent;
    const validation = validateCanonicalRawEvent(event);
    if (!validation.ok) throw new CanonicalBuilderError("invalid_canonical_event", validation.message ?? "invalid canonical event");
    return event;
  }

  fingerprint(event: CanonicalRawEvent): string {
    return eventFingerprint(event);
  }
}
