---
description: "当携带 .aster/sessions 的项目目录在本机注册为 Workspace 时，把其中的项目本地 Session 一次性采纳进 Workspace 注册表。"
kind: "package-reference"
---

# Project Adopt

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-project-adopt` 把物理存放在某个 Workspace 的 `.aster/sessions` 之下的 Session 重新归属到该 Workspace 的记录上。采纳一台机器迁移而来的项目目录时，其历史、附件路由与重放后的工作目录都得以保留，全程不依赖清单文件，也没有后台对账循环。

<a id="toc-host-service"></a>
## Host service

`ProjectAdoptService`（`ctx.projectAdopt`）在 Workspace 注册表与项目 Session 持久化之后挂载；`static inject` 声明了这两个依赖。服务监听 `domain/changed`，每进程内对每条新写入的 `workspaces` 记录只采纳一次，因此改标题或成员关系变更不会触发重扫。显式调用方调用 `adoptWorkspace(id)` 并共享同一次记忆化的运行；失败的运行由下一次调用重试。

<a id="toc-adoption-behavior"></a>
## Adoption behavior

目录下没有 `.aster/sessions` 的 Workspace 直接空转返回。否则服务通过持久化后端列出项目 Session，并保留未被任何 Workspace 记录领走的那些。每个保留的 Session 先追加一条以 Workspace 路径为目标的 `working-directory/change` 事件，再经 `workspaceRegistry.adoptSession` 进入记录；事件先于成员关系，因为 `adoptSession` 要求调用方先提交该事件。存储的 header 永不改写——重放追加的事件即在本机恢复被采纳的目录，重复采纳不会再写入。

单个 Session 失败时记录含其 session id 的错误并跳过，因此一份不可读的日志不会阻塞其余会话；下一次采纳会重试它。扫描级失败使 `adoptWorkspace` 拒绝；监听触发器会记录该拒绝，因为 domain 写入方不应等待采纳。

<a id="toc-packaging-contract"></a>
## Packaging contract

包导出服务（default）、来自 `./adopt-session` 的纯函数 `appendWorkingDirectoryEvent`，以及 `./src/*` 下的源码。包内 `tsdown.config.ts` 在 Host 构建面输出两个运行时入口，在 Client 构建面（`DSH_BUILD_FACE === 'client'`）输出为空。

<a id="toc-verification"></a>
## Verification

聚焦测试：`pnpm exec vitest run packages/workspace/project-adopt/tests/`。

## Model Experience

间接：追加的 `working-directory/change` 事件经重放后通过 working-directory 投影与系统提示词上下文到达模型。

## Known Limitations and Deferred Work

- **旧扁平布局令扫描 fail loud** —— 若根目录的 `.aster/sessions` 内是扁平 `.jsonl` 工件，持久化列举会以不支持的布局错误拒绝，此类根不会被采纳；其处置属于迁移决策。
- 未发布 `./invariant` 伴随包：本服务不拥有任何"独立观察可能分叉"的关系——成员关系可经 Workspace 注册表观察，追加的事件可经 Session 持久化观察。

<a id="toc-dev-note"></a>
### Dev Note

`working-directory/change` 载荷由 `@deepseek-ai/dsh-working-directory` 声明；组合必须挂载该服务，重放出的目录才会生效。
