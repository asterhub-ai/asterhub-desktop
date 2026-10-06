# Desktop Built-in Browser Use Implementation Plan

English | [中文](2026-10-06-desktop-built-in-browser-use.zh.md)

> **For agentic workers:** Use subagent-driven-development or executing-plans to execute the checked tasks; read this entire document before editing.

**Goal:** Make browser operations and webpage testing use the same built-in Desktop Sidebar Browser that the user sees, using ZCode-style observation, targeting, interaction, and verification.

**Architecture:** A Desktop-only Browser Use provider calls a typed transport installed before profile activation. The existing child-process IPC connects the Node Host to Electron main; renderer coordination creates and activates Sidebar tabs, while main executes only on verified leased guests. No public debugging endpoint or Node access is added to visited pages.

**Tech Stack:** Cordis, TypeScript ESM, Electron webview/WebContents, existing tool and attachment services, pinned Playwright DOM semantics, Vitest.

**Spec:** The approved design and acceptance requirements are embedded below; this document is a proposed implementation plan, not a claim that the feature exists.

## Summary

Deliver a real model-to-Sidebar operation path, not a prompt-only preference. Preserve the existing Web/dev-web providers, production isolation policy, and single-provider registration. Execution requires actual Electron and model-flow evidence before completion.

## Table of Contents

- [Approved design](#approved-design)
- [Global constraints](#global-constraints)
- [Task execution](#task-execution)
- [Acceptance and handoff](#acceptance-and-handoff)
- [Evidence sources](#evidence-sources)

<a id="approved-design"></a>

## Approved design

Desktop defaults to the built-in browser. Web/dev-web retains its existing browser configuration; a cross-origin iframe is not an automation backend. A configured external Desktop provider is an explicit profile override, not a second concurrently mounted provider or a silent fallback after an action fails.

The existing `DesktopBrowserBridge` only acquires/releases guests and reports popup URLs. `DesktopBrowserGuests.acquire()` allocates a reservation; it does not create a visible tab. Opening must go through the owning Session's Sidebar controller and await the corresponding guest attachment.

Learn the workflow and narrow execution primitives from ZCode; do not import its agent loop, Node REPL host, authentication platform, credential importers, or complete browser manager. PTC already exposes registered tools through `tools.<name>`; do not introduce another JavaScript executor.

### Workflow to preserve

1. Discover the actual backend and its supported operations. Check current Session tabs by ID, URL, title, and active status; never choose a tab by array position or remembered handle.
2. Reuse the exact target tab; reuse a same-hostname tab only when navigating it is authorized. Otherwise create a visible Sidebar tab for the calling Session. Never repurpose a tab belonging to another Session with the same workspace.
3. Wait for a concrete page state, using DOMContentLoaded as the navigation baseline. Read a DOM/ARIA snapshot and derive locators from its facts; fail on ambiguous targets rather than picking the first match.
4. Perform one state-changing action, then inspect the expected outcome. Popup verification checks both model-owned and user-created tabs in the same Session. A timeout means re-observe, not repeat the action or switch browsers.
5. Ordinary tasks prefer semantic observations; use viewed screenshots for visual tasks, canvas targeting, and GUI-test evidence. Formal GUI testing does not use page-side scripts, direct API requests, or forced interactions to bypass the behavior under test.
6. Preserve source/result pages after a turn; only explicit tab closure destroys them. Release model control on live Agent disposal, not the user's entire workspace browser storage. Reconnection never claims that previous page memory was restored.

<a id="global-constraints"></a>

## Global constraints

- Keep `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, denied downloads/permissions, and application-Host blocking on every operated guest.
- Use caller identity from `exec.agent` and trusted Host metadata. The model cannot supply Session/workspace identity, lease, WebContents ID, IPC channel, CDP method, script, or endpoint.
- Keep exactly one `ctx.browserUse` registration. Do not add a multi-provider selector or production dependency on `packages/experimental`.
- Treat page content as untrusted. Existing approval policy applies to consequential actions; a page or model cannot grant approval. Host-level identity validation supplements rather than replaces tool approvals.
- Use existing durable tool results and attachment storage. Do not persist raw base64, live leases, or Chromium state in Session events. Declare any actual persistence-type change under the repository policy.
- User tab clicks and page scripts can race automation. Serialize provider work per live Session; generation-fence stale targets and snapshots. A successful input dispatch is not proof of the requested result.
- No arbitrary `evaluate` or Node REPL tool. Read-only observations are fixed protocol operations. No cookie migration, persistent login-state redesign, upload/download enablement, or recording subsystem in this change.
- New deployment-varying timeouts and snapshot limits are validated Config fields. Adopt the existing branded-ID, effect-registration, export JSDoc, localized UI, and face-specific TypeScript conventions.

<a id="task-execution"></a>

## Task execution

All paths in the task file maps are repository-relative. New paths and signatures are proposed, not existing APIs. Each task ends with its behavioral checks and a review checkpoint; no checkpoint is a substitute for the end-to-end acceptance in Task 6. Before modifying existing exports, run LSP references; before implementation, add each uncertain ownership/actionability regression and observe failure, then fix source and rerun the focused checks.

### Task 1: Typed transport and guest identity

**Files:** Create `packages/browser-use/browser-use-desktop/{package.json,tsconfig.json,src/types.ts,src/transport.ts,tests/transport.spec.ts}`. Modify `apps/desktop-host/{package.json,tsconfig.json,src/index.ts}`, `apps/desktop/{package.json,tsconfig.host.json,src/host-process.ts,src/host-protocol.ts,src/main.ts,src/browser-automation-protocol.ts}`, and root `tsconfig.host.json`; add the Host lifecycle tests. Add `apps/desktop-host/src/browser-transport.ts`.

**Project wiring:** Add project references for the new package in both app/Host TypeScript faces and the root Host aggregate. Add its direct runtime dependency to `apps/desktop-host` and type/build dependency to `apps/desktop`; generate package source aliases with `pnpm run gen-tsconfig-paths` and verify with `pnpm run verify-tsconfig-paths`.

**Interfaces:** The package publishes type-only `/types`; `desktopBrowserTransport` is a typed Host-provided capability installed through `runProfile.hostSetup` before the provider loads. Node IPC carries a tagged `browser/request`, `browser/result`, or `browser/cancel`; a trusted request carries session ID, live owner generation, request ID, and the validated operation. `AbortSignal` stays local and is represented across IPC by cancellation.

- [ ] Define the shared operation/result discriminants and exact validation before implementing either IPC endpoint. Use branded tab/snapshot IDs and derive caller identity outside model parameters.

```text
DesktopBrowserTarget = { tabId: DesktopBrowserTabId, generation: number }
DesktopBrowserCaller = { sessionId: SessionId, ownerGeneration: number }
DesktopBrowserTransport.request(caller, operation, signal): Promise<DesktopBrowserResult>
DesktopBrowserTransport.releaseOwner(caller): Promise<void>
TabInfo = { target, url, title, active, ownership: "user" | "agent", attached: boolean }
SnapshotResult = { target, snapshotId, text, truncated: boolean }
```

- [ ] Add correlated request handling in `DesktopHostProcess`, with validation in `isDesktopHostEvent`; extend the Host lifecycle protocol version and its release metadata together. Reject orphan, duplicate, late, or wrong-generation results without dispatching another action.
- [ ] Install transport in `apps/desktop-host/src/index.ts` before composition activation, not after `await application`. The transport must reject missing/disconnected Electron main, abort queued work, and drain its request registry on shutdown.
- [ ] Regenerate package aliases and verify with `pnpm run verify-tsconfig-paths`; confirm both Desktop Host and Desktop main TypeScript references include the new package.
- [ ] Cover crossed Session targets, wrong live owner generation, IPC disconnect, canceled queued requests, and a late reply after disposal. Run the new focused transport spec and the affected `apps/desktop/tests/host-process.spec.ts` checks; retain only observable failure/ownership tests.

**Review checkpoint:** No model-controlled identity fields, no network listener, no guest Electron/Node exposure, and no pending promise survives Host exit.

### Task 2: Sidebar tab discovery, opening, and ownership

**Files:** Modify `packages/client/ui-sidebar-browser/src/{types.ts,client/index.ts,client/browser/BrowserController.ts,client/electron/ElectronWebViewImpl.ts,client/electron/pages.ts}`, `apps/desktop/src/{browser-guests.ts,preload-browser.ts,ipc.ts,main.ts}`. Add `packages/client/ui-sidebar-browser/src/client/electron/automation.ts` and `apps/desktop/tests/browser-automation-tabs.spec.ts`; extend `electron-lifecycle.client.spec.ts` and `browser-controller.client.spec.ts` under the UI package.

**Interfaces:** Consume Task 1 caller/target definitions. The renderer coordinator accepts only main-issued, correlated commands; it returns the Sidebar tab identity and the lease that main has actually attached. Main owns authoritative Session → tab → lease → guest membership; workspace partition identity is storage grouping, not permission to operate every Session in that workspace.

- [ ] Extend lease acquisition with caller Session/tab metadata and validate every new process boundary. Register user-created Browser tabs as discoverable only within their Session. Assign generation on guest attachment; invalidate on navigation, replacement, or close.
- [ ] Open through `sidebarRight` and `BrowserController`, await the lease attachment before success, and return observed URL/title rather than the submitted address alone. Require a fully attached guest for snapshot/action, not merely an allocated lease.
- [ ] Reuse only a verified current-Session tab. Default URL reuse prefers exact URL, then a same-hostname target explicitly authorized for navigation; `newTab: true` always makes a separate tab. Do not navigate or reload an already exact-match page solely because a model turn restarted.
- [ ] Keep background Session commands addressed to that Session. Opening a page in a foreground Session reveals its Browser pane; work in a background Session must not steal the user's active Session or act on the foreground tab. Return visibility facts honestly and retain mounted guests for screenshots.
- [ ] Correlate allowed HTTP(S) popup requests with the source Session and action request; enumerate newly created tabs before retrying a click. Keep native popup denial, blocked POST-body popup behavior, Host-origin blocking, and existing URL restrictions.
- [ ] On owner disposal revoke claims and abort/drain work; leave user-visible tabs available for handoff. Explicit `browser_close` goes through Sidebar close and awaits guest destruction. Renderer crash rejects all affected handles; restart shows restore state rather than silently restoring logged-in Chromium state.
- [ ] Prove that two Sessions sharing a CWD cannot control each other's tabs; close during attach does not leak a guest; a user popup stays in the source Session; hidden/background tabs do not redirect work to the active tab. Run the named lifecycle/controller specs plus the new tab spec.

**Review checkpoint:** The visible Sidebar page and operated guest are the same page; a lease alone never counts as an opened tab.

### Task 3: DOM semantics and real guest interaction

**Files:** Add `apps/desktop/src/{browser-automation.ts,browser-dom-engine.ts,browser-input.ts}`, `apps/desktop/scripts/prepare-browser-dom.ts`, `apps/desktop/tests/browser-automation.e2e.ts`, and `apps/desktop/tests/fixtures/browser-automation-page.html`. Modify `apps/desktop/package.json`, its build/resource assembly, and the existing guest owner only where needed to hand a verified guest to the executor.

**Interfaces:** Consume an owner-checked live guest from Task 2; return typed snapshot/read/action/wait/screenshot results to Task 1. The main process chooses fixed engine scripts and input commands; model arguments are serialized data, never concatenated into executable source. Use the audited ZCode path: private CDP `Page.createIsolatedWorld` plus `Runtime.evaluate` for the pinned injected DOM engine, and trusted input dispatch. Sandbox/contextIsolation do not require exposing a guest preload API; validate compatibility in the real-guest probe.

- [ ] Before broad implementation, run a throwaway probe on an actual sandboxed Sidebar guest, including the packaged `devTools: false` setting: read the snapshot, resolve a role/name locator, deliver real input, and capture the resulting page. Confirm hidden/retained guest capture and input. Failure is a design stop, not permission to open a remote-debugging port or weaken guest isolation.
- [ ] Pin `playwright-core` exactly to the audited engine version (initial candidate `1.59.1`, matching ZCode); extract its generated injected DOM engine during build and package the immutable asset. Do not rely on a private npm export at runtime or maintain a second hand-written ARIA-name algorithm. Fail asset generation if the expected engine exports are missing.
- [ ] Inspect the narrow ZCode snapshot/locator/input adapters before porting. Preserve Playwright-derived accessible names, roles, visibility, strict cardinality, actionability and open-shadow semantics. Keep Apache notices and modification attribution for any actual copied code; do not copy the 180 KB browser manager or ZCode workspace imports.
- [ ] Bind refs to `snapshotId`, tab generation, document/frame identity and engine node membership. Return a clear stale-target error after navigation/remount or invalid membership; never retarget a stale ref to a different element. Frame traversal must use main-authorized frame identities; unsupported frame cases return an explicit limitation, not a fabricated empty page. Snapshot and ref actions share one isolated-world engine instance per document/frame; do not copy ZCode normalization that strips refs if the AsterHub tool returns refs.
- [ ] Implement actual click/double-click/fill/type/press/check/uncheck/select/hover/scroll/drag through the same guest input path, not `element.click()` or event-dispatch shortcuts. Wait for visible, enabled, unique, non-occluded targets; respect keyboard/IME behavior. Use private `webContents.debugger` input where necessary, with lease-scoped attachment and teardown; never expose raw debugger commands.
- [ ] Implement fixed text/attribute/visible/enabled/checked reads and concrete URL/load/element waits. Coordinate actions require a screenshot ID from the same target generation and CSS-pixel viewport mapping; reject stale or out-of-bounds coordinates. Capture a transient-state screenshot in the same operation as action + concrete wait when explicitly requested.
- [ ] Prove real behaviors with a port-0 loopback fixture: duplicated labels fail strict selection; a delayed form is fillable; a covered button is not clicked through; Unicode input reaches the app; open shadow DOM is observed; an iframe target belongs to the correct frame; popup results are discoverable; canvas input matches screenshot coordinates; a post-navigation old ref fails. Keep tests deterministic, with per-test profiles/ports and awaited Electron shutdown.

**Review checkpoint:** Input exercises the frontend event path; screenshot/DOM truth comes from the actual Sidebar guest, including packaged and hidden-window behavior.

### Task 4: Model tools, policy, and durable evidence

**Files:** Add `packages/browser-use/browser-use-desktop/src/{index.ts,tools.ts,presentation.ts}` and `tests/{tools.spec.ts,lifecycle.spec.ts}`. Modify the new package manifest for production dependencies and the existing skill/tool-result adapters only if a required extension cannot be expressed through their current APIs.

**Interfaces:** Inject `browserUse`, `tools`, `systemPrompt`, `desktopBrowserTransport`, and `attachments`. Use existing `ImageAttachmentRef` for the `AttachmentRef` shorthand below. Register `BrowserUseProviderName("desktop-internal")` through an ordered effect. Tool parameters do not include caller identity; schemas below define the public operations, with structured canonical results and existing attachment references.

```text
browser_tabs() -> { backend: "desktop-internal", capabilities, tabs: TabInfo[] }
browser_open({ url, newTab?: boolean }) -> TabInfo
browser_snapshot({ target }) -> SnapshotResult
Locator = { snapshotId, ref } | { snapshotId, role, name, exact: true }
browser_read({ target, locator, property: "text"|"attribute"|"visible"|"enabled"|"checked", attribute?: string }) -> { target, value }
browser_act({ target, locator, action: "click"|"doubleClick"|"fill"|"type"|"press"|"check"|"uncheck"|"select"|"hover", text?: string, keys?: string[], values?: string[], observe?: Observation }) -> { target, delivered, observation? }
browser_act({ target, screenshotId, action: "click"|"doubleClick"|"move"|"scroll"|"drag", x?, y?, deltaX?, deltaY?, path?, observe?: Observation }) -> { target, delivered, observation? }
Observation = { wait?: WaitCondition, screenshot?: boolean }
WaitCondition = { kind: "load", state: "domcontentloaded" } | { kind: "url", url } | { kind: "element", locator, state: "visible"|"hidden"|"enabled"|"checked" }
browser_wait({ target, condition: WaitCondition }) -> { target, matched: true }
browser_screenshot({ target }) -> { target, screenshotId, image: AttachmentRef, viewport }
browser_close({ target }) -> { tabId, closed: true }
```

- [ ] Implement exact discriminated parameter branches: fill/type require text, press requires keys, select requires values; attribute reads require an attribute name; pointer actions require appropriate coordinates/path. Validate finite coordinates, generation/ref membership, and required observation fields at tool/IPC parsing boundaries.
- [ ] Register each operation with the standard tool executor, so native calls and PTC calls use the same approvals and logs. A state-changing call never retries itself. Distinguish delivered input from verified outcome; infrastructure/timeouts are visible errors with current target facts when obtainable.
- [ ] Store screenshots through the existing attachment path, admit images only for image-capable model routes, and keep model-visible text/image references reconstructable from the Session log. Return an honest diagnostic when vision is unavailable; do not claim visual testing completed.
- [ ] Design pure generic Host presenters plus bounded persisted result metadata: backend, URL/title, operation, target and attachment reference. Product UI copy is localized. Use the existing generic Client tool card unless a necessary result fact cannot be shown there; no new presenter registry.
- [ ] Add a fixed prompt instruction pointing to the shipped control-browser and web-gui-tester skills. The prompt names actual tools and default backend; it does not promise unsupported upload/download, recording, arbitrary evaluation, or headless fallback.
- [ ] Cover policy denial with zero delivered input; stale target/ref rejection; owner disposal with queued work; screenshot image-route admission; durable result replay; tool registration rollback; duplicate-provider rejection. Do not test raw parameter copying or incidental wording.

**Review checkpoint:** Tool results are replayable, policy cannot be bypassed by PTC, and live tab control does not require any private ZCode runtime.

### Task 5: Shipped workflows and Desktop-only composition

**Files:** Add `packages/browser-use/browser-use-desktop/src/skills.ts` and `assets/{control-browser,web-gui-tester}/SKILL.md`. Modify `packages/bundle/asterhub-desktop-native/{package.json,cordis.patch.yml}` and Desktop runtime dependency metadata only where the DOM asset must be included. Regenerate tsconfig/catalog outputs with their existing generators, never by editing generated tables.

**Interfaces:** Consume Task 4 tools and the existing `ctx.skills.registerProvider`/bundled-rank mechanism used by `packages/skill/skill-office/src/index.ts`. Skills are product runtime assets, not merely repository `.agents/skills` instructions. Mount the provider only in the Desktop native bundle.

```yaml
# Proposed insertion in the Desktop-only native bundle.
- id: browser-use
  name: "@deepseek-ai/dsh-browser-use"
- id: browser-use-desktop
  name: "@deepseek-ai/dsh-browser-use-desktop"
  config:
    operationTimeoutMs: 3000
    navigationTimeoutMs: 30000
    snapshotMaxChars: 50000
```

- [ ] The YAML is the proposed row content, not the whole patch file: insert it using the existing bundle overlay syntax and avoid duplicating any pre-existing registry row. Config validators require positive integers; snapshot truncation must be explicit in returned evidence. The exact values are deployment defaults, not hidden constants.
- [ ] Author control-browser instructions against the eight real tools in Task 4. Include discovery, explicit backend selection, current-tab inspection, exact/same-host reuse, wait/snapshot/strict targeting, one action then verification, popup observation, stale-target recovery, canvas screenshots, user-tab handoff, and refusal reporting. Do not copy ZCode's fresh-kernel bootstrap or unsupported API names.
- [ ] Author web-gui-tester with P0 main flow, P1 feedback, P2 boundaries and P3 layout; distinguish environment preparation from formal GUI testing. Formal testing only uses normal frontend interactions, checks semantic state and actually viewed screenshots, records blocked/unsupported cases separately, and never changes the code under test or forces a failed flow to pass.
- [ ] Register model/user invocation metadata and copy assets into both development and packaged runtime closure. Adapt upstream prose with retained licenses only when copying it; new prose describes AsterHub tools and restrictions. Public webpage interactions prefer this browser over Computer Use, except when the user explicitly chooses Computer Use or a desktop-native target.
- [ ] Test assembled Desktop prompt/tool/skill discovery, not only skill file presence. Web/headless/SDK compositions must not receive the Desktop provider. An explicit external-provider profile replacement disables the Desktop provider row and its guidance before enabling one external provider; duplicate activation fails clearly.

**Review checkpoint:** A customer installation discovers the skills and actual tools without repository developer instructions, browser installation, a CDP endpoint, or a second model API key.

### Task 6: End-to-end acceptance and release documentation

**Files:** Add `apps/desktop/tests/fixtures/browser-automation-smoke.mjs` and extend `apps/desktop/tests/browser-automation.e2e.ts` from Task 3. Add a recorded-session case under the repository snapshot ownership rules, plus a provider-owned expected-output case if attachment/GUI results are not Session snapshots. Update paired `packages/browser-use/browser-use-desktop/README*`, `packages/client/ui-sidebar-browser/README*`, `docs/subsystems/browser-use*`, `apps/desktop/README*` and the relevant package-group README. Add an upgrade guide for the Desktop default change under the current unreleased version.

- [ ] Build the changed Host/Client faces and launch through the actual `dsh`-owned Desktop profile, using `pnpm run dev:desktop` for a development smoke and a packaged development artifact for the production guest flags. Start services through the process supervisor; use isolated Desktop userData, Harness home, workspace and loopback fixture port.
- [ ] Run a real model request: "Open this local test page in the built-in browser, fill the form, submit it and verify the success notice." Inspect the actual Sidebar guest, durable tool/result events and screenshot. Confirm no system browser is launched and no private state is exposed to another Session. Real-model verification is not replaced by a mock response or manually calling only the provider.
- [ ] Run the GUI-test workflow on the same fixture: success form, a disabled/covered control, popup/new tab, transient notice, iframe/shadow target and canvas. Produce passed/failed/blocked/unsupported results with viewed screenshot evidence. Verify reporting of a genuine page failure without JavaScript, API, refresh or alternate-browser bypass.
- [ ] Exercise a user-opened tab, two concurrent Sessions with the same workspace, Session switching, Sidebar collapse, explicit tab close, cancellation after input delivery, renderer loss and app restart. Input already delivered is not rolled back; failed/uncertain outcomes require fresh observation. A turn end keeps source/result pages.
- [ ] Record the required real-server/model-flow GIF for the product GUI change. Verify Windows and macOS guest behavior; do not describe unrun platforms as passing. Lack of credentials or platform access is an explicit release blocker for the corresponding acceptance item, not a fabricated pass.
- [ ] Update docs to distinguish built-in Desktop automation from external provider modes and non-automatable Web iframes. State supported actions and existing upload/download/permissions limitations. Record paired docs and regenerate affected tool/config/Cordis catalogs. Remove throwaway probes only after the smoke succeeds.

**Planned checks, not executed during planning:**

```sh
pnpm exec vitest run packages/browser-use/browser-use-desktop/tests apps/desktop/tests/host-process.spec.ts apps/desktop/tests/browser-automation-tabs.spec.ts packages/client/ui-sidebar-browser/tests
pnpm run build
pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/browser-automation.e2e.ts
pnpm run test:snapshot -- -t desktop-built-in-browser
pnpm run test:docs
pnpm run doc-sync
```

The new snapshot case is named `desktop-built-in-browser`. Electron e2e tests must actually execute, not self-skip. Run focused checks once after integration; use dsh-pre-push-checks to select outgoing checks rather than defaulting to the full coverage suite. Build artifact checks consume the built outputs; unit checks resolve source.

**Review checkpoint:** All acceptance rows below have actual evidence, the default is packaged, and replay does not require a live browser.

<a id="acceptance-and-handoff"></a>

## Acceptance and handoff

| Requirement | Owner | Evidence |
|---|---|---|
| Desktop uses the user-visible built-in page | Tasks 2, 5, 6 | Real model flow and matching Sidebar guest |
| Snapshot-derived targeting and no blind action retry | Tasks 3, 4, 5 | Duplicate/covered/stale target fixture and recorded trajectory |
| Same-workspace Sessions cannot cross-operate | Tasks 1, 2, 4 | Rejected cross-Session action and unchanged other page |
| Popups, frames, shadow DOM and canvas use observed targets | Tasks 2, 3, 6 | Real guest observations, input result and screenshots |
| Tool approvals and durable visual evidence survive replay | Tasks 4, 6 | Denied action sends no input; replayed text/image references |
| Web/dev-web remains unchanged | Task 5 | Assembled profile comparison, no Desktop tool registration |
| No external browser dependency or public CDP endpoint | Tasks 1, 3, 6 | Installed runtime closure and actual launch observation |
| GUI tests report failures without bypassing frontend behavior | Tasks 5, 6 | Viewed screenshot report and real-model GIF |

Tasks 1 and 2 share identity/protocol files and must be integrated by one owner. After those interfaces settle, Task 3 engine work and Task 4 tool/attachment work can run concurrently with those exact definitions. Task 5 skills can be drafted alongside them but must use the final tool schemas. Task 6 starts after integration. Do not run whole-project validation while sibling edits are in flight.

Implementation stops for redesign if the sandboxed/packaged guest cannot support the chosen DOM/input mechanism without a public debugging endpoint, if Session identity cannot be validated at main, or if required durable screenshot projection is unavailable. Resolve the underlying prerequisite before resuming; do not ship a prompt-only or external-browser substitution.

<a id="evidence-sources"></a>

## Evidence sources

Existing local ownership: `apps/desktop/src/browser-guests.ts`, `preload-browser.ts`, `host-process.ts`; `apps/desktop-host/src/index.ts`; `packages/client/ui-sidebar-browser/src/types.ts` and `client/index.ts`; `packages/browser-use/browser-use/src/index.ts`; `packages/bundle/asterhub-desktop-native/cordis.patch.yml`. These were source-inspected, not runtime-tested during planning.

- [ZCode control-browser workflow](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md)
- [ZCode web-gui-tester workflow](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/web-gui-tester/SKILL.md)
- [ZCode browser bridge](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/node-repl-host/src/browser-bridge.ts)
- [ZCode isolated-world DOM snapshot executor](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightDomSnapshot.ts)
- [ZCode frame-aware locator and trusted-input executor](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightLocatorExecutor.ts)
- [ZCode Playwright injected DOM source loader](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/playwrightInjectedScriptSource.ts)

These URLs track upstream main and can change. At execution, record the reviewed upstream revision in the dependency/third-party owner, inspect licenses for every copied file, and rerun the DOM/input probe against the selected Electron and engine versions. An API called Playwright does not imply a separate browser process or a public CDP port; private in-process CDP may still be an implementation detail.

## Dev Note

The user approved Desktop-first integration and requested this executable plan. No implementation, product runtime validation, dependency installation, or source commit is performed by creating this plan.
