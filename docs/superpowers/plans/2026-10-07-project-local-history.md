# Project-local History Implementation Plan

English | [中文](2026-10-07-project-local-history.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Implement the bounded tasks below; integration, verification, and review remain explicit gates.

**Goal:** Make each AsterHub project's original conversations and attachments portable in `.aster`, discoverable with confirmation on another installation, resumable at the new directory, and excluded from Git, while moving default account/machine data to `.asterhub` without losing legacy data.

**Architecture:** A project-storage service owns validated portable metadata and a machine-local locator index independently of WorkspaceRegistry and SessionPersistence. A project-routed persistence provider reuses isolated JSONL backends; project-scoped attachments and one execution-directory resolver connect existing consumers without rewriting committed history. Workspace and picker integration provide discovery, confirmation, explicit relocation, legacy adoption, and read-only/offline states.

**Tech Stack:** Cordis, TypeScript ESM, existing JSONL/Zstandard SessionPersistence, content-addressed attachment storage, atomic-write helpers, typed Remote services, React/localized primitives, Vitest, shipped dsh profiles, Electron.

**Spec:** [Approved portable project storage design](../specs/2026-10-07-project-local-history-design.md)

## Summary

The isolated branch is `feature/project-local-history` in `C:/开发目录/AsterHub-reference/.worktrees/project-local-history`, based on the stable `codex/dsh-02-upgrade` branch. The browser branch and plugin-repair worktree remain untouched. Current remote integration head is named `master`; no rename, merge, push, or publication occurs automatically.

## Table of Contents

- [Global constraints](#global-constraints)
- [Goal request](#goal-request)
- [Interfaces and file ownership](#interfaces-and-file-ownership)
- [Task execution](#task-execution)
- [Verification and integration](#verification-and-integration)

<a id="global-constraints"></a>

## Global constraints

- Default global user data directory: `.asterhub`; project-owned data directory: `.aster`.
- Project history and original attachments travel with the project. Credentials, plugins, model configuration, shared models, and machine caches do not.
- No SessionId, parent/child ID, event sequence, inherited cut, or committed generation is rewritten to simulate relocation. Released historical codec generations are not moved, overwritten, or deleted.
- Project metadata is validated data only. Selecting a directory never executes its metadata, imports credentials/plugins, or reruns historical tool calls.
- Filesystem operations, shells, search, terminal/PTC/SSH cwd, sandbox roots, instructions, forks, and subagents use the verified current project directory. Model-visible current cwd must be reconstructable from the existing Session log mechanisms.
- Keep explicit configured homes and nonblank `DSH_HOME` authoritative. Internal dsh CLI/package names are out of scope; only product storage defaults/display change.
- Keep legacy source data until staged copying, content/relationship verification, and publication complete. Do not automatically delete or merge competing global homes, active project copies, or shared legacy attachments.
- Missing/offline/read-only portable projects never silently redirect writes into a global directory or process cwd.
- `.aster/` must be ignored by Git before project data is created. Preserve existing ignore-file content; do not auto-commit it or silently untrack already-tracked data.
- All validation uses owned temporary roots/fixtures. Do not migrate, inspect, or delete actual user credentials/history while developing.
- Reuse existing Cordis effects, branded IDs, locale dictionaries, and file/metadata validation. No any/unknown double-casts, shims, fake fallbacks, unimplemented stubs, or duplicate writable histories.
- Child agents skip builds, linters, tests, and formatters while editing; Main runs focused validation after each completed wave. A child may submit tests before implementation for a Main-owned failing-before check.
- No child subagents, shared Git staging/commits, merge, push, or publish. Main is the integration/commit owner; source corrections receive review.

<a id="goal-request"></a>

## Goal request

```text
/goal Implement the approved AsterHub project-local history plan on feature/project-local-history: use ~/.asterhub for global account/machine data; keep project identity, immutable Session history and original attachments in project/.aster; discover and confirm copied projects from the directory picker; resume the same conversations and execute only in the new project directory; migrate legacy data without deleting or corrupting sources; exclude .aster from Git; complete behavior, portability, UI and packaged-runtime verification; leave the verified branch ready for later integration without merging, pushing or publishing.
```

The goal text is the requested objective, not evidence that native OMP goal mode was activated. Use the current session's native Goal control if available; never start a second OMP session or patch runtime internals to imitate activation. The plan, todo, and isolated execution ledger preserve progress if that control is unavailable.

<a id="interfaces-and-file-ownership"></a>

## Interfaces and file ownership

The new package is `packages/workspace/project-storage`, named `@deepseek-ai/dsh-project-storage`. Its `/types` leaf is browser-safe and does not import Host Context declarations. Task 2 owns its metadata, Git, and locator implementation; Task 3 owns its project persistence provider; Task 4 owns current-directory integration; Task 5 owns its attachment routing adapter; Task 7 owns final profile wiring. Do not edit another owner's files without Main's ruling.

```text
ProjectId = Branded<"ProjectId">
ProjectBindingRevision = Branded<"ProjectBindingRevision">
ProjectSessionRecord = { id: SessionId, relativeCwd: string }
PortableProjectManifest = {
  schemaVersion: 1, id: ProjectId, title: string, createdAt: number,
  sessions: readonly ProjectSessionRecord[], sessionOrder: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[], archivedSessionIds: readonly SessionId[]
}
ProjectBinding = { id: ProjectId, root: string, revision: ProjectBindingRevision }
ProjectInspection =
  { kind: "new", root: string } |
  { kind: "existing", root: string, manifest: PortableProjectManifest, digest: string } |
  { kind: "registered", binding: ProjectBinding, manifest: PortableProjectManifest, digest: string } |
  { kind: "legacy", root: string, proposal: LegacyProjectProposal, digest: string }
ProjectSessionLocation = {
  projectId: ProjectId, projectRoot: string, relativeCwd: string,
  sessionsRoot: string, attachmentsRoot: string, bindingRevision: ProjectBindingRevision
}
LegacyProjectProposal = {
  projectId: ProjectId, title: string, sourceRoot: string,
  sessions: readonly ProjectSessionRecord[], sessionOrder: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[], archivedSessionIds: readonly SessionId[]
}
OpenProjectRequest = { root: string, mode: "new" | "existing" | "legacy", expectedId?: ProjectId, expectedDigest?: string }
ProjectStorage.inspect(root, signal?): Promise<ProjectInspection>
ProjectStorage.open(request, signal?): Promise<ProjectBinding>
ProjectStorage.list(): readonly ProjectBinding[]
ProjectStorage.status(id, signal?): Promise<"available" | "missing" | "read-only">
ProjectStorage.manifest(id): PortableProjectManifest
ProjectStorage.bindSession(header, signal?): Promise<ProjectSessionLocation>
ProjectStorage.locateSession(id): ProjectSessionLocation | undefined
ProjectStorage.executionCwd(header): string | undefined
ProjectStorage.reorderSessions(id, orderedIds): Promise<void>
ProjectStorage.setSessionArchived(id, sessionId, archived): Promise<void>
ProjectStorage.setSessionPinned(id, sessionId, pinned): Promise<void>
ProjectStorage.rename(id, title): Promise<void>
ProjectStorage.unregister(id): Promise<void>
ProjectStorage.registerLegacySource(provider): () => void
LegacySourceProvider.inspect(root, signal?): Promise<LegacyProjectProposal | undefined>
ProjectLegacyAdopter = (proposal: LegacyProjectProposal, root: string, signal?: AbortSignal) => Promise<PortableProjectManifest>
ProjectStorage.registerLegacyAdopter(adopter): () => void
ProjectStorage.changed: effect-owned notification after durable changes
prepareAsterHubHome({ userHome, configuredHome?, env?, signal? }): Promise<{ home: string, migration: "none" | "copied" | "explicit" }>
ensureProjectGitExclusion(root, signal?): Promise<{ kind: "not-git" | "ignored" | "tracked-data", trackedPaths: readonly string[] }>
ProjectAttachmentScope = { projectId: ProjectId, sessionId: SessionId }
resolveProjectAttachmentScope(ctx, sessionId): ProjectAttachmentScope
```

`ProjectStorage.Config` has an explicit `sessionMode: "grouped" | "project-local"`, global locator location, legacy Session root, metadata byte limit, and lock deadline. Product profiles select `project-local`; grouped non-product profiles retain the existing explicitly configured backend and historical-cwd semantics. In project-local mode, unknown ownership and unavailable roots are failures, not mode switches. Canonical paths are locations, not opaque IDs; imported IDs and relative paths are validated at the file/Remote boundary.

<a id="task-execution"></a>

## Task execution

### Task 1: Branded global home and safe default migration

**Files:** Modify `packages/util/home-paths/src/index.ts` and its owning tests/README pair. Create `packages/boot/app-boot/src/home-migration.ts` and `packages/boot/app-boot/tests/home-migration.spec.ts`; export the helper from app-boot. Task 7 wires startup in `apps/cli/src/profile-boot.ts` and `apps/desktop/src/main.ts`; do not touch those entrypoints in this task. Audit direct `.dsh` product-default literals, distinguishing build/signing scratch paths from user data.

**Produces:** `prepareAsterHubHome` and the `.asterhub` default/display. No project-storage dependency and no side effects in `resolveDshHome`.

- [ ] Add scenarios for old-only home, new-only home, repeat startup after completed copy, two populated roots, interrupted staging, source mutation, explicit override, and internal/external symlinks. Use temporary roots only.
- [ ] Have Main run the new focused tests before implementation; expected failures identify missing migration or old default behavior rather than mock forwarding.
- [ ] Implement the state transitions below using existing atomic-write locking, private sibling staging, tree/content verification, and an idempotent completion record. Preserve source files. Translate only owned internal symlink targets when relocation requires it; do not rewrite opaque configuration/session text.

```text
if configuredHome or nonblank env.DSH_HOME: return explicit resolved home
if completed destination record is valid: return destination without recopying source
if destination contains independent data and source contains data: throw HomeMigrationConflictError
if source has no data: return destination
claim migration ownership outside both trees
copy to a private sibling staging directory
verify file inventory/content and source stability; refuse live-writer/link hazards
publish destination only if its precondition still holds
record complete migration; return destination
on any failure: preserve source and report staging/recovery paths
```

- [ ] Update the helper's consumer contract and return a report with touched paths and focused test commands; Main validates and reviews the completed slice.

### Task 2: Portable project metadata, locator index, and Git exclusion

**Files:** Create `packages/workspace/project-storage/{package.json,tsconfig.json,src/{index.ts,types.ts,manifest.ts,registry.ts,git-exclusion.ts},tests/{manifest.spec.ts,registry.spec.ts,git-exclusion.spec.ts},README.md,README.zh.md}`. Task 2 owns initial package exports/project references and hands exact wiring changes to Main; do not change profile composition yet. Main adds `.aster/` to the AsterHub repository ignore file.

**Consumes:** Prepared global home. **Produces:** The ProjectStorage contract above and `ensureProjectGitExclusion`; no dependency on WorkspaceRegistry or SessionPersistence initialization.

- [ ] Write behavioral tests for new/existing inspection without writes, invalid/newer metadata, stale confirmation digest, idempotent open, two roots claiming one ID, missing/read-only roots, Session ownership conflicts, relative-directory traversal, and unregister preserving local files.
- [ ] Write real Git fixtures covering root/nested repositories, linked worktrees, existing CRLF ignore content, Git initialized after the project, git add -A, and already-tracked `.aster` data. Do not use git rm --cached.
- [ ] Implement strict JSON parsing/encoding, manifest/content digests, serialized durable mutations, source-of-truth rules, and a locator-only machine index. Reject symlinked/escaping owned data roots rather than writing outside the chosen project.

```text
inspect = canonical directory + bounded validated project.json + registration comparison
open(new) = ensure Git exclusion; atomically publish complete empty manifest; register locator
open(existing/legacy) = revalidate ID/digest; require confirmation; verify owned data; register locator
same ID + same root = return existing binding unchanged
same ID + different active/existing root = explicit conflict; no silent replacement
relative cwd = validated project-relative path; current cwd = binding.root + relative cwd
unregister = remove locator only; keep .aster unchanged
```

- [ ] Ensure title/order/pin/archive mutations are project-owned and publish changed notifications only after durability. Finish package JSDoc and owning README contracts; Main runs the focused tests and reviews the slice.

### Task 3: Project-routed immutable Session persistence and legacy adoption

**Files:** Create `packages/workspace/project-storage/src/persistence.ts`, `/persistence` export, and `tests/project-persistence.spec.ts`. Modify JSONL helpers only where current-reader portability/verification actually requires it; preserve released historical codec files. Add owned legacy adoption logic in `src/legacy-sessions.ts` and tests. No Workspace/UI/tool edits.

**Consumes:** ProjectStorage registration, Session locations, binding revisions, and confirmation proposal. **Produces:** A full SessionPersistence provider, not only a path helper, with create/open/stat/list/flush and exact existing handle semantics.

- [ ] Add regressions for original bytes/IDs/inherited cuts retained, copied project roots, cache invalidation after rebind, cross-project duplicate Session ownership, read-only/offline errors, missing generations, interrupted legacy import, and archived Windows/POSIX cwd strings read as data.
- [ ] Reuse the existing provider through isolated service scopes and a lazily cached backend per bound project. Keep original cwd-encoded subdirectories beneath `.aster/sessions` so existing artifact/header checks remain truthful.

```text
project store = ctx.isolate("sessionPersistence").plugin(JsonlSessionPersistence, { root: location.sessionsRoot })
create(header) = bind verified Session ownership first; delegate to its project backend
open/stat(id) = require one registered owner; delegate only to that owner's backend
list = enumerate registered available project backends; retain missing-project status outside the Session log
flush = drain every active owned project writer; aggregate real failures
rebind = require quiescent writers; invalidate root stores/caches and observation revisions
```

- [ ] Stage legacy Session generations byte-for-byte, verify headers/body/lineage, and publish membership only after all required copies succeed. Keep source artifacts and report no-cwd/unassigned records instead of guessing their project. Do not make the legacy source a writable fallback.
- [ ] Return complete storage/query integration contracts and focused checks; Main validates existing JSONL contract cases plus the new project provider and reviews the slice.

### Task 4: Workspace membership and current execution directory cutover

**Files:** Modify `packages/workspace/workspace/src/{index.ts,entity.ts,spec.ts,types.ts}` and owning tests. Modify `packages/api/session-controller/src/{agent.ts,commands.ts,list.ts,history.ts,skill-catalog.ts}` as required by current-directory ownership; update query/reference consumers, filesystem `session-cwd.ts`, shell/search/terminal/PTC/SSH/sandbox/instruction/subagent cwd consumers, and `packages/core/agent-loop/src/index.ts`'s cwd variable registration. Update `packages/test-support/agent-loop-testkit/src/index.ts` and other actual shared fixture owners rather than casting tests. This task does not own directory-picker UI or attachment implementation.

**Consumes:** Complete project persistence and project attachment scope; **Produces:** Existing Workspace and Session APIs backed by local membership, and a single shared current-directory resolution path.

- [ ] Run references on changed exports and inventory every execution use of SessionHeader.cwd. Classify archival-only reads separately; keep those unchanged.
- [ ] Add tests for Workspace UUID preservation, local order/pin/archive restoration on a fresh home, inactive relocation, live-writer refusal, cold resume, fork/subagent membership, and actual relative filesystem/subprocess/sandbox behavior in the moved directory.
- [ ] Implement local membership as authority and migrate/remove obsolete writable global membership fields through the owning versioned domain mechanism. Global records become location/order caches; preserve legacy records as recovery sources until adoption.

```text
Workspace registration ID = validated/rebranded portable project UUID
Workspace session order/pin/archive = ProjectStorage's local metadata
new standalone Session header cwd = current directory; derived headers retain required inherited cwd; execution cwd = current project binding
cold resume comparison = project ownership/current binding, not old header.cwd equality
history header = original immutable header; current execution/display cwd = resolver output
system-prompt cwd/instructions = same resolver; existing durable context events record changes
```

- [ ] Preserve API authorization, unsupported-format errors, exact inherited prefixes, cancellations, and teardown. Unknown/missing portable projects fail explicitly. Declare changed durable types and update the architecture/subsystem docs and both SDK projections when their observed output changes.
- [ ] Main runs focused behavioral tests and a keyless logged relocation scenario, then reviews the completed cutover.

### Task 5: Project-owned original attachments and scoped reads/writes

**Files:** Modify `packages/attachment/attachment/src/{index.ts,types.ts}` only for necessary explicit scope, `packages/attachment/attachment-local/src/{index.ts,file-store.ts,store.ts}`, and `packages/client/file-upload/src` scope/admission consumers. Create `packages/workspace/project-storage/src/attachments.ts` and `tests/project-attachments.spec.ts`. Provide exact caller changes to Task 4 for Session commands; do not concurrently edit its commands file.

**Consumes:** Trusted ProjectAttachmentScope and ProjectStorage Session locations; **Produces:** Scoped original attachment storage/read/stream/normalization/request-variant behavior usable by live tools and cold history.

- [ ] Write regressions for images/files preserved after copy and old-home removal, cold reads without a live Agent, model/tool result writes, upload receipts, digest/byte-count errors, stream cancellation, duplicate hashes across projects, symlink/traversal boundaries, and missing required objects.
- [ ] Thread scope from trusted Agent/Host Session identity through every asynchronous attachment operation. Change all actual consumers of changed signatures; do not rely on a mutable process-global current project or execute-scoped ambient state after awaits.

```text
original root = ProjectStorage.locateSession(scope.sessionId).attachmentsRoot
read/write/admit/normalize/stream retain that scope until completion
unavailable portable scope = error; never try a global attachment root
request variants = rebuildable cache; original referenced bytes = project-owned durable objects
legacy references = declared first-party typed fields; copy and digest-verify before manifest publication
```

- [ ] Integrate required attachment copying with legacy adoption before it reports success. Keep shared legacy objects untouched. Update owning contracts/persistence acknowledgements; Main validates and reviews the completed provider slice.

### Task 6: Directory discovery and existing-project confirmation UI

**Files:** Modify `packages/api/workspace-controller/src/{commands.ts,types.ts,directory-picker.ts,index.ts,feed.ts}` and owning tests; modify `packages/client/ui-workspace/src/client/{navigation.ts,contract/slots.ts,locales.ts}` and the actual picker/confirmation components reached from them. Use existing Modal/Notice/Toast/DirectoryPicker primitives. Do not redesign unrelated workspace layout or change picker implementation surfaces.

**Consumes:** `ProjectStorage.inspect/open`, completed Workspace cutover, and trusted typed Remote results. **Produces:** Read-only inspection plus confirmed new/existing/legacy adoption, with freshness validation and localized conflict/read-only/offline errors.

- [ ] Add the Host acceptance cases before changing the flow: no writes on inspection/cancel, valid copied metadata proposal, same-root idempotence, stale-digest refusal, identity conflict, invalid/newer manifest, missing/corrupt history, and tracked-data warning.
- [ ] Add typed Remote inspection/open records. Inspect after native/in-page directory selection and before `createWorkspace`. Only a confirmed existing/legacy proposal reaches adoption; no-metadata new directories follow normal initialization after Git protection.

```text
selected directory -> inspect -> new / existing / registered / legacy / typed failure
existing proposal -> “发现已有 AsterHub 项目” + verified details
confirm “打开已有项目” -> send root + expected ID + expected digest
cancel -> no writes
Host -> repeat validation -> adopt/register -> publish Workspace/Session list
```

- [ ] Verify actual UI selection, confirmation, cancellation, copied history listing, attachment opening, and continued Session actions in both locale/theme modes. No direct API/DOM bypass of the flow under test. Main owns browser/Electron evidence and review.

### Task 7: Product composition, startup migration, docs and contract completion

**Files:** Own final `packages/bundle/base/cordis.patch.yml`, `packages/bundle/web-app/cordis.patch.yml`, `packages/bundle/asterhub-desktop-native/cordis.patch.yml` and their manifests, `apps/cli/src/profile-boot.ts`, `apps/desktop/src/{main.ts,paths.ts}`, desktop runtime package wiring, root TypeScript/path manifests, and the existing installer ownership checks. Update affected README pairs, architecture/subsystem docs, declared persistence changes, and `docs/upgrade-guide/v0.2.0-rc.3` ownership through the upgrade-guide skill.

**Consumes:** Tasks 1–6's completed interfaces. **Produces:** A runnable shipped product composition with one active persistence provider and one attachment service; no unbound implementation modules.

- [ ] Run the approved home preparation before profile/config consumers initialize; use the prepared root explicitly rather than re-resolving a changing process environment midway through startup.
- [ ] Mount independent project registration before project persistence and Workspace consumers. Product profiles select project-local mode; non-product profiles retain their explicitly configured grouped mode. Disable replaced product providers, remove obsolete wiring, and preserve managed plugin/profile package state.
- [ ] Confirm uninstall never deletes global or project history; update protection assumptions for `.asterhub` and `.aster` without deleting the legacy source.
- [ ] Generate required aliases/declarations/catalogs from owning sources, acknowledge actual persistent type changes, update bilingual upgrade/recovery guidance, and run relevant hygiene/docs checks. No real-user migration or package publication.

### Task 8: End-to-end portability, Git privacy and packaged acceptance

**Files:** Add deterministic owner-local integration fixtures/tests under `packages/workspace/project-storage/tests` and a shipped-profile case under `apps/cli/tests/profiles`. Add/update the owning keyless Session snapshot under the snapshot policy. Use existing Desktop packaging/smoke scripts, not hand-patched ASAR artifacts.

**Consumes:** The complete shipped composition. **Produces:** Observed end-to-end evidence and a validated isolated branch.

- [ ] Create synthetic A/B homes and project X, produce a genuine persisted conversation with image/file attachments, pin/archive/order state and a fork/subagent, then close/flush all owners.
- [ ] Copy X, make the original project and A home unavailable, start a fresh B process, choose X through the real directory picker, confirm opening, and inspect original messages/attachments.
- [ ] Continue the same SessionId; read a relative marker and run an actual subprocess that reports cwd under B. Compare every pre-existing committed generation byte/hash before and after, verify new events append correctly, and reconstruct the model-visible new-directory context from the log.
- [ ] Exercise old/new global-home conflicts, interrupted legacy copy, missing objects, repeated opening, duplicate project identities, offline/read-only media, Git initially absent, git add -A, and already-tracked `.aster` refusal without deleting/untracking user files.
- [ ] Run normal Host/Client compile and focused behavior tests, validate docs/persistence acknowledgements, then run a built/packaged runtime smoke. Record any physical-second-PC/platform-matrix evidence separately; do not call local simulated B a physical-computer test.
- [ ] Main performs a scoped review, resolves load-bearing findings, records remaining external acceptance prerequisites, and leaves the branch for later coordinated integration. No merge, push, history rewrite, real-user migration, or publish.

<a id="verification-and-integration"></a>

## Verification and integration

Execution waves are Task 1 + Task 2 in parallel; then Task 3 + Task 5 in parallel after Task 2's interfaces are accepted; then Task 4, Task 6, Task 7, and Task 8 in dependency order. Shared files belong to one integration owner. Main validates each wave once after editors finish, updates the ledger immediately, and does not re-dispatch completed tasks after compaction.

The initial isolated baseline passed four selected home-resolution/immutable-format cases. This is not proof of the feature. Completion requires all eight delivered task results, task-scoped and final review, changed-caller coverage, the cold-copy/continued-IO smoke, actual UI evidence, and packaged checks. Any unavailable external machine or native Goal control is reported explicitly rather than simulated or claimed complete.
