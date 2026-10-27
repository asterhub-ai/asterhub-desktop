---
kind: upgrade-guide
description: "Use the built-in Desktop browser and migrate custom automation callbacks to request-ID cancellation."
---

# Desktop built-in browser automation

English | [中文](guide.zh.md)

## Change

AsterHub Desktop includes built-in browser automation for the right-Sidebar Browser. The previous Electron `<webview>` implementation is replaced by an Electron main-owned offscreen `BrowserWindow` mirror and canvas with an accessible screen-reader mirror.

Desktop compositions automatically mount `@deepseek-ai/dsh-browser-use` and `@deepseek-ai/dsh-browser-use-desktop` as the exclusive `desktop-internal` provider, registering eight typed model tools (`browser_tabs`, `browser_open`, `browser_close`, `browser_snapshot`, `browser_read`, `browser_act`, `browser_wait`, `browser_screenshot`) and two bundled skills (`control-browser`, `web-gui-tester`). Non-desktop profiles (Web, headless, SDK) retain their existing iframe presentation and external provider selections.

Custom `DesktopBrowserBridge` implementations must also update `onAutomationRequest`: its callback now accepts only the command, using `DesktopBrowserTabAutomationRequestHandler`. Cancellation arrives separately through `onAutomationCancel(requestId)`. Native `AbortSignal` objects no longer cross Electron's `contextBridge`; `DesktopBrowserTabAutomationHandler` still accepts a signal created within the Renderer.

## Migration

1. Preserve a backup of your Desktop profile configuration before upgrading.
2. The built-in browser automation activates automatically in the Desktop product. Visited web pages render onto the Sidebar canvas without requiring `<webview>` support, native browser installations, or public debugging endpoints.
3. If an existing profile patch explicitly mounts an external or experimental browser-use provider (such as Playwright MCP, Chrome DevTools MCP, or Stagehand), remove or disable that entry in your Desktop profile patch before activation; the shared browser-use service accepts only one active provider at a time.
4. Screen-reader users interact with web pages through the accessible DOM mirror rendered directly in the Sidebar pane. Keyboard shortcuts and toolbar interactions continue operating as before.
5. In custom profiles or test harnesses, configure deployment limits (`operationTimeoutMs`, `navigationTimeoutMs`, `snapshotMaxChars`, `readResultMaxChars`) under the `@deepseek-ai/dsh-browser-use-desktop` entry in `cordis.patch.yml`.
6. For custom bridge integrations, register a command-only `onAutomationRequest` callback and create a Renderer-local `AbortController` for each command's `requestId`. Pass its signal only to Renderer-local automation code.
7. Register `onAutomationCancel` to abort the matching controller. On disposal, abort pending operations and dispose both listeners.
8. Verify that a browser command completes, cancellation stops its pending operation, and disposal terminates outstanding requests without sending a native signal across `contextBridge`.
