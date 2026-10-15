# AsterHub 上游升级记录

[English](asterhub-upstream-upgrade.md) | 中文

当前工作区在 `codex/upstream-alpha2` 上选择性吸收 [DSH 0.2.1-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)。桌面产品版本保持 `0.21.0`，工作区包版本保持 `0.2.0-rc.3`。

## 已实施改动

| 分组 | 结果 |
| --- | --- |
| 原有桌面基线 | 安装首屏显示安装目录。桌面凭据使用 Electron 操作系统加密；加密模式拒绝明文文件，不执行迁移。 |
| 桌面依赖 | Electron 44.7.0、原生 builtin loader 0.1.9、electron-builder 与 app-builder-lib 26.17.0；规范化盘符根目录在目录归属检查前被拒绝。 |
| 计划审阅 | 取消返回 `approved: false`、结束当前轮次并保留计划模式；只有批准才退出。 |
| SenseVoice | 首片段起始补偿默认为 0.3 秒，范围为 0–1 秒，后续片段保持不变。 |
| pi-ai | 升级为 1.0.2，按目录能力启用对话更新，保留回放工具命名空间和只在结束时解析工具参数 JSON 的补丁。 |

AsterHub 保留账户拥有的 Sub2API 凭据与模型目录、项目附件作用域、品牌及签名精选插件目录。本轮不新增 CLI 产品模式、实验性 Worktrees、旧版本迁移或公开发布。

## 验证结果

| 证据 | 实际结果 |
| --- | --- |
| Host 与 Client 项目图 | `node node_modules/typescript/bin/tsc -b tsconfig.host.json tsconfig.client.json` 通过。 |
| 桌面、ASAR、Host 与 HMR 测试 | 定向串行运行：203 项通过，3 项平台用例跳过。 |
| Windows 打包运行时 | 官方 x64 打包及 ASAR Host 冒烟通过，涵盖 DOCX/XLSX/PPTX 转换、工作区检查和 Session 创建。 |
| Windows 原生安装器 UI | 使用生产 NSIS 配置的测试 payload，两种语言各通过 15 项，覆盖欢迎页、路径校验、安装、启动与卸载。 |
| Windows 安装包 | unsigned `0.21.0` 安装包已安装到隔离临时目录；确认 `AsterHub.exe` 和卸载程序存在，并成功静默卸载。 |
| 计划模式 | 包内 88 项测试通过；追加下一条消息断言后，4 项集成测试也通过。 |
| SenseVoice | 独立运行的推理与 Worker 测试 35 项通过；追加的 2 项配置越界用例通过。此前广泛运行有 2 项时序失败。 |
| pi-ai 与账户集成 | 413 项测试通过。HTTP 夹具支持 pi-ai 发出的 zstd 请求。 |
| 操作系统凭据加密 | 真实 Electron 进程写入加密账户 grant，第二个进程成功解密。 |
| 本地更新器 | 真实 Electron 44.7.0 的 17 个场景通过，使用回环服务和惰性载荷，未执行安装器；截图捕获失败，不计为视觉验收。 |
| 官方本地审查 | `codex review --uncommitted` 已启动，但被账户用量限制中断，未产生审查结论。 |

真实账户登录、会话令牌刷新、`/auth/me` 和账户绑定的模型目录读取均成功，复用了已有模型 Key。通过升级后的产品适配器调用 GPT-6-Luna，文本生成、请求工具调用及预期参数、工具结果往返均通过；请求取消成功，无效测试 Key 被拒绝。GPT-6-Luna 未返回推理块，推理流需换用会输出推理内容的模型继续验收，真实双账户切换也尚未验证。本次没有新建或轮换任何账户 Key。

首次广泛选择的桌面与运行时测试未全部通过，其中包含 Windows 文件符号链接权限失败、过时的身份提示断言和解析矩阵失败；持续执行的剩余 Worker 被终止。之后的桌面与 HMR 定向复核通过，不能混同两次结果。

Windows 上的 `ptc-turn` 录制会话回放能够启动，但 Windows 自动贡献了沙箱 ACL 诊断技能，导致持久化会话预期比较失败。未用 Windows 专属输出替换跨平台 Session 夹具；已有工具 schema 侧文件已将 `approved` 更新为布尔值。

仓库级约束报告已有的私有包发布元数据、工作区版本范围及默认实验性语音依赖问题。依赖分类检查也拒绝现有文件上传代码导入的 `resolveProjectAttachmentScope`。文档快速检查完成，10 个检查通过、11 个失败，包括已有的启动引导链接失效和账户类型等价清单缺项。文档站点构建与文档类型检查通过；`doc-sync` 在 3 个缺少 `@mode` 标记的既有自动化事件处停止。全仓 lint 报告 559 条诊断，暂存区 lint 通过。这些仓库级检查不记为通过。

## 产物与待验收项目

首次官方 Windows x64 unsigned 打包在 npm 下载超时后失败，随后通过正式打包脚本完成；npm 镜像配置仅作用于该进程。安装包位于 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/asterhub-0.21.0-win-x64-unsigned.exe`（440,041,976 字节；SHA-256 `19ACDEA8397D10E90C6E1F164315965D0D2ABBB0FF5946A75A8CD37F2B4AAF0C`）。打包和更新器日志保存在 `apps/desktop/.desktop-build/`；文件未签名或上传。

账户登录与模型调用已通过 Sub2API 真实服务验收；GPT-6-Luna 没有返回推理块，推理流和产品内双账户切换仍待验收。语音录音按用户要求跳过。macOS 安装和原生运行时验收仍待完成。
