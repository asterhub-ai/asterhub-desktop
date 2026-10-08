---
description: "AsterHub 的「精选插件」设置分区：设置导航项与供功能插件注册标签页的标签行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

[English](README.md) | 中文

## 概述

在设置中使用**精选插件**浏览并安装为 AsterHub 选定的包。分区拥有导航入口和标签行，功能插件贡献页面。默认页面读取经验证的服务端精选目录，而非 Host Loader 内置插件清单。

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

在设置里打开**精选插件**。[ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.zh.md) 把签名服务端精选目录作为分区唯一的页面贡献进来；注册第二个贡献后显示标签行。组合里没有任何标签页贡献的部署会显示分区的空提示。

要贡献一个标签页，带 `id`、`order` 和本地化的 `label` 注册进 `settings.plugins.tab`；分区按序渲染条目，标签页在首次被选中时挂载。功能文案留在注册方自己的字典里。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

分区声明 `settings.plugins.tab`，一个根级 list slot，其标签成为有序的标签页。只有一个贡献时直接渲染为页面，标签页在首次被选中后保持挂载，页面状态因此在切换间保留。分区把 slot 账本投影成按序排列、标签随当前语言的行，在账本版本或语言修订变化前保持缓存。宿主半侧没有行为，其 Loader 行使浏览器实现可供加载。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.zh.md)——签名服务端精选目录页面。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.section` 的领域基座。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——配置官方插件的插件页。
- [ui-settings-shell](../ui-settings-shell/README.zh.md)、[ui-settings-agent-loop](../ui-settings-agent-loop/README.zh.md)、[ui-settings-subagent](../ui-settings-subagent/README.zh.md)、[ui-settings-web-search](../ui-settings-web-search/README.zh.md)——官方配置页，每个一个伴生包。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **分区没有自己的标签页**——在功能插件注册标签页之前它只显示空提示；壳自己填不满分区。
- **运行时不变量：**不发布伴生。分区除了投影 slot 账本之外不拥有任何关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
