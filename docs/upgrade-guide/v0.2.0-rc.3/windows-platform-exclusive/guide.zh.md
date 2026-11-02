---
kind: upgrade-guide
description: "移除 Linux 与 macOS 宿主打包及发布目标；AsterHub 当前专为 Windows 平台开发与发布。"
---

# 仅支持 Windows 平台

[English](guide.md) | 中文

## 变更

AsterHub 当前专为 Windows x64（`win32-x64`）平台开发与发布。Linux 和 macOS 宿主专有的桌面打包、CI 工作流、原生预编译产物与平台发行路径均已移除。

- 根目录脚本与桌面构建目标不再提供 macOS 打包命令（`package:desktop:mac:*`、`upload:mac:*`、`upload:latest:mac:*`）或 Linux 宿主桌面构建。
- Python SDK 运行时 wheel 包分发物仅发布针对 `win_amd64` 的 `deepseek-harness-runtime-bin`。不再发布 Linux 与 macOS 运行时 wheel 包。
- 非 Windows 原生插件包（面向 Linux 与 macOS 的 `@deepseek-ai/node-addon-system` 平台包）以及宿主沙箱运行器（`bwrap`、`landlock`、macOS Seatbelt）已从仓库中移除。
- 未被产品采用且仅支持 POSIX 客户端的 `dsh-ssh`、`dsh-fs-ssh`、`dsh-subprocess-ssh` 和 `dsh-sandbox-ssh` 包已删除。Windows shell 工具仍可调用外部 `ssh.exe`；被删除的仓内提供方不是 Windows SSH 实现。通用第三方库与 Windows Git Bash/PowerShell 继续保留。

## 迁移

1. 桌面端部署请使用 Windows x64 安装程序，或在 Windows 环境下运行 `pnpm run dev:desktop` 从源码启动。
2. Python SDK 集成请在 Windows x64 上安装 `deepseek-harness-sdk` 与 Windows 运行时 wheel 包。此前运行在 Linux/macOS 宿主上的 AsterHub 工作负载应迁到 Windows；外部 SSH 命令执行不代表恢复在这些宿主上运行 AsterHub 的支持。
3. 在 CI 与开发脚本中，移除对已删除脚本（如 `check:ci:linux-primary`、`check:windows-wine`、`package:desktop:mac:*`）的调用，改用 Windows 原生命令（`pnpm run check:ci:windows-complete`、`pnpm run package:desktop:win:x64`）。
4. 任何针对 Linux 沙箱隔离或 macOS 专属 shell 集成的自定义 Cordis 配置或 profile overlay，请移除对应平台专用设置；Windows 平台原生使用 Windows ACL 受限令牌后端。
5. 自定义 `sandbox-local.runnerCommand` 现在接收 Windows 策略参数：`--workspace <解析后的根目录> --temp <临时根目录> --mode <read-only|workspace-write> -- <命令...>`。包装器需要读取并执行这些参数；不再传入 Linux `bwrap` 挂载参数。自定义运行器配置仍声明完整隔离，且必须通过 `runnerFailureSignatures` 标识自身的初始化失败。
6. Anima 运行时准备只接受 Windows x64 归档，并查找 `bin/java.exe`；删除 Linux/macOS 与 ARM64 准备目标。浏览器 worker 保留进程内会话写入互斥，是虚拟运行时，不代表支持 Linux 部署。
