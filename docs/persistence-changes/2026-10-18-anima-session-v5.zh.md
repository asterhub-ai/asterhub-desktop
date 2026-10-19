---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-18-anima-session-v5

[English](2026-10-18-anima-session-v5.md) | 中文

## 概述

Session 写入器升至 V5，以便在持久日志中表示 Anima 上下文来源和辅助模型请求。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-anima-session-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "154218efef7d7172f1776ef51b2f1e0abb5b37ab81d39b88ccf4c1943d3089cb"
    decision: version-bump
  - root: "event:anima/extraction-request"
    previous: null
    after: "472c3cbe882cda062b8d8384753afdc9776c12ddbecbd1c5ad2e1ec67256ac4f"
    decision: version-bump
  - root: "event:anima/extraction-result"
    previous: null
    after: "1d230e5ab1c3166ac98ed363a4978573833d32d6c1514ed02a90ec9c01164890"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "2bd3674d538cbecde1f57ee430654f5f8774d73699522684843a917e6a3a7c32"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "7058b469c9852d36b2d73915db1591bcabbed42de91b06fd153f8884099c23bf"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-10-06-native-automation-and-canceled-questions"
    after: "7cfc9a6ad1ac6f26b3f224f6d465781cb3205aba45d5edf9242924392c9f599f"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

现有 V4 Session generation 保持不变，并可经相邻 V4 到 V5 迁移读取。旧写入器无法打开包含 Anima 来源类型或必需请求/结果记录的 V5 Session。读取旧对话不会创建图记录；图证据从升级后的 Host 开始捕获时产生。

<a id="verification"></a>
## 验证

V4 到 V5 迁移保留事件序号、payload、紧凑 Assistant 流及继承事件截点。加入聚焦迁移测试，并在重新生成记录后运行 test:snapshot。

<a id="dev-note"></a>
## 开发备注

无。
