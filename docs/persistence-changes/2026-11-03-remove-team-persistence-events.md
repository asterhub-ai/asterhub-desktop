---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-03-remove-team-persistence-events

English | [中文](2026-11-03-remove-team-persistence-events.zh.md)

## Summary

Removes the Agent Teams persistence vocabulary from the declared session surface: the four persisted team event roots — team/member, team/message/delivered, team/message/queued, and team/task — leave the event types, and the `team-message` and `anima` variants are dropped from the message source unions of the user/message and developer/message payloads, the agent/inbox/spliced inserted messages, and the session/title-llm-request message list. This checkout removed the Agent Teams runtime entirely (`packages/experimental/{agent-team,agent-team-profile,client-ui-agent-team,tool-agent-team}`, `docs/upgrade-guide/v0.2.0-rc.3/agent-team-removal/guide.md`), and the session format regression migrated anima writes to plugin records, so the inherited upstream records documented event machinery and attribution kinds that no package in this repository declares, emits, or reads.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-remove-team-persistence-events
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-31-anima-source-kind"
    after: "61c15c18f868cfe4b9fa4b1d8e0f07e32d272762efac9ddd98697d13dca2f5ff"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-31-anima-source-kind"
    after: "89a9c91a51bad071178f478459160fc37650633a1bb188e2e2e0d5ffc4060048"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-31-anima-source-kind"
    after: "0aa83a4f3e666b002cce868e3a5c3eca9bbab66b3b3010553d65a9d8f9d065fc"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:team/message/delivered"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: null
    decision: same-version
  - root: "event:team/task"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-31-anima-source-kind"
    after: "8166aadcfc98432bb4458fbbd25ea230e46152a62507758ddf226a32e122820e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

No Session format version changes: SessionHeader, JsonlHeaderLine, and SessionEventEnvelope are outside this record's changes and their digests are unchanged, so container shapes are untouched. The envelope's declared shape does not enumerate event names, so retained sessions that still contain team events are not invalidated by any container change; their payloads are simply no longer part of the declared vocabulary. The source unions shed only the `team-message` and `anima` variants while the attribution policy metadata (unknownKinds: preserve) stays declared on the source properties, so sessions written before this change keep their team-message and anima attributions intact for readers that follow the preservation policy, and writers stop emitting both variants. No union gains a variant, so older readers face no new shapes.

<a id="verification"></a>
## Verification

verify-persistence-changes, verify-persistence-formats, verify-persistence-releases, gen-persistence-catalog --check, and gen-session-format-catalog --check pass on the tree containing this record, together with verify-doc-refs and the bilingual pairing check for this record.

<a id="dev-note"></a>
## Dev Note

The same maintenance pass re-aligned the committed change snapshots with the compacted upstream layout: inherited snapshots were taken verbatim from upstream, and the historical-formats directory drops the fork-only V4 writer artifacts because format version 4 is the current writer. The pre-regression fork records for native automation and canceled questions, anima session V5, and retained job audit events were removed together with the V5 regression and stay unreferenced; the job audit events are no longer persisted, so no successor record re-declares them.
