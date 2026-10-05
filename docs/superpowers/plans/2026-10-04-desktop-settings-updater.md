# Desktop Settings Update Check and Windows Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Desktop-only manual update action beside the General Settings version and publish one signed Windows x64 `0.2.0-rc.3` installer through the existing AsterHub Nightly feed.

**Architecture:** The Settings row calls a new private Desktop preload/IPC manual-check operation; the renderer supplies no version, URL, or installation authority. The main process reuses the existing electron-updater state machine and one consent for download-plus-install, retaining a separate active-task interruption confirmation. Release publishing reuses the current Windows packager and COS uploader; production writes occur only after exact artifact metadata and hashes are presented for confirmation.

**Tech Stack:** TypeScript, React slots/locales, Electron IPC/preload, electron-updater, pnpm 11.7.0, Windows x64 signed installer, Tencent COS.

**Spec:** `docs/superpowers/specs/2026-10-04-desktop-settings-updater-design.md`

## Global Constraints

- Product version is `0.2.0-rc.3`; root and Desktop manifests already carry this version in local commit `8de40828`.
- Release target is `win-x64`, standard signed installer, production origin `https://asterhub.xapi.fans`.
- The live Windows Nightly feed currently returns HTTP 404.
- One explicit confirmation authorizes downloading and installing the exact checked candidate; installation that may interrupt running work requires a separate confirmation.
- Automatic checks never download or install. The renderer never selects an update URL or candidate version.
- `apps/desktop/.env.windows` is local, Git-ignored configuration. Do not print or copy its secret values.
- Never upload to production COS until the exact object keys, sizes, and SHA-512 values are shown and confirmed.
- Do not modify production Nginx, Cloudflare, DNS, or catalog-service configuration unless public feed validation proves such a change is necessary; then obtain separate exact-scope confirmation.
- Keep the previously modified handoff and settings/curated-plugin changes. Do not reset or rewrite the existing release commit.

---

### Task 1: Add main-process manual install consent

**Files:**
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/src/preload-app.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/locale.ts`
- Test: `apps/desktop/tests/main-startup.spec.ts`
- Test: `apps/desktop/tests/preload-app.spec.ts`

**Interface:**
- `DshDesktopProductApi.updates.check(): Promise<void>` invokes a new product-sender-guarded `DESKTOP_IPC.updatesCheck` channel.
- Main-process `updatesCheck` and the existing native **Check for Updates…** menu route use `openUpdatePrompt(true)`; `updates.open()` continues to serve the existing status/badge action.
- Main keeps exact-candidate preauthorization private. The authorization is granted only after the main-process manual prompt accepts the exact checked version; renderer IPC cannot set it.

- [ ] Add a `main-startup.spec.ts` test showing `updatesCheck` performs a manual check and, when no newer candidate exists, displays the current version without downloading.
- [ ] Add a `main-startup.spec.ts` test showing accepting the available-version **download and install** prompt downloads the exact candidate and hands it to the existing installer without the ordinary second install prompt when there are no active tasks.
- [ ] Add a `main-startup.spec.ts` test showing active tasks at install time still require the separate stop-tasks confirmation; declining it leaves the downloaded version ready and does not call `quitAndInstall`.
- [ ] Add a `main-startup.spec.ts` test showing declining the initial update confirmation does not download or install.
- [ ] Add a `preload-app.spec.ts` assertion that `updates.check()` invokes only `DESKTOP_IPC.updatesCheck`; the preload exposes no direct download or install capability.
- [ ] Run both complete test files; confirm new assertions fail before production changes and pass after them.
- [ ] Implement guarded IPC and main-owned version authorization. Clear authorization in `finally`; reject task-state errors and unclean Host shutdown as before.
- [ ] Update localized available-update copy to state that consent downloads and installs, then completes the restart; keep a separate task-interruption prompt.
- [ ] Run both complete test files.

### Task 2: Add the Desktop-only General Settings action

**Files:**
- Modify: `packages/client/ui-settings-general/src/types.ts`
- Modify: `packages/client/ui-settings-general/src/client/desktop-update-source.ts`
- Modify: `packages/client/ui-settings-general/src/client/CurrentVersionRow.tsx`
- Modify: `packages/client/ui-settings-general/src/client/CurrentVersionRow.module.css`
- Modify: `packages/client/ui-settings-general/src/client/index.ts`
- Modify: `packages/client/ui-settings-general/src/client/locales.ts`
- Test: `packages/client/ui-settings-general/tests/desktop-update-source.client.spec.ts`
- Modify: `packages/client/ui-settings-general/README.md`
- Modify: `packages/client/ui-settings-general/README.zh.md`

**Interface:**
- `DesktopUpdateBridge.check(): Promise<void>` represents one main-owned manual check-and-consent prompt; it accepts no version or URL.
- The registered `current-version` row receives a feature-owned `checkUpdates` callback only when the Desktop preload protocol is present. The web-only row remains version-only.

- [ ] Add a component test that the version row shows a localized **Check for updates** button when the Desktop callback exists and invokes it exactly once on click.
- [ ] Add a component test that the same row has no update button without the optional Desktop callback and still displays the compile-time version.
- [ ] Add an assembled client test that the General plugin registers the row and binds the optional Desktop operation from its owned preload carrier.
- [ ] Run the complete `components.client.spec.tsx` and `apply.client.spec.ts` files; confirm the new assertions fail before implementation.
- [ ] Add `check()` to the optional Desktop bridge and implement it in `DesktopUpdateSource`, joining in-flight actions and preserving disposal/error state.
- [ ] Inject the callback into `CurrentVersionRow`; use the existing semantic button/token treatment and locale-owned copy. Do not add a Web settings update API.
- [ ] Run the complete three test files.

**Task 3 verification:** Client/Host `tsc -b` and `build:official` passed. The Node-compatible DesktopUpdateSource suite passed 15/15; component/apply jsdom files failed during environment setup, and `test:updates:local` failed at the mandatory-status IPC scenario. The authenticated Settings surface was not reachable in the isolated development profile. See `.superpowers/sdd/2026-10-04-desktop-settings-updater/progress.md` for exact outcomes.

### Task 3: Verify compiler, product build, and local updater behavior

**Files:**
- Verify: `tsconfig.client.json`
- Verify: `tsconfig.host.json`
- Verify: `apps/desktop/tests/`
- Verify: `apps/desktop/scripts/test-local-updater.mjs`

- [ ] Run `node node_modules/vitest/vitest.mjs run apps/desktop/tests/main-startup.spec.ts apps/desktop/tests/preload-app.spec.ts apps/desktop/tests/update-coordinator.spec.ts` with the complete files.
- [ ] Run `node node_modules/typescript/bin/tsc -b tsconfig.client.json tsconfig.host.json`.
- [ ] Run `corepack pnpm run build:official` to rebuild the official client artifacts and TypeScript outputs.
- [ ] Run `corepack pnpm --dir apps/desktop run test:updates:local` where Windows signing-independent prerequisites permit; require its own local updater report and zero exit code.
- [ ] Run the UI component verification and inspect the real Settings view at English/Chinese and light/dark appearances; confirm the Desktop-only action sits beside the version and opens the native manual check flow.

### Task 4: Preflight and build the signed Windows installer

**Files:**
- Read without displaying values: `apps/desktop/.env.windows`
- Build output: `apps/desktop/.desktop-build/targets/win-x64/`

- [ ] Run the Windows package preflight with the current local environment and do not print secret values.
- [ ] Stop before packaging if the required signing identity, SignTool, NSIS compiler, or release configuration is unavailable; report the exact missing prerequisite names only.
- [ ] Build `win-x64` using the production-configured local environment and the manifest version `0.2.0-rc.3`; do not pass `--build-version`.
- [ ] Verify the signed release completion record, installer, blockmap, `nightly.yml`, file sizes, and SHA-512 values against the build output.
- [ ] Keep the built installer local until the exact production upload targets are shown and confirmed.

### Task 5: Confirm, publish, and verify production feed objects

**Files:**
- Upload through: `apps/desktop/scripts/upload-target.ts`
- Public origin: `https://asterhub.xapi.fans`
- COS paths: `dsh-desk/feeds/win-x64/nightly.yml`, `dsh-desk/bin/win-x64/<versioned installer>.exe`, and its blockmap.

- [ ] Present the validated version, exact object keys, sizes, SHA-512 values, and that the feed alias will be replaced; request point-of-risk confirmation before any upload.
- [ ] After confirmation, invoke the existing `upload:win:x64` production uploader from the build completion record; never use the fixed `upload:latest` alias for this prerelease.
- [ ] Fetch the feed and each referenced artifact through `https://asterhub.xapi.fans`, not directly from COS.
- [ ] Verify the feed version and artifact SHA-512 values against the signed build record.
- [ ] If the feed or binaries remain unreachable through the public HTTPS origin, stop without changing production Nginx/Cloudflare; report the failed path and seek separate authorization for server configuration edits.
- [ ] Record the final public feed URL and verification result in the project handoff document after successful publication.

## Deferred operation

A standard installer is the only release target in this plan. macOS installers, a forced-update policy, generic `/api/v1/desktop/latest.json`, and changes to the signed plugin catalog are out of scope.
