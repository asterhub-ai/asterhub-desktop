# Development session record

Keep one authoritative progress record for each project and work batch, in the repository's normal project documentation when that is appropriate. Store sensitive operational evidence only in an authorized private location. Do not copy credentials, full private model configuration, or raw conversations into a shared repository.

## Batch

```text
Project and goal:
Specification and acceptance behavior:
Usage environment and real side effects:
Authorized files, tools, model route, and call limits:
Maximum concurrent SDK sessions:
Current source revision and working-tree state:
Integrated behavior status: developing / ready for smoke / needs correction / verified
Functional smoke evidence:
Applicable hardening and follow-up:
```

## Slice table

| Slice | Dependencies | File ownership | Session ID | Request state | Review and evidence | Next action |
|---|---|---|---|---|---|---|
| `<id>` | `<ids or none>` | `<exclusive paths>` | `<opaque ID>` | `<running/completed/error/aborted/unknown; settled evidence>` | `<candidate revision, static findings, commands actually run>` | `<action>` |

Record static acceptance separately from smoke-test evidence. Keep a slice's ownership while a request is unsettled or its side effects remain unknown. Change a row when the candidate changes; old review conclusions then need a fresh review.

## Handoff

Before closing a runtime, record accepted and unaccepted slices, current source revision, active writers, request outcomes, relevant durable event sequence numbers, unresolved side effects, and the next authorized action. Preserve only evidence needed to resume the work. After runtime loss, inspect the persistent Session log and project state, then create a new SDK session with this handoff; the current protocol cannot resume the old live agent.
