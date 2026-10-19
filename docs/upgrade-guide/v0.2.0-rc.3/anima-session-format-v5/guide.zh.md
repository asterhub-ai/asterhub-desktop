---
kind: upgrade-guide
description: "Anima 增加持久消息来源和模型操作记录，Session 写入格式升至 V5。"
---

# Anima Session 数据升至 V5

[English](guide.md) | 中文

## 变更

Anima 为召回消息增加 `anima` 来源标记，并将辅助提炼、审核和反思请求及结果写入 Session 日志。AsterHub 使用 Session 格式 V5 持久化这些内容。现有 V4 Session 仍可读取；较早版本的 AsterHub 无法打开包含 Anima 数据的 V5 Session。

## 迁移

现有 V4 Session 无需手动转换。桌面 Host 会通过相邻 V4 到 V5 迁移读取每个 Session；可写打开会在保持 V4 文件不变的同时发布 V5 generation，只读检查不会发布新文件。在其他 AsterHub 实例打开 V5 Session 前，请先安装此版本。重新打开 Session，确认原有消息仍按顺序显示，再继续使用 Anima，即可核实迁移结果。[持久化记录](../../../persistence-changes/2026-10-18-anima-session-v5.zh.md)说明了变更字段与检查方式。
