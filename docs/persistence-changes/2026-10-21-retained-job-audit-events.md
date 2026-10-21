---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-21-retained-job-audit-events

English | [中文](2026-10-21-retained-job-audit-events.zh.md)

## Summary

Declares the retained job/registered and job/settled audit events in the persistence inventory.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-retained-job-audit-events
baseline: false
changes:
  - root: "event:job/registered"
    previous: null
    after: "ed42257f7796c6634687d9e2525b183fbeb5d6b1a97ef9c2f4dbe28e800c3add"
    decision: same-version
  - root: "event:job/settled"
    previous: null
    after: "ed6d64a44cda408cdfee606b8f6ac824ebd106b1868fd132154248919c7a617c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

These event names already occur in released Session artifacts. The declarations describe retained records, not new producers or a new writer format. Historical registration records may omit executionId; historical settlement records may omit executionId and terminationConfirmed and carry producerReported. The optional fields preserve those payloads without treating absent termination evidence as confirmation. No committed generation is rewritten or removed.

<a id="verification"></a>
## Verification

Nomad 5800 ran pnpm run test --maxWorkers=4: 1836 files passed, 23 files skipped; 38122 tests passed, one expected failure and 198 skipped. The preceding targeted run passed 65 files and skipped six, including the V4 migration and current persistence verification cases.

<a id="dev-note"></a>
## Dev Note

None.
