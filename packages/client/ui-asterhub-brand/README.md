---
description: "AsterHub name and star artwork for the product sidebar and new-conversation hero, independent of the client build profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-brand

English | [中文](README.zh.md)

## Summary

Show AsterHub's name and existing star artwork in the sidebar and new-conversation hero. Local and official builds display the same product identity. The artwork follows each surface's requested size and remains visible in light and dark themes. This package does not change model requests.

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

The [AsterHub product-Web bundle](../../bundle/asterhub-product-web/README.md) mounts this plugin for Desktop and Web profiles and disables the upstream official-brand plugin. Custom compositions must not mount a second occupant for the same brand slots. There are no configuration fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry installs sidebar mark/name and conversation-hero mark occupants as one declaration-aware set. Revoking a declaration removes the whole set; restoring it reinstalls the occupants. The mark reuses the existing AsterHubMark primitive, including its per-instance gradient identifier. The name inherits the surrounding typography and color.

| File | Role |
|---|---|
| [src/client/index.ts](src/client/index.ts) | Declaration-aware brand registration and disposal |
| [src/client/Brand.tsx](src/client/Brand.tsx) | Surface-sized artwork and product name |
| [src/client/locales.ts](src/client/locales.ts) | Locale-independent product name |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Sidebar](../ui-sidebar/README.md) — brand slot declarations and shell layout.
- [Conversation](../ui-conversation/README.md) — the new-conversation hero.
- [UI primitives](../ui-primitives/README.md) — the shared AsterHub artwork.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Brand presentation has these ownership limits:

- **Window titles and application icons** — build metadata and Desktop resources own them, not the slot occupants.
- **Runtime invariants** — no invariant module is needed: presentation has no independently observed runtime state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
