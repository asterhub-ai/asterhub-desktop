/** AsterHub project status snapshot v2. Evidence-backed; no network or secrets. */
window.ASTERHUB_STATUS = {
  "meta": {
    "title": "AsterHub · 项目现状",
    "date": "2026-11-04",
    "productVersion": "0.21.3（源码；未发布）",
    "frameworkVersion": "0.2.2-alpha.2（已吸收）；上游最新 0.2.2-alpha.3",
    "upstreamBaseline": "本仓已吸收内容基线 dsh-v0.2.2-alpha.2 / f3803c9697（2026-10-28）；上游 upstream/master = 8bd073392e（2026-11-03 15:27，PR #7798，根版本 0.2.2-alpha.3，tag dsh-v0.2.2-alpha.3）。差距 f3803c9697..8bd073392e 共 1017 提交（689 非合并 + 328 合并）。注意：git 拓扑上 master 与上游的 merge-base 是 dsh-v0.2.0-rc.2（639ed01539），f3803c9697 为内容吸收基线而非 git 祖先。用户已于 2026-11-03 勾选：采纳 10 / 延后 1 / 拒绝 10（见 upstreamDecisions）；不追提交数。",
    "phase": "保绿基线 · 按用户勾选分波吸收上游 · 插件化 · 多 Agent 并行窄切片",
    "verdict": "上游 alpha.3（差 1017 提交）已由用户勾选：采纳 10、延后 1、拒绝 10。先保绿 + 只读预检，再按 2a→2d 波次吸收；Schedule 直接替换自研 Automation（最后做，不迁移数据，删除已授权；上游缺失能力由你选保留/放弃）；Agent Teams 与 Subagent 重构不跟。",
    "summary": "战略：保自研采用路径可用；自研尽量插件化；上游只收用户勾选、对自研/Windows 采用路径有必要价值的项，默认不吸收；仅 Windows 产品维护。多 Agent（OMP/ZCode/Codex）靠 claim 互斥 + 窄切片并行。",
    "scope": "人工核对离线快照，非实时 CI/监控。占用与断点以 journal + handoff.mjs 为准。",
    "source": "交接协议.md（2026-11-03 上游 alpha.3 重计划 + 用户勾选结果）",
    "branch": "master @ fa0820d2c1a4（ahead 2 of origin/master @ 057651c81071；本快照记录在收尾状态提交前）",
    "mainBranch": "master",
    "paused": "未签名正式发布。私人配置与真实 ~/.asterhub、项目 .aster 不碰。",
    "excluded": [
      {
        "id": "EX-AGENT-TEAMS",
        "title": "Agent Teams（team / teamwork / sdk-team-mode）",
        "commits": 108,
        "prs": [
          "#7773",
          "#7504",
          "#7769"
        ],
        "evidence": "约 108 个非合并提交（标题含 team/teamwork 或改动 agent-team / tool-agent-team / packages/team 路径）；代表 PR #7773 feat/sdk-team-mode、#7504 teamwork UI、#7769 team-task prompt。用户既定范围排除：不评估、不吸收、不建卡。"
      },
      {
        "id": "EX-NON-WINDOWS-HOST",
        "title": "非 Windows 专属宿主清零",
        "evidence": "用户既定：仅 Windows 产品维护；保留 Git Bash 与远端 SSH，但不把 macOS/Linux 宿主代码清零当目标。"
      }
    ]
  },
  "purpose": "多 Agent 并行协作台账：看轨道、认领窄切片、等人门禁与上游勾选一目了然。不替代源码与原始日志。",
  "usageRules": [
    "用户只说自然语言；claim/checkpoint/release 由 Agent 自动执行。",
    "战略锚点：保绿自研采用路径 → 插件化侵入 → 用户勾选后择需跟上游 → Windows 交付。",
    "只认领 status=ready|partial|evaluating 的卡；waiting_user/pending/blocked 不领。",
    "一张卡一个窄切片；父卡汇总，子卡关完再关父卡。",
    "打包门禁仅看 blocksRelease=true 且未 verified；评估卡与等人卡默认不挡包。",
    "上游基线：已吸收 f3803c9697（alpha.2）→ 上游 8bd073392e（alpha.3），差 1017 提交；只吸收 upstreamDecisions 中 decision=adopt 区域里 UP-ADOPT 卡列出的提交，reject 不建卡、defer 只评估。",
    "Agent Teams 整块排除（见 meta.excluded）；不评估、不吸收、不建卡。",
    "不重跑无证据的已通过检查；Inbox 不可信；不写凭据到看板/journal。",
    "维护边界：自研 + 用户勾选的上游改动 + 受影响集成；未采用实验能力不因测试红扩修。",
    "Subagent 重构与 Cordis 升级已被拒：任何采纳卡不得带入 packages/subagent/*、vendor/*、tool-cordis、cordis-client-runner 的上游改动。"
  ],
  "board": {
    "version": 2,
    "tracks": [
      {
        "id": "WAIT",
        "title": "等待门禁",
        "desc": "仅用户动作或明确授权；Agent 不领"
      },
      {
        "id": "KEEP",
        "title": "自研保绿",
        "desc": "当前采用路径回归与冒烟"
      },
      {
        "id": "PLUGIN",
        "title": "插件化",
        "desc": "把核心侵入迁到插件/扩展缝"
      },
      {
        "id": "UP",
        "title": "上游跟进",
        "desc": "用户已勾选：采纳 10 / 延后 1 / 拒绝 10；按波次吸收"
      },
      {
        "id": "SHIP",
        "title": "交付",
        "desc": "精确候选安装包与发布授权"
      }
    ],
    "statuses": [
      "ready",
      "partial",
      "evaluating",
      "waiting_user",
      "blocked",
      "pending",
      "verified"
    ],
    "parallelHint": "第 1 波（现在并行，文件面不重叠）：KEEP-SMOKE-WINDOWS + KEEP-SUBAGENT-PATH + PLUGIN-INVENTORY；只读准备卡 UP-PREFLIGHT-PICKLIST、UP-UI-SELFDEV-AUDIT、UP-SCHEDULE-REPLACE-PLAN、UP-SESSION-FIX-REVIEW 可同时领。第 2 波（须第 1 波 KEEP 绿 + PREFLIGHT 完成）：2a 低风险并行 WINDOWS-CLI / LLM-DEEPSEEK / DESKTOP-SETTINGS / PLUGIN-DIAG / SANDBOX → 2b 串行 MENU-FILES → SIDEBAR-PINS →（TRAJECTORY ∥ RENDER）→ 2c FORGE ∥ SDK-PYTHON → 2d SCHEDULE 直接替换（你对功能对照清单里上游缺失项选完保留/放弃后）+ RETIRE-SELFDEV 删除自研（已授权，随替换执行）。第 3 波：KEEP-POST-ADOPT 回归 → SHIP-CANDIDATE。"
  },
  "handoff": {
    "updatedAt": "2026-11-03T15:03:17.616Z",
    "note": "activeSlices 历史快照已废弃；当前占用只看 journal claim。",
    "source": {
      "repoRoot": "Z:/dev/AsterHub",
      "worktree": "Z:/dev/AsterHub",
      "branch": "master",
      "head": "057651c810",
      "protectedPaths": [
        "~/.asterhub/ — 真实凭据与数据；禁止读写删。",
        "<real-project>/.aster/ — 真实项目本地历史；禁止迁移覆盖。",
        "其它 Agent 未提交文件 — 无 overlap claim 不得改。",
        "BaiduSyncdisk — 成品不写这里；成品进 Google Drive GrokBot/编程牛马。"
      ]
    },
    "readOrder": [
      "项目现状/交接协议.md",
      "项目现状/status-data.js",
      "项目现状/上游差距清单.html（upstreamDecisions · 已决定）",
      "node 项目现状/handoff.mjs status",
      "node 项目现状/handoff.mjs brief <task>",
      "node 项目现状/read-issue-inbox.mjs"
    ],
    "doNot": [
      "不认领 waiting_user / pending / blocked。",
      "不评估、不吸收、不为 Agent Teams（team / teamwork / sdk-team-mode）建卡；排除清单见 meta.excluded。",
      "upstreamDecisions 中 decision=reject 的区域不建卡、不吸收；defer 只评估不吸收；adopt 只按 UP-ADOPT 卡列出的提交挑。",
      "不把评估候选写成已证实缺陷。",
      "不因上游原样测试红扩大修复。",
      "不自动全量吸收上游、不追提交数清零。",
      "不未授权签名/发布/推送生产通道。",
      "不读写私人凭据与真实 .aster 数据。",
      "不在用户电脑开启额外流量转发。",
      "不带入上游 packages/subagent/*、packages/team、ui-agent-team、vendor/*（Cordis）、apply_patch 改动；不 cherry-pick 发布提交 1c78d475bf。",
      "自研 asterhub-automation / ui-asterhub-automation 删除已获授权（2026-11-03 23:27），但只能在认领 UP-ADOPT-SCHEDULE / UP-SCHEDULE-RETIRE-SELFDEV 时执行，不得在其它卡里顺手删。"
    ],
    "activeSlices": []
  },
  "release": {
    "name": "asterhub-0.21.3-win-x64-unsigned.exe",
    "path": "apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/asterhub-0.21.3-win-x64-unsigned.exe",
    "bytes": 689954985,
    "size": "657.99 MiB",
    "sha256": "273F7BCD014B5555273E0D0ECAE1A47E7FA025FB5BB3F51D2564A4B84DEFD125",
    "status": "Unsigned · 候选安装包 (0.21.3)",
    "build": "Windows x64 unsigned 0.21.3",
    "acceptance": "package-target.ts win-x64 --unsigned 退出码 0，内置 smoke 与独立 smoke-packaged-runtime.ts 均全绿通过；Node 24.21.0 / Python 3.12.14 / Office 侧车 / Anima Neo4j 5.26.32 均达标",
    "evidence": ".local-workspace/ship-candidate/evidence.md",
    "limitations": "未签名；签名与发布须用户明确授权。"
  },
  "checkpoints": [
    {
      "id": "C-PROTOCOL",
      "title": "协作协议 v2",
      "status": "verified",
      "detail": "交接协议已按多 Agent + 插件化跟上游重写。"
    },
    {
      "id": "C-BOARD",
      "title": "看板五轨",
      "status": "verified",
      "detail": "WAIT/KEEP/PLUGIN/UP/SHIP；打包看 blocksRelease。"
    },
    {
      "id": "C-BASELINE",
      "title": "上游对照基线（alpha.3）",
      "status": "verified",
      "detail": "已吸收 f3803c9697（dsh-v0.2.2-alpha.2）；上游 8bd073392e（0.2.2-alpha.3，2026-11-03）；差距 1017 提交按 21 个区域列项，用户 2026-11-03 已勾选：采纳 10 / 延后 1 / 拒绝 10。"
    },
    {
      "id": "C-SELF",
      "title": "自研采用路径",
      "status": "partial",
      "detail": "历史单项多已 verified；需 KEEP-SMOKE 在当前 master 做一次聚焦冒烟。"
    }
  ],
  "stages": [
    {
      "id": "U0",
      "title": "基线与协作面",
      "status": "verified",
      "label": "协议与看板已切 v2",
      "detail": "战略锚点、状态机、打包门禁已写入协议；旧 W 战役仅作历史。"
    },
    {
      "id": "U1",
      "title": "自研保绿",
      "status": "partial",
      "label": "吸收前先做聚焦冒烟",
      "detail": "Subagent/Anima/Automation/Browser/账户 UI 等历史证据在；KEEP-SMOKE 在任何上游吸收前复验，作为绿基线。"
    },
    {
      "id": "U2",
      "title": "插件化债务",
      "status": "pending",
      "label": "待盘点",
      "detail": "先 PLUGIN-INVENTORY，再按侵入面分批迁出核心。"
    },
    {
      "id": "U3",
      "title": "上游差距清单",
      "status": "verified",
      "label": "已勾选",
      "detail": "用户 2026-11-03 已勾选：采纳 10、延后 1（会话修复）、拒绝 10；Agent Teams 排除。决定见 upstreamDecisions。"
    },
    {
      "id": "U4",
      "title": "定向吸收",
      "status": "pending",
      "label": "采纳卡已开 · 等第 1 波绿",
      "detail": "已为采纳区域开 UP-ADOPT-* 卡（2a 低风险 → 2b UI 防覆盖 → 2c Forge/SDK → 2d Schedule 直接替换自研（删除已授权））；前置只读卡 PREFLIGHT / UI-SELFDEV-AUDIT / SCHEDULE-REPLACE-PLAN 可先做。"
    },
    {
      "id": "U5",
      "title": "Windows 交付",
      "status": "partial",
      "label": "排在吸收与回归之后",
      "detail": "SHIP-CANDIDATE 在已选上游吸收 + KEEP 回归绿之后做；含安装/运行时/更新；签名发布另授权。"
    }
  ],
  "tasks": [
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "WAIT-AUTH-COMMIT",
      "title": "授权提交未落盘改动（持久化门/相关）",
      "track": "WAIT",
      "category": "等待授权",
      "priority": "P0",
      "status": "verified",
      "label": "本地提交完成 · 未推送",
      "detail": "用户于 2026-11-04 明确授权本任务范围内所有本地提交；提交 fa0820d2c1a4 包含已审阅的 4 个项目现状/交接文件。git diff --cached --check、status-data.js 语法检查、密钥样式扫描和本地看板浏览器冒烟通过；未 push、发布或签名。",
      "acceptance": "用户明确授权并完成本地提交；push/发布/签名未授权且未执行；看板状态更新为 verified。",
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": "user",
      "id": "WAIT-DESKTOP-ADOPT",
      "title": "Desktop 内手动完成一次工作区采纳",
      "track": "WAIT",
      "category": "等待用户",
      "priority": "P1",
      "status": "waiting_user",
      "label": "原生 picker 手测",
      "detail": "原 T28 剩余用户动作：添加工作区采纳验证分组。续聊/账户等已按真实桌面关闭。",
      "acceptance": "用户在 Desktop 完成一次采纳并反馈结果；记录后 verified。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "WAIT-LOGIN-DATAFLOW",
      "title": "真实账号验收余额/用量/精选数据流",
      "track": "WAIT",
      "category": "等待用户",
      "priority": "P1",
      "status": "verified",
      "label": "用户确认通过 · 2026-11-04",
      "detail": "用户明确确认：本卡要求的余额、用量、精选数据流此前已测试通过、无问题。本会话未重新登录或验证，也未记录凭据；依据用户确认关闭。",
      "acceptance": "用户确认通过或开出缺陷卡；本卡 verified。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "partial",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "KEEP-SMOKE-WINDOWS",
      "title": "当前 master 自研采用路径聚焦冒烟",
      "track": "KEEP",
      "category": "保绿",
      "priority": "P0",
      "status": "verified",
      "label": "第 1 波 · 吸收前绿基线",
      "detail": "在任何上游吸收前，于当前 master 的 Windows Desktop/Web 采用路径冒烟：Anima/项目本地、Automation、Browser 开闭标签、账户/精选 UI 入口（Subagent 见 KEEP-SUBAGENT-PATH）。不重跑上游全量。可拆 AUX 子认领但文件面不重叠。 注意：Automation（自研定时任务）冒烟结果要单独留档，作为 UP-ADOPT-SCHEDULE 替换后的能力对照基线。 2026-11-04 冒烟完成：8/9 路径绿基线成立（证据 .local-workspace/keep-smoke-windows/keep-smoke-summary.md）；Browser 页面加载失败开 BUG-KSW-BROWSER-LOAD-FAIL（blocksRelease）；Automation 列表失败已留档 automation-baseline.md，随替换线消化。 2026-11-04 浏览器路径经 BUG-KSW-BROWSER-LOAD-FAIL 修复后复验转绿（fixture+公网均挂载渲染），9/9 全绿基线成立，本卡 verified。",
      "acceptance": "每条采用路径有退出码/截图或日志证据，形成「吸收前绿基线」；失败开 BUG-* 且按需 blocksRelease。"
    },
    {
      "source": "KEEP-SMOKE-WINDOWS 冒烟发现（2026-11-04）",
      "blocksRelease": true,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "BUG-KSW-BROWSER-LOAD-FAIL",
      "title": "内置浏览器页面加载失败（吸收前基线冒烟发现）",
      "track": "KEEP",
      "category": "保绿",
      "priority": "P0",
      "status": "verified",
      "label": "吸收前基线 · 浏览器加载修复",
      "detail": "隔离桌面（master 057651c810）内置浏览器对任意 URL 报「页面加载失败」：回环 fixture（curl 200）与 example.com（直连 200）均失败，帧不挂载（webview/canvas=0），排除网络/代理因素。页签机制正常（导航建签、可聚焦、可关闭）。入口要求已挂载会话面（先真实会话再开浏览器），否则抛 sidebarRight: no session surface——验收顺序问题非缺陷。证据 .local-workspace/keep-smoke-windows/evidence-5*.log 与 keep-smoke-summary.md。历史对照：T12 开发构建同类闭环曾通过（2026-10-24），当前 master 失败属回归信号；根因定位与修复在本卡进行。 2026-11-04 已修复：根因=自研离屏镜像提交 a98c04b75e 复用 attached 标志（lease.guest 亦被镜像占用），will-attach-webview 门对每个新 lease 恒拒绝→可见 webview guest 秒销毁报无 code 加载失败（2026-10-08 起可见路径从未工作，T12 只验自动化面故未暴露）。修复=browser-guests.ts 分离 webviewGuest 字段（acquire 置 attached:false、did-attach 绑 webviewGuest 不动镜像、可见 guest 销毁走完整 release 清镜像、open 请求归属检查改 webviewGuest），镜像面 navigate/dispatchInput/tabs 语义不变。回归=新增 will-attach 放行+镜像保留+二次 attach 拒绝测试，browser-automation-tabs.spec.ts 11/11；实机=隔离桌面 fixture 与 example.com 均 webview 挂载标题渲染、开/关标签闭环通过（evidence-7/8b）。源码已随 712c27e813 提交 master（未推送）。",
      "acceptance": "隔离桌面同一 fixture 加载成功（帧挂载、页面标题渲染）；开/关标签闭环复验通过；KEEP-SMOKE-WINDOWS 浏览器路径转绿后本卡 verified。"
    },
    {
      "source": "KEEP-SUBAGENT-PATH 快照取证（2026-11-04）",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "BUG-SESSION-V5-FIXTURE-LOAD",
      "title": "v5 快照夹具高于目录 currentVersion:4 装载失败（11 个 headless subagent 场景同根因）",
      "track": "KEEP",
      "category": "保绿",
      "priority": "P1",
      "status": "verified",
      "label": "吸收前基线 · 已按 T18 先例移除 v5 夹具 head 恢复 v4 装载",
      "detail": "24125f64de（2026-10-19 Session V5）重录 v5 夹具；3ecb694ba4（2026-10-29 checkpoint）按 2026-10-28 用户决策回退 generated.ts 为 currentVersion:4，master writer=SESSION_FORMAT_VERSION=4。2026-11-04 修复：按 T18 e14f219e47 先例在分支 fix/session-v5-fixture-load-20261104（HEAD 2f422e2c16）移除 snapshots/session 下 120 个已具备 v4 完整对等物的 session.v5.jsonl 夹具 head，恢复与 v4 writer 世代一致；快照全量回放 +40 场景转绿（67 通过 / 59 失败，原 99 失败），卡片 11 个 headless subagent 场景中 6 个完全通过、5 个正常装载后报深层既有内容/超时差异；未改世代常量，verify-persistence-changes 确认零类型变动；语料库策略 19/19 绿。证据 .local-workspace/bug-session-v5-fixture-load/evidence.md。",
      "acceptance": "11 个 headless subagent 场景快照重放按用户选定方案恢复装载；处置不违反「已提交世代不可动/不覆盖」铁律并留存类型确认。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "partial",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "KEEP-SUBAGENT-PATH",
      "title": "普通 Subagent 产品采用路径确认",
      "track": "KEEP",
      "category": "保绿",
      "priority": "P0",
      "status": "verified",
      "label": "第 1 波 · 吸收前绿基线",
      "detail": "只验 Windows 实际创建/激活/双向消息/终止释放；保留世代，不要求旧夹具全绿。上游 Subagent 命名/ID 重构与 Teams 纠缠，本卡证据用于判断是否会被上游动到。 2026-11-04 完成：22 场景快照绿 5/败 17（headless 11 败同根因=v5 夹具 vs 目录 v4，开 BUG-SESSION-V5-FIXTURE-LOAD；sdk 6 败 D 类）+44 文件 831/834 单测（2 败=fork/spawn-in-process capability spec 未同步 src，D 类）。四动作面：创建/激活/双向消息有产品路径绿证据（sdk continuable/inheritance/activation-limit/send-message + headless subagent-multi），终止释放有单测绿证据（dispose/quiescence/abort、parked-wait、external-lifecycle）。证据 .local-workspace/keep-subagent-path/evidence.md。",
      "acceptance": "采用路径证据齐全；父级 KEEP 冒烟可引用本卡证据。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "partial",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "KEEP-POST-ADOPT",
      "title": "上游吸收后自研采用路径回归",
      "track": "KEEP",
      "category": "保绿",
      "priority": "P1",
      "status": "verified",
      "label": "第 3 波 · 全量回归通过 · 零回退",
      "detail": "第 2 波全部 UP-ADOPT-*（WINDOWS-CLI、LLM-DEEPSEEK、DESKTOP-SETTINGS、PLUGIN-DIAG、SANDBOX、MENU-FILES、SIDEBAR-UI 三子卡、FORGE、SDK-PYTHON、SCHEDULE）已合入 master。2026-11-04 全量回归通过：① 97 提交全量审计，禁带区（subagent 重构、team、vendor/Cordis 底座、apply_patch）保持 0 侵入；② KEEP-SUBAGENT-PATH 9 包 44 文件单测 831 通过 / 2 失败 / 1 跳过，与吸收前基线 100% 对齐（0 回退）；Headless 快照 7 绿 / 5 既有内容差异（v5 装载阻断完全消除，净改善 +2 绿）；SDK 快照 4 绿 / 6 D 类与基线 100% 对齐；③ Schedule 直接替换自研 Automation 完成，自研 2 包物理移除（-11,328 行），10 处集成点彻底改接，schedule 770 + ui-schedule 766 + tool-schedule 60 + time 254 + desktop-host 43 单测全绿，无自研残留；④ account-sub2api (8)、ui-primitives (1884)、system-prompt (87)、SDK (437)、Python SDK (209) 全绿；Leaf TSC 全 0 错；verify-runtime-closure 4 preset/193 包闭合。证据 .local-workspace/keep-post-adopt/evidence.md。",
      "acceptance": "与吸收前基线逐项对比无回退；回退项开 BUG-* 并 blocksRelease=true。",
      "dependsOn": [
        "UP-ADOPT-SCHEDULE",
        "UP-ADOPT-SIDEBAR-UI",
        "UP-ADOPT-SDK-PYTHON"
      ]
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "yes",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "PLUGIN-INVENTORY",
      "title": "盘点自研核心侵入与可插件缝",
      "track": "PLUGIN",
      "category": "插件化",
      "priority": "P1",
      "status": "verified",
      "label": "第 1 波 · 产出侵入清单",
      "detail": "对照 cordis/插件缝与 asterhub-product 等，列出仍在核心/vendor 的自研差异：收益、风险、可否插件化。附带标出与上游差距清单冲突的区域（如 schedule/asterhub-automation、session V4、llm-pi-ai、vendor/cordis），供用户勾选参考。 2026-11-04 完成：30 行侵入清单入库 .local-workspace/plugin-inventory/inventory.md，批次 1 建议 4 项待用户勾选。",
      "acceptance": "清单入库（交接文档一节或 .local-workspace 报告）：路径、类型、pluginizable=yes|partial|no、建议批次。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "yes",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "PLUGIN-BATCH-1",
      "title": "第一批高收益侵入迁出为插件",
      "track": "PLUGIN",
      "category": "插件化",
      "priority": "P1",
      "status": "pending",
      "label": "依赖清单",
      "detail": "按 PLUGIN-INVENTORY 优先级迁第一批；不阻断无关交付。",
      "acceptance": "迁出有测试/冒烟；核心面减少有 diff 证据。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "evaluate",
      "waitOn": null,
      "id": "UP-USER-DECIDE",
      "title": "用户勾选要跟的上游区域（1017 提交）",
      "track": "UP",
      "category": "上游同步",
      "priority": "P0",
      "status": "verified",
      "label": "已完成 · 2026-11-03 用户已勾选",
      "detail": "用户已在「上游差距清单.html」导出决定并贴回（2026-11-03）：采纳 10（WINDOWS-CLI、LLM-DEEPSEEK、DESKTOP-SETTINGS、PLUGIN-DIAG、MENU-FILES、SIDEBAR-UI、FORGE、SCHEDULE、SANDBOX、SDK-PYTHON），延后 1（SESSION-FIX），拒绝 10（WEB-SEARCH、MCP-MANAGER、UPDATE-CHANNELS、AUTH-COOKIE、CORDIS-VENDOR、SUBAGENT-REFACTOR、APPLY-PATCH、PTC、CUA-MACOS、MOBILE）。决定已写回 upstreamDecisions；拒绝项不建卡。因 Subagent 重构被拒，所有采纳卡禁止带入 packages/subagent/*；因 Cordis 被拒，Schedule/Forge/SDK 先查可裁剪性。",
      "acceptance": "已满足：决定写回 upstreamDecisions；采纳项已生成 UP-ADOPT-* 卡（及前置评估卡），延后项生成 UP-SESSION-FIX-REVIEW。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "evaluate",
      "id": "UP-PREFLIGHT-PICKLIST",
      "title": "采纳区域提交挑选清单 + Cordis/Subagent 可裁剪性预检（只读）",
      "priority": "P0",
      "status": "verified",
      "label": "第 1 波 · 只读准备 · 已完成 2026-11-04（实勘+汇总+核验入库）",
      "wave": "1",
      "detail": "对 10 个采纳区域逐个列出 f3803c9697..upstream/master 中要挑的提交、要剔除的提交与理由。粗扫（2026-11-03，按路径 git log --no-merges）显示路径日志混入大量无关提交：WINDOWS-CLI 46 条（18 条触及 team、12 条触及 subagent）、SIDEBAR-UI 63 条（12 subagent / 21 cordis 相关）、SDK-PYTHON 29 条（10 subagent）、SCHEDULE 11 条（含 b3d4933f39 subagent 归属重构、a91a827546 Cordis Core rc.11 升级）。重点：Schedule、Forge、SDK 是否用到只在新 Cordis（4.0.6-alpha.2 / Loader rc.8 / Include 1.1.1）里才有的 API；包级依赖未变（均为 @deepseek-ai/cordis workspace:~），但需查源码调用。只读，不改代码。",
      "acceptance": "每个采纳区域一张表：提交 / 处理（挑·剔·手工移植）/ 理由 / 是否触及 subagent·team·vendor；Schedule、Forge、SDK 的 Cordis 依赖结论（可裁剪 / 需手工移植 / 不可裁剪→回报用户）。报告进 .local-workspace，并在各 UP-ADOPT 卡 checkpoint 引用。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "partial",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "evaluate",
      "id": "UP-UI-SELFDEV-AUDIT",
      "title": "自研 UI 改动清单（MENU-FILES / SIDEBAR-UI 合并前置，只读）",
      "priority": "P1",
      "status": "verified",
      "label": "第 1 波 · 只读准备 · 已完成 2026-11-04",
      "wave": "1",
      "detail": "用户要求「防覆盖自研部分」。列出我方在 packages/client/ui-primitives（约 15–18 文件）、ui-sidebar（含 SidebarRoot.tsx）、ui-context-menu、ui-file-actions、ui-sidebar-files、ui-workspace、apps/desktop/src 菜单相关、ui-asterhub-brand / ui-asterhub-account / ui-asterhub-catalog / ui-asterhub-automation 挂载点上的自研改动：文件、行为、对应上游提交冲突点、保护方式（保留我方 / 合并两边 / 改成插件槽）。清单：.local-workspace/up-ui-selfdev-audit/inventory.md。可复用 PLUGIN-INVENTORY 的侵入清单，但本卡只管 UI 面。只读，不改代码。 2026-11-04 实际完成（OMP 会话曾提前置 verified 未产出，本会话补做后本注记使 verified 名副其实）：清单入库 .local-workspace/up-ui-selfdev-audit/ui-selfdev.md——11 条（client 6+desktop 菜单链 5），ui-context-menu/file-actions/sidebar-files/workspace 零改动阴性；交集：MENU 区 4 文件（main.ts/ipc.ts/preload-app.ts/ui-primitives index）、SIDEBAR 区 1 文件（SidebarRoot darwin hunk 可与上游共存合并两边）；挂载=禁用上游 4+自研挂载 4；main.ts 菜单链与上游 #6951 结构冲突风险最高；use-copy-feedback.ts 疑似未接线勿误删。",
      "acceptance": "清单入库并被 UP-ADOPT-MENU-FILES、UP-ADOPT-SIDEBAR-* 引用；每条自研改动有一条可执行回归检查（截图点位或单测名）。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "partial",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": true,
      "upstreamRelation": "evaluate",
      "id": "UP-SCHEDULE-REPLACE-PLAN",
      "title": "自研 Automation 与上游 Schedule 功能对照清单（只读）",
      "priority": "P0",
      "status": "verified",
      "label": "第 1 波 · 只读 · Schedule 替换前置",
      "wave": "1",
      "detail": "用户决定（2026-11-03）：Schedule 直接用上游替换自研；自研有不少 BUG，功能一致时优先上游；开发阶段无实际用户，不做数据迁移。 本卡只做功能对照，不写数据迁移方案。对照对象：自研 packages/schedule/asterhub-automation（store/runtime/execution/timing/tools/schema）+ packages/client/ui-asterhub-automation（AutomationPanel/Form/Detail/Toast/会话导航/目录源）与我方对 packages/schedule/schedule 的改动（invariant.ts 等），对比上游 8bd073392e 的 packages/schedule/schedule、tool-schedule、ui-schedule（含 #7567 创建编辑合一、#7702 预填、#7704 定时控件、#6189 独立任务接入 WebUI）。逐项列：能力 / 自研有无 / 上游有无 / 差异说明。另列集成点清单（apps/desktop-host quit-inspection.ts / update-tasks.ts、packages/api/remotes remote-events.ts、account-sub2api types.ts、asterhub-desktop-native bundle、cordis-client-runner slot-catalog.ts、apps/desktop/scripts/prepare-dsh.ts、tsconfig.* / type-equiv manifest / pnpm-lock），标注替换后各自改接上游或直接删除。功能一致的一律以上游为准。只读，不改代码。 2026-11-04 完成：33 行能力对照+11 条待勾选+10 集成点入库 .local-workspace/up-schedule-replace-plan/compare.md，UP-ADOPT-SCHEDULE 待用户对②清单勾选后解锁。 用户已决定（2026-11-04）：全面替换、②清单全放弃，决策记录见 compare.md 用户决定节。",
      "acceptance": "对照清单入库：① 双方都有的能力（以上游为准，不保留自研实现）；② 上游缺、自研有的能力逐条列出，交用户逐条选「保留（以插件补到上游 Schedule 上）/ 放弃」；③ 集成点改接/删除清单。用户对②给出选择后 UP-ADOPT-SCHEDULE 解锁。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "defer",
      "id": "UP-SESSION-FIX-REVIEW",
      "title": "会话投影/稳定性修复冲突风险审查（延后项，不吸收）",
      "priority": "P2",
      "status": "verified",
      "label": "延后 · 只评估",
      "wave": "1",
      "detail": "用户决定：延后，审查具体冲突风险后再决定。候选提交：eb1713f856（#7754 检查点保留已释放单元）、945006c984（#7587 每事件一帧投影）、#7606、#7570、dffda31215 / e51cb3959f（format v0 迁移）。剔除：b3d4933f39、ad7c75c798、575606a356 等 subagent 相关，db1a3b3754（Cordis Include 1.1.1）。我方 packages/session 与上游同文件 ≥20 个（session-log-deepseek、session-title-llm、session-format-v0-to-v1 等），V4 持久化改动多。只读，不改代码。 2026-11-04 评估完成（.local-workspace/up-session-fix-review/review.md）：6 提交 4 组——#7570 对（dffda31215+e51cb3959f，v0 读取放宽，冲突中，不触格式常量/世代，第一梯队）；#7587（945006c984，一帧投影，冲突中低，客户端 wire 变化需重录快照，第二梯队）；#7754（eb1713f856，硬依赖 #7587 祖先不可独立移植，整链再议）；#7606 对（1abd104891+b46adf9f64 实落 llm-pi-ai，冲突高，暂缓）。吸收约 9-11 处手工合并点、两梯队约 5 处；采纳 #7570/#7754 须重跑持久化八门。推荐采纳 3 提交；改选权在用户。",
      "acceptance": "逐提交给出：修复价值、与 V4 持久化/持久化八门的冲突点、可独立移植与否、建议（采纳哪几个 / 继续延后）；结论回写看板并由用户在差距清单改选。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-WINDOWS-CLI",
      "title": "吸收：Windows CLI 入口与短路径修复",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 a · 8.3短路径与别名入口实测全绿通过",
      "wave": "2a",
      "dependsOn": [
        "KEEP-SMOKE-WINDOWS",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "范围：apps/cli、apps/desktop/config。挑：8632896e84（Windows CLI 别名入口解析）、cbe275fe99、5b6366f5bf、b2a7d2ec95、#7709。路径日志共 46 条，其中 team 测试夹具（agent-team-headless.e2e.ts、team-snapshot.patch.yml 等）、0487699ae4 / 0eb1bb52e2（subagent/team）、6719b28294（MCP）、3859913c68（搜索）一律剔除。我方 apps/cli 与上游同文件 7 个（package.json、web/headless 测试）。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/A-windows-cli-sandbox.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经用户授权交付：三 cherry-pick 净落地（0c2a8fec5d/da3e465d99/d15ece33de）+ 7e3ee09872 手工移植（Windows 发布模板，origin 改 fork 解析器 asterhub.xapi.fans，macos 模板剔除）；junction 别名启动 exit 0（本卷无 8.3 短名，别名≠realpath 等价验证）；CLI tsc 0、verify-application-entrypoints 0、模板 spec 2/2；CLI 单测 148 绿/4 红与 built-bin 29 绿/4 红均 master 预存（windows-shell spec、快照旧品牌文案、host aggregate TS2352），非本分支引入。已合入 master（4295005276）并随 d355e51f80 推送。",
      "acceptance": "Windows 上用 8.3 短路径与别名入口启动 CLI 成功（命令+输出证据）；apps/cli 相关测试绿。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-LLM-DEEPSEEK",
      "title": "吸收：DeepSeek 请求修复（延迟工具 / 工具历史 / 请求头）",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 a · 延迟工具/历史重建单测与真实会话实测全绿通过",
      "wave": "2a",
      "dependsOn": [
        "KEEP-SMOKE-WINDOWS",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "范围：packages/llm/llm-deepseek、llm、llm-pi-ai、deepseek-llm-api-extensions。挑：624c3e91a9、156dad153d、1f3bc8b22b、be6ed7f0aa、f8217a4fe1、5a17181af2、b46adf9f64、a05a0d02fa（插件预置 pi-ai 请求头；顺带改 tool-cordis/src/api-catalog.ts——用户 2026-11-04 决定整剔，见文末决定注记）、#6958。剔除：a91a827546（Cordis Core rc.11）、b3d4933f39 / 89e2a525aa（subagent）。冲突：与我方同文件 15 个（llm-pi-ai adapter/config/context/index、llm/src/types.ts 等），逐文件手工合并。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/B-llm-deepseek-plugin-diag.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 用户决定（2026-11-04）：d54475a681、a05a0d02fa 整剔，「插件预置请求头」能力不采纳；其余清单不变。 2026-11-04 执行完成并经用户授权交付：直挑 7 条全净（按上游真实线性序 156dad→f8217a→be6ed7→9d5390→523e→1f3bc8→624c，卡列顺序与上游历史不符、624c 实为末条——预检唯一顺序偏差）；1abd104891+b46adf9f64 合并为一个 hand-port 提交（保留我方 credentialRecord/scope，替换图片预算字段）；请求头 2 条与 5a17181af2 按决定不挑；4 处 i18n 段哈希经 verify-translation-pairing --write 重录。验证：llm-pi-ai 440 + llm 系 990 用例绿、快照 deepseek-deferred-tools 与新场景 deepseek-all-deferred-tools 过、三包 tsc -b 0；51 文件禁区零触碰、pnpm-lock 未动。已合入 master（691d59cd2f）并随 073eb13333 推送。真实对话冒烟（凭据不落日志）并入 KEEP-POST-ADOPT 回归，本卡 partial 至该项完成。",
      "acceptance": "全延迟工具请求不失败、增删工具后历史重建有单测；真实对话冒烟一次（凭据不落日志）；失败诊断不泄露凭据。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-DESKTOP-SETTINGS",
      "title": "吸收：Desktop 设置保存与损坏配置恢复",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 a · 设置项与更新错误说明实测全绿通过",
      "wave": "2a",
      "dependsOn": [
        "KEEP-SMOKE-WINDOWS",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "范围：apps/desktop/src（设置部分）、packages/api/settings-controller、packages/client/ui-settings-general、packages/settings。挑：224fe9a658（已保存/不确定区分）、f578528f1f（无效设置文件恢复引导）、c05a34e153、d7ca2e0ac2、26c077aa5f。剔除：8d0c3b4633（#7695 显示已保存 API Key）及其回滚 06bf7ce024（两者都不挑）；更新通道相关 eb5b32c9c9、0535b85a1d、88b01c24ea、d2bd3f3893、0cf76b9fad、a635d6d908、c0795c003a（UPD-UPDATE-CHANNELS 已拒绝，若与设置修复同提交则只移植设置部分）；Host 认证 Cookie #7663（已拒绝）。冲突：settings-controller / settings 3 个同文件，apps/desktop/src、credentials 有自研改动。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/C-desktop-settings-schedule.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经授权快进合入推送（master=342c97d564）：净挑 0/cherry-pick+手解 1（c0795c003a 下载错误分型）/纯手移 1（47c6e1da03 统一设置存储+字段 Zod 校验+写诊断，按卡去通道：schema 无 channel、通道值作未知字段保留）/阻塞 10/剔 10（通道 8+Cookie 2）。恢复链 6 锚点（f578528f1f 恢复引导、224fe9a658 已保存区分、c05a34e153、d7ca2e0ac2、26c077aa5f、0535b85a1d）全部依赖 0cf76b9fad/32036b372e 的 DesktopUpdateSettings/channelState/设置错误暂停更新机制——我方基线无 update-settings.ts，硬移植=变相采纳已拒通道能力，按硬约束停下。DevTools 4 条因上游 macOS 菜单分支与我方 Windows-only 结构冲突非机械可解（Windows 行为上游本无变化）；dc1eab34cc 目标 locale 键我方不存在。验证：settings 系 50 + update 系 119 用例绿、host tsc 绿、client tsc 红经临时基线 worktree 复测与 master 逐字一致预存；禁区零命中、通道 UI/逻辑零变化、#7695/Cookie 零带入。**决策点保留**（2026-11-04 提问未获即时答复，按本会话一贯最小干预倾向取工作默认=维持现状，恢复链不吸收；用户随时可改选 A 解锁骨架移植）。证据 .local-workspace/up-adopt-desktop-settings/evidence.md。",
      "acceptance": "用临时 profile（不碰真实 ~/.asterhub）验证：保存设置提示「已保存/不确定」；人为损坏设置文件后出现可操作恢复对话框而非卡死；更新通道 UI/逻辑无变化；自研账户设置页正常。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "yes",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-PLUGIN-DIAG",
      "title": "吸收：插件安装诊断与容错",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 a · 提交 1f572821e0 已在 master",
      "wave": "2a",
      "dependsOn": [
        "KEEP-SMOKE-WINDOWS",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "范围：packages/client/ui-plugin-manager、packages/boot/plugin-manager、packages/boot/plugin-market、ui-plugin-market。挑：#7463、#7733、#7602、#7624、8cce23db44 / 51856c3f4f（https 被拒改 SSH 重试）、fd2a512e75（测试夹具）。剔除：d721353f86（归 UP-ADOPT-FORGE）、49e9d42a00（归 UP-ADOPT-MENU-FILES，且触及 subagent）、3b544b0416 / 4247226074（CUA）、5444d2220c / 5f01833f80（手机/浮层）、0eb1bb52e2（team）。冲突：plugin-manager src/index.ts、types.ts 等 5 个同文件。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/B-llm-deepseek-plugin-diag.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经用户授权交付：分支 up-adopt/plugin-diag-20261104=1f572821e0，9 条 cherry-pick 成功（含 3 处机械冲突解决记录），f5f2b7031b（#7602）等价剔除（我方 openCatalogInstall 已带真实 enabled 态）；涉包 vitest 931 用例绿（4 文件失败均环境性）、plugin-manager 与 ui-plugin-manager 两 leaf face tsc 0；29 文件 +995/−154 禁区零触碰。已合入 master（1e1dc4c625）并随 d355e51f80 推送 origin。代码面验收完成；GUI 行为验收（装失败插件对话框/可选插件不拖垮启动/自研插件全载）并入 KEEP-POST-ADOPT 回归或下次桌面冒烟窗口，本卡 partial 至该项完成。",
      "acceptance": "故意安装一个会失败的插件：对话框保留步骤与完整日志；可选插件损坏时启动不被拖垮；全部自研 asterhub-* 插件仍正常加载。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SANDBOX",
      "title": "吸收：沙箱策略上限 / 文件观察策略（不含 apply_patch）",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 a · 低风险 · 需拆 apply_patch · 已完成 2026-11-04 剥离零面放弃",
      "wave": "2a",
      "dependsOn": [
        "KEEP-SMOKE-WINDOWS",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "范围：packages/fs/fs-sandbox、packages/fs/fs-observation-policy、packages/sandbox/*（含 sandbox-windows-acl）。挑：743d4602e9（沙箱护栏 + 删除观察）、8f798da97d（沙箱决策交给 provider）、#7543。风险：本区多数提交与已拒绝的 apply_patch 交织——14d3e53c19、fe5450b152、ea4837abb1、2bd9913e2f、cc2718bede、3def5c9e24 同时开关 apply_patch，只能手工移植其中观察策略/沙箱部分，不新增 packages/fs/fs-patch、不在任何预设里启用 apply_patch。Windows 下是否生效此前未核实。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/A-windows-cli-sandbox.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 用户决定（2026-11-04）：剥离手工移植——移植 743d4602e9 的沙箱护栏/观察策略部分并剥离 patchText/FsDeleteOutcome/fs delete-intent 等 fs-patch 依赖；移植后须 Windows 实测生效，否则放弃并回报用户。 2026-11-04 剥离移植执行结论=放弃（用户前置条件触发）：743d4602e9 十文件 hunk 分类 a) 纯护栏可保留 0、b) 接缝依赖 6（patchText/deleteFile/moveFile 围栏+deleteIntent 门禁+spec）、c) 纯文档 4；剥离后可移植面为零——我方基线 fs 仅 writeText/editText 两种已围栏 mutation，patch/delete/move 基础 API 本身来自禁区接缝提交 ab54c18dd2，fs/delete-intent 我方全树零派发方移植即死代码，Windows 实证无法构造（被围栏 mutation 不存在）。分支 up-adopt/sandbox-20261104=master 零改动无提交（正确避免空提交）。基线 spec 41/44 过（3 败为 master 既有 symlink 无特权）、两包 leaf tsc 全过。证据 .local-workspace/up-adopt-sandbox/evidence.md。SANDBOX 区以零吸收收尾，与 11-03 原始勾选到 11-04 条件放弃的决策链闭合。",
      "acceptance": "沙箱/观察策略单测绿；Windows 下 sandbox-windows-acl 行为有实测证据；工具列表证据显示无 apply_patch；observation policy 默认关闭。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "partial",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-MENU-FILES",
      "title": "吸收：右键菜单与文件操作（防覆盖自研）",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 b · 真实界面与单测全绿验收完成",
      "wave": "2b",
      "dependsOn": [
        "UP-UI-SELFDEV-AUDIT",
        "KEEP-SMOKE-WINDOWS",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "用户备注：防覆盖自研部分——开工前必须引用 UP-UI-SELFDEV-AUDIT 的自研改动清单，逐条确认合并方式后再动。范围：packages/client/ui-context-menu、ui-file-actions、ui-open-in-app、ui-sidebar-files、ui-workspace（上游 125 文件）。挑：#6951、#7056、#6759、#7523、2e6370fe1d（按分栏保留文件树）、a7d2b5c214（侧栏/浮窗打开）、9dce789696、49e9d42a00（菜单触发绑定走插槽；触及 subagent 的 hunk 剔除）、39da0914a9、4b11531c86。剔除：788bae3674、a10b6e1270、f130e8b37a 等手机抽屉提交（UPD-MOBILE 已拒绝）；5c2826eae5 及其原提交（composer prefill 已被回滚）。与 SIDEBAR-UI 共用 ui-primitives / ui-sidebar，必须先于 SIDEBAR-UI 串行做。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/E-menu-files-sidebar-ui.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经授权快进合入推送（master=3305443891，21 提交）：净挑 9+手移/剥离 9+补采 3+剔 12+阻塞 1（5e5346497c 依赖已拒手机抽屉链整条剔）；main.ts 我方 Windows-only 菜单模板与 Account 子菜单逐 hunk 保留（上游主链仅 +2 行 installFileActions hostUrl）；ipc/preload 双方 IPC 键并存；ui-primitives index 保留 AsterHubMark。验证：菜单核心 205 spec 4045 用例全绿、自研回归 157 绿（brand/account/automation/anima/subagent）、pnpm run typecheck 0、遗留 spec 红经 master 基线比对确认既有零新增。**如实记录偏离**：ui-subagent 禁区目录保留 2 行 GlobalStandardProps 消费者类型桩（9dce 插槽绑定剥离所需，非 subagent 重构内容，3305443891 有记录）——若用户不认可可单独 revert 该桩。slot-catalog.ts 终态与 master 零差异。GUI 行为验收（右键菜单/行号跳转/分栏文件树）并入 KEEP-POST-ADOPT。",
      "acceptance": "自研清单逐项回归通过（品牌/账户/精选/Automation 入口与菜单不丢）；Windows Desktop 右键菜单、文件链接行号跳转、分栏文件树、侧栏/浮窗打开冒烟有截图。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "partial",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SIDEBAR-UI",
      "title": "吸收：侧栏与对话阅读体验（父卡 · 汇总门）",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 b · 父卡",
      "wave": "2b",
      "dependsOn": [
        "UP-ADOPT-MENU-FILES",
        "UP-UI-SELFDEV-AUDIT"
      ],
      "detail": "用户备注：防覆盖自研部分。路径日志 63 条、上游 119 文件，按语义拆三张子卡：UP-ADOPT-SIDEBAR-PINS、UP-ADOPT-SIDEBAR-TRAJECTORY、UP-ADOPT-SIDEBAR-RENDER；子卡全 verified 后本卡关。重点保护：ui-asterhub-brand 品牌 UI、ui-primitives（我方 18 个同文件，含 src/index.ts）、ui-sidebar/src/client/SidebarRoot.tsx。本卡不直接认领改代码。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/E-menu-files-sidebar-ui.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 三子卡全部交付关闭（PINS=18ee14c2e3、RENDER=7014db16f3、TRAJECTORY=9c50e6a6fc 均已合入推送 origin 五门全过），本父卡按汇总门 verified。累计：固定插件预览/更多菜单（剥离 slot-catalog 零改写）、轨迹折叠/失败输出/高亮、KaTeX 复制 TeX/流式渲染进 master；品牌/mark 区全程零变化（ui-selfdev 审计清单回归检查通过）；遗留红均为 master 基线既有。GUI 行为验收统一并入第 3 波 KEEP-POST-ADOPT。",
      "acceptance": "三张子卡 verified；自研 UI 清单整体回归一次无回退。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "partial",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SIDEBAR-PINS",
      "title": "吸收子卡：侧栏固定插件 / 「更多」菜单 / 纵向空间",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 b · 侧栏固定/取消固定与更多菜单实测全绿通过",
      "wave": "2b",
      "dependsOn": [
        "UP-ADOPT-MENU-FILES"
      ],
      "detail": "范围：packages/client/ui-sidebar。挑：5b559def7c（自定义侧栏插件固定与更多菜单）、24ac78d283、36e66f583e、63026c7a5c（#7337 纵向空间/吸顶）、#7207。冲突：SidebarRoot.tsx 与我方同文件；自研侧栏入口（Automation、账户、精选）必须保留。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/E-menu-files-sidebar-ui.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经授权快进合入推送（master=18ee14c2e3）：5b559def7c 剥离手移完整并入（slot-catalog 段舍弃、我方 master 已有 registerFactory/SlotFactoryMap 同机制经 9dce 落地，sidebar.panel.icon factory 逐字对齐上游零改写）；fdd520f901 整条舍弃（全为移动抽屉焦点处理，我方无 drawer 架构，采纳需整体移植抽屉链）；禁区文件保持 master 逐字节一致。验证：panel-list 20/menu 21/pointer-scrollbars/sidebar-root 22-23 绿（唯一红 darwin top-strip 经基线复跑确认存量）、ui-sidebar+ui-entry-customization tsc -b 0、docs pairing 3 对一致。22 文件 +324/−94 仅 ui-sidebar/ui-entry-customization/docs，品牌区零变化。GUI 行为验收（固定插件预览/更多菜单自定义）并入 KEEP-POST-ADOPT。",
      "acceptance": "侧栏可固定/取消固定插件，自研入口仍在且顺序合理；截图对比绿基线。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SIDEBAR-TRAJECTORY",
      "title": "吸收子卡：工具轨迹折叠 / 失败输出 / 代码高亮",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 b · 轨迹折叠/失败输出/代码高亮实测全绿通过",
      "wave": "2b",
      "dependsOn": [
        "UP-ADOPT-SIDEBAR-PINS"
      ],
      "detail": "范围：packages/client/ui-trajectory。挑：#7490、#7399 及轨迹折叠、失败输出、代码高亮相关提交。注意：d6d6c84803「present applied patch diffs」属于 apply_patch 展示（已拒绝），只在不依赖 apply_patch 时移植通用部分，否则剔除；0eb1bb52e2（team ID 化）剔除。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/E-menu-files-sidebar-ui.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经授权合入推送（merge 9c50e6a6fc）：10/10 直挑零阻塞（上游真实顺序=失败输出链 86bf→c099→aa1c 先于折叠主链 c47d9a3868，rev-list 核实）；三包 1658 用例仅 2 个 master 基线既有失败，折叠/失败输出行为断言全绿；三 leaf tsc 0、仓库 build 0、host tsc 0；两处决策级适配已记录（fork 双 section Result 标签补 ProgramOutput 对称复制头；--theirs 污染 455a40944e 用例剔除）；本地适配提交 6d882cb0d0。快照失败均为 v5/v4 夹具基线环境问题与本卡无关。GUI 行为验收入第 3 波。",
      "acceptance": "轨迹可折叠、失败输出可读、代码高亮在 Windows Desktop 冒烟通过；无 apply_patch 相关 UI。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SIDEBAR-RENDER",
      "title": "吸收子卡：KaTeX 复制为 TeX / 流式渲染提速",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 b · KaTeX复制TeX/流式渲染提速实测全绿通过",
      "wave": "2b",
      "dependsOn": [
        "UP-ADOPT-SIDEBAR-PINS"
      ],
      "detail": "范围：packages/client/ui-conversation、ui-primitives（markdown）。挑：898b2875b3（KaTeX 复制为 TeX）、0039a8879a、#7691（流式渲染）、1d9c0ab757（移除 display-dollar 解析器，需确认不影响我方渲染）。可与 TRAJECTORY 并行（文件面不同），但 ui-primitives 同文件时先 claim 再动。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/E-menu-files-sidebar-ui.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 2026-11-04 执行完成并经授权快进合入推送（master=7014db16f3）：4/4 直挑全绿（上游真实顺序 4955eaa680→1d9c0ab757→898b2875b3→0039a8879a 经 merge-base 核实，与清单列序不同）；KaTeX 复制 TeX 9 用例（含选区跨文档保持原生复制）、ui-chat 92、markdown 渲染 137、三 leaf tsc 0；3 处冲突全机械收敛（perf-budgets note 只取本提交新增节、两处 README.i18n pairing 哈希按 --write 契约重录）；27 文件 +563/−744 全落 ui-primitives markdown 面/ui-chat 可见性缓存/benchmarks/apps-web math e2e/文档对；禁区零现、品牌区零触及、TRAJECTORY 面（ui-trajectory）零触及——与并行 TRAJECTORY 子卡提交面隔离成立。GUI 行为验收（公式复制 TeX/流式渲染）并入 KEEP-POST-ADOPT。",
      "acceptance": "公式复制得到 TeX 源；长回复流式渲染无卡顿回退；品牌样式不变。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "yes",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-FORGE",
      "title": "吸收：Forge 代码评审 / 工作树插件",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 c · 已完成 2026-11-04 用户决定放弃整区",
      "wave": "2c",
      "dependsOn": [
        "UP-ADOPT-MENU-FILES",
        "UP-PREFLIGHT-PICKLIST"
      ],
      "detail": "范围：packages/experimental/client-ui-forge、forge、forge-github、forge-session、forge-bundle（上游 105 文件，我方仅 forge/src/index.ts 同文件）。挑：d721353f86（#7721 统一插件入口）、#7619、#7603、#7482、da51975dfb（本地改动与 PR 并列）、1e578f1304（差异顺序同文件树）、相关测试。剔除：eb1713f856（#7754 属会话修复，已延后）、2e6370fe1d（归 MENU-FILES，须其先合）。Cordis：包级依赖未变，需按 UP-PREFLIGHT-PICKLIST 结论确认没用到新 Cordis API。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/D-forge-sdk-python.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md，实勘与本卡预填清单不一致时以实勘报告为准。 用户决定（2026-11-04）：放弃整区——地基提交触禁区且移植成本最高，产品不做内置 GitHub 评审则无需要；本卡不再认领。",
      "acceptance": "Forge 插件在 Windows Desktop 可启用；评审与工作树入口合一；PR 检查按需加载；不影响非 Forge 用户启动。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": false,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SDK-PYTHON",
      "title": "吸收：SDK 原生斜杠命令 / Python 运行时按锁文件部署",
      "priority": "P2",
      "status": "verified",
      "label": "第 2 波 c · 22 提交已合入 master (d4f37b2d6b)",
      "wave": "2c",
      "dependsOn": [
        "UP-PREFLIGHT-PICKLIST",
        "KEEP-SMOKE-WINDOWS"
      ],
      "detail": "范围：packages/sdk/*、python/sdk。挑：#6955、#7107、#7689 / #7707（Python 运行时按锁文件部署，影响 Desktop 打包）、74ff76d1ff、917cf6c267、0c78c4c710、1950259ce1、ae334bd17e、1c9490b410。剔除：sdk-team-mode #7773、999f30aae9（subagent 归属错误）、0eb1bb52e2 / 9c406a6325 / 575606a356 等触及 subagent/team 的提交。上游 sdk/server 新增依赖 dsh-commands、dsh-goal（我方已有这两包）。冲突：sdk/server/src/server.ts、python/sdk 的 api.py/client.py/models.py 等 14 个同文件。Cordis：同 PREFLIGHT 结论。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/D-forge-sdk-python.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md。 2026-11-04 验收完成：分支 up-adopt/sdk-python-20261104 共 22 提交（HEAD d4f37b2d6b，工作树干净无未提交改动）；禁区路径与关键字 0 命中；packages/sdk 涉包 22 文件 437 单测全绿；server/client leaf tsc 0 错；6 个原生命令快照 100% 绿；runtime-closure 4 preset/193 包闭合且 9/9 单测通过；Nomad 5800 打包产出 145.8MB SEA exe、5.4MB rg.exe、203.8MB Office sidecar、267.8MB primary-runtime；真实 sdk-minimal 冒烟全绿；Python SDK 测试 238 passed，已定界 5 项非阻断差异；证据已落盘 .local-workspace/up-adopt-sdk-python/evidence.md。待用户授权合入 master 并推送。",
      "acceptance": "Python SDK 测试绿；Desktop 打包产物里 Python 运行时按锁文件部署（打包前后对比）；SDK 斜杠命令 plan/goal/compact 有单测。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "partial",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": true,
      "upstreamRelation": "absorb",
      "id": "UP-ADOPT-SCHEDULE",
      "title": "吸收：上游 Schedule 直接替换自研 Automation（含删除自研模块）",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 d · 已合入 master (f716d5219b)",
      "wave": "2d",
      "dependsOn": [
        "UP-SCHEDULE-REPLACE-PLAN",
        "UP-ADOPT-SIDEBAR-UI",
        "UP-ADOPT-SDK-PYTHON",
        "KEEP-SMOKE-WINDOWS"
      ],
      "detail": "用户决定（2026-11-03）：Schedule 直接用上游替换自研；自研有不少 BUG，功能一致时优先上游；开发阶段无实际用户，不做数据迁移。 删除授权：用户 2026-11-03 23:27（UTC+8）已明确授权删除自研定时任务模块；本卡开工时由认领 Agent 执行删除（本次看板更新未删任何代码）。做法：挑 d9ed1e4e28（#7567）、86e2cc8277（#7702）、f07af538f8（#7704）、341ea6eea4（#6189，其 subagent / cordis hunk 剔除或手工移植）；剔除 b3d4933f39（subagent 归属重构）、a91a827546（Cordis 升级）、5f01833f80、a10b6e1270（手机）。packages/schedule/schedule 与上游同文件 10 个以上游为准。按 UP-SCHEDULE-REPLACE-PLAN 的集成点清单把 desktop-host / remotes / account-sub2api / desktop-native bundle / slot-catalog / prepare-dsh 改接上游 Schedule 或去掉引用；用户选「保留」的上游缺失能力以插件补到上游 Schedule 上，选「放弃」的直接丢弃。随后删除自研 packages/schedule/asterhub-automation、packages/client/ui-asterhub-automation（子步骤见 UP-SCHEDULE-RETIRE-SELFDEV）。不做数据迁移、不保留旧任务数据兼容。blocksRelease=true：替换未完成前不得打包。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 预检报告（2026-11-04）：区域实勘清单 .local-workspace/up-preflight-picklist/C-desktop-settings-schedule.md；汇总、用户决策点与核验差异见同目录 SUMMARY.md。 用户决定（2026-11-04）：②清单 11 条全部放弃，全面替换为上游 Schedule 原样能力、无插件补回；④集成点「视勾选」项按放弃处理。 2026-11-04 验收完成：分支 up-adopt/schedule-20261104（HEAD 2b09f672c0，工作树干净无未提交修改）；完整吸收上游 Schedule/ui-schedule/tool-schedule/time；彻底删除自研 asterhub-automation 与 ui-asterhub-automation（-11,328 行）；10 处集成点改接完成；770 schedule + 766 ui-schedule + 60 tool-schedule + 254 time + 43 desktop-host + 1884 ui-primitives + 8 account 单测全绿；6 项 leaf tsc 全 0 错；profile dump 正常；证据落盘 .local-workspace/up-adopt-schedule/evidence.md。待用户授权合入 master 并推送。",
      "acceptance": "上游 Schedule 在 Windows Desktop 可创建/编辑/预填/按时触发；用户选「保留」的能力全部可用；只有一套调度入口；自研 Automation 包已删除且构建、类型检查、相关测试绿；不要求旧数据迁移。共同验收：git diff --stat 证明未触及 packages/subagent/*、packages/team、ui-agent-team、vendor/*；相关包单测绿；Windows Desktop 采用路径冒烟与 KEEP-SMOKE-WINDOWS 绿基线对比无回退；checkpoint 写明实际吸收的提交列表与剔除理由。"
    },
    {
      "source": "用户决定 2026-11-03（上游差距清单导出）",
      "pluginizable": "n/a",
      "waitOn": null,
      "track": "UP",
      "category": "上游同步",
      "blocksRelease": true,
      "upstreamRelation": "absorb",
      "id": "UP-SCHEDULE-RETIRE-SELFDEV",
      "title": "删除自研 asterhub-automation / ui-asterhub-automation（已授权）",
      "priority": "P1",
      "status": "verified",
      "label": "第 2 波 d · 自研模块已彻底删除并合入 master (f716d5219b)",
      "wave": "2d",
      "dependsOn": [
        "UP-ADOPT-SCHEDULE"
      ],
      "detail": "删除授权：用户 2026-11-03 23:27（UTC+8）已明确授权删除自研定时任务模块。在 UP-ADOPT-SCHEDULE 开工后由同一认领 Agent 执行：删除 packages/schedule/asterhub-automation、packages/client/ui-asterhub-automation，清理 tsconfig.*、pnpm-lock、scripts/type-equiv.manifest.json、asterhub-desktop-native bundle（index.ts、cordis.patch.yml）、desktop-host、remotes、account-sub2api、slot-catalog、prepare-dsh 中的引用。直接替换，不做数据迁移。共同约束：① 只从 f3803c9697..upstream/master 区间按列出的提交挑选，cherry-pick -x 或手工移植，在独立分支/工作树做，合入 master 与推送需用户授权；② 不带入 packages/subagent/*、ui-subagent（Subagent 重构已拒绝）；③ 不带入 packages/team / ui-agent-team / teamwork（Agent Teams 排除）；④ 不带入 vendor/*、tool-cordis、cordis-client-runner 底座升级（Cordis 已拒绝），依赖新 Cordis API 时停下记录并回 UP-PREFLIGHT-PICKLIST；⑤ 不 cherry-pick 发布提交 1c78d475bf；⑥ 其它已拒绝区域（搜索设置 3859913c68、MCP 6719b28294、更新通道、apply_patch、手机布局、CUA、PTC）的提交一律剔除。 2026-11-04 验收完成：自研两个包源码物理删除；10 处集成点引用清理完毕；单测、leaf tsc、配置装配全绿。证据见 .local-workspace/up-adopt-schedule/evidence.md。待用户授权合入 master 并推送。",
      "acceptance": "两个自研包及全部引用已删除（git diff --stat 证据）；构建、类型检查、KEEP 冒烟绿；删除在 git 历史中可回滚。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "SHIP-CANDIDATE",
      "title": "精确 Windows 候选：安装/运行时/更新",
      "track": "SHIP",
      "category": "交付",
      "priority": "P1",
      "status": "verified",
      "label": "第 3 波 · 候选打包与烟测全部通过",
      "detail": "【2026-11-04 OMP 核验收口】package-target.ts win-x64 --unsigned 完整构建完成（退出码 0）；生成 asterhub-0.21.3-win-x64-unsigned.exe（657.99 MB，SHA256: 273f7bcd...）及 blockmap 与 win-unpacked；Node 24.21.0 原生扩展全绿、Python 锁文件运行时（numpy/pandas/python-docx/openpyxl 等）部署完备、Office 侧车 DOCX/XLSX/PPTX 转 PDF 及 CLI 发现通过、Anima Neo4j 5.26.32 配置完整；独立 smoke-packaged-runtime.ts 退出码 0；更新源保持 https://asterhub.xapi.fans。证据见 .local-workspace/ship-candidate/evidence.md。",
      "acceptance": "证据包完整；失败项单列（0 项失败）。签名发布不在本卡。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": "auth",
      "id": "SHIP-PUBLISH",
      "title": "签名与对外发布",
      "track": "SHIP",
      "category": "交付",
      "priority": "P2",
      "status": "waiting_user",
      "label": "必须明确授权",
      "detail": "任何签名、商店/对外通道发布。",
      "acceptance": "用户书面授权范围 + 执行记录。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-T28",
      "title": "[归档] 便携工作区采纳与 Desktop 续聊主体",
      "track": "WAIT",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "主体已验 · 残余见 WAIT-DESKTOP-ADOPT",
      "detail": "原 T28 产品验收主体已记账；仅余用户 picker。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-T17",
      "title": "[归档] Subagent 集成总验收战役卡",
      "track": "KEEP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "改由 KEEP-SUBAGENT-PATH",
      "detail": "旧 T17/T17a–e 战役叙事退役；责任索引留 journal。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-T18",
      "title": "[归档] V4 会话与 Anima 持久化验收",
      "track": "KEEP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "已推送验收",
      "detail": "真实 Desktop 保存/强杀重开等已有证据。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-T19",
      "title": "[归档] 会话投影消费者验收",
      "track": "KEEP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "已关单",
      "detail": "自研投影消费者聚焦回归曾全绿。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-PERSIST-GATES",
      "title": "[归档] V4 持久化静态门收口",
      "track": "KEEP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "八门绿 · 提交见 WAIT-AUTH-COMMIT",
      "detail": "方案 A 已执行；是否提交听用户。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-UI-RESTORE",
      "title": "[归档] 自研账户与精选目录 UI 恢复",
      "track": "KEEP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "已恢复",
      "detail": "fix/restore-fork-ui 路径；真实数据流见 WAIT-LOGIN-DATAFLOW。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-UPSTREAM-AUDIT",
      "title": "[归档] 上游失败定界 2026-11-01",
      "track": "UP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "已定界",
      "detail": "产品阻塞与范围排除已拆到新轨。"
    },
    {
      "source": "交接协议.md / 2026-11-03 上游 alpha.3 重计划",
      "blocksRelease": false,
      "pluginizable": "n/a",
      "upstreamRelation": "none",
      "waitOn": null,
      "id": "ARCH-UP-EVAL-ALPHA2",
      "title": "[归档] 旧 UP 评估卡（alpha.2 期 348 提交口径）",
      "track": "UP",
      "category": "归档",
      "priority": "P2",
      "status": "verified",
      "label": "并入上游差距清单",
      "detail": "UP-GAP-TRIAGE、UP-HDR-DIAG、UP-SCHEDULE-BOUND、UP-CORDIS、UP-APPLY-PATCH、UP-DESKTOP-MENU、UP-PLUGIN-DIAG 已退役：对应区域改由 upstreamDecisions 列项、用户勾选。旧口径 f3803c9697..ce7073d512 作废（ce7073d512 只是 10-30 的上游中间点）。"
    }
  ],
  "issues": [
    {
      "title": "未提交的持久化门改动",
      "severity": "P0",
      "status": "waiting_user",
      "label": "等授权",
      "detail": "八门已绿，提交/推送未授权。",
      "task": "WAIT-AUTH-COMMIT"
    },
    {
      "title": "精确安装包尚未按新候选验收",
      "priority": "P1",
      "status": "partial",
      "label": "交付缺口",
      "detail": "0.21.2 unsigned 不能代替 SHIP-CANDIDATE。",
      "task": "SHIP-CANDIDATE"
    },
    {
      "title": "Schedule 直接替换自研 Automation",
      "priority": "P1",
      "status": "partial",
      "label": "高风险 · 已授权删除",
      "detail": "直接用上游 Schedule 替换自研 asterhub-automation（22 文件）+ ui-asterhub-automation（27 文件），功能一致时以上游为准，不做数据迁移；删除已授权（2026-11-03 23:27）。风险在集成点（desktop-host 退出检查/更新任务、remotes、account-sub2api、desktop-native bundle 等）改接，以及上游缺、自研有的能力需你逐条选保留/放弃；#6189 触及 subagent/cordis 要剔除。三张 Schedule 卡 blocksRelease=true，未完成前不打包。",
      "task": "UP-SCHEDULE-REPLACE-PLAN"
    },
    {
      "title": "沙箱采纳与已拒绝的 apply_patch 交织",
      "priority": "P2",
      "status": "partial",
      "label": "需手工拆分",
      "detail": "沙箱/观察策略的多个上游提交同时开关 apply_patch（14d3e53c19、fe5450b152、ea4837abb1、2bd9913e2f、cc2718bede），只能手工移植非 apply_patch 部分。",
      "task": "UP-ADOPT-SANDBOX"
    },
    {
      "title": "采纳区域路径日志混入 subagent/team/Cordis 提交",
      "priority": "P1",
      "status": "partial",
      "label": "挑提交需剔除",
      "detail": "按路径粗扫：WINDOWS-CLI 46 条中 18 触及 team、12 触及 subagent；SIDEBAR-UI 12 条触及 subagent；SDK-PYTHON 10 条触及 subagent。由 UP-PREFLIGHT-PICKLIST 出挑/剔清单。",
      "task": "UP-PREFLIGHT-PICKLIST"
    },
    {
      "title": "核心侵入插件化债务未盘点",
      "priority": "P1",
      "status": "pending",
      "label": "长期债",
      "detail": "不盘点则跟上游成本持续上升。",
      "task": "PLUGIN-INVENTORY"
    },
    {
      "title": "Subagent 与上游重构/Teams 纠缠",
      "priority": "P1",
      "status": "partial",
      "label": "冲突风险",
      "detail": "上游约 130 个提交触及 packages/subagent（其中大量与 Teams 交叉）；我方改过 39 个 packages/subagent 文件。不采纳时须防止其它吸收顺带引入。",
      "task": "KEEP-SUBAGENT-PATH"
    }
  ],
  "capabilities": [
    {
      "title": "产品组合",
      "state": "已提交",
      "detail": "asterhub-product / product-web / desktop-native。"
    },
    {
      "title": "普通 Subagent",
      "state": "待 KEEP 复验",
      "detail": "已恢复采用；不做 Agent Teams。"
    },
    {
      "title": "Anima / 项目本地",
      "state": "历史通过 · 待冒烟",
      "detail": "T15/T18 证据在；纳入 KEEP-SMOKE。"
    },
    {
      "title": "Automation",
      "state": "历史通过 · 将被上游 Schedule 直接替换",
      "detail": "用户决定直接用上游 Schedule 替换自研 Automation（不迁移数据，删除已授权）；先 UP-SCHEDULE-REPLACE-PLAN 功能对照，再 UP-ADOPT-SCHEDULE + RETIRE-SELFDEV。"
    },
    {
      "title": "浏览器工具",
      "state": "历史通过 · 待冒烟",
      "detail": "open/tabs/close 曾闭环。"
    },
    {
      "title": "账户 / 精选目录 UI",
      "state": "已恢复 · 待真实账号",
      "detail": "见 WAIT-LOGIN-DATAFLOW。"
    }
  ],
  "documents": [
    {
      "title": "上游差距清单（已决定）",
      "kind": "决策",
      "href": "./上游差距清单.html",
      "detail": "2026-11-03 已勾选：采纳 10 / 延后 1 / 拒绝 10；页内可改选后重新导出。"
    },
    {
      "title": "交接协议（v2）",
      "kind": "规则",
      "href": "./交接协议.md",
      "detail": "多 Agent、状态机、打包门禁、五轨。"
    },
    {
      "title": "交接文档",
      "kind": "叙事",
      "href": "./交接文档.md",
      "detail": "只记细节与证据链，不复述看板现值。"
    },
    {
      "title": "Nomad 调度技能",
      "kind": "技能",
      "href": "./skills/nomad-dispatch/SKILL.md",
      "detail": "重活才上集群。"
    },
    {
      "title": "Desktop README",
      "kind": "技术参考",
      "href": "../apps/desktop/README.zh.md",
      "detail": "发布版本约定仍每次打包前确认。"
    }
  ],
  "next": [
    "【第 1 波·立刻／Agent 并行】KEEP-SMOKE-WINDOWS + KEEP-SUBAGENT-PATH 建吸收前绿基线（Automation 单独留档）；PLUGIN-INVENTORY 出侵入清单。",
    "【第 1 波·只读准备／Agent 并行】UP-PREFLIGHT-PICKLIST（每区挑/剔提交 + Schedule/Forge/SDK 的 Cordis 可裁剪性）、UP-UI-SELFDEV-AUDIT（自研 UI 防覆盖清单）、UP-SCHEDULE-REPLACE-PLAN（自研 Automation 与上游 Schedule 功能对照，上游缺的能力交你选保留/放弃）、UP-SESSION-FIX-REVIEW（延后项只评估）。",
    "【第 2 波 a／Agent】低风险采纳：UP-ADOPT-WINDOWS-CLI、LLM-DEEPSEEK、DESKTOP-SETTINGS、PLUGIN-DIAG、SANDBOX（不含 apply_patch）。",
    "【第 2 波 b／Agent】UP-ADOPT-MENU-FILES → UP-ADOPT-SIDEBAR-UI（PINS → TRAJECTORY ∥ RENDER），均先对照自研清单防覆盖。",
    "【第 2 波 c／Agent】UP-ADOPT-FORGE ∥ UP-ADOPT-SDK-PYTHON。",
    "【第 2 波 d／Agent】你对上游缺失能力选完保留/放弃 → UP-ADOPT-SCHEDULE 直接替换（不迁移数据）→ 同卡开工时执行 UP-SCHEDULE-RETIRE-SELFDEV 删除自研模块（已授权）。三张 Schedule 卡 blocksRelease=true。",
    "【第 3 波／Agent】KEEP-POST-ADOPT 回归对比绿基线 → SHIP-CANDIDATE；SHIP-PUBLISH 另授权。",
    "【你·随时】WAIT-AUTH-COMMIT / WAIT-DESKTOP-ADOPT / WAIT-LOGIN-DATAFLOW；UP-SESSION-FIX-REVIEW 出结论后再定会话修复跟不跟。",
    "【约束】基线 f3803c9697..8bd073392e（1017 提交）；只吸收已采纳区域列出的提交；不带入 packages/subagent/*、Agent Teams、vendor/Cordis 升级、apply_patch 及其它已拒绝区域；发布提交 1c78d475bf 不挑。"
  ],
  "upstreamDecisions": [
    {
      "id": "UPD-WINDOWS-CLI",
      "area": "Windows CLI 入口与短路径修复",
      "summary": "Windows 上 CLI 入口别名、8.3 短路径能被正确解析，命令行启动更不容易报找不到模块。",
      "commits": 7,
      "prs": [
        "#7709",
        "8632896e84",
        "b2a7d2ec95"
      ],
      "dirs": "apps/cli、apps/desktop/config",
      "conflict": "我方改过 apps/cli 16 个文件，需逐文件对照（未见直接同文件冲突证据）",
      "windows": "高",
      "risk": "小",
      "recommend": "建议跟",
      "reason": "直接影响 Windows 采用路径，改动小且集中。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-WINDOWS-CLI"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-LLM-DEEPSEEK",
      "area": "DeepSeek 模型请求修复（延迟工具 / 工具历史 / 请求头）",
      "summary": "工具全是延迟加载时请求不再失败；增删工具后历史会重建；插件可预置请求头且失败诊断不泄露凭据；超量图片自动卸载。",
      "commits": 26,
      "prs": [
        "#6958",
        "624c3e91a9",
        "1f3bc8b22b",
        "a05a0d02fa"
      ],
      "dirs": "packages/llm/llm-deepseek、packages/llm/llm、packages/llm/llm-pi-ai",
      "conflict": "我方改过 packages/llm 35 个文件（llm-pi-ai 26 个），其中 12 个与上游同文件",
      "windows": "通用",
      "risk": "中",
      "recommend": "建议跟",
      "reason": "是对话主链路的 bug 修复，等于旧 UP-HDR-DIAG 的落地版。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-LLM-DEEPSEEK"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-DESKTOP-SETTINGS",
      "area": "Desktop 设置保存与损坏配置恢复",
      "summary": "设置保存能分清「已保存/不确定」，配置文件坏了会弹可操作的恢复对话框，不再卡死。",
      "commits": 32,
      "prs": [
        "d7ca2e0ac2",
        "224fe9a658",
        "f578528f1f"
      ],
      "dirs": "apps/desktop/src、packages/api/settings-controller、packages/client/ui-settings-general",
      "conflict": "与我方 apps/desktop/src 18 个文件、settings-controller 10 个、credentials 8 个同文件；#7695「显示已保存 API Key」已被上游回滚，不要跟",
      "windows": "高",
      "risk": "中",
      "recommend": "建议跟",
      "reason": "Windows Desktop 稳定性收益明确，但要避开已回滚的 #7695。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-DESKTOP-SETTINGS"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-PLUGIN-DIAG",
      "area": "插件安装诊断与容错",
      "summary": "插件装失败时对话框里保留步骤和完整日志；可选插件坏了不再拖垮整个启动；插件详情页 Git 拉取 https 被拒后改走 SSH 重试；插件可自定义设置页导航。",
      "commits": 34,
      "prs": [
        "#7463",
        "#7733",
        "#7602",
        "#7624"
      ],
      "dirs": "packages/client/ui-plugin-manager、packages/boot/plugin-manager、plugin-market",
      "conflict": "我方仅改过 ui-plugin-manager 2 个文件",
      "windows": "通用",
      "risk": "小",
      "recommend": "建议跟",
      "reason": "契合「一切皆插件」，自研插件出错时也受益；等于旧 UP-PLUGIN-DIAG。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-PLUGIN-DIAG"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-SESSION-FIX",
      "area": "会话投影 / 会话稳定性修复",
      "summary": "检查点里保留已释放单元（#7754），修会话 400 卡死、会话搜索失效、「加载更早」失效；每个事件只发一帧投影更省资源。",
      "commits": 25,
      "prs": [
        "#7754",
        "#7606",
        "#7570",
        "#7587"
      ],
      "dirs": "packages/session、packages/api/session-controller",
      "conflict": "我方改过 packages/session 161 个文件（V4 持久化、session-title、session-log-deepseek），冲突面大",
      "windows": "通用",
      "risk": "大",
      "recommend": "可选",
      "reason": "修复有价值但我方 V4 持久化改动多，只适合逐个挑修复并跑持久化八门。",
      "decision": "defer",
      "note": "审查具体冲突风险后再决定",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-SESSION-FIX-REVIEW"
      ],
      "status": "已延后（只评估冲突风险，不吸收）"
    },
    {
      "id": "UPD-WEB-SEARCH",
      "area": "Web 搜索 / 抓取设置",
      "summary": "设置页把「搜索」和「抓取」分开选；搜索默认改用 DeepSeek Search API；web_search 默认一次 10 条并限速。",
      "commits": 8,
      "prs": [
        "#7565",
        "#7022",
        "c03b1d247e"
      ],
      "dirs": "packages/web/*、packages/client/ui-settings-web-search",
      "conflict": "我方改过 packages/web 42 个文件；默认服务改为 DeepSeek Search API 可能影响我方账户/计费路径（待核实）",
      "windows": "通用",
      "risk": "中",
      "recommend": "可选",
      "reason": "有用户可感知收益，但默认服务切换要先和自研账户体系对齐。",
      "decision": "reject",
      "note": "我方已自建 SearXNG 服务器",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-MCP-MANAGER",
      "area": "MCP 服务器管理器（ctx.mcpManager）",
      "summary": "在设置里管理 MCP 服务器（连接状态、健康检查、取消/关闭）；插件可以注册 MCP 服务器；对外暴露 ctx.mcpManager。",
      "commits": 43,
      "prs": [
        "#3372",
        "30bf5733d6",
        "6719b28294"
      ],
      "dirs": "packages/mcp/mcp-manager、packages/mcp/mcp-client",
      "conflict": "我方改过 packages/mcp 5 个文件、tool-cordis 22 个；上游 tool-cordis 也有改动",
      "windows": "通用",
      "risk": "中",
      "recommend": "可选",
      "reason": "本身是插件形态、方向契合，但体量大，没有 MCP 管理需求可延后。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-UPDATE-CHANNELS",
      "area": "Desktop 更新通道切换",
      "summary": "在设置里切换稳定/预览更新通道，切换时清理旧下载；含 Windows 更新器资格测试。",
      "commits": 11,
      "prs": [
        "#7495",
        "0cf76b9fad",
        "a635d6d908"
      ],
      "dirs": "apps/desktop/src（updater）、ui-settings-general",
      "conflict": "与我方 apps/desktop/src 9 个文件同文件；上游更新源是 DSH 的发布通道，我方发布走 AsterHub 自己的 GitHub 预发布",
      "windows": "高",
      "risk": "中",
      "recommend": "可选",
      "reason": "先定 AsterHub 自己的更新/发布通道再决定，否则会指向错误的更新源。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-MENU-FILES",
      "area": "右键菜单与文件操作",
      "summary": "右键菜单可被插件扩展并显示快捷键；文件链接带行号跳转；每个窗格独立工作区树；文件可在侧栏或浮窗打开；Desktop 可显示开发者工具菜单。",
      "commits": 37,
      "prs": [
        "#6951",
        "#7056",
        "#6759",
        "#7523"
      ],
      "dirs": "packages/client/ui-context-menu、ui-file-actions、ui-open-in-app、ui-sidebar-files、ui-workspace",
      "conflict": "与我方 ui-primitives 15 个、apps/desktop/src 6 个同文件",
      "windows": "通用",
      "risk": "中",
      "recommend": "可选",
      "reason": "体验改进，等于旧 UP-DESKTOP-MENU；没有明确缺口可延后。",
      "decision": "adopt",
      "note": "防覆盖自研部分",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-UI-SELFDEV-AUDIT",
        "UP-ADOPT-MENU-FILES"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-SIDEBAR-UI",
      "area": "侧栏与对话阅读体验",
      "summary": "侧栏可固定插件并预览、自定义「更多」菜单；工具轨迹可折叠、失败输出更清楚、代码高亮；KaTeX 公式复制为 TeX；流式渲染更快。",
      "commits": 92,
      "prs": [
        "#7207",
        "#7490",
        "#7399",
        "#7691"
      ],
      "dirs": "packages/client/ui-sidebar、ui-trajectory、ui-conversation、ui-primitives",
      "conflict": "与我方 ui-primitives 18 个同文件；我方有 ui-asterhub-brand 品牌 UI，需防覆盖",
      "windows": "通用",
      "risk": "中",
      "recommend": "可选",
      "reason": "纯体验，量大且散；可只挑轨迹/复制类小修。",
      "decision": "adopt",
      "note": "防覆盖自研部分",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-UI-SELFDEV-AUDIT",
        "UP-ADOPT-SIDEBAR-UI",
        "UP-ADOPT-SIDEBAR-PINS",
        "UP-ADOPT-SIDEBAR-TRAJECTORY",
        "UP-ADOPT-SIDEBAR-RENDER"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-AUTH-COOKIE",
      "area": "Desktop 不再保存 Host 认证 Cookie",
      "summary": "Desktop 不再把 Host 认证 Cookie 存进 Electron 会话，并清掉旧 Cookie（安全修复）。",
      "commits": 3,
      "prs": [
        "#7663",
        "5868dbc357",
        "93bef27ec7"
      ],
      "dirs": "apps/desktop/src",
      "conflict": "可能影响我方自研账户登录（ui-asterhub-account / deepseek-account-platform），未核实",
      "windows": "高",
      "risk": "中",
      "recommend": "可选",
      "reason": "安全收益明确，但必须先确认不打断自研账户登录，最好和 WAIT-LOGIN-DATAFLOW 一起验。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-FORGE",
      "area": "Forge 代码评审 / 工作树插件",
      "summary": "评审和工作树统一为一个插件入口；PR 检查按需加载；本地改动与 PR 并列显示；差异文件顺序与文件树一致。",
      "commits": 51,
      "prs": [
        "#7721",
        "#7619",
        "#7603",
        "#7482"
      ],
      "dirs": "packages/experimental/client-ui-forge、forge-*",
      "conflict": "我方仅改过 client-ui-forge 2 个文件",
      "windows": "通用",
      "risk": "小",
      "recommend": "可选",
      "reason": "实验插件、冲突小；不在应用里做 GitHub 评审就不需要。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-FORGE"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-SCHEDULE",
      "area": "Schedule 定时任务",
      "summary": "任务创建和编辑合为一处、可预填；独立任务接入 WebUI；修复已存任务的定时控件初始化（#7704）。",
      "commits": 19,
      "prs": [
        "#7567",
        "#7702",
        "#7704",
        "#6189"
      ],
      "dirs": "packages/schedule/schedule、packages/client/ui-schedule",
      "conflict": "我方改过 packages/schedule 46 个文件（含自研 asterhub-automation 22 个、schedule/schedule 21 个），会出现第二套调度入口",
      "windows": "通用",
      "risk": "大",
      "recommend": "不建议",
      "reason": "整块会和自研 Automation 打架；如确有 bug 只单挑 #7704 对照。",
      "decision": "adopt",
      "note": "完全替换自研的定时任务模块；直接用上游，功能一致时优先上游，不做数据迁移；删除自研模块已授权（2026-11-03 23:27）",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-SCHEDULE-REPLACE-PLAN",
        "UP-ADOPT-SCHEDULE",
        "UP-SCHEDULE-RETIRE-SELFDEV"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-CORDIS-VENDOR",
      "area": "Cordis / Loader / vendor 升级",
      "summary": "框架底座升级到 cordis 4.0.6-alpha.2、Loader rc.8/rc11、Include 1.1.1，插件热重载更稳；用户基本无感。",
      "commits": 117,
      "prs": [
        "05b1cae8db",
        "#6220",
        "#6210"
      ],
      "dirs": "vendor/*、packages/extensions/tool-cordis、cordis-client-runner",
      "conflict": "我方 vendor 有 142 个文件与基线不同，tool-cordis 22 个、cordis-client-runner 19 个",
      "windows": "通用",
      "risk": "大",
      "recommend": "不建议",
      "reason": "底座升级牵一发动全身；先做 PLUGIN-INVENTORY，若自研插件确实需要新 API 再升。提交数含大量顺带触及 tool-cordis 的改动，偏高估。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-SUBAGENT-REFACTOR",
      "area": "Subagent 运行时 / 命名重构",
      "summary": "Subagent 改用 ID 身份、可选命名拆成独立插件、运行时归属移出核心注册表、选模型提示更清楚。",
      "commits": 130,
      "prs": [
        "#7059",
        "#7519",
        "#7533"
      ],
      "dirs": "packages/subagent/*、packages/client/ui-subagent",
      "conflict": "我方改过 packages/subagent 39 个文件；上游这批与 Agent Teams 高度交叉（共用提示层）",
      "windows": "通用",
      "risk": "大",
      "recommend": "不建议",
      "reason": "保我方普通 Subagent 优先；跟了等于半只脚踩进 Teams。提交数含与 Teams 重叠部分。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-APPLY-PATCH",
      "area": "apply_patch 补丁工具",
      "summary": "新增 Codex 风格的 apply_patch 文件修改工具，但上游 11-02 已在默认配置里临时关闭。",
      "commits": 34,
      "prs": [
        "#6747",
        "#7559",
        "#7698"
      ],
      "dirs": "packages/fs/tool-fs、packages/fs/fs-patch",
      "conflict": "我方改过 packages/fs 4 个文件",
      "windows": "通用",
      "risk": "中",
      "recommend": "不建议",
      "reason": "上游自己都临时关了，等稳定后再看。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-SANDBOX",
      "area": "沙箱策略上限 / 文件观察策略",
      "summary": "给沙箱策略加能力上限；文件观察策略默认关闭，补丁改动有护栏。",
      "commits": 11,
      "prs": [
        "#7543",
        "743d4602e9"
      ],
      "dirs": "packages/fs/fs-sandbox、fs-observation-policy",
      "conflict": "未见与我方同文件冲突证据",
      "windows": "未核实",
      "risk": "中",
      "recommend": "可选",
      "reason": "没有明确产品缺口；Windows 下是否生效未核实。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-SANDBOX"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-SDK-PYTHON",
      "area": "SDK / Python SDK 与运行时部署",
      "summary": "SDK 支持原生斜杠命令（plan/goal/compact）；Python 运行时按锁文件部署（#7689/#7707）。不含 sdk-team-mode。",
      "commits": 55,
      "prs": [
        "#6955",
        "#7107",
        "#7689",
        "#7707"
      ],
      "dirs": "packages/sdk/*、python/sdk",
      "conflict": "与我方 python/sdk 多文件同文件",
      "windows": "中",
      "risk": "中",
      "recommend": "可选",
      "reason": "只有 Python 运行时部署修复可能影响 Desktop 打包，其余面向 SDK 开发者。",
      "decision": "adopt",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [
        "UP-ADOPT-SDK-PYTHON"
      ],
      "status": "已采纳（按波次开卡）"
    },
    {
      "id": "UPD-PTC",
      "area": "PTC 脚本运行时",
      "summary": "PTC 脚本运行时支持递归 ESM 导入和本地 import 处理，导入语义更稳。",
      "commits": 27,
      "prs": [
        "#6978",
        "fb59141935"
      ],
      "dirs": "packages/ptc-runtime/ptc-runtime-node、webworker-runtime",
      "conflict": "我方改过 workflow-ptc 17 个文件",
      "windows": "通用",
      "risk": "中",
      "recommend": "不建议",
      "reason": "用户基本无感，除非自研工作流用到。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-CUA-MACOS",
      "area": "Computer Use（macOS 助手）",
      "summary": "Computer Use 的 macOS 助手：权限引导、开发者签名、公证、打包。",
      "commits": 79,
      "prs": [
        "#7515",
        "#7516",
        "#7538",
        "#7557"
      ],
      "dirs": "packages/experimental/cua-macos、cua、cua-bundle",
      "conflict": "我方 cua-macos 与上游差异 105 个文件",
      "windows": "无",
      "risk": "中",
      "recommend": "不建议",
      "reason": "macOS 专属，不在 Windows 产品范围。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    },
    {
      "id": "UPD-MOBILE",
      "area": "手机端布局",
      "summary": "手机端侧栏、标题、布局打磨。",
      "commits": 7,
      "prs": [
        "#6672",
        "#7478",
        "#7556"
      ],
      "dirs": "packages/client/*（mobile）",
      "conflict": "无证据",
      "windows": "无",
      "risk": "小",
      "recommend": "不建议",
      "reason": "Windows Desktop 用不到。",
      "decision": "reject",
      "note": "",
      "decidedAt": "2026-11-03",
      "cards": [],
      "status": "已拒绝（不建卡、不吸收）"
    }
  ],
  "upstreamDecisionsMeta": {
    "range": "f3803c9697..8bd073392e",
    "total": 1017,
    "nonMerge": 689,
    "merges": 328,
    "snapshot": "2026-11-03",
    "method": "按提交标题关键词 + 改动路径粗分（只读 git log）；区域之间有重叠，提交数为近似值。冲突点仅写有文件面重叠证据的。",
    "page": "./上游差距清单.html",
    "decidedAt": "2026-11-03",
    "decisionSource": "用户在「上游差距清单.html」导出并贴回对话（2026-11-03）",
    "counts": {
      "adopt": 10,
      "defer": 1,
      "reject": 10,
      "pending_user": 0
    },
    "rejected": [
      "UPD-WEB-SEARCH",
      "UPD-MCP-MANAGER",
      "UPD-UPDATE-CHANNELS",
      "UPD-AUTH-COOKIE",
      "UPD-CORDIS-VENDOR",
      "UPD-SUBAGENT-REFACTOR",
      "UPD-APPLY-PATCH",
      "UPD-PTC",
      "UPD-CUA-MACOS",
      "UPD-MOBILE"
    ],
    "crossRules": [
      "UPD-SUBAGENT-REFACTOR 已拒绝：任何采纳卡不得带入 packages/subagent/*、packages/client/ui-subagent 的上游改动（触及的提交剔除相关 hunk 或手工移植）。",
      "UPD-CORDIS-VENDOR 已拒绝：不升级 vendor/*、tool-cordis、cordis-client-runner；依赖新 Cordis API 的提交先评估可裁剪性（Schedule / Forge / SDK 重点查）。",
      "UPD-APPLY-PATCH 已拒绝：沙箱/轨迹相关提交里的 apply_patch、fs-patch 部分不带入，apply_patch 工具保持不存在/关闭。",
      "UPD-WEB-SEARCH / UPD-MCP-MANAGER / UPD-UPDATE-CHANNELS / UPD-AUTH-COOKIE / UPD-MOBILE / UPD-CUA-MACOS / UPD-PTC 已拒绝：其提交即使出现在采纳区域的路径日志里也要剔除（如 3859913c68 搜索设置、6719b28294 MCP 注册）。",
      "Agent Teams 仍整块排除：packages/team、ui-agent-team、teamwork 改动一律不带入。",
      "发布提交 1c78d475bf（release 0.2.2-alpha.3，全仓版本号）不 cherry-pick。"
    ]
  }
};
