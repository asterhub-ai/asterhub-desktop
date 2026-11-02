---
description: "基于服务器签名目录的 AsterHub 精选插件页签。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-asterhub-catalog

[English](README.md) | 中文

## 摘要

以独立 fork 客户端插件恢复的 AsterHub 精选插件目录：插件页页签，数据来自签名验签的 `pluginManager.curatedCatalog()` Host Remote。移植自合并前的内嵌精选区块。

## 行为

页签以 `asterhub-catalog` 通过 `@deepseek-ai/dsh-client-ui-plugin-manager` 的 `plugins.tab` 插槽挂载。挂载后拉取验签目录并渲染加载中、不可用、为空三种状态；每个条目卡片展示名称、简介与版本，安装按钮的文案跟随 Host 计算的安装状态。安装时把目录精确事实（`id`、`revision`、`package`、`version`、`integrity`、`artifactUrl`）提交给 `pluginManager.installCuratedBundle()`：`stale-approval` 结果提示目录已更新并重新拉取，已应用的结果确认并重新拉取，其余结果一律报告失败。全部文案走 `asterhubCatalog` 字典。信封验签与目录解析留在 Host 侧；本包只渲染已验证的条目。
