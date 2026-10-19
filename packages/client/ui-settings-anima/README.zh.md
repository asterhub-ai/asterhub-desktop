---
description: "在 AsterHub 设置中调整助手昵称、人格偏好、反思及账户可用的记忆处理模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-anima

[English](README.md) | 中文

## 概述

打开**设置 → Anima**，即可修改助手昵称、表达语气、解释详细程度、主动程度、幽默程度、情绪回应、相处距离和玩笑风格。从当前 AsterHub 账户选择记忆提炼与反思模型，或明确选择跟随当前对话模型。反思是唯一的功能开关；记忆记录、检索和写入默认启用，不显示技术上限。修改保存后生效。

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

Host 服务 `anima` 配置命名空间期间，Anima 分区会显示在设置中。编辑人格选项后选择**保存**；**放弃修改**会丢弃暂存修改。模型下拉菜单读取共享账户目录，同时保存准确的 provider/model 配对，不提供手填提供方、地址或凭据的字段。已保存模型不可用时会明确显示，重新选择后才能保存。目录加载失败时保留修改，并提供**重试**。**使用当前对话模型**选项继承已记录的 Session 路由，不显示空控件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器页面通过 `ctx.configForms.get` 绑定 Host 提供的 `anima` 命名空间，并在该命名空间受服务期间注册独立的 `settings.section` 项。暂存字段使用共享的 `SettingsFormModel`；文案由本包本地化。共享模型目录随账户、凭据和连接变化刷新。此页只展示和编辑配置，不负责记忆存储或模型执行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings](../ui-settings/README.zh.md)——共享设置 scope 和命名空间服务生命周期。
- [ui-primitives](../ui-primitives/README.zh.md)——暂存设置表单和字段控件。
- [ui-settings-general](../ui-settings-general/README.zh.md)——设置导航和页面外壳。

-----

<a id="model-experience"></a>
## 模型体验

此页不组装或发送模型请求。Anima 提取与反思所用模型是 Host 配置值；Anima 运行时组装请求时可能会发送检索到的记忆记录。

#### KV 缓存影响

无；此页不组装提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

此页编辑 Host 提供的设置文档，并依赖 Host 校验和应用这些值。

- **仅限账户可用模型**——页面拒绝选择当前目录中不存在的路由，Host 仍执行应用模型路由限制。人格偏好影响后续对话轮次，不改变应用身份或权限。
- **运行时不变量：**不发布 companion。此页没有独立可变关系；配置镜像和 slot 注册表拥有其状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>
