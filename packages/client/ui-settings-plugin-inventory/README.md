---
description: "Curated AsterHub plugin catalogue tab in Web Plugins settings for the dsh web client: verified server entries only, install with signed integrity, localized loading/empty/error/retry states."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

## Summary

The **Curated plugins** tab in the Plugins settings section shows only the entries of the signed AsterHub server catalogue. It never falls back to the Host's built-in Loader inventory: a provider missing, network failure, or empty catalogue renders its own localized state with a retry action. Each card shows the server-provided name, description, category, and version, and an Install button that sends the exact signed catalogue facts (id, revision, package, version, integrity, artifact URL) through `remote.pluginManager.installCuratedBundle()`.

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

Open the Plugins section in Settings and select the **Curated plugins** tab. The tab reads the catalogue lazily on first selection through `ctx.remote.pluginManager.curatedCatalog()`; the Remote call happens only when the tab mounts, never during plugin activation.

### Reading a card

Each card uses the server catalogue's name and description verbatim, shows the category when the server provides one, and the version. The Install button is disabled for entries the catalogue already marks installed and while any installation is in progress.

### Installing

Clicking Install sends the exact signed catalogue facts for that entry. A successful application (`applied` or `restart-required`) shows the installed message and refreshes the catalogue. A `stale-approval` result — the catalogue revision moved between display and approval — shows the changed-list message and refreshes so the user reviews the current entries. Any other outcome or transport error shows the failure message; the user can retry.

### Retrying a failed read

A failed catalogue read renders the error state inside the tab with a Retry button that re-runs the lazy `curatedCatalog()` call. An empty catalogue renders its own empty state; neither ever shows the Host's built-in Loader inventory.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin registers one localized `settings.plugins.tab` contribution with id `curated`; the Plugins section owns the navigation entry and tab chrome. Registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

The inject face carries only the two Remote callbacks — `catalog` and `install` — closed over `ctx.remote.pluginManager`; the locale `t` seat arrives through the standard `PropsLocale` share. The component keeps its own loading/error/ready view state and the busy/message feedback for installation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings section, the Remote call, and the Host-side catalogue verification.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the Plugins section this tab registers into.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.plugins.tab`.
- [plugin-manager](../../boot/plugin-manager/README.md) — the Host-side signed catalogue verification and curated bundle installation this tab drives.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side catalogue view that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the catalogue view; they are current package constraints.

- **One catalogue read per Settings mount or retry** — the tab does not subscribe to catalogue changes or automatically refetch after reconnect; switching tabs preserves the current catalogue, while reopening Settings obtains a new one.
- **Server catalogue only** — the tab never shows the Host's built-in Loader inventory; the sidebar's Plugins page is the separate management surface.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a read-only Settings contribution.
