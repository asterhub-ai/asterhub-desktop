---
description: "通过 AsterHub 已鉴权的 SearXNG 实例和当前 Sub2API 模型 key 搜索网页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

[English](README.md) | 中文

## 概述

使用 AsterHub 的 SearXNG 实例执行模型请求的网页搜索，不需要 DeepSeek 搜索 key 或按月计费的搜索 API。提供方复用当前 Sub2API 模型 key 进行代理鉴权，并将 SearXNG 结果映射为共享 web 来源格式。搜索引擎仍可能限流或改变其公共接口。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Host 组合中加载此提供方，并提供 `asterhub-account/model-api-key` Sub2API 凭据记录。

### 何时选择

当 DeepSeek 搜索凭据或按月计费的搜索服务额度不可接受时，为 AsterHub 的已鉴权 SearXNG 部署使用此提供方。它要求用户已登录 Sub2API 账户，并且 SearXNG 代理使用 HTTPS；任一前提不满足时，应选择其他 `ctx.web` 提供方。

### 最小配置

将提供方加入 Host 组合，并在 `dsh-web` 中选择它：

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

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | 必需 | SearXNG JSON 代理的绝对 HTTPS 基础 URL。提供方会追加 `/search`。 |

XAPI 代理通过 Sub2API `/v1/models` 端点校验 bearer key，将请求转发到主机回环端口上的 SearXNG，并在转发前移除 bearer 请求头。SearXNG 容器不发布公网主机端口。完整字段见[生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-searxng)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每次搜索都会重新读取当前模型 key 凭据记录，因此账户 key 轮换无需重启 Host。提供方只向可信 HTTPS 代理发送 key，并拒绝重定向；反向代理使用 key 鉴权后，在请求转发到 SearXNG 前将其移除。提供方只解析一次 SearXNG JSON，丢弃格式错误或非 HTTP(S) 的结果 URL，并由 `dsh-web` 负责限制结果数量。

| 源码 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 注册提供方并读取当前 Sub2API 模型 key 凭据记录。 |
| [`src/provider.ts`](src/provider.ts) | 请求 SearXNG JSON 并将有效结果映射为 `ctx.web` 来源。 |

不发布运行时 invariant companion，因为此提供方不引入现有 Web 提供方注册表之外、可独立观察的可变关系。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Web 子系统](../../../docs/subsystems/web.zh.md)——搜索请求、结果、取消与提供方错误。
- [dsh-web](../web/README.zh.md)——提供方选择与 `ctx.web` 行为。
- [dsh-tool-web](../tool-web/README.zh.md)——面向模型的 `web_search` 工具。
- [AsterHub Sub2API 账户](../../account/account-sub2api/README.zh.md)——当前模型 key 的所有权与存储。

-----

<a id="model-experience"></a>
## 模型体验

### 搜索结果

#### 模型能看到什么

模型会在现有 `web_search` 工具结果中收到查询来源 URL、标题、摘要和发布日期。SearXNG 不生成答案，因此提供方只返回来源，不返回 `content` 字段。共享 `dsh-web` 服务负责执行工具的 `maxResults` 上限。

#### Token 影响

搜索结果会产生取决于来源数量和摘要长度的 token，并在压缩前保留。

#### KV Cache 影响

只追加搜索结果；新结果跟在可复用的请求前缀之后，不会使已有 KV-cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

提供方依赖已配置的 SearXNG 代理及其启用的公共搜索引擎。

- 当前部署中的 Bing 与 DuckDuckGo 没有月度 API 次数额度，但仍可能限流或改变响应页面。
- 搜索查询会离开用户电脑，经 AsterHub SearXNG 服务器发送给配置的搜索引擎。查询中不得包含用户不愿发送给这些搜索引擎的秘密。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
