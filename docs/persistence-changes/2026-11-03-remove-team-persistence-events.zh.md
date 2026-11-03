---
description: "记录一次持久化类型变更及其兼容性确认。"
kind: persistence-change
---

# 2026-11-03-remove-team-persistence-events

[English](2026-11-03-remove-team-persistence-events.md) | 中文

## 摘要

从声明的 Session 表面移除 Agent Teams 持久化词汇表：四个已持久化的 team 事件根——team/member、team/message/delivered、team/message/queued、team/task——退出事件类型；user/message 与 developer/message 载荷、agent/inbox/spliced 插入消息以及 session/title-llm-request 消息列表的消息 source 联合类型移除 `team-message` 与 `anima` 变体。本检出已完整移除 Agent Teams 运行时（`packages/experimental/{agent-team,agent-team-profile,client-ui-agent-team,tool-agent-team}`，见 `docs/upgrade-guide/v0.2.0-rc.3/agent-team-removal/guide.zh.md`），且 Session 格式回归已将 anima 写入迁移到 plugin records，因此继承自上游的记录所描述的事件机制与归因 kind，在本仓库中不再有任何包声明、产生或读取。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-remove-team-persistence-events
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-31-anima-source-kind"
    after: "61c15c18f868cfe4b9fa4b1d8e0f07e32d272762efac9ddd98697d13dca2f5ff"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-31-anima-source-kind"
    after: "89a9c91a51bad071178f478459160fc37650633a1bb188e2e2e0d5ffc4060048"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-31-anima-source-kind"
    after: "0aa83a4f3e666b002cce868e3a5c3eca9bbab66b3b3010553d65a9d8f9d065fc"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:team/message/delivered"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: null
    decision: same-version
  - root: "event:team/task"
    previous: "2026-09-11-initial"
    after: null
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-31-anima-source-kind"
    after: "8166aadcfc98432bb4458fbbd25ea230e46152a62507758ddf226a32e122820e"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

无 Session 格式版本变化：SessionHeader、JsonlHeaderLine 与 SessionEventEnvelope 均不在本记录的变更之内且摘要不变，容器形状未受影响。envelope 的声明形状不枚举事件名，因此仍含 team 事件的历史 Session 不会因任何容器变化而失效；其载荷只是不再属于声明的词汇表。source 联合类型仅移除 `team-message` 与 `anima` 两个变体，归因策略元数据（unknownKinds: preserve）仍在 source 属性上声明，因此本变更之前写入的 Session 对遵循保留策略的读取器而言 team-message 与 anima 归因保持原样，写入器则不再产生这两个变体。联合类型没有新增变体，旧读取器不会遇到新形状。

<a id="verification"></a>
## 验证

verify-persistence-changes、verify-persistence-formats、verify-persistence-releases、gen-persistence-catalog --check 与 gen-session-format-catalog --check 在包含本记录的工作树上通过，verify-doc-refs 与本记录的双语配对检查一并通过。

<a id="dev-note"></a>
## 开发备注

同一次维护将已提交的变更快照对齐到上游的紧凑布局：继承的快照逐字取自上游，historical-formats 目录移除 fork 专属的 V4 写入器制品，因为格式版本 4 即当前写入器。V5 回归之前的 fork 记录（原生自动化与取消提问、anima session V5、保留的 job 审计事件）随 V5 回归一并移除且保持无引用；job 审计事件已不再持久化，故没有后继记录重新声明它们。
