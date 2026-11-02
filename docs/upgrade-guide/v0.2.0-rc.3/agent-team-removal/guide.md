---
kind: upgrade-guide
description: "Remove experimental Agent Teams packages, cordis service, profile bundle, and model tools in favor of ordinary subagent delegation."
---

# Experimental Agent Teams removal

English | [中文](guide.zh.md)

## Change

The experimental Agent Teams packages (`@deepseek-ai/dsh-experimental-agent-team`, `@deepseek-ai/dsh-experimental-agent-team-profile`, `@deepseek-ai/dsh-experimental-client-ui-agent-team`, and `@deepseek-ai/dsh-experimental-tool-agent-team`) have been completely removed from AsterHub.

The private `ctx.agentTeams` Cordis service, the `@deepseek-ai/dsh-experimental-agent-team-profile` optional bundle, the Web UI team panel, and the team-scoped model tools (`spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create`, `team_task_update`, `team_task_list`, `team_task_get`) are no longer available. Ordinary subagent delegation (`tool-subagent`, `subagent-spawn-in-process`, `subagent-fork-in-process`, and `tool-ralph` workflows) is fully preserved as the standard multi-agent orchestration mechanism.

Historical session logs containing persistence generation events (`team/*`) remain supported for historical reading and replay.

## Migration

1. Remove `@deepseek-ai/dsh-experimental-agent-team-profile` from the `dsh.profile.bundles` list in any custom `package.json` profiles.
2. In custom `cordis.patch.yml` or profile overlay configurations, delete any rows referencing `agent-team`, `tool-agent-team`, `ui-agent-team`, or the deleted package names.
3. Replace prompts and scripts that requested team creation (`spawn_teammate` or `send_message`) with standard subagent tool calls (`subagent`, `subagent_control`, or workflow `ralph`).
4. In Web and Desktop interfaces, the Plugins panel no longer displays the "Agent Teams" ("智能体团队") bundle card. Use standard subagent panels and conversation hierarchy navigation to inspect child sessions.
