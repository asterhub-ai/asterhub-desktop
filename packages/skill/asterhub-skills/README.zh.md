---
description: "通过原生 SDK 会话协调开发与独立审查的 AsterHub 内置 RPC 技能。"
kind: "package-reference"
---

# @deepseek-ai/dsh-asterhub-skills

[English](README.md) | 中文

## 概述

Agent 可以加载两个内置工作流，通过 AsterHub SDK runtime 协调开发与独立审查。技能说明如何拆分有界任务、使用命名会话、确认请求完成、保存持久交接，并由用户选择审查模型。技能只提供操作说明；runtime 由 AsterHub SDK client 和 `dsh --profile sdk` 提供。SDK 协议无法在进程退出后恢复运行中的 Agent。

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

当 Agent 需要内置的 AsterHub 开发与审查工作流时，将此插件与技能注册表及 `dsh-tool-skill` consumer 一起挂载。

### 启用提供方

将此包加入 Profile 组合：

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-asterhub-skills'
```

提供方从随包资源中提供 `asterhub-rpc-dev` 和 `asterhub-rpc-cross-review`。两个技能使用标准 bundled source rank。插件关闭此提供方的文件监视和默认文件系统根目录，因此它只读取随包技能。

### 选择工作流

需要独立命名 SDK 会话并按风险进行审查时使用 `asterhub-rpc-dev`。用户要求独立审查并选择当前 SDK runtime 支持的审查模型时使用 `asterhub-rpc-cross-review`。后者要求每批使用单独的审查会话，并明确选择审查路由。

两个技能都通过 `sdk` Profile 使用 `@deepseek-ai/dsh-sdk-client`。它们不会安装或调用其他 Agent 产品。每个会话会在 SDK runtime 存活期间记录持久 AsterHub Session 事件；SDK 协议不提供进程退出后的会话恢复操作。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件将发现和加载委托给 `dsh-skill-filesystem`，并配置相对包目录的资源根目录、提供方名称 `asterhub-bundled`、关闭默认根目录和文件监视。文件系统提供方负责 bundled rank 和资源基路径，因此每个技能可以加载其目录中的相对引用。

| 路径 | 用途 |
|---|---|
| [`src/index.ts`](src/index.ts) | 将隔离的文件系统提供方挂载到 `ctx.skills` |
| [`assets/asterhub-rpc-dev/`](assets/asterhub-rpc-dev/) | 开发工作流及 SDK/会话参考 |
| [`assets/asterhub-rpc-cross-review/`](assets/asterhub-rpc-cross-review/) | 用户选择模型的审查工作流及参考 |
| [`UPSTREAM.json`](UPSTREAM.json) | 来源版本与改编记录 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SDK client](../../sdk/client/README.zh.md)——启动并驱动 `sdk` Profile 的 TypeScript client。
- [SDK protocol](../../sdk/protocol/README.zh.md)——支持的 JSON-RPC 请求、结果和通知。
- [Session 子系统](../../../docs/subsystems/session.zh.md)——持久事件历史和会话生命周期。
- [文件系统技能提供方](../skill-filesystem/README.zh.md)——随包技能发现与加载。

-----

<a id="model-experience"></a>
## 模型体验

间接通过 `dsh-tool-skill` 提供：它将技能摘要加入模型目录，并按需加载选中的指令。

#### KV Cache 影响

目录会按常规方式加入持久上下文。加载技能会将其指令加入该会话的工具结果；两者都不会更改 SDK 模型路由设置。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制描述了当前 SDK 能为内置工作流提供的能力。

- **SDK 进程退出后不能恢复 Agent**——持久 Session 日志仍可读取，但协议无法恢复 SDK server 的进程内 Agent handle。恢复时需创建新会话并提供经过核对的交接。
- **审查能力取决于所选 runtime 路由**——SDK 会在初始化时验证路由，但 wire protocol 没有模型列表方法。
- **指令无法强制文件所有权或权限**——主会话必须维护任务所有权并遵循 runtime 实际工具策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`UPSTREAM.json` 记录源仓库版本和改编模板名称，不主张任何额外许可证授权。

</details>
