---
kind: upgrade-guide
description: "The settings-general package no longer registers a built-in Open configuration file header action; the action component, store, and locale keys are removed."
---

# Settings removes the built-in Open configuration file action

English | [中文](guide.zh.md)

## Change

In v0.2.0-rc.2, `@deepseek-ai/dsh-client-ui-settings-general` registers an **Open configuration file** header action for loopback browsers. It calls the Host-owned `settings/openSettingsDocument` RPC.

The next release removes this built-in action and the `SettingsDocumentStore`, `SettingsDocumentState`, `SettingsDocumentActionInjected`, and `SettingsDocumentActionProps` browser exports. The `openDocument` and `openDocument.error` locale keys are removed from `settings`. The `settings.action` slot remains available for feature-owned controls.

The Host-side `settings/openSettingsDocument` RPC and the settings provider are unchanged; only the browser-side built-in consumer is gone.

## Migration

1. If your feature plugin registered a `settings.action` entry, it continues to work unchanged — the slot is still declared and rendered.
2. If you imported `SettingsDocumentStore` or its related types from `@deepseek-ai/dsh-client-ui-settings-general`, remove the import. The package no longer exports them.
3. If you referenced the `openDocument` or `openDocument.error` keys from the `settings` locale namespace, remove the reference; these keys no longer exist.
4. The `settings.action` slot is now empty by default. To offer a configuration-file action, register your own feature-owned entry into `settings.action`.
