import { test, expect } from "vitest";
import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { canonicalize } from "json-canonicalize";
const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;

const protocolRoot = import.meta.dir.replace(/[\\/]tests$/, "");
const fixturesRoot = `${protocolRoot}/fixtures`;
const manifestPath = `${fixturesRoot}/manifest.json`;

type Expected = "valid" | "invalid";
type ManifestEntry = {
  path: string;
  schema: string;
  expected: Expected;
};
type Manifest = { fixtures: ManifestEntry[] };

async function readManifest(): Promise<Manifest> {
  const manifest = (await Bun.file(manifestPath).json()) as Manifest;
  expect(Array.isArray(manifest.fixtures)).toBe(true);
  return manifest;
}

function schemaPath(schemaName: string): string {
  return `${protocolRoot}/schemas/${schemaName}.schema.json`;
}

async function loadDeclaredSchema(schemaName: string): Promise<AnySchema> {
  const file = Bun.file(schemaPath(schemaName));
  expect(await file.exists()).toBe(true);
  return (await file.json()) as AnySchema;
}

function isCanonicalJsonString(value: unknown, fieldPath: string): boolean {
  const isProtocolJcsField =
    fieldPath === "/native_payload_json" ||
    /^\/content_parts\/\d+\/(?:value_json|payload_json)$/.test(fieldPath);
  if (typeof value === "string" && isProtocolJcsField) {
    try {
      return canonicalize(JSON.parse(value)) === value;
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) {
    return value.every((item, index) => isCanonicalJsonString(item, `${fieldPath}/${index}`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).every(([key, child]) =>
      key === "extensions" || isCanonicalJsonString(child, `${fieldPath}/${key}`),
    );
  }
  return true;
}

const invalidFixtureDefects: Record<string, (fixture: Record<string, any>) => boolean> = {
  "noncanonical-native-payload-json.json": (fixture) => {
    try {
      return typeof fixture.native_payload_json === "string" &&
        canonicalize(JSON.parse(fixture.native_payload_json)) !== fixture.native_payload_json;
    } catch {
      return false;
    }
  },
  "invalid-native-payload-json.json": (fixture) => {
    try {
      JSON.parse(fixture.native_payload_json);
      return false;
    } catch {
      return true;
    }
  },
  "full-fidelity-with-missing-fields.json": (fixture) =>
    fixture.fidelity?.completeness === "full" && Array.isArray(fixture.fidelity?.missing_fields) && fixture.fidelity.missing_fields.length > 0,
  "partial-fidelity-with-empty-missing-fields.json": (fixture) =>
    fixture.fidelity?.completeness === "partial" && Array.isArray(fixture.fidelity?.missing_fields) && fixture.fidelity.missing_fields.length === 0,
  "derived-correlation-missing-reason.json": (fixture) =>
    fixture.kind === "tool_result" && fixture.correlation?.method === "derived" && !("reason" in fixture.correlation),
  "missing-correlation-with-target.json": (fixture) =>
    fixture.kind === "tool_result" && fixture.correlation?.method === "missing" && "target_event_uid" in fixture.correlation,
  "source-correlation-missing-target.json": (fixture) =>
    fixture.kind === "tool_result" && fixture.correlation?.method === "source" && !("target_event_uid" in fixture.correlation),
  "message-with-tool-name.json": (fixture) => fixture.kind === "message" && "tool_name" in fixture,
  "missing-project-identity.json": (fixture) => !("project_uid" in fixture),
  "tool-call-with-outcome.json": (fixture) => fixture.kind === "tool_call" && "outcome" in fixture,
  "tool-name-missing-with-full-fidelity.json": (fixture) =>
    fixture.kind === "tool_call" && !("tool_name" in fixture) && fixture.fidelity?.completeness === "full",
  "missing-capabilities.json": (fixture) => !("capture_capabilities" in fixture),
  "missing-kind.json": (fixture) => !("kind" in fixture),
  "missing-profile-identity.json": (fixture) => !("profile_uid" in fixture.runtime_identity),
  "missing-native-payload.json": (fixture) => !("native_payload_json" in fixture),
  "missing-schema-id.json": (fixture) => !("schema_id" in fixture),
  "optional-null.json": (fixture) => fixture.source_timestamp === null,
};

async function fixturePaths(): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of new Bun.Glob("**/*.json").scan({ cwd: fixturesRoot, onlyFiles: true })) {
    if (path !== "manifest.json") paths.push(path.replaceAll("\\", "/"));
  }
  return paths.sort();
}

test("manifest registers every fixture JSON exactly once", async () => {
  const manifest = await readManifest();
  const registered = manifest.fixtures.map((entry) => entry.path);
  expect(new Set(registered).size).toBe(registered.length);
  expect([...registered].sort()).toEqual(await fixturePaths());
  for (const entry of manifest.fixtures) {
    expect(entry.schema).toBe("canonical-raw-event");
    expect(["valid", "invalid"]).toContain(entry.expected);
  }
});

test("declared CanonicalRawEvent schema validates every fixture", async () => {
  const manifest = await readManifest();
  const loadedFixtures = await Promise.all(
    manifest.fixtures.map(async (entry) => ({
      entry,
      fixture: await Bun.file(`${fixturesRoot}/${entry.path}`).json(),
    })),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const resourceNames = [
    "canonical-content-part",
    "runtime-identity",
    "capture-capabilities",
    "canonical-raw-event",
  ];
  const schemaIdByName: Record<string, string> = {
    "canonical-content-part": "urn:anima:schema:content-part:v1.0",
    "runtime-identity": "urn:anima:schema:runtime-identity:v1.0",
    "capture-capabilities": "urn:anima:schema:capture-capabilities:v1.0",
    "canonical-raw-event": "urn:anima:schema:raw-event:v1.0",
  };
  const resources = await Promise.all(resourceNames.map((name) => loadDeclaredSchema(name)));
  for (const resource of resources) ajv.addSchema(resource);
  const validators: Record<string, ValidateFunction | undefined> = {};
  const rawValidator = ajv.getSchema(schemaIdByName["canonical-raw-event"]);
  expect(rawValidator).toBeDefined();
  const validToolResult = loadedFixtures.find(
    ({ entry }) => entry.path === "valid/tool-result-success-source.json",
  );
  const validBoundary = loadedFixtures.find(
    ({ entry }) => entry.path === "valid/boundary-compact.json",
  );
  expect(validToolResult).toBeDefined();
  expect(validBoundary).toBeDefined();
  expect(rawValidator!({ ...validToolResult!.fixture, role: "assistant" })).toBe(false);
  expect(rawValidator!({ ...validBoundary!.fixture, role: "user" })).toBe(false);

  for (const { entry, fixture } of loadedFixtures) {
    let validate = validators[entry.schema];
    if (!validate) {
      expect(schemaIdByName[entry.schema]).toBeDefined();
      validate = ajv.getSchema(schemaIdByName[entry.schema]);
      expect(validate).toBeDefined();
      validators[entry.schema] = validate;
    }

    const accepted = validate!(fixture);
    const canonical = isCanonicalJsonString(fixture, "");
    if (entry.expected === "valid") {
      if (!accepted) throw new Error(`${entry.path}: ${JSON.stringify(validate!.errors)}`);
      expect(canonical).toBe(true);
    } else {
      const filename = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      const defect = invalidFixtureDefects[filename];
      expect(defect).toBeDefined();
      expect(defect!(fixture)).toBe(true);
      expect(accepted && canonical).toBe(false);
    }
  }
});
type DiscriminatorFixture = Record<string, unknown> & {
  capture_capabilities: Record<string, unknown>;
  source: Record<string, unknown>;
  content_parts: unknown[];
};

test("validates turn-end and user-origin discriminators", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const resourceNames = ["canonical-content-part", "runtime-identity", "capture-capabilities", "canonical-raw-event"];
  const schemaIdByName: Record<string, string> = {
    "canonical-content-part": "urn:anima:schema:content-part:v1.0",
    "runtime-identity": "urn:anima:schema:runtime-identity:v1.0",
    "capture-capabilities": "urn:anima:schema:capture-capabilities:v1.0",
    "canonical-raw-event": "urn:anima:schema:raw-event:v1.0",
  };
  for (const name of resourceNames) await ajv.addSchema(await loadDeclaredSchema(name));
  const validate = ajv.getSchema(schemaIdByName["canonical-raw-event"]);
  expect(validate).toBeDefined();

  const user = structuredClone(await Bun.file(`${fixturesRoot}/valid/user-message-source.json`).json()) as DiscriminatorFixture;
  user.capture_capabilities.user_message_origin = true;
  user.capture_capabilities.turn_end_event = true;
  user.message_origin = "external_user";
  expect(validate!(user)).toBe(true);
  expect(validate!({ ...user, message_origin: undefined })).toBe(false);
  expect(validate!({ ...user, message_origin: "runtime_synthetic" })).toBe(true);
  expect(validate!({ ...user, role: "assistant", message_origin: "external_user" })).toBe(false);

  const turn = structuredClone(await Bun.file(`${fixturesRoot}/valid/boundary-compact.json`).json()) as DiscriminatorFixture;
  turn.kind = "turn_end";
  turn.source = { ...turn.source, event_name: "turn_end" };
  turn.capture_capabilities.turn_end_event = true;
  turn.content_parts = [];
  delete turn.boundary_type;
  turn.turn_index = 3;
  turn.turn_end_status = "final_reply";
  expect(validate!(turn)).toBe(true);
  expect(validate!({ ...turn, turn_end_status: "cancelled" })).toBe(true);

  for (const bad of [
    { ...turn, turn_index: -1 },
    { ...turn, turn_index: 0.5 },
    { ...turn, turn_end_status: "unknown" },
    { ...turn, turn_end_status: undefined },
    { ...turn, content_parts: [{ schema_id: "anima.content-part/v1.0", type: "text", part_index: 0, text: "foreign" }] },
    { ...turn, role: "assistant" },
    { ...turn, capture_capabilities: { ...turn.capture_capabilities, turn_end_event: false } },
    { ...turn, source: { ...turn.source, event_name: "message" } },
  ]) {
    expect(validate!(bad)).toBe(false);
  }
  const { message_origin: _messageOrigin, ...legacyUser } = user;
  expect(validate!({ ...legacyUser, capture_capabilities: { ...user.capture_capabilities, user_message_origin: false } })).toBe(true);
  expect(validate!({ ...turn, capture_capabilities: { ...turn.capture_capabilities, turn_end_event: false } })).toBe(false);
});
