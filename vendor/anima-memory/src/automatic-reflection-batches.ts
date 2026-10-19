import { canonicalize } from "json-canonicalize";
import { buildAutomaticReflectionInput } from "./reflection-input-projector.ts";
import type { AutomaticReflectionInput } from "./reflection-input-types.ts";
import type { TaskDigest } from "./task-digest-types.ts";

export class AutomaticReflectionBatchSizeError extends Error {
  constructor(candidateUid: string, maxInputBytes: number) {
    super(`Automatic reflection digest ${candidateUid} exceeds the ${maxInputBytes}-byte input budget`);
    this.name = "AutomaticReflectionBatchSizeError";
  }
}

function canonicalBytes(value: unknown): number {
  return Buffer.byteLength(canonicalize(value as never), "utf8");
}

export function buildAutomaticReflectionBatches(
  input: AutomaticReflectionInput,
  max_input_bytes: number,
): readonly AutomaticReflectionInput[] {
  if (!Number.isSafeInteger(max_input_bytes) || max_input_bytes <= 0) {
    throw new RangeError("max_input_bytes must be a positive safe integer");
  }

  const { task_digests, ...header } = input;
  const emptyArrayBytes = canonicalBytes({ ...header, task_digests: [] });
  const digestBytes = task_digests.map((digest) => canonicalBytes(digest));
  const fullBytes = emptyArrayBytes +
    digestBytes.reduce((total, bytes) => total + bytes, 0) +
    Math.max(0, task_digests.length - 1);
  const softBudget = Math.min(max_input_bytes, 65_536);
  if (fullBytes <= softBudget) return [input];

  const groups: TaskDigest[][] = [];
  let group: TaskDigest[] = [];
  let groupBytes = emptyArrayBytes;

  for (let index = 0; index < task_digests.length; index += 1) {
    const digest = task_digests[index]!;
    const bytes = digestBytes[index]!;
    const singleBytes = emptyArrayBytes + bytes;
    if (singleBytes > max_input_bytes) {
      throw new AutomaticReflectionBatchSizeError(digest.candidate_uid, max_input_bytes);
    }
    if (singleBytes > softBudget) {
      if (group.length > 0) {
        groups.push(group);
        group = [];
        groupBytes = emptyArrayBytes;
      }
      groups.push([digest]);
      continue;
    }

    const candidateBytes = groupBytes + bytes + (group.length > 0 ? 1 : 0);
    if (candidateBytes > softBudget) {
      groups.push(group);
      group = [];
      groupBytes = emptyArrayBytes;
    }
    group.push(digest);
    groupBytes += bytes + (group.length > 1 ? 1 : 0);
  }
  if (group.length > 0) groups.push(group);

  return groups.map((digests) => {
    const batch = buildAutomaticReflectionInput(input.selector, digests);
    const actualBytes = canonicalBytes(batch);
    if (actualBytes > max_input_bytes) {
      const candidateUid = batch.task_digests[0]!.candidate_uid;
      throw new AutomaticReflectionBatchSizeError(candidateUid, max_input_bytes);
    }
    return batch;
  });
}
