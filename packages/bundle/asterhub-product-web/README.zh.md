---
description: "在通用 Web 表层之上为 AsterHub 桌面 AI 工作台组合 Web 与 Desktop 产品服务。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-asterhub-product-web

[English](README.md) | 中文

## 概述

本层为随发行版交付的 Web 与 Desktop 组合添加 AsterHub 账户、项目本地会话、基于 Neo4j 的 Anima、语音、模型选择和 preset 服务，同时提供可选的 Desktop 分析。它不会加入 headless、SDK、ACP 或 `sdk-minimal` profile。

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

随发行版交付的 `web` 与 Desktop profile 会在 `dsh-web-app` 之后组合此 patch-only 层。Desktop AI 工作台获得账户登录与模型密钥配置、项目本地 Session 与原始二进制附件、本地 Neo4j Anima 记忆和语音默认值、模型选择，以及四种 preset：`standard`（默认）、`ptc`、`minimal` 和 `cordis`。Desktop 会在本层之后添加 `asterhub-desktop-native`。

### 可选 Desktop 分析

仅显式配置 `DSH_PRODUCT_ANALYTICS_OTLP_URL` 时才挂载分析。每 30 秒发送未满批次；exporter 与 processor 超时分别为 15 秒和 20 秒。退出时允许 2 秒排空，随后取消待完成的请求，因此待处理事件可能丢失。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本 bundle 是叠加在 `dsh-web-app` 之上的 patch 层。它选择现有账户、项目存储、Neo4j Anima、语音、模型选择、分析与 preset 注册表服务，再添加四份 preset patch 文档。通用服务实现仍由所属包负责；本层提供产品组合与默认值。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 产品 Web 服务配置与 preset 注册表 |
| [`presets/`](presets) | `standard`、`ptc`、`minimal` 与 `cordis` 组合 |
| [`package.json`](package.json) | 声明有序的组合包 patch 文档 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [通用 Web 组合包](../web-app/README.zh.md)——浏览器表层与调用设置。
- [共享 AsterHub 产品组合包](../asterhub-product/README.zh.md)——共享模型路由、搜索、persona 与技能。
- [Desktop 原生组合包](../asterhub-desktop-native/README.zh.md)——仅 Desktop 服务。

-----

<a id="model-experience"></a>
## 模型体验

间接产生影响：通过所选的账户、存储、语音与预设服务产生，由各服务拥有自身面向模型的行为。

#### KV Cache 影响

组合包自身不添加请求前缀；所选的各个服务拥有各自的缓存效果。
## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **需要通用 Web 层**——本 patch-only bundle 不是独立应用或安装器。
- **仅 Web 与 Desktop 会组合本层**——headless、SDK、ACP 与 `sdk-minimal` 保持原有非 Web 能力，不加载这些服务。
- **Desktop 分析是可选且有界的**——退出达到 2 秒排空上限时，待处理事件可能丢失。
- **服务行为仍归服务所有者负责**——账户、存储、记忆、语音和分析实现由各自所属包负责运行时行为与观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

产品组合应留在此 patch 层。不要添加空的独立安装器；现有服务所有者仍负责各自的观察与不变式。

</details>
