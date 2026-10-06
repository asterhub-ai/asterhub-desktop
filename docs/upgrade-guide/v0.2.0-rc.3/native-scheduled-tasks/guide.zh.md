---
kind: upgrade-guide
description: "使用 AsterHub 内置定时任务替代桌面版可选的 Schedule Bundle。"
---

# 桌面定时任务

[English](guide.md) | 中文

## 变更

AsterHub Desktop 内置定时任务，并在“插件”下方提供常驻的“定时任务”入口。每次触发创建新会话；桌面产品不再使用可选 DSH Schedule Bundle 的原会话投递。其他 profile 保留原来的 Schedule 组合。

Desktop 保留旧提醒数据、Session 日志和无关的已安装插件。旧提醒不自动转换为原生任务，因为账户、模型、工作区和可独立执行的指令需要用户确认。Desktop patch 中显式挂载旧 Schedule 服务或界面的配置与原生组合冲突，开始调度前必须修正。

## 迁移

1. 升级前备份 Desktop profile 配置。不要删除旧 Schedule 任务存储或 Session 文件。
2. 从“插件”下方打开“定时任务”。查看旧提醒说明，再通过“新建任务”或聊天重新创建仍需要的提醒，选择工作区、模型与时区。确认前检查下次执行时间。
3. 若启动提示显式的旧 Schedule 配置，先备份 Desktop profile patch，再仅移除旧 Schedule 条目。保留无关插件条目和依赖；不要仅为隐藏警告卸载包。
4. 在任务面板检查保存的定义与首次运行，结果会打开独立会话。隐藏到托盘后继续调度；完全退出应用或关闭电脑后停止，直到 Host 再次启动。
5. 不要在已完成原生调度切换的 profile 上覆盖降级。旧安装可能无法识别切换标记。只有在单独审阅的降级流程中才恢复经过验证的升级前配置；原生任务数据不是旧 Schedule 存储。
