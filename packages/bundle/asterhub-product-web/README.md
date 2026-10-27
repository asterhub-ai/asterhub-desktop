---
description: "Web and Desktop product services for the AsterHub desktop AI workbench, composed over the generic Web surface."
kind: "package-bundle"
---

# @deepseek-ai/dsh-asterhub-product-web

English | [中文](README.zh.md)

## Summary

This layer adds AsterHub account, project-local session, Neo4j-backed Anima, local voice, model-selection, and preset services to the shipped Web and Desktop compositions. It also enables opt-in Desktop analytics. It is absent from headless, SDK, ACP, and `sdk-minimal` profiles.

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

The shipped `web` and Desktop profiles compose this patch-only layer after `dsh-web-app`. The Desktop AI workbench gains account login and model-key provisioning, project-local Sessions with original binary attachments, local Neo4j Anima memory and voice defaults, model selection, and four presets: `standard` (default), `ptc`, `minimal`, and `cordis`. Desktop adds `asterhub-desktop-native` after this layer.

### Optional Desktop analytics

Analytics mounts only when `DSH_PRODUCT_ANALYTICS_OTLP_URL` is explicitly configured. Partial batches run every 30 seconds; exporter and processor timeouts are 15 and 20 seconds. Shutdown allows 2 seconds to drain before cancelling pending requests, so pending events may be lost.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a patch layer over `dsh-web-app`. It selects existing account, project-storage, Neo4j Anima, voice, model-selection, analytics, and preset-registry services, then adds four preset patch documents. Those generic service implementations remain in their owning packages; this layer supplies product composition and defaults.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Product-Web service configuration and preset registry |
| [`presets/`](presets) | `standard`, `ptc`, `minimal`, and `cordis` compositions |
| [`package.json`](package.json) | Declares the ordered bundle patch documents |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Generic Web bundle](../web-app/README.md) — browser surface and invocation settings.
- [Shared AsterHub product bundle](../asterhub-product/README.md) — shared model route, search, persona, and skills.
- [Desktop native bundle](../asterhub-desktop-native/README.md) — Desktop-only services.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through selected account, storage, voice, and preset services, which own their model-visible behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each selected service owns any cache effect.
## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Requires the generic Web layer** — this patch-only bundle is not a standalone application or installer.
- **Only Web and Desktop compose it** — headless, SDK, ACP, and `sdk-minimal` keep their existing non-Web capabilities without these services.
- **Desktop analytics is opt-in and bounded** — pending events can be lost when shutdown reaches its 2-second drain limit.
- **Service behavior stays with service owners** — account, storage, memory, voice, and analytics implementations own their runtime behavior and observations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep product composition in this patch layer. Do not add an empty independent installer; the existing service owners remain responsible for their observations and invariants.

</details>
