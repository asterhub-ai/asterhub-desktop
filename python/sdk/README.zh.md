# DeepSeek Harness Python SDK

[English](README.md) | 中文

用于通过 stdio 上按行分隔的 JSON-RPC 驱动 DeepSeek Harness 的 Python 子进程 SDK。安装 `deepseek-harness-sdk` 时，会同时安装当前平台上版本完全相同的 `deepseek-harness-runtime-bin` wheel 包。

```sh
python -m pip install deepseek-harness-sdk
```

## 启动运行时

Python SDK 没有独立的应用入口。它以 `--profile sdk` 启动内置的 `dsh` CLI（命令行界面）；所选 profile 负责 JSON-RPC 服务器、agent（智能体）组合、凭据、持久化、工具和关闭流程。

每次启动都必须显式指定 Harness home。请传入 `dsh_home`，或在子进程环境中提供非空的 `DSH_HOME`。SDK 刻意不会发现 `~/.dsh`。

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    dsh_home="/absolute/path/to/isolated-dsh-home",
    cwd="/absolute/path/to/workspace",
    provider="deepseek-official",
    model="deepseek-v4-flash",
    reasoning_effort="max",
    max_tokens=49_152,
) as harness:
    result = harness.run("Say hi.", session_id="example-001")

print(result.final_response)
```

`DeepSeekHarness` 延迟启动运行时，并在调用 `close()` 或退出上下文管理器前复用该进程。首次 profile 握手通过 `initialize_timeout_seconds` 使用独立的 30 秒默认上限；普通轮次在未设置 `request_timeout_seconds` 时仍不设上限。超时诊断会指明所选 profile，并包含保留的运行时诊断。`cwd` 是 agent workspace；`runtime_cwd` 独立选择子进程工作目录。两者都会在启动前转成绝对路径。`provider`、`model`、可选的 `reasoning_effort` 和可选的正整数 `max_tokens` 通过 JSON-RPC 初始化发送。`base_url` 与 `api_key` 会显式覆盖子进程环境中的 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_API_KEY`。

<a id="query-and-response"></a>
## 查询与接收

调用 `session.query(text)` 发送文本，再迭代 `session.receive_response()` 观察结果。`query()` 发送后即返回 `None`，不等待运行时路由或执行。运行时识别[支持的命令形式与 Desktop 别名](../../packages/sdk/server/README.zh.md#command-input)；未识别的输入保持普通文本。此 API 只接受文本字符串。`delivery="queue"` 是默认值；`delivery="steer"` 将普通提示词交给下一个 step。命令执行时机仍由命令决定。

`receive_response()` 按发送顺序领取下一次 query。它先等待路由响应，再逐个产出 `Notification`，最后产出一个终态值：普通提示词从收件箱回执到 idle 区间的 `RunResult`，或命令处理结束后的 `CommandExecution`。通知可以在开始接收前积累。不同接收器可以并行观察各自的 query，也可以在一个接收器等待期间发送另一个 `query()`。关闭未完成的迭代器只释放它自己的本地观察资源，不取消或回滚运行时操作。终态值产出前会释放资源。

`CommandExecution` 包含 `command_id` 和以 `kind` 区分的 `result`。成功结果可以包含 `text` 和 `source_event_seq`；错误结果包含 `text`。处理器错误返回 `kind="error"`；路由、协议和传输失败在接收时抛出。发送失败从 `query()` 抛出。`request_timeout_seconds` 限制路由响应的等待时间，不限制后续提示词活动；已经到达的响应在期限过后仍可接收。

完整 `sdk` profile 提供这些命令；默认 `sdk-minimal` profile 不提供命令执行能力。`/compact` 可能发起辅助模型请求，完成时不要求普通轮次或 idle 通知；空历史可以不生成摘要而成功返回。`run()` 对 slash 文本保留普通提示词语义。底层阻塞式 `HarnessClient.session_command(session_id, line)` 执行支持的命令名，不回退为提示词；permission preset 必须非空。另见[压缩示例](examples/README.zh.md#compact-a-full-sdk-session)。

`/permission <preset>` 委托给原生权限 handler。未知 preset 返回 `CommandExecution.result.kind="error"`，不改变权限状态。成功的变更属于该 Session：后续 query 和恢复保留该状态，其他 Session 保留各自状态，新 Session 使用配置的默认值。`DeepSeekHarnessConfig` 仍是启动输入，不是共享的实时状态镜像；命令不重写它或已保存的用户默认值。运行中改变审批策略可能注入通知并触发额外模型 step。另见[权限示例](examples/README.zh.md#change-session-permissions)。

`/plan` 进入计划模式，`/plan off` 退出，`/plan <message>` 进入后通过原生 steer 提交去除首尾空白的正文。返回的 `CommandExecution` 只表示命令完成，不表示规划或审查结束。需要普通活动结果时，可以先用 `/plan` 进入，再单独提交普通 query。组合输入则应在发送前订阅，并在保持问答处理器运行的同时使用 `session/wait`，见[计划示例](examples/README.zh.md#review-a-plan)。计划模式改变指导并渐进披露 `exit_plan_mode`，不修改权限设置。默认指导禁止编辑文件，包括计划文档；实际执行仍由沙箱控制。

`/goal` 显示当前目标；`/goal <objective>`、`edit <objective>`、`pause`、`resume` 和 `clear` 使用原生目标 handler。创建和恢复可在命令返回后启动自动轮次。发送前应订阅通知，观察终态 `goal/change` 操作，再调用 `session/wait` 等待可能的模型收尾回复。轮次之间的 idle 不代表目标完成。恢复的活动目标保持 disarmed，直到显式恢复。目标命令保留权限设置和启动配置。另见[目标示例](examples/README.zh.md#run-a-goal)。

<a id="client-approvals"></a>
## 自定义插件

持久自定义属于 `dsh` profile。使用运行时 wheel 包提供的 `dsh` 命令初始化随附的 SDK profile，并安装外部 bundle：

```sh
export DSH_HOME=/absolute/path/to/isolated-dsh-home
dsh --profile sdk --dump-default-config >/dev/null
dsh plugin --profile sdk add file:/absolute/path/to/my-plugin-bundle
```

`file:` 形式会把本地 bundle 安装到 profile 包树中，使其 peer import 可以到达内置安装后备。profile manifest（元数据清单）会记录已安装依赖与有序 bundle 层；`$DSH_HOME/profiles/sdk/cordis.patch.yml` 是持久用户 patch。只有管理外部包时，`dsh plugin` 才需要 `pnpm`。运行 SDK 不需要系统 Node.js。

对于单次调用的变更，可传入一个或多个 patch 文件。它们会转成绝对路径，并在 profile 层与 home patch 层之后按顺序传给 CLI：

```py
with DeepSeekHarness(
    dsh_home="/absolute/path/to/isolated-dsh-home",
    profile="sdk",
    patches=("/absolute/path/to/first.patch.yml", "/absolute/path/to/last.patch.yml"),
) as harness:
    result = harness.run("Make the requested code change.")
```

`profile` 可以选择另一个已存在的 profile，但该组合必须保留 `@deepseek-ai/dsh-sdk-app` 或另一个 `@deepseek-ai/dsh-sdk-jsonrpc-server` 配置项。配置错误会在 CLI 启动或 SDK 初始化时失败；不存在完整配置回退。`dsh_bin` 可以选择另一个 `dsh` 可执行程序，同时保持相同的 profile 语法。任意 argv 替换仅是内部 fake-runtime 测试适配器，不属于公开 API。

`provider` 选择指定 Cordis 组合所注册的提供方路由；`model` 是该适配器解析出的模型 ID。`reasoning_effort` 是该确切路由可选的非空适配器自有标识符；省略时保留模型自身的默认值。`max_tokens` 是一个可选的正整数，用于限制根 agent 及其进程内后代在每次请求中输出的 token 数量；省略该参数时，由提供方的默认行为决定输出上限。缺少适配器、模型不可用或推理强度不受支持时，初始化会在提示词运行前拒绝。压缩（compaction）摘要继续使用压缩插件单独配置的上限。内置默认组合注册 `deepseek-official`。自定义组合可以挂载 `llm-pi-ai`，在其中配置各提供方专属的凭据和端点，并选择 pi-ai 已安装 catalog 中存在的任意提供方／模型组合。

随附的 `sdk-minimal` profile 是独立显式配置树，而不是 `dsh-base` 上的 overlay。使用 `profile="sdk-minimal"` 选择它；普通 `model` 参数是唯一运行时模型选择，也适用于不在适配器建议目录中的模型 ID。它提供按平台选择的持久 shell、`read_image`、`working_directory`、本地执行、JSONL 会话和自动压缩。文本文件工具、设置、托管凭据、遥测、Web 工具与完整默认工具清单仍由独立的完整 `sdk` 与 `web` profile 提供。SDK 提示词文本不会执行 `/compact`。

## 结果与通知

`Session.run()` 的活动区间从提示词被持久 inbox 接收时开始，到整个 agent 下一次进入空闲状态时结束，并返回 `RunResult(session_id, final_response, finish_reason, events, notifications)`。`final_response` 是该区间内根会话最后提交的助手文本。`finish_reason` 是最后一个根会话 `turn/end` 的 `kind`，例如 `completed`、`max-tokens` 或 `error`；没有轮次结束时为 `None`。缺少字符串 `data.reason.kind` 的 `turn/end` 违反协议，并会抛出 `SdkProtocolError`。

`NotificationSubscription.next(timeout_seconds=...)` 限制单次本地通知等待，超时抛出 `TimeoutError`；省略参数则无限等待。超时不取消运行时工作，也不关闭订阅，后续调用仍可接收通知。

`HarnessClient` 会在运行时进程的整个生命周期内保留已发现的 subagent 谱系。在 `Session.run()` 期间，`RunResult.notifications` 与 `on_notification` 按协议顺序接收根会话和已知后代的通知。`RunResult.events` 只包含根会话事件，因此后代输出不会替换根响应。底层 `session_prompt()` 会立即返回已排队消息的 id；绕过 `Session.run()` 的调用方自行负责后续活动边界。

所选 home 保存 profile、插件与每个 profile 自有的持久资源。完整 `sdk` profile 使用其中的凭据、设置与会话存储；`sdk-minimal` 保存 JSONL 会话，将图片存储在 `$DSH_HOME/attachments/v1` 下，请求图片缓存位于 `$DSH_HOME/cache/attachments` 下。需要隔离这些资源时应使用新的 home；独立工作应使用新的会话 ID。同时复用 harness 与会话 ID 会延续持久对话和会话资源。

另见 [Python 教程](../../docs/user/guide/python-sdk.zh.md)、[可运行示例](examples/README.zh.md) 和 [运行时 wheel 包参考](../sdk-runtime/README.zh.md)。

`Session.get_working_directory()` 读取有效工作目录；`set_working_directory(path)` 修改目录并返回校验后的绝对路径。两者都可创建未知 Session，而不运行模型轮次。相对路径以该 Session 当前目录解析。起始目录元数据、权限与已有进程保持不变。底层客户端提供同名方法，并以 `session_id` 作为首个参数。
