---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-18-anima-session-v5

English | [中文](2026-10-18-anima-session-v5.zh.md)

## Summary

The Session writer moves to V5 so Anima context sources and auxiliary model requests are representable in durable logs.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-anima-session-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "154218efef7d7172f1776ef51b2f1e0abb5b37ab81d39b88ccf4c1943d3089cb"
    decision: version-bump
  - root: "event:anima/extraction-request"
    previous: null
    after: "472c3cbe882cda062b8d8384753afdc9776c12ddbecbd1c5ad2e1ec67256ac4f"
    decision: version-bump
  - root: "event:anima/extraction-result"
    previous: null
    after: "1d230e5ab1c3166ac98ed363a4978573833d32d6c1514ed02a90ec9c01164890"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "2bd3674d538cbecde1f57ee430654f5f8774d73699522684843a917e6a3a7c32"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "7058b469c9852d36b2d73915db1591bcabbed42de91b06fd153f8884099c23bf"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "7cfc9a6ad1ac6f26b3f224f6d465781cb3205aba45d5edf9242924392c9f599f"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

Existing V4 Session generations remain unchanged and readable through the adjacent V4-to-V5 migration. Older writers cannot open V5 sessions containing Anima source types or required request/result records. Reading a previous conversation does not create graph records; graph evidence starts when the upgraded Host captures it.

<a id="verification"></a>
## Verification

The V4-to-V5 migration preserves event sequences, payloads, compact assistant streams, and inherited-event cuts. Verify with the focused migration tests and test:snapshot after regeneration.

<a id="dev-note"></a>
## Dev Note

None.
