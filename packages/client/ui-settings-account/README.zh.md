---
description: "AsterHub Web 客户端的账户设置入口，提供登录、账户额度、支付、用量和退出控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account

[English](README.md) | 中文

## 概述

使用该 Client 插件在设置中显示账户区和用量视图，并在未登录时呈现登录门页。它通过窄化后的回调调用 Host `accountSub2api` Remote，不接收账户 token 或模型 key。Desktop 原生应用菜单也通过相同 Host 服务打开账户页或请求退出。

## 目录

- [使用本包](#use-this-package)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Desktop Web 组合会与生成的 `api-remotes`、locale、设置和侧栏 Client modules 一同挂载本插件。`dsh.client.inject` 在账户组件注册前声明 Remote namespace。

### 账户界面

账户区提供登录、退出、余额、支付方式、充值和兑换操作。独立的用量视图按累计、近七日和今日展示聚合请求数、Token 数和算力积分。Token 统计在 100 万以下显示带千分位分隔符的精确数值，达到 100 万后采用 M，达到 10 亿后采用 B；紧凑数值仅在界面显示时四舍五入，底层 Token 记账保持精确。用户未登录时发起受保护操作，登录门页会读取 Host 状态并打开账户界面。

充值表单提供 10/30/50/100 快捷金额和自定义金额。预览仅使用已验证的定价，以订单原金额计算：金额乘倍率后保留两位小数，选择已达到的最高阶梯，在奖励模式下叠加单独舍入的奖励。折扣模式保留到账余额，按币种精度舍入折后实付基础金额；无效折扣或达到 100% 的折扣不适用。积分为到账余额乘以 100。定价缺失时明确显示预览不可用，但不阻止旧版结算。实付基础金额不含支付手续费，最终金额以支付页面为准。

### Desktop 菜单

Desktop 壳层把打开账户页和退出命令发送给 Client。插件将它们转成同一账户 Remote 调用并刷新 Host 状态；不会在浏览器存储中读取或保存模型凭据。

<a id="further-exploration"></a>
## 进一步探索

- [账户 Host 服务](../../account/account-sub2api/README.zh.md)——凭据和 Sub2API 生命周期。
- [设置容器](../ui-settings/README.zh.md)——设置 section 注册。
- [Remote 组合](../../api/remotes/README.zh.md)——Web Client 中的 Host 生成命名空间。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

Client 展示 Host 响应，不作为独立账户 authority。已知的 `alipay` 和 `wxpay` 支付名称会按 Client 语言本地化；充值仍使用 Host 提供的支付方式 ID，未知方式继续显示 Host 提供的名称。

- Host 未提供已启用的支付方式时，支付控件不可用。
- 用量视图依赖 Sub2API 账户开放聚合统计接口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Client 集成</summary>

本包声明 `remote` 和 `remote.accountSub2api`；账户回调在进入共享 Settings/overlay 槽前会被窄化。

</details>
