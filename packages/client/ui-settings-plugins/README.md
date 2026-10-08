---
description: "Curated plugins settings section for AsterHub: the Settings navigation entry and the tab chrome that feature-owned tabs register into."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

English | [中文](README.zh.md)

## Summary

Use **Curated plugins** in Settings to browse and install packages selected for AsterHub. The section owns the navigation entry and tab row; feature plugins contribute the pages. The shipped page reads the verified server catalogue, not the Host Loader inventory.

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

Open **Curated plugins** in Settings. [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) contributes the signed server catalogue as the section's one page; a second registered contribution adds a tab row. A deployment whose composition contributes no tab shows the section's empty line.

To contribute a tab, register into `settings.plugins.tab` with an `id`, an `order`, and a localized `label`; the section renders the entries in order and mounts a tab on its first selection. Feature copy stays in the registering plugin's dictionary.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section declares `settings.plugins.tab`, a root list slot whose labels become ordered tabs. A lone contribution renders as the page itself, and a tab stays mounted after its first selection so page state survives switching. The section projects the slot ledger into ordered rows whose labels follow the active locale, cached until the ledger version or locale revision changes. The Host half has no behavior; its Loader row makes the browser implementation available.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) — the signed server catalogue page.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section`.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page where official plugins are configured.
- [ui-settings-shell](../ui-settings-shell/README.md), [ui-settings-agent-loop](../ui-settings-agent-loop/README.md), [ui-settings-subagent](../ui-settings-subagent/README.md), [ui-settings-web-search](../ui-settings-web-search/README.md) — the official configuration pages, one companion package each.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The section has no tab of its own** — it renders its empty line until a feature plugin registers one; the shell cannot fill the section alone.
- **Runtime invariant:** No companion is published. The section owns no relationship beyond the slot ledger it projects.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
