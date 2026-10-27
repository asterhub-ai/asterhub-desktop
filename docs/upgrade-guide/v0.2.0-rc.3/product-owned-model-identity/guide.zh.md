---
kind: upgrade-guide
description: 自定义部署必须显式配置提示词开场白与请求归属，不再继承 AsterHub 身份。
---

# 产品拥有的模型身份

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-system-prompt` 将 `includeHarnessIdentity` 替换为 `harnessIdentity`，默认值为空字符串。AsterHub 产品组合包显式提供原开场白 `你是 AsterHub 的 AI 助手。`；其他部署不再继承它。

请求归属默认使用 `deepseek-harness` 身份。产品部署配置 `appIdentity.product` 与 `appIdentity.url`；版本从所属 LLM 包的 manifest 读取。适配器仍发送必需的 `User-Agent`，冲突的提供方请求头不能覆盖它。

## 迁移

1. 删除自定义 system-prompt 配置中的 `includeHarnessIdentity`。如需保留原启用行为，设置 `harnessIdentity: '你是 AsterHub 的 AI 助手。'`；如需保留禁用行为，省略 `harnessIdentity` 或设为空字符串。
2. 自定义产品组合应显式配置适配器的 `appIdentity.product` 与 `appIdentity.url`。如需现有 AsterHub 身份及部署策略，选择 AsterHub 产品组合包；不要把账户密钥放入请求归属。
3. 对比实际组装提示词和捕获的外发 `User-Agent`，检查是否符合部署预期，包括辅助请求及所配置的 Files API。不要仅为接受无法解释的提示词差异而替换录制预期。
