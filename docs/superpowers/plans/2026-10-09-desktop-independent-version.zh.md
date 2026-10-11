# Desktop 独立版本实施计划

[English](2026-10-09-desktop-independent-version.md) | 中文

> **面向执行工作的 Agent：** 逐项使用 TDD 工作流；验证当前步骤后再继续。

**目标：** 将 AsterHub Desktop 发布为 `0.21.0`，内置 DSH 运行时保持自身包版本。

**架构：** Electron 产品版本和更新源版本来自 `apps/desktop/package.json`。内嵌 `@deepseek-ai/dsh` 运行时描述、包集和开发项目继续使用仓库根目录 DSH 版本。打包和上传验证分别与各版本的拥有者比较，不再要求二者相等。

**技术栈：** TypeScript、Electron Builder、Vitest、pnpm。

**设计依据：** 本次会话中的用户决定：Desktop 发布版本独立于 DSH；当前完整版本为 `0.21.0`。

## 全局约束

- 保持根目录 DSH 包版本不变。
- 将 Desktop 产品 manifest 设为 `0.21.0`。
- 保持内置 DSH 与 desktop-host 包集内部版本对齐。
- 本地签名和更新配置有效、且用户确认精确测试构建版本后，才能上传。
- 源码、测试和输出均不得包含凭据。

---

### 任务 1：在测试中固定独立版本行为

**文件：**
- 修改：`apps/desktop/tests/desktop-upload-plan.spec.ts`
- 修改：`apps/desktop/tests/package-target-stages.spec.ts`
- 修改：`apps/desktop/tests/packaged-runtime-verification.spec.ts`
- 修改：`apps/desktop/package.json`

- [ ] 将 upload-plan fixture 设为 Desktop `0.21.0`、DSH `0.2.0-rc.3`，并使用 `0.21.0` 产物完成记录；断言计划接受独立编号的 Desktop 产物。
- [ ] 将运行时验证测试的预期改为根目录 DSH 包版本，而非 Desktop 包版本。
- [ ] 将 `apps/desktop/package.json` 设为 `0.21.0` 并运行这两个定向测试；确认现有耦合使它们失败。

### 任务 2：分离产品与运行时版本来源

**文件：**
- 修改：`apps/desktop/scripts/package-target.ts`
- 修改：`apps/desktop/scripts/desktop-upload-plan.ts`
- 修改：`apps/desktop/scripts/prepare-dsh.ts`
- 修改：`apps/desktop/scripts/dev.ts`
- 修改：`apps/desktop/scripts/electron-builder-config.mjs`
- 修改：`apps/desktop/src/main.ts`
- 修改：`apps/desktop/src/release.ts`

- [ ] 移除要求 Desktop manifest 版本等于根目录 DSH 版本的检查。
- [ ] 从 Desktop 产品 manifest 解析产物、发布记录和上传版本。
- [ ] 从根目录 DSH manifest 解析运行时发布元数据与内嵌共享包版本。
- [ ] 保留针对 Desktop 产品版本的 build-version 验证，以及针对 DSH 运行时版本的完整性验证。
- [ ] 运行定向测试，确认独立版本用例通过。

### 任务 3：更新版本策略和理由

**文件：**
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 归档：`.agents/notes/implemented/process/2026-09-16-desktop-release-version-derivation.*`
- 新建：`.agents/notes/implemented/architecture/2026-10-09-desktop-version-independence.*`

- [ ] 说明 Desktop 产品发布使用 Desktop manifest 版本，内置 DSH 运行时保留根目录 DSH 版本。
- [ ] 更新成对的发布版本示例和规则，不改变现有测试构建序号策略。
- [ ] 在成对的 implemented Agent Note 中记录独立版本决定的理由和验证。

### 任务 4：验证发布边界

- [ ] 运行 `pnpm exec vitest run apps/desktop/tests/desktop-upload-plan.spec.ts apps/desktop/tests/package-target-stages.spec.ts apps/desktop/tests/packaged-runtime-verification.spec.ts`。
