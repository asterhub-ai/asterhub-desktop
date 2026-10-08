---
description: "仅限桌面端的浏览器操作 提供方，用于控制 AsterHub 的内置侧边栏浏览器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-use-desktop

[English](README.md) | 中文

## 概述

本包为 AsterHub 提供仅限桌面端的内置浏览器自动化 提供方。它注册排他的 `desktop-internal` 浏览器操作 提供方，并提供八个模型可见的工具，通过离屏渲染和可信输入控制用户可见的桌面端侧边栏浏览器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在桌面原生 Cordis 组合中，将插件与 browser-use 注册表一起挂载：

```yaml
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-browser-use-desktop'
  config:
    operationTimeoutMs: 3000
    navigationTimeoutMs: 30000
    snapshotMaxChars: 50000
    readResultMaxChars: 50000
```

该插件注入 `browserUse`、`tools`、`agents`、`desktopBrowserTransport` 与 `attachments`。它为实时 Agent 注册八个工具：

1. `browser_tabs` — 列出当前会话在侧边栏浏览器中的打开标签页。
2. `browser_open` — 导航或打开新标签页。
3. `browser_close` — 关闭特定的标签页目标。
4. `browser_snapshot` — 捕获无障碍 DOM 文本与分配的 ref。
5. `browser_read` — 读取固定元素属性（text、attribute、visible、enabled、checked）。
6. `browser_act` — 执行语义或坐标指针动作，并支持可选的后续观察。
7. `browser_wait` — 等待页面加载完成、URL 匹配或元素状态。
8. `browser_screenshot` — 捕获视口 PNG 字节并持久化为图像附件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

该 提供方 通过内存队列串行化各实时会话的操作。它从调用的 Agent 与宿主元数据中派生受信任的调用方身份，绝不从模型参数中接受调用方或会话身份。

捕获截图时，工具在请求像素前先验证模型是否具备图像能力。保存的截图字节通过 `ctx.attachments.saveImage()` 提交，并作为持久化图像附件引用。

文本输出在 1,000,000 字符传输上限内受 `snapshotMaxChars` 与 `readResultMaxChars` 约束，在截断时显式报告截断标记。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [浏览器操作](../../../docs/subsystems/browser-use.zh.md) — 提供方 选择与会话归属。
- [侧边栏浏览器客户端包](../../client/ui-sidebar-browser/README.zh.md) — 渲染器画布、呈现适配器与无障碍镜像。
- [桌面端外壳包](../../../apps/desktop/README.zh.md) — Electron 主进程离屏窗口归属与访客管理。

-----

<a id="model-experience"></a>
## 模型体验

该 提供方 暴露八个工具用于精准的 Web 检查与操作。工具模式定义确切参数与可判别的定位器。

#### KV Cache 影响

工具模式在 提供方 加载时注册一次，在系统提示词前缀中保持固定。工具调用结果包含结构化文本与图像附件。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **桌面运行时要求** — 该 提供方 需要带有 `desktopBrowserTransport` 的 Electron 桌面端外壳；它不能在 Web 或无头 CLI 配置文件中运行。
- **单一活跃浏览器后端** — 注册该 提供方 会占用排他的 `browserUse` 插槽，阻止第三方 MCP 浏览器 提供方 同时注册。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
