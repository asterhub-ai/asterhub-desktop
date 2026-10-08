---
kind: upgrade-guide
description: "settings-general 包不再注册内置的「打开配置文件」标题栏操作；操作组件、store 与 locale 键已移除。"
---

# 设置移除内置「打开配置文件」操作

[English](guide.md) | 中文

## 变更

在 v0.2.0-rc.2 中，`@deepseek-ai/dsh-client-ui-settings-general` 为回环浏览器注册了一个**打开配置文件**标题栏操作。它调用宿主拥有的 `settings/openSettingsDocument` RPC。

下个版本移除该内置操作，以及浏览器导出的 `SettingsDocumentStore`、`SettingsDocumentState`、`SettingsDocumentActionInjected` 和 `SettingsDocumentActionProps`。`openDocument` 与 `openDocument.error` locale 键已从 `settings` 移除。`settings.action` slot 仍供功能包注册控件。

宿主端 `settings/openSettingsDocument` RPC 与 settings provider 不变；仅移除浏览器端内置消费方。

## 迁移

1. 如果你的功能插件注册了 `settings.action` 条目，它继续正常工作——slot 仍被声明并渲染。
2. 如果你从 `@deepseek-ai/dsh-client-ui-settings-general` 导入了 `SettingsDocumentStore` 或相关类型，请移除该导入。本包不再导出它们。
3. 如果你引用了 `settings` locale 命名空间的 `openDocument` 或 `openDocument.error` 键，请移除引用；这些键已不存在。
4. `settings.action` slot 现在默认为空。如需提供配置文件操作，请注册自己的功能拥有的 `settings.action` 条目。
