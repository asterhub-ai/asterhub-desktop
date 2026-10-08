---
description: "Desktop-only browser-use provider operating AsterHub's built-in Sidebar Browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-use-desktop

English | [中文](README.zh.md)

## Summary

This package provides the Desktop-only built-in browser automation provider for AsterHub. It registers the exclusive `desktop-internal` browser-use provider and eight model-visible tools that operate the user-visible Desktop Sidebar Browser through offscreen rendering and trusted input.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a desktop-native Cordis composition alongside the browser-use registry:

```yaml
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-browser-use-desktop'
  config:
    operationTimeoutMs: 3000
    navigationTimeoutMs: 30000
    snapshotMaxChars: 50000
    readResultMaxChars: 50000
```

The plugin injects `browserUse`, `tools`, `agents`, `desktopBrowserTransport`, and `attachments`. It registers eight tools for the live Agent:

1. `browser_tabs` — list open tabs in the Sidebar Browser for the current Session.
2. `browser_open` — navigate or open a new tab.
3. `browser_close` — close a specific tab target.
4. `browser_snapshot` — capture accessible DOM text and assigned refs.
5. `browser_read` — read fixed element properties (text, attribute, visible, enabled, checked).
6. `browser_act` — execute semantic or coordinate pointer actions with optional observation.
7. `browser_wait` — await page load, URL match, or element state.
8. `browser_screenshot` — capture viewport PNG bytes and store a durable image attachment.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider serializes operations per live Session through an in-memory queue. It derives trusted caller identities from the calling Agent and Host metadata, never accepting caller or Session identities from model arguments.

When capturing screenshots, the tool verifies model image capability before requesting pixels. Stored screenshot bytes are committed through `ctx.attachments.saveImage()` and referenced as durable image attachments.

Text outputs are capped by `snapshotMaxChars` and `readResultMaxChars` within the 1,000,000-character transport ceiling, explicitly reporting truncation when truncated.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser use](../../../docs/subsystems/browser-use.md) — provider selection and Session ownership.
- [Sidebar Browser client package](../../client/ui-sidebar-browser/README.md) — renderer canvas, presentation, and accessible mirror.
- [Desktop shell package](../../../apps/desktop/README.md) — Electron main-process offscreen window ownership and guests.

-----

<a id="model-experience"></a>
## Model Experience

The provider exposes eight tools for precise web inspection and manipulation. Tool schemas describe exact parameters and discriminated locators.

#### KV Cache effect

Tool schemas are registered once when the provider loads and remain fixed in the system prompt prefix. Tool call results contain structured text and image attachments.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Desktop runtime requirement** — this provider requires the Electron desktop shell with `desktopBrowserTransport`; it cannot run in web or headless CLI profiles.
- **Single active browser backend** — registering this provider claims the exclusive `browserUse` slot, preventing third-party MCP browser providers from registering concurrently.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
