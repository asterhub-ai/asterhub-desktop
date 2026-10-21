---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-21-retained-job-audit-events

[English](2026-10-21-retained-job-audit-events.md) | 中文

## 概述

在持久化清单中声明已有的 job/registered 与 job/settled 审计事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-retained-job-audit-events
baseline: false
changes:
  - root: "event:job/registered"
    previous: null
    after: "ed42257f7796c6634687d9e2525b183fbeb5d6b1a97ef9c2f4dbe28e800c3add"
    decision: same-version
  - root: "event:job/settled"
    previous: null
    after: "ed6d64a44cda408cdfee606b8f6ac824ebd106b1868fd132154248919c7a617c"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这些事件名已存在于已发布的 Session 产物中。声明描述保留的记录，不新增写入方，也不改变当前写入格式。历史注册记录可缺少 executionId；历史结算记录可缺少 executionId 与 terminationConfirmed，并携带 producerReported。可选字段保留这些载荷，缺少终止证据不代表已确认终止。不重写或删除任何已提交的历史代。

<a id="verification"></a>
## 验证

Nomad 5800 执行 pnpm run test --maxWorkers=4：1836 个文件通过、23 个文件跳过；38122 项测试通过、1 项预期失败、198 项跳过。之前的定向运行通过 65 个文件并跳过 6 个，涵盖 V4 迁移与当前持久化校验用例。

<a id="dev-note"></a>
## 开发备注

无。
