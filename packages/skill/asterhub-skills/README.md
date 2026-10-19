---
description: "Bundled AsterHub RPC skills for coordinating development and independent review through the native SDK sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-asterhub-skills

English | [中文](README.zh.md)

## Summary

Agents can load two bundled workflows for coordinating development and independent review through AsterHub's SDK runtime. The skills cover bounded work slices, named sessions, settled results, durable handoffs, and a user-selected review model. They provide instructions only; AsterHub's SDK client and `dsh --profile sdk` supply the runtime. The SDK protocol cannot resume a live agent after its process exits.

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

Mount the plugin with the skill registry and `dsh-tool-skill` consumer when agents need the bundled AsterHub development and review workflows.

### Enable the provider

Add the package to the profile composition:

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-asterhub-skills'
```

The provider contributes `asterhub-rpc-dev` and `asterhub-rpc-cross-review` from its packaged assets. Both use the normal bundled source rank. The plugin disables filesystem watching and default filesystem roots for this provider, so it reads only these packaged skills.

### Choose a workflow

Use `asterhub-rpc-dev` for independent named SDK sessions with risk-based review. Use `asterhub-rpc-cross-review` when the user requires a separate reviewer and chooses a review model supported by the current SDK runtime. The second skill requires a distinct review session and explicit review route for each batch.

Both skills use `@deepseek-ai/dsh-sdk-client` with the `sdk` profile. They do not install or invoke another agent product. Each session records durable AsterHub Session events while its SDK runtime is alive; the SDK protocol does not expose a session-resume operation after process exit.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin delegates discovery and loading to `dsh-skill-filesystem`, configured with a package-relative asset root, provider name `asterhub-bundled`, disabled default roots, and no watcher. The filesystem provider supplies the bundled rank and resource bases, so relative references load from each skill directory.

| Path | Purpose |
|---|---|
| [`src/index.ts`](src/index.ts) | Mounts the isolated filesystem provider on `ctx.skills` |
| [`assets/asterhub-rpc-dev/`](assets/asterhub-rpc-dev/) | Development workflow and SDK/session references |
| [`assets/asterhub-rpc-cross-review/`](assets/asterhub-rpc-cross-review/) | User-selected model review workflow and references |
| [`UPSTREAM.json`](UPSTREAM.json) | Source revision and adaptation record |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SDK client](../../sdk/client/README.md) — the TypeScript client that launches and drives the `sdk` profile.
- [SDK protocol](../../sdk/protocol/README.md) — supported JSON-RPC requests, results, and notifications.
- [Session subsystem](../../../docs/subsystems/session.md) — durable event history and session lifecycle.
- [Filesystem skill provider](../skill-filesystem/README.md) — packaged skill discovery and loading.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which renders these skill summaries into the model-facing catalog and loads the selected instructions on request.

#### KV Cache effect

The catalog contributes its normal durable context. Loading a skill adds its instructions to that session's tool result; neither operation changes SDK model-route settings.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe what the bundled workflows can rely on from the current SDK.

- **No SDK agent resume after process exit** — persisted Session logs remain readable, but the protocol cannot restore the SDK server's process-local agent handle. Recovery starts a new session with a verified handoff.
- **Review support depends on the selected runtime route** — the SDK validates a route at initialization, but it does not expose a model-list method in its wire protocol.
- **Instructions do not enforce file ownership or permissions** — the main session must enforce slice ownership and the runtime's actual tool policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`UPSTREAM.json` records the source repository revision and the adapted template names. It makes no additional license claim.

</details>
