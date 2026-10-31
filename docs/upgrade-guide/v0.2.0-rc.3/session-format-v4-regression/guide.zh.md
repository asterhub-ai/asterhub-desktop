---
kind: upgrade-guide
description: "Session 写入格式回归上游 V4；fork 期间的 v5 头日志与含 anima 事件的中间态 v4 日志不再能打开。"
---

# Session 格式回归 V4

[English](guide.md) | 中文

## 变更

Session 写入格式回归上游 deepseek-harness 发布线的 V4；fork 独有的 V5 格式不再写入或读取。以下状态的日志无法在本构建中打开：

- 头行为 `version: 5` 的日志（fork 期间构建写出）。读取器以 `session "<id>" uses log format v5, but this harness reads only v4: the log was written by a newer harness — upgrade the harness to open it` 拒绝，并原样保留文件。
- 含 `anima/extraction-request` 或 `anima/extraction-result` 事件的 v4 日志（启用 Anima 插件的中间态构建写出）。读取器以 `format v4 contains unknown event type "anima/extraction-request" at seq N` 拒绝；仅该会话无法打开。这些纯审计事件没有任何消费方，拒绝不损失任何功能。

Anima 的辅助模型交互现以可忽略的 `plugin:anima-memory/extraction-request` 与 `plugin:anima-memory/extraction-result` 记录持久化；不识别它们的读取器会保留并跳过。Anima 记忆数据（episodes、reflections、graph）存于 DSH home 下自己的目录，不经过 Session 日志，不受影响。

## 迁移

不提供转换：V5 从未随任何发布版本发出，被拒 v4 日志中的 anima 事件没有消费方。

1. 受影响的日志文件保持原位；本构建不会改写或删除它们。
2. 如需其中内容，用写出它的构建打开该会话并复制所需内容。
3. 正常启动本构建；新会话以 `version: 4` 头行写出，Anima 记录走 `plugin:anima-memory/*` 通道。可通过读取新写出会话日志的首行确认。
