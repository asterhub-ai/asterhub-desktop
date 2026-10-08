# Project-local history and portable attachments design

English | [中文](2026-10-07-project-local-history-design.zh.md)

## Summary

AsterHub stores account and machine configuration under the default user home `.asterhub`, and stores each project's conversations and original attachments under that project's `.aster`. Selecting a copied project on another installation discovers the existing project, asks for confirmation, and opens its original conversations without relying on the former installation's user home or absolute filesystem locations. This design is approved for isolated implementation; integration into the final mainline remains a later decision.

## Data ownership

The global home owns credentials, account/model configuration, installed plugin profiles, shared models, disposable caches, and a recoverable index of registered project locations. Project data owns project identity/title, Session ownership and display order, pin/archive state, immutable Session generations, and the original attachment bytes required to display and continue conversations. No credentials, executable plugins, or machine profile are imported from `.aster`.

```text
~/.asterhub/                         account and machine data
project-X/.aster/project.json        portable identity and Session membership
project-X/.aster/sessions/            original JSONL/Zstandard generations
project-X/.aster/attachments/v1/      original files and normalized images
project-X/.gitignore                 .aster/ ignore rule
```

The Session provider may retain its existing cwd-encoded subdirectories below the project-owned sessions root. Those subdirectories describe historical headers, not the project's identity or current execution directory. No Session generation must be renamed or rewritten merely to remove an old drive/path string.

## Identity and current location

A validated UUID is the portable project ID. Existing Workspace UUIDs become the corresponding project UUIDs during legacy adoption; the registry rebrands that same validated UUID as WorkspaceId when presenting it, preserving existing workspace references. The local manifest is authoritative for project identity and ordered Session membership. The machine index is only a locator/cache, not a second authoritative copy of conversation data.

Each Session membership records its unchanged SessionId and a validated project-relative working directory. Relative directories use `/`, allow `.` for the project root, and reject absolute paths, drive prefixes, NUL, and escaping `..`. Resolving current execution cwd joins that relative directory to the project's verified current root. Historical `SessionHeader.cwd` remains unchanged and is never passed to filesystem operations for a portable Session.

The global locator records project ID, current canonical root, and a binding revision. Reopening the same ID/root is idempotent. A moved root can replace an inactive missing former root after explicit confirmation. If the old root still exists, or has active Sessions, the operation refuses silent replacement and presents a location conflict. It does not create a second independent project by changing IDs in copied history. Unregistering a workspace removes only machine registration and never deletes `.aster`.

## Persistence and runtime integration

A project-routed SessionPersistence provider reuses the existing JSONL backend in isolated Cordis service scopes. It opens a lazily cached backend rooted at the selected project's `.aster/sessions`; grouped storage remains the explicit backend for non-product profiles and the read-only legacy migration source, not a recovery fallback for portable Sessions. Bare SessionId APIs remain usable only when the registered owner is unambiguous; a duplicate owner is an explicit conflict. Root binding revisions participate in observations/cache invalidation so relocation cannot reuse an old pathname-dependent cache.

Project registration is independent of SessionPersistence and WorkspaceRegistry initialization, avoiding a dependency cycle. Workspace registration, Session creation/adoption/fork, query/list/follow/export, filesystem tools, shells/search/terminal/PTC/SSH consumers, sandbox roots, project instruction loading, and subagent creation resolve the same current execution directory. The existing system-message/request-context logging mechanisms record the current directory shown to the model. Do not introduce an unlogged model-visible cwd override.

Original headers, events, inherited cuts, parent/child IDs, and committed generations remain byte-for-byte unchanged during storage migration and project movement. Current readers must distinguish historical path syntax from native execution paths: validate archived Windows/POSIX absolute paths as data, never realpath an old foreign path, and execute only against the current native directory. Released format generations and committed historical codec files are not overwritten or deleted. Persistence-type acknowledgements and an upgrade guide accompany changes to project/workspace durable records and public behavior.

## Attachments

The attachment provider routes writes and reads through an explicit project/Session scope. Live tool results and prompt/file uploads receive scope from the trusted Agent or Host Session address, not from model-supplied paths. Cold history/image/file access resolves scope from the addressed stored Session. The same scope is retained through normalization, conversion, streaming, deduplication, and request-image generation. Unscoped non-project operations retain their explicitly configured global provider; a missing/offline portable project does not fall back there.

The original content-addressed files and normalized images referenced by the project travel under `.aster/attachments/v1`; derived thumbnails/request variants can be rebuilt. Legacy migration walks declared first-party attachment references and fails loudly on missing/corrupt required bytes. It does not scan arbitrary opaque plugin payloads as filenames or copy unrelated account data. Shared legacy objects are copied and verified, not removed, because another project may still reference them.

## Discovery and confirmation

Directory selection calls a read-only inspection before registration or initialization. A directory without project metadata is new unless it has matching legacy global history. Valid local metadata yields an existing-project proposal; a same-machine registered ID/root opens directly. Empty `.aster`, malformed metadata, unsupported newer versions, identity conflicts, inaccessible roots, and missing required history are distinct outcomes, not invitations to overwrite data.

The dialog is titled “发现已有 AsterHub 项目”, explains that history and attachments remain in the selected directory, and offers “打开已有项目” and “取消”. Verified project name, Session count, and last activity may be shown. Confirmation carries the canonical root, project ID, and inspected metadata digest; the Host revalidates those facts before adopting data. Cancellation performs no writes. Legacy history adoption is likewise explicit and preserves the source until copy verification and publication succeed.

Selecting a project never executes `.aster` contents, imports credentials/plugins, or automatically runs old tool calls. Read-only projects can expose validated history read-only and disable writes with an explicit reason. Missing/removable-media roots remain registered as unavailable, never silently empty or redirected to the process cwd.

## Git exclusion

Before creating project data, ensure the project-level `.gitignore` excludes `.aster/` while preserving existing bytes, comments, line endings, and applicable existing rules. Do not auto-commit the ignore-file change. Cover ordinary repositories, nested project roots, linked worktrees, and repositories created after project initialization. AsterHub's own repository also ignores `.aster/`.

Check already-tracked `.aster` paths separately because ignore rules do not untrack them. Report the privacy risk and refuse to treat them as protected; do not delete files or invoke git rm --cached without explicit user approval. Do not invent a new Git staging/commit subsystem: integrate any actual existing Git candidate filtering and ensure real git status/git add -A cannot include newly created Session/attachment data. Ordinary filesystem access remains available for intentional inspection.

## Migration and failure rules

Default global-root migration is separate from pure path resolution. Explicit configured homes and nonblank DSH_HOME remain authoritative. For an old-only default `.dsh`, stage a copy, verify complete durable data and internal links, and publish `.asterhub` without deleting the source. A completion record makes repeat startup idempotent. Two independently populated homes are an actionable conflict, not a per-file overwrite merge. Source mutation, interrupted publication, unreadable data, active writers, and external-link hazards fail with retained source/staging evidence.

Project adoption stages verified copies of all owned Session generations, local ordering/pin/archive metadata, and referenced attachments before publishing the portable manifest and registering the project. Acquire or require quiescent source ownership; never copy an active write tail and claim a valid migration. Repeating adoption after interruption must neither duplicate IDs nor lose an earlier committed destination. Old unassigned Sessions with no cwd are retained and reported for recovery, not guessed into a selected project.

## Acceptance and limits

Completion requires normal Host/Client compilation, focused behavior/security/lifecycle tests, a keyless recorded relocation scenario where model requests reflect the new root, and real UI directory selection/confirmation/cancellation/history/attachment checks. A fresh-process smoke uses separate A and B homes, copies project X, makes the original home/root unavailable, opens X in B, reads original messages/images/files, continues the same SessionId, and observes actual relative file IO/subprocess cwd under B. Verify forks/subagents, index reconstruction, repeated opening, duplicate identities, missing media, read-only roots, and migration interruption.

A second physical-computer run and Windows/macOS matrix evidence are reported only when actually exercised; local isolated-profile evidence is not described as physical-PC proof. No automatic merge, push, publish, real-user data migration, account transfer, new memory engine, global scheduler transfer, internal dsh package/CLI rename, or Git history rewrite is authorized by this plan.
