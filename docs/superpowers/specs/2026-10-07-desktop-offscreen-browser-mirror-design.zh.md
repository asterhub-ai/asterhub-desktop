# AsterHub Desktop 离屏 BrowserWindow 镜像设计
[English](2026-10-07-desktop-offscreen-browser-mirror-design.md) | 中文

**状态：** 提议；用户已授权撰写规格和计划供审阅

**范围：** 将 Desktop Sidebar Browser 的 `<webview>` 展示替换为每个 Browser lease 由主进程拥有的离屏 `BrowserWindow`，并在 Sidebar 中以 canvas 镜像显示。

## 目标

保留现有浏览器自动化范围，支持 Browser tab 在 Sidebar 中不可见时进行 DOM 检查、可信输入和截图。被操作的页面、Sidebar 中显示的页面以及截图中的页面必须是同一个 `WebContents`。

## 证据

真实 Desktop Sidebar `<webview>` guest 支持 `Page.createIsolatedWorld`、Accessibility tree、可信鼠标和文本输入，以及可见状态下的 `WebContents.capturePage()` 截图。折叠 Sidebar 后，guest 仍然存活，但 `WebContents.capturePage()` 和 CDP `Page.captureScreenshot` 都超时。

一个实际离屏 `BrowserWindow` 原型使用了 `show:false`、`offscreen:true`、`devTools:false`、`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false` 和 loopback fixture。它产生了四个 `paint` 帧，通过 Accessibility 暴露名为 `Name` 的 textbox，接受可信输入和点击事件，生成了 fixture 成功结果，并返回 800×600 PNG。该原型未使用打包应用，也未集成 Sidebar。

Electron 文档说明 `BrowserWindow` 支持 offscreen paint。对现有 `<webview>` guest 设置 `offscreen:true` 后，页面未加载，也未产生 paint 帧。

## 所有权与创建

Electron 主进程仍是 `(application window, Session, Sidebar tab) → lease → page` 的权威所有者。每个 lease 拥有一个隐藏 `BrowserWindow` 及其 `WebContents`；同一个 Browser tab 不会由第二个页面实例代替。

离屏窗口使用 lease 的 workspace partition，以及现有 URL 限制、权限拒绝、popup 策略、Session 成员关系、导航 generation 和 lease 取消规则。主进程只向 product renderer 暴露按 lease 限定的 Browser 操作和图像帧，不向 renderer 或模型暴露 Electron 对象或任意 CDP 命令。

离屏 `BrowserWindow` 不加载 preload，并使用 `show:false`、`offscreen:true`、`devTools:false`、`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false` 和 `webSecurity:true`。Host 拒绝权限和原生窗口，拒绝不支持的 scheme 与带凭据 URL，并将允许的 popup 关联到源 lease。

## Sidebar 展示与帧传输

Browser body 将 `<webview>` 标签替换为 canvas。主进程订阅离屏 `WebContents` 的 `paint` 事件，并为每个 lease 保留最新的 `NativeImage`。它向 Sidebar Browser presenter 发送带 lease 和 generation 标识的帧；canvas 按照已提交的 viewport 缩放，并保留页面的 CSS pixel 坐标映射。

帧传输有界且会合并。每个 lease 最多只有一个最新帧等待发送；有新 paint 时，未发送的旧帧会被替换。只有 Sidebar body 已挂载时 renderer 才订阅帧。隐藏视图仍会更新主进程拥有的最新帧，供截图使用，但不会选择或显示该 Session。

实施前必须根据 Windows 和 macOS 上的实测成本选择帧编码和传输上限。原型的 PNG 输出只证明功能，不证明吞吐可接受。帧路径不得保留无界数量的整页缓冲区。

## 页面操作与结果

现有 BrowserController 继续拥有 Session/tab identity、保存的 URL、导航 revision 和 Sidebar 生命周期。主进程对 lease 的离屏 `WebContents` 执行导航。Playwright 生成的 injected DOM engine 在私有 isolated world 中执行 snapshot、strict locator resolution、read、wait 和语义操作。可信键盘与指针输入发送到同一个 `WebContents`；坐标操作继续绑定 screenshot ID、tab generation 和 CSS-pixel viewport。

主进程只对 lease 所属操作使用 `WebContents.debugger`，并在销毁 lease 前 detach。`devTools:false` 不会开放 DevTools 窗口或 public remote-debugging endpoint。模型工具不接受任意脚本或原始 debugger 方法。

Sidebar 展示和截图结果都使用最新 paint 图像。截图操作返回当前 target 和 viewport，并附带图像 attachment；如果没有当前帧或帧已过期，必须返回明确错误，不能声称捕获了最后页面状态。

## 生命周期与隔离

guest 创建、attach、paint 订阅、debugger attach、取消和销毁都按 lease 管理。关闭或打开 Sidebar tab、Session disposal、application renderer loss 和 Host cancellation 都会撤销相应 lease，并等待其工作结束。后台 Session 的 BrowserWindow 即使 Sidebar view 隐藏，也仍绑定到该 Session。

每个 BrowserWindow 使用现有的、按 workspace 分组的内存 Session partition，因此 workspace storage 仍然共享分组，而页面控制和 target ID 仍按 Session 和 tab 隔离。原生 popup 会被拒绝；允许的 HTTP(S) popup 会通过源 lease 上报。renderer 丢失或应用重启不会隐式恢复已登录的 BrowserWindow；现有 restore 状态仍由用户显式触发。

## 无障碍与交互影响

canvas 是像素视图，不是原生 DOM 子树。它不会自动提供网页文本选择、原生浏览器 context menu 或网页 Accessibility tree 给桌面屏幕阅读器。Browser automation engine 可以向模型提供 DOM snapshot，但这不能替代面向 Sidebar 用户的无障碍支持。实现必须在发布前定义用户可访问的操作路径；不能将 canvas 描述成与原生 `<webview>` 对 assistive technology 等效。

canvas 的键盘和指针事件必须映射到同一个离屏页面，且不得聚焦或选择其他 Session。设计必须保留 Sidebar toolbar 现有的本地化标签与焦点行为。页面隐藏或未聚焦时，不得将 Browser 输入错误地传到 conversation composer。

## 实施前验证

第一项集成证明必须从真实 Sidebar lease 创建离屏 BrowserWindow，并使用打包 guest preferences。它必须确认：

- 一个 lease 对应一个离屏 `WebContents`，共享 workspace 的两个 Session 仍然相互隔离；
- Sidebar 折叠时 offscreen paint 仍继续，并为同一 target 和 generation 返回截图；
- `devTools:false` 时 isolated-world snapshot 和 role/name locator resolution 可用；
- guest 隐藏时，可信输入能修改 loopback fixture，且不会改变 conversation draft 或聚焦到其他 Session；
- popup 拒绝、HTTP(S) 导航校验、权限拒绝、lease close、renderer loss 和应用关闭仍保持现有行为；
- Windows 和 macOS 上帧合并与截图传输都保持有界。

在集成后的打包 guest 通过该证明之前，不得开始 Playwright engine 或模型工具。若 offscreen paint、输入隔离或面向用户的无障碍路径失败，必须修订设计；不得重新开放 public debugging endpoint，也不得暗中缩小已批准范围。

## 风险

- Electron 文档说明 `BrowserWindow` 支持 offscreen rendering，但没有说明当前 `<webview>` 实现支持。打包后的 Sidebar 集成必须验证真实 guest preferences 和生命周期。
- 帧复制与编码在动画页面和高 DPI 显示器上会消耗 CPU、内存和 IPC 带宽。
- 用 canvas 替换原生网页内容会改变文本选择、屏幕阅读器与 context menu 行为。
- offscreen 原型设置了 `devTools:false` 并通过 private debugger 完成 attach，但没有测试打包启动或 Desktop guest policy。当前 Client 聚合构建仍因其他 `SessionStore`/`ClientSessions` 测试类型不匹配而失败，因此无法进行打包验收。

## 非目标

- 不开放 public CDP listener、外部浏览器进程或第二个模型 API。
- 不创建与隐藏自动化页面分离的可见页面。
- 不提供模型可调用的 JavaScript evaluation 或原始 debugger 命令。
- 不自动展开 Sidebar、切换 Session，或在重启后恢复已登录的 BrowserWindow。
