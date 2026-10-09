# Project Storage
[English](README.md) | 中文

`@deepseek-ai/dsh-project-storage` 在 `<project>/.aster/project.json` 保存可随项目复制的元数据，并在已准备的 AsterHub 全局 home 下保存机器本地 locator。manifest 是项目身份、Session 成员关系、相对 cwd、排序、置顶与归档状态的唯一事实来源；locator 只保存 `{ id, root, revision }`，可从已选项目重建。

## Host 服务

在准备全局 home 后挂载 `ProjectStorageService`，并使它独立于 `WorkspaceRegistry` 与 `SessionPersistence` 初始化。显式提供 `ProjectStorageOptions`：

- `sessionMode`：明确选择 `grouped` 或 `project-local`；
- `locatorPath`：机器本地 locator JSON 路径；
- `legacySessionRoot`：如有，配置为只读旧数据源位置；
- `metadataLimitBytes`：可读取的 portable metadata 最大字节数；
- `lockDeadlineMs`：跨进程 mutation 锁的最长等待时间。

Host 服务通过 `ctx.projectStorage` 暴露；浏览器安全的 `./types` 入口只声明数据契约。变更写入完整临时文件、同步后原子替换，并仅在持久化完成后发送 `project-storage/changed`。通过所属 Cordis effect 注册只读 legacy 发现器 `registerLegacySource`，并以 `registerLegacyAdopter` 注册唯一迁移实现。adopter 接收 `(proposal, destinationRoot, signal?)`，必须返回完整且已验证的 portable manifest。Legacy open 会重新验证 proposal；未注册 adopter 时抛出 `ProjectMigrationUnavailableError`，绝不把旧历史初始化为空记录。

## 检查与 adoption

`inspect(root)` 先规范化目录，仅读取有界且严格验证的 JSON。缺少 metadata 时返回 `new`，除非已注册的 legacy source 提供 proposal；格式错误、新版 schema、重复 JSON key、不安全数据根或重复身份均明确失败。`existing` 和 `legacy` 的确认必须把检查时的 ID 与 digest 传入 `open`；open 会在串行 mutation 中重新检查后才发布。相同 ID 和相同根目录保持原 binding revision；已有旧根不能被静默替换。

项目 cwd 成员使用经过验证的 portable 相对路径（`.` 或以 `/` 分隔的子路径）。拒绝绝对路径、盘符前缀、反斜线、NUL、空路径段及越界 `..`。Session ID 与历史 header 保持不变。`.aster` 以及其 `sessions`、`attachments`、`attachments/v1` 数据根不能是符号链接，也不能逃出选择的项目目录。`unregister` 只删除 locator 记录，绝不删除项目文件。

## 项目 Session 持久化

`ProjectSessionPersistence` 从 `/persistence` 导出，并在 `ProjectStorageService` 后挂载。它按 manifest 成员关系将 Session 读写路由到 `.aster/sessions`，保留已存 header 与 generation。项目缺失或只读时拒绝写入；项目移动后，只要仍有路由句柄打开，就拒绝重新绑定。`list()` 返回已注册且可用项目的 Session；grouped profile 继续使用显式配置的后端。

## 附件作用域

`resolveProjectAttachmentScope(ctx, sessionId)` 解析已注册 Session 的可信项目所有者，并返回项目级附件 provider 用于将持久化对象读写路由到所属项目 `.aster` 树的 `AttachmentScope`。当 Session 未关联已注册项目所有者时抛出异常。LLM 适配器与上传消费者在每个请求中解析该作用域并穿透传递到附件层；grouped provider 则忽略该作用域。

## Git 隐私

`ensureProjectGitExclusion(root)` 在项目 `.gitignore` 中加入 `.aster/`，保留已有字节和换行格式；适用于 Git 后初始化、linked worktree 与嵌套项目目录。它通过真实 Git worktree/top-level 信息查找已跟踪的 `.aster` 路径，并将其报告为 `tracked-data`；不会 stage、commit、删除或 untrack 文件。发现已跟踪私密数据时拒绝 open，不会声称数据已受保护。

## 打包契约

本包声明了运行时子路径导出（`./manifest`、`./attachments`、`./persistence`），并在 `lib/` 下提供配套模块。包本地 `tsdown.config.ts` 在 Host 构建阶段输出所有导出的运行时入口（`{index,manifest,registry,git-exclusion,attachments,persistence}`），并在 Client 阶段（`DSH_BUILD_FACE === 'client'`）不输出任何内容。打包产物中的消费者（如 `session-persistence-project`）依赖这些具体的入口文件。

## 验证

使用隔离 fixture 的 focused tests：`pnpm exec vitest run packages/workspace/project-storage/tests/manifest.spec.ts packages/workspace/project-storage/tests/registry.spec.ts packages/workspace/project-storage/tests/git-exclusion.spec.ts`。
