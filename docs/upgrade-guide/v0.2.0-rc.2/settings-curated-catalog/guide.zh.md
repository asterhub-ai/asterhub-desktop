---
kind: upgrade-guide
description: "设置中的精选插件以经验证的服务端目录替代 Host 清单页面及其导出的 props 类型。"
---

# 设置中的精选目录

[English](guide.md) | 中文

## 变更

在 v0.2.0-rc.2 中，设置可能在「精选插件」名称下展示 Host Loader 清单。仅供 Host 使用的 `curatedCatalog` 选项不会传到浏览器。下个版本始终使用 `pluginManager.curatedCatalog()` 和 `installCuratedBundle()`；目录不可用或为空时，不会回退到内置清单。

浏览器入口移除 `PluginInventorySettingsTabInjected` 和 `PluginInventorySettingsTabProps`，为精选目录页面导出 `CuratedPluginSettingsTabInjected` 和 `CuratedPluginSettingsTabProps`。Host 清单服务及其其他消费方不变。

## 迁移

1. 从自定义 profile patch 的 `ui-settings-plugin-inventory` 行中移除 `curatedCatalog`。此页面不再提供清单模式。
2. 仅在调用方展示服务端精选目录时，将已移除 props 类型的导入替换为精选目录 props 类型；提供 `catalog` 和 `install` 回调，而非清单回调。
3. Desktop 已提供其固定的精选目录公钥。其他 Host 必须为 `plugin-manager.curatedCatalogUrl` 和 `curatedCatalogPublicKey` 配置签名 HTTPS 目录及可信 Ed25519 公钥。
4. 打开设置 → 精选插件。确认页面显示服务端条目或目录的空／错误状态，绝不显示 Host Loader 清单。
