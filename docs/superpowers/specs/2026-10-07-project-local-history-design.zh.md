# 项目级历史与便携附件设计

[English](2026-10-07-project-local-history-design.md) | 中文

## 摘要

AsterHub 将账号和机器配置放在默认用户目录 `.asterhub`，每个项目的会话与原始附件放在该项目 `.aster`。另一套安装选择复制来的项目时，发现已有数据、请求确认，再打开原会话；不依赖旧安装的用户目录或绝对位置。本设计已获准独立实现，最终主线集成另行决定。

## 数据归属

全局目录管理凭据、账号/模型配置、插件 profile、共享模型、可重建缓存及已登记项目位置索引。项目数据管理身份/名称、会话归属与顺序、pin/archive 状态、不可变 Session 代际以及显示/继续会话所需的原始附件字节。不从 `.aster` 导入凭据、可执行插件或机器 profile。

```text
~/.asterhub/                         account and machine data
project-X/.aster/project.json        portable identity and Session membership
project-X/.aster/sessions/            original JSONL/Zstandard generations
project-X/.aster/attachments/v1/      original files and normalized images
project-X/.gitignore                 .aster/ ignore rule
```

会话 provider 可在项目 sessions 根下保留已有 cwd 编码子目录。它们描述历史 header，不是项目身份或当前执行目录。不能仅为移除旧盘符/路径文本而重命名或改写会话代际。

## 身份和当前位置

经过验证的 UUID 是便携项目 ID。旧 Workspace UUID 在接纳时成为对应项目 UUID；登记器展示时对同一已验证 UUID 使用 WorkspaceId 品牌类型，保留已有工作区引用。本地 manifest 是项目身份和会话归属顺序的权威；本机索引只是位置/缓存，不是第二份权威会话数据。

每个会话记录不变的 SessionId 与经过验证的项目相对 cwd。相对目录使用 `/`，项目根可为 `.`，拒绝绝对路径、盘符前缀、NUL 和逃逸 `..`。当前执行 cwd 由相对目录与已确认的当前项目根组成；历史 SessionHeader.cwd 不变，便携会话的文件操作不用它。

全局定位器保存项目 ID、当前规范化根与绑定版本。同 ID/根重复打开幂等。旧根不存在且未活跃时，经确认可以重绑定；旧根仍存在或有活跃会话时，拒绝静默替换并报告位置冲突。不靠修改复制历史的 ID 创造独立项目。取消工作区登记只删本机登记，不删除 `.aster`。

## 持久化与运行时接入

项目路由 SessionPersistence 在隔离的 Cordis service scope 中复用现有 JSONL 后端，按需打开 `.aster/sessions`。非产品 profile 的 grouped 后端与只读旧迁移源仍为明确配置，不作为便携会话失败后的回退。裸 SessionId 只有归属不歧义时可寻址；重复归属明确冲突。绑定版本参与观察/缓存失效，移动后不复用旧路径缓存。

项目登记初始化独立于 SessionPersistence 和 WorkspaceRegistry，避免依赖环。工作区登记、会话创建/恢复/fork、query/list/follow/export、文件工具、shell/search/terminal/PTC/SSH、沙箱、指令和子 Agent 解析同一个当前目录。模型看到的目录由已有 system-message/request-context 机制记录，不引入未记录的 cwd 覆盖。

迁移和移动时，原 header、事件、继承截点、父子 ID 和已提交代际逐字节不变。当前读取方区分历史路径语法与本机执行路径：把旧 Windows/POSIX 绝对路径作为数据验证，不在旧外平台路径 realpath，只在当前本机目录执行。不覆盖或删除已发布代际和历史 codec。项目/工作区持久记录及可见行为变化需申报类型变化并附升级说明。

## 附件

附件 provider 使用明确的项目/会话 scope 读写。live 工具结果、prompt/file upload 的 scope 来自可信 Agent 或 Host Session 地址，不来自模型提供的路径。冷历史图片/文件访问按存储会话寻址 scope；归一化、转换、流式、去重与请求图片生成保持同一 scope。明确的非项目操作可用其全局 provider；便携项目缺失/离线不回退过去。

会话引用的原始内容寻址文件和归一化图片放在 `.aster/attachments/v1`；缩略图/请求变体可重建。旧迁移只遍历已声明的一方附件引用，必要字节缺失/损坏时明确失败。不把不透明插件 payload 猜成文件名，也不复制无关账号数据。共享旧对象复制并校验，不删除，防止影响其他项目。

## 发现和确认

目录选择后先只读检查，再登记或初始化。无项目元数据的目录属于新项目，除非存在对应旧全局历史。有效本地数据形成已有项目提案；本机已登记同 ID/根直接打开。空 `.aster`、损坏元数据、较新不支持版本、身份冲突、不可访问根和缺历史分别报告，不作为覆盖数据的理由。

弹窗标题“发现已有 AsterHub 项目”，说明历史和附件保留在选定目录，操作为“打开已有项目”和“取消”。可显示已验证的名称、会话数和最近活动。确认传递规范化根、项目 ID 与检查时摘要；Host 接纳前重复验证。取消不写入。旧历史接纳也须明确确认，复制校验和发布成功前保留源。

选择项目不执行 `.aster` 内容、不导入账号或插件、不自动执行旧工具调用。只读项目可显示已验证历史，并明确禁止写入。移动介质或目录缺失时保留不可用登记，不悄悄显示空历史或改用进程 cwd。

## Git 排除

创建项目数据前，让项目 `.gitignore` 排除 `.aster/`，保留已有字节、注释、换行及有效规则。不自动提交忽略文件。覆盖普通仓库、嵌套项目、linked worktree 和项目之后才初始化的 Git。AsterHub 自身仓库也忽略 `.aster/`。

已跟踪 `.aster` 必须单独检测；忽略规则不会取消跟踪。报告隐私风险，不把这类数据视为已受保护；未获明确批准不删文件、不执行 git rm --cached。不新增 Git 暂存/提交子系统；接入真实现有过滤点，并用 git status/git add -A 证明新会话与附件不会进入 Git。用户有意检查时仍可通过普通文件系统访问。

## 迁移和失败规则

默认根迁移与纯路径解析分离。显式配置和非空 DSH_HOME 保持权威。只有旧默认 `.dsh` 时，暂存复制、验证完整持久数据和内部链接、发布 `.asterhub`，不删除旧源。完成记录使重复启动幂等。两个独立非空根是可处理冲突，不逐文件覆盖合并。源变更、发布中断、不可读、活跃 writer 和外部链接危险均失败并保留恢复证据。

接纳项目时，发布便携 manifest 和登记之前，验证复制所有所属代际、顺序/pin/archive 元数据和引用附件。取得源所有权或要求其静止，不复制活跃写入尾后谎称迁移完成。中断后重试不重复 ID，不丢弃已提交目标。无 cwd 的旧系统会话保留并报告，不猜到选中项目。

## 验收和限制

完成需要正常 Host/Client 编译、定向行为/安全/生命周期测试、记录新根模型请求的 keyless 移动场景，以及真实目录选择/确认/取消/历史/附件检查。fresh-process smoke 使用独立 A/B home，复制 X，使旧 home/根不可用，在 B 打开原消息/图片/文件，继续同 SessionId，观察 B 下实际相对 IO 和子进程 cwd。覆盖 fork/subagent、索引重建、重复打开、重复身份、缺介质、只读和迁移中断。

第二台实体电脑和 Windows/macOS 矩阵只按实际执行结果报告，不把本机隔离 profile 当作实体电脑证据。本计划不授权自动合并、推送、发布、真实用户迁移、账号转移、新记忆引擎、全局定时任务转移、内部 dsh 包/CLI 改名或 Git 历史改写。
