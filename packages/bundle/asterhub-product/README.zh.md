---
description: "为用户组合基于 base 的 profile 提供共享 AsterHub 模型、搜索、persona 与技能默认值。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-asterhub-product

[English](README.md) | 中文

## 概述

本层为基于 base 的 AsterHub profile 提供固定的提供方路由、认证搜索、persona 文本与精选技能。随发行版交付的 `web`、`headless`、`sdk` 和 `acp` profile 已包含本层；`sdk-minimal` 保持独立。自定义的 base profile 可在 `dsh-base` 之后添加本层；它不是独立应用，也不是供导入的库。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随发行版交付的 `web`、`headless`、`sdk` 与 `acp` profile 会在 `dsh-base` 之上组合本层。自定义 base profile 将其作为后续组合包选入。Web 与 Desktop profile 会在 `dsh-web-app` 后添加独立的 [`asterhub-product-web`](../asterhub-product-web/README.zh.md) 层；`sdk-minimal` 不使用这两个产品层。

### 你会获得什么

本层将提供方与 endpoint 锁定到 AsterHub 账户模型路由，同时允许用户从账户目录中选择模型。它选用经过认证的 SearXNG 搜索路由、AsterHub persona 文本与精选技能。通用模型、搜索和技能实现仍由原有包负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包导出一个冻结的 `APPLICATION_MODEL_ROUTE`。Desktop Host 提供同一个值；profile patch 在模型服务构造前安装该值，并将提供方 profile 的可变副本交给 Cordis 解析配置。可信路由保持不可变，包括允许空值的推理强度映射。patch 还会选择 AsterHub 的 SearXNG 路由和精选技能包。通用服务实现由原有包拥有，并负责运行时行为与观察。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 导出并提供冻结的应用模型路由 |
| [`cordis.patch.yml`](cordis.patch.yml) | 共享 profile 层配置 |
| [`tests/model-policy.spec.ts`](tests/model-policy.spec.ts) | 模型策略包测试 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [组合包索引](../README.zh.md)——随发行版交付的 profile 层。
- [AsterHub product-Web 层](../asterhub-product-web/README.zh.md)——浏览器表层产品服务。
- [Base 组合包](../base/README.zh.md)——通用共享 profile 服务。

-----

<a id="model-experience"></a>
## 模型体验

间接产生影响：通过所选的模型路由、搜索、技能与 persona 服务产生，由各服务拥有自身面向模型的行为。

#### KV Cache 影响

组合包自身不添加请求前缀；所选的各个服务拥有各自的缓存效果。
## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **需要基于 base 的 profile**——本组合层不是独立应用或独立安装器。
- **Web 产品服务由单独组合包提供**——账户 UI、项目本地存储、Anima、语音与 preset 需要 `asterhub-product-web`。
- **通用实现负责自身行为**——本 bundle 选择已有服务；服务观察与运行时保证仍由所属包负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

Host 与 profile 组合共享 `APPLICATION_MODEL_ROUTE`。路由执行约束继续由现有服务所有者负责；本 bundle 拥有产品值与组合关系，不实现第二套策略。

</details>
