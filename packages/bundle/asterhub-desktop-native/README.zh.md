---
description: "Desktop 管理的原生定时任务、任务管理面板、时钟上下文和内置浏览器工具组合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-asterhub-desktop-native

[English](README.md) | 中文

<a id="summary"></a>

## 概述

通过 AsterHub 桌面应用管理定时工作并操作内置浏览器。桌面 profile 在共享应用组合后挂载本 bundle。任务在应用保持运行时执行，每次执行创建新的 Session。

<a id="table-of-contents"></a>

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

桌面应用负责安装和启用此私有 bundle。[覆盖配置](cordis.patch.yml)挂载原生自动化 Host、任务面板、时钟上下文、浏览器使用注册表和桌面浏览器 provider。它没有独立的产品入口。

<a id="understand-the-implementation"></a>

## 理解实现

覆盖配置使用桌面拥有的行 ID，并在共享 Web 渲染层组合后加载。原生自动化服务和面板取代可选 Schedule bundle；时钟行复用维护中的 time-context 包。浏览器操作通过 Desktop Host 私有 IPC 通道传输。

<a id="further-exploration"></a>

## 进一步探索

- [自动化 Host](../../schedule/asterhub-automation/README.zh.md)
- [任务面板](../../client/ui-asterhub-automation/README.zh.md)
- [桌面浏览器 provider](../../browser-use/browser-use-desktop/README.zh.md)

<a id="model-experience"></a>

## 模型体验

间接影响，通过覆盖配置挂载的时钟、原生自动化和浏览器 provider。

#### KV Cache 影响

所挂载的 provider 拥有提示词、工具模式和结果内容；启用或禁用对应行可能改变模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 需要 Electron 桌面壳及其私有 IPC 服务。
- 应用必须保持运行才能执行定时任务；此 bundle 不安装操作系统后台调度器。

<a id="dev-note"></a>

### 开发备注

桌面专属行及其声明的解析依赖保留在此覆盖配置中。
