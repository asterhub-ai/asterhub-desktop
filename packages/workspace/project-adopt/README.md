---
description: "One-shot adoption of project-local Sessions into the Workspace registry when a project directory carrying .aster/sessions is registered on this machine."
kind: "package-reference"
---

# Project Adopt

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-project-adopt` rehomes the Sessions that physically live under a Workspace's `.aster/sessions` onto that Workspace's record. Adopting a project directory moved from another machine keeps its stored history, its attachment routing, and its replayed working directory, with no manifest and no background reconciliation loop.

<a id="toc-host-service"></a>
## Host service

Mount `ProjectAdoptService` (`ctx.projectAdopt`) after the Workspace registry and the project Session persistence; `static inject` declares both. The service listens on `domain/changed` and adopts a Workspace once per process when a `workspaces` record is written, so retitling or membership mutations never rescan it. Explicit callers invoke `adoptWorkspace(id)` and share the same memoized run; a failed run is retried by the next call.

<a id="toc-adoption-behavior"></a>
## Adoption behavior

A Workspace whose directory has no `.aster/sessions` resolves without work. Otherwise the service lists project Sessions through the persistence backend and keeps the ones no Workspace record accounts. Each kept Session first receives one appended `working-directory/change` event targeting the Workspace path, then enters the record through `workspaceRegistry.adoptSession`; the event precedes membership because `adoptSession` requires the caller to commit it first. The stored header is never rewritten — replaying the appended event restores the adopted directory on this machine, and a repeat adoption writes nothing.

A per-Session failure is logged with its session id and skipped, so one unreadable log cannot block the rest; the next adoption retries it. A scan-level failure rejects `adoptWorkspace`; the listening trigger logs that rejection because the domain writer must not wait on adoption.

<a id="toc-packaging-contract"></a>
## Packaging contract

The package exports the service (default), the pure `appendWorkingDirectoryEvent` helper from `./adopt-session`, and its source under `./src/*`. The package-local `tsdown.config.ts` emits both runtime entries during the Host build pass and nothing during the Client pass (`DSH_BUILD_FACE === 'client'`).

<a id="toc-verification"></a>
## Verification

Focused tests: `pnpm exec vitest run packages/workspace/project-adopt/tests/`.

## Model Experience

Indirectly: the appended `working-directory/change` event reaches the model through the working-directory projection and system prompt context after replay.

## Known Limitations and Deferred Work

- **Legacy flat layout fails the scan loudly** — a root whose `.aster/sessions` holds flat `.jsonl` artifacts makes the persistence listing reject with the unsupported-layout error, so such roots are not adopted; their disposition is a migration decision.
- No `./invariant` companion is published: the service owns no relation whose independent observations can diverge — membership is observable through the Workspace registry and the appended event through Session persistence.

<a id="toc-dev-note"></a>
### Dev Note

The `working-directory/change` payload is declared by `@deepseek-ai/dsh-working-directory`; the composition must mount that service for the replayed directory to take effect.
