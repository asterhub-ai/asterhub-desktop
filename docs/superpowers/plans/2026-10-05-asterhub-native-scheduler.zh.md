# AsterHub 原生调度器实施计划

[English](2026-10-05-asterhub-native-scheduler.md) | 中文

> **面向执行工作的 Agent：** 必需子技能：使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐项实施。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 交付 AsterHub 内置定时任务执行和任务面板，取代 Desktop 可选 Schedule Bundle。

**架构：** 一个 Host 拥有者将每项任务及其有界执行/回执历史持久化为单个存储域记录。计时运行时通过公开 Agent/preset API 创建新的工作区 Session，按账号取消，并保留普通审批。Client 包使用类型化 automation Remote 方法，在 Plugins 正下方注册主面板；仅 Desktop 包含原生组合。

**技术栈：** TypeScript、Cordis、Typert Remote、storage-domain、现有 Schedule 纯重复时间计算、React/CSS Modules 和现有 ui-primitives。

**设计：** [已批准设计](../specs/2026-10-05-asterhub-native-scheduler-design.zh.md)。

## 全局约束

- 在当前特性检出目录工作，保留未提交设计；不自动提交、推送、发布，不使用第三方凭据或更改客户数据。
- 能力随原生安装器交付，不属于精选插件；只在 Host 运行时执行；每个执行时机创建新 Session；聊天和 GUI 编写共用一个服务。
- 遵循完整设计，包括账号 epoch 隔离、已确认执行修订、持久有界请求回执、重复任务不重叠、暂停清除待处理触发、崩溃后的未知结果、用户问题处理，以及 Desktop 专属切换。
- Client UI 复用现有语义 token、控件、locale 字典和 Plugins 页面布局；不增加第二套组件库。
- 并发实施者分别拥有不同文件，不运行构建、lint、测试或格式化器，并返回有源码依据的实施报告。所有修改结束后，主执行者集成并运行定向验证。
- 名称、输入/输出类型和运行时 Host 端口固定在 `packages/schedule/asterhub-automation/src/types.ts` 和 `runtime-contract.ts`；变更需集成负责人同意，不得私自选择替代方案。

## 归属与共享接口

| 任务 | 拥有文件 | 消费方 |
|---|---|---|
| Host 管理 | 新增 `packages/schedule/asterhub-automation/`，不含 runtime/execution/timing 文件 | Client、Runtime、Desktop |
| 运行时执行 | `runtime.ts`、`execution.ts`、`timing.ts`、相关定向测试；Schedule timing 子路径导出 | Host 管理 |
| 账号隔离 | `packages/account/account-sub2api/` 账号生命周期 API 和回归用例 | Host/Runtime |
| 任务面板 | 新增 `packages/client/ui-asterhub-automation/` 和定向测试 | Desktop 组合 |
| Desktop 切换 | Desktop/desktop-host 组合、打包、退出和更新路径及定向测试 | 已安装应用 |
| 主集成 | 共享类型、根别名/tsconfig 引用、锁文件/生成器、跨任务修复、验证、文档 | 全部 |

### 任务 1：共享协议与行为探测

- [ ] 固定浏览器安全的 Task/Run/Draft/PreparedOperation/MutationResult/Choices 类型和运行时端口。
- [ ] 用定向冒烟观察功能加入前的侧栏/API 缺失；仅为有意义的账号、时间、生命周期和幂等风险保留回归用例。
- [ ] 最终构建前增加正确的工作区元数据和源码别名，保持 Host 与 Client 编译器端面分离。

### 任务 2：持久任务管理与聊天动作

**文件：** `packages/schedule/asterhub-automation/package.json`、`tsconfig.json`、`tsdown.config.ts`、`src/index.ts`、`types.ts`、`schema.ts`、`store.ts`、`operations.ts`、`tools.ts`、`client.ts` 和定向测试。

**接口：** 类型化 Remote 命名空间 `automation`：preview、prepareOperation、commitOperation、list、get、runs、choices。Runtime 接收 `AutomationRuntimeHost`；面向模型的 `automation_manage` 不暴露用户确认票据，定时执行或其后代不能通过它修改任务。Desktop 读取 inspectLifecycle，并通过服务方法关闭准入。

- [ ] 将任务聚合持久化在版本 1 的 `asterhub-automation`；服务就绪前验证持久文件、排他所有者、记录身份及完整时间/限制。
- [ ] 实现按账号的预览、确认后创建/编辑、暂停/恢复、手动预留、停止、删除和符合条件的清理；使用预期修订、独立授权/规则版本和持久请求回执。
- [ ] 注册一个按 action 判别的聊天工具，在调用者轮次内处理用户审批/确认，并展示已持久任务结果。与 Client 共用管理实现。
- [ ] 为确认/账号变化、独立于历史保留的幂等、暂停清除待处理项、限制、损坏持久化和编辑冲突增加确定性测试。主执行者在集成时运行。

### 任务 3：新 Session 调度与恢复

**文件：** `packages/schedule/asterhub-automation/src/runtime-contract.ts`、`runtime.ts`、`execution.ts`、`timing.ts`、`tests/runtime.spec.ts`、`tests/timing.spec.ts`；需要时为 `packages/schedule/schedule/package.json` 增加 timing 导出。

**接口：** `AutomationRuntime(host)`、requestDrive()、stopRun(runId)、setAdmissionLocked(locked)、dispose()；`reserveAutomationRun(task, trigger, occurrenceAt, requestId, now, runtimeId)` 返回下一聚合状态和预留 Run。纯时间函数规范化、预览、解析和重新锚定六种时间规则，并保留 IANA/DST/Vixie 行为。

- [ ] 保留一个分段计时器；通过域管理 FIFO 预留并控制全局容量；队列/积压只保留最新错过的重复执行时机。
- [ ] 使用现有 Webhook 新 Session 模式：解析 preset/取得作用域，按固定身份创建，挂载 setup，安装模型选择，关联工作区和普通权限 preset，再提交有日志的 automation 输入。
- [ ] 在首次发布前注册执行来源和后代限制；观察持久 inbox 回执、轮次、审批配对、待处理用户问题投影、人工干预、错误和取消。
- [ ] 关闭输入归属，刷写结果证据，等待拥有的资源释放，再持久化终态；绝不将 idle/whenIdle 视为逐消息完成。停止、超时和账号切换取消待处理交互，不留下迟到的自动继续。
- [ ] 使用固定 Session 身份保守恢复保留的预留/执行；不自动重试不确定副作用；裁剪和手动请求均保留水位。
- [ ] 使用注入时钟和屏障增加确定性的边界/竞争用例；不用 sleep 判断就绪。

### 任务 4：账号安全执行

**文件：** `packages/account/account-sub2api/src/index.ts`，需要时增加账号生命周期 helper/类型、测试和所属 README 契约。

**接口：** 仅 Host 可用的 `automationIdentity(): Promise<AutomationAccountIdentity | null>`、`assertAutomationIdentity(identity): void`、`registerAutomationLease(identity, stop: () => Promise<void>): () => void`；生命周期对象 `{accountId: string, epoch: number}`。`asterhub-account/changed` 事件通知身份变化，不含凭据。lease 注册同步进行，并拒绝旧 epoch。

- [ ] 保存当前 identity/epoch，发布初始化状态，不暴露凭据。
- [ ] 清除或替换任何活动 token、用户或模型 key 前，推进 epoch 并阻止旧获取，等待所有旧定时执行取消和清理，再修改凭据并发布新身份。
- [ ] 覆盖 login、register/finishLogin、logout、auto-login 和服务器作废会话路径。失败保持拒绝，不将旧身份与新 key 部分配对。
- [ ] 定时作用域在请求前验证 epoch；注册的 lease 阻止在旧执行结束前替换 key。等待人工审批时，不持有长期全局锁。
- [ ] 增加有意义且确定的请求中切换、旧确认和身份变更中失败用例；不增加宽松后备。

### 任务 5：任务面板与直接表单

**文件：** 新增 `packages/client/ui-asterhub-automation` 的 Host 入口、Client 入口、页面/表单/详情、locales、CSS Modules、包元数据和定向组件用例。

**接口：** 导入共享浏览器安全类型/Client 投影，挂载 `@deepseek-ai/dsh-asterhub-automation/remote`，消费固定 automation 方法。Client 执行准备 → 明确摘要确认 → 提交，不使用 confirmed 布尔值。账号、模型和工作区选项来自 Host choices，不硬编码。

- [ ] 在 Plugins 后注册 `sidebar.panellist` 和 `main` 具名面板；主页面导航保留现有会话草稿、工作区和滚动位置。
- [ ] 展示当前所有者列表、搜索、状态筛选、详情/配置和历史，并链接真实结果 Session；错误不清空已知数据。
- [ ] 实现新建/编辑表单，包括名称、指令、时间规则、时区、工作区、模型和推理选择、条件模式字段和 Host 后三次预览；更新冲突保留草稿。
- [ ] 实现暂停、恢复、执行、停止和确认删除；应用级 Toast 跨导航保留，删除后执行/文件数据保持完整。
- [ ] 增加键盘、焦点、未保存草稿保护和自适应/明暗 token；最终集成时在真实 Desktop 界面评估。

### 任务 6：Desktop 内置组合与切换

**文件：** Desktop project-manager 和运行时元数据、desktop-host profile 入口/退出检查/更新控制/依赖，任何新增的 Desktop 专属 bundle 与 patch、包准备/扫描，以及定向启动/升级用例。

**接口：** 使用真实原生 Host/Client 名称、服务 `inspectLifecycle(): {armed: boolean; active: boolean}` 和准入锁。主执行者拥有共享根配置/别名；不编辑账号或新 Host/Client 包实现。

- [ ] 仅 Desktop（包含开发运行时）默认打包和挂载原生 Host/Client，不通过精选安装，也不加入通用 profile 默认值。
- [ ] 仅核对 Desktop 拥有的旧 Schedule Bundle 选择并写切换标记；保留其他包和数据，在任何自动分派前拒绝显式冲突的旧服务行。
- [ ] 退出警告查询全局原生任务状态；更新锁阻止新预留，关闭前等待活动执行结束；冷的原会话与原生任务无关。
- [ ] 在真实依赖、物化和解析图中包含必需模块、Typert 和 Client 产物，不只增加可见按钮。
- [ ] 增加升级/运行时验收，包含保留插件和中断切换；不声称透明支持降级。

### 任务 7：集成、证明与交付

- [ ] 生成工作区别名、引用、Typert 和 Client 产物；使用现有 pnpm 版本安装锁文件变更；验证精确 Host/Client 程序。
- [ ] 运行定向管理、时间、运行时、账号和 Desktop 回归，以及聊天创建/自动输入的有意义无 key 录制会话场景。
- [ ] 使用隔离数据和工作区启动真实 Desktop；展示 Plugins 下的入口、手动创建/详情/编辑/删除、重启保留和每次定时执行的新结果 Session。记录真实截图；只使用应用已配置且获准的凭据运行无害真实模型轮次。
- [ ] 验证安装/运行时载荷闭包；仅运行有依据的打包检查，不将未签名旧产物视为签名发布。
- [ ] 独立审查、处理发现，仅为已实现行为更新 README/JSDoc/升级/持久化/用户/交接文档，移除本次临时探测。不做无关清理，不删除既有用户数据。
