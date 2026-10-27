---
kind: upgrade-guide
description: Custom deployments must configure the prompt opener and provider attribution rather than inheriting AsterHub identity.
---

# Product-owned model identity

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-system-prompt` replaces `includeHarnessIdentity` with `harnessIdentity`, which defaults to an empty string. The AsterHub product bundle explicitly supplies the previous opener, `你是 AsterHub 的 AI 助手。`; other deployments no longer inherit it.

Provider attribution defaults to `deepseek-harness`. Product deployments configure `appIdentity.product` and `appIdentity.url`; the version comes from the owning LLM package manifest. Adapters still send the required `User-Agent`, and conflicting provider headers cannot override it.

## Migration

1. Remove `includeHarnessIdentity` from custom system-prompt configuration. To retain the previous enabled behavior, set `harnessIdentity: '你是 AsterHub 的 AI 助手。'`. To retain disabled behavior, omit `harnessIdentity` or set it to an empty string.
2. For custom product compositions, configure the adapter's `appIdentity.product` and `appIdentity.url` explicitly. Select the AsterHub product bundle when its existing identity and deployment policy are required; do not copy account keys into attribution.
3. Compare the final assembled prompt and captured outgoing `User-Agent` against the deployment's expected values, including auxiliary requests and any configured Files API. Do not replace recorded expectations merely to accept an unexplained prompt difference.
