import { createHash, randomUUID } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { v5 } from "uuid";
import type { CaptureSessionFacts, DeepReadonly, Identity, JsonValue, ReadonlyCaptureSessionFacts, ResolvedSessionContext, SourceEventFacts } from "./canonical-types.ts";

const URL_NAMESPACE = v5.URL;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

export function uuidV5FromParts(parts: JsonValue[]): string {
  return v5(canonicalize(parts), URL_NAMESPACE);
}

export function sha256Canonical(value: JsonValue): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function identity(parts: JsonValue[], method: Identity["method"], uid = uuidV5FromParts(parts)): Identity {
  return { uid, method, fingerprint: sha256Canonical(parts) };
}

export function profileIdentity(facts: ReadonlyCaptureSessionFacts): Identity {
  const profile = facts.profile;
  if (profile.method === "source") return identity(["anima.profile", "v1", facts.installation_uid, facts.runtime.family, "source", profile.source_id], "source");
  if (profile.method === "derived") return identity(["anima.profile", "v1", facts.installation_uid, facts.runtime.family, "derived", profile.anchor], "derived");
  if (profile.generated_anchor !== undefined) return identity(["anima.profile", "v1", facts.installation_uid, facts.runtime.family, "generated", profile.generated_anchor], "generated");
  // The generated UID is the final tuple value by contract, including when it was
  // freshly allocated while opening a session. Callers persist it for reopening.
  const uid = profile.generated_uid ?? randomUUID();
  return identity(["anima.profile", "v1", facts.installation_uid, facts.runtime.family, "generated", uid], "generated", uid);
}
export function projectIdentity(facts: ReadonlyCaptureSessionFacts): Identity {
  const project = facts.project;
  if (project.method === "personal") return identity(["anima.project", "v1", facts.installation_uid, "personal"], "derived");
  if (project.method === "source" || project.method === "derived") {
    return identity(["anima.project", "v1", facts.installation_uid, "normalized", project.normalized_identity], project.method);
  }
  if ("generated_anchor" in project && project.generated_anchor !== undefined) return identity(["anima.project", "v1", facts.installation_uid, "generated", project.generated_anchor], "generated");
  const uid = randomUUID();
  return identity(["anima.project", "v1", facts.installation_uid, "generated", uid], "generated", uid);
}

export function sessionIdentity(facts: ReadonlyCaptureSessionFacts, profileUid: string): Identity {
  const session = facts.session;
  if (session.method === "source") return identity(["anima.session", "v1", facts.installation_uid, facts.runtime.family, profileUid, "source", session.source_id], "source");
  if (session.method === "derived") return identity(["anima.session", "v1", facts.installation_uid, facts.runtime.family, profileUid, "derived", session.anchor], "derived");
  const uid = randomUUID();
  return identity(["anima.session", "v1", facts.installation_uid, facts.runtime.family, profileUid, "generated", uid], "generated", uid);
}
/** Resolve Profile, Project and Session exactly once for an opened CaptureSession. */
export function resolveIdentityContext(facts: CaptureSessionFacts): ResolvedSessionContext {
  const immutableFacts = deepFreeze(structuredClone(facts));
  const profile = profileIdentity(immutableFacts);
  const project = projectIdentity(immutableFacts);
  const session = sessionIdentity(immutableFacts, profile.uid);
  return deepFreeze({
    facts: immutableFacts,
    profile,
    project,
    session,
    profile_uid: profile.uid,
    project_uid: project.uid,
    session_uid: session.uid,
  });
}

/** Explicit alias used by callers that model the operation as opening a session. */
export const resolveSessionContext = resolveIdentityContext;

export function eventIdentity(facts: ReadonlyCaptureSessionFacts, profileUid: string, sessionUid: string, event: SourceEventFacts): Identity {
  const prefix = ["anima.event", "v1", facts.installation_uid, facts.runtime.family, profileUid, sessionUid] as JsonValue[];
  if (facts.capture_capabilities.stable_event_id && event.source.event_id !== undefined) {
    return identity([...prefix, "source", event.source.event_id], "source");
  }
  if (event.source_sequence !== undefined) {
    return identity([...prefix, "derived", event.source.event_name, event.source_sequence, sha256Canonical(event.native_payload)], "derived");
  }
  const uid = randomUUID();
  return identity([...prefix, "generated", uid], "generated", uid);
}
