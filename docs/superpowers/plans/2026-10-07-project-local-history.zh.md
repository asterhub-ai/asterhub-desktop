# 项目级会话历史实施计划

[English](2026-10-07-project-local-history.md) | 中文

> **执行 Agent 要求：** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans。按下列有边界的任务执行；集成、验证与审查分别设立检查点。

**目标：** 将每个 AsterHub 项目的原始会话和附件保存在 `.aster`，在另一套安装中经确认发现并打开，在新目录继续执行，同时排除 Git；账号与机器级数据默认改为 `.asterhub`，迁移不丢失旧数据。

**架构：** 项目存储服务独立于 WorkspaceRegistry 和 SessionPersistence，管理经过验证的便携元数据与本机位置索引。项目会话路由复用隔离的 JSONL 后端；项目附件作用域与统一执行目录解析器接入现有调用方，不改写已提交历史。工作区和目录选择流程提供发现、确认、显式位置重绑定、旧数据接纳，以及只读和离线状态。

**技术栈：** Cordis、TypeScript ESM、现有 JSONL/Zstandard SessionPersistence、内容寻址附件、原子写入辅助库、类型化 Remote、React 与本地化组件、Vitest、已交付 dsh profile、Electron。

**设计：** [已批准的项目存储设计](../specs/2026-10-07-project-local-history-design.zh.md)

## 摘要

独立分支为 `feature/project-local-history`，工作区为 `C:/开发目录/AsterHub-reference/.worktrees/project-local-history`，基于稳定的 `codex/dsh-02-upgrade`。不修改浏览器分支与插件修复工作区。当前远端集成主线实际名为 `master`；不自动改名、合并、推送或发布。

## 目录

- [全局约束](#global-constraints)
- [目标命令](#goal-request)
- [接口和文件归属](#interfaces-and-file-ownership)
- [任务执行](#task-execution)
- [验证和集成](#verification-and-integration)

<a id="global-constraints"></a>

## 全局约束

- 默认全局用户数据目录为 `.asterhub`；项目自有数据目录为 `.aster`。
- 项目历史和原始附件随项目携带；凭据、插件、模型配置、共享模型和机器缓存不随项目导入。
- 不通过改写 SessionId、父子 ID、事件顺序、继承截点或已提交代际来模拟移动。已发布历史 codec 代际不移动、不覆盖、不删除。
- 项目元数据仅作为验证后的数据。选择目录不执行其中代码、不导入凭据或插件、不重跑旧工具调用。
- 文件操作、shell、搜索、terminal/PTC/SSH cwd、沙箱根、项目指令、fork 和子 Agent 使用经过验证的当前项目目录。模型可见 cwd 必须可由现有会话日志机制重建。
- 显式配置目录和非空 `DSH_HOME` 保留最高优先级。内部 dsh CLI 与包名不在本次范围中；只改变产品存储默认值和显示。
- 暂存复制、内容与关系校验、发布完成之前保留旧源数据。不自动删除或合并冲突的全局目录、活跃项目副本或共享旧附件。
- 项目目录缺失、离线或只读时，不悄悄把写入转到全局目录或进程 cwd。
- 创建项目数据前必须让 Git 忽略 `.aster/`。保留现有忽略文件内容；不自动提交忽略文件、不静默取消已跟踪数据。
- 所有验证使用自有临时根与 fixture。开发期间不迁移、查看或删除真实用户凭据和历史。
- 复用 Cordis effects、品牌化 ID、字典和文件元数据校验。不新增 any/unknown 双重强转、兼容壳、假回退、未实现桩或重复可写历史。
- 子 Agent 编辑期间跳过构建、lint、测试和 formatter；Main 在每个编辑波次结束后验证。子 Agent 可先提交测试供 Main 做修复前失败检查。
- 子 Agent 不再派发子 Agent，不操作共同暂存区或提交，不推送、合并、发布。Main 负责集成和提交；源码修正接受审查。

<a id="goal-request"></a>

## 目标命令

```text
/goal Implement the approved AsterHub project-local history plan on feature/project-local-history: use ~/.asterhub for global account/machine data; keep project identity, immutable Session history and original attachments in project/.aster; discover and confirm copied projects from the directory picker; resume the same conversations and execute only in the new project directory; migrate legacy data without deleting or corrupting sources; exclude .aster from Git; complete behavior, portability, UI and packaged-runtime verification; leave the verified branch ready for later integration without merging, pushing or publishing.
```

此命令文本是用户要求的目标，不代表原生 OMP Goal 模式已经激活。若当前会话开放原生 Goal 控制，则使用该入口；不创建第二个 OMP 会话或修改运行时内部实现来冒充激活。若入口不可用，计划、todo 与隔离执行台账负责保存进度。

<a id="interfaces-and-file-ownership"></a>

## 接口和文件归属

新增包为 `packages/workspace/project-storage`，包名 `@deepseek-ai/dsh-project-storage`。`/types` 为浏览器安全入口，不引入 Host Context 声明。任务 2 管元数据、Git 和定位器；任务 3 管项目会话 provider；任务 4 管当前目录集成；任务 5 管附件路由；任务 7 管最终 profile 装配。没有 Main 的裁定，不编辑其他任务的文件。

```text
ProjectId = Branded<"ProjectId">
ProjectBindingRevision = Branded<"ProjectBindingRevision">
ProjectSessionRecord = { id: SessionId, relativeCwd: string }
PortableProjectManifest = {
  schemaVersion: 1, id: ProjectId, title: string, createdAt: number,
  sessions: readonly ProjectSessionRecord[], sessionOrder: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[], archivedSessionIds: readonly SessionId[]
}
ProjectBinding = { id: ProjectId, root: string, revision: ProjectBindingRevision }
ProjectInspection =
  { kind: "new", root: string } |
  { kind: "existing", root: string, manifest: PortableProjectManifest, digest: string } |
  { kind: "registered", binding: ProjectBinding, manifest: PortableProjectManifest, digest: string } |
  { kind: "legacy", root: string, proposal: LegacyProjectProposal, digest: string }
ProjectSessionLocation = {
  projectId: ProjectId, projectRoot: string, relativeCwd: string,
  sessionsRoot: string, attachmentsRoot: string, bindingRevision: ProjectBindingRevision
}
LegacyProjectProposal = {
  projectId: ProjectId, title: string, sourceRoot: string,
  sessions: readonly ProjectSessionRecord[], sessionOrder: readonly SessionId[],
  pinnedSessionIds: readonly SessionId[], archivedSessionIds: readonly SessionId[]
}
OpenProjectRequest = { root: string, mode: "new" | "existing" | "legacy", expectedId?: ProjectId, expectedDigest?: string }
ProjectStorage.inspect(root, signal?): Promise<ProjectInspection>
ProjectStorage.open(request, signal?): Promise<ProjectBinding>
ProjectStorage.list(): readonly ProjectBinding[]
ProjectStorage.status(id, signal?): Promise<"available" | "missing" | "read-only">
ProjectStorage.manifest(id): PortableProjectManifest
ProjectStorage.bindSession(header, signal?): Promise<ProjectSessionLocation>
ProjectStorage.locateSession(id): ProjectSessionLocation | undefined
ProjectStorage.executionCwd(header): string | undefined
ProjectStorage.reorderSessions(id, orderedIds): Promise<void>
ProjectStorage.setSessionArchived(id, sessionId, archived): Promise<void>
ProjectStorage.setSessionPinned(id, sessionId, pinned): Promise<void>
ProjectStorage.rename(id, title): Promise<void>
ProjectStorage.unregister(id): Promise<void>
ProjectStorage.registerLegacySource(provider): () => void
LegacySourceProvider.inspect(root, signal?): Promise<LegacyProjectProposal | undefined>
ProjectLegacyAdopter = (proposal: LegacyProjectProposal, root: string, signal?: AbortSignal) => Promise<PortableProjectManifest>
ProjectStorage.registerLegacyAdopter(adopter): () => void
ProjectStorage.changed: effect-owned notification after durable changes
prepareAsterHubHome({ userHome, configuredHome?, env?, signal? }): Promise<{ home: string, migration: "none" | "copied" | "explicit" }>
ensureProjectGitExclusion(root, signal?): Promise<{ kind: "not-git" | "ignored" | "tracked-data", trackedPaths: readonly string[] }>
ProjectAttachmentScope = { projectId: ProjectId, sessionId: SessionId }
resolveProjectAttachmentScope(ctx, sessionId): ProjectAttachmentScope
```

`ProjectStorage.Config` 显式声明 `sessionMode: "grouped" | "project-local"`、全局定位索引位置、旧会话根、元数据字节上限与锁等待期限。产品 profile 使用 `project-local`；非产品 grouped profile 使用现有明确配置的后端和历史 cwd 语义。项目模式下，未知归属和不可用根是失败，不会切换模式。规范化路径是位置而非 ID；导入 ID 和相对路径在文件/Remote 输入处验证。

<a id="task-execution"></a>

## 任务执行

### Task 1: 全局目录品牌化与安全默认迁移

**文件：** 修改 `packages/util/home-paths/src/index.ts` 及其所属测试/README 双语对。新增 `packages/boot/app-boot/src/home-migration.ts`、`packages/boot/app-boot/tests/home-migration.spec.ts`，由 app-boot 导出 helper。任务 7 接入 `apps/cli/src/profile-boot.ts` 和 `apps/desktop/src/main.ts`；本任务不编辑这些入口。审计直接写死的 `.dsh` 产品默认值，区分构建/签名临时路径与用户数据。

**输出：** `prepareAsterHubHome` 与 `.asterhub` 默认目录和显示。不依赖项目存储；`resolveDshHome` 保持无文件系统副作用。

- [ ] 添加 old-only、new-only、迁移后重复启动、两个非空目录、暂存中断、源变更、显式覆盖、内部/外部 symlink 用例；只用临时根。
- [ ] Main 在实现前运行新增定向测试；失败必须指向缺失迁移或旧默认行为，不是 mock 转发。
- [ ] 按下列状态转换实现，使用现有原子写入锁、私有同级暂存、目录/内容验证与幂等完成记录。保留源文件；只调整需要迁移的自有内部链接，不改写不透明配置或会话文本。

```text
if configuredHome or nonblank env.DSH_HOME: return explicit resolved home
if completed destination record is valid: return destination without recopying source
if destination contains independent data and source contains data: throw HomeMigrationConflictError
if source has no data: return destination
claim migration ownership outside both trees
copy to a private sibling staging directory
verify file inventory/content and source stability; refuse live-writer/link hazards
publish destination only if its precondition still holds
record complete migration; return destination
on any failure: preserve source and report staging/recovery paths
```

- [ ] 更新 helper 的调用方说明，返回修改路径和定向测试命令；Main 验证并审查完成的任务。

### Task 2: 项目元数据、位置索引与 Git 排除

**文件：** 新增 `packages/workspace/project-storage/{package.json,tsconfig.json,src/{index.ts,types.ts,manifest.ts,registry.ts,git-exclusion.ts},tests/{manifest.spec.ts,registry.spec.ts,git-exclusion.spec.ts},README.md,README.zh.md}`。任务 2 管初始导出/项目引用，将明确装配需求交 Main；暂不改 profile。Main 为 AsterHub 仓库忽略文件添加 `.aster/`。

**输入：** 已准备的全局根。**输出：** 上述 ProjectStorage 和 Git 接口；初始化不依赖 WorkspaceRegistry 或 SessionPersistence。

- [ ] 添加不写入的新建/已有检查、损坏/新版元数据、确认摘要过期、重复打开、两个位置占同一 ID、缺失/只读目录、会话归属冲突、相对目录穿越和取消登记保留数据的行为测试。
- [ ] 添加真实 Git fixture：普通/嵌套仓库、linked worktree、CRLF 忽略文件、项目先于 Git 初始化、git add -A、已跟踪 `.aster`。不执行 git rm --cached。
- [ ] 实现严格 JSON 编解码、内容摘要、串行持久化修改、权威数据规则和仅定位用途的本机索引。拒绝自有数据根 symlink/逃逸，不在选定项目外写入。

```text
inspect = canonical directory + bounded validated project.json + registration comparison
open(new) = ensure Git exclusion; atomically publish complete empty manifest; register locator
open(existing/legacy) = revalidate ID/digest; require confirmation; verify owned data; register locator
same ID + same root = return existing binding unchanged
same ID + different active/existing root = explicit conflict; no silent replacement
relative cwd = validated project-relative path; current cwd = binding.root + relative cwd
unregister = remove locator only; keep .aster unchanged
```

- [ ] 名称、顺序、pin/archive 修改归项目所有，完成持久化后才发通知。完成 JSDoc/README；Main 做定向验证和审查。

### Task 3: 项目会话路由、不可变历史与旧数据接纳

**文件：** 新增 `packages/workspace/project-storage/src/persistence.ts`、`/persistence` 导出和 `tests/project-persistence.spec.ts`。只有当前读入可携带性/验证真正需要时才修改 JSONL helpers；保留已发布历史 codec。新增 `src/legacy-sessions.ts` 及测试。不修改 Workspace/UI/工具。

**输入：** ProjectStorage 登记、会话位置、绑定版本和确认提案。**输出：** 完整 SessionPersistence provider，包含 create/open/stat/list/flush 和原有 handle 语义，不只是路径 helper。

- [ ] 测试原始字节/ID/继承截点、复制目录、重绑定缓存失效、跨项目重复会话归属、只读/离线、缺失代际、旧导入中断和 Windows/POSIX 历史 cwd 的数据读入。
- [ ] 通过隔离 service scope 和按需缓存的项目后端复用已有 provider；在 `.aster/sessions` 下保留原有 cwd 编码子目录，使原始 artifact/header 校验继续成立。

```text
project store = ctx.isolate("sessionPersistence").plugin(JsonlSessionPersistence, { root: location.sessionsRoot })
create(header) = bind verified Session ownership first; delegate to its project backend
open/stat(id) = require one registered owner; delegate only to that owner's backend
list = enumerate registered available project backends; retain missing-project status outside the Session log
flush = drain every active owned project writer; aggregate real failures
rebind = require quiescent writers; invalidate root stores/caches and observation revisions
```

- [ ] 逐字节暂存旧代际，验证 header、正文和谱系，全部必要复制成功后再发布归属。保留源；无 cwd/无归属记录单独报告，不猜项目。旧源不作为可写回退。
- [ ] 返回完整存储/查询契约和检查命令；Main 验证既有 JSONL 语义与新 provider，随后审查。

### Task 4: 工作区归属与当前执行目录切换

**文件：** 修改 `packages/workspace/workspace/src/{index.ts,entity.ts,spec.ts,types.ts}` 及测试；按需要修改 `packages/api/session-controller/src/{agent.ts,commands.ts,list.ts,history.ts,skill-catalog.ts}`；接入 query/reference、文件 `session-cwd.ts`、shell/search/terminal/PTC/SSH/sandbox/instruction/subagent cwd 调用方与 `packages/core/agent-loop/src/index.ts` 的 cwd 变量注册。更新 `packages/test-support/agent-loop-testkit/src/index.ts` 等实际共享 fixture，不通过强转修复测试。本任务不管 picker UI 或附件内部实现。

**输入：** 完整项目会话 provider 和附件 scope。**输出：** 使用项目归属的既有 Workspace/Session API，以及统一当前目录解析链。

- [ ] 修改导出前跑引用查询，列出所有执行用途的 SessionHeader.cwd；只用于历史展示的读取单独分类并保留。
- [ ] 测试 Workspace UUID、顺序/pin/archive 在新 home 的恢复、不活跃目录移动、活跃 writer 拒绝、冷恢复、fork/subagent 归属以及移动后的真实相对 IO、子进程和沙箱。
- [ ] 以项目元数据为归属权威，通过所属域的版本迁移去除过时的全局可写归属字段。全局记录只留位置/排序缓存；旧记录作为接纳完成前的恢复源。

```text
Workspace registration ID = validated/rebranded portable project UUID
Workspace session order/pin/archive = ProjectStorage's local metadata
new standalone Session header cwd = current directory; derived headers retain required inherited cwd; execution cwd = current project binding
cold resume comparison = project ownership/current binding, not old header.cwd equality
history header = original immutable header; current execution/display cwd = resolver output
system-prompt cwd/instructions = same resolver; existing durable context events record changes
```

- [ ] 保持 API 授权、未知格式拒绝、精确继承前缀、取消和 teardown；未知/缺失项目明确失败。申报持久类型变化，更新架构/子系统文档；两套 SDK 输出改变时同步更新。
- [ ] Main 做定向测试和 keyless 已记录移动场景，再审查完整切换。

### Task 5: 项目原始附件与读写作用域

**文件：** 仅按显式 scope 需要修改 `packages/attachment/attachment/src/{index.ts,types.ts}`、`packages/attachment/attachment-local/src/{index.ts,file-store.ts,store.ts}` 和 `packages/client/file-upload/src`。新增 `packages/workspace/project-storage/src/attachments.ts`、`tests/project-attachments.spec.ts`。把 Session commands 调用调整交任务 4，不并发改同一 commands 文件。

**输入：** 可信 ProjectAttachmentScope 和会话位置。**输出：** live tool 与 cold history 都可使用的原始附件读写/流式/归一化/请求变体。

- [ ] 测试复制并使旧 home 不可用后的图片/文件、无 live Agent 冷读取、模型工具结果、上传 receipt、摘要/长度错误、取消、跨项目同摘要、symlink/穿越和必要对象缺失。
- [ ] scope 来自可信 Agent/Host Session，贯穿异步操作。修改所有变更签名的真实调用方，不依赖全局“当前项目”或 await 后丢失的 ambient state。

```text
original root = ProjectStorage.locateSession(scope.sessionId).attachmentsRoot
read/write/admit/normalize/stream retain that scope until completion
unavailable portable scope = error; never try a global attachment root
request variants = rebuildable cache; original referenced bytes = project-owned durable objects
legacy references = declared first-party typed fields; copy and digest-verify before manifest publication
```

- [ ] 旧数据接纳成功前完成必要附件复制；共享旧对象不动。更新所属契约/持久申报；Main 验证并审查。

### Task 6: 目录发现与已有项目确认界面

**文件：** 修改 `packages/api/workspace-controller/src/{commands.ts,types.ts,directory-picker.ts,index.ts,feed.ts}` 及测试；修改 `packages/client/ui-workspace/src/client/{navigation.ts,contract/slots.ts,locales.ts}` 与从这些入口触达的真实 picker/确认组件。复用 Modal/Notice/Toast/DirectoryPicker，不重设计无关布局或更换 picker 实现。

**输入：** inspect/open、完整 Workspace 切换、可信 Remote。**输出：** 只读检查和经确认的新建/已有/旧数据接纳，包含新鲜度复核与本地化冲突/只读/离线反馈。

- [ ] 先加 Host 用例：检查/取消不写入、有效复制数据、同位置幂等、旧摘要拒绝、身份冲突、损坏/新版元数据、缺失历史和已跟踪数据警告。
- [ ] 添加类型化 Remote 检查/打开记录；目录选择之后、createWorkspace 之前检查。只有确认过的已有/旧提案可以接纳；新目录先完成 Git 保护再初始化。

```text
selected directory -> inspect -> new / existing / registered / legacy / typed failure
existing proposal -> “发现已有 AsterHub 项目” + verified details
confirm “打开已有项目” -> send root + expected ID + expected digest
cancel -> no writes
Host -> repeat validation -> adopt/register -> publish Workspace/Session list
```

- [ ] 实际验证选择、确认、取消、历史列表、附件打开和继续会话，覆盖语言与主题。不用 API/DOM 旁路代替受测流程。Main 负责浏览器/Electron 证据和审查。

### Task 7: 产品装配、启动迁移、文档与契约完成

**文件：** 管最终 `packages/bundle/base/cordis.patch.yml`、`packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/asterhub-desktop-native/cordis.patch.yml` 和 manifest，`apps/cli/src/profile-boot.ts`、`apps/desktop/src/{main.ts,paths.ts}`、运行时包图、根 TS/path 清单以及现有卸载保护。更新相关 README 双语、架构/子系统、持久变化和 `docs/upgrade-guide/v0.2.0-rc.3` 所属升级说明。

**输入：** 任务 1–6 完整接口。**输出：** 真实可启动的产品组合，只有一个活跃会话 provider 与附件服务，没有未接入模块。

- [ ] profile/config 消费方初始化之前执行 home 准备；显式传递确定后的 root，不在启动中途重新解释变化的环境。
- [ ] 项目登记先于项目 persistence/Workspace 消费方。产品用 project-local；非产品保留明确 grouped。禁用被替换 provider，移除废弃装配，保留受管插件/profile 包状态。
- [ ] 确認卸载不删除全局或项目历史；调整 `.asterhub`/`.aster` 保护假设，不删除旧源。
- [ ] 从源生成必要 alias、声明、catalog，申报实际持久变化，更新升级/恢复双语，并运行相关 hygiene/docs 检查。不迁移真实用户数据、不发布包。

### Task 8: 端到端可携带性、Git 隐私与打包验收

**文件：** 在 `packages/workspace/project-storage/tests` 添加确定性的所属集成 fixture；在 `apps/cli/tests/profiles` 添加交付 profile 场景；按 snapshot 规则添加/更新 keyless Session 场景。使用原有 Desktop 打包/smoke 脚本，不手工补丁 ASAR。

**输入：** 完整产品组合。**输出：** 可观察的端到端证据和经过验证的独立分支。

- [ ] 创建合成 A/B home 与项目 X，产生真实持久会话、图片/文件、pin/archive/顺序及 fork/subagent，然后关闭并 flush 所有 owner。
- [ ] 复制 X，使旧项目和 A home 不可用，启动新的 B 进程，经真实 picker 选择并确认打开 X，检查原始消息和附件。
- [ ] 继续同一个 SessionId，读取相对 marker，执行真正返回 B 下 cwd 的子进程。比对所有旧代际字节/摘要不变、新事件正确追加，并从日志重建模型可见的新目录。
- [ ] 覆盖全局目录冲突、旧复制中断、缺对象、重复打开、身份重复、离线/只读、Git 初始不存在、git add -A，以及已跟踪数据拒绝；不删除或取消跟踪用户文件。
- [ ] 运行正常 Host/Client 编译、定向测试、文档/持久申报验证，再做构建/打包 smoke。第二台实体电脑或平台矩阵证据单独记录，不把本机隔离 B 描述为实体电脑验证。
- [ ] Main 做范围审查，解决影响后续的缺陷，记录外部验收前提，留下分支等待统一集成。不合并、推送、改写历史、真实迁移或发布。

<a id="verification-and-integration"></a>

## 验证和集成

执行波次：任务 1+2 独立并发；任务 2 接口接受后，任务 3+5 独立并发；再依次执行任务 4、6、7、8。共享文件只有一个集成 owner。Main 在编辑波次结束后验证一次，即时更新台账，不在上下文恢复后重新派发完成任务。

隔离基线已通过四项 home 解析/不可变格式用例，不代表特性通过。完成需要八个任务的结果、逐任务和整体审查、调用方覆盖、冷复制后继续 IO、真实界面和打包检查。外部机器或原生 Goal 控制不可用时明确报告，不模拟或谎称完成。
