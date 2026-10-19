---
description: "Set an assistant nickname, personality preferences, reflection, and an account-available memory model in AsterHub Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-anima

English | [中文](README.zh.md)

## Summary

Open **Settings → Anima** to edit your assistant’s nickname, communication tone, explanation detail, initiative, humor, emotional response, familiarity, and joke style. Choose an extraction and reflection model from the current AsterHub account, or explicitly follow the conversation model. Reflection is the only feature switch; capture, recall, and memory writes default to enabled. Technical limits are not shown. Changes take effect after saving.

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

The Anima section appears while the Host serves its `anima` configuration namespace. Edit personality choices and select **Save**; **Discard changes** drops staged edits. The model dropdown uses the shared account catalog and writes its exact provider/model pair together. It has no free-text provider, URL, or credential fields. An unavailable saved model is shown explicitly and must be replaced before saving. Catalog failures retain edits and offer **Retry**. The **Use the current conversation model** option inherits the logged Session route without leaving an empty control.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser page binds the Host-owned `anima` namespace through `ctx.configForms.get` and registers a dedicated `settings.section` entry while that namespace is served. Its staged fields use the shared `SettingsFormModel`; localization belongs to this package. The shared model catalog refreshes with account, credential, and connection changes. The page presents configuration only and does not implement memory storage or model execution.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — shared settings scopes and served-namespace lifecycle.
- [ui-primitives](../ui-primitives/README.md) — staged settings form and field controls.
- [ui-settings-general](../ui-settings-general/README.md) — Settings navigation and page shell.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host route that future Anima review and reflection requests use; the Settings page does not dispatch a model call itself.

#### KV Cache effect

Saving a different route changes the model request identity and clears route-specific cache reuse on the next auxiliary call; edits with an unchanged route have no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The page edits the Host-provided settings document and depends on the Host to validate and apply these values.

- **Available account models only** — the page rejects a selected route absent from the current catalog; the Host retains its application model route restrictions. Personality preferences affect subsequent conversation turns, not application identity or permissions.
- **Runtime invariant:** No companion is published. This page has no independent mutable relationship; the configuration mirror and slot registry own its state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
