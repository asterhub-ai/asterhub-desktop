---
description: "Account-scoped native scheduled tasks with confirmed mutations, fresh Workspace Sessions, and bounded durable run history."
kind: "package-reference"
---

# @deepseek-ai/dsh-asterhub-automation

English | [中文](README.zh.md)

## Summary

Create scheduled work for a registered workspace and a model available to the current account. Each accepted occurrence creates a fresh Session with the saved instruction. The Host limits concurrency, execution time, task size, and retained history. Tasks require the AsterHub app to remain running and retain ordinary sensitive-operation approvals.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The desktop-native bundle mounts this service. Its typed `automation` Remote and the scoped `automation_manage` tool use the same account-authorized operations. Configure deployment limits on the service row: `maxConcurrent` defaults to 2 and `runTimeoutMs` to 1800000; retention, receipt, instruction, and task budgets are validated together in [Config](src/index.ts).

## Understand the implementation

Each task and its bounded run and request-receipt histories occupy one schedule storage-domain record. Preparation binds a mutation to the account, revision, digest, and expiring confirmation; commitment revalidates those facts in the shared management queue. The timer runtime reserves due work, creates a fresh Workspace Session, records terminal outcomes, and drains accepted executions during disposal. Account changes stop stale work and invalidate prepared operations.

## Further Exploration

- [Desktop task panel](../../client/ui-asterhub-automation/README.md)
- [Operation tests](tests/)
- [Authoring tool](src/tools.ts)

## Model Experience

### Scheduled task authoring and execution

#### What the model sees

Interactive root Agents receive `automation_manage`, whose [definition](src/tools.ts) validates action-specific task inputs and returns structured results. Every execution starts a fresh conversation with the saved, self-contained instruction and the selected current-account model.

#### Token effect

The tool schema adds fixed input tokens while registered; tool results enter the authoring conversation. Each scheduled execution makes an independent model request and consumes the account's ordinary model credits.

#### KV Cache effect

A scheduled execution does not append to the authoring Session. Its fresh Session has an independent request prefix; the selected preset and model adapters own provider cache reuse.

## Known Limitations and Deferred Work

- No operating-system wakeup or execution while the application is closed.
- Instructions must be self-contained; a fresh Session does not inherit the authoring conversation.
- Runs are bound to account and workspace availability; changing either can block execution.

### Dev Note

Keep state mutations in AutomationOperations and execution ownership in AutomationRuntime; the Client and tool share those owners.
