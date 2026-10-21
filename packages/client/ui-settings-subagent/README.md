---
description: "The Subagent settings page on the dsh web client's Plugins page: delegation depth and capacity over the subagent namespace, and the models agents may choose over subagent-model-selection, on one page with one save."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

English | [中文](README.zh.md)

## Summary

Open **Settings → Subagent** to set delegation limits, a default child model, and the complex-task delegation preference. The Official group on the Plugins page also opens the same form. The page groups the two Host namespaces, `subagent` and `subagent-model-selection`, under one save; it exists while the Host serves either and shows the sections it serves.

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

**Limits** holds **Maximum recursion depth** and **Subagent parallelism limit** side by side, stacking on narrow screens; the information button beside each label discloses its rule — a two-row depth example, and the count that capacity bounds — and a draft that is not a whole number in range blocks the save and says so under the field. Depth yields to a tool's own maximum; capacity counts every live subagent under one main agent across all levels, the main agent excluded.

**Default subagent model** selects one current catalog route as the user-controlled model for subsequent delegations. The main-session model cannot override it. Clearing the default restores the existing tool defaults or parent inheritance. The executor validates the saved route and rejects unavailable routes rather than silently substituting another model. Model names show the account-facing provider label and model id, not the internal adapter route.

**Delegate complex tasks** stages the main-session decomposition and review preference. Both settings are persistent global preferences.

One **Save** writes both sections through their own namespaces, each fenced by the revision its draft read. The writes are independent: a section the Host refuses keeps its draft with the failure reported while the other lands, and a model draft a newer Host revision superseded is reported as a conflict to discard rather than overwriting the newer routes. Leaving the page drops every draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds each namespace through `ctx.configForms.get`: `SubagentLimitsCardController` stages the limits over the shared `SettingsFormModel` of `ui-primitives`, with a field spec that admits safe whole numbers at or above each field's floor; `SubagentModelSelectionCardController` keeps its own draft because the default route and delegation preference save as one revision-fenced `mutate`, joins saved defaults with `remote.session.modelCatalog()`, and re-reads the catalogue on `llm/adapters-updated` and `settings/document-updated` while a connection reset drops its draft. `subagentCardFace` composes the two into the one face `SubagentCard` renders inside the shared `SettingsForm`, whose save validates both and writes the dirty ones. The page registers into `settings.section` and the Plugins page's `plugins.item` through `ctx.configForms.whileServed` over both namespaces.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the limits section renders.
- [tool-subagent](../../subagent/tool-subagent/README.md) — the delegation tools that register both namespaces.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The catalogue re-reads on three signals only** — adapter changes, document commits, and reconnects; a provider that starts advertising without any of them shows up on the next of those or on **Retry**.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from the settings mirror and the model catalogue, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
