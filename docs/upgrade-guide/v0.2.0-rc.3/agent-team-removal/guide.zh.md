---
kind: upgrade-guide
description: "移除实验性 Agent Teams 依赖包、cordis 服务、profile 组合包与模型工具，恢复为使用普通 subagent 委派。"
---

# 移除实验性 Agent Teams

[English](guide.md) | 中文

## 变更

AsterHub 已完整移除实验性 Agent Teams 相关包（`@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-experimental-agent-team-profile`、`@deepseek-ai/dsh-experimental-client-ui-agent-team` 以及 `@deepseek-ai/dsh-experimental-tool-agent-team`）。

私有 `ctx.agentTeams` Cordis 服务、`@deepseek-ai/dsh-experimental-agent-team-profile` 可选组合包、Web 端 Team 侧边面板，以及 Team 作用域模型工具（`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create`、`team_task_update`、`team_task_list`、`team_task_get`）均已下线。普通 subagent 委派能力（`tool-subagent`、`subagent-spawn-in-process`、`subagent-fork-in-process` 以及 `tool-ralph` 工作流）完全保留，作为标准的多智能体编排机制。

包含历史持久化代际事件（`team/*`）的历史会话日志仍保留向后兼容读取与重放支持。

## 迁移

1. 从自定义 profile 的 `package.json` 中的 `dsh.profile.bundles` 列表移除 `@deepseek-ai/dsh-experimental-agent-team-profile`。
2. 在自定义 `cordis.patch.yml` 或 profile overlay 配置中，删除引用 `agent-team`、`tool-agent-team`, `ui-agent-team` 或已删除包名称的配置行。
3. 将要求创建 Team（`spawn_teammate` 或 `send_message`）的提示词和脚本调整为标准 subagent 工具调用（`subagent`、`subagent_control` 或 workflow `ralph`）。
4. 在 Web 和 Desktop 界面中，插件面板不再显示“智能体团队”（Agent Teams）卡片。通过标准的子智能体面板和会话层级导航查看子会话。
