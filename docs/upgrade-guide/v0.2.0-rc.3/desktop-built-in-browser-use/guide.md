---
kind: upgrade-guide
description: "Replace the Desktop Sidebar Browser webview with built-in offscreen browser automation and tools."
---

# Desktop built-in browser automation

English | [中文](guide.zh.md)

## Change

AsterHub Desktop includes built-in browser automation for the right-Sidebar Browser. The previous Electron `<webview>` implementation is replaced by an Electron main-owned offscreen `BrowserWindow` mirror and canvas with an accessible screen-reader mirror.

Desktop compositions automatically mount `@deepseek-ai/dsh-browser-use` and `@deepseek-ai/dsh-browser-use-desktop` as the exclusive `desktop-internal` provider, registering eight typed model tools (`browser_tabs`, `browser_open`, `browser_close`, `browser_snapshot`, `browser_read`, `browser_act`, `browser_wait`, `browser_screenshot`) and two bundled skills (`control-browser`, `web-gui-tester`). Non-desktop profiles (Web, headless, SDK) retain their existing iframe presentation and external provider selections.

## Migration

1. Preserve a backup of your Desktop profile configuration before upgrading.
2. The built-in browser automation activates automatically in the Desktop product. Visited web pages render onto the Sidebar canvas without requiring `<webview>` support, native browser installations, or public debugging endpoints.
3. If an existing profile patch explicitly mounts an external or experimental browser-use provider (such as Playwright MCP, Chrome DevTools MCP, or Stagehand), remove or disable that entry in your Desktop profile patch before activation; the shared browser-use service accepts only one active provider at a time.
4. Screen-reader users interact with web pages through the accessible DOM mirror rendered directly in the Sidebar pane. Keyboard shortcuts and toolbar interactions continue operating as before.
5. In custom profiles or test harnesses, configure deployment limits (`operationTimeoutMs`, `navigationTimeoutMs`, `snapshotMaxChars`, `readResultMaxChars`) under the `@deepseek-ai/dsh-browser-use-desktop` entry in `cordis.patch.yml`.
