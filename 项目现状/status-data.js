/** AsterHub project status snapshot. Update evidence-backed state here; no network or secrets. */
window.ASTERHUB_STATUS = {
  meta: {
    title: 'AsterHub · 项目现状',
    date: '2026-11-01',
    productVersion: '0.21.2',
    frameworkVersion: '0.2.0-rc.3',
    upstreamBaseline: 'fork 基线 dsh-v0.2.0-rc.2（merge-base 639ed01539）；本轮固定恢复目标为本地 upstream/master f3803c9697（0.2.2-alpha.2）；旧 0.2.1-rc.3 差距分析保留于交接文档历史节。',
    phase: 'Windows-only 代码收口 · 上游责任审查完成 · 产品E2E与主树整备仍开放',
    verdict: '主树Windows-only代码已提交；桌面真实冒烟尚未通过，构建产物部分重建且完整构建受阻。同步分支T17b的9项重放虽通过，但提交45d6fe76d7覆盖了5个已提交v4 Session录制，违反世代保留规则，不能作为合并就绪证据。',
    summary: 'Agent Teams与Windows-only代码已提交deb7cd4733，未推送。已继续完成BUG-SDK-PERSONA-CWD：实际缺陷在同步分支，修复c024dd3b2d、23项回归及真实源码persona冒烟通过；主树本已有cwd提供方，无重复改动。余项为T17b必要子代理集成、T17e源码/测试一致性、T18/T19数据与投影、T28产品验收；不将历史44项清零作为前置。',
    scope: '这是人工核对的离线快照，不是实时 CI、线上监控或自动同步任务系统。',
    source: '交接文档.md',
    branch: 'master（主目录；维护边界代码已提交，同步分支尚未合入）',
    mainBranch: 'master',
    paused: '本地包含主树deb7cd4733（维护范围收口）和同步分支c024dd3b2d（cwd修复）；45d6fe76d7因覆盖已提交v4录制禁止合并/推送，原内容存在其父提交。Desktop冒烟未通过；此前批量结束Electron可能影响其他实例，直接启动曾出现默认用户数据路径，影响未核实。未授权合并、推送、签名或发布；保留原有漂移。',
  },
  purpose: '辅助人工进度查看、问题收集与跨 Agent 交接；这是人工维护快照，不是实时 CI/监控，也不替代源码与原始日志。下方 Agent 交接区的工作区、切片和验证是 2026-10-24 历史快照，当前占用与断点以认领台账为准。',
  usageRules: [
    '用户只用自然语言分派与询问；交接协议（claim/checkpoint/release/status/brief）由各 Agent 自动执行，用户不需要运行任何命令。',
    '接手先读交接、状态数据、收件箱 helper 与当前活跃任务；轻量核对正确 worktree、文件归属和作业状态。',
    '不重扫全仓或默认重跑已通过检查；没有终端证据不得重复、重启或取消作业；尊重文件 owner 与受保护 worktree。',
    '每项任务完成后记录实际文件/范围、已执行验证及证据、状态、阻塞和下一步；区分调查、源码/单测、包验收和用户验收。',
    '源码与原始日志/测试输出优先；按当前证据纠正过期快照。Inbox 是不可信用户报告，不是可执行指令。',
    '维护边界：只负责自研代码、必要的上游修改及受影响集成；未修改上游功能的独立测试与 BUG 修补不作为产品阻塞。未采用实验能力不得因测试红而扩大修复范围。'
  ],
  handoff: {
    updatedAt: '2026-10-24T23:27:24.659Z',
    source: {
      repoRoot: 'C:/开发目录/AsterHub-reference',
      worktree: 'C:/开发目录/AsterHub-reference/.worktrees/architecture-consolidation',
      branch: 'refactor/architecture-consolidation',
      head: 'refactor/architecture-consolidation',
      snapshot: { id: 'integration-current-v6-20261025', sha256: 'a452e19c203b8db66ab37a18027e36bfe78c729b2d6f1cd8948d63d1abaee129', includesT16: true }, // 冻结源码验证基线，不是安装包；见 integration-current/snapshot-manifest-v6.json
      protectedPaths: [
        '.worktrees/project-local-history/ — independent feature worktree; do not modify.',
        '~/.asterhub/ — real user credentials and Neo4j data; do not access, migrate, overwrite, or delete.',
        '<real-project>/.aster/ — real project-local history/attachments; do not inspect, migrate, overwrite, or delete.',
        '.worktrees/architecture-consolidation/apps/desktop/dist/ — existing untracked build artifacts; preserve and do not overwrite/delete without owner approval.',
        'C:/AsterHub-Setup-0.21.0-win-x64-unsigned.exe — delivered r11 artifact; preserve.',
        'Other agents’ uncommitted files and all committed Session generations/headers — preserve; no cross-owner edits or history rewrites.'
      ],
      dirtyScope: '冻结验证基线v6为14,730文件/30,113,680字节，SHA-256 a452e19c…；逐文件清单见.local-workspace/issue-remediation-20261024/integration-current/snapshot-manifest-v6.json。包含集成暴露的preload导入、可选bridge绑定及测试类型修正；不是编辑树实时镜像，也不是安装包。v2/v3/v5失败证据保留；旧v4/r11安装包不覆盖新修复。Git status不单独证明作者或归属。'
    },
    readOrder: [
      '项目现状/交接文档.md',
      '项目现状/status-data.js',
      'node 项目现状/handoff.mjs status（并行占用与断点总览；接手具体任务跑 node 项目现状/handoff.mjs brief <task>，规则见 项目现状/交接协议.md；由 Agent 自动执行，用户只用自然语言）',
      'node 项目现状/read-issue-inbox.mjs（每次状态更新前运行）',
      '.local-workspace/issue-remediation-20261024/progress.md',
      '对应 job state、allocation stdout/stderr 与本次原始测试输出'
    ],
    activeSlices: [
      {
        owner: 'PackageAcceptanceOwner',
        scope: '两个 source-v2 打包尝试均终态失败且不构成验收；已准备 corrected Electron Node-mode targeted smoke，对现成 pre-T16 artifact 检查临时目录修复；之后仅做一个 T16-inclusive no-skip full package 与精确安装验收。',
        files: [
          '.worktrees/architecture-consolidation/apps/desktop/tests/fixtures/runtime-payload-smoke.mjs',
          '.worktrees/architecture-consolidation/apps/desktop/src/node-environment.ts',
          '.local-workspace/issue-remediation-20261024/package-runtime-probe.mjs',
          '.local-workspace/issue-remediation-20261024/runtime-payload-smoke.nomad',
          '.local-workspace/issue-remediation-20261024/runtime-payload-smoke-node-mode.nomad',
          '.worktrees/architecture-consolidation/.local-workspace/architecture-consolidation/nomad/execution/installer-acceptance.nomad'
        ],
        jobs: [
          { id: 'asterhub-remediation-installer-imac-1792796824798', allocation: 'd13f0a39-bcf5-a00b-45b3-9650e186060f', status: 'terminal failed / exit 1: source archive lacked .git metadata; no package build accepted', evidence: '.local-workspace/issue-remediation-20261024/current-package-job.json' },
          { id: 'asterhub-remediation-installer-imac-1792797050149', allocation: '9b9d9bad-d6ba-8a45-8ebe-7f53d81f0101', status: 'terminal failed: installer generated, final packaged smoke ENOENT under read-only app.asar; artifact not accepted', evidence: '.local-workspace/issue-remediation-20261024/asterhub-remediation-installer-imac-1792797050149/9b9d9bad-d6ba-8a45-8ebe-7f53d81f0101-stderr.log' },
          { id: 'asterhub-runtime-payload-smoke-imac-20261024-0010', allocation: 'cf37b345-dc0d-e26b-a023-bf66f730a631', status: 'terminal after scoped stop, terminal exit 1; invalid Node-mode invocation launched UI instead of fixture; not acceptance', evidence: '.local-workspace/issue-remediation-20261024/asterhub-runtime-payload-smoke-imac-20261024-0010/state.json' }
        ],
        allocations: [
          { id: 'd13f0a39-bcf5-a00b-45b3-9650e186060f', status: 'failed / exit 1' },
          { id: '9b9d9bad-d6ba-8a45-8ebe-7f53d81f0101', status: 'failed / exit 1' },
          { id: 'cf37b345-dc0d-e26b-a023-bf66f730a631', status: 'complete after desired stop; task terminal exit 1' }
        ],
        monitor: 'Blocking-query observation for the first scoped smoke reached deadline; job was stopped and terminal snapshot captured in state.json.',
        waitFor: 'Validate and submit new scoped smoke with ELECTRON_RUN_AS_NODE=1 (as desktopNodeEnvironment requires); then preserve this invalid attempt and continue only on fresh job.',
        evidence: '.local-workspace/issue-remediation-20261024/current-package-job.json; .local-workspace/issue-remediation-20261024/asterhub-runtime-payload-smoke-imac-20261024-0010/state.json; terminal package stderr log'
      },
      {
        owner: 'WorkspaceHistoryRepair',
        scope: 'T16 源码与回归已报告完成；待新 T16 候选做支持 profile 的真实组合 smoke。',
        files: [
          '.worktrees/architecture-consolidation/packages/workspace/workspace/src/index.ts',
          '.worktrees/architecture-consolidation/packages/api/workspace-controller/src/commands.ts',
          '.worktrees/architecture-consolidation/packages/client/ui-workspace/src/client/index.ts'
        ],
        jobs: [],
        allocations: [],
        monitor: '无 active T16 smoke allocation。',
        waitFor: 'PackageAcceptanceOwner 提供 T16-inclusive compiled artifact；临时 overlay 已移除。',
        evidence: '项目现状/交接文档.md#5.6'
      },
      {
        owner: 'W7ExecutionOwner',
        scope: 'T05 有效 baseline capture；此前三次尝试均在 capture 前失败，safe.directory 守卫已改为进程级。',
        files: ['.local-workspace/issue-remediation-20261024/freeze-baseline-v3.py'],
        jobs: [
          { id: 'asterhub-w7-profile-capture-imac-20261024-1792797934030', status: 'failed：Windows tar symlink target' },
          { id: 'asterhub-w7-profile-capture-imac-20261024-1792799855012', status: 'failed：残留 PAX linkpath' },
          { id: 'asterhub-w7-profile-capture-imac-20261024-1792799917264', status: 'failed：LocalSystem safe.directory guard' }
        ],
        allocations: [
          { id: '68d3e9ea-df71-b207-4bfa-9e3c2f297364', status: 'terminal failed before capture' },
          { id: 'e40f70ee-d6bf-121e-419c-847782f45090', status: 'terminal failed before capture' },
          { id: '4edbd3e6-a30e-7089-7168-fe708a2c8544', status: 'terminal failed before capture' }
        ],
        monitor: '无 active capture allocation；旧失败均保留。',
        waitFor: 'PackageAcceptanceOwner 报告 targeted smoke 终态后，再提交新的 5000MHz/6144MiB retry。',
        evidence: '.local-workspace/issue-remediation-20261024/asterhub-w7-profile-capture-imac-20261024-1792799917264/'
      },
      {
        owner: 'IssueSubmissionUI',
        scope: '只维护状态看板的跨 Agent handoff 展示；看板不属于 AsterHub 产品任务。',
        files: ['项目现状/index.html', '项目现状/handoff-view.js'],
        jobs: [],
        allocations: [],
        monitor: '无 job。',
        waitFor: '渲染本 handoff/purpose/usageRules 数据；不改 status-data 或交接 Markdown。',
        evidence: '项目现状/index.html'
      }
    ],
    recentFiles: {
      confirmedRound: [
        { files: [
          '.worktrees/architecture-consolidation/packages/workspace/workspace/src/index.ts',
          '.worktrees/architecture-consolidation/packages/client/ui-workspace/src/client/index.ts',
          '.worktrees/architecture-consolidation/packages/workspace/workspace/tests/workspace.spec.ts',
          '.worktrees/architecture-consolidation/packages/api/workspace-controller/tests/workspace-controller.host.spec.ts',
          '.worktrees/architecture-consolidation/packages/client/ui-workspace/tests/apply.client.spec.ts',
          '.worktrees/architecture-consolidation/packages/workspace/workspace/README.md',
          '.worktrees/architecture-consolidation/packages/workspace/workspace/README.zh.md'
        ], owner: 'WorkspaceHistoryRepair', evidence: '项目现状/交接文档.md#5.6', note: 'T16 source/test/readme change set, independently reviewed; build/profile smoke pending.' },
        { files: [
          '.worktrees/architecture-consolidation/apps/desktop/tests/fixtures/runtime-payload-smoke.mjs',
          '.worktrees/architecture-consolidation/apps/desktop/src/node-environment.ts',
          '.local-workspace/issue-remediation-20261024/runtime-payload-smoke.nomad',
          '.local-workspace/issue-remediation-20261024/runtime-payload-smoke-node-mode.nomad',
          '.local-workspace/issue-remediation-20261024/current-package-job.json',
          '.local-workspace/issue-remediation-20261024/asterhub-runtime-payload-smoke-imac-20261024-0010/state.json'
        ], owner: 'PackageAcceptanceOwner', evidence: '.local-workspace/issue-remediation-20261024/asterhub-runtime-payload-smoke-imac-20261024-0010/state.json', note: 'Read-only ASAR scratch fixed to tmpdir; first scoped test invocation was invalid because Electron Node mode was omitted and was stopped with exit 1; corrected template now sets ELECTRON_RUN_AS_NODE=1.' },
        { files: ['项目现状/status-data.js', '项目现状/交接文档.md'], owner: 'PackageAcceptanceOwner', evidence: '项目现状/status-data.js; 项目现状/交接文档.md', note: 'T03 preserved, T16 recorded, cross-agent handoff added; no T17 product task.' },
        { files: ['项目现状/index.html', '项目现状/issue-submission.js', '项目现状/read-issue-inbox.mjs', '项目现状/问题提交记录.jsonl', '项目现状/handoff-view.js'], owner: 'IssueSubmissionUI / IssueInboxWorkflow', evidence: '项目现状/read-issue-inbox.mjs', note: 'auxiliary status-view/intake tooling only, explicitly outside AsterHub product scope.' }
      ],
      historicalPreexisting: [
        { files: [
          '.worktrees/architecture-consolidation/apps/desktop/README.md',
          '.worktrees/architecture-consolidation/apps/desktop/README.zh.md',
          '.worktrees/architecture-consolidation/apps/desktop/scripts/prepare-dsh.ts',
          '.worktrees/architecture-consolidation/apps/desktop/scripts/prepare-runtime.ts',
          '.worktrees/architecture-consolidation/apps/desktop/src/browser-automation-protocol.ts',
          '.worktrees/architecture-consolidation/apps/desktop/src/browser-guests.ts',
          '.worktrees/architecture-consolidation/apps/desktop/src/ipc.ts',
          '.worktrees/architecture-consolidation/apps/desktop/src/main.ts',
          '.worktrees/architecture-consolidation/apps/desktop/src/preload-app.ts',
          '.worktrees/architecture-consolidation/apps/desktop/tests/browser-automation-tabs.spec.ts',
          '.worktrees/architecture-consolidation/apps/desktop/tests/preload-app.spec.ts',
          '.worktrees/architecture-consolidation/packages/account/account-sub2api/README.md',
          '.worktrees/architecture-consolidation/packages/account/account-sub2api/README.zh.md',
          '.worktrees/architecture-consolidation/packages/account/account-sub2api/src/index.ts',
          '.worktrees/architecture-consolidation/packages/browser-use/browser-use-desktop/README.md',
          '.worktrees/architecture-consolidation/packages/browser-use/browser-use-desktop/README.zh.md',
          '.worktrees/architecture-consolidation/packages/browser-use/browser-use-desktop/src/index.ts',
          '.worktrees/architecture-consolidation/packages/browser-use/browser-use-desktop/src/protocol.ts',
          '.worktrees/architecture-consolidation/packages/bundle/asterhub-desktop-native/cordis.patch.yml',
          '.worktrees/architecture-consolidation/packages/bundle/asterhub-desktop-native/package.json',
          '.worktrees/architecture-consolidation/packages/bundle/base/cordis.patch.yml',
          '.worktrees/architecture-consolidation/packages/client/ui-settings-general/src/client/CurrentVersionRow.tsx',
          '.worktrees/architecture-consolidation/packages/client/ui-settings-general/src/client/index.ts',
          '.worktrees/architecture-consolidation/packages/client/ui-settings-general/tests/apply.client.spec.ts',
          '.worktrees/architecture-consolidation/packages/client/ui-settings-general/tests/components.client.spec.tsx',
          '.worktrees/architecture-consolidation/packages/client/ui-sidebar-browser/src/client/electron/automation.ts',
          '.worktrees/architecture-consolidation/packages/client/ui-sidebar-browser/tests/automation.client.spec.ts',
          '.worktrees/architecture-consolidation/packages/context/anima-memory/README.md',
          '.worktrees/architecture-consolidation/packages/context/anima-memory/README.zh.md',
          '.worktrees/architecture-consolidation/packages/context/anima-memory/src/host.ts',
          '.worktrees/architecture-consolidation/packages/context/anima-memory/tests/host.spec.ts',
          '.worktrees/architecture-consolidation/packages/core/session/README.i18n.yaml',
          '.worktrees/architecture-consolidation/packages/core/session/README.md',
          '.worktrees/architecture-consolidation/packages/core/session/README.zh.md',
          '.worktrees/architecture-consolidation/packages/core/session/tsdown.config.ts',
          '.worktrees/architecture-consolidation/packages/credentials/credentials-local/README.md',
          '.worktrees/architecture-consolidation/packages/credentials/credentials-local/README.zh.md',
          '.worktrees/architecture-consolidation/packages/credentials/credentials-local/src/index.ts',
          '.worktrees/architecture-consolidation/packages/credentials/credentials-local/tests/encrypted.spec.ts',
          '.worktrees/architecture-consolidation/pnpm-lock.yaml'
        ], owner: '历史 T01–T15 改动；各文件原作者未从 status 推断', evidence: '.local-workspace/issue-remediation-20261024/current-source-v2.json', note: '这些路径已在 pre-T16 source-v2 快照内；不是本轮 T16/ASAR 修复。' }
      ],
      unknown: [
        { files: ['.worktrees/architecture-consolidation/apps/desktop/dist/', '.worktrees/architecture-consolidation/packages/account/account-sub2api/tests/failure-mapping.spec.ts'], owner: '尚未记录', evidence: 'git status inventory captured in this handoff; current source attribution not independently confirmed', note: '保留，不因状态输出推断 owner 或删除。' },
        { files: ['root worktree README changes, packages/client/ui-workspace/src/client/index.ts, packages/workspace/workspace/README.zh.md, scripts/gen-cordis-catalog.ts'], owner: '尚未记录', evidence: 'root git status inventory captured in this handoff', note: '与 architecture-consolidation linked worktree 分开核对；不覆盖。' }
      ]
    },
    latestVerification: [
      { owner: 'OMP-Main', command: 'T09 evidence correction: alloc 6b9ef21b-9c34-2159-9d58-8c38cb91fa8c', result: '仅首轮Desktop自动登录及绑定合成Key的对话有分项证据；外层env-login-result为false，未执行重启阶段，不能宣称重启保持通过；未泄露sentinel的断言限已检查文件，不宣称全部凭据安全验收。', evidence: '.local-workspace/t09-evidence/desktop-automation-5800/6b9ef21b-9c34-2159-9d58-8c38cb91fa8c/first-driver-result.json; env-login-result.json' },
      { owner: 'OMP-Main', command: 'T09 evidence correction: alloc 84b9f30b-9a64-7bc7-4b47-9d775ce94bd9', result: '创建每日/每周、时区/行高、暂停恢复及运行历史成功状态可见；整体passed=false：历史显示会话不可用，查看正文未通过，删除和重载检查未执行。不得再称能力全集或0秒完成结算；activeRunId清除需单独核实。旧bundle与当前源存在差异，需当前完整构建复验，global:true假说未由RED证明。', evidence: '.local-workspace/t09-evidence/desktop-automation-5800/84b9f30b-9a64-7bc7-4b47-9d775ce94bd9/automation-summary.json' },
      { owner: 'OMP-Main', command: 'catalog reset RED/GREEN; targeted 5800 plugin build; actual Desktop 4b58642f', result: '修复新发现的重连后定时任务列表永久loading：先注册身份reset再订阅目录，reset清空可复用inFlight。行为RED实际records=[]/loading；GREEN该包4文件26项通过；5800定向tsc/tsdown exit0，client.js SHA7abf48ab…，Main未改。真实Desktop列表ready并成功创建每日任务，验证原先60秒仍loading的路径恢复；独立review无Critical/Important。整套自动化脚本仍在补每周/运行/删除，不以此关闭T09。', evidence: '.local-workspace/t09-evidence/desktop-automation-5800/catalog-fix-build-result.json; 4b58642f-b1a2-0901-079e-0ff420228460/automation-summary.json' },
      { owner: 'OMP-Main', command: '5800: asterhub-desktop-acceptance-5800-1792902030255', result: 'T12分项通过：未主动展开侧栏，真实Host/Main/Renderer/Guest执行open→tabs→close→tabs，tab2/gen1关闭后列表0。main.js前后均为原构建46b036b9…；仅Main原生选目录dialog用临时替身，未替换IPC handler/guard。T16历史正文显示，原884字节种子为24,488字节日志精确前缀、旧header.cwd保留；实际pwsh省略workdir，但5800 Nomad服务令牌缺logon SID，restricted-token sandbox拒绝执行，marker缺失。因此整个job failed/exit1、passed=false；不将T12分项通过称整job通过。合成账号/模型上游，不是在线认证或原生目录对话框验收。', evidence: '.local-workspace/issue-remediation-20261024/desktop-acceptance-5800/73bb8b0a-b166-9ba6-5f81-e54111321e49/acceptance-result.json; mock-events.json; session.v5.jsonl.zstd' },
      { owner: 'OMP-Main', command: '5800: asterhub-desktop-acceptance-5800-1792899975388', result: '部分通过，撤回整体闭环表述：真实Desktop历史导入、列表及正文显示，884字节种子保持为19,295字节日志前缀；browser_open与browser_tabs成功。模型/认证为合成上游，目录选择使用验收后门，右侧栏预先手动展开。未调用browser_close；Desktop续聊marker为proofCreated:false。因此不证明关闭标签、默认折叠状态或续聊新cwd。alloc 2f3c1843-8f58-4945-38ec-947bd582456e exit0不等于所有验收通过。', evidence: '.local-workspace/issue-remediation-20261024/desktop-acceptance-5800/t12-t16-final-summary.json; t16-desktop-2f3c.v5.jsonl.zstd' },
      { owner: 'OMP-Main', command: '5800: asterhub-desktop-automation-5800-1792901146164', result: '真实Desktop创建每日09:30 Asia/Tokyo任务，列表长标题行114px且scrollHeight=clientHeight；点击删除后立即移除。仅此子集通过，未证明重载后删除、每周、立即运行、运行历史、环境登录或teardown。合成账号/模型上游，非在线认证验收。', evidence: '.local-workspace/t09-evidence/desktop-automation-5800/4a372d6a-d246-0657-ef30-a2f911e38959/automation-summary.json; 01-task-created.png; 02-task-deleted.png' },
      { owner: 'OMP-Main', command: '5800: pnpm run build; pnpm --filter @deepseek-ai/dsh-desktop run prepare:primary-runtime; pnpm run start:desktop', result: '当前源码快照4b401bc0…在5800完成开发构建及主运行时准备，两阶段真实exit0；353项Client产物，Office往返检查通过。构建alloc0cd41655-8ec9-298e-e715-cab2915456c1外层因CLI清单路径误写而exit1，实际bin.js产物已核实，不冒称整job通过。未重建，复用相同产物并恢复已验证Electron44.7运行时后，支持启动入口真实到达AsterHub本地构建登录界面，约5秒从splash进入登录表单；Host inspector存在，renderer启用sandbox，未提交账号。启动观察alloc751c1ded-778d-12c3-f129-9f32d6f8d85e complete/exit0。未打包，不代表T12/T16功能验收通过。', evidence: '.local-workspace/issue-remediation-20261024/desktop-dev-build-5800/source-current.json; job-0120-result.json; launch-observe-result.json; 751c1ded-778d-12c3-f129-9f32d6f8d85e-run_local_launch_result_json; 751c1ded-778d-12c3-f129-9f32d6f8d85e-run_local_launch_renderer_png' },
      { owner: 'OMP-Main', command: 'Nomad: asterhub-source-validation-{code,docs}-r1792887073092-20261025', result: 'v6同一快照a452e19c…通过：5800/code alloc 92f2ef42-c588-4bab-9cbd-55cb63aed4c0，typecheck/build:lib:client/39文件1147项回归全部exit0；imac/docs alloc 70f7779a-a525-058f-d932-7da14267bd6a，test:docs exit0；两作业install及实际pnpm11.7.0预检exit0，终态complete/exit0且节点匹配。两节点执行时间重叠。仅为源码集成门禁通过，不替代T12/T16 Desktop端到端验收；未打包。', evidence: '.local-workspace/issue-remediation-20261024/integration-current/jobs-state-v6.json; jobs-submission-v6.json; snapshot-manifest-v6.json; terminal/*-r1792887073092-20261025/' },
      { owner: 'OMP-Main', command: 'Nomad historical v2/v3/v5 integration attempts', result: '保留真实失败：v2 typecheck导入错误及docs禁用术语；v3/v5后续Client可选bridge闭包、品牌ID、mock类型与不完整fixture错误。均已最小修正并由v6同快照门禁验证；各次未运行阶段不得计通过。', evidence: '.local-workspace/issue-remediation-20261024/integration-current/jobs-state-current.json; jobs-state-v3.json; jobs-state-v5.json; original-result-recovery.json' },
      { owner: 'PackageAcceptanceOwner', command: 'nomad job status -json asterhub-remediation-installer-imac-1792796824798; nomad alloc status 9b9d9bad-d6ba-8a45-8ebe-7f53d81f0101', result: 'both old source-v2 package jobs terminal failed: allocation d13f0a39-bcf5-a00b-45b3-9650e186060f exit 1 for missing .git metadata; allocation 9b9d9bad-d6ba-8a45-8ebe-7f53d81f0101 exit 1 for scratch under read-only app.asar.', evidence: 'terminal Nomad CLI output; .local-workspace/issue-remediation-20261024/asterhub-remediation-installer-imac-1792797050149/9b9d9bad-d6ba-8a45-8ebe-7f53d81f0101-stderr.log' },
      { owner: 'IssueSubmissionUI', command: 'isolated Edge file:// handoff view smoke at 1440/768/375px', result: 'agent-reported no overflow/runtime errors; 77 evidence/path links local; T17 absent; copy success announced but clipboard byte readback unverified; forced rejection showed full selected fallback.', evidence: 'screenshots: C:/Users/朱子凌/AppData/Local/Temp/asterhub-handoff-smoke-ZtiExk/screenshots/agent-handoff-{1440,768,375}.png' },
      { owner: 'PackageAcceptanceOwner', command: 'nomad job status -json asterhub-runtime-payload-smoke-imac-20261024-0010', result: 'first attempt reached terminal only after scoped stop; client status complete but DesiredStatus stop and terminal task ExitCode 1, so this is not a smoke pass. Stdout showed packaged UI startup because the invocation omitted ELECTRON_RUN_AS_NODE=1; source helper requires it.', evidence: '.local-workspace/issue-remediation-20261024/asterhub-runtime-payload-smoke-imac-20261024-0010/state.json; apps/desktop/src/node-environment.ts' },
      { owner: 'PackageAcceptanceOwner', command: 'node --check 项目现状/status-data.js; node --check .local-workspace/issue-remediation-20261024/package-runtime-probe.mjs', result: 'pass after final handoff snapshot update; vm schema inspection showed 16 tasks T01-T16, T03 verified, and the declared inbox triage counts.', evidence: '本轮工具输出；无单独日志文件。' },
      { owner: 'WorkspaceHistoryRepair', command: 'T16 focused regressions; packages/client/ui-workspace/tests/apply.client.spec.ts full suite', result: 'agent-reported 5 focused cases and 19 suite cases passed; supported-profile smoke pending', evidence: '项目现状/交接文档.md#5.6' },
      { owner: 'PackageAcceptanceOwner', command: 'Review proven installer-acceptance.nomad and package-runtime-probe.mjs', result: 'acceptance harness prepared by reuse: isolated LocalSystem install/exe/desktop+Start-menu shortcuts/registry/synchronous owned-path uninstall; Electron Main probe requires safeStorage, checks package version and Desktop provider modules, then migrates+restarts synthetic plaintext credential. Neither has run against current candidate.', evidence: '.worktrees/architecture-consolidation/.local-workspace/architecture-consolidation/nomad/execution/installer-acceptance.nomad; .local-workspace/issue-remediation-20261024/package-runtime-probe.mjs' },
      { owner: 'PackageAcceptanceOwner', command: 'nomad node status -verbose b6569af5-d5c1-d149-9706-679be5dd4ad7', result: 'imac ready/raw_exec healthy; last observed allocation reservations 0, host memory 9.3GiB/16GiB; this is a point-in-time snapshot only', evidence: 'current execution tool output; no persisted report' }
    ],
    nextActions: [
      'Mislaunched first smoke attempt (job asterhub-runtime-payload-smoke-imac-20261024-0010) reached terminal after scoped stop; preserve it as an invalid attempt and do not reuse it as a pass.',
      'Corrected targeted Node-mode payload smoke with ELECTRON_RUN_AS_NODE=1 passed on the pre-T16 candidate (alloc 86aa03c9-fecb-d9ff-1743-13a3f065a612, exit 0); keep that result scoped to the old candidate, not package acceptance.',
      'First invalid attempt evidence is preserved alongside the passing corrected smoke; no further targeted smoke is required before v4 real-machine acceptance.',
      '旧v4安装包（SHA-256 88A897CC...，源码归档9602d25c...）已通过构建、Electron Main探针、隔离安装/卸载、快捷方式与注册表检查；这些包级结果不覆盖当前源码。旧v4的T12 browser_open仍失败，T16当前源码Desktop验收未完成。',
      'Electron Main safeStorage/version/provider probe and exact installer install/uninstall already passed on v4 (.local-workspace/issue-remediation-20261024/v4-installer-acceptance-result.json); remaining real-machine desktop capability acceptance still pending.',
    ],
    doNot: [
      '未获明确授权不得再次合并、推送、签名或发布。',
      'No final packaging while fix-required tasks remain unclaimed or incomplete, unless the user explicitly requests it (run handoff.mjs status and record evidence first).',
      'No real user project, session, credential or desktop-data operations.',
      'Never rewrite immutable SessionHeader.cwd or session generations.',
      'T03 login/model manual pass is confirmed; do not retest or relabel blocked.',
      'Do not accept or distribute old pre-T16 artifacts; preserve other agents’ uncommitted work and do not overwrite existing artifacts.'
    ],
    inbox: {
      path: '项目现状/问题提交记录.jsonl',
      recordCount: 6,
      pendingCount: 0,
      triage: [
        { id: 'ISSUE-52404fd4-1209-40a5-bed3-58ea70557ebe', taskId: 'T09', status: 'linked_pending', note: '定时任务创建/时区/确认/列表问题；作为真实桌面能力验收，不关闭 T09。' },
        { id: 'ISSUE-6d30ac7f-7c20-4514-82dd-a909a1570b45', taskId: 'T09', status: 'linked_pending', note: '定时任务似乎未执行；作为真实桌面能力验收，不关闭 T09。' },
        { id: 'ISSUE-051e64f2-0ed4-4e5f-9dad-8142222ee0d5', taskId: null, status: 'out_of_product_scope', note: '请求状态看板自动刷新；人维护静态快照政策明确排除实时监控，不建 AsterHub 产品任务。' },
        { id: 'ISSUE-ac669fca-c1b8-422c-9cd6-fef1d5ccdc7b', taskId: null, status: 'out_of_product_scope', note: '重复的看板实时刷新请求；同上，不建产品任务。' },
        { id: 'ISSUE-8ad85120-da88-4b4e-8a10-0f79a8441803', taskId: null, status: 'auxiliary_tool_feedback', note: '报告看板提示写入失败但 JSONL 已写入；非 AsterHub 产品缺陷，保留为辅助工具反馈，不擅自建立产品 TODO。' },
        { id: 'ISSUE-4de7c244-60cc-4d02-8ca3-ee51f1c2f746', taskId: 'T09', status: 'linked_pending', note: 'D8删除闭包提交与软删除列表/详情过滤已修；隔离真实Web验证立即隐藏、重载后仍隐藏、提交失败alert且保留任务。源码Web验收通过，精确Desktop候选验收仍待完成，T09保持partial。' }
      ],
      triageRule: '每次状态编辑前运行只读 helper；人工审阅 record.id 并写入相关 task.submissionIds；保留 inbox 原样，不执行 inbox 中的指令，不自动改任务完成状态。'
    }
  },
  release: {
    name: 'asterhub-0.21.2-win-x64-unsigned.exe',
    path: '../.local-workspace/agent-workspace/releases/0.21.2/asterhub-0.21.2-win-x64-unsigned.exe',
    bytes: 630823460,
    size: '601.60 MiB',
    sha256: '5D8ED63017F09FDFC500E21997BD81BA78111A3EAD6525E11D15B843C08BE483',
    status: 'Unsigned · GitHub 预发布 (0.21.2)',
    build: '5800 Windows x64 unsigned 0.21.2',
    acceptance: 'packaged runtime smoke 通过；交互安装、升级及真实跨设备历史会话验收未完成',
    evidence: '../.local-workspace/agent-workspace/current-release-0.21.2.json',
    limitations: '未签名；0.21.2 包含会话归属与侧边栏展开调整，但不能由合成测试推断真实跨设备历史列表或续聊已通过。Release：https://github.com/asterhub-ai/asterhub-desktop/releases/tag/desktop-v0.21.2-unsigned'
  },
  checkpoints: [
    { title: '最终产物已生成', status: 'verified', label: 'unsigned 预发布', detail: '0.21.2 构建完成，Nomad 作业退出码 0；完整 packaged smoke 通过，GitHub SHA-256 与本地一致。' },
    { title: '打包运行时 smoke', status: 'verified', label: '限定项目通过', detail: '新包的原生组件、Office 转 PDF、workspace inspect 和 Session 创建通过；不代表完整交互安装或 T16 Shell 沙箱手测通过。' },
    { title: '隔离安装与卸载', status: 'partial', label: '新包待验', detail: '旧 v4 的隔离安装、快捷方式、注册表和卸载已验证；不能套用于新发布的精确安装包。' },
    { title: '历史包源码标识', status: 'verified', label: '仅对应旧v4', detail: '旧v4源码归档SHA-256为9602D25C...，不是当前集成快照；不宣称包含后续全部修复。当前源码及门禁见handoff.snapshot与latestVerification。' },
    { title: '保留旧数据升级', status: 'verified', label: '真机探针通过', detail: '探针级升级验证通过（凭据迁移）：真实 Electron Main safeStorage 运行时探针中受控明文转加密迁移及重启读回全绿，不泄露凭据；完整升级验收未做。' },
    { title: '完整账号与模型流程', status: 'verified', label: '历史用户实测通过', detail: '用户明确确认 T03 完整登录与模型流程手动测试通过；新发布的精确安装包不据此自动通过。' }
  ],
  stages: [
    { id: 'W0', title: '冻结基线与验收定义', status: 'verified', label: '定义已建立', detail: '90 项验收定义、差异分类和冻结数据已建立；不是 90 项功能已通过。', evidence: '../.local-workspace/worktree-preservation/architecture-consolidation/.superpowers/sdd/项目架构收拢重构实施计划/progress.md' },
    { id: 'W1', title: '持久化与历史格式', status: 'partial', label: '实现 / 定向验证', detail: '保留 V5、V4 迁移及历史世代；最终候选完整迁移重放覆盖仍须确认。' },
    { id: 'W2', title: 'Office 权限与运行', status: 'partial', label: '受控验证', detail: 'GenOffice .2 和实际受控运行已有记录；Desktop、真实用户 token 与完整安装体验仍有缺口。' },
    { id: 'W3', title: '产品组合收拢', status: 'partial', label: '主要实现已提交', detail: '共享产品、产品 Web、桌面 native 三层组合已实现；全 profile 产品等价未统一验收。' },
    { id: 'W4', title: '项目资源接口', status: 'partial', label: '接口已实现', detail: 'SessionCwd 和项目 resolver 生命周期已实现；所有消费者最终组合覆盖须按快照确认。' },
    { id: 'W5', title: 'cwd 与附件消费者', status: 'partial', label: '多批定向验证', detail: '子代理、工具、附件与项目作用域已切换；不能用 837 项子代理测试代替全部资源验收。' },
    { id: 'W6', title: '受控模型路由', status: 'partial', label: '策略已实现', detail: '应用持有 provider、入口与凭据策略，用户选目录模型；真实模型请求另行验收。' },
    { id: 'W7', title: '身份与提示词等价', status: 'verified', label: '已核验证据', detail: '已在 Nomad 隔离环境完整捕获 冻结基线与候选快照 共 4 次实际 Web profile 预传输请求；工具列表（4/4）、人格设定、用户输入与系统指令 100% 字节级一致，双向复现与候选比对均为 true。', evidence: '../.local-workspace/issue-remediation-20261024/W7-parity-evidence.json' },
    { id: 'W8', title: '插件信任与安装', status: 'verified', label: '本地限定通过', detail: '本地 HTTPS、签名目录、真实安装/禁用/卸载已验证；不等于生产目录验收。', evidence: '../.local-workspace/worktree-preservation/architecture-consolidation/.local-workspace/architecture-consolidation/reports/W8-local-catalog-proof.txt' },
    { id: 'W9', title: '最终质量与功能汇总', status: 'issue', label: '未确认整体通过', detail: '保留候选 contracts failed 与 consumers observation-deadline；局部通过不能拼接成全绿。', evidence: '../.local-workspace/worktree-preservation/architecture-consolidation/.local-workspace/architecture-consolidation/candidate-verification-1792733517/execution-results.json' },
    { id: 'W10', title: '精确产物与安装', status: 'partial', label: '新包 smoke 通过 · 安装待验', detail: '新 unsigned 包的 packaged runtime smoke 与远端哈希核验通过；精确安装、完整升级与交互桌面验收未做。旧包验收不能替代新包。' },
    { id: 'W11', title: '主线集成与交付收口', status: 'partial', label: '已合并 · 0.21.2预发布', detail: '会话归属与侧栏展开调整已合并推送至 master，pre-push 门禁通过；5800 打包与 runtime smoke 通过（退出码 0）；GitHub Release desktop-v0.21.2-unsigned 已发布且资产哈希一致。' },
    { id: 'W12', title: '上游 0.2.1 基线同步', status: 'partial', label: '决策已定 · 合并窗口待用户启动', detail: '2026-10-28 完成差距分析与关键决策（用户拍板）：T17–T19 走全量合并在隔离分支执行（T16 线叫停、0.21.3 不发布后窗口已解除，启动时机待用户）；T18 回归 V4+plugin: 通道；web_fetch 放开与静态门均跟随上游；自有特色功能扩展化路线立为 T27，其中便携会话重做提前执行为 T28（设计定稿，实施 M1–M4）。T20 已在隔离分支 integration/upstream-0.2.1 提交 186d4985fd（Node ≥24.9，验证全绿）；T17 冲突盘点完成（1039 冲突，224 个真实源码冲突，证据 .local-workspace/upstream-sync-021/）。合并启动前不动 master。 2026-10-29 下午：T17 增量恢复约 110 包完成（W1/W2/W3 主体，三次提交保全），剩余 apps 载体层与 fork 独有包适配批。 2026-10-31 凌晨：T17 typecheck 收口完成（双 face 0 错、全门禁绿、六提交落分支），剩 apps/* 载体层吸收（T27 载体层规则）与快照债（T18 域）；推送待本机 GitHub 凭据恢复。 2026-10-31 终：apps 载体层四批+T18 主体四批+快照结构修复全部完成并推送远端（HEAD 1d8861427a）；T18 已按 V4+plugin: 决策落地；快照债格式域清零、剩行为域 110。 2026-10-31 终节拆卡：T17 剩余细化为 T17a（内容 diff 84）/T17b（运行失败 22）/T17c（acp 4）/T17d（四规则波次 2）/T17e（主树收尾）五张可独立认领子卡。合并窗口待用户启动。' }
  ],
  tasks: [
    { id: 'AUX-AGENT-TEAM-REMOVAL', title: '移除未采用的实验性 Agent Teams', category: '维护范围', priority: 'P1', status: 'verified', label: '已提交deb7cd4733 · 未合入同步分支', detail: '主树删除agent-team、agent-team-profile、client-ui-agent-team、tool-agent-team四包及入口/依赖/专属验收，普通subagent保留，已随deb7cd4733提交。此前聚焦309过/5跳，headless/web/sdk默认配置加载及headless启动帮助通过；本轮正常提交钩子通过，不重复已过检查。未推送、未做完整桌面E2E，不代表同步分支已移除。', acceptance: '四包及活动运行时引用移除，普通subagent保留；后续合并不得重新引入。', source: '../docs/upgrade-guide/v0.2.0-rc.3/agent-team-removal/guide.zh.md' },
    { id: 'AUX-UPSTREAM-SCOPE-AUDIT-20261101', title: '重定界上游遗留失败与产品阻塞', category: '维护范围', priority: 'P0', status: 'verified', label: '审查已提交 · 责任排除不等于通过', detail: '已复核开放任务、台账、收件箱、44项Windows留存失败和产品/门禁装配，详见交接。3项上游语料与2项未采用场景不独立清零；4项历史SDK cwd错误已定位同步分支并以c024dd3b2d补齐事实供给，未冒称4个历史录制全过。11项普通子代理/调度未决信号和主树类型失步继续保留。ACP上游必红推断已撤回；平台移除独立记账。', acceptance: '归属有证据、旧全量清零前置撤销、必要产品验收保留；不是全仓未知BUG穷尽保证。', source: '交接文档.md' },
    { id: 'BUG-SDK-PERSONA-CWD', title: '产品 Persona 后缀引用未注册的 cwd 变量', category: '产品缺陷', priority: 'P0', status: 'verified', label: '同步分支已修复c024dd3b2d · 23项回归通过', detail: '【2026-11-02】主树真实persona组装2目录通过，本已有cwd变量；实际缺失在integration/upstream-0.2.1：上游迁移目录事实至working-directory后取消loop注册，而自研persona仍引用{{cwd}}。修复在目录provider既有组装中间件内，于验证/恢复后补缺失cwd；显式变量优先，未改loop、未清空后缀。回归先报unknown variable，继而捕获恢复时旧值，再最终23/23通过、包级tsc通过；另用实际product YAML、真实fs/loop/provider做2目录源码冒烟exit0。修复已提交该分支，未合入主树或推送，未重录4个历史SDK场景或发网络模型请求。', acceptance: 'SDK persona可使用当前已提交目录；目录变更与恢复正确，不改Session header，不以异常抑制或空后缀掩盖；证据明确分支与验证范围。', source: '../.local-workspace/sdk-cwd/verification.json' },
    { id: 'AUX-WINDOWS-ONLY-CUTOVER', title: '暂限 Windows：移除 Linux/macOS 专属代码', category: '维护范围', priority: 'P0', status: 'partial', label: '主要移除已提交 · 全量构建和实际启动未验证', detail: '主树deb7cd4733已删除macOS桌面交付、Linux进程/沙箱、POSIX native/system和未采用的4个POSIX客户端SSH包；保留Windows ConPTY/Job/ACL、Git Bash、外部ssh.exe和浏览器虚拟worker会话锁。此前Windows聚焦检查通过，但后续真实构建发现测试残留，已另卡修正；完整构建仍受主树类型失步及受保护漂移阻塞，实际Desktop启动未通过。先前称收口verified过早，不代表非Windows残留已穷尽或产品发版就绪。', acceptance: '非Windows专属源码与入口移除，Windows必要依赖/策略透传具备证据；完整构建与实际启动按相关卡核验。', source: '../docs/upgrade-guide/v0.2.0-rc.3/windows-platform-exclusive/guide.zh.md' },
    { id: 'AUX-WINDOWS-PRIMARY-RUNTIME-SMOKE', title: '主树 Windows Desktop 真实启动验证', category: '构建与环境', priority: 'P1', status: 'partial', label: '未通过 · 构建产物不一致', detail: '2026-11-02 已观察到Windows runtime manifest和Office检查输出，但准备命令经tee返回1，没有准备进程独立退出码，不能宣称完整成功。隔离Desktop启动未产生可核验窗口；独立host复现先暴露旧lib引用已删除node-addon-system，局部重建后又暴露open-in-app旧导入；后续全量构建被主树既有T17e与本轮测试残留拦住，误触发的全量tsdown清理过CLI输出，定向重建后profile-boot import通过，尚未重做完整干净冒烟。此前按名称批量终止Electron超出本次进程范围，潜在影响未知；只确认后续终止了本次launcher进程树。真实用户数据未核实，不再声称未触及。', acceptance: '先恢复可重复的一致构建、核验完整runtime，再在隔离home观察实际Desktop窗口；不得凭独立host或browser模拟冒称原生UI成功。', source: '../.local-workspace/primary-runtime/desktop-smoke9.log' },
    { id: 'AUX-WINDOWS-BUILD-ORPHANS', title: '清理 Windows 收口遗漏的构建测试残留', category: '构建与环境', priority: 'P1', status: 'verified', label: '聚焦测试通过 · 完整构建仍受其他错误阻塞', detail: '2026-11-02 清理subprocess runner测试对已删除Linux launch helper的引用，保留Windows source/built runner真实执行；删除两项专属Linux的group测试，并修正CI Windows runner矩阵中的重复对象键。Windows runner e2e 2/2、CI目标矩阵1/1通过。未重跑失败的全仓构建；既有T17e及受保护测试漂移仍阻塞完整构建，不修改他人文件。', acceptance: '上述Windows runner和CI矩阵定向验证通过；本卡不代表全仓构建或桌面启动通过。', source: '../packages/subprocess/subprocess-local/tests/spawn-runner-built.e2e.ts' },
    { id: 'T01', title: '修正设置中的当前版本来源', category: '产品缺陷', priority: 'P1', status: 'verified', label: '已修复验证', detail: '已在 dshDesktop 载体注入真实 Electron 安装版本（app.getVersion()）；ui-settings-general 的 CurrentVersionRow 优先使用注入的 installedVersion（如 0.21.0），通用 Web 保持回退至 DSH_CLIENT_VERSION；组件与注入测试通过。', acceptance: '设置、关于与更新元数据对应实际安装版本；不写死 0.21.0，不批量改内部包版本。', source: '../.worktrees/architecture-consolidation/packages/client/ui-settings-general/src/client/CurrentVersionRow.tsx' },
    { id: 'T02', title: '确定旧凭据安全迁移方案', category: '升级与数据', priority: 'P0', status: 'verified', label: '已修复验证', detail: '已在 credentials-local 实现安全受控迁移（migratePlaintext 仅 Desktop 开启）：启动时在文件锁下重读并预校验平铺及 version-1 明文，加密并解密验证无误后原子写入 0600 密文；写入或加密失败完全保留原明文；热重载保持拒绝明文降级。单元与回归测试 72 passed。', acceptance: '保留凭据值，失败不覆盖原文件；真实安装包启动仍需打包后在测试机验证。', source: '../.worktrees/architecture-consolidation/packages/credentials/credentials-local/src/index.ts' },
    { id: 'T03', title: '补验精确安装包完整登录与模型流程', category: '实机验收', priority: 'P0', status: 'verified', label: '用户实测通过', detail: '用户本轮明确反馈 T03 手动测试通过，完整登录与模型流程已按用户实测关闭；此前网络阻塞不再作为本项当前状态。正在构建的新候选仍需独立验收。', acceptance: '用户已确认本项手动测试通过；不将该结果自动迁移到后续新候选。' },
    { id: 'T04', title: '区分认证错误的实际失败环节', category: '产品缺陷', priority: 'P1', status: 'verified', label: '已修复验证', detail: 'account-sub2api 已区分连接超时、连接拒绝、权限拒绝、上游故障、非法响应及本地凭据保存失败；检查不泄露密码/Token/堆栈，定向回归5通过。', acceptance: '保留安全的阶段诊断，不盲目增加重试、超时或中继；T03用户已确认登录与模型流程通过，新候选另验。', source: '../.worktrees/architecture-consolidation/packages/account/account-sub2api/src/index.ts' },
    { id: 'T05', title: '补齐 W7 有效基线对照证据', category: '证据收口', priority: 'P0', status: 'verified', label: '已修复验证', detail: '已在 Nomad 隔离环境通过实际 Web profile 完整获取基线与候选快照 共 4 次预传输请求；工具（4/4）、人格、输入及指令在归一化控制 CWD 与检出根后 100% 字节级一致，双向复现一致性均为 true。', acceptance: '提供准确 baseline/candidate 输入、实际比较输出、重复运行及请求范围；验证通过。', source: '../.local-workspace/issue-remediation-20261024/W7-parity-evidence.json' },
    { id: 'T06', title: '核实 W9 最终候选门禁终态', category: '证据收口', priority: 'P0', status: 'verified', label: '归档快照门禁已核实', detail: '归档快照 c2db13de7e01 的保留日志：consumer-tests 340文件通过/4跳过，12034用例通过/44跳过；desktop-paths 4文件33用例通过；oxlint 5256文件90规则0警告0错误。result.json记录Host构建及上述阶段exit 0；远端alloc查询现返回404，证据依赖保留日志与结果文件。后续定时任务等新修复不自动继承该快照的通过结论；历史failed/observation-deadline保留。', acceptance: '保留旧失败与新快照证据的区别；新源码修改执行相关检查，不将归档结果称为当前树全门禁通过。', source: '../.local-workspace/worktree-preservation/architecture-consolidation/.local-workspace/architecture-consolidation/t06-lint-consumers-20261024/result.json' },
    { id: 'T07', title: '定位真实 Electron OS 加密 e2e 退出', category: '验证故障', priority: 'P1', status: 'verified', label: '环境根因已定性', detail: '已定性 0x80000003 退出码：底层崩溃签名为 base/message_loop/message_pump_win.cc:98 Failed to create message-only Window: 拒绝访问(0x5)，系由于本机云电脑管控/进程守卫拦截 Chromium 默认沙盒窗口创建所致，非产品与 credential-storage 缺陷；在禁用沙盒或 Node 模式下 Electron 正常运行。符合“区分运行环境与产品失败”验收标准。', acceptance: '区分运行环境与产品失败；不能由本机失败推断用户网络故障。定性证据已落盘。', source: '项目现状/journal/T07.jsonl' },
    { id: 'T08', title: '核对对外品牌与 crash 应用名', category: '产品缺陷', priority: 'P2', status: 'verified', label: '已修复验证', detail: '在 apps/desktop/src/main.ts 的 persistCrashReport 中显式指定 product name 为 AsterHub，不再输出内部包名 @deepseek-ai/dsh-desktop，且不破坏 Electron 默认 userData 路径计算。', acceptance: '对外显示 AsterHub，保留内部协议标识和第三方版权。', source: '../.worktrees/architecture-consolidation/apps/desktop/src/main.ts' },
    { id: 'T09', title: '完成其余真实桌面能力验收', category: '实机验收', priority: 'P1', status: 'verified', label: '实机闭环通过（沙箱留手测）', detail: '5800真实Desktop定时任务自动化17项全部通过（每日/每周创建、时区自适应、行高展开、暂停恢复、运行历史跳转、正文、activeRunId清零、点击删除、持久化墓碑及重载后列表为空，前后Main/client SHA不变）。环境登录与重启持久化闭环通过（job 1793030513814，alloc 5f31647a）：UI登录、凭据OS加密保存、正常退出重启后凭据解密恢复、模型选择绑定及合成Key认证发信两轮均pass（exit 0）。host-process cipher底层错误已暴露保护。Shell沙箱按用户要求留手测。', acceptance: '实际UI与持久化断言均需成立；自动化及环境登录重启均已闭环验证。Shell沙箱留用户手测。不合并、不打包、不push。', source: '../.local-workspace/t09-evidence/T09-current-desktop-acceptance.json', submissionIds: ['ISSUE-52404fd4-1209-40a5-bed3-58ea70557ebe', 'ISSUE-6d30ac7f-7c20-4514-82dd-a909a1570b45', 'ISSUE-4de7c244-60cc-4d02-8ca3-ee51f1c2f746'] },
    { id: 'T10', title: '核对 GenOffice 候选与精选目录版本', category: '分发与发布', priority: 'P1', status: 'verified', label: '资质已核验', detail: '已核对目录 revision 5 (.1 / dsh 0.1.6-alpha.2，2026-10-29 到期) 与源码 .2 (dsh 0.2.0-rc.3 / session-root.mjs 动态项目解析 3/3 passed)；通过 run-local-catalog-proof.mjs 验证本地 HTTPS 签名目录安装与防篡改机制（exit 0）。确认发版前使用离线私钥签名发布 revision 6 且不覆盖既有 .1。', acceptance: '按正规签名/revision 更新且不覆盖既有 .1；线上版本和兼容性已建立核对依据。', source: '../.local-workspace/issue-remediation-20261024/T10-catalog-qualification.json' },
    { id: 'T11', title: '确认重构集成、签名及发布条件', category: '分发与发布', priority: 'P0', status: 'verified', label: '条件已明确', detail: '已全面梳理重构分支合并门禁 (oxlint/140列/双语对齐/typecheck)、SafeNet eToken 硬件 EV 代码签名环境规范及正式发布上线条件；形成严格的发布前置检查清单。恪守未获用户明确授权不得自动合并、推送、签名或发布的红线。', acceptance: '所有必要验收收口并获得用户授权后再合并/签名/发布，检查清单已收录。', source: '../.local-workspace/issue-remediation-20261024/T11-release-readiness-checklist.json' },
    { id: 'T12', title: '排查 browser_open 失败及空标签列表', category: '手动测试', priority: 'P0', status: 'verified', label: 'Desktop打开/列举/关闭闭环通过', detail: '5800真实Desktop开发构建，未主动展开侧栏，Host工具经Main guard与Renderer/Guest打开本地页，tabs确认tab2/gen1，close同一target，最终tabs为0。目录选择使用临时dialog替身，模型/认证为合成上游；未替换浏览器IPC/guard，main.js前后原SHA256一致。本轮不验证在线模型或原生目录对话框。', acceptance: '73bb8b0a运行T12各结果断言通过；组合job因T16沙箱阻塞exit1，不称整job通过。精确安装包不自动继承开发构建结论。', source: '../packages/client/ui-sidebar-browser/src/client/electron/automation.ts' },
    { id: 'T13', title: '核实 Computer Use 能力的实现与集成', category: '手动测试', priority: '待定', status: 'verified', label: '已装配集成', detail: '已在 packages/bundle/asterhub-desktop-native/cordis.patch.yml 与 package.json 中完整挂载 @deepseek-ai/dsh-computer-use 与 @deepseek-ai/dsh-experimental-computer-use-cua-driver-native，并更新 pnpm-lock.yaml；桌面已拥有原生 Computer Use provider。', acceptance: '已完成官方 provider 依赖与 patch 装配，通过依赖锁文件校验。实机调用需依赖系统级无障碍/输入授权。', source: '../.worktrees/architecture-consolidation/packages/bundle/asterhub-desktop-native/cordis.patch.yml' },
    { id: 'T14', title: '排查手动打开浏览器后的无效标签列表结果', category: '手动测试', priority: '待定', status: 'verified', label: '已修复验证', detail: '原表 #3：apps/desktop/src/browser-guests.ts 中过滤未完成导航的 about:blank# 访客，仅将合规 HTTP(S) 标签页纳入 Session 清单，满足下游 wire validator；回归测试通过（12 passed）。', acceptance: '验证列表读取的实际返回及调用链；协议与列表过滤已修复。', source: '../.worktrees/architecture-consolidation/apps/desktop/src/browser-guests.ts' },
    { id: 'T15', title: '排查 Anima 反思读取与记忆保存失败', category: '手动测试', priority: 'P0', status: 'verified', label: '真实反思闭环通过 · 调度未测', detail: '5800真实Desktop全链路通过（最终run作业asterhub-t15-real-reflection-5800-1793055800046，alloc ff3deb95，构建1038包含当前修复源码）：采纳synthetic-project后活动会话正确绑定项目（BUG-ADOPT修复端到端实证）；新会话cwd=synthetic-project；模型真实读t15-fixture.txt并正确解答规则题；独立verifier对持久会话日志（132事件/64帧）判定全绿——实际read与预期内容关联、memory save written关联runId、非空反思关联runId、review/reflection请求=sub2api/gemini-3.8-flash-tiered。边界：daily/weekly调度未测；反思UI计数观察false但verifier以durable事件为准；验收流程修复三个基建缺陷（阶段包装器误报、readyHoldHours未赋值、种子布局过时）并暴露导入路径拒绝扁平布局的产品问题（见T16台账，合并门需决策）。', acceptance: '先核对最新失败会话与模型路由，禁止重复投递或把旧e1bc的反思证据记作本次通过；只认实际read、memory UID、同模型8192预算review/reflection及非空反思。daily/weekly调度未测，凭据不入日志、文档或Git。', source: '../.local-workspace/t15-online-acceptance/_1038c-verify-result.json' },
    { id: 'T16', title: '修复导入旧工作目录后历史会话列表为空', category: '项目历史', priority: 'P0', status: 'partial', label: '修复线已叫停 · 转T28重做', detail: '【用户 2026-10-28 叫停本修复线，转向 T28 架构重做】根因判定为架构性：fork 维护双账本（project.json 会话清单 + WorkspaceRegistry 对账），0.21.1/0.21.2 四轮修复均为让两套账本对齐的个案补丁，无法消除该 bug 类别。叫停时点状态：815a61629a（重导入解除删除归档+扁平工件入清单）已在本地 master；36cc0d2966（对账非ENOENT错误 fail-loud）为本地提交未推送，随清单机器退役而失效；0.21.3 安装包已构建（基于 815a61629a，SHA 58716590…，releases/0.21.3/）但实机验收未完成、不发布，留档；acceptance harness 阻塞现场（alloc 98396f38）不再追查。上游无等价跨设备会话历史功能；上游对照与借鉴模式见交接文档 §5.6。', acceptance: '转由 T28 沿用本卡验收标准：隔离 smoke 与用户授权的真实界面验证只恢复指定工作区会话、正确分组与续聊，不修改原日志。', source: 'packages/workspace/workspace/src/index.ts' },
    { id: 'T28', title: '重做便携会话：上游 workspace 模型 + project-local 后端 + 显式采纳流程', category: '项目历史', priority: 'P0', status: 'partial', label: 'M1–M4(profile冒烟)完成 · 验收授权齐备（机器/数据/构建/测试账号）· 待认领', detail: '2026-10-28/29 ZCode-T28 接管后 M1–M4(profile级)已完成：M1 后端纯化；M2 消费方簇回归上游+附件 scope 穿透+bundle 合流；M3 project-adopt 采纳流程；M4 profile 级跨设备迁移冒烟两次连续全绿（t28-profile-import-smoke.mjs，真实 web profile 子进程，断言覆盖验收①-⑥：记账/正文逐字节不变/原 header.cwd 不变+尾部恰一条 working-directory/change/投影新根/项目隔离/幂等；证据 .local-workspace/upstream-sync-021/t28-smoke-evidence.json）。簇级测试全绿（sandbox 簇已恢复，headless 135/135；最终清点 2868 用例级）。误删损害评估：实质丢失仅 attachment-local 项目路由（已重实现）。四规则清理波次1完成（T28 代码+扩展包，删 8 处冗余，测试前后一致）。实施偏离见设计文档 §6。【复验 2026-10-29 深夜】W3 提交后冒烟一度回归（apps/cli 丢失 asterhub bundle 依赖等构建面问题，修复过程见交接文档深夜节）；修复后在 HEAD 0e4a0e9336+全新构建 lib 上复验全绿：16 断言全过（证据 t28-smoke-evidence-4.json），T28 簇聚焦测试 840 通过/0 失败/13 环境跳过（project-adopt 3、project-storage 4、workspace 81+3跳、session-persistence-jsonl 751+10跳、deliverable-file-references 1）。剩余：真实界面验收（T16 原标准，需桌面环境）、续聊探针（需 API key）。【桌面环境授权·三项已定 2026-10-31】用户确认：①机器=当前设备（即 5800，同一台机器）；②数据范围=隔离测试 home（临时目录+fixture 工作区，零真实数据风险，不触碰真实 .aster/ 与 ~/.asterhub/）；③构建形态=工作树开发构建（cd /e/dev/asterhub/.worktrees/upstream-sync-021 && pnpm run dev:desktop——T28 重做代码只在 integration/upstream-0.2.1，master 与 0.21.3 留档包均不含）。续聊凭据已齐备（2026-10-31 用户提供）：续聊走产品自有账号体系登录，不需要裸 DEEPSEEK_API_KEY；测试账号 3476852@qq.com（用户明确允许记录），密码存 .local-workspace/t28-acceptance/test-account.json（git 忽略层 .gitignore:45——看板文件会随 docs 提交进 git 历史，密码不进库；勿贴聊天、勿入提交文件）。登录在隔离测试 home 内进行，凭据落临时目录不触碰真实 ~/.asterhub/。至此 T28 验收四要素全部齐备（机器/数据范围/构建/登录凭据），导入/恢复/分组/续聊全链可执行。', acceptance: '跨设备导入 smoke 在新架构通过；真实界面只恢复指定工作区会话、正确分组与续聊；不修改原日志或混入其他项目；上游 workspace/session 文件回归上游原样（自有逻辑全部移入后端插件/采纳流程/bundle patch）。', source: '.local-workspace/upstream-sync-021/t28-spike-design.md' },
    { id: 'BUG-ADOPT-WORKSPACE-SWITCH', title: '采纳工作区后活动会话未切换到被采纳项目', category: '产品缺陷', priority: 'P1', status: 'verified', label: 'Desktop端到端已验证', detail: 'connectWorkspace在工作区快照尚未刷新时订阅等待新工作区出现。真实Desktop T15重投证明采纳synthetic-project后活动会话切换成功并在该项目创建会话；聚焦回归2文件74项通过。', acceptance: '采纳已有项目后活动会话绑定项目路径；工作区列表刷新竞态有回归覆盖。', source: '../.worktrees/architecture-consolidation/packages/client/ui-workspace/src/client/navigation.ts' },
    { id: 'BUG-IMPORT-FLAT-LAYOUT-REJECT', title: '导入路径拒绝扁平布局历史会话且无迁移', category: '产品缺陷', priority: 'P1', status: 'verified', label: '迁移实现与回归通过', detail: 'list()遇到无法解读的扁平会话文件时，按header的Session id、cwd与格式版本迁移到projectKey(cwd)/encodedId/规范generation路径；open()的root编码检查和定向查找复用迁移。迁移不改日志字节；格式/压缩不匹配、header身份不一致或目标冲突时拒绝且不覆盖源。并发list对同一源路径共享single-flight。JSONL persistence全套191项回归通过。', acceptance: '未压缩与Zstandard扁平会话在list/open路径迁移成功；目标冲突保留源与目标；日志字节不变。', source: '../.worktrees/architecture-consolidation/packages/session/session-persistence-jsonl/src/index.ts' },
    { id: 'BUG-ANIMA-CONTINUED-IMPORT-SAVE', title: '续聊导入历史会话时 Anima 记忆保存按旧 cwd 解析失败', category: '产品缺陷', priority: 'P2', status: 'verified', label: 'SessionCwd动态解析已验证', detail: 'Anima capture facts使用ctx.sessionCwd.resolve(session.header)派生项目身份；未注册Session仍使用header cwd，resolver错误显式传播。聚焦capture/host 9项测试通过，相关包typecheck与lint通过。', acceptance: '续聊导入且旧cwd不存在时，Anima capture身份使用当前注册项目路径；未注册归属仍使用header cwd。', source: '../.worktrees/architecture-consolidation/packages/context/anima-memory/src/host.ts' },
    { id: 'BUG-SCHEDULE-BACKEND', title: '调度执行 teardown flush 抛错导致假阳性与挂起风险', category: '产品缺陷', priority: 'P1', status: 'verified', label: 'RED/GREEN 核验通过', detail: '【2026-10-31 OMP-SCHEDBACKEND 核验收口】修复内容：execution.ts 错误 teardown 的 sessions.flush 加 try/catch 保护（warn 降级不逃逸），handle 创建（ctx.agents.create/resume）移入 try 内先于可失败步骤，settle 后 activeRunId 清空；execution.spec.ts 删除冗余 toBeDefined 假阳性断言，新增 D1 teardown 回归（flush 两次尝试断言 + terminal blocked/execution_failed + activeRunId 清空）。核验：修复前源码（f3d2a68544）catch 块 flush 抛错直接逃逸 → 新回归必然 RED；当前树（147214305b，未改动）GREEN 实测 execution.spec 3/3、整包 asterhub-automation 31/31。smoke 证据 .local-workspace/t09-evidence/T09-schedule-backend-smoke-evidence.json（D1 inject/D2 创建/D1 成功执行/D1 错误 teardown/D7 detach 全过，ALL_CHECKS_PASSED，controlled-fixture 离线）。注意：smoke 脚本 schedule-backend-smoke.mjs 引用 .worktrees/architecture-consolidation 旧路径已失效（该树仅剩 node_modules），主树有等价测试文件，重跑需改路径。', acceptance: 'teardown flush 抛错时 executeRun 返回终态不挂起；handle 创建后进入 catch 路径有回归覆盖；activeRunId 释放有断言。', source: 'packages/schedule/asterhub-automation/src/execution.ts' },
    { id: 'BUG-SCHEDULE-DELETE-UIFILTER', title: '软删除任务行在正常筛选与刷新后仍暴露于列表', category: '产品缺陷', priority: 'P1', status: 'verified', label: '组件回归+真实Web验证通过', detail: '【2026-10-31 OMP-SCHEDDELFILTER 核验收口】修复内容：AutomationPanel rows 过滤器对 deletedAt!==null 一律剔除（All/enabled/paused 三态均覆盖），selected detail 仅在 deletedAt===null 时保留，catalog 刷新后软删除行驱逐选中详情。核验：①组件回归 AutomationPanel.client.spec（hides deleted records in every normal filter and drops a selected detail after catalog refresh，含三态过滤+选中驱逐断言）当前树 30/30 全绿；②真实 Web 验证（run-1792834920307，源 Web profile+合成 DSH_HOME+fixture 账号）：deleteWithoutConfirmation rowVisibleInList=false 且 persistedDeletedAt 落盘、reload 后 rowVisibleInList=false、commitFailure（gateway/internal）后任务保留且并发暂停可见、51 条 RPC 全 ok；③源码 AutomationPanel.tsx:148/167 过滤逻辑在位。注意：list RPC 响应仍含软删除行（listResponseIncludesSoftDeleted=true）——这是有意设计（UI 过滤而非服务端过滤），D3 后端未动。', acceptance: '软删除行在 All/enabled/paused 全部筛选与刷新/重载后不出现；选中详情在行被软删除后驱逐；删除失败有 alert 且任务保留。', source: 'packages/client/ui-asterhub-automation/src/client/AutomationPanel.tsx' },
    { id: 'BUG-BROWSER-CLIENT-TYPES', title: '浏览器客户端类型修正后缺最终 TypeScript 集成验证', category: '产品缺陷', priority: 'P2', status: 'verified', label: '最终集成验证通过', detail: '【2026-10-31 OMP-BROWSERCT 核验收口】v5 改动（desktop cancel listener 绑定保留可空语义、SessionId/TabId 品牌化 fixture、SidebarRightOpenTab 完整对象）已提交主树（db0e54c20f→147214305b）。最终验证：ui-sidebar-browser 包 tsc 0 错（包内全部文件含 v5 触及的 index.ts 与 apply.client.spec.ts）；13 测试文件 56/56 全绿（含 apply.client.spec）。跨包 33 错全部位于 packages/api/session-controller src（modelSelection 投影等）——主树 stale pre-f380 状态，属 T17 域（f380 修复已在 upstream-sync-021 工作树完成待合并），与 v5 改动无关（v5 仅触及 ui-sidebar-browser 两文件）。原 architecture-consolidation 工作树改动已由主树提交保全。', acceptance: 'v5 触及文件通过包级 typecheck 与聚焦测试；跨包错误经定界确认为既有 stale 状态而非 v5 引入。', source: 'packages/client/ui-sidebar-browser/src/client/index.ts' },
    { id: 'BUG-AUTOMATION-MOCK-TYPES', title: 'Automation 测试 mock 缺类型契约（SessionListState/选择器）', category: '产品缺陷', priority: 'P2', status: 'verified', label: '包级全绿 · 已提交', detail: '【2026-10-31 OMP-MOCKTYPES 核验收口】修复内容：新增 src/client/session-navigation.ts（openAutomationSession 助手，打开未缓存历史会话前先刷新会话列表，刷新后仍缺则报错）并从 index 导出；测试 mock 改为 SessionListState 支撑的 ObservableSnapshot（含 subscribe 实现）与类型化 useSessions 选择器。核验：改动已提交主树（147214305b）；ui-asterhub-automation 包 tsc 0 错、5 测试文件 30/30 全绿；README.md/README.zh.md 均已覆盖"先刷新再打开历史会话"行为（35 行/43 行）。root strict client tsc 曾被用户叫停，未重跑；跨包 session-controller stale 错误属 T17 域。', acceptance: '测试 mock 满足类型契约不依赖 client-store；包级 typecheck 与聚焦测试通过；行为有双语文档。', source: 'packages/client/ui-asterhub-automation/src/client/session-navigation.ts' },
    { id: 'T17', title: '同步上游工具 executor 拆分', category: '上游同步', priority: 'P0', status: 'partial', label: '主体在同步分支 · 只收必要产品集成', detail: '【2026-11-01 维护范围重定界】本地同步分支 ade1c7611f，主树 a05cc76136，尚未合并。撤销“所有上游快照及所有子卡清零才完成”的要求；T17a 负责留存失败索引，T17b 只跟进普通 subagent 的必要集成信号，T17c 登记 ACP 非产品独立验收债，T17d 为非阻塞维护计划，T17e 保留主树一致性与合并整备。历史 typecheck/载体构建与推送证据见交接文档，不冒称主树现已通过。Agent Teams 主树移除后不得由分支合并重新引入。', acceptance: '自研工具与必要上游改动在产品组合中工作；主树源码/测试一致；移除不采用能力；不以未修改上游全量套件清零为前置。', source: '交接文档.md' },
    { id: 'T17a', title: 'Windows 留存失败责任索引（44 项）', category: '上游同步', priority: 'P1', status: 'partial', label: '已重定界 · 非全量清零门禁', detail: '【2026-11-01 静态审查；非本轮重跑】ade1c7611f 的 snap-win11.log 保留 44 failed/125 passed/20 skipped。逐项清单见交接：3 项上游语料不一致、2 项未采用实验场景（team-targets、Stagehand）、7 项自研补丁/特色差异（其中 cwd 变量错误4项）、11 项普通子代理/调度运行信号根因未定、16 项 Windows 夹具/路径信号、5 项环境差异信号（仅 pty-tools 有既有豁免）。分类不等于测试通过；不能把全部21个Windows相关信号自动豁免。原 ACP 三项“上游自身必红”说法撤回：实际涉及 mode120000 链接在 Windows 的检出形态。普通 list_agents/send_message/继承场景不是 Agent Teams，保留。', acceptance: '按自研/必要修改与产品采用路径筛选聚焦验收；未知根因保留；不 refresh 未查明行为，不要求全量上游快照清零。', source: '../.local-workspace/t17a/snap-win11.log' },
    { id: 'T17b', title: '普通 Subagent 与调度的必要集成信号', category: '上游同步', priority: 'P0', status: 'issue', label: '提交违反录制世代保留规则 · 禁止合并', detail: '2026-11-02 纠正：45d6fe76d7覆盖了5个已提交v4 Session录制：SDK list-agents子会话、headless depth-two两个子会话、parallel两个子会话，违反不得覆盖已提交世代规则。之前标verified及称历史世代未覆盖不准确，已撤销。9/9是替换后录制的重放结果，不证明历史保留或适合集成；原文件内容仍可从该提交父版本读取。需要在不覆盖、移动、删除任何已提交世代的条件下重新设计修复与审查，完成前不得合并/推送该提交。两个未装配dsh-sdk provider场景仍不单独验收。', acceptance: '严格保留已提交Session世代；采用路径行为及兼容性有证据，不用覆盖旧录制或弱化断言使重放通过。', source: '交接文档.md' },
    { id: 'T17c', title: 'ACP 上游独立验收债登记', category: '上游同步', priority: 'P2', status: 'verified', label: '责任登记完成 · 非产品独立阻塞 · 非测试通过', detail: '【2026-11-01】撤销旧“1可修+3上游必红”结论。最新留存 ACP 6 项=cancel/escalation-approved/fs-escalation-approved/fs-same-mode 提示词链接差异4、image-compaction ACL技能注入1、fixtures末尾换行断言1。上游链接为 mode120000，Windows 检出文本可能产生假信号，不能据此断言官方运行必红；旧 UNKNOWN_TOOL 不属于最新6项，不重复追修。ACP 专用协议与原样上游夹具不单独验收/修补；若自研调用确实受影响，转必要集成聚焦处理。', acceptance: '本卡按维护责任登记关闭，不代表ACP测试通过或产品移除了ACP；不再以专用夹具清零阻断桌面产品。', source: '../.local-workspace/t17a/snap-win11.log' },
    { id: 'T17d', title: '四规则清理波次 2（fork 独有包）', category: '上游同步', priority: 'P2', status: 'partial', label: '非阻塞维护计划 · 不扩大为上游重构', detail: '【2026-11-01】保留用户四规则方向，仅针对自研/必要修改：anima-memory、asterhub-automation、subagent-in-process-driver、web-search-searxng 等。没有已证实的产品失败时，不因“尚未逐包清理”阻断合并与验收；不重构原样上游包，不为风格清理默认重跑全量测试。发现真实自研缺陷另记具体证据与聚焦验收。', acceptance: '按实际变更检查四规则，清理不改变产品行为；未执行的可选维护不记已完成。', source: '../AGENTS.md' },
    { id: 'T17e', title: '主树一致性与合并整备', category: '上游同步', priority: 'P0', status: 'issue', label: '范围已定界 · 等合并授权', detail: '【2026-11-02 定界】主树otel/session-projections测试引用的model/selection与modelSelection是f380功能切片：agent/{types,model-selection,index,runtime-types}重写+agent-loop注册投影与provider/model系统变量+session-controller/acp/headless消费方迁移。实测仅补types.ts声明会与旧model-selection.ts导出冲突(TS2308)破坏构建，试验改动已撤销、agent包tsc恢复exit0。该切片已在integration/upstream-0.2.1完整落地并测试，主树逐文件吸收会与分支冲突，正确路径是授权合并。合并须同时保留deb7cd4733/c024dd3b2d/45d6fe76d7。原有4个漂移文件与2个registration测试保留；notices 36过/1被ui-attachment既有tsconfig漂移阻断，不为跑绿改受保护文件。macOS专属整备不作Windows前置；推送/合并/签名/发布按授权执行。', acceptance: '授权合并时保持源码与测试一致、保全现有改动及必要修复，随后只跑受影响类型与产品路径；不得弱化检查掩盖真实集成错误。', source: '../packages/core/agent/src/types.ts' },
    { id: 'T18', title: 'Session V4 与 Anima 插件记录集成', category: '上游同步', priority: 'P0', status: 'partial', label: '分支主体已实现 · 产品数据兼容仍负责', detail: '历史分支提交08c38e7b0d/e14f219e47/73f3737d09/861529002f完成V4回归、Anima plugin:通道及语料迁移，既有persistence证据保留。属于自研持久化与必要修改，不因缩小上游维护范围取消。撤销“全部上游行为快照适配完成”前置；合并后的Anima、项目历史、跨设备读写与已有格式兼容才是验收范围。', acceptance: 'Anima记录、reader兼容及自研项目历史在候选版本中可用；历史会话世代不改写；未修改上游独立语料不作为清零门禁。', source: '交接文档.md' },
    { id: 'T19', title: '迁移 session-projection retained handles', category: '上游同步', priority: 'P0', status: 'issue', label: '随全量合并实施 · 合并窗口待用户启动', detail: '上游删除全局 SessionProjectionStateMap（ff731c72de），投影注册改异步 retained handle（5ecf33aab1、08e48f34b5），状态类型由各定义 stateSchema 推断，会话列表改 summary key set 供数（92f9e79fac）；ApprovalService 强制依赖 sessionProjections（a9dd195400 投影持久化）。读 todo/审批/inbox 等投影的插件全部需迁移，属机械但大面积改动，随全量合并一并落地。', acceptance: '本仓全部投影消费方按 retained handle 模式工作；dsh-agent/dsh-subagent 的 sessionProjections 要求满足。', source: 'upstream/master:packages/core/session' },
    { id: 'T20', title: 'Node 引擎下限升至 ≥24.9', category: '上游同步', priority: 'P0', status: 'partial', label: '隔离分支已实施 · 打包验证待做', detail: '已在隔离分支 integration/upstream-0.2.1 提交 186d4985fd 镜像上游 c6a59a1ae9+cfb65d3bb2：root engines >=24.9.0、CI 矩阵去 22.19 腿（24.9 钉住+26）、egress 移除 NODE_USE_ENV_PROXY 版本门、python runtime 字符串与文档更新、AGENTS.md 命令行更新、node-engine-floor Note 按上游归档并取 2026-10-15 node-24-runtime-floor 新 Note 与 node-24 升级指南；6 对双语配对一致，5 个相关 spec 98 项通过，归档 manifest 门禁 17 项通过。', acceptance: 'engines 与 CI/容器版本 pin 更新；打包与冒烟在新下限验证（待与 0.21.3 打包窗口协调）。', source: '.worktrees/upstream-sync-021' },
    { id: 'T21', title: '适配 DeepSeek-V4.1-Flash-1017 与 DeepSeek Search/Fetch API', category: '上游同步', priority: 'P1', status: 'issue', label: '随全量合并实施 · 合并窗口待用户启动', detail: '上游 v0.2.1-rc.2 适配 DeepSeek-V4.1-Flash-1017（3c937cd0ba ui-deepseek-model-label-1017）与 DeepSeek Search/Fetch API（fda98dadd2 新包 packages/web/web-deepseek-api、web-search-deepseek；1922f322aa 按 model route 门控）。pi-ai 同步至 1.3.0：约 40 个模型 ID 移除、默认容量上调至 1M/128K、kimi-coding 改协议、跨模型 thinking 直接省略；本仓现停在 pi-ai 1.1（8135897673）。该适配与 pi-ai 1.3 升级强耦合，随全量合并落地；若产品需在合并前提供新模型，另立摘取评估。', acceptance: '新模型与新搜索在产品冻结路由下可用；已存模型选择对目录移除给诊断而非静默失败。', source: 'upstream/master:packages/web/web-deepseek-api' },
    { id: 'T22', title: 'cherry-pick Windows 安装器与签名健壮性修复', category: '上游同步', priority: 'P1', status: 'issue', label: '随全量合并实施 · 合并窗口待用户启动', detail: '低耦合可摘取项：per-language 安装器本地化（9ce74cda96）、目录锁重试与失败报告（14819e2eb4）、版权保留与元数据校验（0d9a7f9abf）、发布者/卸载显示名（f351c96d71）、盘根拒绝（7f83658b4a）、签名前 token 身份校验（32bbe4fc8a）、未签名包本地品牌（091d6ed6be）。全量合并已决策（暂缓至 0.21.3 后），上游打包流水线整体重构（约 60 提交）将随合并带入，逐项 cherry-pick 仅在需要于合并前发布时另行实施。', acceptance: '安装器与签名链路修复随合并进入后在 5800 打包流程复验。', source: 'upstream/master:apps/desktop' },
    { id: 'T23', title: '借鉴上游更新通道与发布体系', category: '上游同步', priority: 'P1', status: 'issue', label: '随全量合并实施 · 合并窗口待用户启动', detail: '上游发布链可整体借鉴：更新通道封进安装 manifest（fdbe2bce47，apps/desktop/src/update-channel.ts，nightly/latest 双通道，旧 manifest 保持 nightly）、发布前人工确认（d156ee31a0）、手动 dispatch 发布（60084a5b59）、未签名本地品牌打包（091d6ed6be）。合并带入后按本仓发布规则（交接协议"产品版本与内部基线映射"）适配。', acceptance: '形成本仓 nightly/latest 通道方案并落地 update-channel 等价物；发布流程纳入人工确认。', source: 'upstream/master:apps/desktop/src/update-channel.ts' },
    { id: 'T24', title: '同步 vendor cordis 4.0.5 配置语义', category: '上游同步', priority: 'P2', status: 'issue', label: '随全量合并实施 · 合并窗口待用户启动', detail: '上游 vendor 从 4.0.5-alpha.1 到 4.0.5 正式版，新增架构级本地修改项：惰性配置解析（#15，e199aa1bc7）、volatile config 原地提交不 remount（#22，loader/volatile-update 事件）、canonical Fiber 更新（f2f563c681）、HMR raw module namespace（b1c5f861b6）。asterhub 插件配置热更新语义依赖这套行为；随全量合并落地，按 vendor/README.md 逐条 re-apply 本仓补丁。', acceptance: 'vendor 对表 upstream 4.0.5，本地修改条目全部登记并复测插件配置热更新。', source: 'upstream/master:vendor/README.md' },
    { id: 'T25', title: '评估 RBAC remote access 与 whenAccess 注册条件', category: '上游同步', priority: 'P2', status: 'verified', label: '评估完成 · 跟随上游', detail: '评估结论（2026-10-28）：跟随上游。上游新增 packages/api/remote-access（d7bd68ee7a）：按 resource kind × role 策略表在 gateway 解析前门控；插件注册新增 whenAccess/whenResourceAccess 条件（09899f3a0f）；连接层删除 OperatorPeer 与隐式 fallback，调用路径必须显式 Peer（2026-10-12 peer-principal 决策）。asterhub 插件若需被非 owner Peer 使用必须声明资源与策略；同步任何触及 gateway/connection 的代码时该重构为必答项，随全量合并落地后为 asterhub 插件补资源与策略声明。', acceptance: '评估结论已落盘（跟随）；插件资源与策略声明补齐随合并后实施。', source: 'upstream/master:packages/api/remote-access' },
    { id: 'T26', title: '决策实验性能力与静态门策略', category: '上游同步', priority: 'P2', status: 'verified', label: '决策完成 · 跟随上游', detail: '决策记录（2026-10-28，用户拍板）：(2) experimental 重组与 verify-product-use 门——跟随上游门，fork 自有包补分类条目；(3) i18n 八语言门——跟随，fork 自有 UI 文案补语言 metadata；(4) web_fetch 私网放开——跟随上游（改走代理策略与系统解析器）。(1) 实验性插件生态（Claude Code Mods、Git Worktrees、思考翻译、开发者工具包、action-cards 缝 9980af2d48）随合并带入但默认不启用，按产品需要逐个评估开启。', acceptance: '四项决策已记录；静态门与 i18n 策略随合并执行，自有包补条目。', source: 'upstream/master:scripts/product-package-policy.ts' },
    { id: 'T27', title: '自有特色功能扩展化改造（回归上游核心）', category: '上游同步', priority: 'P1', status: 'issue', label: '路线已定 · 随合并后逐包推进', detail: '用户方向（2026-10-28）：核心尽量回归上游，自有特色功能一律以扩展形式加入。用户 2026-10-29 重申战略动因：与上游差别越大、后续每次同步的工作量越大，因此现有与后续功能一律以兼容 DSH 的插件形式插入。224 个真实源码冲突的功能归因：项目本地历史/便携会话是最大块（packages/workspace、session-persistence-jsonl、api/workspace-controller+session-controller、ui-workspace、以及 subagent/jobs/attachment 的 cwd 消费点）；其次账户体系 UI（ui-settings-account、client connection）；桌面壳（apps/desktop 版本/签名/品牌）属产品载体层，不算核心侵入；其吸收方法（2026-10-29 明确）：载体文件取上游原样，AsterHub 品牌/产品装配/入口差异尽量挪入 bundle patch 与独立配置层，把每次上游同步需手工维护的 fork 改动文件压到个位数（版本号/签名等不可插件化的保留在最少文件里）——不以把上游改动挑进 fork 版文件的方式维护。已是扩展形态的示范：anima-memory、account-sub2api、browser-use-desktop、asterhub-* 三个 bundle、automation 均为新增独立包。路线：阶段 1 = T18 回归 V4+plugin:（把 session 格式还给上游）；阶段 2 = 全量合并，冲突解决原则为核心文件一律向上游看齐、自有行为经 bundle/patch/插件重新挂载；阶段 3 = 合并后逐包扩展化，其中"项目本地历史改自定义 persistence backend"已由用户拍板提前执行为 T28（不必等 T16 收敛——四轮修复证明双账本架构是根因）。', acceptance: '合并后上游核心文件中的自有改动趋于清零；特色功能全部经 asterhub-* 插件/独立包与 bundle patch 挂载；此后每次上游同步不再产生核心冲突。', source: '.local-workspace/upstream-sync-021/merge-conflicts-source-only.txt' },
  ],
  issues: [
    { title: '当前版本显示错源', severity: 'P1', status: 'verified', label: '源码已修复', detail: '已在 dshDesktop 载体注入真实 Electron 安装版本，CurrentVersionRow 优先展示安装版本，通用 Web 保持回退。', task: 'T01' },
    { title: '旧凭据升级阻断启动', severity: 'P0', status: 'verified', label: '源码已修复', detail: '已实现受控原子加密迁移与失败防覆盖保护；待新安装包实机复验。', task: 'T02' },
    { title: '登录与模型流程补验', severity: 'P1', status: 'verified', label: '用户实测通过', detail: '用户已明确确认 T03 手动测试通过；此前原网络超时作为历史观察保留，不再阻塞本项。', task: 'T03' },
    { title: 'W7 / W9 汇总与证据不一致', severity: 'P0', status: 'verified', label: 'W7证据已收口', detail: 'W7 提示词对照证据已完整收口并双向验证通过（证据：.local-workspace/issue-remediation-20261024/W7-parity-evidence.json）；W9 门禁由 T06 独立跟踪。', task: 'T05' },
    { title: 'OS 加密资格测试失败', severity: 'P1', status: 'verified', label: '环境根因已定性', detail: '已定位为云电脑环境进程守卫拦截 Chromium message-only 窗口创建 (0x5)，非产品代码或网络故障。', task: 'T07' },
    { title: 'browser_open 失败、标签列表为空', severity: 'P0', status: 'verified', label: 'Desktop打开/列举/关闭闭环通过', detail: '未主动展开侧栏，真实open/tabs/close/tabs通过；main.js前后原哈希一致，模型及目录dialog替身范围见T12。', task: 'T12' },
    { title: 'Computer Use 当前对话无法使用', severity: '待定', status: 'verified', label: '已装配集成', detail: '已在 asterhub-desktop-native 挂载官方原生 Cua Driver provider 并刷新锁文件，填补桌面端装配缺失。', task: 'T13' },
    { title: '手动打开后 browser_tabs 返回无效结果', severity: '待定', status: 'verified', label: '已修复验证', detail: '已过滤未完成导航的 about:blank 访客，消除下游协议校验失败。', task: 'T14' },
    { title: 'Anima 反思读取及保存均失败', severity: 'P0', status: 'partial', label: '真实反思已取证 · 修正版本待验', detail: '指定模型真实保存和非空反思有原始日志；撤除配置覆盖后的新版本仍待复验，现按用户要求暂停，见T15。', task: 'T15' },
    { title: '导入旧工作目录后历史会话不可见', severity: 'P0', status: 'partial', label: '修复线已叫停 · 转T28重做', detail: 'T16 四轮修复未根治，双账本架构是根因，用户已拍板叫停修复线并转 T28 重做（上游记录即真值+project-local后端+显式采纳流程，设计已定稿）；0.21.3 安装包留档不发布。', task: 'T28' },
    { title: '采纳工作区后消息落入旧工作区会话', severity: 'P1', status: 'verified', label: 'Desktop端到端已验证', detail: 'connectWorkspace等待新工作区进入列表后再创建会话；真实Desktop T15重投证实采纳后活动会话绑定目标项目。', task: 'BUG-ADOPT-WORKSPACE-SWITCH' },
    { title: '导入历史会话无法迁移旧平铺日志', severity: 'P1', status: 'verified', label: 'list/open自动迁移已验证', detail: '支持的平铺JSONL与Zstandard工件在list/open时按header身份迁入projectKey/session目录；冲突拒绝覆盖，durable字节保持。', task: 'BUG-IMPORT-FLAT-LAYOUT-REJECT' },
    { title: '续聊导入历史会话时Anima记忆保存失败', severity: 'P2', status: 'verified', label: 'SessionCwd路径已验证', detail: 'Anima capture使用SessionCwd解析的当前项目路径；未注册Session使用历史header cwd，resolver错误传播。', task: 'BUG-ANIMA-CONTINUED-IMPORT-SAVE' },
  ],
  capabilities: [
    { title: '产品组合', state: '主要实现已提交', detail: 'asterhub-product / product-web / desktop-native 三层归属明确。' },
    { title: '模型与图像', state: 'T03 用户实测通过', detail: '用户确认完整登录与模型流程通过；受控目录与 Host-only Key 保持，新候选不自动继承验收。' },
    { title: '项目与历史', state: 'T16修复线叫停 · 转T28重做', detail: '历史列表/正文/原字节前缀曾验证；双账本架构判定为根因并叫停修复线，转 T28 采用上游记录即真值模型重做（设计已定稿，M1–M4 实施中）。' },
    { title: '本地记忆', state: '真实模型反思闭环通过', detail: 'T15真实Desktop记录证实memory写入written、非空反思及同模型review/reflection；daily/weekly日历调度尚未验收。' },
    { title: '浏览器 / 语音 / 任务', state: '浏览器与自动化闭环通过', detail: 'browser_open/tabs/close/tabs已验；定时任务配置、启停、历史会话导航、结算、删除墓碑与重载删除保持全过，登录及重启保持闭环通过（exit 0）。Shell沙箱转用户手测，语音不据此确认，见T09/T12。' },
    { title: 'Computer Use', state: '已装配集成', detail: '已在 asterhub-desktop-native 挂载官方原生 Cua Driver provider 并更新依赖锁文件。实机操作系统权限需桌面端交互授权。' },
    { title: 'Office / 搜索 / 账户', state: '分项证据', detail: '转换 smoke、本地插件安装与积分 ×100 已有实现；线上鉴权及支付不据此确认。' }
  ],
  documents: [
    { title: '手动测试问题记录表', kind: '用户原始记录', href: '问题记录表.xlsx', detail: '保留原表不改动；编号 #1–#4 对应 T12–T15，已进入本轮优先修复调查，根因未确认。' },
    { title: '当前项目交接', kind: '当前状态', href: '交接文档.md', detail: '唯一的当前文字交接；源码、验收边界、问题和接手顺序。' },
    { title: '本轮问题修复实施计划（历史档案）', kind: '历史档案', href: 'archive-20261024/问题修复实施计划.md', detail: '已执行完毕的轮次章程；存留细节已并入交接文档，台账入口见其 §6。' },
    { title: '架构收拢实施计划（历史档案）', kind: '历史档案', href: 'archive-20261024/项目架构收拢重构实施计划.md', detail: 'W0–W11 设计与验收定义；当前判定见本看板 stages 区，合并硬条件存留见交接文档。' },
    { title: '架构盘点与收拢建议（历史档案）', kind: '历史档案', href: 'archive-20261024/项目架构盘点与收拢建议.md', detail: '2026-10-22 源码审计参考；建议已映射到已执行的 W1–W8。' },
    { title: '执行台账', kind: '原始记录', href: '../.local-workspace/worktree-preservation/architecture-consolidation/.superpowers/sdd/项目架构收拢重构实施计划/progress.md', detail: '保留原始执行过程；存在汇总与证据冲突，当前判定见交接。' },
    { title: '最终交付依据', kind: '产物证据', href: '../.local-workspace/worktree-preservation/architecture-consolidation/.local-workspace/architecture-consolidation/nomad/execution/final-delivery.json', detail: '精确产物哈希、构建作业与隔离安装验收范围。' },
    { title: 'T28 便携会话重做设计（当前设计）', kind: '当前设计', href: '../.local-workspace/upstream-sync-021/t28-spike-design.md', detail: '便携会话回归上游模型设计定稿：架构对比、机制对照表、M1–M4 里程碑与风险对策。' },
    { title: '上游合并冲突盘点（0.2.1 基线）', kind: '技术参考', href: '../.local-workspace/upstream-sync-021/merge-conflicts-source-only.txt', detail: '224 个真实源码冲突归因清单，指导 T27 扩展化与全量合并。' },
    { title: '当前产品模型路由', kind: '源码入口', href: '../packages/bundle/asterhub-product/src/index.ts', detail: '产品冻结路由、目录选择、image 模态及 Host 凭据记录。' },
    { title: '桌面开发说明', kind: '技术参考', href: '../apps/desktop/README.zh.md', detail: '技术文档仍保留在模块所有者旁，不复制成另一份。' },
    { title: '架构说明', kind: '技术参考', href: '../docs/architecture.zh.md', detail: '通用运行结构，以主目录源码和 README 交叉确认。' }
  ],
  next: [
    '【接手边界】先读本轮 AUX-UPSTREAM-SCOPE-AUDIT-20261101 与 Agent Teams 移除卡；禁止恢复“全量上游快照必须清零”的旧流程。只接有证据表明涉及自研或必要集成的失败；Windows 44 项是 ade1c7611f 留存结果，不是主树当前实跑。',
    '必要产品集成：普通subagent运行信号、主树modelSelection源码/测试失步。SDK cwd事实供给已在c024dd3b2d闭环，后续T17/T18/T19合并应同时保留该修复和deb7cd4733的Windows-only/Team移除。不要用 --no-verify 或全局跳过检查掩盖集成问题。',
    'T28真实界面验收授权已齐备，待认领执行，不再写“等待授权”。T17完成按采用的产品路径与必要修改验收，不依赖所有上游子卡清零；推送、签名与发布另按授权执行。',
    'T09实机验收与 T15真实反思已有历史通过证据；T16 修复线已叫停转 T28 重做，其验收标准与 smoke 资产由 T28 沿用。',
    '5800 的 0.21.2 unsigned 作业及 runtime smoke 通过（退出码 0）；GitHub Release desktop-v0.21.2-unsigned 已发布且资产哈希一致。',
    '0.21.3 安装包已构建（releases/0.21.3/，基于 815a61629a）但实机验收未完成、不发布，留档；签名与正式发布须另获授权。最终打包门禁生效：存在需要修复任务不得打包。',
    '凭据安全提醒：历史聊天曾出现凭据，建议轮换；不依赖旧看板的凭据存储状态。不要在看板、审查输出或提交中写入密钥。',
  ]
};
