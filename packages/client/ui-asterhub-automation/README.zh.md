---
description: "通过已认证的原生自动化 Remote 管理桌面任务的面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-automation

[English](README.md) | 中文

<a id="summary"></a>

## 概述

打开任务面板创建、查看、暂停、恢复、执行、停止或删除原生定时任务。面板展示当前账号的 Host 任务状态和执行历史。变更先准备，再使用 Host 下发的确认信息提交。

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

桌面原生 bundle 同时挂载此面板和自动化 Host。浏览器入口挂载类型化的 `automation` Remote，并注册具名主面板和侧栏入口。文本和控件使用本包的本地化字典。

<a id="understand-the-implementation"></a>

## 理解实现

Host 负责验证任务、账号授权、变更回执和执行。面板准备变更，在需要时展示确认，再使用相同请求 ID 和确认 ID 提交。账号和任务通知触发新的 Host 查询；浏览器状态不是持久任务存储。

<a id="further-exploration"></a>

## 进一步探索

- [自动化 Host](../../schedule/asterhub-automation/README.zh.md)
- [桌面组合](../../bundle/asterhub-desktop-native/README.zh.md)

<a id="model-experience"></a>

## 模型体验

没有直接影响，因为面板仅展示已认证的 Host 状态并提交用户命令，不添加模型上下文。

#### KV Cache 影响

打开、筛选或确认面板不会修改模型请求前缀；Host 负责已接受执行所创建的 Session。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 需要原生自动化 Host；面板不能独立执行任务。
- 切换账号会使已准备的操作失效，需要重新准备。

<a id="dev-note"></a>

### 开发备注

任务授权保留在 Host Remote 中；产品文本保留在类型化本地化字典中。
