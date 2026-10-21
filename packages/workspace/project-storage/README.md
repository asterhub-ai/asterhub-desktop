---
description: "Portable project metadata and project-local Session ownership for hosts that need history and attachment ownership to follow a workspace."
kind: "package-reference"
---

# Project Storage
English | [中文](README.zh.md)

## Summary

Store project identity, Session membership, and portable metadata beside each workspace while keeping the root locator local to the machine. Use project-local persistence when Session history and attachments should move with a project folder. Grouped profiles can continue using a separate Session backend.

## Table of Contents

- [Host service](#toc-host-service)
- [Inspection and adoption](#toc-inspection-and-adoption)
- [Project Session persistence](#toc-project-session-persistence)
- [Attachment scope](#toc-attachment-scope)
- [Git privacy](#toc-git-privacy)
- [Packaging contract](#toc-packaging-contract)
- [Verification](#toc-verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#toc-dev-note)

`@deepseek-ai/dsh-project-storage` owns portable project metadata in `<project>/.aster/project.json` and a machine-local locator index beneath the prepared AsterHub home. The manifest is authoritative for project identity, Session membership, relative cwd, order, pin, and archive state; the locator stores only `{ id, root, revision }` and can be rebuilt from selected projects.

<a id="toc-host-service"></a>
## Host service

Mount `ProjectStorageService` with explicit `ProjectStorageOptions` after preparing the global home and independently of `WorkspaceRegistry` and `SessionPersistence`:

- `sessionMode`: explicit `grouped` or `project-local` selection;
- `locatorPath`: machine-local locator JSON path;
- `legacySessionRoot`: configured read-only legacy source location, if present;
- `metadataLimitBytes`: maximum portable metadata input size;
- `lockDeadlineMs`: bounded wait for the cross-process mutation lock.

The Host-facing service is exposed as `ctx.projectStorage`; the browser-safe `./types` entry declares only data contracts. Mutations write a complete temp file, sync it, atomically replace the prior file, and emit `project-storage/changed` only after durability. Register read-only legacy discovery with `registerLegacySource` and the single migration implementation with `registerLegacyAdopter` through their owning Cordis effects. The adopter receives `(proposal, destinationRoot, signal?)` and must return the complete verified portable manifest. Legacy open revalidates the proposal and fails with `ProjectMigrationUnavailableError` when no adopter is registered; it never initializes empty history.

Registration disposers follow Cordis effect ownership and may return a Promise; callers await disposal before releasing dependent resources.

<a id="toc-inspection-and-adoption"></a>
## Inspection and adoption

`inspect(root)` canonicalizes the directory and only reads bounded strict JSON. A missing metadata file yields `new` unless a registered legacy source has a proposal; malformed, newer, duplicate-key, unsafe-root, and competing-identity states fail explicitly. Confirmation for `existing` or `legacy` must pass the inspected ID and digest to `open`; open re-inspects under the serialized mutation path before publishing. Same-ID/same-root opens retain their binding revision. An active or existing former root cannot be silently replaced.

Registered projects whose `.aster/project.json` is absent (`ENOENT`) remain listed with `missing` status. They do not prevent opening unrelated projects or removing registrations. Present but malformed metadata, non-canonical roots, and identity conflicts still fail explicitly.

Project cwd membership is a validated portable relative path (`.` or slash-separated child path). Absolute paths, drive prefixes, backslashes, NUL, empty components, and escaping `..` are refused. Session IDs and historical headers remain unchanged. `.aster` and its owned `sessions`, `attachments`, and `attachments/v1` roots must not be symlinks or escape the selected directory. `unregister` removes only the locator record; it never deletes project files.

On Windows, directory read-only attributes do not determine child write permissions. Opening and status checks use the native directory access check instead of POSIX directory mode bits; status also opens the manifest without modifying its contents to check write access. Windows directory ACL enforcement occurs during the actual create and replace operations, so directory access checks are advisory and do not guarantee that a later write succeeds. These checks create no temporary probe files, and `inspect` remains read-only.

<a id="toc-project-session-persistence"></a>
## Project Session persistence

`ProjectSessionPersistence` is exported from `/persistence` and mounts after `ProjectStorageService`. It routes Session reads and writes by manifest ownership to `.aster/sessions`, preserving stored headers and generations. It rejects writes when the project is missing or read-only, and refuses a moved-root rebind while routed handles remain open. `list()` returns Sessions from available registered projects; grouped profiles keep their explicitly configured backend.

`ProjectStorage.deleteSession(id)` removes the Session's JSONL directory and its manifest membership, order, pin, and archive entries. It rejects symlinked project-data directories and does not remove the project directory or shared project-level attachments.

Each project mounts a JSONL provider in an isolated `sessionPersistence` store. The router retrieves that provider with an explicit store lookup, so callers injecting the router cannot resolve the router itself as its own backend.

<a id="toc-attachment-scope"></a>
## Attachment scope

`resolveProjectAttachmentScope(ctx, sessionId)` derives the trusted project owner for a registered Session and returns the `AttachmentScope` that project-local attachment providers use to route durable object reads and writes to the owning project's `.aster` trees. It returns `undefined` when project storage is not mounted and throws when the Session has no registered project owner. The helper resolves the service through Cordis's global service store, so callers do not need to inject this optional service; grouped providers omit this scope.

<a id="toc-git-privacy"></a>
## Git privacy

`ensureProjectGitExclusion(root)` adds `.aster/` to the project `.gitignore` while preserving prior bytes and line endings, including when Git is initialized later or the selected directory is in a linked worktree. It uses Git's real worktree/top-level discovery and reports already-tracked `.aster` paths as `tracked-data`; it never stages, commits, deletes, or untracks them. Open refuses tracked private data rather than presenting it as protected.

<a id="toc-packaging-contract"></a>
## Packaging contract

The package declares runtime subpath exports (`./manifest`, `./attachments`, `./persistence`) and ships companion modules under `lib/`. The package-local `tsdown.config.ts` emits all exported runtime entries (`{index,manifest,registry,git-exclusion,attachments,persistence}`) during the Host build pass while emitting nothing during the Client pass (`DSH_BUILD_FACE === 'client'`). Packaged consumers such as `session-persistence-project` rely on these concrete entry files in distributed bundles.

<a id="toc-verification"></a>
## Verification

Focused owned-fixture tests: `pnpm exec vitest run packages/workspace/project-storage/tests/manifest.spec.ts packages/workspace/project-storage/tests/registry.spec.ts packages/workspace/project-storage/tests/git-exclusion.spec.ts`.

## Model Experience

Indirectly, through Session persistence and project-local attachment providers.

#### KV Cache effect

This package stores Session records and resolves attachment ownership; Session and model-adapter consumers select the history and attachment content sent in each request.

## Known Limitations and Deferred Work

- **Legacy history requires an adopter** — legacy sources can propose project history, but opening it fails until the composition registers the migration implementation.
- **Moved projects cannot rebind while handles are open** — close routed Session handles before reopening a project at its new root.

No runtime invariant companion is published because ProjectStorageService and ProjectSessionPersistence enforce project ownership and routed writes through their existing registries; this package adds no separate mutable relation.

<a id="toc-dev-note"></a>
### Dev Note

The package manifest owns public subpaths; keep its runtime exports synchronized with `tsdown.config.ts`.
