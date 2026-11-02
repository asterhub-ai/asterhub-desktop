---
description: "基于 fork 账户服务的 AsterHub 账户界面：登录、余额、充值与用量分区，恢复自合并前的客户端实现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-account

[English](README.md) | 中文

## 摘要

以独立 fork 客户端插件恢复的 AsterHub 账户界面：登录、余额、充值与 Token 用量分区，数据来自 `account-sub2api` Host 服务，移植自合并前的 `ui-settings-account` 实现。使用此客户端插件在设置中展示账户分区及其用量视图，外加未登录时的登录门。它通过窄化的注入动作调用 Host 的 `accountSub2api` Remote，从不接触账户令牌或模型密钥。桌面端的原生应用菜单可通过同一 Host 服务打开账户视图或请求退出登录。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

AsterHub 桌面组合将本插件挂载在上游账户界面旁。其 `dsh.client.inject` 在账户组件注册前声明 Remote 命名空间；设置分区以 `asterhub-account` 与 `asterhub-usage` 分区 id 注册，因此不会与上游的 `account` 分区冲突。

### 账户界面

账户分区提供登录、退出、余额、支付方式、充值与兑换控件。独立的用量视图按累计、近七日与今日三个窗口展示请求、Token 与积分汇总。Token 统计在 100 万以下显示分组精确值，从 100 万起使用 M，10 亿起切换为 B；紧凑值为显示舍入，记账保持精确。登录门依据 Host 状态遮盖工作台，直至认证成功。

充值表单提供 10/30/50/100 预设与自定义金额。已验证的定价按原始订单金额估算到账积分：金额乘倍率后保留两位小数，选取满足门槛的最高档位，bonus 模式下加上单独舍入的赠送部分。discount 模式保持到账余额不变，并将折后实付金额按币种精度舍入；无效或超过 100% 的折扣不生效。积分等于到账余额乘以 100。缺少定价时显示预览不可用，不阻塞旧版结账。展示的实付基础金额不含支付渠道手续费；最终金额以支付页面为准。

### 桌面菜单

桌面外壳向客户端发送打开账户与退出登录命令。插件将其转换为相同的账户 Remote 调用并刷新 Host 状态；不在浏览器存储中读取或保存模型凭据。

<a id="further-exploration"></a>
## 延伸阅读

- [账户 Host 服务](../../account/account-sub2api/README.zh.md)——凭据与 Sub2API 生命周期。
- [设置外壳](../ui-settings/README.zh.md)——设置分区注册。
- [Remote 组装](../../api/remotes/README.zh.md)——Web 客户端中的生成 Host 命名空间。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

客户端展示 Host 响应，不充当独立的账户权威方。它按客户端语言本地化已知的 `alipay` 与 `wxpay` 支付标签，未知方式保留 Host 提供的 ID 与标签。

- Host 报告无可用支付方式时，支付控件不可用。
- 用量视图要求 Sub2API 账户暴露其汇总统计端点。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>客户端集成</summary>

本包同时声明 `remote` 与 `remote.accountSub2api`；账户回调在跨越共享的设置与覆盖层插槽前完成窄化。

</details>
