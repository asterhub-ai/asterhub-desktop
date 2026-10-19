import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { canonicalize } from "json-canonicalize";
import { reflectionUid } from "../src/reflection-ids.ts";
import { REFLECTION_NODE_KEYS } from "../src/reflection-neo4j-materializer.ts";
import { REFLECTION_EVIDENCE_SCHEMA_ID, REFLECTION_TARGET_SCHEMA_ID } from "../src/reflection-persistence-types.ts";
import { readScopedProjectReflections, ReflectionReadError } from "../src/reflection-read.ts";
import { REFLECTION_SCHEMA_ID } from "../src/reflection-types.ts";

const project_uid = "11111111-1111-4111-8111-111111111111";
const other_project_uid = "99999999-9999-4999-8999-999999999999";
const session_uid = "22222222-2222-4222-8222-222222222222";
const candidate_uid = "33333333-3333-4333-8333-333333333333";
const event_uid = "44444444-4444-4444-8444-444444444444";
const scope_fingerprint = "a".repeat(64);
const input_fingerprint = "b".repeat(64);
const output = { overview: { text: "最近认真核对了需求。", evidence: [{ candidate_uid, event_uid }] }, observations: [], open_questions: [] };
const response_fingerprint = createHash("sha256").update(canonicalize(output), "utf8").digest("hex");
const reflection_uid = reflectionUid("manual", scope_fingerprint, input_fingerprint, "v1", response_fingerprint);
const properties = {
  reflection_uid, schema_id: REFLECTION_SCHEMA_ID, reflection_version: "v1", kind: "manual", project_uid,
  scope_json: canonicalize({ kind: "candidate", candidate_uid }), scope_fingerprint, input_projection_version: "v1",
  input_fingerprint, reflection_contract_version: "v1", prompt_contract_version: "manual-reflection/v1",
  model_ref: "synthetic", response_fingerprint, overview_json: canonicalize(output.overview),
  observations_json: canonicalize(output.observations), open_questions_json: canonicalize(output.open_questions),
  created_at: "2026-09-23T12:00:00.000Z",
};

type Fields = Record<string, unknown>;
function row(fields: Fields) { return { get(key: string) { return fields[key]; } }; }
function fixture(override: { node?: Fields; candidateProject?: string; evidenceCount?: number } = {}) {
  const calls: string[] = [];
  return {
    calls,
    async run(query: string, params: Fields) {
      calls.push(query);
      if (query.includes("RETURN labels(r) AS labels")) return { records: [row({
        labels: ["Reflection"], keys: REFLECTION_NODE_KEYS, properties: override.node ?? properties,
      })] };
      if (query.includes("[link:REFLECTS_ON]")) return { records: [row({
        labels: ["ExecutionReviewCandidate"],
        candidate: { candidate_uid, session_uid, state: "ready", project_uid: override.candidateProject ?? project_uid },
        link: { schema_id: REFLECTION_TARGET_SCHEMA_ID },
      })] };
      if (query.includes("[link:EVIDENCED_BY]")) return { records: override.evidenceCount === 0 ? [] : [row({
        labels: ["RawEvent"], event: { event_uid, project_uid, session_uid },
        link: { schema_id: REFLECTION_EVIDENCE_SCHEMA_ID, subject_path: "overview", evidence_index: 0, candidate_position: 0 },
      })] };
      if (query.includes("count(edge)")) {
        expect(params).toEqual({ candidate_uid, event_uid });
        return { records: [row({ count: 1, positions: [0] })] };
      }
      throw new Error("Unexpected read query");
    },
  };
}

const input = { project_uid, limit: 5, now: "2026-09-24T00:00:00.000Z" };
const verifiedCandidate = async (uid: string) => {
  expect([candidate_uid, "55555555-5555-4555-8555-555555555555"]).toContain(uid);
  return { project_uid, session_uid, event_uids: new Set([event_uid, "66666666-6666-4666-8666-666666666666"]) };
};
describe("readScopedProjectReflections", () => {
  test("returns a project-scoped, evidence-linked overview without exposing raw events", async () => {
    const tx = fixture();
    await expect(readScopedProjectReflections(tx, input, verifiedCandidate)).resolves.toEqual([{
      reflection_uid, kind: "manual", created_at: properties.created_at, overview: output.overview.text,
    }]);
    expect(tx.calls).toHaveLength(4);
  });

  test("fails closed when a reflection targets another project or loses its evidence", async () => {
    await expect(readScopedProjectReflections(fixture({ candidateProject: other_project_uid }), input, verifiedCandidate))
      .rejects.toMatchObject({ code: "identity_conflict" });
    await expect(readScopedProjectReflections(fixture({ evidenceCount: 0 }), input, verifiedCandidate))
      .rejects.toBeInstanceOf(ReflectionReadError);
    await expect(readScopedProjectReflections(fixture({ node: { ...properties, overview_json: canonicalize({ ...output.overview, text: "伪造内容" }) } }), input, verifiedCandidate))
      .rejects.toMatchObject({ code: "identity_conflict" });
    await expect(readScopedProjectReflections(fixture(), input, async () => ({
      project_uid: other_project_uid, session_uid, event_uids: new Set([event_uid]),
    }))).rejects.toMatchObject({ code: "identity_conflict" });
    await expect(readScopedProjectReflections(fixture(), input, async () => ({
      project_uid, session_uid, event_uids: new Set<string>(),
    }))).rejects.toMatchObject({ code: "identity_conflict" });
  });

  test("reads a multi-candidate daily reflection regardless of relationship row order", async () => {
    const otherCandidate = "55555555-5555-4555-8555-555555555555";
    const otherEvent = "66666666-6666-4666-8666-666666666666";
    const daily = {
      overview: { text: "两次工作均有进展", evidence: [{ candidate_uid, event_uid }] },
      observations: [{
        observation_uid: "o1", kind: "theme", text: "两次核对记录",
        evidence: [{ candidate_uid: otherCandidate, event_uid: otherEvent }, { candidate_uid, event_uid }],
      }],
      open_questions: [],
    };
    const fingerprint = createHash("sha256").update(canonicalize(daily), "utf8").digest("hex");
    const uid = reflectionUid("daily", scope_fingerprint, input_fingerprint, "v1", fingerprint);
    const node = {
      ...properties, reflection_uid: uid, kind: "daily",
      scope_json: canonicalize({
        kind: "daily", project_uid, timezone: "Asia/Shanghai", period_key: "2026-09-23",
        start_at: "2026-09-22T16:00:00Z", end_at: "2026-09-23T16:00:00Z",
      }),
      response_fingerprint: fingerprint, overview_json: canonicalize(daily.overview),
      observations_json: canonicalize(daily.observations),
    };
    const tx = {
      async run(query: string, params: Fields) {
        if (query.includes("RETURN labels(r) AS labels")) return { records: [row({
          labels: ["Reflection"], keys: REFLECTION_NODE_KEYS, properties: node,
        })] };
        if (query.includes("[link:REFLECTS_ON]")) return { records: [
          row({ labels: ["ExecutionReviewCandidate"], candidate: { candidate_uid, session_uid, project_uid, state: "ready" }, link: { schema_id: REFLECTION_TARGET_SCHEMA_ID } }),
          row({ labels: ["ExecutionReviewCandidate"], candidate: { candidate_uid: otherCandidate, session_uid, project_uid, state: "ready" }, link: { schema_id: REFLECTION_TARGET_SCHEMA_ID } }),
        ] };
        if (query.includes("[link:EVIDENCED_BY]")) return { records: [
          row({ labels: ["RawEvent"], event: { event_uid, project_uid, session_uid }, link: { schema_id: REFLECTION_EVIDENCE_SCHEMA_ID, subject_path: "observations/o1", evidence_index: 1, candidate_position: 0 } }),
          row({ labels: ["RawEvent"], event: { event_uid: otherEvent, project_uid, session_uid }, link: { schema_id: REFLECTION_EVIDENCE_SCHEMA_ID, subject_path: "observations/o1", evidence_index: 0, candidate_position: 0 } }),
          row({ labels: ["RawEvent"], event: { event_uid, project_uid, session_uid }, link: { schema_id: REFLECTION_EVIDENCE_SCHEMA_ID, subject_path: "overview", evidence_index: 0, candidate_position: 0 } }),
        ] };
        if (query.includes("count(edge)")) {
          expect([candidate_uid, otherCandidate]).toContain(String(params.candidate_uid));
          return { records: [row({ count: 1, positions: [0] })] };
        }
        throw new Error("Unexpected read query");
      },
    };
    await expect(readScopedProjectReflections(tx, input, verifiedCandidate)).resolves.toEqual([{
      reflection_uid: uid, kind: "daily", created_at: node.created_at, overview: daily.overview.text,
    }]);
  });
  test("reads a persisted UTC-zoned reflection with more than 1024 valid evidence references", async () => {
    const eventUids = Array.from({ length: 33 }, (_, index) =>
      `66666666-6666-4666-8666-${index.toString(16).padStart(12, "0")}`);
    const refs = eventUids.map((uid) => ({ candidate_uid, event_uid: uid }));
    const many = {
      overview: { text: "多次会话中的变化", evidence: refs },
      observations: Array.from({ length: 31 }, (_, index) => ({
        observation_uid: `o${index + 1}`, kind: "theme", text: `核对结果 ${index}`, evidence: refs,
      })),
      open_questions: [],
    };
    const fingerprint = createHash("sha256").update(canonicalize(many), "utf8").digest("hex");
    const uid = reflectionUid("manual", scope_fingerprint, input_fingerprint, "v1", fingerprint);
    const node = {
      ...properties, reflection_uid: uid, response_fingerprint: fingerprint,
      created_at: "2026-09-23T12:00:00.000Z[UTC]",
      overview_json: canonicalize(many.overview), observations_json: canonicalize(many.observations),
    };
    const links = [
      ...many.overview.evidence.map((ref, index) => ({ path: "overview", index, event_uid: ref.event_uid })),
      ...many.observations.flatMap((observation) =>
        observation.evidence.map((ref, index) => ({
          path: `observations/${observation.observation_uid}`, index, event_uid: ref.event_uid,
        }))),
    ];
    const tx = {
      async run(query: string, params: Fields) {
        if (query.includes("RETURN labels(r) AS labels")) return { records: [row({ labels: ["Reflection"], keys: REFLECTION_NODE_KEYS, properties: node })] };
        if (query.includes("[link:REFLECTS_ON]")) return { records: [row({
          labels: ["ExecutionReviewCandidate"], candidate: { candidate_uid, session_uid, project_uid, state: "ready" },
          link: { schema_id: REFLECTION_TARGET_SCHEMA_ID },
        })] };
        if (query.includes("[link:EVIDENCED_BY]")) return { records: links.map((link) => row({
          labels: ["RawEvent"], event: { event_uid: link.event_uid, project_uid, session_uid },
          link: { schema_id: REFLECTION_EVIDENCE_SCHEMA_ID, subject_path: link.path,
            evidence_index: link.index, candidate_position: eventUids.indexOf(link.event_uid) },
        })) };
        if (query.includes("count(edge)")) return { records: [row({
          count: 1, positions: [eventUids.indexOf(String(params.event_uid))],
        })] };
        throw new Error("Unexpected read query");
      },
    };
    await expect(readScopedProjectReflections(tx, input, async () => ({
      project_uid, session_uid, event_uids: new Set(eventUids),
    }))).resolves.toEqual([{
      reflection_uid: uid, kind: "manual", created_at: "2026-09-23T12:00:00.000Z", overview: many.overview.text,
    }]);
  });

  test("rejects malformed limits and avoids graph access for an empty request", async () => {
    const tx = fixture();

    await expect(readScopedProjectReflections(tx, { ...input, limit: 0 }, verifiedCandidate)).resolves.toEqual([]);
    expect(tx.calls).toHaveLength(0);
    await expect(readScopedProjectReflections(tx, { ...input, limit: 6 }, verifiedCandidate)).rejects.toMatchObject({ code: "invalid_input" });
  });
});
