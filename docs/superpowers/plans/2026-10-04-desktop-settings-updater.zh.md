# Desktop 设置更新检查与 Windows 发布实施计划

[English](2026-10-04-desktop-settings-updater.md) | 中文

> **面向执行工作的 Agent：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐项实施。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 在常规设置版本旁增加 Desktop 专属手动更新操作，并通过现有 AsterHub Nightly 源发布一个签名的 Windows x64 `0.2.0-rc.3` 安装器。

**架构：** 设置行调用新的私有 Desktop preload/IPC 手动检查操作；渲染进程不提供版本、URL 或安装授权。主进程复用现有 electron-updater 状态机和一次下载并安装同意，保留单独的活动任务中断确认。发布复用当前 Windows 打包器与 COS 上传器；展示精确产物元数据和哈希并获得确认后，才能写入生产。

**技术栈：** TypeScript、React slots/locales、Electron IPC/preload、electron-updater、pnpm 11.7.0、Windows x64 签名安装器、Tencent COS。

**设计：** `docs/superpowers/specs/2026-10-04-desktop-settings-updater-design.md`

## 全局约束

- 此计划以根目录和 Desktop manifest 中的产品版本 `0.2.0-rc.3` 为目标。
- 发布目标为 `win-x64` 标准签名安装器，生产源为 `https://asterhub.xapi.fans`。
- 当前线上 Windows Nightly 源返回 HTTP 404。
- 一次明确确认授权下载并安装精确的已检查候选版本；可能中断活动工作的安装需要另行确认。
- 自动检查绝不下载或安装。渲染进程绝不选择更新 URL 或候选版本。
- `apps/desktop/.env.windows` 是 Git 忽略的本地配置。不得打印或复制其中的机密值。
- 展示并确认精确对象 key、大小和 SHA-512 之前，绝不上传生产 COS。
- 除非公开源验证证明有必要，否则不修改生产 Nginx、Cloudflare、DNS 或目录服务配置；确有必要时，另行获得精确范围的确认。
- 保留之前修改的交接文档、设置和精选插件改动。不重置或重写现有发布提交。

---

### 任务 1：增加主进程手动安装同意

**文件：**
- 修改：`apps/desktop/src/ipc.ts`
- 修改：`apps/desktop/src/preload-app.ts`
- 修改：`apps/desktop/src/main.ts`
- 修改：`apps/desktop/src/locale.ts`
- 测试：`apps/desktop/tests/main-startup.spec.ts`
- 测试：`apps/desktop/tests/preload-app.spec.ts`

**接口：**
- `DshDesktopProductApi.updates.check(): Promise<void>` 调用新的 `DESKTOP_IPC.updatesCheck` 通道，且该通道验证产品发送者。
- 主进程 `updatesCheck` 和现有原生 **Check for Updates…** 菜单使用 `openUpdatePrompt(true)`；`updates.open()` 继续提供现有状态和徽标操作。
- 主进程私有保存精确候选版本预授权。仅在手动提示接受精确的已检查版本后授予；渲染进程 IPC 不能设置它。

- [ ] 为 `main-startup.spec.ts` 增加测试：`updatesCheck` 手动检查，且没有新版时展示当前版本、不下载。
- [ ] 增加测试：没有活动任务时，接受可用版本的**下载并安装**提示会下载精确候选版本并交给现有安装器，不再展示普通的第二次安装提示。
- [ ] 增加测试：安装时存在活动任务，仍要求单独的停止任务确认；拒绝后保留已下载版本的就绪状态，不调用 `quitAndInstall`。
- [ ] 增加测试：拒绝最初更新确认后，不下载或安装。
- [ ] 在 `preload-app.spec.ts` 中断言 `updates.check()` 仅调用 `DESKTOP_IPC.updatesCheck`；preload 不暴露直接下载或安装能力。
- [ ] 运行这两个完整测试文件；确认新增断言在生产修改前失败、修改后通过。
- [ ] 实现带发送者验证的 IPC 和主进程版本授权。在 `finally` 中清除授权；仍拒绝任务状态错误和不正常的 Host 关闭。
- [ ] 更新本地化的可用更新文案，说明同意会下载、安装并完成重启；保留单独的任务中断提示。
- [ ] 运行这两个完整测试文件。

### 任务 2：增加 Desktop 专属常规设置操作

**文件：**
- 修改：`packages/client/ui-settings-general/src/types.ts`
- 修改：`packages/client/ui-settings-general/src/client/desktop-update-source.ts`
- 修改：`packages/client/ui-settings-general/src/client/CurrentVersionRow.tsx`
- 修改：`packages/client/ui-settings-general/src/client/CurrentVersionRow.module.css`
- 修改：`packages/client/ui-settings-general/src/client/index.ts`
- 修改：`packages/client/ui-settings-general/src/client/locales.ts`
- 测试：`packages/client/ui-settings-general/tests/desktop-update-source.client.spec.ts`
- 修改：`packages/client/ui-settings-general/README.md`
- 修改：`packages/client/ui-settings-general/README.zh.md`

**接口：**
- `DesktopUpdateBridge.check(): Promise<void>` 表示主进程拥有的一次手动检查与同意提示；不接受版本或 URL。
- 只有 Desktop preload 协议存在时，注册的 `current-version` 行才收到功能拥有的 `checkUpdates` 回调。纯 Web 行仍只展示版本。

- [ ] 增加组件测试：存在 Desktop 回调时，版本行展示本地化的**检查更新**按钮，点击时恰好调用一次。
- [ ] 增加组件测试：没有可选 Desktop 回调时，不展示更新按钮，仍展示编译时版本。
- [ ] 增加 Client 组合测试：General 插件注册版本行，并从其拥有的 preload 载体绑定可选 Desktop 操作。
- [ ] 运行完整 `components.client.spec.tsx` 和 `apply.client.spec.ts`，确认新增断言在实施前失败。
- [ ] 为可选 Desktop bridge 增加 `check()`，并在 `DesktopUpdateSource` 中实现，合并进行中的操作，保留释放和错误状态。
- [ ] 向 `CurrentVersionRow` 注入回调；使用现有语义按钮、token 和 locale 文案。不增加 Web 设置更新 API。
- [ ] 运行完整的三个测试文件。

**任务 3 验证：** Client/Host `tsc -b` 和 `build:official` 通过。兼容 Node 的 DesktopUpdateSource 测试 15/15 通过；组件和 apply 的 jsdom 文件在环境准备阶段失败，`test:updates:local` 在强制状态 IPC 场景失败。隔离开发 profile 中无法访问已认证设置界面。精确结果见 `.superpowers/sdd/2026-10-04-desktop-settings-updater/progress.md`。

### 任务 3：验证编译器、产品构建和本地更新器

**文件：**
- 验证：`tsconfig.client.json`
- 验证：`tsconfig.host.json`
- 验证：`apps/desktop/tests/`
- 验证：`apps/desktop/scripts/test-local-updater.mjs`

- [ ] 运行 `node node_modules/vitest/vitest.mjs run apps/desktop/tests/main-startup.spec.ts apps/desktop/tests/preload-app.spec.ts apps/desktop/tests/update-coordinator.spec.ts`，覆盖完整文件。
- [ ] 运行 `node node_modules/typescript/bin/tsc -b tsconfig.client.json tsconfig.host.json`。
- [ ] 运行 `corepack pnpm run build:official`，重新生成官方 Client 产物和 TypeScript 输出。
- [ ] Windows 无签名前置条件允许时，运行 `corepack pnpm --dir apps/desktop run test:updates:local`；要求其本地更新器报告和退出码为零。
- [ ] 运行 UI 组件验证，并查看英文/中文、浅色/深色的真实设置界面；确认 Desktop 专属操作位于版本旁，并打开原生手动检查流程。

### 任务 4：预检并构建签名 Windows 安装器

**文件：**
- 读取但不展示值：`apps/desktop/.env.windows`
- 构建输出：`apps/desktop/.desktop-build/targets/win-x64/`

- [ ] 使用当前本地环境运行 Windows 打包预检，不打印机密值。
- [ ] 缺少签名身份、SignTool、NSIS 编译器或发布配置时，在打包前停止；仅报告精确缺失前置条件名称。
- [ ] 使用生产配置的本地环境和 manifest 版本 `0.2.0-rc.3` 构建 `win-x64`，不传 `--build-version`。
- [ ] 根据构建输出验证签名发布完成记录、安装器、blockmap、`nightly.yml`、文件大小和 SHA-512。
- [ ] 展示并确认精确生产上传目标之前，将安装器保留在本地。

### 任务 5：确认、发布并验证生产源对象

**文件：**
- 上传入口：`apps/desktop/scripts/upload-target.ts`
- 公开源：`https://asterhub.xapi.fans`
- COS 路径：`dsh-desk/feeds/win-x64/nightly.yml`、`dsh-desk/bin/win-x64/<versioned installer>.exe` 及其 blockmap。

- [ ] 展示已验证版本、精确对象 key、大小、SHA-512，以及将替换源别名这一事实；在任何上传前即时请求确认。
- [ ] 确认后，从构建完成记录调用现有 `upload:win:x64` 生产上传器；本次预发布绝不使用固定 `upload:latest` 别名。
- [ ] 通过 `https://asterhub.xapi.fans` 获取源及其引用的产物，不直接访问 COS。
- [ ] 根据签名构建记录验证源版本和产物 SHA-512。
- [ ] 公开 HTTPS 源下仍无法访问源或二进制时，停止且不修改生产 Nginx/Cloudflare；报告失败路径，并另行取得服务器配置修改授权。
- [ ] 成功发布后，在项目交接文档记录最终公开源 URL 和验证结果。

## 延期操作

此计划唯一发布目标是标准安装器。macOS 安装器、强制更新策略、通用 `/api/v1/desktop/latest.json` 和签名插件目录修改均不在范围内。
