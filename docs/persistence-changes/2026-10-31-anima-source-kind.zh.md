---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-31-anima-source-kind

[English](2026-10-31-anima-source-kind.md) | 中文

## 概述

消息来源联合新增 attribution-only kind `anima`：anima-memory 插件通过 module merge 向共享 MessageSourceMap 增补 `{ kind: 'anima' } & ContextFormed`，user/message、developer/message、agent/inbox/spliced 载荷与 session/title-llm-request 消息列表由此接受归属于 Anima 本地图谱的上下文与辅助消息。同一 merge 面把声明的 `automation` attribution kind（携带 taskId 与 runId 的定时任务消息）纳入来源联合及其策略元数据。标题 LLM 请求同时回到上游形态：移除可选的 reasoningEffort 请求属性。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-31-anima-source-kind
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "a6356a740b4d37649a5236429a4826a72e46496243001e6a21950268d5cee1f9"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "6f41792aacad78083f8be42feb650eea0805a6fb42089c949a4a346359864e1b"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "92d9461519fa5319fe578f7cdad92f54f6ef80a46800761fba7874182a332999"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "1a87ff2aad896917e4af0da4462612c0798727fd1072bd3f81460e2665474042"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增 kind 只扩展闭合来源联合，既有变体不变。遵循 session 来源归属策略的读取方保留未知 kind（unknownKinds: preserve），旧读取方完整保留 anima 与 automation 来源而不解释它们。automation kind 已声明在 source 属性的 attributionKinds 元数据中；anima kind 因跨包 module merge 无法注记 llm 侧元数据，按本条兼容性审查记录确认。不改变事件判别值、必填字段或 Session 格式版本；标题请求仅失去一个上游读取方从不要求的可选属性。本记录不改变存储格式；anima 事件本体已迁 plugin:anima-memory/* 通道。

<a id="verification"></a>
## 验证

verify-persistence-changes、verify-persistence-releases 与 verify-persistence-formats 在包含本记录的树上全部通过。完整无密钥录制会话快照套件（189 项）回放中不存在任何 anima 形态差异；剩余失败为场景 persona 模板中未注册的 {{cwd}} prompt 变量，以及 V5 fixture 迁移遗留的一处保留代策略冲突，均作为本记录之外的产品侧适配事项跟踪。排查过程中同时修复了十四个仍指向已改名 v5 会话 fixture 的借用方 manifest，以及一份缺少尾换行的 system-prompt 期望文件。

<a id="dev-note"></a>
## 开发备注

无。
