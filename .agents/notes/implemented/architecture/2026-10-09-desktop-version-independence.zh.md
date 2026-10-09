# Agent Note: 保持 AsterHub Desktop 与 DSH 版本独立

Status: implemented

[English](2026-10-09-desktop-version-independence.md) | 中文

## 问题

AsterHub Desktop 的发布节奏可以独立于共享 DSH runtime。若要求产品版本必须等于 DSH 包版本，当 runtime 包未变化时，就会阻止 Desktop 发布更新。

## 决策

`apps/desktop/package.json` 决定已安装 Desktop 产品版本，以及 `electron-updater` 比较的版本。仓库根目录 `package.json` 决定随包发布的 DSH runtime 版本。两者彼此独立；当前 Desktop 产品版本为 `0.2.1`，内置 DSH runtime 保留自己的包版本。

Electron 清单、安装包名称、更新 feed 元数据、打包完成记录和上传校验使用 Desktop 产品版本或经确认的测试构建版本。runtime 描述文件、开发项目和 `desktop-host` 包集合使用仓库根目录的 DSH 版本。`verifyDesktopRuntime` 校验该 runtime 版本，强制更新策略也会将它与已安装的 Desktop 版本分开接收。

production 发布使用 Desktop 清单中的准确版本。测试版本从 Desktop 基础版本派生：预发布版本追加 `.YYYYMMDD.index`，稳定版本追加 `-test.YYYYMMDD.index`。分配序号前，操作者检查保留记录与目标发布位置。[构建版本参数决策](../process/2026-09-21-desktop-build-version-as-input.zh.md)确保测试版本不会写入受跟踪的清单。先前由 DSH 决定基础版本的规则保留为[历史政策](../../archived/process/2026-09-16-desktop-release-version-derivation.md)。

## 考虑过的替代方案

**使用仓库根目录的 DSH 版本作为 Desktop 产品版本。** 不采用，因为这会把 AsterHub 更新发布绑定到独立发布的 runtime 包；即使不需要更改 DSH 包，也可能无法发布应用更新。

**每次 Desktop 发布时改写 DSH 包版本。** 不采用，因为这些清单标识另一套 runtime 发布家族；改写会错误声明包版本，并重现大范围锁文件变更。

## 结果

Desktop 更新排序使用 Desktop 产品版本。runtime 兼容性仍由内置 runtime 和共享包声明的 DSH 版本校验。打包和上传代码必须分别对照各自版本所有者校验，不再比较这两个版本。

测试构建保留清单中的 Desktop 产品版本，并使用显式 `--build-version` 设置产物名称和更新元数据。替换 feed 不能把已安装客户端降级；纠正为更低版本时需要手动安装。

## 验证

`desktop-upload-plan.spec.ts` 覆盖 Desktop 版本为 `0.2.1`、DSH runtime 版本为 `0.2.0-rc.3` 的产物。`package-target-stages.spec.ts` 验证完成记录使用 Desktop 版本。`packaged-runtime-verification.spec.ts` 验证内置 runtime 按仓库根目录 DSH 版本校验。
