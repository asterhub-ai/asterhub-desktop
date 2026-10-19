---
name: asterhub-rpc-cross-review
description: Coordinate AsterHub SDK development with a separate reviewer session and a user-selected, runtime-supported review model. Use when the user requires independent model review before integration or functional smoke verification.
---

# AsterHub RPC cross-review

Use AsterHub's TypeScript SDK and `dsh --profile sdk` runtime for development and reviewer sessions. The main session owns the specification, file ownership, dispatch, findings, integration, behavior verification, and communication with the user. This workflow requires a distinct reviewer session and an explicitly selected review model for each batch.

Read [RPC control](references/rpc-control.md) for SDK behavior and [review records](references/session-record.md) for batch and recovery state.

## Select the reviewer route

Before starting development or review calls for a batch, ask the user to choose the review provider and complete model ID. Confirm that the current SDK profile can initialize that route. Do not choose a default, infer it from the development route, silently substitute another model, or begin paid model calls while the choice or authorization is missing.

The reviewer model identity must differ from the main session and every model used by a development session in the batch. Compare the actual provider/model identities; a different provider alias, reasoning effort, or SDK process does not establish a different model. If aliases prevent confirming identity, ask the user to clarify the mapping or choose a verifiably distinct model. If the runtime rejects the chosen route, stop and ask the user to select another supported route.

Use a separate `DeepSeekHarness` initialized with the selected review route and a new SDK session ID. Development sessions use the route authorized for implementation. Record route identity and its confirmation source without storing credentials or private provider configuration.

## Prepare and run development

Read project instructions and source before defining work. Confirm the authorized runtime route and model-call scope, freeze acceptance behavior and public interfaces, and assign one exclusive owner to each writable file. Set a user-approved maximum number of concurrent sessions. Keep one batch ledger with session IDs, slice state, candidate revisions, review findings, and run evidence. Wait for each write request to settle before assigning a dependent slice or releasing its file ownership.

Send the reviewer a stable candidate revision or a complete snapshot of all relevant uncommitted files, specification, callers, configuration, and evidence. Do not send private credentials or unrelated conversation history. Keep the candidate unchanged during review. A changed candidate invalidates findings for affected files and contracts.

## Review gates

The reviewer session is read-only. Ask it to report located findings with the violated behavior or contract, severity for the current phase, evidence status, and a bounded correction suggestion. It must not edit product files, update the official ledger, assign work, authorize a model call, or decide integration or release.

Use these gates:

1. **Before implementation:** review feature boundaries, dependencies, interfaces, ownership, and the complete smoke scenario. Resolve blocking design gaps before dispatch.
2. **After each assigned slice:** statically review implementation, callers, data flow, required failure handling, and evidence. The main session applies fixes and records acceptance; review agreement alone does not accept a slice.
3. **After integration:** review the stable complete candidate and its combined data flow before the main session runs the feature-level smoke scenario.

Classify findings by the current stage. Functional defects, contract breaks, and protections required before running block acceptance. Deployment-specific hardening without an actual applicable exposure belongs in follow-up and does not expand the feature. The main session records each disposition with its evidence.

## Verify and recover

After required reviews are resolved, run the complete behavior scenario through the real AsterHub entry point and record the integrated revision and outputs. Static agreement between two models is not runtime evidence. Apply relevant hardening and rerun only affected paths before marking the feature verified.

The SDK can keep a named session across runs only while its runtime process remains alive. The protocol has no session-resume method after process exit. On runtime loss, inspect the durable log and working tree, save a structured handoff, and start a new session ID. Do not label a new session as an exact continuation. If exact SDK-agent continuation is required, report the protocol limitation.
