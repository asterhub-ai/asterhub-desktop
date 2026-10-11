---
description: "Desktop task-management panel using the authenticated native automation Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-automation

English | [中文](README.zh.md)

## Summary

Open the task panel to create, inspect, pause, resume, run, stop, or delete native scheduled tasks. The panel displays Host-owned task state and run history for the current account. Prepared mutations use the Host-issued confirmation facts before they commit.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The desktop-native bundle mounts this panel and the automation Host together. The browser entry mounts the typed `automation` Remote and registers a keyed main panel and a sidebar entry. Text and controls use the package locale dictionaries.

## Understand the implementation

The Host owns task validation, account authorization, mutation receipts, and execution. The panel prepares each change, presents confirmation when required, then commits using the same request and confirmation IDs. Account and task notifications trigger fresh Host reads; browser state is not the durable task store.

## Further Exploration

- [Automation Host](../../schedule/asterhub-automation/README.md)
- [Desktop composition](../../bundle/asterhub-desktop-native/README.md)

## Model Experience

None, as this panel renders authenticated Host state and submits user commands without adding model context.

#### KV Cache effect

Opening, filtering, or confirming in the panel does not alter a model request prefix; the Host owns any Session created by an accepted run.

## Known Limitations and Deferred Work

- Requires the native automation Host; it does not execute tasks independently.
- Account changes invalidate prepared operations and require a new preparation.

### Dev Note

Keep task authority in the Host Remote and product text in the typed locale dictionaries.
