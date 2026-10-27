---
description: "按账号管理的原生定时任务，提供确认变更、双轨派发（续跑创建会话或新建 Session）和有界持久执行历史。"
kind: "package-reference"
---

# @deepseek-ai/dsh-asterhub-automation

[English](README.md) | 中文

<a id="summary"></a>

## 概述

为已登记工作区和当前账号可用的模型创建定时工作。由 agent 工具创建的任务绑定到其创建会话，每个已接受的执行时机都会续跑该会话并把运行 turn 追加进去；在桌面表单中创建的任务则在每次执行时新建独立 Session。Host 限制并发、执行时间、任务大小和历史保留量。任务需要 AsterHub 应用保持运行，并保留普通敏感操作审批。

<a id="table-of-contents"></a>

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

桌面原生 bundle 挂载此服务。类型化 `automation` Remote 和按作用域注册的 `automation_manage` 工具共用按账号授权的操作。部署限制在服务行中配置：`maxConcurrent` 默认为 2，`runTimeoutMs` 默认为 1800000；历史、回执、指令和任务预算在 [Config](src/index.ts) 中统一验证。每天与每周定时规则支持时钟时间 `HH:mm:ss` 及可选的小数秒（`HH:mm:ss.SSS`）。

`./types` 入口为 Host 和 Client 导入声明任务数据、工具结果及 Cordis 事件，不会加载 Host 服务。

<a id="understand-the-implementation"></a>

## 理解实现

每项任务及其有界执行历史、请求回执历史占用 schedule 存储域的一条记录。准备阶段将变更绑定到账号、修订、摘要和有期限的确认；提交阶段在共享管理队列中重新验证这些信息。计时运行时预留到期工作，然后按归属派发：绑定创建会话的任务（工具创建时记录；每个会话至多绑定一个未删除任务）续跑该 Session 并把运行的用户 turn 追加进去，未绑定的任务则新建工作区 Session。每条运行记录都携带其 Session id 供后续跳转。创建会话不存在时，绑定派发以 `origin_session_missing` 将本次运行置为失败，绝不回退新建 Session。运行时记录终态、通过注入的 sessions 服务刷新会话状态，并在释放时等待已接受的执行结束。账号变化会停止失效工作并使已准备操作失效。

<a id="further-exploration"></a>

## 进一步探索

- [桌面任务面板](../../client/ui-asterhub-automation/README.zh.md)
- [操作测试](tests/)
- [任务编写工具](src/tools.ts)

<a id="model-experience"></a>

## 模型体验

### 定时任务编写与执行

#### 模型看到什么

交互式根 Agent 获得 `automation_manage`，其[定义](src/tools.ts)验证各动作的任务输入并返回结构化结果。通过工具创建的任务绑定到调用会话：其执行续跑该会话并把保存的完整指令作为用户 turn 追加进去，同一会话的第二次绑定以 `session_already_bound` 被拒绝。GUI 创建的任务在每次执行时以当前账号选择的模型启动新会话。

#### Token 影响

工具注册期间，其模式增加固定输入 token；工具结果进入编写会话。每次定时执行发起独立模型请求，并消耗账号的普通模型算力积分。

#### KV Cache 影响

工具创建的任务把每次运行追加到创建 Session，因此每次运行的请求前缀包含截至该运行的会话历史。GUI 创建的任务派发到具有独立请求前缀的新 Session；选择的 preset 和模型适配器负责 provider 缓存复用。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 不提供操作系统唤醒，也不在应用关闭时执行。
- 创建会话消失后，绑定任务停止派发：本次运行以 `origin_session_missing` 失败，而不是静默切换到新 Session。当其他写入者持有会话写路径时（例如 Session 控制器为打开的会话保活的 Agent），派发同样响亮失败。
- 指令必须自包含；GUI 创建的运行启动新 Session，不继承编写任务时的会话。
- 执行依赖账号和工作区可用性；其中任一变化都可能阻止执行。
- 后续工作：创建会话的未读标记、桌面面板的运行历史跳转、通知重构。

<a id="dev-note"></a>

### 开发备注

状态变更由 AutomationOperations 负责，执行归属由 AutomationRuntime 负责；Client 和工具共用这些实现。
