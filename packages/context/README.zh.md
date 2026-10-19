---
description: "context 组概览：工作区指引、引用、本地 Neo4j 记忆工具及其他请求上下文插件，供用户与维护者浏览。"
kind: "package-group"
---

# context/ — 请求上下文插件

[English](README.md) | 中文

## 概述

context 组提供模型可见的工作区指引、文件和会话引用，以及当前时间或 tmux 位置等请求时信息。大多数包只添加上下文而不定义工具；`anima-memory` 还会将 Session 事件捕获到本地 Neo4j 图，并提供项目记忆与反思工具。`agent-instructions` 是 `dsh-base` 唯一默认挂载的包；web-app bundle 会挂载 `anima-memory`，其他包则需主动启用。本页概述本组；包级约定由各包 README 负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`agent-instructions/`](agent-instructions/README.zh.md) | 将 `AGENTS.md`、`CLAUDE.md` 工作区指令加载到上下文，并在文件编辑后刷新 | — |
| [`anima-memory/`](anima-memory/README.zh.md) | 按项目隔离的本地 Neo4j 记忆、Session 事件捕获、自动审核与反思，以及四个原生工具 | — |
| [`session-reference/`](session-reference/README.zh.md) | 引用其他会话：提及一个会话，其有界只读快照即成为上下文 | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.zh.md) | 发现 `@file` 提及，并提供由宿主支持的 UI 共用的提及语法 | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.zh.md) | `@file` 提及的本地工作区补全提供方 | — |
| [`time-context/`](time-context/README.zh.md) | 每个步骤的当前时间、浏览器时区与经过时长 | — |
| [`tmux-context/`](tmux-context/README.zh.md) | agent 所在的 tmux 会话、窗口与窗格位置 | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [会话引用子系统](../../docs/subsystems/session-reference.zh.md)——规范的提及 URI、快照语义与稳定的错误分类体系。
- [工作区上下文决策记录](../../.agents/notes/archived/feature/2026-06-24-workspace-context.md)——指令上下文为何按 agent 和会话两个维度隔离并持久记录。
- [生成的配置目录](../../docs/config-catalog.zh.md)——本组各包接受的全部配置字段。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
