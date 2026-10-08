---
kind: upgrade-guide
description: "使用内置离屏浏览器自动化与工具替代桌面端侧边栏浏览器的 webview。"
---

# 桌面端内置浏览器自动化

[English](guide.md) | 中文

## 变更

AsterHub Desktop 为右侧侧边栏浏览器引入了内置浏览器自动化能力。原有的 Electron `<webview>` 实现被替换为由 Electron 主进程拥有的离屏 `BrowserWindow` 镜像与画布，并配合无障碍屏幕阅读器镜像。

桌面端组合自动挂载 `@deepseek-ai/dsh-browser-use` 与 `@deepseek-ai/dsh-browser-use-desktop` 作为排他的 `desktop-internal` 提供方，注册八个类型化模型工具（`browser_tabs`、`browser_open`、`browser_close`、`browser_snapshot`、`browser_read`、`browser_act`、`browser_wait`、`browser_screenshot`）以及两个随附发布的 skill（`control-browser`、`web-gui-tester`）。非桌面端 profile（Web、无头、SDK）保留原有的 iframe 呈现方式与外部提供方选择。

## 迁移

1. 升级前备份 Desktop profile 配置。
2. 内置浏览器自动化会在桌面产品中自动启用。被访问的网页直接渲染到侧边栏画布上，无需 `<webview>` 支持、本地系统浏览器安装或公开调试端点。
3. 如果现有的 profile patch 中显式挂载了外部或实验性的 browser-use 提供方（例如 Playwright MCP、Chrome DevTools MCP 或 Stagehand），请在激活前从 Desktop profile patch 中移除或禁用该条目；共享 browser-use 服务一次只允许一个活跃提供方。
4. 屏幕阅读器用户可通过直接渲染在侧边栏面板中的无障碍 DOM 镜像与网页进行交互。键盘快捷键与工具栏操作继续保持原有方式工作。
5. 在自定义 profile 或测试环境中，可通过 `cordis.patch.yml` 中的 `@deepseek-ai/dsh-browser-use-desktop` 条目配置部署限制（`operationTimeoutMs`、`navigationTimeoutMs`、`snapshotMaxChars`、`readResultMaxChars`）。
