# Desktop Built-in Browser Use Implementation Plan

English | [中文](2026-10-06-desktop-built-in-browser-use.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task ends with an independently verifiable deliverable.

**Goal:** Make browser operations and webpage testing use the same built-in Desktop Sidebar Browser that the user sees, using ZCode-style observation, targeting, interaction, and verification.

**Architecture:** A Desktop-only Browser Use provider calls the typed Host transport. Main owns one hidden offscreen BrowserWindow per verified Session/tab lease; the same WebContents supplies page state and DOM/input, while paint frames are mirrored into the existing Sidebar Browser canvas. A bounded semantic DOM mirror provides screen-reader access. No public CDP endpoint, guest preload, or second page instance.

**Tech Stack:** Cordis, TypeScript ESM, Electron offscreen BrowserWindow/WebContents and paint events, Sidebar canvas plus semantic DOM mirror, pinned Playwright DOM semantics, existing tool/attachment services, Vitest.

**Spec:** [Desktop offscreen BrowserWindow mirror design](../specs/2026-10-07-desktop-offscreen-browser-mirror-design.md)

## Summary

Deliver a real model-to-Sidebar operation path, not a prompt-only preference. The offscreen BrowserWindow is the one page shown in the Sidebar canvas and operated by the model; the same lease, Session, and workspace-storage rules apply. Preserve the existing Web/dev-web providers, product isolation policy, approvals, and single-provider registration. Completion requires real Electron, packaged guest, accessibility, and model-flow evidence.

## Table of Contents

- [Approved design](#approved-design)
- [Global constraints](#global-constraints)
- [Task execution](#task-execution)
- [Acceptance and handoff](#acceptance-and-handoff)
- [Evidence sources](#evidence-sources)

<a id="approved-design"></a>

## Approved design

Desktop defaults to the built-in Browser provider. Web/dev-web retains its existing provider; cross-origin iframes are not an automation backend. External Desktop providers remain explicit profile replacements, not concurrent providers or silent fallbacks.

This plan does not activate AsterHub's experimental Computer Use packages or port ZCode's separate Computer Use flow. Built-in Browser handles webpages; Computer Use remains a separate capability for explicitly requested or desktop-native work when configured.

The approved [offscreen BrowserWindow mirror design](../specs/2026-10-07-desktop-offscreen-browser-mirror-design.md) makes one hidden offscreen `BrowserWindow` the sole page instance for each verified `(Session, Sidebar tab)` lease. Its `WebContents` is the source for DOM operations, trusted input, screenshots, and the pixels shown in the Sidebar canvas. A structured semantic DOM mirror supports screen-reader navigation; it uses refs from that same page snapshot.

The renderer creates and activates Sidebar tabs. Electron main creates, owns, authorizes, and destroys each offscreen BrowserWindow. Frame messages are lease- and generation-bound, coalesced, and bounded. No public CDP endpoint, guest preload, duplicate page, or model-invocable JavaScript is introduced.

Learn the workflow and narrow execution primitives from ZCode; do not import its agent loop, Node REPL host, authentication platform, credential importers, or complete browser manager. PTC already exposes registered tools through `tools.<name>`; do not introduce another JavaScript executor.

### Workflow to preserve

1. Discover the actual backend and its supported operations. Check current Session tabs by ID, URL, title, and active status; never choose a tab by array position or remembered handle.
2. Reuse the exact target tab; reuse a same-hostname tab only when navigating it is authorized. Otherwise create a Sidebar tab for the calling Session. Never repurpose a tab belonging to another Session with the same workspace.
3. Wait for a concrete page state, using DOMContentLoaded as the navigation baseline. Read a DOM/ARIA snapshot and derive locators from its facts; fail on ambiguous targets rather than picking the first match.
4. Perform one state-changing action, then inspect the expected outcome. Popup verification checks model-owned and user-created tabs in the same Session. A timeout means re-observe, not repeat the action or switch browsers.
5. Ordinary tasks prefer semantic observations; visual tasks, canvas targeting, and GUI tests use screenshots from the same offscreen `WebContents`. Formal GUI testing does not use page-side scripts, direct API requests, or forced interactions to bypass the behavior under test.
6. Preserve source/result pages after a turn; only explicit tab closure destroys them. Release model control on live Agent disposal, not the user's entire workspace browser storage. Reconnection never claims that previous page memory was restored.
## Global constraints

- Each lease owns exactly one offscreen BrowserWindow and its `WebContents`. The Sidebar canvas is a pixel mirror of that page, never a second page or separately navigated copy.
- Offscreen BrowserWindows use `show:false`, `offscreen:true`, `devTools:false`, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, no preload, and `webSecurity:true`. Keep `webviewTag:false` on offscreen guests; the primary renderer no longer uses `<webview>` after cutover.
- Use the workspace in-memory partition for storage grouping, but validate owner, Session, Sidebar tab, lease, and target generation before every operation and frame delivery. A page in one Session cannot be operated or read by another Session sharing its workspace.
- Use caller identity from `exec.agent` and trusted Host metadata. The model cannot supply Session/workspace identity, lease, WebContents ID, IPC channel, CDP method, script, or endpoint.
- Keep exactly one `ctx.browserUse` registration. Do not add a multi-provider selector or production dependency on `packages/experimental`.
- Treat page content as untrusted. Existing approval policy applies to consequential actions; a page or model cannot grant approval. Host-level identity validation supplements rather than replaces tool approvals.
- Use existing durable tool results and attachment storage. Do not persist raw base64, live leases, paint-frame streams, or Chromium state in Session events. Declare any actual persistence-type change under the repository policy.
- Cap screenshot and live-frame IPC payloads at 32 MiB, preserve bytes as `Uint8Array`, reject oversized images, keep at most one pending frame per lease, and discard superseded frames.
- Cap browser text at `MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS` (1,000,000) before IPC; validate `snapshotMaxChars` and `readResultMaxChars` at or below that ceiling. Return at most 256 tab entries and set `truncated` when more exist.
- User tab clicks and page scripts can race automation. Serialize provider work per live Session; generation-fence stale targets, frames, and snapshots. A successful input dispatch is not proof of the requested result.
- Keep the canvas `aria-hidden`; build its visually hidden semantic DOM mirror from the same bounded page snapshot. Expose the mirror only for the active visible Sidebar pane. Stale refs are never redirected to another node.
- No arbitrary `evaluate` or Node REPL tool. Read-only observations are fixed protocol operations. No cookie migration, persistent login-state redesign, upload/download enablement, or recording subsystem in this change.
- New deployment-varying timeouts and snapshot/read-result limits are validated Config fields. Adopt branded IDs, effect registration, export JSDoc, localized UI, and face-specific TypeScript conventions.
## Task execution

All paths in the task file maps are repository-relative. Each task ends with behavioral checks and a review checkpoint; Task 7 owns end-to-end acceptance. Before modifying existing exports, run LSP references. Before implementation, add each uncertain ownership/actionability regression, observe its failure, then fix source and rerun the focused checks.

### Task 1: Typed transport and guest identity

**Files:** Create `packages/browser-use/browser-use-desktop/{package.json,tsconfig.json,src/{index.ts,types.ts,protocol.ts,transport.ts},tests/transport.spec.ts}`. Modify `apps/desktop-host/{package.json,tsconfig.json,src/index.ts}`, `apps/desktop/{package.json,tsconfig.host.json,src/{host-process.ts,host-protocol.ts,browser-automation-protocol.ts}}`, root `tsconfig.host.json`, and the hand-maintained subpath entries in `tsconfig.base.json`; add Host lifecycle tests. Add `apps/desktop-host/src/browser-transport.ts`.

**Project wiring:** Add project references for the new package in Desktop Host and Desktop main; the root Host aggregate references its Host project. `apps/desktop-host` owns the direct runtime dependency. `apps/desktop` owns direct build/runtime bundle dependencies, including `dsh-brand`. Bare aliases are generated by `gen-tsconfig-paths`; `/types`, `/protocol`, and `/transport` export targets point to their emitted `lib/types/*.js` files. Verify the workspace install and `pnpm run verify-tsconfig-paths`.

**Interfaces:** The package publishes type-only `/types`; `desktopBrowserTransport` is a typed Host-provided capability installed through `runProfile.hostSetup` before the provider loads. Node IPC carries `browser/request`, `browser/result`, or `browser/cancel`; requests carry Host-derived Session/owner generation, a monotonic safe-integer request ID, and the validated operation. `AbortSignal` stays local and is represented across IPC by cancellation. The tool call rejects on local cancellation; `releaseOwner` awaits the terminal parent result or IPC disconnection so no disposed owner leaves admitted main-process work. Use V8 advanced serialization so screenshots cross both process directions as `Uint8Array` rather than base64 copies.

- [x] Define the shared operation/result discriminants and exact validation before implementing either IPC endpoint. Use branded tab/snapshot IDs and derive caller identity outside model parameters.

```text
DesktopBrowserTarget = { tabId: DesktopBrowserTabId, generation: DesktopBrowserTargetGeneration }
DesktopBrowserCaller = { sessionId: SessionId, ownerGeneration: DesktopBrowserOwnerGeneration }
DesktopBrowserTransport.request(caller, operation, signal): Promise<DesktopBrowserResult>
DesktopBrowserTransport.releaseOwner(caller): Promise<void>
TabInfo = { target, url, title, active, ownership: "user" | "agent", attached: boolean }
DesktopBrowserOperation = { kind: "tabs.list" } | { kind: "tabs.open", url, newTab? } | { kind: "tabs.close", target } | { kind: "page.snapshot", target } | { kind: "page.read", target, locator, property, maxChars, attribute? } | { kind: "page.act", target, locator, action, text?, keys?, values?, observe? } | { kind: "page.actAt", target, screenshotId, action, x?, y?, deltaX?, deltaY?, path?, observe? } | { kind: "page.wait", target, condition } | { kind: "page.screenshot", target }
DesktopBrowserValue includes { kind: "tabs", tabs: TabInfo[], truncated } and { kind: "read", target, value, truncated } variants.
DesktopBrowserResult = { status: "success", value: DesktopBrowserValue } | { status: "error", code, message }
SnapshotResult = { target, snapshotId, text, truncated: boolean }
DesktopBrowserScreenshot = { target, screenshotId, bytes: Uint8Array, viewport: { width, height } }
MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES = 32 * 1024 * 1024
MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS = 1_000_000; MAX_DESKTOP_BROWSER_TABS = 256
```

- [x] Add correlated request handling in `DesktopHostProcess`, with validation in `isDesktopHostEvent`; extend the Host lifecycle protocol version and its release metadata together. Reject orphan, duplicate, late, or wrong-generation results without dispatching another action.
- [x] Install transport in `apps/desktop-host/src/index.ts` before composition activation, not after `await application`. The transport rejects missing/disconnected Electron main, aborts queued work, and drains its request registry on shutdown.
- [x] Regenerate package aliases and verify with `pnpm run verify-tsconfig-paths`; both Desktop Host and Desktop main TypeScript references include the new package.
- [x] Cover crossed Session targets, wrong live owner generation, IPC disconnect, canceled queued requests, late replies after disposal, and out-of-order responses. Verify screenshot bytes survive child-process IPC round trips as `Uint8Array`; reject oversized screenshots, text, and tab inventories. Add the required `truncated` flag to every `page.read` fixture so Host typecheck passes.

**Review checkpoint:** No model-controlled identity fields, no network listener, no guest Electron/Node exposure, and no pending promise survives Host exit.

### Task 2: Sidebar tab discovery, opening, and ownership

**Files:** Modify `packages/client/ui-sidebar-browser/src/{types.ts,client/index.ts,client/browser/BrowserController.ts,client/electron/ElectronWebViewImpl.ts,client/electron/pages.ts}`, `apps/desktop/src/{browser-guests.ts,preload-browser.ts,ipc.ts,main.ts}`, root `tsconfig.client.json`, and `apps/desktop/tests/keyboard.spec.ts`. Add `packages/client/ui-sidebar-browser/src/client/electron/automation.ts` and `apps/desktop/tests/browser-automation-tabs.spec.ts`; extend the Sidebar Browser lifecycle/controller and Sidebar Right session-view specs.

**Interfaces:** Consume Task 1 caller/target definitions. The renderer coordinator accepts only main-issued, correlated commands; it returns the Sidebar tab identity and the lease that main has actually attached. Main owns authoritative Session → tab → lease → guest membership; workspace partition identity is storage grouping, not permission to operate every Session in that workspace.

- [x] Extend lease acquisition with caller Session/tab metadata and validate every new process boundary. Register user-created Browser tabs as discoverable only within their Session. Assign generation on guest attachment; invalidate on navigation, replacement, or close.
- [x] Open through `sidebarRight` and `BrowserController`, await lease attachment before success, and return observed URL/title rather than only the submitted address. Require a fully attached guest for snapshot/action, not merely an allocated lease.
- [x] Reuse only a verified current-Session tab. Exact URL matches do not reload; same-hostname navigation requires explicit authorization; `newTab: true` creates a separate tab.
- [x] Keep background Session commands addressed to that Session. Opening in a foreground Session reveals its Browser pane; background work does not steal the user's active Session or act on the foreground tab. Return visibility facts honestly and retain mounted bodies.
- [x] Correlate allowed HTTP(S) popup requests with the source Session and action request; enumerate new tabs before retrying clicks. Keep native popup denial, blocked POST-body popups, Host-origin blocking, and current URL restrictions.
- [x] On owner disposal revoke claims and abort/drain work; leave user-visible tabs available for handoff. Explicit `browser_close` goes through Sidebar close and awaits guest destruction. Renderer crash rejects affected handles; restart shows restore state without claiming Chromium memory was restored.
- [x] Prove same-workspace Sessions cannot cross-control tabs; close during attach does not leak a guest; user popup stays in source Session; hidden/background work does not redirect to the active tab. Run the focused lifecycle/controller and tab tests.

**Review checkpoint:** The visible Sidebar page and operated guest are the same page; a lease alone never counts as an opened tab.

### Task 3: Offscreen BrowserWindow and Sidebar canvas

**Files:** Modify `apps/desktop/src/{browser-guests.ts,preload-browser.ts,ipc.ts,main.ts}`, `packages/client/ui-sidebar-browser/src/{types.ts,client/index.ts,client/browser/BrowserController.ts,client/browser/BrowserPage.ts,client/electron/pages.ts,client/view/BrowserBody.tsx,client/view/Browser.module.css}`, `apps/desktop/package.json`, `apps/desktop/tsconfig.host.json`, and `tsconfig.client.json`. Replace the private `client/electron/ElectronWebViewImpl.ts` and `ElectronWebviewPresentation.ts` adapters with `OffscreenBrowserImpl.ts` and `OffscreenCanvasPresentation.ts`. Extend `apps/desktop/tests/{browser-automation-tabs.spec.ts,keyboard.spec.ts}` and `packages/client/ui-sidebar-browser/tests/{electron-lifecycle.client.spec.ts,browser-body.client.spec.tsx}`.

**Interfaces:** Electron main creates one offscreen `BrowserWindow` per validated `(owner, Session, Sidebar tab)` lease. The workspace partition stays main-private; the renderer receives only the lease. The Client defines a matching `BrandedNumber<'DesktopBrowserTargetGeneration'>` alias without depending on the Desktop provider package. The bridge owns navigation/history commands, page-state events, viewport updates, and coalesced paint frames.

```text
DesktopBrowserReservation = { lease: DesktopBrowserLeaseId }
DesktopBrowserViewport = { cssWidth: number; cssHeight: number }
DesktopBrowserPageState = { url?: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: { code?: number; description?: string } }
DesktopBrowserTargetGeneration = BrandedNumber<'DesktopBrowserTargetGeneration'>
DesktopBrowserFrame = { lease: DesktopBrowserLeaseId; generation: DesktopBrowserTargetGeneration; sequence: number; png: Uint8Array; pixelSize: { width: number; height: number }; viewport: DesktopBrowserViewport }
DesktopBrowserCanvasInput = { kind: "pointer"; type: "move" | "down" | "up"; x: number; y: number; button?: "left" | "middle" | "right" } | { kind: "pointer"; type: "wheel"; x: number; y: number; deltaX: number; deltaY: number } | { kind: "key"; type: "down" | "up"; key: string; code: string; modifiers: readonly string[] } | { kind: "text"; text: string }
DesktopBrowserBridge.dispatchInput(lease: DesktopBrowserLeaseId, input: DesktopBrowserCanvasInput): Promise<void>
DesktopBrowserBridge.acquire(workspace, sessionId, tabId): Promise<DesktopBrowserReservation>
DesktopBrowserBridge.release(lease): Promise<void>
DesktopBrowserBridge.navigate(lease, url): Promise<void>
DesktopBrowserBridge.goBack(lease): Promise<void>
DesktopBrowserBridge.goForward(lease): Promise<void>
DesktopBrowserBridge.reload(lease): Promise<void>
DesktopBrowserBridge.setViewport(lease, viewport): Promise<void>
DesktopBrowserBridge.onPageState(lease, listener): () => void
DesktopBrowserBridge.onFrame(lease, listener): () => void
DesktopBrowserBridge.onOpenRequested(lease, listener): () => void
DesktopBrowserBridge.onAutomationRequest(listener): () => void
```

- [x] Add failing owner/lifecycle regressions: one valid lease creates one hidden BrowserWindow in the workspace partition; a second Session cannot resolve or operate it; release during startup destroys it and settles pending work. Frame tests reject a wrong owner/lease, stale generation, malformed payload, and PNG over 32 MiB.
- [x] Run `node node_modules/pnpm/bin/pnpm.mjs exec vitest run apps/desktop/tests/browser-automation-tabs.spec.ts apps/desktop/tests/preload-app.spec.ts`; confirm the new lease/window and frame cases fail for the expected missing behavior.
- [x] Create offscreen BrowserWindows with `show:false`, `skipTaskbar:true`, `offscreen:true`, `backgroundThrottling:true`, `devTools:false`, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`, and no preload. Reuse the main-owned workspace partition. Deny permissions and native windows, keep current URL restrictions, and set `webviewTag:false` for the new windows. Remove the primary `<webview>` path and set the primary window's `webviewTag` false after confirming no other renderer creates a webview.
- [x] Replace the `webview` acquisition/teardown handshake with main-owned BrowserWindow creation and destruction. Attach existing shortcut input guards to the offscreen WebContents; bind page state and popup reporting to the lease; release and await the BrowserWindow on tab/owner disposal.
- [x] Forward `paint` as a lease/generation-correlated PNG frame. Main retains one latest NativeImage per lease, encodes only for a subscribed canvas or screenshot, and keeps at most one unsent frame; a newer paint replaces an older pending frame. Apply `setViewport` from the Browser body's ResizeObserver without reloading the page.
- [x] Render frames in the existing Sidebar Browser body with a canvas; use its current layout and Browser CSS tokens, not a new visual treatment. Scale the image to its committed CSS viewport and map pointer coordinates back to that same viewport. Mark the canvas `aria-hidden`; Task 4 adds the screen-reader DOM mirror.
- [x] Forward canvas pointer, keyboard, and text/IME input through `dispatchInput` only while the canvas owns focus; validate the live lease in main and keep toolbar shortcuts and conversation input outside the page-input path.
- [x] Test paint forwarding/unsubscribe, stale frame rejection, viewport resize, hidden latest-frame retention, owner/session isolation, and input not reaching the conversation composer. Run the focused Desktop/Browser test files and `node node_modules/typescript/bin/tsc -b apps/desktop/tsconfig.host.json packages/client/ui-sidebar-browser/tsconfig.client.json packages/client/ui-sidebar-right/tsconfig.json --pretty false`.
- [x] Measure encoded frame bytes and PNG conversion time for static, animated, and image-heavy loopback pages at 800×600 and 1280×820. Verify 32 MiB rejection and one-pending-frame-per-lease coalescing on Windows and macOS.
- [x] Before Task 4 or Task 5, build and launch the integrated Desktop profile with isolated `userData`, Harness home, workspace, and loopback fixture. With packaged guest preferences, verify the Sidebar canvas, private isolated-world DOM/name read, trusted input, and screenshot use the same lease-owned `WebContents`; confirm hidden paint, Session isolation, popup/permission policy, and no public CDP endpoint. Stop before DOM-engine or model-tool work if any check fails. If `build:lib:host` still fails on the current Browser-tab API/test mismatch, or the root Client aggregate still fails on the reported `SessionStore`/`ClientSessions` types, obtain an owner-approved repair first; do not substitute direct package builds or the standalone prototype.

**Review checkpoint:** The same offscreen `WebContents` supplies Sidebar pixels, page state, DOM operations, trusted input, and screenshots; hidden frame capture does not select or reveal another Session.

### Task 4: DOM semantics, trusted input, and accessible mirror

**Files:** Add `apps/desktop/src/{browser-automation.ts,browser-dom-engine.ts,browser-input.ts}`, `apps/desktop/scripts/prepare-browser-dom.ts`, `apps/desktop/tests/{browser-dom-engine.spec.ts,fixtures/browser-automation-page.html}`, and `packages/client/ui-sidebar-browser/tests/browser-body.client.spec.tsx`. Modify `apps/desktop/{package.json,src/{browser-guests.ts,ipc.ts,main.ts,preload-browser.ts},tests/browser-automation.e2e.ts}` and `packages/client/ui-sidebar-browser/src/{types.ts,client/electron/OffscreenBrowserImpl.ts,client/view/BrowserBody.tsx,client/view/Browser.module.css}`.

**Interfaces:** Consume the lease-checked offscreen `WebContents` from Task 3 and return Task 1's typed snapshot/read/action/wait/screenshot results. The Client declares matching `Branded<...>` aliases locally, avoiding a dependency on the Desktop provider package. The semantic DOM mirror receives a separate bounded tree from the same Playwright snapshot; it is renderer-only and never adds model-visible data unless a registered tool returns it.

```text
DesktopBrowserSnapshotId = Branded<"DesktopBrowserSnapshotId">
DesktopBrowserRef = Branded<"DesktopBrowserRef">
DesktopBrowserAccessibleNode = { snapshotId: DesktopBrowserSnapshotId; ref?: DesktopBrowserRef; role: string; name: string; text?: string; value?: string; states: string[]; children: DesktopBrowserAccessibleNode[] }
DesktopBrowserAccessibleSnapshot = { lease: DesktopBrowserLeaseId; snapshotId: DesktopBrowserSnapshotId; generation: DesktopBrowserTargetGeneration; nodes: DesktopBrowserAccessibleNode[]; truncated: boolean }
DesktopBrowserBridge.onAccessibleSnapshot(lease: DesktopBrowserLeaseId, listener: (snapshot: DesktopBrowserAccessibleSnapshot) => void): () => void
DesktopBrowserBridge.accessibleAction(lease: DesktopBrowserLeaseId, snapshotId: DesktopBrowserSnapshotId, ref: DesktopBrowserRef, action: DesktopBrowserAccessibleAction): Promise<void>
DesktopBrowserAccessibleAction = { kind: "focus" | "click" | "check" | "uncheck" } | { kind: "fill" | "type"; text: string } | { kind: "press"; keys: string[] } | { kind: "select"; values: string[] }
```

- [x] Add failing DOM-engine tests for duplicate role/name matches, stale refs after navigation, ref membership, and the 10,000-node/1,000,000-character accessibility-tree cap; truncated nodes are not interactive.
- [x] Pin `playwright-core` exactly to `1.59.1`. Extract its generated injected DOM engine during build and package the immutable asset. Do not rely on private npm exports, hand-write ARIA naming, or copy the browser manager. Inspect the exact ZCode adapter files and licenses before copying source.
- [x] Implement one private isolated-world engine per offscreen `WebContents` document/frame. Bind every ref to snapshot ID, lease generation, document and authorized frame; reject ambiguous targets, unsupported frame traversal and stale/nonmember refs. Expose no arbitrary `evaluate` or raw debugger method.
- [x] Implement fixed text/attribute/visible/enabled/checked reads, concrete URL/load/element waits, and click/double-click/fill/type/press/check/uncheck/select/hover/scroll/drag through trusted input. Wait for visible, enabled, unique, non-occluded targets; respect keyboard/IME behavior. Coordinate actions require the same lease generation and screenshot ID and map CSS pixels to the current viewport.
- [x] Return bounded structured accessibility nodes with inert text values; never render page text as HTML. Keep the canvas `aria-hidden` and expose the visually hidden semantic mirror to accessibility APIs only for the active Sidebar pane. Screen-reader focus, activation, and input use snapshot refs and lease-checked operations; stale refs leave the focus order.
- [x] Refresh and invalidate the semantic tree after navigation and completed actions; include a coalesced mutation observer for dynamic page changes. Cap each tree at 10,000 nodes and 1,000,000 cumulative string characters, mark truncation, and omit refs from truncated nodes. Keep hidden/background Session content out of the renderer's accessibility tree.
- [x] Prove duplicate labels reject strict selection; delayed forms accept fill; covered buttons are not clicked through; Unicode input reaches the app; open shadow DOM and authorized iframe nodes are observed; popup targets are discoverable; stale refs fail after navigation; semantic mirror actions reach only their current page. Run the focused engine and renderer tests.

**Review checkpoint:** The model and screen reader navigate the same lease-owned page; accessible nodes contain no executable markup and cannot outlive their snapshot.

### Task 5: Model tools, approvals, and durable screenshots

**Files:** Add `packages/browser-use/browser-use-desktop/src/{provider.ts,tools.ts}` and `tests/{provider.spec.ts,tools.spec.ts}`. Modify `packages/browser-use/browser-use-desktop/{package.json,tsconfig.json,src/{index.ts,types.ts}}` and its English/Chinese README pair.

**Interfaces:** Export the Cordis plugin's `name`, `inject`, `Config`, and `apply` from the package root. Inject `browserUse`, `tools`, `agents`, `desktopBrowserTransport`, and the existing attachment service. Inside one `ctx.effect()`, register the sole provider as `desktop-internal` and its eight tools; Task 6 adds skill registration to this same plugin. Derive caller/target identity from Task 2 and invoke only Task 1's typed transport operations.

```text
browser_tabs() -> { backend: "desktop-internal"; tabs: DesktopBrowserTabInfo[]; truncated: boolean }
browser_open({ url: string; newTab?: boolean }) -> DesktopBrowserTabInfo
browser_close({ target: DesktopBrowserTarget }) -> { target: DesktopBrowserTarget; closed: true }
browser_snapshot({ target: DesktopBrowserTarget }) -> { target; snapshotId; text; truncated }
browser_read({ target; locator; property; attribute? }) -> { target; value: string | boolean | null; truncated }
browser_act({ target; locator; action: DesktopBrowserSemanticAction; text?; keys?; values?; observe? } | { target; screenshotId; action: DesktopBrowserPointerAction; x?; y?; deltaX?; deltaY?; path?; observe? }) -> { target; delivered; observation?; screenshot? }
browser_wait({ target: DesktopBrowserTarget; condition: DesktopBrowserWaitCondition }) -> { target; matched: true }
browser_screenshot({ target: DesktopBrowserTarget }) -> { target; screenshotId; image: ImageAttachmentRef; viewport }
```

- [x] Derive Session identity from the live `exec.agent` and trusted Host metadata; assign a monotonic owner generation to each live agent and never accept caller, Session, workspace, lease, WebContents, or generation values from model arguments. Serialize operations per live Session. Release each owner on Agent disposal and drain owner work when the provider unloads.
- [x] Validate the four deployment-varying limits in provider Config: `operationTimeoutMs`, `navigationTimeoutMs`, `snapshotMaxChars`, and `readResultMaxChars`. Text limits must be positive integers no greater than the transport's 1,000,000-character ceiling; reject invalid config at load.
- [x] Pass `readResultMaxChars` as `page.read.maxChars`; truncate `page.snapshot` text to `snapshotMaxChars` before model exposure and set its `truncated` flag. The 1,000,000-character transport ceiling remains enforced before IPC.
- [x] Define strict discriminated schemas for every tool. `browser_read` attribute reads require `attribute`; `fill`/`type` require `text`; `press` requires `keys`; `select` requires `values`; pointer click/doubleClick/move require x/y, scroll requires x/y and deltaX/deltaY, and drag requires at least two path points. Reject non-finite or out-of-viewport coordinates before transport.
- [x] Map each tool to one supported `DesktopBrowserOperation`; preserve its typed canonical result and truncation flags. Require fresh target IDs for every invocation. `browser_act` dispatches one action and optionally observes a concrete wait/snapshot/screenshot; a timeout or uncertain delivery tells the model to re-observe, never to repeat the action or switch backends.
- [x] Use the normal `ctx.tools` execution, approval, cancellation, and PTC dispatch paths; no parallel tool loop or special approval bypass. A denied action dispatches no page input. Cancellation drains through the transport and does not claim that already-delivered input was rolled back.
- [x] Store screenshot bytes through the existing attachment API and return only bounded attachment references plus target, viewport, and screenshot ID. Route image content only to image-capable models; report unsupported vision instead of claiming a visual assessment. Do not serialize raw image bytes, base64, live frames, cookies, or page contents outside the declared text/screenshot results.
- [x] Add behavior tests for live-agent caller identity, per-Session serialization, approval denial before input, invalid action arguments rejected before input, coordinate bounds, cancellation/owner release, stale targets, explicit truncation, screenshot attachment presentation, and unsupported-vision reporting. Verify the same tool schemas reach native invocation and PTC without a second executor.

**Review checkpoint:** Eight tools expose only the typed browser protocol; approvals and cancellation stay in the existing tool pipeline, and screenshot results replay from durable attachments.

### Task 6: Desktop skills and composition wiring

**Files:** Add `packages/browser-use/browser-use-desktop/src/skills.ts`, `assets/{control-browser,web-gui-tester}/SKILL.md`, and `apps/desktop/tests/desktop-browser-profile.spec.ts`. Modify `packages/browser-use/browser-use-desktop/{package.json,src/provider.ts}` to ship the skill assets and register the skill provider; modify `packages/bundle/asterhub-desktop-native/{package.json,cordis.patch.yml}`. Add Desktop skill paths to `apps/desktop/package.json` only if its package closure requires explicit inclusion; Task 4 owns the Playwright engine asset and dependency entries. Regenerate tsconfig/catalog outputs with their existing generators, never by editing generated tables.

**Interfaces:** Extend the Task 5 plugin's `inject`/`apply` to register skills through `ctx.skills.registerProvider` and the bundled-rank mechanism used by `packages/skill/skill-office/src/index.ts`. Keep the skill contribution in the same Desktop provider; do not reserve a second `ctx.browserUse` slot. Skills are product runtime assets, not repository-only `.agents/skills` instructions.

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
    readResultMaxChars: 50000
```

- [x] Insert these rows using the existing bundle overlay syntax; avoid duplicating any existing registry row. Config validates both text limits against the IPC ceiling, and truncation is explicit in returned evidence. Values shown here are deployment defaults, not hidden constants.
- [x] Write `control-browser` against the eight named tools in Task 5. Cover backend discovery, current-tab inspection, authorized exact/same-host reuse, concrete waits, snapshot-derived strict targeting, one action followed by verification, popup discovery, stale-target recovery, screenshot use, user-tab handoff, and refusal reporting. Do not copy ZCode's fresh-kernel bootstrap or unsupported API names.
- [x] Write `web-gui-tester` with P0 main flow, P1 feedback, P2 boundaries, and P3 layout. Separate environment preparation from formal GUI testing. Formal tests use normal frontend interactions, inspect semantic state and viewed screenshots, record blocked/unsupported cases separately, and never mutate the code under test or bypass a failed flow.
- [x] Package and resolve the skill assets in development and packaged runtime closures. Retain upstream licenses only for source actually copied; new instructions describe AsterHub's actual tools and limits. Public web tasks use this Browser. For desktop-native tasks or explicit requests, invoke Computer Use only if a user-configured provider is available; otherwise report it unavailable and do not silently switch.
- [x] Test assembled Desktop prompt/tool/skill discovery, not just file presence. Web, dev-web, headless and SDK compositions must not receive the Desktop provider. Replacing it with an external provider requires disabling the Desktop row and its guidance first; duplicate activation fails clearly.

**Review checkpoint:** A customer installation discovers the bundled skills and actual tools without repository developer instructions, browser installation, a public debugging endpoint, or a second model API key.

### Task 7: End-to-end acceptance and release documentation

**Files:** Add `apps/desktop/tests/fixtures/browser-automation-smoke.mjs`; extend `apps/desktop/tests/{browser-automation.e2e.ts,browser-automation-tabs.spec.ts}` and the relevant Sidebar accessibility/browser-body tests. Add a recorded-session case under repository snapshot ownership, plus a provider-owned expected-output case if attachment/GUI results are not Session snapshots. Update paired `packages/client/ui-sidebar-browser/README*`, `docs/subsystems/browser-use*`, `apps/desktop/README*`, and the relevant package-group README. Add a Desktop default-change upgrade guide under the current unreleased version.

- [ ] Re-run the Task 3 packaged guest proof on the final artifact and verify its evidence still covers the exact released flags. Run the integrated real-model, Sidebar, attachment-replay, GUI-test, and lifecycle flows below only after the Task 3 gate has passed.
- [ ] Build and launch with `pnpm run dev:desktop`; create a directory package with `pnpm run package:desktop:win:x64:dir` on Windows or `pnpm run package:desktop:mac:arm64:dir` / `pnpm run package:desktop:mac:x64:dir` on macOS. Use the actual `dsh`-owned Desktop profile with isolated Desktop `userData`, Harness home, workspace, and loopback fixture port. Exercise both the development app and packaged artifact with `devTools:false`; Electron e2e tests must run and must not self-skip.
- [ ] Run a real model request: "Open this local test page in the built-in browser, fill the form, submit it, and verify the success notice." Inspect the actual Sidebar canvas, durable tool/result events, and screenshot attachment. Confirm no system browser launches and no private page state crosses Sessions. Use only a test credential explicitly authorized for this verification; if none is available, block this acceptance item. Do not substitute a mock response or direct provider call.
- [ ] Run the GUI-test skill on the same fixture: success form, disabled/covered control, popup/new tab, transient notice, authorized iframe, open shadow target, and canvas. Produce passed/failed/blocked/unsupported results with actually viewed screenshot evidence; report a real page failure without JavaScript, direct API, refresh, or alternate-browser bypass.
- [ ] Verify screen-reader/keyboard navigation, focus, activation, and text input through the semantic mirror in the real Sidebar; confirm input cannot reach the conversation composer. Exercise a user-opened tab, two same-workspace Sessions, Session switching, Sidebar collapse, explicit tab close, cancellation after delivery, renderer loss, and app restart.
- [ ] Record the required real-server/model-flow GIF. Verify Windows and macOS guest behavior; mark unrun platforms or unavailable model credentials as blockers, not passes. No credential enters source control.
- [x] Update user documentation for built-in Desktop versus external providers, non-automatable Web iframes, supported actions, and existing upload/download/permission limits. Regenerate affected tool/config/Cordis catalogs and remove throwaway probes only after the real smoke succeeds.

**Verified checks:** The Node-environment focused suite passed 65 tests; the browser automation e2e file passed 3 tests, including isolated-world snapshot/read/fill with main-process `document` unavailable. The multi-package TypeScript build and Desktop bundle build passed. Seven named bilingual document pairs passed translation pairing. `gen-config-catalog.ts` and `gen-tool-catalog.ts` updated their outputs.

**Remaining Task 7 acceptance blockers:** The real Electron smoke fixture timed out at `app.whenReady()` after 45 seconds; an earlier trace reached `server-ready` but not `electron-ready`, and an isolated-userData retry also timed out. I launched the normal Desktop development app and submitted the user-authorized test login; the sign-in panel closed. The built-in Browser received HTTP 200 for the local fixture, but the Sidebar still displayed its generic page-load failure over a blank canvas, so the real Browser flow failed and must be debugged before release. The model selector remained `请选择模型`; no model action was run. No real guest screen-reader, cross-Session, macOS, or GIF evidence was collected. The isolated-world regression is a jsdom-backed Electron mock, not a real guest. The 20-file aggregate test run had 7 jsdom setup failures (`No such built-in module: node:`); 13 files and 78 tests passed. `gen-cordis-catalog.ts --check` is blocked by three missing `@mode` tags in `packages/schedule/asterhub-automation/src/index.ts`; `test:docs` also fails on unrelated markdown-wrap and type-equivalence entries.

**Executed focused checks:**

```sh
vitest run packages/browser-use/browser-use-desktop/tests apps/desktop/tests/host-process.spec.ts apps/desktop/tests/browser-automation-tabs.spec.ts apps/desktop/tests/browser-dom-engine.spec.ts apps/desktop/tests/desktop-browser-profile.spec.ts packages/client/ui-sidebar-browser/tests
tsc -b packages/browser-use/browser-use-desktop/tsconfig.json apps/desktop/tsconfig.host.json packages/client/ui-sidebar-browser/tsconfig.client.json packages/client/ui-sidebar-right/tsconfig.json --pretty false
vitest run --config vitest.e2e.config.ts apps/desktop/tests/browser-automation.e2e.ts
pnpm --filter @deepseek-ai/dsh-desktop run bundle
verify-translation-pairing.ts <seven changed bilingual document pairs>
```


**Review checkpoint:** Pending. Real Electron smoke, end-to-end UI/model acceptance, cross-platform verification, and replay evidence remain unverified.

<a id="acceptance-and-handoff"></a>

## Acceptance and handoff

| Requirement | Owner | Evidence |
|---|---|---|
| Desktop uses the user-visible built-in page | Tasks 2, 3, 5, 7 | Real model flow and matching Sidebar guest |
| Snapshot-derived targeting and no blind action retry | Tasks 4, 5, 6, 7 | Duplicate/covered/stale target fixture and recorded trajectory |
| Same-workspace Sessions cannot cross-operate | Tasks 1, 2, 3, 5, 7 | Rejected cross-Session action and unchanged other page |
| Popups, frames, shadow DOM and canvas use observed targets | Tasks 2, 3, 4, 7 | Real guest observations, input result and screenshots |
| Tool approvals and durable visual evidence survive replay | Tasks 5, 7 | Denied action sends no input; replayed text/image references |
| Web/dev-web remains unchanged | Task 6 | Assembled profile comparison, no Desktop tool registration |
| No external browser dependency or public CDP endpoint | Tasks 1, 3, 7 | Installed runtime closure and actual launch observation |
| Screen-reader actions stay in the active Sidebar page | Tasks 3, 4, 7 | Real Sidebar accessibility tree, focus/input routing and isolation |
| GUI tests report failures without bypassing frontend behavior | Tasks 6, 7 | Viewed screenshot report and real-model GIF |

Tasks 1 and 2 are complete with focused tests green. Task 3 must pass its integrated packaged guest proof before Task 4 DOM-engine work or Task 5 model tools begin. Task 6 can draft against the named tool contract but must use final schemas. Task 7 starts after Tasks 3–6 are integrated. Do not run whole-project validation while sibling edits are in flight.

Implementation stops for redesign if the sandboxed/packaged guest cannot support the chosen DOM/input mechanism without a public debugging endpoint, if Session identity cannot be validated at main, or if required durable screenshot projection is unavailable. Resolve the underlying prerequisite before resuming; do not ship a prompt-only or external-browser substitution.

<a id="evidence-sources"></a>

## Evidence sources

Existing local ownership: `apps/desktop/src/browser-guests.ts`, `preload-browser.ts`, `host-process.ts`; `apps/desktop-host/src/index.ts`; `packages/client/ui-sidebar-browser/src/types.ts` and `client/index.ts`; `packages/browser-use/browser-use/src/index.ts`; `packages/bundle/asterhub-desktop-native/cordis.patch.yml`. These were source-inspected. A separate offscreen BrowserWindow prototype verified paint, DOM/AX access, trusted input, and screenshot capture; it did not exercise packaged startup or Sidebar integration. The [design spec](../specs/2026-10-07-desktop-offscreen-browser-mirror-design.md) records the limits of that evidence.

- [ZCode control-browser workflow](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md)
- [ZCode web-gui-tester workflow](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/web-gui-tester/SKILL.md)
- [ZCode browser bridge](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/node-repl-host/src/browser-bridge.ts)
- [ZCode isolated-world DOM snapshot executor](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightDomSnapshot.ts)
- [ZCode frame-aware locator and trusted-input executor](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightLocatorExecutor.ts)
- [ZCode Playwright injected DOM source loader](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/playwrightInjectedScriptSource.ts)

These URLs track upstream main and can change. At execution, record the reviewed upstream revision in the dependency/third-party owner, inspect licenses for every copied file, and rerun the DOM/input probe against the selected Electron and engine versions. An API called Playwright does not imply a separate browser process or a public CDP port; private in-process CDP may still be an implementation detail.

## Dev Note

Tasks 1 and 2 are complete and verified with focused tests. Tasks 3–7 describe the remaining implementation and acceptance work; the standalone offscreen prototype does not satisfy the integrated packaged-guest checkpoint.
