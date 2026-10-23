---
kind: upgrade-guide
description: Custom base-backed profiles must select explicit AsterHub product bundles to retain product defaults and preset imports.
---

# Explicit AsterHub product composition

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` provide generic services rather than AsterHub deployment defaults. The shipped base-backed profiles select `@deepseek-ai/dsh-asterhub-product`; Web also selects `@deepseek-ai/dsh-asterhub-product-web`. The standalone `sdk-minimal` profile remains independent.

Loading an existing named shipped profile updates an exact former installation-owned bundle list to its current template. Other manifest fields and the user's patch remain intact. Additional or reordered bundles are custom selections and are not rewritten.

The `standard`, `ptc`, `minimal`, and `cordis` preset files now belong to `@deepseek-ai/dsh-asterhub-product-web`, not `@deepseek-ai/dsh-web-app`.

## Migration

1. Back up the custom profile's `package.json` and `cordis.patch.yml` before editing. Do not move Session logs, attachments, or project directories.
2. To retain AsterHub defaults, place `@deepseek-ai/dsh-asterhub-product` immediately after `@deepseek-ai/dsh-base` in `dsh.profile.bundles`. For a Web composition, place `@deepseek-ai/dsh-asterhub-product-web` after `@deepseek-ai/dsh-web-app`. Make both selected bundles available to the installation. Generic compositions can omit them deliberately.
3. Change explicit preset imports from `@deepseek-ai/dsh-web-app/presets/<name>.patch.yml` to `@deepseek-ai/dsh-asterhub-product-web/presets/<name>.patch.yml`.
4. Run `dsh --profile <name> --dump-config` and inspect the effective model route, search provider, project persistence, attachments, and selected presets before starting work. Product layers do not authorize a different model provider or replace account credentials.
