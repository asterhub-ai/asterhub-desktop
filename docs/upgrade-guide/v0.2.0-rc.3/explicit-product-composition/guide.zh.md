---
kind: upgrade-guide
description: 自定义 base profile 必须显式选择 AsterHub 产品组合包，才能保留产品默认值与预设导入。
---

# 显式 AsterHub 产品组合

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 提供通用服务，不再持有 AsterHub 部署默认值。以 base 为基础的随附 profile 选择 `@deepseek-ai/dsh-asterhub-product`；Web 还选择 `@deepseek-ai/dsh-asterhub-product-web`。独立的 `sdk-minimal` profile 不依赖这些产品组合。

加载现有具名随附 profile 时，仅将与原安装持有列表完全一致的组合包列表更新为当前模板。其他 manifest 字段和用户 patch 保持不变。包含额外组合包或改变顺序的列表属于自定义选择，不会被改写。

`standard`、`ptc`、`minimal`、`cordis` 预设文件现归 `@deepseek-ai/dsh-asterhub-product-web` 所有，不再由 `@deepseek-ai/dsh-web-app` 提供。

## 迁移

1. 编辑前备份自定义 profile 的 `package.json` 与 `cordis.patch.yml`。不要移动 Session 日志、附件或项目目录。
2. 如需保留 AsterHub 默认值，在 `dsh.profile.bundles` 中把 `@deepseek-ai/dsh-asterhub-product` 放在 `@deepseek-ai/dsh-base` 后。Web 组合还需把 `@deepseek-ai/dsh-asterhub-product-web` 放在 `@deepseek-ai/dsh-web-app` 后。确保安装环境提供这两个所选组合包。通用组合可明确不选择它们。
3. 将显式预设导入从 `@deepseek-ai/dsh-web-app/presets/<name>.patch.yml` 改为 `@deepseek-ai/dsh-asterhub-product-web/presets/<name>.patch.yml`。
4. 运行 `dsh --profile <name> --dump-config`，开始工作前检查实际模型路由、搜索提供方、项目持久化、附件和所选预设。产品层不授权更换模型提供方，也不替换账户凭据。
