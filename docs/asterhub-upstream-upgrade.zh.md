# AsterHub 上游升级记录

[English](asterhub-upstream-upgrade.md) | 中文

本轮升级基线是 `dsh-v0.2.0-rc.2`，对应上游提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。升级工作区为 `deepseek-harness-upgrade`，分支名为 `codex/dsh-02-upgrade`。原 `asterhub` 分支和现有安装版与本工作区分开。

## 已确认的产品选择

| 功能 | 交付方式 |
| --- | --- |
| 会话、工作台核心和 V4 会话迁移 | 跟随本轮上游版本，同时保留 AsterHub 定制 |
| 语音输入 | 工作台内置；首次使用时下载识别模型 |
| 定时任务、Teams、Auto Review、Inspector | 四个独立云端精选包，默认客户端不携带 |
| 模型请求 | Host 固定使用 `sub2api/aster`，从账户 Host credential record 取得鉴权密钥 |
| 对话中的插件和 MCP 生命周期 | 允许任意来源，继续执行 Host 操作及构建脚本授权 |
| 应用插件页面 | 使用签名目录；按需下载并校验包地址、版本和 SHA-512 |

## 本轮进度（2026-10-01）

已解决 `23431db2e2` 的迁移冲突，并适配新版 Host 启动、LLM Volatile 配置、账户 credential record 与会话模型路由。精选包要求使用签名目录里的同源 `/releases/*.tgz`，验证直接依赖锁记录和包完整性后才激活。

语音输入已改为内置设置弹窗，不再打开插件详情页。MCP 安装说明已迁入新版 preset 包，供 Standard、PTC 和 Creator 使用。默认 Desktop 依赖中已移除计划任务、Teams、Auto Review、Inspector 与旧语音插件包。

Host 与 Client TypeScript 项目图、Host/Client 运行包构建均已通过。路由锁与插件管理定向测试 197 项通过，语音输入测试 61 项通过。首次编译生成的 `src/` 中间产物已移至临时目录，没有纳入版本控制。

后续待办包括迁回注册入口、GenOffice 与 Aster IM 精选包、Windows 便携启动器；打包四个独立精选包并生成签名目录项；检查最终 Desktop 运行依赖闭包，再打出可用压缩包。当前升级合并仍在进行，安装包和线上服务没有随本轮重新发布。

以后每次跟随 DSH 上游时，先固定版本并列出差异，再按已确认的产品选择迁移。优先在独立组合包和 Host 策略处隔离定制，避免用旧文件整体覆盖新版核心。
