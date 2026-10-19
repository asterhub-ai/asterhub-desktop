---
description: "将受支持的已发布 V4 Session 数据无损读取到 V5。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 概述

读取已发布的 V4 Session 时保留事件、顺序、继承前缀与消息数据，不改写来源文件。相邻迁移保留原生 JSONL 行，并根据当前已安装的 V5 Session 词汇验证 Anima 来源标记和记录。V5 写入方与迁移目录负责在读取时选择此边；可写打开会在来源旁发布版本化后继文件。

## 目录

- [使用此包](#use-this-package)
- [V4 到 V5 转换](#v4-to-v5-conversion)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

持久化层通过静态 Session 目录挂载此迁移；消费者无需直接调用。

<a id="v4-to-v5-conversion"></a>
## V4 到 V5 转换

仅替换头部格式版本号。来源的连续事件序号、紧凑流、表面引用、事件数据和继承前缀保持原样。原生 V5 准入随后会使用当前 Session 事件词汇检查 Anima 消息来源及辅助事件数据。只读访问不会发布后继文件；可写持久化会在不可变的 V4 来源旁发布 V5 文件。

<a id="model-experience"></a>
## 模型体验

此迁移不会产生模型输入，因为它只保留现有 Session 历史，不会增加面向模型的指令或消息。

#### KV Cache 效果

现有对话前缀保持不变，因此迁移不会影响缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不重建历史捕获**——V4 到 V5 转换只保留 V4 表示的 Session 数据，不会从早期对话中补建 Anima 捕获记录或图数据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护上下文 — 点击展开</summary>

无。

</details>
