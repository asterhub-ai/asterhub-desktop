# Project Storage
English | [中文](README.zh.md)

`@deepseek-ai/dsh-project-storage` owns portable project metadata in `<project>/.aster/project.json` and a machine-local locator index beneath the prepared AsterHub home. The manifest is authoritative for project identity, Session membership, relative cwd, order, pin, and archive state; the locator stores only `{ id, root, revision }` and can be rebuilt from selected projects.

## Host service

Mount `ProjectStorageService` with explicit `ProjectStorageOptions` after preparing the global home and independently of `WorkspaceRegistry` and `SessionPersistence`:

- `sessionMode`: explicit `grouped` or `project-local` selection;
- `locatorPath`: machine-local locator JSON path;
- `legacySessionRoot`: configured read-only legacy source location, if present;
- `metadataLimitBytes`: maximum portable metadata input size;
- `lockDeadlineMs`: bounded wait for the cross-process mutation lock.

The Host-facing service is exposed as `ctx.projectStorage`; the browser-safe `./types` entry declares only data contracts. Mutations write a complete temp file, sync it, atomically replace the prior file, and emit `project-storage/changed` only after durability. Register read-only legacy discovery with `registerLegacySource` and the single migration implementation with `registerLegacyAdopter` through their owning Cordis effects. The adopter receives `(proposal, destinationRoot, signal?)` and must return the complete verified portable manifest. Legacy open revalidates the proposal and fails with `ProjectMigrationUnavailableError` when no adopter is registered; it never initializes empty history.

## Inspection and adoption

`inspect(root)` canonicalizes the directory and only reads bounded strict JSON. A missing metadata file yields `new` unless a registered legacy source has a proposal; malformed, newer, duplicate-key, unsafe-root, and competing-identity states fail explicitly. Confirmation for `existing` or `legacy` must pass the inspected ID and digest to `open`; open re-inspects under the serialized mutation path before publishing. Same-ID/same-root opens retain their binding revision. An active or existing former root cannot be silently replaced.

Project cwd membership is a validated portable relative path (`.` or slash-separated child path). Absolute paths, drive prefixes, backslashes, NUL, empty components, and escaping `..` are refused. Session IDs and historical headers remain unchanged. `.aster` and its owned `sessions`, `attachments`, and `attachments/v1` roots must not be symlinks or escape the selected directory. `unregister` removes only the locator record; it never deletes project files.

## Project Session persistence

`ProjectSessionPersistence` is exported from `/persistence` and mounts after `ProjectStorageService`. It routes Session reads and writes by manifest ownership to `.aster/sessions`, preserving stored headers and generations. It rejects writes when the project is missing or read-only, and refuses a moved-root rebind while routed handles remain open. `list()` returns Sessions from available registered projects; grouped profiles keep their explicitly configured backend.

## Attachment scope

`resolveProjectAttachmentScope(ctx, sessionId)` derives the trusted project owner for a registered Session and returns the `AttachmentScope` that project-local attachment providers use to route durable object reads and writes to the owning project's `.aster` trees. It throws when the Session has no registered project owner. LLM adapters and upload consumers resolve this scope per request and pass it through the attachment seam; grouped providers ignore it.

## Git privacy

`ensureProjectGitExclusion(root)` adds `.aster/` to the project `.gitignore` while preserving prior bytes and line endings, including when Git is initialized later or the selected directory is in a linked worktree. It uses Git's real worktree/top-level discovery and reports already-tracked `.aster` paths as `tracked-data`; it never stages, commits, deletes, or untracks them. Open refuses tracked private data rather than presenting it as protected.

## Packaging contract

The package declares runtime subpath exports (`./manifest`, `./attachments`, `./persistence`) and ships companion modules under `lib/`. The package-local `tsdown.config.ts` emits all exported runtime entries (`{index,manifest,registry,git-exclusion,attachments,persistence}`) during the Host build pass while emitting nothing during the Client pass (`DSH_BUILD_FACE === 'client'`). Packaged consumers such as `session-persistence-project` rely on these concrete entry files in distributed bundles.

## Verification

Focused owned-fixture tests: `pnpm exec vitest run packages/workspace/project-storage/tests/manifest.spec.ts packages/workspace/project-storage/tests/registry.spec.ts packages/workspace/project-storage/tests/git-exclusion.spec.ts`.
