# AsterHub Native Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship AsterHub's built-in scheduled-task execution and task panel, replacing the Desktop optional Schedule Bundle.

**Architecture:** One Host owner persists each task and its bounded run/receipt history as a single storage-domain record. A timer-driven runtime creates fresh Workspace Sessions through public Agent/preset APIs, with account-scoped cancellation and ordinary approval. A Client package uses typed automation Remote methods and registers a main panel directly below Plugins; Desktop alone includes the native composition.

**Tech Stack:** TypeScript, Cordis, Typert Remote, storage-domain, existing Schedule pure recurrence arithmetic, React/CSS Modules and current ui-primitives.

**Spec:** [Approved design](../specs/2026-10-05-asterhub-native-scheduler-design.md).

## Global Constraints

- Work in the current feature checkout and retain the uncommitted design; no automatic commits, pushes, publication, third-party credentials, or changes to customer data.
- Native installer capability, not curated; only Host-running execution; each occurrence creates a fresh Session; chat and GUI authoring share one service.
- Follow the complete spec, including account epoch isolation, confirmed execution revisions, durable bounded request receipts, no recurring overlap, pause clearing pending triggers, crash unknown outcomes, user-question handling, and Desktop-only cutover.
- Client UI reuses existing semantic tokens, controls, locale dictionaries and Plugins page layout; no second component library.
- Concurrent implementers own distinct files, skip all build/lint/tests/formatters, and return source-grounded implementation reports. Main integrates and runs focused validation once all mutations settle.
- Names, input/output types and runtime Host port are frozen in `packages/schedule/asterhub-automation/src/types.ts` and `runtime-contract.ts`; changes need integration-owner agreement, not silent local alternatives.

## Ownership and shared interfaces

| Task | Owned files | Consumers |
|---|---|---|
| Host management | new `packages/schedule/asterhub-automation/` except runtime/execution/timing files | Client, Runtime, Desktop |
| Runtime execution | `runtime.ts`, `execution.ts`, `timing.ts`, related focused tests; Schedule timing subpath export | Host management |
| Account isolation | `packages/account/account-sub2api/` account lifetime APIs and regression cases | Host/Runtime |
| Task panel | new `packages/client/ui-asterhub-automation/` and focused tests | Desktop composition |
| Desktop cutover | Desktop/desktop-host composition/packaging/quit/update paths and focused tests | installed app |
| Main integration | shared types, root alias/tsconfig references, lockfile/generators, cross-task fixes, verification, documentation | all |

### Task 1: Shared protocol and behavior probes

- [ ] Freeze browser-safe Task/Run/Draft/PreparedOperation/MutationResult/Choices types and runtime port.
- [ ] Observe the pre-feature sidebar/API absence with a focused smoke; retain regression cases only for meaningful account, timing, lifecycle and idempotency risks.
- [ ] Add proper workspace metadata and source aliases before the final build, with Host and Client compiler faces kept separate.

### Task 2: Durable task management and chat actions

**Files:** `packages/schedule/asterhub-automation/package.json`, `tsconfig.json`, `tsdown.config.ts`, `src/index.ts`, `types.ts`, `schema.ts`, `store.ts`, `operations.ts`, `tools.ts`, `client.ts`, focused tests.

**Interfaces:** Typed Remote namespace `automation`: preview, prepareOperation, commitOperation, list, get, runs, choices. Runtime receives `AutomationRuntimeHost`; model-facing `automation_manage` does not expose user confirmation tickets and cannot mutate from scheduled runs/descendants. Desktop reads inspectLifecycle and closes admission through service methods.

- [ ] Persist task aggregates in version-1 `asterhub-automation`; validate durable files, exclusive owner, record identity and complete timing/limits before service readiness.
- [ ] Implement account-scoped preview, confirmed create/edit, pause/resume, manual reservation, stop, remove and eligible purge, with expected revisions, separate authorization/rule versions and durable request receipts.
- [ ] Register one action-discriminated chat tool, user approval/confirmation inside the caller turn, and persisted task result presentation. Use the same management implementation as Client.
- [ ] Add deterministic tests for confirmation/account changes, history-independent idempotency, pause pending cleanup, limits, corrupt persistence and editing conflict. Main runs these at integration.

### Task 3: Fresh-session scheduling and recovery

**Files:** `packages/schedule/asterhub-automation/src/runtime-contract.ts`, `runtime.ts`, `execution.ts`, `timing.ts`, `tests/runtime.spec.ts`, `tests/timing.spec.ts`; `packages/schedule/schedule/package.json` timing export if needed.

**Interfaces:** `AutomationRuntime(host)`, requestDrive(), stopRun(runId), setAdmissionLocked(locked), dispose(); `reserveAutomationRun(task, trigger, occurrenceAt, requestId, now, runtimeId)` returns the next aggregate and reserved Run. Pure timing functions normalize/preview/resolve/reanchor six timing kinds and preserve IANA/DST/Vixie behavior.

- [ ] Keep one segmented timer; use domain management FIFO for reservation and global capacity; only latest missed recurring occurrence survives queue/backlog.
- [ ] Use the existing Webhook fresh-session pattern: resolve preset/acquire scope, create under fixed identity, mount setup, install model selection, attach Workspace and ordinary permission preset, then submit logged automation input.
- [ ] Register run-origin and descendant guards before initial publication; observe durable inbox receipt, turns, approval pairs, pending user-question projection, human intervention, errors and cancellation.
- [ ] Close input attribution, flush result evidence, await owned teardown, then persist terminal outcome; never treat idle/whenIdle as per-message completion. Stop/timeout/account switch cancel pending interactions and leave no late automatic continuation.
- [ ] Recover retained reservations/runs conservatively with their fixed Session identities; no automatic retry of uncertain side effects; retain watermark through pruning/manual requests.
- [ ] Add deterministic boundary/race cases with injected clock/barriers; no sleep-based readiness.

### Task 4: Account-safe execution

**Files:** `packages/account/account-sub2api/src/index.ts`, new account lifetime helper/types if needed, tests and owned README contracts.

**Interfaces:** Host-only `automationIdentity(): Promise<AutomationAccountIdentity | null>`; `assertAutomationIdentity(identity): void`; `registerAutomationLease(identity, stop: () => Promise<void>): () => void`; lifetime object `{accountId: string, epoch: number}`. Event `asterhub-account/changed` notifies identity changes without credentials. A lease registration is synchronous and rejects a stale epoch.

- [ ] Store current identity/epoch and announce initialized status without exposing credentials.
- [ ] Before any active token/user/model-key clear or replacement, advance epoch and block old acquisition, await all old scheduled-run cancellations and cleanup, then modify credentials and publish new identity.
- [ ] Cover login, register/finishLogin, logout, auto-login and server-invalidated session paths. Failure remains fail closed, never partly pairs old identity with new key.
- [ ] Scheduled scopes validate epoch before requests; their registered lease prevents key replacement until old execution drains. No long-lived global lock while waiting for human approval.
- [ ] Add meaningful deterministic switch-during-request, stale confirmation and failure-during-change cases; no new permissive fallback.

### Task 5: Task panel and direct forms

**Files:** new `packages/client/ui-asterhub-automation` Host entry, Client entry, page/form/detail, locales, CSS Modules, package metadata and focused component cases.

**Interfaces:** Import shared browser-safe types/client projection, mount `@deepseek-ai/dsh-asterhub-automation/remote`; consume frozen automation methods. Client performs prepare → explicit summary confirmation → commit; no confirmed boolean. Account/model/workspace choices come from Host choices, not hardcoded data.

- [ ] Register `sidebar.panellist` after Plugins and `main` keyed panel; main page navigation retains existing conversation draft, workspace and scroll.
- [ ] Render current-owner list/search/state filters, detail/config and history with links to real result Sessions; show errors without clearing known data.
- [ ] Implement new/edit form with name/instruction/timing/zone/workspace/model/reasoning selection, conditional mode fields and Host next-three preview; update conflict preserves draft.
- [ ] Implement pause/resume/run/stop/confirmed delete; app-level Toast survives navigation, deleted run/file data stays intact.
- [ ] Add keyboard/focus/unsaved-draft protections and adaptive/light-dark tokens; assess against actual Desktop surface at final integration.

### Task 6: Desktop built-in composition and cutover

**Files:** Desktop project-manager and runtime metadata, desktop-host profile entry/quit-inspection/update control/dependencies, any new Desktop-only bundle and patch, package preparation/scans, focused startup/upgrade cases.

**Interfaces:** Use real native Host/Client names and service `inspectLifecycle(): {armed: boolean; active: boolean}` plus admission locking. Main owns shared root configs/aliases; do not edit account or new Host/Client package implementation.

- [ ] Package and mount native Host/Client by default only for Desktop (including development runtime), never curated installation and never generic profile defaults.
- [ ] Reconcile only Desktop-owned old Schedule Bundle selection and write cutover marker; preserve other packages/data, reject explicit conflicting old service rows before any automatic dispatch.
- [ ] Query global native task state for quit warnings; update locks prevent new reservation, active runs drain before shutdown; cold original conversations are irrelevant to native tasks.
- [ ] Include required modules/Typert/client artifacts in actual dependency/materialization/resolver graphs, not just a visible button.
- [ ] Add upgrade/runtime qualification cases including retained plugins and interrupted cutover; do not claim downgrades transparently supported.

### Task 7: Integration, proof and delivery

- [ ] Generate workspace aliases, references, Typert and client artifacts; install lockfile changes using existing pnpm version; validate exact Host/Client programs.
- [ ] Run focused management/timing/runtime/account/Desktop regressions and meaningful keyless recorded-session scenario for chat creation/automated input.
- [ ] Launch actual Desktop program on isolated data/workspace; demonstrate entry below Plugins, manual create/detail/edit/delete, restart retention and each scheduled occurrence's fresh result Session. Record real screenshots; use a harmless real-model round only with the application's configured approved credentials.
- [ ] Verify installed/runtime payload closure; run only justified packaging checks, no unsigned stale artifact presented as a signed release.
- [ ] Perform independent review, address findings, update README/JSDoc/upgrade/persistence/user/handover docs only for implemented behavior, and remove our throwaway probes. No unrelated cleanup or preexisting-data deletion.
