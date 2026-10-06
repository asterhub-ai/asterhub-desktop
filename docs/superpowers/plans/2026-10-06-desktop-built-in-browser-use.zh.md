# Desktop 内置 Browser Use 实施计划

[English](2026-10-06-desktop-built-in-browser-use.md) | 中文

> **执行要求：** 使用 subagent-driven-development 或 executing-plans 执行勾选任务；编辑前通读本文。

**目标：** 浏览器操作和网页测试默认使用用户可见的 Desktop Sidebar Browser，采用 ZCode 的观察、目标确认、交互和结果验证方法。

**架构：** Desktop 专用 Browser Use provider 调用在 profile 激活前安装的类型化传输接口。现有子进程 IPC 连接 Node Host 和 Electron main；renderer 协调 Sidebar 标签页的创建与激活，main 仅操作通过租约核验的 guest。不向外暴露调试端点，也不向访问页面开放 Node。

**技术栈：** Cordis、TypeScript ESM、Electron webview/WebContents、现有工具与附件服务、固定版本 Playwright DOM 语义、Vitest。

**规格：** 已批准方向与验收要求收录于下文；本文是待执行的实施计划，不表示功能已经实现。

## 摘要

交付真实的模型到 Sidebar 操作路径，而不只是提示词偏好。保留现有 Web/dev-web provider、产品隔离策略和单 provider 注册。实施完成前必须取得真实 Electron 与模型调用链的证据。

## 目录

- [已批准设计](#approved-design)
- [全局约束](#global-constraints)
- [任务执行](#task-execution)
- [验收与交接](#acceptance-and-handoff)
- [证据来源](#evidence-sources)

<a id="approved-design"></a>

## 已批准设计

Desktop 默认使用内置浏览器。Web/dev-web 保留原有浏览器配置；跨域 iframe 不作为自动化后端。Desktop 外部 provider 通过 profile 显式替换，而不是同时挂载第二个 provider，也不是操作失败后静默切换。

现有 `DesktopBrowserBridge` 仅申请/释放 guest 和通知弹窗 URL。`DesktopBrowserGuests.acquire()` 分配租约，不创建可见标签页。打开页面必须经过所属 Session 的 Sidebar 控制器，并等待对应 guest 完成挂载。

学习 ZCode 的工作流与必要执行原语；不引入其 agent loop（智能体循环）、Node REPL 宿主、认证平台、凭据导入或完整 browser manager。PTC 已经通过 `tools.<name>` 暴露注册工具，不增加另一套 JavaScript 执行器。

### 保留的工作流

1. 发现真实后端与支持的操作。按 ID、URL、标题和激活状态确认当前 Session 标签页；不按数组位置或记忆中的句柄选择。
2. 复用精确目标标签页；只有获准导航时才复用同 hostname 页面。否则为调用 Session 新建可见 Sidebar 标签页。不挪用同工作区其他 Session 的标签页。
3. 等待具体页面状态，以 DOMContentLoaded 作为导航基线。读取 DOM/ARIA 快照并据其事实构造 locator；目标有歧义时拒绝，不取第一个匹配项。
4. 执行一个改变状态的动作，再检查预期结果。弹窗验证同时检查同一 Session 内模型所属与用户创建的标签页。超时后重新观察，不重复动作或切换浏览器。
5. 普通任务优先语义观察；视觉任务、canvas 定位与 GUI 测试使用实际查看过的截图。正式 GUI 测试不通过页面脚本、直连 API 或强制交互绕过待测行为。
6. 轮次结束后保留来源与结果页面；只有显式关闭标签页才销毁。live agent（智能体）dispose（资源释放）时解除模型控制，而不是清空用户工作区的浏览器存储。重新连接不得声称恢复了原页面内存。

<a id="global-constraints"></a>

## 全局约束

- 对所有被操作 guest 保留 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`、下载/权限拒绝和应用 Host 地址拦截。
- 调用身份来自 `exec.agent` 与可信 Host 元数据。模型不得提供 Session/工作区身份、租约、WebContents ID、IPC channel、CDP method、脚本或端点。
- 保留唯一 `ctx.browserUse` 注册。不增加多 provider 选择器，不让产品代码依赖 `packages/experimental`。
- 将页面内容当作不可信数据。有外部影响的操作沿用现有审批策略；页面或模型不能授予批准。Host 身份核验不替代工具审批。
- 使用现有持久化工具结果与附件存储。不将原始 base64、live 租约或 Chromium 状态存入 Session 事件。若实际修改持久化类型，按仓库规则声明。
- 用户点击和页面脚本可能与自动化竞争。按 live Session 串行执行 provider 操作，以 generation 拒绝过期目标和快照。输入发送成功不等于结果成立。
- 不提供任意 `evaluate` 或 Node REPL 工具。只读观察采用固定协议操作。本次不加入 cookie 迁移、持久登录态改造、上传/下载解禁或录制子系统。
- 新增可因部署而变化的超时与快照上限均为经过验证的 Config 字段。沿用品牌 ID、effect 注册、导出 JSDoc、UI 本地化和分 Host/Client TypeScript 配置。

<a id="task-execution"></a>

## 任务执行

任务文件路径均相对仓库。新路径与签名为拟议接口，而非现有 API。每项任务以行为验证和审查节点结束；任何节点都不能替代任务 6 的端到端验收。 修改既有导出前执行 LSP references；实现前为不确定的归属/actionability 行为补充回归并观察失败，然后修复源码并重跑定向检查。

### 任务 1：类型化传输与 guest 身份

**文件：** 新建 `packages/browser-use/browser-use-desktop/{package.json,tsconfig.json,src/types.ts,src/transport.ts,tests/transport.spec.ts}`。修改 `apps/desktop-host/{package.json,tsconfig.json,src/index.ts}`、`apps/desktop/{package.json,tsconfig.host.json,src/host-process.ts,src/host-protocol.ts,src/main.ts,src/browser-automation-protocol.ts}`、根 `tsconfig.host.json` 及 Host 生命周期测试。新增 `apps/desktop-host/src/browser-transport.ts`。

**项目接线：** 在两个 app/Host TypeScript face 与根 Host aggregate 中添加新包项目引用。`apps/desktop-host` 添加直接运行时依赖；`apps/desktop` 添加类型/构建依赖。通过 `pnpm run gen-tsconfig-paths` 生成包源码别名，并用 `pnpm run verify-tsconfig-paths` 验证生成结果。

**接口：** 包通过 `/types` 导出纯类型；`desktopBrowserTransport` 作为类型化 Host 能力，在 provider 加载前通过 `runProfile.hostSetup` 安装。Node IPC 传输带标签的 `browser/request`、`browser/result` 或 `browser/cancel`；可信请求包含 Session ID、live owner generation、request ID 和已验证操作。`AbortSignal` 留在本进程，跨 IPC 通过取消消息表达。

- [ ] 在实现 IPC 两端前定义共享操作/结果判别标签及精确校验。使用品牌化 tab/snapshot ID，调用身份从模型参数以外获取。

```text
DesktopBrowserTarget = { tabId: DesktopBrowserTabId, generation: number }
DesktopBrowserCaller = { sessionId: SessionId, ownerGeneration: number }
DesktopBrowserTransport.request(caller, operation, signal): Promise<DesktopBrowserResult>
DesktopBrowserTransport.releaseOwner(caller): Promise<void>
TabInfo = { target, url, title, active, ownership: "user" | "agent", attached: boolean }
SnapshotResult = { target, snapshotId, text, truncated: boolean }
```

- [ ] 在 `DesktopHostProcess` 增加关联请求处理，并在 `isDesktopHostEvent` 校验；同步更新 Host 生命周期协议版本与发布元数据。拒绝无所属、重复、迟到和 generation 不匹配的结果，不因此补发动作。
- [ ] 在 `apps/desktop-host/src/index.ts` 的组合激活之前安装 transport，而不是在 `await application` 之后。Electron main 缺失或断连时拒绝请求；取消未执行操作，关闭时清理并等待请求注册表。
- [ ] 通过现有生成器更新包源码别名，并执行 `pnpm run verify-tsconfig-paths`；确认 Desktop Host 与 Desktop main 的 TypeScript 项目引用都包含新包。
- [ ] 覆盖跨 Session 目标、错误 live owner generation、IPC 断连、排队请求取消和 dispose 后迟到结果。执行新增 transport 定向测试及受影响的 `apps/desktop/tests/host-process.spec.ts` 检查；只保留验证可观察失败/归属的测试。

**审查节点：** 模型不能控制身份字段，无网络监听，不向 guest 暴露 Electron/Node，Host 退出后不遗留 pending promise。

### 任务 2：Sidebar 标签发现、打开与归属

**文件：** 修改 `packages/client/ui-sidebar-browser/src/{types.ts,client/index.ts,client/browser/BrowserController.ts,client/electron/ElectronWebViewImpl.ts,client/electron/pages.ts}`、`apps/desktop/src/{browser-guests.ts,preload-browser.ts,ipc.ts,main.ts}`。新增 `packages/client/ui-sidebar-browser/src/client/electron/automation.ts` 和 `apps/desktop/tests/browser-automation-tabs.spec.ts`；扩展 UI 包内 `electron-lifecycle.client.spec.ts` 与 `browser-controller.client.spec.ts`。

**接口：** 使用任务 1 的 caller/target 定义。renderer 协调器只接收 main 发出的关联命令，返回 Sidebar 标签身份及 main 实际挂载的租约。main 维护权威的 Session → tab → lease → guest 对应关系；workspace partition 只决定存储分组，不授权操作该工作区所有 Session。

- [ ] 为租约申请增加调用 Session/tab 元数据，对新增进程边界执行校验。用户创建的 Browser 标签仅在所属 Session 可发现。guest 挂载时分配 generation；导航、替换或关闭时使相应目标/快照失效。
- [ ] 经 `sidebarRight` 与 `BrowserController` 打开，等待租约挂载后才返回成功；返回观察到的 URL/标题，而不只是提交的地址。快照/动作要求 guest 实际挂载，只有已分配租约不算就绪。
- [ ] 仅复用已确认的当前 Session 页面。默认 URL 复用优先精确 URL，其次为明确获准导航的同 hostname 页面；`newTab: true` 必须创建独立标签。不因模型新轮次而重复导航或刷新已精确匹配的页面。
- [ ] 后台 Session 命令始终定向到该 Session。前台 Session 打开页面时展示 Browser pane；后台任务不得抢走用户当前 Session，也不得操作前台标签。准确返回可见性事实，为截图保留已挂载 guest。
- [ ] 将允许的 HTTP(S) 弹窗请求关联到源 Session 和动作请求；重试点击前先列举新标签。保留原生弹窗拒绝、带 POST body 弹窗拦截、Host 来源拦截和现有 URL 限制。
- [ ] owner dispose 时撤销控制声明并取消/等待操作；保留可见标签以供交接。显式 `browser_close` 经 Sidebar 关闭并等待 guest 销毁。renderer 崩溃使相关句柄失败；重启显示恢复状态，不静默声称恢复已登录 Chromium 状态。
- [ ] 验证同 CWD 的两个 Session 不能相互控制标签；挂载途中关闭不泄漏 guest；用户弹窗留在源 Session；隐藏/后台页面不会把任务转到激活标签。执行指定生命周期/控制器测试及新增 tab 测试。

**审查节点：** 用户可见 Sidebar 页面与被操作 guest 是同一个页面；租约本身不代表标签已打开。

### 任务 3：DOM 语义与真实 guest 交互

**文件：** 新增 `apps/desktop/src/{browser-automation.ts,browser-dom-engine.ts,browser-input.ts}`、`apps/desktop/scripts/prepare-browser-dom.ts`、`apps/desktop/tests/browser-automation.e2e.ts` 与 `apps/desktop/tests/fixtures/browser-automation-page.html`。修改 `apps/desktop/package.json`、其构建/资源组装，以及向执行器提供已核验 guest 所需的 guest owner 部分。

**接口：** 使用任务 2 经 owner 核验的 live guest；向任务 1 返回类型化 snapshot/read/action/wait/screenshot 结果。main 选择固定引擎脚本与输入命令；模型参数只作为序列化数据，不拼接到可执行源码。 采用已核实的 ZCode 路径：私有 CDP `Page.createIsolatedWorld` 与 `Runtime.evaluate` 驱动固定的注入 DOM 引擎，并派发可信输入。sandbox/contextIsolation 不要求向 guest 暴露 preload API；兼容性由真实 guest 探针验证。

- [ ] 大规模实现前，在真实 sandboxed Sidebar guest 上运行一次性探针，包含打包环境 `devTools: false` 设置：读取快照、解析 role/name locator、发送真实输入并截图确认结果；确认隐藏但保留 guest 的截图与输入。失败即暂停该实现设计，不能因此开放远程调试端口或削弱 guest 隔离。
- [ ] 将 `playwright-core` 精确固定为经审查的引擎版本（初始候选 `1.59.1`，与 ZCode 一致）；构建时提取其生成的注入 DOM 引擎并打包不可变资源。不在运行时依赖 npm 私有导出，也不另写 ARIA 名称算法。预期引擎导出缺失时让资源生成失败。
- [ ] 移植前审查 ZCode 的必要 snapshot/locator/input 适配器。保留源自 Playwright 的可访问名称、role、可见性、严格匹配基数、actionability 和 open-shadow 语义。实际复制代码时保留 Apache 声明和修改归属；不复制约 180 KB 的 browser manager 或 ZCode workspace imports。
- [ ] 将 ref 绑定到 `snapshotId`、tab generation、document/frame 身份和引擎节点成员资格。导航/重挂载或成员资格无效时返回明确过期目标错误；不把过期 ref 重新指向别的元素。frame 遍历使用 main 授权的 frame 身份；不支持的 frame 场景明确报告限制，不伪造空白页面。 每个 document/frame 的快照与 ref 动作共享同一个 isolated-world 引擎实例；AsterHub 工具返回 ref 时，不复制 ZCode 移除 ref 的快照归一化。
- [ ] 经同一 guest 的真实输入路径实现 click/double-click/fill/type/press/check/uncheck/select/hover/scroll/drag，不使用 `element.click()` 或事件派发捷径。等待可见、enabled、唯一且不被遮挡的目标；遵守键盘/IME 行为。必要时使用私有 `webContents.debugger` 输入，按租约管理 attach/teardown；不暴露原始 debugger 命令。
- [ ] 实现固定 text/attribute/visible/enabled/checked 读取以及具体 URL/load/element 等待。坐标动作必须携带同 target generation 的 screenshot ID，并正确映射 CSS 像素 viewport；拒绝过期或越界坐标。明确请求瞬态证据时，在同一次操作中完成动作、具体状态等待和截图。
- [ ] 用 port-0 loopback fixture 验证真实行为：重复标签拒绝严格选择；延迟表单可填写；遮挡按钮不能穿透点击；Unicode 输入到达应用；open shadow DOM 可观察；iframe 目标属于正确 frame；弹窗结果可发现；canvas 输入与截图坐标一致；导航后旧 ref 被拒绝。测试使用独立 profile/端口并等待 Electron 退出，保证确定性。

**审查节点：** 输入走真实前端事件路径；截图与 DOM 来自实际 Sidebar guest，涵盖打包环境与隐藏窗口。

### 任务 4：模型工具、策略与持久化证据

**文件：** 新增 `packages/browser-use/browser-use-desktop/src/{index.ts,tools.ts,presentation.ts}` 与 `tests/{tools.spec.ts,lifecycle.spec.ts}`。为新包声明产品依赖；只有现有 API 无法表达必要行为时才修改已有 skill/工具结果适配器。

**接口：** 注入 `browserUse`、`tools`、`systemPrompt`、`desktopBrowserTransport` 与 `attachments`。下方 `AttachmentRef` 简写采用现有 `ImageAttachmentRef`。通过有序 effect 注册 `BrowserUseProviderName("desktop-internal")`。工具参数不含调用身份；以下 schema 定义公开操作，返回结构化 canonical results 与现有附件引用。

```text
browser_tabs() -> { backend: "desktop-internal", capabilities, tabs: TabInfo[] }
browser_open({ url, newTab?: boolean }) -> TabInfo
browser_snapshot({ target }) -> SnapshotResult
Locator = { snapshotId, ref } | { snapshotId, role, name, exact: true }
browser_read({ target, locator, property: "text"|"attribute"|"visible"|"enabled"|"checked", attribute?: string }) -> { target, value }
browser_act({ target, locator, action: "click"|"doubleClick"|"fill"|"type"|"press"|"check"|"uncheck"|"select"|"hover", text?: string, keys?: string[], values?: string[], observe?: Observation }) -> { target, delivered, observation? }
browser_act({ target, screenshotId, action: "click"|"doubleClick"|"move"|"scroll"|"drag", x?, y?, deltaX?, deltaY?, path?, observe?: Observation }) -> { target, delivered, observation? }
Observation = { wait?: WaitCondition, screenshot?: boolean }
WaitCondition = { kind: "load", state: "domcontentloaded" } | { kind: "url", url } | { kind: "element", locator, state: "visible"|"hidden"|"enabled"|"checked" }
browser_wait({ target, condition: WaitCondition }) -> { target, matched: true }
browser_screenshot({ target }) -> { target, screenshotId, image: AttachmentRef, viewport }
browser_close({ target }) -> { tabId, closed: true }
```

- [ ] 实现精确判别参数分支：fill/type 要求 text，press 要求 keys，select 要求 values；attribute 读取要求属性名称；pointer 操作要求相应坐标/path。在工具/IPC 解析边界校验有限坐标、generation/ref 成员资格及必要观察字段。
- [ ] 通过标准工具执行器注册每项操作，使 native 与 PTC 调用使用相同审批与日志。改变状态的调用不自行重试。区分输入已送达与结果已验证；基础设施/超时错误可见，并在可获取时返回当前目标事实。
- [ ] 经现有附件路径保存截图，仅向 image-capable 模型路由投递图片，确保模型可见文本/图片引用可由 Session 日志重建。视觉不可用时返回准确诊断；不得声称已完成视觉测试。
- [ ] 设计纯 generic Host presenter 与有界持久化结果元数据：backend、URL/标题、操作、target 和附件引用。产品 UI 文案本地化。优先沿用 Client generic 工具卡；只有无法展示必要事实时才扩展，不新建 presenter registry。
- [ ] 增加固定提示词指向随产品发布的 control-browser 与 web-gui-tester skill（技能）。提示词使用真实工具名称和默认 backend；不承诺不支持的上传/下载、录制、任意执行或 headless 后备。
- [ ] 覆盖策略拒绝时零输入、过期 target/ref 拒绝、owner dispose 时排队操作、截图图片路由准入、持久结果回放、工具注册回滚和重复 provider 拒绝。不测试参数转发细节或偶然措辞。

**审查节点：** 工具结果可回放，PTC 不能绕过策略，live 标签控制不依赖任何 ZCode 私有 runtime。

### 任务 5：随产品发布的工作流与 Desktop 专用组合

**文件：** 新增 `packages/browser-use/browser-use-desktop/src/skills.ts` 与 `assets/{control-browser,web-gui-tester}/SKILL.md`。修改 `packages/bundle/asterhub-desktop-native/{package.json,cordis.patch.yml}`；仅在 DOM asset 需要时修改 Desktop runtime 依赖元数据。通过现有生成器更新 tsconfig/catalog，不手改生成表。

**接口：** 使用任务 4 工具与 `packages/skill/skill-office/src/index.ts` 使用的 `ctx.skills.registerProvider`/bundled-rank 机制。skill 是产品 runtime 资源，不只是仓库 `.agents/skills` 指令。provider 仅在 Desktop native bundle 挂载。

```yaml
# Proposed insertion in the Desktop-only native bundle.
- id: browser-use
  name: "@deepseek-ai/dsh-browser-use"
- id: browser-use-desktop
  name: "@deepseek-ai/dsh-browser-use-desktop"
  config:
    operationTimeoutMs: 3000
    navigationTimeoutMs: 30000
    snapshotMaxChars: 50000
```

- [ ] YAML 表示拟议条目内容，不是完整 patch：用现有 bundle overlay 语法插入，避免重复已有 registry 条目。Config 校验要求正整数；快照截断必须在结果中明确标识。这些数值是部署默认值，不是隐藏常量。
- [ ] 根据任务 4 的八个真实工具编写 control-browser 指令。涵盖能力发现、显式后端选择、当前标签检查、精确/同 host 复用、等待/快照/严格定位、单动作后验证、弹窗观察、过期目标恢复、canvas 截图、用户标签交接和拒绝报告。不复制 ZCode fresh-kernel bootstrap 或不支持的 API 名。
- [ ] 编写 web-gui-tester，包含 P0 主流程、P1 反馈、P2 边界、P3 布局；区分环境准备与正式 GUI 测试。正式测试只使用正常前端交互，同时核查语义状态和实际查看过的截图，分别记录阻塞/不支持项，不修改待测代码，也不强迫失败流程通过。
- [ ] 注册 model/user invocation 元数据，将资源纳入开发与打包 runtime 闭包。复制上游文本时保留许可并适配；新增文本描述 AsterHub 工具与限制。网页交互优先 Browser Use，而非 Computer Use；用户显式选择 Computer Use 或目标属于桌面原生界面时除外。
- [ ] 验证组装后的 Desktop 提示词/工具/skill 发现，而不只验证文件存在。Web/headless/SDK 组合不注入 Desktop provider。显式外部 provider 配置先禁用 Desktop provider 条目及其指引，再启用一个外部 provider；重复激活明确失败。

**审查节点：** 客户安装不依赖仓库开发指令、额外浏览器安装、CDP 端点或第二个模型 API key，就能发现 skill 与真实工具。

### 任务 6：端到端验收与发布文档

**文件：** 新增 `apps/desktop/tests/fixtures/browser-automation-smoke.mjs`，扩展任务 3 的 `apps/desktop/tests/browser-automation.e2e.ts`。按仓库快照归属规则加入 recorded-session case；附件/GUI 结果不属于 Session snapshot 时增加 provider 所属 expected-output case。同步更新成对的 `packages/browser-use/browser-use-desktop/README*`、`packages/client/ui-sidebar-browser/README*`、`docs/subsystems/browser-use*`、`apps/desktop/README*` 与所属包组 README。为 Desktop 默认行为变化在当前未发布版本下添加 upgrade guide。

- [ ] 构建受影响的 Host/Client faces，经真实 `dsh` 所属 Desktop profile 启动；开发 smoke 使用 `pnpm run dev:desktop`，产品 guest flags 使用打包开发产物验证。服务由进程管理器启动；隔离 Desktop userData、Harness home、工作区与 loopback fixture 端口。
- [ ] 运行真实模型请求：“用内置浏览器打开本地测试页，填写表单、提交并验证成功提示。”检查实际 Sidebar guest、持久工具结果事件及截图。确认没有启动系统浏览器，也未把私有状态暴露给其他 Session。真实模型验证不能用 mock 响应或只手动调用 provider 代替。
- [ ] 在同一 fixture 执行 GUI-test 工作流：成功表单、disabled/遮挡控件、弹窗新标签、瞬态提示、iframe/shadow 目标与 canvas。输出带实际查看截图证据的 passed/failed/blocked/unsupported 结果。验证遇到真实页面失败时准确报告，不通过 JavaScript、API、刷新或其他浏览器绕过。
- [ ] 覆盖用户已打开标签、同工作区两个并发 Session、Session 切换、Sidebar 折叠、显式关闭标签、输入送达后的取消、renderer 丢失和应用重启。已送达输入不回滚；失败/不确定结果需要重新观察。轮次结束保留来源/结果页面。
- [ ] 为产品 GUI 变化录制要求的真实 server/model-flow GIF。验证 Windows 与 macOS guest 行为；不把未运行平台写为通过。缺少凭据或平台访问权限时，对应验收项是明确发布阻塞，而不是虚构通过。
- [ ] 文档区分 Desktop 内置自动化、外部 provider 模式和不可自动化的 Web iframe。列明支持动作及现有上传/下载/权限限制。记录双语配对并更新受影响工具/config/Cordis catalogs。smoke 成功后才移除一次性探针。

**计划执行的检查，本轮规划未执行：**

```sh
pnpm exec vitest run packages/browser-use/browser-use-desktop/tests apps/desktop/tests/host-process.spec.ts apps/desktop/tests/browser-automation-tabs.spec.ts packages/client/ui-sidebar-browser/tests
pnpm run build
pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/browser-automation.e2e.ts
pnpm run test:snapshot -- -t desktop-built-in-browser
pnpm run test:docs
pnpm run doc-sync
```

新增 snapshot case 命名为 `desktop-built-in-browser`。Electron e2e 必须实际执行，而不是自跳过。集成后统一执行定向检查；通过 dsh-pre-push-checks 选择发布检查，不默认运行完整 coverage suite。产物检查使用构建输出；单元检查解析源码。

**审查节点：** 下方每项验收均有实际证据，默认 provider 已进入安装产物，回放不依赖 live 浏览器。

<a id="acceptance-and-handoff"></a>

## 验收与交接

| 要求 | 责任任务 | 证据 |
|---|---|---|
| Desktop 使用用户可见内置页面 | 任务 2、5、6 | 真实模型调用链与对应 Sidebar guest |
| 据快照定位，不盲目重试 | 任务 3、4、5 | 重复/遮挡/过期目标 fixture 与记录轨迹 |
| 同工作区 Session 不能交叉操作 | 任务 1、2、4 | 跨 Session 动作被拒绝且其他页面未变化 |
| 弹窗、frame、shadow DOM、canvas 按观察目标操作 | 任务 2、3、6 | 真实 guest 观察、输入结果与截图 |
| 工具审批与持久视觉证据可回放 | 任务 4、6 | 拒绝动作不送输入；文本/图片引用回放 |
| Web/dev-web 不变 | 任务 5 | 组合 profile 对比，无 Desktop 工具注册 |
| 不依赖外部浏览器或公开 CDP 端点 | 任务 1、3、6 | 安装 runtime 闭包与真实启动观察 |
| GUI 测试不绕过前端行为且准确报告失败 | 任务 5、6 | 已查看截图报告与真实模型 GIF |

任务 1、2 共享身份/协议文件，由同一责任人集成。接口固定后，任务 3 引擎与任务 4 工具/附件可按同一精确定义并行；任务 5 skill 可同步起草，但须使用最终工具 schema。集成后执行任务 6。其他任务仍在编辑时不运行全项目验证。

若 sandboxed/打包 guest 无法在不公开调试端点的前提下支持所选 DOM/输入机制，main 无法核验 Session 身份，或缺少必要持久截图投影，则暂停实施并重新设计。先解决底层前提再继续，不交付只有提示词的方案或外部浏览器替代品。

<a id="evidence-sources"></a>

## 证据来源

本地既有归属依据：`apps/desktop/src/browser-guests.ts`、`preload-browser.ts`、`host-process.ts`；`apps/desktop-host/src/index.ts`；`packages/client/ui-sidebar-browser/src/types.ts`、`client/index.ts`；`packages/browser-use/browser-use/src/index.ts`；`packages/bundle/asterhub-desktop-native/cordis.patch.yml`。规划期间核查了源码，未做运行时测试。

- [ZCode control-browser 工作流](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md)
- [ZCode web-gui-tester 工作流](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/web-gui-tester/SKILL.md)
- [ZCode browser bridge](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/node-repl-host/src/browser-bridge.ts)
- [ZCode isolated-world DOM 快照执行器](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightDomSnapshot.ts)
- [ZCode frame-aware locator 与可信输入执行器](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightLocatorExecutor.ts)
- [ZCode Playwright 注入 DOM 源码加载器](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/playwrightInjectedScriptSource.ts)

这些 URL 指向上游 main，可能变化。执行时在依赖/第三方归属记录中固定审查版本，核对每个复制文件的许可，并用选定 Electron/引擎版本重跑 DOM/输入探针。API 名为 Playwright 不代表单独浏览器进程或公开 CDP 端口；进程内私有 CDP 仍可能是实现细节。

## Dev Note

用户已批准 Desktop 优先方向并要求本可执行计划。编写本计划不执行功能实现、产品运行时验证、依赖安装或源码提交。
