---
description: "dsh Web 客户端设置中的 AsterHub 精选插件标签页：仅展示已签名服务器目录条目，按签名完整性安装，提供本地化的加载/空/错误/重试状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

## 概述

设置中「插件」分区下的**精选插件**标签页仅展示 AsterHub 已签名服务器目录的条目。它绝不回退到宿主内置 Loader 清单：提供方缺失、网络失败或目录为空时各自渲染对应的本地化状态并提供重试。每张卡片展示服务器提供的名称、描述、分类与版本，安装按钮通过 `remote.pluginManager.installCuratedBundle()` 发送该条目的精确签名目录事实（id、revision、package、version、integrity、artifact URL）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开设置中的「插件」分区并选择**精选插件**标签页。标签页在首次选择时通过 `ctx.remote.pluginManager.curatedCatalog()` 懒读取目录；Remote 调用仅在标签页挂载时发生，插件激活期间不会读取。

### 阅读卡片

每张卡片原样使用服务器目录的名称与描述，在服务器提供时展示分类与版本。目录已标记为已安装的条目，其安装按钮被禁用；任何安装进行中时所有安装按钮均被禁用。

### 安装

点击安装会发送该条目的精确签名目录事实。成功应用（`applied` 或 `restart-required`）显示已安装消息并刷新目录。`stale-approval` 结果——目录 revision 在展示与审批之间发生了变化——显示列表已更新消息并刷新，让用户核对当前条目。其他结果或传输错误显示失败消息；用户可重试。

### 重试失败的读取

目录读取失败时在标签页内渲染错误状态并提供重试按钮，重新执行懒 `curatedCatalog()` 调用。空目录渲染自己的空状态；两者都不会展示宿主内置 Loader 清单。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器插件注册一个 id 为 `curated` 的本地化 `settings.plugins.tab` 贡献；「插件」分区拥有导航入口与标签栏。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

inject face 只携带两个 Remote 回调——`catalog` 与 `install`——闭包于 `ctx.remote.pluginManager`；locale `t` 座通过标准 `PropsLocale` 共享到达。组件维护自己的 loading/error/ready 视图状态以及安装的 busy/message 反馈。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置分区、Remote 调用与宿主侧目录验证。

- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——本标签页注册进的「插件」分区。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.plugins.tab` 的领域底座。
- [plugin-manager](../../boot/plugin-manager/README.zh.md)——本标签页驱动的宿主侧签名目录验证与精选 bundle 安装。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端目录视图，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义目录视图的新鲜度与触达范围；它们是当前包约束。

- **每次 Settings 挂载或重试只读取一份目录**：标签页不订阅目录变化，也不会在重连后自动重新读取；切换标签页会保留当前目录，重新打开 Settings 则会取得新目录。
- **仅服务器目录**：标签页不展示宿主内置 Loader 清单；侧栏的插件页是独立的管理入口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只持有一个只读 Settings contribution。
