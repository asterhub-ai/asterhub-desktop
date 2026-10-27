---
description: "Shared AsterHub model, search, persona, and skill defaults for users composing base-backed profiles."
kind: "package-bundle"
---

# @deepseek-ai/dsh-asterhub-product

English | [中文](README.zh.md)

## Summary

This layer gives base-backed AsterHub profiles a fixed provider route, authenticated search, persona text, and curated skills. Shipped `web`, `headless`, `sdk`, and `acp` profiles include it; `sdk-minimal` stays independent. A custom base-backed profile can add it after `dsh-base`; it is not a standalone application or a library to import.

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

The shipped `web`, `headless`, `sdk`, and `acp` profiles compose this layer over `dsh-base`. A custom base-backed profile selects it as a later bundle. Web and Desktop profiles add the separate [`asterhub-product-web`](../asterhub-product-web/README.md) layer after `dsh-web-app`; `sdk-minimal` does not use either product layer.

### What you get

The layer locks the provider and endpoint to AsterHub's account-backed model route while allowing model choice from the account catalog. It selects authenticated SearXNG search, AsterHub persona text, and curated skills. Generic model, search, and skill implementations remain owned by their existing packages.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package exports one frozen `APPLICATION_MODEL_ROUTE`. Desktop Host provides that same value; the profile patch installs it before model services are constructed and supplies a mutable copy of its provider profile to Cordis configuration resolution. The trusted route remains immutable, including nullable reasoning-effort mappings. The patch also selects AsterHub's SearXNG route and curated skill package. Generic service implementations own runtime behavior and observations.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Exports and provides the frozen application model route |
| [`cordis.patch.yml`](cordis.patch.yml) | Shared profile-layer configuration |
| [`tests/model-policy.spec.ts`](tests/model-policy.spec.ts) | Model-policy package tests |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bundle package map](../README.md) — shipped profile layers.
- [AsterHub product-Web layer](../asterhub-product-web/README.md) — browser-surface product services.
- [Base bundle](../base/README.md) — generic shared profile services.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through selected model route, search, skill, and persona services, which own their model-visible behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each selected service owns any cache effect.
## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Requires a base-backed profile** — this composition layer is not a standalone application or independent installer.
- **Web product services are separate** — account UI, project-local storage, Anima, voice, and presets require `asterhub-product-web`.
- **Generic implementations own their behavior** — this bundle selects existing services; their owning packages remain responsible for service observations and runtime guarantees.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Host and profile composition share `APPLICATION_MODEL_ROUTE`. Keep route enforcement in the existing service owners; this bundle owns product values and composition, not a second policy implementation.

</details>
