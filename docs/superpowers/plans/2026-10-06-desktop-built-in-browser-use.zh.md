# Desktop 内置 Browser Use 实施计划

[English](2026-10-06-desktop-built-in-browser-use.md) | 中文

> **执行要求：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务执行；每个任务必须有独立可验证的交付结果。

**目标：** 浏览器操作和网页测试默认使用用户可见的 Desktop Sidebar Browser，采用 ZCode 的观察、目标确认、交互和结果验证方法。

**架构：** Desktop 专用 Browser Use provider 调用类型化 Host transport。main 为每个已核验的 Session/tab lease 拥有一个隐藏 offscreen BrowserWindow；同一个 WebContents 提供页面状态、DOM/输入操作，paint 帧镜像到现有 Sidebar Browser canvas。有限的语义 DOM 镜像提供屏幕阅读器访问。不开放 public CDP endpoint，不向 guest 注入 preload，也不创建第二个页面实例。

**技术栈：** Cordis、TypeScript ESM、Electron offscreen BrowserWindow/WebContents 与 paint event、Sidebar canvas/语义 DOM 镜像、固定版本 Playwright DOM 语义、现有工具/附件服务、Vitest。

**规格：** [Desktop offscreen BrowserWindow 镜像设计](../specs/2026-10-07-desktop-offscreen-browser-mirror-design.zh.md)

## 摘要

交付真实的模型到 Sidebar 操作路径，而不是只改提示词偏好。offscreen BrowserWindow 是 Sidebar canvas 显示、模型操作的同一页面；继续使用相同 lease、Session 和 workspace storage 规则。保留现有 Web/dev-web provider、产品隔离、审批和单 provider 注册。完成前必须取得真实 Electron、打包 guest、无障碍和模型调用链证据。

## 目录

- [已批准设计](#approved-design)
- [全局约束](#global-constraints)
- [任务执行](#task-execution)
- [验收与交接](#acceptance-and-handoff)
- [证据来源](#evidence-sources)

<a id="approved-design"></a>

## 已批准设计

Desktop 默认使用内置 Browser provider。Web/dev-web 保留原有 provider；跨域 iframe 不作为自动化后端。Desktop 外部 provider 只能通过 profile 显式替换，不能并行挂载，也不能在操作失败后静默切换。

本计划不激活 AsterHub 的 experimental Computer Use packages，也不移植 ZCode 独立的 Computer Use 流程。内置 Browser 负责网页；Computer Use 仍是单独能力，仅在用户明确要求或目标属于桌面原生界面且已配置时使用。

已批准的 [offscreen BrowserWindow 镜像设计](../specs/2026-10-07-desktop-offscreen-browser-mirror-design.zh.md)规定：每个已核验的 `(Session, Sidebar tab)` lease 只对应一个隐藏 offscreen `BrowserWindow`。它的 `WebContents` 同时提供 DOM 操作、可信输入、截图，以及 Sidebar canvas 显示的像素。结构化语义 DOM 镜像使用同一页面快照中的 ref，支持屏幕阅读器导航。

renderer 创建并激活 Sidebar 标签页；Electron main 创建、拥有、授权并销毁 offscreen BrowserWindow。帧消息按 lease/generation 关联、合并并限量。不开放 public CDP endpoint，不注入 guest preload，不创建第二个页面实例，也不向模型开放 JavaScript。

学习 ZCode 的工作流与精简执行原语；不引入其 agent loop（智能体循环）、Node REPL 宿主、认证平台、凭据导入或完整 browser manager。PTC 已通过 `tools.<name>` 暴露注册工具，不增加另一套 JavaScript 执行器。

### 保留的工作流

1. 发现真实后端与支持的操作。按 ID、URL、标题和激活状态确认当前 Session 标签页；不按数组位置或记忆中的句柄选择。
2. 复用精确目标标签页；只有获准导航时才复用同 hostname 页面。否则为调用 Session 新建 Sidebar 标签页。不挪用同工作区其他 Session 的标签页。
3. 等待具体页面状态，以 DOMContentLoaded 作为导航基线。读取 DOM/ARIA 快照，并根据快照事实构造 locator；目标有歧义时拒绝，不取第一个匹配项。
4. 执行一个改变状态的动作，再检查预期结果。弹窗验证同时检查同一 Session 内模型与用户创建的标签页。超时后重新观察，不重复动作或切换浏览器。
5. 普通任务优先语义观察；视觉任务、canvas 定位和 GUI 测试使用同一 offscreen `WebContents` 的截图。正式 GUI 测试不通过页面脚本、直连 API 或强制交互绕过待测行为。
6. 轮次结束后保留来源与结果页面；只有显式关闭标签页才销毁。live Agent 释放时解除模型控制，而不是清空用户工作区的浏览器存储。重新连接不得声称恢复了之前的页面内存。

<a id="global-constraints"></a>

## 全局约束

- 每个 lease 只拥有一个 offscreen BrowserWindow/`WebContents`。Sidebar canvas 只镜像该页面，不创建或导航第二个页面。
- offscreen BrowserWindow 使用 `show:false`、`offscreen:true`、`devTools:false`、`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`、`webSecurity:true`，且不配置 preload。offscreen guest 使用 `webviewTag:false`；切换后主 renderer 不再使用 `<webview>`。
- 使用 workspace 内存 partition 分组存储，但每次操作与帧交付都核验 owner、Session、Sidebar tab、lease 和 target generation。同一工作区的一个 Session 不能操作或读取另一个 Session 的页面。
- 调用身份来自 `exec.agent` 与可信 Host 元数据。模型不得提供 Session/工作区身份、租约、WebContents ID、IPC channel、CDP method、脚本或端点。
- 保留唯一 `ctx.browserUse` 注册。不增加多 provider 选择器，不让产品代码依赖 `packages/experimental`。
- 将页面内容视为不可信数据。有外部影响的操作沿用现有审批策略；页面或模型不能授予批准。Host 身份核验不替代工具审批。
- 使用现有持久化工具结果与附件存储。不将原始 base64、live 租约、paint 帧流或 Chromium 状态写入 Session 事件；实际持久化类型变化遵守仓库规则。
- 截图与 live-frame IPC payload 不得超过 32 MiB，字节以 `Uint8Array` 传递；超大图像必须拒绝。每个 lease 最多保留一个待发帧，新帧替换旧帧。
- IPC 前的浏览器文本不超过 `MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS`（1,000,000 字符）；`snapshotMaxChars` 与 `readResultMaxChars` 均须不超过该上限。标签清单最多返回 256 项；有更多标签时设置 `truncated`。
- 用户点击和页面脚本可能与自动化竞争。按 live Session 串行执行 provider 操作，以 generation 拒绝过期目标、帧和快照。输入发送成功不代表结果成立。
- canvas 使用 `aria-hidden`；语义 DOM 镜像来自同一个有界页面快照，只对当前可见 Sidebar pane 的无障碍树开放。过期 ref 不得重定向到另一个节点。
- 不提供任意 `evaluate` 或 Node REPL 工具；只读观察使用固定协议操作。本次不加入 cookie 迁移、持久登录态改造、上传/下载解禁或录制子系统。
- 新增部署可变的超时、快照和读取结果上限必须是经验证的 Config 字段。沿用品牌 ID、effect 注册、导出 JSDoc、UI 本地化及 Host/Client 分面 TypeScript 规则。

<a id="task-execution"></a>

## 任务执行

任务文件路径均相对仓库。新路径与签名为拟议接口，而非现有 API。每项任务以行为验证和审查节点结束；任务 7 负责端到端验收。修改既有导出前执行 LSP references。实现前为不确定的归属/actionability 行为补充回归并观察失败，再修复源码并重跑定向检查。

### 任务 1：类型化传输与 guest 身份

**文件：** 新建 `packages/browser-use/browser-use-desktop/{package.json,tsconfig.json,src/{index.ts,types.ts,protocol.ts,transport.ts},tests/transport.spec.ts}`。修改 `apps/desktop-host/{package.json,tsconfig.json,src/index.ts}`、`apps/desktop/{package.json,tsconfig.host.json,src/{host-process.ts,host-protocol.ts,browser-automation-protocol.ts}}`、根 `tsconfig.host.json` 和 `tsconfig.base.json` 中手工维护的子路径条目，并增加 Host 生命周期测试。新增 `apps/desktop-host/src/browser-transport.ts`。

**项目接线：** 在 Desktop Host 和 Desktop main 添加新包项目引用；根 Host aggregate 引用 Host 项目。`apps/desktop-host` 声明直接运行时依赖；`apps/desktop` 声明构建/运行时 bundle 依赖，包括 `dsh-brand`。裸包别名由 `gen-tsconfig-paths` 生成；`/types`、`/protocol` 和 `/transport` 导出指向 TypeScript 生成的 `lib/types/*.js`。验证工作区安装，并运行 `pnpm run verify-tsconfig-paths`。

**接口：** 包通过 `/types` 导出纯类型；`desktopBrowserTransport` 是在 profile 加载 provider 前通过 `runProfile.hostSetup` 安装的类型化 Host 能力。Node IPC 传输 `browser/request`、`browser/result` 或 `browser/cancel`；request 包含 Host 派生的 Session/owner generation、单调递增的安全整数 request ID 和已验证操作。`AbortSignal` 留在本进程，跨 IPC 通过取消消息表达。本地取消会立即拒绝工具调用；`releaseOwner` 等待父进程返回 terminal result 或 IPC 断开，避免已释放 owner 遗留仍被准入的 main-process 操作。使用 V8 advanced serialization，使截图以 `Uint8Array` 跨越两个进程，避免 base64 复制。

- [x] 在实现 IPC 两端前定义共享操作/结果判别标签及精确校验。使用品牌化 tab/snapshot ID，调用身份从模型参数以外获取。

```text
DesktopBrowserTarget = { tabId: DesktopBrowserTabId, generation: DesktopBrowserTargetGeneration }
DesktopBrowserCaller = { sessionId: SessionId, ownerGeneration: DesktopBrowserOwnerGeneration }
DesktopBrowserTransport.request(caller, operation, signal): Promise<DesktopBrowserResult>
DesktopBrowserTransport.releaseOwner(caller): Promise<void>
TabInfo = { target, url, title, active, ownership: "user" | "agent", attached: boolean }
DesktopBrowserOperation = { kind: "tabs.list" } | { kind: "tabs.open", url, newTab? } | { kind: "tabs.close", target } | { kind: "page.snapshot", target } | { kind: "page.read", target, locator, property, maxChars, attribute? } | { kind: "page.act", target, locator, action, text?, keys?, values?, observe? } | { kind: "page.actAt", target, screenshotId, action, x?, y?, deltaX?, deltaY?, path?, observe? } | { kind: "page.wait", target, condition } | { kind: "page.screenshot", target }
DesktopBrowserValue includes { kind: "tabs", tabs: TabInfo[], truncated } and { kind: "read", target, value, truncated } variants.
DesktopBrowserResult = { status: "success", value: DesktopBrowserValue } | { status: "error", code, message }
SnapshotResult = { target, snapshotId, text, truncated: boolean }
DesktopBrowserScreenshot = { target, screenshotId, bytes: Uint8Array, viewport: { width, height } }
MAX_DESKTOP_BROWSER_SCREENSHOT_BYTES = 32 * 1024 * 1024
MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS = 1_000_000; MAX_DESKTOP_BROWSER_TABS = 256
```

- [x] 在 `DesktopHostProcess` 增加关联请求处理，并在 `isDesktopHostEvent` 校验；同步更新 Host 生命周期协议版本与发布元数据。拒绝无所属、重复、迟到和 generation 不匹配的结果，不因此补发动作。
- [x] 在 `apps/desktop-host/src/index.ts` 的组合激活之前安装 transport，而不是在 `await application` 之后。Electron main 缺失或断连时拒绝请求；取消未执行操作，关闭时清理并等待请求注册表。
- [x] 通过现有生成器更新包源码别名，并执行 `pnpm run verify-tsconfig-paths`；确认 Desktop Host 与 Desktop main 的 TypeScript 项目引用都包含新包。
- [x] 覆盖跨 Session 目标、错误 live owner generation、IPC 断连、排队请求取消、dispose 后迟到回复和乱序响应。验证截图 bytes 通过子进程 IPC 往返后仍为 `Uint8Array`；拒绝超限截图、文本和标签清单。所有 `page.read` 测试 fixture 必须提供必需的 `truncated` 字段，确保 Host 类型检查通过。

**审查节点：** 模型不能控制身份字段，无网络监听，不向 guest 暴露 Electron/Node，Host 退出后不遗留 pending promise。

### 任务 2：Sidebar 标签发现、打开与归属

**文件：** 修改 `packages/client/ui-sidebar-browser/src/{types.ts,client/index.ts,client/browser/BrowserController.ts,client/electron/ElectronWebViewImpl.ts,client/electron/pages.ts}`、`apps/desktop/src/{browser-guests.ts,preload-browser.ts,ipc.ts,main.ts}`。新增 `packages/client/ui-sidebar-browser/src/client/electron/automation.ts` 和 `apps/desktop/tests/browser-automation-tabs.spec.ts`；扩展 UI 包内 `electron-lifecycle.client.spec.ts` 与 `browser-controller.client.spec.ts`。

**接口：** 使用任务 1 的 caller/target 定义。renderer 协调器只接收 main 发出的关联命令，返回 Sidebar 标签身份及 main 实际挂载的租约。main 维护权威的 Session → tab → lease → guest 对应关系；workspace partition 只决定存储分组，不授权操作该工作区所有 Session。

- [x] 为租约申请增加调用 Session/tab 元数据，对新增进程边界执行校验。用户创建的 Browser 标签仅在所属 Session 可发现。guest 挂载时分配 generation；导航、替换或关闭时使相应目标/快照失效。
- [x] 经 `sidebarRight` 与 `BrowserController` 打开，等待租约挂载后才返回成功；返回观察到的 URL/标题，而不只是提交的地址。快照/动作要求 guest 实际挂载，只有已分配租约不算就绪。
- [x] 仅复用已确认的当前 Session 页面。精确 URL 匹配不重载；同 hostname 导航必须获准；`newTab: true` 创建独立标签。
- [x] 后台 Session 命令始终定向到该 Session。前台 Session 打开页面时展示 Browser pane；后台任务不得抢走用户当前 Session，也不得操作前台标签。准确返回可见性事实并保留已挂载 body。
- [x] 将允许的 HTTP(S) 弹窗请求关联到源 Session 和动作请求；重试点击前先列举新标签。保留原生弹窗拒绝、带 POST body 弹窗拦截、Host 来源拦截和现有 URL 限制。
- [x] owner dispose 时撤销控制声明并取消/等待操作；保留可见标签以供交接。显式 `browser_close` 经 Sidebar 关闭并等待 guest 销毁。renderer 崩溃使相关句柄失败；重启显示恢复状态，不静默声称恢复已登录 Chromium 状态。
- [x] 验证同一 workspace 的两个 Session 不能相互控制标签；挂载途中关闭不泄漏 guest；用户弹窗留在源 Session；隐藏/后台页面不会把任务转到激活标签。执行定向生命周期/控制器测试及新增 tab 测试。

**审查节点：** 用户可见 Sidebar 页面与被操作 guest 是同一个页面；租约本身不代表标签已打开。

### 任务 3：Offscreen BrowserWindow 与 Sidebar canvas

**文件：** 修改 `apps/desktop/src/{browser-guests.ts,preload-browser.ts,ipc.ts,main.ts}`、`packages/client/ui-sidebar-browser/src/{types.ts,client/index.ts,client/browser/BrowserController.ts,client/browser/BrowserPage.ts,client/electron/pages.ts,client/view/BrowserBody.tsx,client/view/Browser.module.css}`、`apps/desktop/package.json`、`apps/desktop/tsconfig.host.json` 和 `tsconfig.client.json`。将私有 `client/electron/ElectronWebViewImpl.ts` 与 `ElectronWebviewPresentation.ts` 适配器替换为 `OffscreenBrowserImpl.ts` 与 `OffscreenCanvasPresentation.ts`。扩展 `apps/desktop/tests/{browser-automation-tabs.spec.ts,keyboard.spec.ts}` 及 `packages/client/ui-sidebar-browser/tests/{electron-lifecycle.client.spec.ts,browser-body.client.spec.tsx}`。

**接口：** Electron main 为每个已验证的 `(owner, Session, Sidebar tab)` lease 创建一个 offscreen `BrowserWindow`。workspace partition 留在 main 内部；renderer 只接收 lease。Client 在本地定义与 `DesktopBrowserTargetGeneration` 相同的 `BrandedNumber` 别名，不依赖 Desktop provider 包。bridge 负责导航/历史命令、页面状态事件、viewport 更新、画布输入和合并后的 paint 帧。

```text
DesktopBrowserReservation = { lease: DesktopBrowserLeaseId }
DesktopBrowserViewport = { cssWidth: number; cssHeight: number }
DesktopBrowserPageState = { url?: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: { code?: number; description?: string } }
DesktopBrowserTargetGeneration = BrandedNumber<'DesktopBrowserTargetGeneration'>
DesktopBrowserFrame = { lease: DesktopBrowserLeaseId; generation: DesktopBrowserTargetGeneration; sequence: number; png: Uint8Array; pixelSize: { width: number; height: number }; viewport: DesktopBrowserViewport }
DesktopBrowserCanvasInput = { kind: "pointer"; type: "move" | "down" | "up"; x: number; y: number; button?: "left" | "middle" | "right" } | { kind: "pointer"; type: "wheel"; x: number; y: number; deltaX: number; deltaY: number } | { kind: "key"; type: "down" | "up"; key: string; code: string; modifiers: readonly string[] } | { kind: "text"; text: string }
DesktopBrowserBridge.dispatchInput(lease: DesktopBrowserLeaseId, input: DesktopBrowserCanvasInput): Promise<void>
DesktopBrowserBridge.acquire(workspace, sessionId, tabId): Promise<DesktopBrowserReservation>
DesktopBrowserBridge.release(lease): Promise<void>
DesktopBrowserBridge.navigate(lease, url): Promise<void>
DesktopBrowserBridge.goBack(lease): Promise<void>
DesktopBrowserBridge.goForward(lease): Promise<void>
DesktopBrowserBridge.reload(lease): Promise<void>
DesktopBrowserBridge.setViewport(lease, viewport): Promise<void>
DesktopBrowserBridge.onPageState(lease, listener): () => void
DesktopBrowserBridge.onFrame(lease, listener): () => void
DesktopBrowserBridge.onOpenRequested(lease, listener): () => void
DesktopBrowserBridge.onAutomationRequest(listener): () => void
```

- [x] 增加失败的 owner/lifecycle 回归：有效 lease 在 workspace partition 中创建一个隐藏 BrowserWindow；第二个 Session 不能查找或操作它；创建中释放会销毁窗口并结清 pending 工作。帧测试拒绝错误 owner/lease、过期 generation、畸形 payload 和超过 32 MiB 的 PNG。
- [x] 先运行 `node node_modules/pnpm/bin/pnpm.mjs exec vitest run apps/desktop/tests/browser-automation-tabs.spec.ts apps/desktop/tests/preload-app.spec.ts`；确认新增 lease/window 与帧测试因预期功能缺失而失败。
- [x] 创建 offscreen BrowserWindow，设置 `show:false`、`skipTaskbar:true`、`offscreen:true`、`backgroundThrottling:true`、`devTools:false`、`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`、`webSecurity:true` 且不配置 preload。复用 main 管理的 workspace partition；拒绝权限和原生窗口，保留 URL 限制，并对新窗口设置 `webviewTag:false`。确认没有其他 renderer 创建 webview 后，移除主窗口的 `<webview>` 路径并设 `webviewTag:false`。
- [x] 将 webview 的挂载/释放握手替换为 main 创建和销毁 BrowserWindow。把现有快捷键输入限制接到 offscreen WebContents；按 lease 关联页面状态与弹窗；关闭标签或 owner 时释放并等待 BrowserWindow 销毁。
- [x] 将 `paint` 转为带 lease/generation 的 PNG 帧。main 为每个 lease 保留一个最新 NativeImage；仅在 canvas 订阅或截图时编码，最多保留一个待发帧，新帧替换未发送的旧帧。通过 Browser body 的 ResizeObserver 调用 `setViewport`，不重载页面。
- [x] 在现有 Sidebar Browser body 中用 canvas 显示帧；沿用现有布局与 Browser CSS token，不另造视觉方案。canvas 按提交的 CSS viewport 缩放，指针坐标映射回同一 viewport，并设置 `aria-hidden`；任务 4 增加屏幕阅读器 DOM 镜像。
- [x] 仅在 canvas 拥有焦点时，通过 `dispatchInput` 转发指针、键盘和文本/IME 输入。main 校验当前 lease；工具栏快捷键和对话输入不得进入页面输入路径。
- [x] 覆盖 paint 转发/取消订阅、过期帧拒绝、viewport 缩放、隐藏时保留最新帧、owner/Session 隔离及输入不进入对话输入框。执行 Desktop/Browser 定向测试和 `node node_modules/typescript/bin/tsc -b apps/desktop/tsconfig.host.json packages/client/ui-sidebar-browser/tsconfig.client.json packages/client/ui-sidebar-right/tsconfig.json --pretty false`。
- [x] 在 800×600 与 1280×820 下，测量静态、动画和图片密集 loopback 页面编码后的帧大小与 PNG 转换时间；在 Windows/macOS 验证 32 MiB 上限及每 lease 一个待发帧的合并规则。
- [x] 在开始任务 4/5 前，用隔离的 `userData`、Harness home、workspace 和 loopback fixture 构建并启动集成后的 Desktop profile。使用打包 guest 设置验证 Sidebar canvas、私有 isolated-world DOM/name 读取、可信输入和截图来自同一个 lease-owned `WebContents`；确认折叠时仍有隐藏 paint、Session 隔离、弹窗/权限策略以及没有 public CDP endpoint。任一检查失败就停止，不开始 DOM engine 或模型工具。若 `build:lib:host` 仍因 Browser tab API/test 不匹配而失败，或根 Client aggregate 仍有先前报告的 `SessionStore`/`ClientSessions` 类型错误，先取得责任人批准并修复；不得用直接构建单个包或独立窗口原型替代。

**审查节点：** 同一个 offscreen `WebContents` 提供 Sidebar 像素、页面状态、DOM 操作、可信输入和截图；隐藏帧捕获不会选择或显示其他 Session。

### 任务 4：DOM 语义、可信输入与无障碍镜像

**文件：** 新增 `apps/desktop/src/{browser-automation.ts,browser-dom-engine.ts,browser-input.ts}`、`apps/desktop/scripts/prepare-browser-dom.ts`、`apps/desktop/tests/{browser-dom-engine.spec.ts,fixtures/browser-automation-page.html}` 和 `packages/client/ui-sidebar-browser/tests/browser-body.client.spec.tsx`。修改 `apps/desktop/{package.json,src/{browser-guests.ts,ipc.ts,main.ts,preload-browser.ts},tests/browser-automation.e2e.ts}` 及 `packages/client/ui-sidebar-browser/src/{types.ts,client/electron/OffscreenBrowserImpl.ts,client/view/BrowserBody.tsx,client/view/Browser.module.css}`。

**接口：** 使用任务 3 经 lease 核验的 offscreen `WebContents`，并返回任务 1 已定义的类型化 snapshot/read/action/wait/screenshot 结果。Client 在本地声明与 Desktop provider 相同的 `Branded` ID 别名，避免依赖 Desktop 专用 provider 包。无障碍 DOM 镜像接收同一 Playwright snapshot 的独立有界树；它只用于 renderer，不额外产生模型可见数据。

```text
DesktopBrowserSnapshotId = Branded<"DesktopBrowserSnapshotId">
DesktopBrowserRef = Branded<"DesktopBrowserRef">
DesktopBrowserAccessibleNode = { snapshotId: DesktopBrowserSnapshotId; ref?: DesktopBrowserRef; role: string; name: string; text?: string; value?: string; states: string[]; children: DesktopBrowserAccessibleNode[] }
DesktopBrowserAccessibleSnapshot = { lease: DesktopBrowserLeaseId; snapshotId: DesktopBrowserSnapshotId; generation: DesktopBrowserTargetGeneration; nodes: DesktopBrowserAccessibleNode[]; truncated: boolean }
DesktopBrowserBridge.onAccessibleSnapshot(lease: DesktopBrowserLeaseId, listener: (snapshot: DesktopBrowserAccessibleSnapshot) => void): () => void
DesktopBrowserBridge.accessibleAction(lease: DesktopBrowserLeaseId, snapshotId: DesktopBrowserSnapshotId, ref: DesktopBrowserRef, action: DesktopBrowserAccessibleAction): Promise<void>
DesktopBrowserAccessibleAction = { kind: "focus" | "click" | "check" | "uncheck" } | { kind: "fill" | "type"; text: string } | { kind: "press"; keys: string[] } | { kind: "select"; values: string[] }
```

- [x] 为重复 role/name、导航后过期 ref、ref 成员资格和无障碍树上限增加失败测试：每树最多 10,000 个节点和 1,000,000 个累计字符串字符；被截断节点不可交互。
- [x] 将 `playwright-core` 精确固定到 `1.59.1`。构建时提取其生成的注入 DOM engine，并打包为不可变资源。不依赖 npm 私有导出，不手写 ARIA 命名算法，也不复制 browser manager。复制任何源码前检查 ZCode 对应文件和许可。
- [x] 每个 offscreen `WebContents` 的 document/frame 运行一个私有 isolated-world engine。每个 ref 绑定 snapshot ID、lease generation、document 和授权 frame；拒绝歧义目标、不支持的 frame 遍历、过期或非成员 ref。不提供任意 `evaluate` 或原始 debugger method。
- [x] 实现固定的 text/attribute/visible/enabled/checked 读取、具体 URL/load/element 等待，以及可信 click/double-click/fill/type/press/check/uncheck/select/hover/scroll/drag。操作前确认目标可见、enabled、唯一且未被遮挡；遵守键盘/IME 行为。坐标操作必须绑定同一 lease generation 与 screenshot ID，并按当前 viewport 映射 CSS 像素。
- [x] 向 Sidebar 返回有界结构化无障碍节点；页面文本只按普通文本渲染，不作为 HTML。canvas 使用 `aria-hidden`；视觉隐藏的语义镜像仅在当前 Sidebar pane 的无障碍树中开放。屏幕阅读器的焦点、激活和输入使用 snapshot ref 与 lease 校验操作；过期 ref 从焦点顺序中移除。
- [x] 导航和操作完成后刷新/失效语义树；使用合并后的 MutationObserver 感知动态页面变化。每树最多 10,000 个节点和 1,000,000 个累计字符串字符；达到上限时设置 `truncated`，截断节点不携带 ref。隐藏/后台 Session 的内容不得进入 renderer 无障碍树。
- [x] 验证重复标签不能通过严格选择；延迟表单可填写；遮挡按钮不会被穿透点击；Unicode 输入能到达应用；open shadow DOM 和授权 iframe 可观察；弹窗目标可发现；导航后旧 ref 被拒绝；语义镜像操作只到达当前页面。运行 engine 与 renderer 定向测试。

**审查节点：** 模型与屏幕阅读器访问同一个 lease-owned 页面；无障碍节点不包含可执行标记，也不能在所属快照过期后继续操作。

### 任务 5：模型工具、审批与持久截图

**文件：** 新增 `packages/browser-use/browser-use-desktop/src/{provider.ts,tools.ts}` 和 `tests/{provider.spec.ts,tools.spec.ts}`。修改 `packages/browser-use/browser-use-desktop/{package.json,tsconfig.json,src/{index.ts,types.ts}}` 及其英文/中文 README。

**接口：** 包根导出 Cordis 插件的 `name`、`inject`、`Config` 和 `apply`。注入 `browserUse`、`tools`、`agents`、`desktopBrowserTransport` 和现有附件服务。在一个 `ctx.effect()` 中注册唯一 `desktop-internal` provider 及其八个工具；任务 6 在同一插件中注册 skill。caller/target 身份来自任务 2，操作只通过任务 1 的类型化 transport。

```text
browser_tabs() -> { backend: "desktop-internal"; tabs: DesktopBrowserTabInfo[]; truncated: boolean }
browser_open({ url: string; newTab?: boolean }) -> DesktopBrowserTabInfo
browser_close({ target: DesktopBrowserTarget }) -> { target: DesktopBrowserTarget; closed: true }
browser_snapshot({ target: DesktopBrowserTarget }) -> { target; snapshotId; text; truncated }
browser_read({ target; locator; property; attribute? }) -> { target; value: string | boolean | null; truncated }
browser_act({ target; locator; action: DesktopBrowserSemanticAction; text?; keys?; values?; observe? } | { target; screenshotId; action: DesktopBrowserPointerAction; x?; y?; deltaX?; deltaY?; path?; observe? }) -> { target; delivered; observation?; screenshot? }
browser_wait({ target: DesktopBrowserTarget; condition: DesktopBrowserWaitCondition }) -> { target; matched: true }
browser_screenshot({ target: DesktopBrowserTarget }) -> { target; screenshotId; image: ImageAttachmentRef; viewport }
```

- [x] 从 live `exec.agent` 与可信 Host 元数据派生 Session 身份；为每个 live Agent 分配单调递增的 owner generation。模型参数不得包含 caller、Session、workspace、lease、WebContents 或 generation。按 live Session 串行执行操作；Agent dispose 时释放 owner，provider 卸载时等待 owner 工作结束。
- [x] 在 provider Config 校验四个部署可变值：`operationTimeoutMs`、`navigationTimeoutMs`、`snapshotMaxChars` 和 `readResultMaxChars`。文本上限必须为正整数且不超过 transport 的 1,000,000 字符硬上限；无效 Config 在加载时失败。
- [x] 为每个工具定义严格的判别 schema。`browser_read` 的 attribute 读取必须提供 `attribute`；`fill`/`type` 必须提供 `text`；`press` 必须提供 `keys`；`select` 必须提供 `values`。指针 click/doubleClick/move 必须有 x/y；scroll 还需 deltaX/deltaY；drag 至少需要两个路径点。非有限或超出截图 viewport 的坐标必须在 transport 调用前拒绝。
- [x] 每个工具只映射到一个受支持的 `DesktopBrowserOperation`，保留类型化 canonical result 和截断标记。每次调用都要求最新 target ID。`browser_act` 只派发一个动作，可选地等待具体状态并返回 snapshot/screenshot；超时或交付不确定时提示重新观察，绝不重试动作或切换后端。
- [x] 将 `readResultMaxChars` 作为 `page.read.maxChars`；向模型暴露前按 `snapshotMaxChars` 截断 `page.snapshot` 文本，并设置 `truncated`。1,000,000 字符传输上限仍在 IPC 前生效。
- [x] 使用标准 `ctx.tools` 执行、审批、取消和 PTC 分发路径；不增加并行工具循环或特殊审批绕过。审批拒绝时不得派发页面输入。取消时等待 transport 结清，不声称已回滚已发送的输入。
- [x] 通过现有附件 API 保存截图字节；结果只返回有界附件引用、target、viewport 和 screenshot ID。仅向支持图像的模型传送图像内容；不支持视觉时明确报告，不能声称已完成视觉评估。不得序列化原始图像字节、base64、live frame、cookie 或超出已声明 text/screenshot 结果的页面内容。
- [x] 增加行为测试，覆盖 live-Agent caller 身份、每 Session 串行化、审批拒绝和无效动作参数在输入前被拒绝、坐标边界、取消/owner 释放、过期 target、明确截断、截图附件展示和不支持视觉时的报告。验证 native 与 PTC 获得相同工具 schema，不使用第二个 executor。

**审查节点：** 八个工具只暴露类型化浏览器协议；审批和取消沿用现有工具管线，截图结果通过持久附件回放。

### 任务 6：随产品发布的 skill 与 Desktop 专用组合

**文件：** 新增 `packages/browser-use/browser-use-desktop/src/skills.ts`、`assets/{control-browser,web-gui-tester}/SKILL.md` 和 `apps/desktop/tests/desktop-browser-profile.spec.ts`。修改 `packages/browser-use/browser-use-desktop/{package.json,src/provider.ts}` 以打包 skill 资源并注册 skill provider；修改 `packages/bundle/asterhub-desktop-native/{package.json,cordis.patch.yml}`。只有 Desktop runtime closure 要求显式列出 skill 时才修改 `apps/desktop/package.json`；任务 4 负责 Playwright engine 资源和依赖接线。用既有生成器更新 tsconfig/catalog，不手改生成表。

**接口：** 扩展任务 5 插件的 `inject`/`apply`，通过 `ctx.skills.registerProvider` 和 `packages/skill/skill-office/src/index.ts` 使用的 bundled-rank 机制注册技能。技能与 Desktop provider 属于同一插件，不占用第二个 `ctx.browserUse` 槽。skill 是产品 runtime 资源，不只是仓库 `.agents/skills` 指令。

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
    readResultMaxChars: 50000
```

- [x] 按现有 bundle overlay 语法插入这些条目，不重复已有 registry 条目。Config 校验两个文本上限不超过 IPC ceiling，并明确报告截断；这里的数值是部署默认值，不是隐藏常量。
- [x] 按任务 5 的八个工具编写 `control-browser`。覆盖后端发现、当前标签检查、获准的精确/同 host 复用、具体等待、快照派生的严格定位、动作后验证、弹窗发现、过期目标恢复、截图使用、用户标签交接和拒绝报告。不复制 ZCode fresh-kernel bootstrap 或不支持的 API 名。
- [x] 编写 `web-gui-tester`，包含 P0 主流程、P1 反馈、P2 边界和 P3 布局。区分环境准备与正式 GUI 测试。正式测试使用正常前端交互、检查语义状态和实际查看过的截图，分别记录 blocked/unsupported 情况，不修改待测代码，也不绕过失败流程。
- [x] 将 skill 纳入开发与打包 runtime 闭包。仅复制上游源码时保留其许可；新指令描述 AsterHub 的真实工具和限制。网页任务使用此 Browser。桌面原生任务或用户明确要求时，只有在用户配置的 Computer Use provider 可用时才调用；否则报告不可用，不静默切换。
- [x] 验证组装后的 Desktop 提示词/工具/skill 发现，而不只检查文件存在。Web、dev-web、headless 和 SDK composition 不得获得 Desktop provider。替换为外部 provider 时先禁用 Desktop 条目及其指引，再启用一个外部 provider；重复激活必须明确失败。

**审查节点：** 客户安装无需仓库开发指令、额外浏览器安装、公开调试端点或第二个模型 API key，就能发现随产品发布的 skill 和真实工具。

### 任务 7：端到端验收与发布文档

**文件：** 新增 `apps/desktop/tests/fixtures/browser-automation-smoke.mjs`；扩展 `apps/desktop/tests/{browser-automation.e2e.ts,browser-automation-tabs.spec.ts}` 与相关 Sidebar 无障碍/Browser body 测试。按仓库快照归属规则增加 recorded-session case；附件/GUI 结果不属于 Session snapshot 时增加 provider 所属 expected-output case。更新成对的 `packages/client/ui-sidebar-browser/README*`、`docs/subsystems/browser-use*`、`apps/desktop/README*` 和所属包组 README。为 Desktop 默认变化在当前未发布版本目录下添加 upgrade guide。

- [ ] 在最终产物上重跑任务 3 的打包 guest 证明，确认记录证据涵盖实际发布的 guest flags。仅在任务 3 通过后运行真实模型、Sidebar、附件回放、GUI 测试与生命周期场景。
- [ ] 使用 `pnpm run dev:desktop` 构建并启动；Windows 用 `pnpm run package:desktop:win:x64:dir` 生成目录产物，macOS 用 `pnpm run package:desktop:mac:arm64:dir` 或 `pnpm run package:desktop:mac:x64:dir`。通过真实 `dsh` Desktop profile 运行，并隔离 Desktop `userData`、Harness home、workspace 和 loopback fixture 端口。开发应用和 `devTools:false` 打包产物都必须实际运行；Electron e2e 不得自跳过。
- [ ] 运行真实模型请求：“用内置浏览器打开本地测试页，填写表单、提交并验证成功提示。”检查实际 Sidebar canvas、持久工具结果事件和截图附件。确认没有启动系统浏览器，也没有跨 Session 泄漏私有页面状态。只使用已获准用于本次验证的测试凭据；没有凭据时将此项标记为阻塞。不得用 mock 响应或直接调用 provider 代替真实模型验证。
- [ ] 在同一 fixture 运行 GUI-test skill：成功表单、disabled/遮挡控件、弹窗新标签、瞬态提示、授权 iframe、open shadow target 和 canvas。生成带实际查看截图证据的 passed/failed/blocked/unsupported 结果；真实页面失败时准确报告，不通过 JavaScript、直连 API、刷新或备用浏览器绕过。
- [ ] 在真实 Sidebar 中验证语义镜像的屏幕阅读器/键盘导航、焦点、激活和文本输入；确认输入不会到达对话输入框。覆盖用户打开的标签、同 workspace 两个 Session、Session 切换、Sidebar 折叠、显式关闭、输入发送后的取消、renderer 丢失和应用重启。
- [ ] 为产品 GUI 变化录制真实 server/model-flow GIF。验证 Windows 和 macOS guest 行为；未运行的平台或不可用的模型凭据明确记为阻塞，不声称通过。不得将凭据写入源码控制。
- [x] 文档区分 Desktop 内置自动化、外部 provider、不可自动化的 Web iframe、支持动作及现有上传/下载/权限限制。更新配对文档及工具/config/Cordis catalogs；真实 smoke 成功后才删除一次性探针。

**已验证的检查：** Node 环境定向测试通过 65 项；browser automation e2e 文件通过 3 项，其中包含主进程 `document` 不可用时由 jsdom Electron mock 完成的 isolated-world snapshot/read/fill。多包 TypeScript 构建与 Desktop bundle 构建通过。七组命名的双语文档配对检查通过。`gen-config-catalog.ts` 与 `gen-tool-catalog.ts` 已更新输出。

**Task 7 未完成的验收项：** 真实 Electron smoke fixture 在 `app.whenReady()` 阶段等待 45 秒后超时；此前 trace 到达 `server-ready` 但未记录 `electron-ready`，隔离 userData 后重试仍超时。我启动了正常 Desktop 开发版并提交用户授权的测试登录，登录面板随后关闭。内置 Browser 对本地 fixture 收到 HTTP 200，但 Sidebar 仍显示通用页面加载失败提示，画布为空；真实 Browser 流程失败，发布前必须继续排查。模型选择器仍显示 `请选择模型`，未执行模型动作。尚无真实 guest 屏幕阅读器、跨 Session、macOS 或 GIF 证据。isolated-world 回归使用 jsdom-backed Electron mock，并非真实 guest。20 文件汇总测试中有 7 个 jsdom suite 在 setup 阶段因 `No such built-in module: node:` 失败；另外 13 个文件的 78 项测试通过。`gen-cordis-catalog.ts --check` 被 `packages/schedule/asterhub-automation/src/index.ts` 的三个缺失 `@mode` 标签阻塞；`test:docs` 也因无关的 markdown-wrap 与 type-equivalence 条目失败。

**已执行检查：**

```sh
vitest run packages/browser-use/browser-use-desktop/tests apps/desktop/tests/host-process.spec.ts apps/desktop/tests/browser-automation-tabs.spec.ts apps/desktop/tests/browser-dom-engine.spec.ts apps/desktop/tests/desktop-browser-profile.spec.ts packages/client/ui-sidebar-browser/tests
tsc -b packages/browser-use/browser-use-desktop/tsconfig.json apps/desktop/tsconfig.host.json packages/client/ui-sidebar-browser/tsconfig.client.json packages/client/ui-sidebar-right/tsconfig.json --pretty false
vitest run --config vitest.e2e.config.ts apps/desktop/tests/browser-automation.e2e.ts
pnpm --filter @deepseek-ai/dsh-desktop run bundle
verify-translation-pairing.ts <seven changed bilingual document pairs>
```

**审查节点：** 待完成。真实 Electron smoke、端到端 UI/模型验收、跨平台验证与回放证据尚未验证。

<a id="acceptance-and-handoff"></a>

## 验收与交接

| 要求 | 责任任务 | 证据 |
|---|---|---|
| Desktop 使用用户可见内置页面 | 任务 2、3、5、7 | 真实模型调用链与对应 Sidebar guest |
| 据快照定位且不盲目重试 | 任务 4、5、6、7 | 重复/遮挡/过期目标 fixture 与记录轨迹 |
| 同 workspace Session 不能交叉操作 | 任务 1、2、3、5、7 | 跨 Session 动作被拒绝且另一页面未变化 |
| 弹窗、frame、shadow DOM、canvas 使用已观察目标 | 任务 2、3、4、7 | 真实 guest 观察、输入结果和截图 |
| 工具审批与持久视觉证据可回放 | 任务 5、7 | 拒绝动作不送输入；文本/图片引用可回放 |
| Web/dev-web 不变 | 任务 6 | 组装 profile 对比，不注册 Desktop 工具 |
| 不依赖外部浏览器或 public CDP endpoint | 任务 1、3、7 | 安装 runtime 闭包与真实启动观察 |
| 屏幕阅读器操作留在当前 Sidebar 页面 | 任务 3、4、7 | 真实 Sidebar 无障碍树、焦点/输入路由与隔离 |
| GUI 测试不绕过前端行为且准确报告失败 | 任务 6、7 | 已查看截图报告与真实模型 GIF |

任务 1、2 已完成且定向测试通过。任务 3 必须先通过集成后的打包 guest 证明，任务 4 DOM engine 和任务 5 模型工具才可开始。任务 6 可按已命名工具契约起草，但必须使用最终 schema。任务 7 在任务 3–6 集成后开始。其他任务仍在编辑时不运行全项目验证。

若 sandboxed/打包 guest 无法在不开放 public debugging endpoint 的情况下支持所选 DOM/输入机制，main 无法核验 Session 身份，或缺少所需持久截图投影，则暂停并重新设计。解决底层前提后再继续，不交付只有提示词或外部浏览器替代品。

<a id="evidence-sources"></a>

## 证据来源

本地既有归属依据：`apps/desktop/src/browser-guests.ts`、`preload-browser.ts`、`host-process.ts`；`apps/desktop-host/src/index.ts`；`packages/client/ui-sidebar-browser/src/types.ts` 和 `client/index.ts`；`packages/browser-use/browser-use/src/index.ts`；`packages/bundle/asterhub-desktop-native/cordis.patch.yml`。源码已检查。独立 offscreen BrowserWindow 原型验证了 paint、DOM/AX 访问、可信输入和截图；它未验证打包启动或 Sidebar 集成。[设计规格](../specs/2026-10-07-desktop-offscreen-browser-mirror-design.zh.md)记录了证据范围。

- [ZCode control-browser 工作流](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md)
- [ZCode web-gui-tester 工作流](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/browser-use-plugin/skills/web-gui-tester/SKILL.md)
- [ZCode browser bridge](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/node-repl-host/src/browser-bridge.ts)
- [ZCode isolated-world DOM 快照执行器](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightDomSnapshot.ts)
- [ZCode frame-aware locator 与可信输入执行器](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/browserPlaywrightLocatorExecutor.ts)
- [ZCode Playwright 注入 DOM 源码加载器](https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/main/browserView/playwrightInjectedScriptSource.ts)

这些 URL 指向上游 main，可能变化。执行时在依赖/第三方归属记录中固定审查版本，核对每个复制文件的许可，并用选定 Electron/engine 版本重新运行 DOM/输入探针。API 名为 Playwright 不代表使用独立浏览器进程或公开 CDP 端口；进程内私有 CDP 仍可能是实现细节。

## Dev Note

任务 1、2 已完成并通过定向测试验证。任务 3–7 描述剩余实现与验收；独立 offscreen 原型不代表集成后的打包 guest 已通过。
