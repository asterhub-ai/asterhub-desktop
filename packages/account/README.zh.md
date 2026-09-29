---
description: "Host 拥有的账户登录、模型密钥绑定、额度、支付和用量访问。"
kind: "package-group"
---

# account/ — 账户服务

[English](README.md) | 中文

## 概述

account 组负责上游账户会话及 Desktop 客户端使用的账户数据。其 Host 服务将 token 和模型密钥存入 Host 凭据，并只向 Client 返回账户、额度、支付和用量界面所需的信息。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

account 组包含 Desktop 账户界面使用的 Host 账户服务。

| 包 | 职责 |
|---|---|
| [`account-sub2api/`](account-sub2api/README.zh.md) | 登录配置的控制面，并将账户模型密钥绑定到本安装（`ctx.accountSub2api`） |

<a id="related-documentation"></a>
## 相关文档

- [账户子系统](../../docs/subsystems/account.zh.md) — Host 账户 Remote 及其共享响应类型。
- [凭据子系统](../../docs/subsystems/credentials.zh.md) — 账户 token 与模型密钥使用的 Host credential record。

<a id="dev-note"></a>
## 开发备注

无。
