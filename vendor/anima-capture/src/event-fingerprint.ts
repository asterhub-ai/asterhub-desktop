import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import type { CanonicalRawEvent, JsonValue } from "./canonical-types.ts";

export function eventFingerprint(event: CanonicalRawEvent | Omit<CanonicalRawEvent, "captured_at" | "ingest_sequence">): string {
  const withoutVolatile = { ...event } as unknown as Record<string, JsonValue>;
  delete withoutVolatile.captured_at;
  delete withoutVolatile.ingest_sequence;
  return createHash("sha256").update(canonicalize(withoutVolatile), "utf8").digest("hex");
}
