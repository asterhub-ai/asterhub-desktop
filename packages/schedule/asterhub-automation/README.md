---
description: "Account-scoped native scheduled tasks with confirmed mutations, dual-track dispatch (resumed authoring conversation or fresh Session), and bounded durable run history."
kind: "package-reference"
---

# @deepseek-ai/dsh-asterhub-automation

English | [中文](README.zh.md)

## Summary

Create scheduled work for a registered workspace and a model available to the current account. A task created by the agent tool is bound to its authoring conversation, and each accepted occurrence resumes that conversation and appends the run's turn there; a task created in the desktop form runs each occurrence in a fresh independent Session. The Host limits concurrency, execution time, task size, and retained history. Tasks require the AsterHub app to remain running and retain ordinary sensitive-operation approvals.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The desktop-native bundle mounts this service. Its typed `automation` Remote and the scoped `automation_manage` tool use the same account-authorized operations. Configure deployment limits on the service row: `maxConcurrent` defaults to 2 and `runTimeoutMs` to 1800000; retention, receipt, instruction, and task budgets are validated together in [Config](src/index.ts). Daily and weekly timing rules accept wall-clock `HH:mm:ss` with optional fractional seconds (`HH:mm:ss.SSS`).

The `./types` entry declares task data, tool results, and Cordis events for Host and Client imports without loading Host services.

## Understand the implementation

Each task and its bounded run and request-receipt histories occupy one schedule storage-domain record. Preparation binds a mutation to the account, revision, digest, and expiring confirmation; commitment revalidates those facts in the shared management queue. The timer runtime reserves due work and then dispatches by ownership: a task bound to an authoring conversation (recorded at tool creation; at most one undeleted task may bind a conversation) resumes that Session and appends the run's user turn there, while an unbound task mints a fresh Workspace Session. Every run record carries its Session id for later navigation. A bound dispatch fails the run with `origin_session_missing` when the authoring conversation no longer exists, and never falls back to a fresh Session. The runtime records terminal outcomes, flushes session state via the injected sessions service, and drains accepted executions during disposal. Account changes stop stale work and invalidate prepared operations.

## Further Exploration

- [Desktop task panel](../../client/ui-asterhub-automation/README.md)
- [Operation tests](tests/)
- [Authoring tool](src/tools.ts)

## Model Experience

### Scheduled task authoring and execution

#### What the model sees

Interactive root Agents receive `automation_manage`, whose [definition](src/tools.ts) validates action-specific task inputs and returns structured results. A task created through the tool is bound to the calling conversation: its executions resume that conversation and append the saved, self-contained instruction as a user turn, and a second binding for the same conversation is rejected with `session_already_bound`. GUI-created tasks start a fresh conversation per execution with the selected current-account model.

#### Token effect

The tool schema adds fixed input tokens while registered; tool results enter the authoring conversation. Each scheduled execution makes an independent model request and consumes the account's ordinary model credits.

#### KV Cache effect

Tool-created tasks append every run to the authoring Session, so each run's request prefix includes the conversation history up to that run. GUI-created tasks dispatch into fresh Sessions with independent request prefixes; the selected preset and model adapters own provider cache reuse.

## Known Limitations and Deferred Work

- No operating-system wakeup or execution while the application is closed.
- A bound task stops dispatching when its authoring conversation is gone: the run fails with `origin_session_missing` instead of silently switching to a fresh Session. A dispatch also fails loudly while another writer holds the conversation's write path (for example an Agent the Session controller keeps live for an open conversation).
- Instructions must be self-contained; GUI-created runs start a fresh Session and inherit nothing from the authoring conversation.
- Runs are bound to account and workspace availability; changing either can block execution.
- Later work: unread markers on the authoring conversation, run-history navigation in the desktop panel, and notification redesign.

### Dev Note

Keep state mutations in AutomationOperations and execution ownership in AutomationRuntime; the Client and tool share those owners.
