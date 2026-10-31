---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-31-anima-source-kind

English | [中文](2026-10-31-anima-source-kind.zh.md)

## Summary

Message sources gain the attribution-only source kind `anima`: the anima-memory plugin's module merge extends the shared MessageSourceMap with `{ kind: 'anima' } & ContextFormed`, so user/message, developer/message, and agent/inbox/spliced payloads, plus the session/title-llm-request message list, accept context and auxiliary messages attributed to Anima's local graph. The same merge surface brings the declared `automation` attribution kind (scheduled-run messages carrying taskId and runId) into the source union and its policy metadata. The title LLM request also returns to its upstream shape by dropping the optional reasoningEffort request property.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-31-anima-source-kind
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "a6356a740b4d37649a5236429a4826a72e46496243001e6a21950268d5cee1f9"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "6f41792aacad78083f8be42feb650eea0805a6fb42089c949a4a346359864e1b"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "92d9461519fa5319fe578f7cdad92f54f6ef80a46800761fba7874182a332999"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "1a87ff2aad896917e4af0da4462612c0798727fd1072bd3f81460e2665474042"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Added kinds only extend the closed source union; existing variants are unchanged. Readers following the session source attribution policy preserve unknown kinds (unknownKinds: preserve), so older readers keep anima and automation sources intact without interpreting them. The automation kind is declared in the source property's attributionKinds metadata; the anima kind is acknowledged through this compatibility review because a cross-package module merge cannot annotate the llm-side metadata. No event discriminator, required field, or Session format version changes; the title request loses only an optional property that upstream readers never required. This record changes no storage format; anima event bodies have already moved to the plugin:anima-memory/* channels.

<a id="verification"></a>
## Verification

verify-persistence-changes, verify-persistence-releases, and verify-persistence-formats pass on the tree containing this record. The full keyless recorded-session snapshot suite (189 tests) replays with no anima-shape difference; its remaining failures are the unregistered {{cwd}} prompt variable in scenario persona templates plus one retained-generation policy conflict left from the V5 fixture migration, both tracked as product-side adaptations outside this record. Triage also fixed fourteen borrower manifests that still pointed at renamed v5 session fixtures and one system-prompt expectation missing its trailing newline.

<a id="dev-note"></a>
## Dev Note

None.
