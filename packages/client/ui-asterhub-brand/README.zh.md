---
description: "在产品侧栏和新对话欢迎区呈现 AsterHub 名称与星形图案，不受客户端构建类型影响。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-brand

[English](README.md) | 中文

## 摘要

在侧栏和新对话欢迎区显示 AsterHub 自有名称与既有星形图案。本地和正式构建使用相同的产品标识。图案遵循各区域指定的尺寸，并在亮色和暗色主题下保持可见。本包不改变模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[AsterHub 产品 Web 组合包](../../bundle/asterhub-product-web/README.zh.md) 在 Desktop 和 Web profile 中挂载本插件，并禁用上游官方品牌插件。自定义组合不得为相同品牌槽位挂载第二个占用者。本包没有配置字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

浏览器入口将侧栏图标、名称和会话欢迎区图标作为一个声明感知集合安装。撤销声明会移除整个集合，恢复声明则重新安装占用者。图标复用既有 AsterHubMark 基元及其每实例独立的渐变标识。名称继承周围文字的排版和颜色。

| 文件 | 职责 |
|---|---|
| [src/client/index.ts](src/client/index.ts) | 声明感知的品牌注册与销毁 |
| [src/client/Brand.tsx](src/client/Brand.tsx) | 遵循所在区域尺寸的图案与产品名称 |
| [src/client/locales.ts](src/client/locales.ts) | 各语言一致的产品名称 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [侧栏](../ui-sidebar/README.zh.md)——品牌槽位声明与壳层布局。
- [会话](../ui-conversation/README.zh.md)——新对话欢迎区。
- [UI 基元](../ui-primitives/README.zh.md)——共享的 AsterHub 图案。

-----

<a id="model-experience"></a>
## 模型体验

无；本包仅提供浏览器呈现，不向模型请求添加任何内容。

#### KV Cache 影响

无；本包不组装也不发送 provider 请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

品牌呈现遵循以下职责限制：

- **窗口标题与应用图标**——由构建元数据和 Desktop 资源负责，而非槽位占用者。
- **运行时不变量**——无需不变量模块：呈现不持有可独立观察并发生分歧的运行时状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
