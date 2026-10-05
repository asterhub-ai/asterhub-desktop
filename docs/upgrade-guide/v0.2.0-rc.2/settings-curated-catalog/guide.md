---
kind: upgrade-guide
description: "Settings curated plugins replaces the Host inventory page and its exported props with the verified server catalogue."
---

# Settings curated catalogue

English | [中文](guide.zh.md)

## Change

In v0.2.0-rc.2, Settings can show the Host Loader inventory under the Curated plugins label. The Host-only `curatedCatalog` option does not reach the browser. The next release always uses `pluginManager.curatedCatalog()` and `installCuratedBundle()`; an unavailable or empty catalogue never falls back to the built-in inventory.

The browser entry removes `PluginInventorySettingsTabInjected` and `PluginInventorySettingsTabProps`. It exports `CuratedPluginSettingsTabInjected` and `CuratedPluginSettingsTabProps` for the catalogue page. Host inventory services and other consumers are unchanged.

## Migration

1. Remove `curatedCatalog` from the `ui-settings-plugin-inventory` row in custom profile patches. This page no longer has an inventory mode.
2. Replace imports of the removed props types with the curated props types only where the caller renders a server catalogue; supply `catalog` and `install` callbacks instead of inventory callbacks.
3. Desktop already supplies its pinned catalogue public key. Other hosts must configure `plugin-manager.curatedCatalogUrl` and `curatedCatalogPublicKey` with their signed HTTPS catalogue and trusted Ed25519 public key.
4. Open Settings → Curated plugins. Confirm that it shows server entries or the catalogue's empty/error state, never the Host Loader inventory.
