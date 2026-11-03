---
description: "AsterHub curated plugin catalog tab over the verified server catalogue."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-catalog

English | [中文](README.zh.md)

## Summary

AsterHub curated plugin catalog restored as a standalone fork client plugin: a Plugins-page tab plus the Settings curated-plugins tab, both backed by the signature-verified `pluginManager.curatedCatalog()` Host remote. Ported from the pre-merge embedded curated section and the pre-merge `ui-settings-plugin-inventory` curated tab.

## Behavior

The tab contributes `asterhub-catalog` through the `plugins.tab` slot of `@deepseek-ai/dsh-client-ui-plugin-manager`. It fetches the verified catalogue on mount and renders loading, unavailable, and empty states; each entry card shows the name, summary, and version, with an Install button whose label follows the Host-computed install status. Installing sends the exact catalogue facts (`id`, `revision`, `package`, `version`, `integrity`, `artifactUrl`) to `pluginManager.installCuratedBundle()`; a `stale-approval` result reports the catalogue change and refetches, applied changes confirm and refetch, and every other outcome reports failure. All copy lives in the `asterhubCatalog` locale dictionary. Envelope verification and catalogue parsing stay Host-side; this package renders verified entries only.
