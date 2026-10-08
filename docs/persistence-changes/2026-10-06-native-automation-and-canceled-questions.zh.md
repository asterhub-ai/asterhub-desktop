---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-06-native-automation-and-canceled-questions

[English](2026-10-06-native-automation-and-canceled-questions.md) | 中文

## 概述

添加 user-questions/canceled 事件与 automation 消息源归属标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-native-automation-and-canceled-questions
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "73d0a06aadf69ce6919ec35f3649cfcb089aa5157789952f19390c14c0060a20"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "3c81ee2ca8bc213bd0ae4d303f9512f9334de3fab9e9a29a3e3cc4eda41d9041"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "b532dbc0f7c3d297309151754b560e7c8d2a52a1008cd654e89bb750b9439d68"
    decision: same-version
  - root: "event:user-questions/canceled"
    previous: null
    after: "66d8be3f93e66a717826e22349abdd0b11e20183a79d96d2f1ee90dfc8dd3df7"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "22c2d12e02ded3a917e3ec29b1a914beabcb000dab0ff8e9ccf6eb8a64edc494"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有会话记录保持有效。user-questions/canceled 事件记录被取消的限时提问 callId 并由 userQuestions 投影折叠。automation 消息源为原生定时任务提供来源归属，不改变消息内容结构。

<a id="verification"></a>
## 验证

node node_modules/vitest/vitest.mjs run packages/interaction/user-questions/tests/cancel-vs-late-answer.spec.ts packages/schedule/asterhub-automation/tests/execution.spec.ts：全部测试通过。

<a id="dev-note"></a>
## 开发备注

无。
