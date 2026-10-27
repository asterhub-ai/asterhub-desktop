---
description: "AsterHub Desktop 的 Host 账户服务，负责登录、Sub2API 模型密钥绑定、算力积分、支付和用量 Remote 操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-account-sub2api

[English](README.md) | 中文

## 概述

使用该 Host 服务登录配置的 Sub2API 控制面，并将服务端下发的模型密钥绑定到当前安装。账户 token 与资料偏好保存在 Host credentials，活动模型 key 保存在独立 credential record。Desktop profile 使用 Electron 的 OS 加密服务加密凭据文档；模型路由仅在准备请求时从 Host 读取密钥。Remote 方法只向 Client 返回账户、算力积分、支付和用量数据，不暴露秘密。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [失败行为](#failure-behavior)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Desktop Web profile 将本服务与 `credentials-local`、账户 Client 插件一起挂载。Client 调用生成的 `accountSub2api` Remote namespace；只有 Host 拥有凭据并发起 Sub2API HTTP 请求。

### 账户模型 key

成功登录时优先复用该账户已有的 Sub2API 分组 key；只有账户没有 key 时才请求 Sub2API 创建。Host 将该服务端下发的 key 保存在 `asterhub-account/model-api-key`；Desktop 加密凭据文档会保护磁盘上的值。模型 key 不会从 Client、环境变量或 `.env` 文件获取。退出登录会删除活动 key record，同时保留按账户缓存的记录，供同一账户下次登录复用上游 key。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `authBaseUrl` | `https://xapi.fans/api/v1` | Sub2API 账户控制面 API。Desktop application policy 固定该 URL。 |
| `groupId` | `6` | 需要新建 key 时使用的上游分组。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-account-sub2api)列出所有可接受字段。

### Remote 操作

Host 提供状态、登录/退出、额度、支付方式、充值、兑换和用量操作。Remote 响应只包含账户视图所需字段；access token、自动登录密码和模型 key 均保留在 Host credentials。Desktop 凭据文档使用 Electron `safeStorage`，由 OS 加密服务保护。Linux 需要 GNOME libsecret 或 KWallet；应用拒绝不安全的 `basic_text` 后端。结算方式由 `methods` 的键标识；未提供 `available` 字段的方式仍可使用，只有明确标记 `available: false` 的方式会被排除。若账户引用由启动环境以只读方式提供，登录会跳过该引用的写入；其他可写账户引用及账户模型 key record 仍会照常持久化。只要存在环境来源的账户引用，`getStatus` 就会返回 `credentialsFromEnv: true`。环境值仅在启动期间生效，不会复制到账户模型 key record。

支付方式可附带从 `payment/checkout-info` 验证的充值定价：有限正倍率、已校验的奖励阶梯以及奖励或折扣模式。定价缺失或无效时，旧版结算仍可使用，但不提供预览；Host 不推测倍率。支付限额只接受有限正数。币种代码用于支付金额舍入。预览不含支付服务商手续费。

额度余额将上游余额乘以 100，并四舍五入至两位小数。用量积分按上游实际消费额度乘以 100 并四舍五入至两位小数，与额度余额换算保持一致。用量按账户累计、近七日和今日汇总，不表示单个 Session 的费用。

<a id="understand-the-implementation"></a>
## 理解实现

服务会串行化 key provisioning，避免并发登录重复创建分组 key。它查询已登录账户的已有分组 key，对列表中被遮蔽的 key 尝试读取详情；如果账户已有 key 却无法读取，则失败，不会轮换密钥。本地 key cache 按账户身份区分。凭据写入按步骤执行，账户切换写入中途失败时会清理活动会话，不把一个人的 token 与另一个人的 key 配对。

<a id="further-exploration"></a>
## 进一步探索

- [凭据](../../credentials/credentials/README.zh.md)——Host credential reference 与 record。
- [Pi-ai 适配器](../../llm/llm-pi-ai/README.zh.md)——模型路由读取 credential record。
- [客户端账户入口](../../client/ui-settings-account/README.zh.md)——登录与账户视图。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

账户操作依赖配置的 Sub2API 控制面和已启用的支付方式。

- 旧账户 key 引用只从 managed file 来源迁移；环境层值会被刻意忽略。
- 历史重复上游 key 不会自动删除。

<a id="failure-behavior"></a>
### 失败行为

无效凭据仍返回原账户错误。Fetch 超时与其他连接失败会返回不同的安全提示；上游超时沿用原有请求时限，客户端不增加重试。上游 HTTP 故障仍统一提示服务暂不可用；只有识别到 `permission_denied` 或 `group_binding_forbidden` 时才返回权限提示，不会把任意 403 响应分类为权限错误。格式错误的认证响应会返回安全的无效响应提示。认证成功后若本地凭据保存失败，服务会尝试清理部分写入的活动凭据，并返回本地保存失败提示，不暴露 provider 错误或密钥内容。会话过期会清除活动 token 和 key record；临时额度查询失败则保留已登录账户，供之后重试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Host 集成</summary>

`AccountSub2apiService` 使用 `ctx.credentials` 并注册 `accountSub2api` namespace。Desktop 通过 application-owned 启动策略固定控制面 URL，不从环境或 profile 设置读取。

</details>
