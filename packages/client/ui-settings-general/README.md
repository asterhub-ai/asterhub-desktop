---
description: "Settings shell, ownerless copy, and durable product-onboarding namespace for the dsh web client: the General section, trigger chrome, and onboarding ledger projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

## Summary

Use this package to give the web client a Settings panel, connection-recovery control, feature-contributed navigation, and sequential first-run onboarding. Users can open it from the sidebar and retry a failed connection immediately. Feature packages supply their own settings rows, sections, and onboarding steps; this package supplies their shared presentation, contributes the built-in current-version and developer-tools General rows, and does not add onboarding copy.

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

Users reach the shell through the sidebar's bottom Settings control; feature plugins contribute their pages and onboarding steps through the slot ledgers this shell projects. In both the expanded sidebar and collapsed rail, the control exposes the localized Settings label as its accessible name. A pale-yellow **Disconnected** action beside Settings indicates browser offline suspension; its permanent retry glyph marks the retry action, which the Chinese outage copy also names (连接异常，刷新重试). Every recovery attempt shows a spinner beside **Reconnecting** with one to three dots advancing every 500ms, and an attempt stays visible for at least 800ms so brief retries do not flicker. Selecting either yellow state starts an immediate retry; press feedback stays within the warning palette. Recovery changes the region to pale-green **Connected** for two seconds from the moment the green pill becomes visible. The pill fades in on appearance, fades out over 150ms on removal, and sizes to its current label. Initial startup and uninterrupted healthy operation remain silent. The shell renders the modal panel, the navigation built from `settings.section` entries, and exactly one mounted onboarding step at a time.

In Desktop, the account-row update control shows availability, progress, verification, readiness, and persistent retry feedback. The preload carries semantic phase, version, progress, and classified failures; the component resolves every visible and accessible string from the active `settings` locale, including after an in-application language change. Selecting an available update starts downloading; installation requires a separate shell-owned confirmation. A collapsed sidebar shows the same status as a dot on its top expand button. Connection feedback takes priority except during shell-reported installation, when the expected backend disconnect must not hide update status. Failure restores connection feedback. Both controls share one carrier subscription; browser code cannot choose packages or authorize installation. [Desktop updates](../../../apps/desktop/README.md) owns the release workflow.

### The General section

The General section holds rows registered into `settings.general.item`. This package contributes two built-in rows: the current-version row (which displays the compile-time version and, on Desktop with a native update bridge, a localized **Check for updates** button that invokes the main process's manual check-and-consent prompt) and the developer-tools toggle. Feature plugins contribute additional rows — the Appearance row, for example, lives in ui-theme. Concurrent clicks on the check button join the same interaction, and the button is absent in browsers without the bridge.

### Header actions

The shell keeps the `settings.action` slot available for feature-owned controls but registers no built-in header action.

### Onboarding steps

The onboarding ledger projects in ascending order and mounts exactly one step at a time. Registrants own durable completion, capability readiness, copy, mutations, and their visible wrapper, so independently registered flows cannot stack and the shell does not become a second configuration fact source. Visible steps own their dialog chrome and app-root `inert` lifecycle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell owns the chrome and the projections; every piece of content and copy belongs to a registrant.

### Ledger projections

The navigation is a projection of the `settings.section` ledger; nav labels may be locale-following thunks, resolved through `resolveSlotLabel` and re-rendered on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order; the active registrant receives its id, `complete()`, and an `openSection(id)` callback, and completing or skipping transfers ownership to the next entry.

### Connection recovery

The shell is an explicit recovery consumer, so it injects Connection directly rather than adding lifecycle controls to `ctx.remote`. Its private hooks compartment binds `ctx.connection.state`, while the component receives only the selected state and an injected callback for `ctx.connection.reconnect()`. `ConnectionIndicator` owns the inline presentation and receives all visible and accessible copy from the `settings` locale namespace; the shell owns the 800ms minimum-visible hold for the connecting state and the two-second recovered-state timer, which starts when the recovered pill becomes visible after the hold.

### Document availability

The settings header renders only feature-owned `settings.action` entries. The package does not register a local configuration-file action.

### Host half

The Host half registers `ui-onboarding` in the user-settings seam. The welcome step contributed by ui-settings-models reads and writes its `welcomeNoticeVersion` through the existing public settings boundary; the shell itself remains policy-free.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings surface family and the composition model.

- [ui-settings](../ui-settings/README.md) — the domain base whose slot types and scope service this shell builds on.
- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the `sidebar.settings` seat.
- [ui-settings-models](../ui-settings-models/README.md) — the feature package contributing the DeepSeek onboarding step.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the ledgers.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell itself provides versus what features must supply; they are current package constraints.

- **The General section has two built-in rows** — the current-version row and the developer-tools toggle. Feature-contributed rows (such as the Appearance row from ui-theme) appear only when their owning feature plugin is mounted; the shell alone does not fill the section with feature content.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings seam validates and publishes the durable onboarding section, while slot conflicts fail loud in the slot core. This package registers no built-in header action.
