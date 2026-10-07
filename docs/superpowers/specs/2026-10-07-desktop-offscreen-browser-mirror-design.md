# Desktop offscreen BrowserWindow mirror design
English | [中文](2026-10-07-desktop-offscreen-browser-mirror-design.zh.md)

**Status:** Proposed; authorized by the user for specification and plan review

**Scope:** Replace the Desktop Sidebar Browser's `<webview>` presentation with one main-owned offscreen `BrowserWindow` per Browser lease, displayed in the Sidebar as a canvas mirror.

## Goal

Keep the existing browser automation scope while supporting DOM inspection, trusted input, and screenshots when a Browser tab is not visible in the Sidebar. The operated page, the page shown in the Sidebar, and the page represented in screenshots must remain the same `WebContents`.

## Evidence

A real Desktop Sidebar `<webview>` guest supported `Page.createIsolatedWorld`, an Accessibility tree, trusted mouse and text input, and a visible `WebContents.capturePage()` screenshot. After collapsing the Sidebar, the guest remained alive but both `WebContents.capturePage()` and CDP `Page.captureScreenshot` timed out.

An actual offscreen `BrowserWindow` prototype used `show:false`, `offscreen:true`, `devTools:false`, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, and a loopback fixture. It emitted four `paint` frames, exposed a textbox named `Name`, accepted trusted input and click events, produced the fixture's success result, and returned an 800×600 PNG. This prototype did not exercise the packaged application or the Sidebar integration.

Electron documents offscreen paint on `BrowserWindow`. Setting `offscreen:true` on the existing `<webview>` guest did not load the page or emit paint events.

## Ownership and creation

Electron main remains authoritative for `(application window, Session, Sidebar tab) → lease → page`. Each lease owns one hidden `BrowserWindow` and its `WebContents`; no second page instance represents the same Browser tab.

The offscreen window uses the lease's workspace partition and the current URL restrictions, permission denials, popup policy, Session membership, navigation generations, and lease cancellation rules. The main process exposes only lease-bound Browser operations and image frames to the product renderer. It never exposes Electron objects or arbitrary CDP commands to the renderer or model.

The offscreen `BrowserWindow` has no preload and uses `show:false`, `offscreen:true`, `devTools:false`, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, and `webSecurity:true`. The host denies permissions and native windows, rejects unsupported schemes and credential-bearing URLs, and correlates permitted popups to the source lease.

## Sidebar presentation and frame delivery

The Browser body replaces its `<webview>` tag with a canvas. Main subscribes to the offscreen `WebContents` `paint` event and retains the latest `NativeImage` per lease. It sends lease- and generation-correlated frames to the Sidebar Browser presenter; the canvas scales them to the committed viewport while preserving the page's CSS-pixel coordinate mapping.

Frame delivery is bounded and coalesced. At most the newest frame is pending for each lease; a newer paint replaces an unsent frame. The renderer subscribes only while its Sidebar body is mounted. Hidden views continue updating the main-owned latest frame for screenshots without selecting or revealing their Session.

The frame encoding and transfer limit must be selected before implementation from measured Windows and macOS costs. The prototype's PNG output establishes correctness, not acceptable throughput. The frame path must not retain an unbounded sequence of full-page buffers.

## Page operations and results

The existing BrowserController continues to own the Session/tab identity, saved URL, navigation revision, and Sidebar lifecycle. Main applies navigation to the lease's offscreen `WebContents`. Playwright's generated injected DOM engine runs in a private isolated world for snapshots, strict locator resolution, reads, waits, and semantic actions. Trusted keyboard and pointer input is dispatched through that same `WebContents`; coordinate actions remain tied to a screenshot ID, lease generation, and CSS-pixel viewport.

Main uses `WebContents.debugger` only for lease-owned internal operations and detaches it before lease destruction. `devTools:false` does not expose a DevTools window or public remote-debugging endpoint. No model tool accepts an arbitrary script or raw debugger method.

The latest paint image supplies Sidebar presentation and screenshot results. A screenshot operation returns the current target and viewport with its image attachment; a missing or stale frame produces an explicit error rather than a claim that the last page state was captured.

## Lifecycle and isolation

Guest creation, attachment, paint subscriptions, debugger attachment, cancellation, and destruction remain lease-scoped. Opening or closing a Sidebar tab, Session disposal, application renderer loss, and Host cancellation revoke the corresponding lease and await owned work. A background Session's BrowserWindow remains bound to that Session even while its Sidebar view is hidden.

Each BrowserWindow uses the existing per-workspace in-memory session partition, so workspace storage remains grouped while page control and target IDs remain Session- and tab-scoped. Native popups are denied; approved HTTP(S) popups are reported through the source lease. Renderer loss or app restart does not restore a logged-in BrowserWindow implicitly; the existing restore state remains explicit.

## Accessibility and interaction consequences

The canvas is a pixel view, not a native DOM subtree. It does not automatically provide page text selection, browser-native context menus, or the page's accessibility tree to desktop screen readers. The Browser automation engine can expose its DOM snapshot to the model, but that is not an accessibility substitute for the user-facing Sidebar. The implementation must define an accessible user path before shipping; it must not present the canvas as equivalent to the native `<webview>` for assistive technology.

Keyboard and pointer events from the canvas must map to the same offscreen page without focusing or selecting a different Session. The design must preserve the Sidebar toolbar's existing localized labels and focus behavior. It must not silently forward browser input to the conversation composer when the page is hidden or unfocused.

## Verification before implementation

The first integration proof must create an offscreen BrowserWindow from a real Sidebar lease and use the packaged guest preferences. It must show that:

- one lease maps to one offscreen `WebContents`, and two Sessions sharing a workspace remain isolated;
- offscreen paint continues while the Sidebar is collapsed and returns a screenshot for the same target and generation;
- isolated-world snapshot and role/name resolution work with `devTools:false`;
- trusted input changes the loopback fixture while hidden, without changing the conversation draft or moving focus to another Session;
- popup denial, HTTP(S) navigation checks, permission denials, lease close, renderer loss, and app shutdown keep their existing behavior;
- frame coalescing and screenshot delivery remain bounded on Windows and macOS.

Do not begin the Playwright engine or model tools until the integrated, packaged guest passes this proof. If offscreen paint, input isolation, or the user-facing accessibility path fails, stop and revise this design rather than reintroducing a public debugging endpoint or silently reducing the approved scope.

## Risks

- Offscreen rendering is documented for `BrowserWindow`, not the current `<webview>` implementation. The packaged Sidebar integration must validate the real guest preferences and lifecycle.
- Frame copying and encoding can consume CPU, memory, and IPC bandwidth, particularly on animated pages and high-DPI displays.
- Replacing native web content with a canvas changes selection, screen-reader, and context-menu behavior.
- The offscreen prototype set `devTools:false` and attached through the private debugger, but did not exercise packaged startup or Desktop guest policy. The full Client aggregate currently fails on unrelated `SessionStore`/`ClientSessions` test type mismatches, so the packaged acceptance run remains unavailable.

## Non-goals

- No public CDP listener, external browser process, or second model API.
- No separate visible page and hidden automation page.
- No model-invocable JavaScript evaluation or raw debugger commands.
- No automatic Sidebar expansion, Session selection, or restoration of a logged-in BrowserWindow after restart.
