---
name: asterhub-rpc-dev
description: Coordinate long-running AsterHub development through independent named SDK sessions. Use for durable task handoffs, non-overlapping parallel slices, progress tracking, and exact runtime-state checks with the native SDK protocol.
---

# AsterHub RPC development

Use AsterHub's TypeScript SDK and its `dsh --profile sdk` runtime for independent agent sessions. The main session owns the goal, specification, file ownership, review, integration, and user communication. Each SDK session receives one bounded task and returns evidence before it stops. These are independent persistent Session logs, not task subagents.

Read [RPC control](references/rpc-control.md) for the supported SDK path and [session records](references/session-record.md) for durable handoffs.

## Choose the SDK path

Use this workflow when the user requests independent AsterHub sessions or the work has ready, non-overlapping slices. Keep a single session when work is small or tightly coupled. Do not launch model work until the user has authorized the model route and its expected use. Read the project instructions and current source before defining work.

The SDK profile owns its runtime configuration. Select an exact provider and model supported by the current profile, and use only a reasoning effort that the selected adapter supports. Do not silently substitute an unavailable route. The runtime handshake validates the route before accepting prompts.

## Prepare the batch

The main session records the goal, acceptance behavior, usage environment, authorized files and commands, selected runtime route, and any model-call limits. Confirm a per-batch maximum number of concurrent SDK sessions; the SDK does not choose a safe project-specific limit.

Inspect the repository before splitting work. Each slice names its behavior, dependencies, owned files, required evidence, validation boundary, and stop point. A slice must be independently reviewable and must not write files owned by another active session. Integrate and statically review a prerequisite before assigning its dependent slices.

Keep one project ledger outside the skill assets. Record session IDs, slice ownership, request outcome, settled state, source revision, and next action. Do not store credentials, private model configuration, or unnecessary transcript text.

## Run and settle each slice

Create a `DeepSeekHarness` for the selected profile and route, then call `harness.session(stableSessionId).run(prompt)`. Use a new opaque session ID for each independent development or review session. Reuse that handle for later slices only while the same runtime process remains alive and the same owner is responsible for it.

The high-level `run()` resolves after the queued prompt is observed and the whole agent reaches idle. Inspect the returned durable Session events and notifications, then verify that the requested files and acceptance evidence match the assigned slice. A returned `finalResponse` is the last committed assistant text in that activity interval; queued work may contribute to it, so it is not a per-prompt proof by itself.

If a request errors, aborts, times out, or loses its runtime, mark its result unknown until the durable log and working tree establish what happened. Do not replay a write request while its outcome or old writer is unknown. Keep the file ownership and block dependent work until the original writer is settled or its effects are reconciled.

## Review, integrate, and verify

Review the completed slice against its specification, callers, data flow, and evidence. Record static acceptance separately from functional verification. Static acceptance may unlock dependent slices; it does not show that the integrated workflow runs.

After all required slices are accepted and integrated, run the feature's complete smoke scenario through its real AsterHub entry point. Inspect actual outputs and durable events. Fix the affected slice and rerun only the paths changed by the fix. Apply deployment-specific hardening after the main behavior works, while preserving protections required for correctness, credentials, destructive actions, and the actual exposure environment.

## Continuity and limits

The SDK client can run repeatedly on a named session while its SDK runtime process is alive. The JSON-RPC protocol does not expose a session-resume operation after that process exits. A persisted Session log remains available to the configured session persistence and query surfaces, but it does not restore the SDK server's process-local agent handle. After runtime loss, inspect the durable log and project state, write a structured handoff, then start a new session ID. Label it as a new session, not an exact continuation. If the task requires reattaching the same SDK agent after restart, report that the current SDK protocol does not support it.

`DeepSeekHarness.close()` shuts down and reaps its runtime. Close only after all owned session runs are settled and the handoff is recorded. Do not claim that work continues after the runtime or main controller stops.
