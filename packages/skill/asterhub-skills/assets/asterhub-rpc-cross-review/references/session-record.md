# Cross-review batch record

Keep one project/batch record outside skill assets. Store durable project progress separately from private operational evidence. Never record credentials, full private model configuration, or unredacted secrets from prompts and tool output.

## Batch and routes

```text
Project and feature:
Specification, candidate revision, and acceptance behavior:
Authorized files, tools, model calls, and concurrency:
Review provider/model selected by user:
Confirmation source and runtime initialization result:
Main and development model identities:
Reviewer identity difference: confirmed / unknown / same (stop)
Integrated status: developing / review pending / ready for smoke / needs correction / verified
```

## Reviews and slices

| Stage / slice | Candidate revision | Development session | Review session | Findings and disposition | State |
|---|---|---|---|---|---|
| `<stage or slice>` | `<commit or complete snapshot>` | `<session ID>` | `<session ID>` | `<located findings, evidence, main-session decision>` | `<pending/accepted/needs correction/unknown>` |

Keep findings attached to the candidate reviewed. Any affected source or contract change makes those findings stale. Record runtime smoke evidence separately from static review acceptance.

## Recovery

Record unsettled requests, exclusive file owners, possible side effects, durable event sequence numbers, and the precise next action. If an SDK runtime exits, inspect its persisted Session log and current project state before continuing. Start a new SDK session ID with the verified handoff; the current SDK protocol cannot reattach the old agent.
