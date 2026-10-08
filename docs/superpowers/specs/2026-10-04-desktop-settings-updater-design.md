# AsterHub Desktop update check and Windows release design

**Status:** Approved by user for implementation  
**Scope:** `AsterHub-reference` Desktop update UI and one Windows x64 production update release  
**Release target:** `0.2.0-rc.3`, Windows x64 standard signed installer

## Goal

Add a manual **Check for updates** action beside the installed version in General Settings, and publish a signed Windows x64 installer to the existing AsterHub electron-updater feed so Desktop clients can download it.

## Current implementation

`packages/client/ui-settings-general` renders the compile-time version in `CurrentVersionRow`. `DesktopUpdateSource` and the optional Electron preload expose status plus `open()`. The native application menu calls `openUpdatePrompt(true)`, while the current preload `updates.open` calls the non-manual path. The main process owns `DesktopUpdateCoordinator`, candidate-version selection, download, update installation, active-task checks, and restart handoff; the renderer cannot provide a version or URL.

The existing manual menu path checks the fixed Nightly feed, presents the available version, downloads after the user's consent, then calls the updater install flow. After download, the current main process shows another ordinary install-and-restart confirmation; when work is active, it shows a task-interruption confirmation instead.

The Desktop release builder already emits the platform updater metadata and binaries. The uploader writes versioned Windows installer and blockmap objects followed by `nightly.yml` to production COS. `asterhub.xapi.fans` is the fixed production origin; the public Nginx layer is documented as a read-only proxy for COS. The live Windows Nightly feed currently returns HTTP 404.

## Settings interaction

Add a localized **检查更新** button beside the version in General Settings. The row renders the button only when the Desktop preload update API is present; ordinary browser users continue to see the version only. Keep existing version text, row ownership, settings layout, and button styling conventions.

Add a dedicated preload/IPC operation for a manual update check. It must validate that the sender is the primary product document and then delegate to the main-process manual prompt. The renderer supplies no update URL, version, or install authorization.

When the check reports no newer version, the existing localized current-version result is shown. When a newer version exists, one explicit **下载并安装** confirmation authorizes downloading the exact checked candidate and proceeding to installation after a successful download. The application must not download or install before that confirmation. Download failure remains retryable and does not invoke installation.

If work is running when installation is ready, retain a separate, explicit task-interruption confirmation. Reject installation if the user declines, task state is unknown, work becomes newly active, or Host shutdown is not clean. If no work requires interruption, the initial update confirmation authorizes installation and restart without a second confirmation. Automatic background checks remain silent and never download or install. Existing update badge status remains unchanged; manual app-menu and Settings checks share the confirmed download-and-install flow.

## Windows release and server flow

Keep the existing signed package builder and production COS uploader. Do not add an upload route to the Node catalog service and do not store publication credentials on the German host.

Bump the root and Desktop product versions together to `0.2.0-rc.3` through the repository release workflow. Package the Windows x64 standard signed installer from the current source, using the existing `apps/desktop/.env.windows` configuration without displaying or copying credential values. The production package command must use the product version; it must not pass `--build-version`.

Before any production upload, validate the signed completion record, package version, target, public origin, file size, SHA-512, installer, blockmap, and `nightly.yml`. Present the exact production COS keys, byte sizes, and SHA-512 values to the user and obtain immediate confirmation before the first write. Then use the existing uploader for the Windows x64 Nightly feed and versioned artifacts. Do not overwrite the fixed `latest` installer alias because this prerelease release does not request that surface.

After upload, fetch the feed and every artifact URL through `https://asterhub.xapi.fans`, compare their versions and SHA-512 hashes with the signed packaging record, and verify that the feed becomes reachable. The feed is currently 404. If the final public route still returns 404, stop before changing production Nginx or Cloudflare configuration; report the exact missing route and seek separate confirmation for infrastructure edits.

## Verification

- Add a client regression test that the Settings version row exposes the Desktop-only action and omits it in a browser-only context.
- Add native update-flow coverage for a manual update initiated by that action: no-update result; available-update consent; cancelled consent; failed download; automatic install handoff after consent; active-task confirmation refusal; and no silent installation.
- Run the complete affected Client and Desktop test files, Host and Client TypeScript project graphs, and `corepack pnpm run build:official`.
- Run the repository's real Windows local-updater qualification where its prerequisites allow it.
- Build the standard signed Windows x64 release only after the local package preflight succeeds. Confirm the exact production objects before upload; after upload, verify each public response and hash.

## Risks and constraints

- The updater package is an externally visible, signed Windows installer. No unsigned, stale, or partial artifact may be represented as a release.
- Installation can stop active agents and child work. Task interruption remains separately confirmed when applicable and fails closed when task state is unavailable.
- The current production Windows feed is 404; an upload alone does not establish a working public update route.
- `.env.windows` is local and already present. Its values remain private; missing signing or COS inputs must be reported by preflight, never synthesized.
- The user's previously confirmed login/model/account test results remain accepted as complete; this work does not repeat them.
