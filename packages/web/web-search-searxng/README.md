---
description: "Search the web from AsterHub with its authenticated SearXNG instance and the active Sub2API model key."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

English | [中文](README.zh.md)

## Summary

Use AsterHub's SearXNG instance for model-requested web searches without a DeepSeek search key or a metered search API. The provider reuses the active Sub2API model key for proxy authentication and maps SearXNG results to the shared web source format. Search engines may still throttle requests or change their public interfaces.

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

Mount the provider in a Host composition that supplies the Sub2API credential record `asterhub-account/model-api-key`.

### When to choose it

Use this provider for AsterHub's authenticated SearXNG deployment when DeepSeek search credentials or monthly search-service quotas are not acceptable. It requires the signed-in Sub2API account and an HTTPS SearXNG proxy; choose another `ctx.web` provider if either prerequisite is absent.

### Minimal configuration

Add the provider to the Host composition and select it in `dsh-web`:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: asterhub-searxng
- id: web-search-searxng
  name: '@deepseek-ai/dsh-web-search-searxng'
  config:
    baseURL: https://xapi.fans/asterhub-search
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | required | Absolute HTTPS base URL for the SearXNG JSON proxy. The provider appends `/search`. |

The XAPI proxy validates the bearer key through Sub2API's `/v1/models` endpoint, forwards the request to SearXNG on a host-loopback port, and removes the bearer header before proxying. The SearXNG container does not publish a public host port. See the [generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng) for the accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider resolves the current model-key record for each search, so account-key rotation takes effect without restarting Host. It sends the key only to the trusted HTTPS proxy and refuses redirects; the reverse proxy uses the key to authorize the request and strips it before the SearXNG upstream. The provider parses SearXNG JSON once, drops malformed or non-HTTP(S) result URLs, and leaves result-count enforcement to `dsh-web`.

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Registers the provider and reads the active Sub2API model-key record. |
| [`src/provider.ts`](src/provider.ts) | Requests SearXNG JSON and maps valid results into `ctx.web` sources. |

No runtime invariant companion is published because this provider introduces no independently observable mutable relationship outside the existing web provider registry.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web subsystem](../../../docs/subsystems/web.md) — search requests, results, cancellation, and provider errors.
- [dsh-web](../web/README.md) — provider selection and `ctx.web` behavior.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool.
- [AsterHub Sub2API account](../../account/account-sub2api/README.md) — ownership and storage of the active model key.

-----

<a id="model-experience"></a>
## Model Experience

### Search results

#### What the model sees

The model receives the query's source URLs, titles, snippets, and publication dates in the existing `web_search` tool result. SearXNG does not generate an answer, so the provider returns sources without a `content` field. The shared `dsh-web` service applies the tool's `maxResults` limit.

#### Token effect

The result adds data-dependent source and snippet tokens until compaction.

#### KV Cache effect

Append-only; new search results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

The provider depends on the configured SearXNG proxy and its enabled public search engines.

- Bing and DuckDuckGo have no monthly API allowance in this deployment, but they may throttle requests or change their response pages.
- Search queries leave the user's computer and are sent to the configured engines through AsterHub's SearXNG server. Do not include secrets the user would not send to those engines.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
