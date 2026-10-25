---
name: nomad-dispatch
description: 主动评估、准备并分发重型构建、测试、静态检查与批量计算任务至 Nomad 集群（server-199 调度控制，运行时动态探测与自适应扩展计算节点，历史偏好 5800 > cloud-pc > imac），自动化源码快照传输、环境隔离执行与结果回收。
---

# Nomad Dispatch

本技能为跨项目通用集群分发规范。用于指导智能体（Agent）在识别到繁重计算任务时，主动探测节点就绪状态、组织源码与工具链环境、生成安全作业规格并提交至 Nomad 集群执行，随后回收产物、验证结果并安全清理。

**核心准则**：严禁仅被动打印执行建议或仅运行无实际业务逻辑的空壳（如简单的 `echo`）打卡任务。面对符合条件的重型负载，必须主动推进真实工程任务的分发。但**严禁虚构未打通的端到端自动化能力**：在传输通道与回收端点就绪前，必须如实呈现准备状态与阻断点。

---

## 1. 集群拓扑与动态节点资产发现

集群端点默认位于 `http://192.168.1.199:4646`（控制端环境变量 `$env:NOMAD_ADDR` 显式设置时以其为准）。中央调度节点 `server-199` 运行于 Ubuntu (Linux) 宿主机上，作为 7x24h 专用编排调度器（Central Brain），**严禁作为计算任务候选节点**（从不承担任务负载）。若该已知专用控制平面名称 `server-199` 意外在客户端注册表中出现，必须将其阻断排除；但不得基于名称模式误杀其他合法的通用计算节点或未来合法的 server+client 混合扩展节点。

### 动态节点发现与准入资格
本规范**不设静态 Worker 白名单，亦不作全量 Windows 宿主机的死板假设**。任何向 Nomad 服务端成功注册且处于 `Status == "ready"`、`SchedulingEligibility == "eligible"` 且 `Drain == false` 的客户端节点，均自动列为潜在计算候选节点，用户接入新节点时无需修改本技能文档：
- **历史已知节点（仅作为基准与运维参考样例，非穷尽权威白名单）**：
  - **5800**：Windows (`raw_exec`)，局域网 `192.168.1.45`，AMD Ryzen 5800X (16线程)，32GB RAM，`node_class = "build"`。无显式优先级时历史默认第一偏好。
  - **cloud-pc**：Windows (`raw_exec`)，WireGuard `10.8.0.2`，8 vCPU，16GB RAM，`node_class = "cloud"`。无显式优先级时历史默认第二偏好。
  - **imac**：Windows (`raw_exec`)，局域网 `192.168.1.109`，Intel Core i5 (4核)，16GB RAM，`node_class = "dev"`。用户已显式授权满载计算（无需再次确认），无显式优先级时历史默认第三偏好/最低后备。
- **未来扩展节点**：由控制端通过 Nomad REST API 实时动态发现。支持异构操作系统（Windows / Linux / macOS）与多样化驱动（`raw_exec`、`docker` 等）。新节点必须按任务契合度与容量评分动态参与调度，绝不可被无条件排在 `imac` 之后或被静默忽略。

### 运行时节点资产探测 API (Machine-Readable Discovery)
控制端避免正则抓取易变的 CLI 表格文本，统一通过 Nomad REST API 获取机器可读的 JSON 结构，并遵循以下关键规范：
- **请求超时与 URL 编码**：所有 API 请求必须设置明确的超时时间（如 `-TimeoutSec 15`），路径与查询参数（如 namespace）均须使用 `[System.Uri]::EscapeDataString()` 进行安全编码。
- **PowerShell 标量与数组处理规约**：调用 `Invoke-RestMethod` 时，应先赋值给中间变量，再通过 `@($response)` 进行数组标准化（例如 `$raw = Invoke-RestMethod ...; $items = @($raw)`），严禁直接编写 `@(Invoke-RestMethod ...)` 以免在 PowerShell 中触发嵌套单元素数组解包异常。
- **节点列举与状态**：`GET /v1/nodes?namespace=...`，过滤保留 `Status == "ready"`、`SchedulingEligibility == "eligible"`、`Drain == false` 且名称非专用控制节点 `server-199` 的客户端。
- **驱动双重状态核验**：针对每个节点的驱动（`Drivers`），必须同时检查 `Detected == true` 且 `Healthy == true`（当字段存在时），杜绝将未检测到或宿主不受支持的驱动误判为健康。
- **基础硬件容量与系统保留扣除**：从 `NodeResources`（CPU 总算力与物理内存）中，首先扣除操作系统级预留资源 `ReservedResources`（若配置了 CPU/Memory 预留），得到整机毛可调度预算（Gross Reservable Resources）。
- **节点分配跨命名空间本质与复杂形状核验**：
  - 调用 `GET /v1/node/:id/allocations` 汇总活跃分配。**重要事实**：该端点反映的是宿主机维度的分配总额（即便携带 namespace 参数，整机物理开销也是跨命名空间共享的），因此 Agent 严禁断言“在特定命名空间内测算的可用余量在跨命名空间环境下绝对安全”。
  - 汇总计算必须核算任务级资源、共享分配资源（`Shared`）以及突发限制 `MemoryMaxMB`（取 `MemoryMB` 与 `MemoryMaxMB` 的较大值）。
  - 若检测到显式绑定物理核心（`ReservedCores`）或存在不可解析的复杂设备/NUMA形状，必须将容量评估状态标记为 `unknown` 并谨慎规划，严禁静默归零或假设无开销。
- **凭据与鉴权安全**：探测代码读取 `$env:NOMAD_TOKEN` 并通过 `X-Nomad-Token` 请求头传递，严禁将令牌持久化到磁盘或打印到日志；严禁向未向 Nomad 注册的外部机器分发，严禁尝试修改节点配置或元数据。

```powershell
# 最小化节点发现与可用预算探测脚本 (输出结构化候选列表)
$nomadAddr = if ($env:NOMAD_ADDR) { $env:NOMAD_ADDR.TrimEnd('/') } else { "http://192.168.1.199:4646" }
$headers = @{}
if ($env:NOMAD_TOKEN) { $headers["X-Nomad-Token"] = $env:NOMAD_TOKEN }
$namespace = if ($env:NOMAD_NAMESPACE) { $env:NOMAD_NAMESPACE } else { "default" }
$timeoutSec = 15

$escapedNs = [System.Uri]::EscapeDataString($namespace)
$nodesUri = "$nomadAddr/v1/nodes?namespace=$($escapedNs)"

$rawNodesResp = Invoke-RestMethod -Uri $nodesUri -Headers $headers -TimeoutSec $timeoutSec -Method Get
$rawNodes = @($rawNodesResp)
$candidates = @()

foreach ($n in $rawNodes) {
    if ($n.Status -ne "ready" -or $n.SchedulingEligibility -ne "eligible" -or $n.Drain -eq $true) { continue }

    # 专用控制平面保护哨兵：若已知的 server-199 意外注册为 client，坚决排除
    if ($n.Name -eq "server-199") {
        Write-Warning "Dedicated control plane node 'server-199' detected in client registry; excluded."
        continue
    }

    $escapedId = [System.Uri]::EscapeDataString($n.ID)
    $detailUri = "$nomadAddr/v1/node/$($escapedId)?namespace=$($escapedNs)"
    $nodeDetail = Invoke-RestMethod -Uri $detailUri -Headers $headers -TimeoutSec $timeoutSec -Method Get
    $meta = $nodeDetail.Meta

    # 操作员元数据约定：dispatch_enabled=false 则显式排除
    if ($meta -and $meta.'dispatch_enabled' -eq 'false') {
        Write-Host "Node $($n.Name) ($($n.ID)) opted out via dispatch_enabled=false"
        continue
    }

    # 操作员元数据约定：dispatch_priority (严格数值解析，拒绝 NaN / Infinity，非法值忽略并警告)
    $priority = $null
    if ($meta -and $null -ne $meta.'dispatch_priority') {
        $pVal = [double]0
        if ([double]::TryParse($meta.'dispatch_priority', [ref]$pVal) -and -not [double]::IsNaN($pVal) -and -not [double]::IsInfinity($pVal)) {
            $priority = $pVal
        } else {
            Write-Warning "Node $($n.Name) has invalid non-numeric/infinite dispatch_priority: $($meta.'dispatch_priority')"
        }
    }

    # 1. 基础硬件容量与系统保留扣除 (NodeResources - ReservedResources)
    $nr = $nodeDetail.NodeResources
    $rr = $nodeDetail.ReservedResources
    $nodeResCpu = if ($nr -and $nr.Cpu) { [int]$nr.Cpu.CpuShares } else { 0 }
    $nodeResMem = if ($nr -and $nr.Memory) { [int]$nr.Memory.MemoryMB } else { 0 }
    $resrvCpu = if ($rr -and $rr.Cpu -and $rr.Cpu.CpuShares) { [int]$rr.Cpu.CpuShares } else { 0 }
    $resrvMem = if ($rr -and $rr.Memory -and $rr.Memory.MemoryMB) { [int]$rr.Memory.MemoryMB } else { 0 }

    $grossReservableCpu = [Math]::Max(0, ($nodeResCpu - $resrvCpu))
    $grossReservableMem = [Math]::Max(0, ($nodeResMem - $resrvMem))

    # 2. 查询该节点活跃分配 (整机全量跨命名空间分配预算核验)
    $allocsUri = "$nomadAddr/v1/node/$($escapedId)/allocations"
    $allocsResp = Invoke-RestMethod -Uri $allocsUri -Headers $headers -TimeoutSec $timeoutSec -Method Get
    $allocs = @($allocsResp)

    $activeAllocs = @($allocs | Where-Object { $_.ClientStatus -notin @("complete", "failed", "lost") })
    $usedCpu = 0
    $usedMem = 0
    $capacityEstimateStatus = "estimated"

    foreach ($a in $activeAllocs) {
        $ar = $a.AllocatedResources
        if (-not $ar) {
            $capacityEstimateStatus = "unknown"
            continue
        }
        if ($ar.Shared) {
            if ($ar.Shared.CPU -gt 0) { $usedCpu += $ar.Shared.CPU }
            if ($ar.Shared.MemoryMB -gt 0) { $usedMem += $ar.Shared.MemoryMB }
        }
        if ($ar.Tasks) {
            foreach ($tp in $ar.Tasks.PSObject.Properties) {
                $t = $tp.Value
                if (-not $t) { continue }
                if ($t.Cpu) {
                    if ($t.Cpu.ReservedCores -and $t.Cpu.ReservedCores.Count -gt 0) {
                        $capacityEstimateStatus = "unknown"
                    }
                    if ($t.Cpu.CpuShares) { $usedCpu += [int]$t.Cpu.CpuShares }
                }
                if ($t.Memory) {
                    $memVal = [Math]::Max([int]($t.Memory.MemoryMB), [int]($t.Memory.MemoryMaxMB))
                    $usedMem += $memVal
                }
            }
        }
    }

    $availCpu = if ($capacityEstimateStatus -eq "unknown") { "unknown" } else { [Math]::Max(0, ($grossReservableCpu - $usedCpu)) }
    $availMem = if ($capacityEstimateStatus -eq "unknown") { "unknown" } else { [Math]::Max(0, ($grossReservableMem - $usedMem)) }

    # 3. 驱动检测：要求 Detected == true 且 Healthy == true (若字段存在)
    $healthyDrivers = @()
    if ($nodeDetail.Drivers) {
        foreach ($dp in $nodeDetail.Drivers.PSObject.Properties) {
            $d = $dp.Value
            $isDetected = if ($null -ne $d.Detected) { $d.Detected -eq $true } else { $true }
            $isHealthy  = if ($null -ne $d.Healthy)  { $d.Healthy -eq $true }  else { $true }
            if ($isDetected -and $isHealthy) { $healthyDrivers += $dp.Name }
        }
    }

    $candidates += [PSCustomObject]@{
        ID             = $n.ID
        Name           = $n.Name
        NodeClass      = $n.NodeClass
        KernelName     = $nodeDetail.Attributes.'kernel.name'
        KernelArch     = $nodeDetail.Attributes.'kernel.arch'
        TotalCpuMHz    = $nodeResCpu
        ReservedCpuMHz = $resrvCpu
        AvailCpuMHz    = $availCpu
        TotalMemoryMB  = $nodeResMem
        ReservedMemMB  = $resrvMem
        AvailMemoryMB  = $availMem
        Drivers        = ($healthyDrivers -join ",")
        PriorityMeta   = $priority
        EstimateStatus = $capacityEstimateStatus
    }
}
$candidates
```

### 操作员元数据约定 (Operator Meta Conventions)
- **可选约定非强制配置**：`dispatch_priority`（数值，越高越优先）和 `dispatch_enabled`（布尔字符串，`false` 表示退出分发）均为集群操作员可选定义的节点元数据约定，**不是所有节点必须预置的字段，亦非硬性要求**。Agent 严禁擅自修改集群节点元数据或 Agent 守护配置。
- **健壮解析**：若节点未配置 `dispatch_priority`，保留为空；若配置了非数值格式（如字符串、损坏数据、NaN 或 Infinity），必须输出 Warning 警告并予以忽略，严禁凭空捏造虚假评分。

### 节点调度决策模型与优先级仲裁
1. **显式要求绝对优先**：用户或项目上下文中的显式指令（如“指定在 cloud-pc 运行”或“排除某节点”）具有最高优先级，覆盖所有默认行为。
2. **操作员元数据优先**：若候选节点定义了合法的 `dispatch_priority` 数值，该元数据优先级直接覆盖历史遗留偏好。
3. **向后兼容默认偏好**：当参与竞争的已知节点均无显式 `dispatch_priority` 时，保持历史默认倾向：`5800`（主力）> `cloud-pc`（扩展）> `imac`（已授权满载的开发机/后备）。
4. **新节点动态融合**：新发现的就绪合格节点必须根据其**任务契合度与容量评分（Fit / Capacity Score）**（根据驱动支持、架构匹配、工具链就绪性、剩余 CPU/RAM 可用量、网络传输开销等综合判定）自然参与竞争与分派，绝不允许无条件将其硬编码排在 `imac` 之后或直接无视。
5. **平局决胜与严禁臆测**：当多个节点评分相近时，依据**契合度高、传输与资源成本低**的原则选定，随后按优先级定案并在分发报告中清晰解释选用理由；严禁凭空发明基准测试加速比或虚构硬件优势。保持轻量透明的规则体系，不引入冗长沉重的打分机制。

### 算力授权、多任务共享与特权安全边界
- **计算满载授权（延续授权）**：用户已显式授权 Agent 在分发计算任务时最大化利用所有就绪候选节点（包括 `imac`）的可用物理 CPU 和 RAM 资源，单机上按工具能力（如 `--max-workers`、`-j`、`threads`）拉满合理并发，分发时无需再次弹窗确认。
- **多任务共享节点的容量切分准则（严禁盲目霸占全部容量）**：当同一节点承载多项并发计算或与同机其他独立任务共存时，**严禁将节点所有剩余容量一次性盲目全数分配给单个任务**！必须依据该任务实际负载需求及计划同机并发任务数进行合理切分，为同机并发任务和宿主操作系统基础运行保留安全内存，防止单任务超额霸占造成其他任务排队或宿主 OOM。
- **特权边界与第三方新节点隔离（红线）**：
  - 满载授权**严格仅限于在各节点分配隔离目录（Alloc Dir）内执行由源码驱动的有界计算任务（构建、测试、静态分析、批处理）**。
  - **新加入或第三方的客户端节点绝不自动继承无限制修改宿主操作系统的权限**！严禁借分发之名执行更改系统环境、配置持久后门、修改防火墙规则、篡改操作系统全局配置等越权破坏行为。资源声明必须受各节点真实物理硬件与操作系统安全基线约束（预留 OS 基础内存防 OOM）。

### 异构操作系统与驱动适配边界
- 本技能在通用层面支持跨平台、异构 OS（Windows / Linux / macOS）与多种驱动（`raw_exec`、`docker` 等）。
- **示例骨架的专属性**：第 4 节给出的 HCL 骨架明确为 **Windows 宿主下的 `raw_exec` 驱动及 Node.js/pnpm 工作流专属**，强制包含 `${attr.kernel.name} == "windows"` 约束。严禁宣称该脚本原生适用于全平台或所有驱动。
- **异构调度前置条件**：对于动态发现的 Linux 或非 Windows 节点，必须在具备已验证的对应驱动模板（如 Linux `exec`/`docker` 容器规格）与相应工具链时方可派发；若缺乏对应平台的任务定义模板，必须在规划阶段明确列为阻断点（Blocker），严禁向非 Windows 节点盲目发送 PowerShell 脚本。

### 显式动态定向锁定与 NodeID 验证
- **动态硬绑定（Deliberate Dynamic Pinning）**：由于软亲和（Affinity）无法可靠防止任务向单一节点挤压，在多任务并发场景下，Agent 必须通过动态探测选定目标节点，并在作业规格中通过 `${node.unique.id} == "<target-node-id>"`（经 Nomad HCL 原生支持验证）进行显式硬约束，确保任务精确散列到预期节点。严禁在调度资格中使用过时或写死的静态节点名称列表。
- **执行回溯验证**：任务执行完成后，必须通过快照比对 Allocation 的实际 `NodeID`，确凿验证任务确实在所规划的目标物理节点上执行。

### 多任务跨节点并发分派与调度编排
- **实质跨节点并发分发（Anti-Funneling）**：当同一请求包含多项可独立执行的重型构建、测试或静态检查，且多个合规计算节点具备声明可用容量时，Agent **必须真正实施跨节点并发分发**。严禁因某节点打分较高就将所有独立作业漏斗式（funnel）倾倒至单节点串行排队，亦严禁在控制端“提交一个、等待完成、再提交下一个”的伪并行串行行为。单节点的优先倾向不构成串行垄断。
- **依赖图审查与独立单元并行化（Dependency Graph & Real Chains）**：分发前必须审查任务依赖图，仅将完全独立的计算单元（如互相解耦的包构建、无依赖的测试套件、并发 Lint/Typecheck）进行并行化拆分。**仅当存在确凿的前后产物依赖链（如前置构建产物被下游测试消费）时，才允许建立串行阶段**，严禁臆造串行依赖。
- **任务与算力规模匹配（Don't Invent Work）**：若就绪的独立任务数量少于可用节点数，按实际需要分派即可，严禁为了强行占满节点而凭空发明无意义工作。
- **传输与准备开销权衡**：若跨节点传输源码快照、解压或环境准备开销显著抵消并发收益，或受网络带宽瓶颈制约，可合理收敛并发度，但必须在交付报告中如实陈述原因与权衡考量。
- **优先级不阻碍并行**：已有任务分给高优先级节点时，可将独立并发任务分给次优或后备节点（如 `imac`），无需等待高优先级节点不可用。按任务负载和传输成本规划，不强求平均分配。
- **并发提交后再等待模式（Submit Before Wait Pattern）**：对拆分的独立任务生成唯一的 Job ID（如 `batch-<task>-<node>-<timestamp>`）。在进入等待轮询前，**必须先连续提交所有已规划的独立作业**，确保集群端各节点能够真正实现时间线重叠的并行执行，随后再并发或轮询监听所有 Allocation 的运行状态，最后集中回收产物与日志。
- **真实物理容量利用与并发度最大化**：核对节点现有 allocations、已分配资源与操作系统/常驻服务基础开销，在剩余可用物理容量内最大化分派。解除对节点 CPU/内存/并发度的人为压制与保活预留，根据各工具具体语义（如 `--max-workers`、`-j`、`threads`）与实际负载特征将 worker 数/并发度提升至可用上限；严禁在缺乏支持的工具上盲目硬写并发参数，亦严禁试图对不可并行的单一任务进行魔术化拆分。Windows `raw_exec` 下的 `resources` 声明仅为 Nomad 调度器的排程预算而非内核级强制限制；合理预留 OS 基础内存以防 OOM，严禁关闭系统页面文件（Pagefile）、防火墙或 WireGuard 网络。
- **调度可行性预留与实时物理 CPU 状态的本质区分**：必须清醒认知：Nomad 资源核验仅代表“调度元数据层面的可行性预留配额（Resource Feasibility Reservations）”，**绝对不等同于宿主机底层的实时物理 CPU 利用率（Live CPU Load）**。除非有受信任的宿主实时监控数据，报告与推断中只能表述为“节点处于就绪状态且具有声明的可用预留额度”，严禁断言“节点物理硬件完全空闲”。
- **工作区隔离、产物防碰与测试环境独立**：多任务必须在各自独立的 Alloc 目录运行，严禁并发写入共享工作区或覆盖同名产物；**禁止在多节点间重复执行完全相同的无意义冗余计算**（明确设计的多环境构建矩阵 Build Matrix 或分片测试 Test Sharding 除外）；并行测试必须保证端口、临时文件与单例环境的纯净隔离。
- **遵循项目测试规范与范围化检查（Obey Project Test Instructions & Scoped Checks）**：任务拆解与分发执行必须严格遵循待测工程自身的规约与指令（如 `AGENTS.md`、`docs/testing.md` 及 `package.json` 中的命令模式与范围化检查要求），严禁擅自修改工程测试逻辑。

### 可靠完成监控：阻塞查询与断点恢复

本节替代本文其他位置笼统的“轮询监听”要求。默认使用 Nomad 服务端持久状态与 HTTP Blocking Queries；不以日志关键字、一次事件流消息或 webhook 作为完成的唯一依据。禁止模型每隔数秒反复调用状态工具。

1. 先提交全部独立作业，再启动一个控制端监控脚本。在脚本内部为每个未完成作业并发等待，不能逐个等待完成而阻塞其他作业的观察。监控器只打印状态变化、异常和最终汇总。
2. 在自有临时目录保存不含秘密的监控清单：服务地址、namespace、Job ID、提交版本/创建标识、源码标识、预期任务组及副本数、已知 Allocation ID、各查询端点的索引、截止时间与已验证结果。使用临时文件加原子替换保存；恢复时先重新读取服务端状态，不凭本地记录认定成功。不得在清单中保存凭据或带签名的下载地址。
3. 对每个作业先读取 `GET /v1/job/:job_id?namespace=...` 和 `GET /v1/job/:job_id/allocations?namespace=...`。对路径和查询参数进行 URL 编码。后者支持阻塞查询；读取响应头 `X-Nomad-Index` 后，以该端点自己的索引请求 `GET /v1/job/:job_id/allocations?namespace=...&index=<index>&wait=30s`。不能把不同端点的索引混用。索引至少取 1；若响应索引回退，丢弃旧游标并重新获取快照，不能一直等待更大的旧索引。
4. `wait=30s` 是服务端等待参数，不是任务时限；客户端请求超时应留出余量（例如 45 秒），外层工具超时还需覆盖脚本收尾。响应可能因超时、无关更新或提前返回而没有实质变化，必须重新比较状态；连续立即返回时增加短暂退避，防止忙循环。各监控轮次有界运行并保存清单，工具时间不足时续接同一批作业，不要重新提交。
5. 网络断开、HTTP 超时和服务暂不可用只表示观察失败：使用有上限的指数退避与随机抖动，恢复后重取快照。鉴权失败应报告并修复访问条件，不无限重试。观察截止时报告“结果待确认”，保留 Job ID；严禁因等待超时自动重跑、停止或清理任务。404 也不能当作成功，应核对 namespace、作业身份和是否被外部删除。
6. 每次状态变化后核对本次提交版本、任务组、副本及 Allocation 的替代关系。不得取任意一个历史成功实例代表整个作业成功。成功要求所有预期批任务实例均满足 `ClientStatus=complete`，并通过 `GET /v1/allocation/:alloc_id?namespace=...` 检查必要任务已结束、`Failed=false` 且本次真正的终止事件 `ExitCode=0`；非终止事件中的默认 `ExitCode=0` 不算证据。核对 Node ID 与实际执行节点，随后验证产物清单和取回结果。
7. `pending`、重启中、重新调度和无 Allocation 不能当作成功；无可用节点时检查作业 evaluations 中的放置失败原因。`failed`、`lost`、取消和节点失联必须结合替代实例及最终任务状态报告，不能一见旧失败实例便忽略仍在执行的替代实例。作业 `dead` 仅表示终态，不等于成功。常驻 `service` 作业按约定的健康/就绪检查验收，不等待进程退出。

监控算法：`读取/恢复清单 → 全量核对快照 → 并发执行各作业的阻塞查询 → 核对变化及终态 → 保存清单 → 全部完成或观察期限到达时汇总`。若运行环境不支持后台完成通知，就在一次有界工具调用内等待，并通过清单续接；不得声称已实现“自动唤醒 OpenCode”。事件流可以加速提示，但重连后仍须核对上述服务端状态。

依据：[Nomad Blocking Queries](https://developer.hashicorp.com/nomad/api-docs#blocking-queries)、[Job Allocations](https://developer.hashicorp.com/nomad/api-docs/jobs#list-job-allocations)。此修改规定监控流程，不代表已经安装常驻监控器或通知插件。

### 客户端工具与缓存服务约束
- **Nomad CLI 路径**：优先直接调用系统 `PATH` 中的 `nomad`；若未配置环境变量，调用本地固定路径 `C:\nomad\nomad.exe`。
- **控制端环境变量**：统一配置 `$env:NOMAD_ADDR = "http://192.168.1.199:4646"`（可由操作员覆盖）。
- **Turborepo 远程缓存**：端点位于 `http://192.168.1.45:8181`（存储挂载于 5800 的 D 盘）。**仅适用于明确配置了 Turborepo (`turbo`) 的项目**。
  - **健康度探测边界**：单纯 TCP 端口联通（如 `Test-NetConnection`）仅证明端口可达，不代表缓存服务进程健康或鉴权有效；严禁假设未验证的特定 HTTP 路径为通用健康探针。
  - **验证要求**：若需启用该缓存，必须执行真实的轻量鉴权探测（如带鉴权信息的受控读写测试）。若仅完成 TCP 端口探测，必须在汇报中明确标记为“仅端口级部分验证（Partial Verification）”，严禁声称缓存服务完全就绪或在未验证状态下向构建强行注入。

---

## 2. 任务分发决策模型

### 必须主动分发的情形
- **重型编译与构建**：全量 TypeScript 编译 (`tsc` / 打包)、跨包 Monorepo 产物构建（预估本地单机耗时 > 30 秒）。
- **多分支或测试矩阵**：包含大量测试用例的集成测试、单元测试矩阵，或并行的多套环境回归。
- **重型静态分析与批处理**：大规模代码检查（Lint）、类型检查 (`typecheck`)、资源资产批量转换与打包。

### 避免分发的边界情形
- **轻量即时任务**：耗时小于 15 秒的简单指令、单文件即时验证、本地轻量格式化。分发引入的传输与调度开销显著大于本地计算收益。
- **传输瓶颈型任务**：输入或输出数据量达数 GB 且网络吞吐受限的任务（如未经压缩的大型媒体文件批处理），避免网络拥堵抵消算力优势。

### 算力与模型配额的边界隔离
- **物理算力 ≠ 模型配额**：Nomad 集群仅提供 CPU、内存、本地磁盘算力，**无法提供模型 API 额度或增加并发 Agent 速率**。
- 若分发的构建或测试脚本内部包含对模型 API 的调用，必须确保测试配置遵循项目主体的应用启动规则（如 `AGENTS.md`），并且目标环境已通过受控手段配置了必要的受限凭证，严禁明文硬编码。

---

## 3. 端到端执行工作流

### 步骤一：节点探测与调度规格规划
在生成作业前，首先通过运行时探测脚本验证控制平面与节点就绪性：

```powershell
$env:NOMAD_ADDR = if ($env:NOMAD_ADDR) { $env:NOMAD_ADDR } else { "http://192.168.1.199:4646" }
$nomadCmd = if (Get-Command nomad -ErrorAction SilentlyContinue) { "nomad" } else { "C:\nomad\nomad.exe" }

# 执行节点状态探测与元数据/容量解析
& $nomadCmd node status
```

**调度约束设计原则**：
- 驱动与平台硬约束：任务骨架声明 `driver = "raw_exec"` 与 `${attr.kernel.name} == "windows"` 确保运行于适配的 Windows 宿主环境；异构 Linux/Docker 任务需配对相应驱动与操作系统约束。
- 动态节点定向绑定：多任务并发场景下，通过动态发现选定目标节点，在作业中使用节点硬约束（`${node.unique.id} == "<target-node-id>"`）显式定向绑定到选定的就绪节点，实现确定性多节点并发散列。
- 选定节点的前置准备：在正式分发前，必须确认每一个被选中的目标计算节点均具备可用连通性，且完成源码拉取通道与必要工具链（Node.js/pnpm 等）的前置准备，严禁向未完成准备的节点盲目派发。
- 资源规划与变量化：解除人为保留余量限制，按目标节点剩余可用物理容量及任务负载科学最大化声明 CPU/内存调度预算。若多任务共享同一节点，须按并发规划合理切分资源，严禁单任务盲目霸占全数可用容量。作业规格必须采用必填 HCL 变量（正整数 CPU MHz 与内存 MiB），在分发前根据目标节点测算与规划显式传入，缺失或非法时立即阻断报错；同时根据工具实际并发能力（如 workers/threads）拉满计算并发，绝不在单机上臆造对不可拆分任务的虚假并发。
- 绝对路径隔离：严禁在作业中直接硬编码当前机器独有的特定盘符或个人绝对路径发送给未初始化的远端节点。

### 步骤二：源码基线确定与安全传输通道
**严禁静默测试已过期的远端 Commit！**
1. **工作区状态判定**：检查本地工作区是否存在未提交变更 (`git status --porcelain`)。
   - **干净工作区**：若远程已有对应提交，可基于确切的 Git Commit SHA 进行校验检出。
   - **脏工作区（有修改或新增未跟踪源文件）**：必须实时生成当前工作区快照，将变更连同所需源码打包归档。
2. **敏感与冗余排除（硬性红线）**：
   - **按文件用途排除**：排除真实凭据、敏感 `.env`、依赖安装目录和可再生成产物；不能按目录名盲目排除受版本控制的 `lib/`、`build/` 或项目需要的 `.env.example`。先列出归档清单，保留必要源码、配置、锁文件、点文件、执行位和符号链接语义；工具不支持必要的元数据时换传输方式。默认不传 `.git/`，需要提交元数据的构建应单独准备。
   - **完整保留**：版本锁定文件（`pnpm-lock.yaml` / `package-lock.json` 等）、源码相对目录层级、文件编码。
3. **数据交付通道与现实边界**：
   - **受控源码交付**：优先复用已授权的 Git 精确提交检出或文件传输通道。若使用临时只读归档服务，只暴露当前归档，并限制来源、访问权限和存活时间；先从每个目标节点验证可达。跨不可信网络需加密，SHA256 只校验内容一致性，不替代身份认证。先判断现有权限是否足够，不自动修改防火墙或公开工作区目录。
   - **内联模板（仅限轻量脚本）**：当分发内容仅为 < a few KB 的非敏感测试或编排脚本时，使用 Nomad `template` 块直接内联下发。
   - **严禁虚构传输服务**：若当前环境缺乏双向连通且安全的传输服务（例如本地端口无法穿透至 WireGuard 节点或缺少可信文件宿主），**严禁虚构端到端自动化已就绪**。必须明确报告传输阻断点（Blocker），待通道验证完成后方可提交实际分发。
   - **不可继承假设**：严禁假设目标节点继承了本地笔记本电脑的环境变量；严禁假设远端 Windows 节点以 LocalSystem 运行时默认拥有 Git 私有凭据。

### 步骤三：环境校准、安全解压与独立工作区
1. **隔离工作区**：每次分发必须生成唯一的 Job ID（如 `batch-build-<task>-<node>-<timestamp>`）与对应的分配独立工作区目录（利用 `$env:NOMAD_TASK_DIR` 或 `$env:NOMAD_ALLOC_DIR`），严禁并发作业产生工作区或产物碰撞。
2. **解压安全防御 (Zip Slip 校验)**：若由脚本手动解压归档包，必须逐项校验压缩条目的目标绝对路径是否以解压目录为前缀，一旦检测到包含 `..` 穿越行为立即抛错终止，防止目录遍历注入。
3. **工具链对齐**：使用项目固定版本的编译器与包管理器（如指定的 Node.js 与 pnpm），并在每个被选定节点上确认工具链就绪。在执行全局安装前必须明确获得用户许可，优先使用免安装或工作区内局部工具。
4. **依赖冻结**：依赖安装必须指定冻结锁定文件（如 `pnpm install --frozen-lockfile`），利用节点本地缓存；**绝对严禁跨网络传输 node_modules 目录**。
5. **计算非重复原则**：严禁在多个节点间并发执行完全相同的重复构建或计算，除非属于明确声明的跨环境矩阵校验或分片分派。

### 步骤四：HCL 作业定义与并发提交
- 作业类型必须为 `type = "batch"`。
- **并发提交后再等待模式**：先执行 `nomad job validate <file>`，再用 `nomad job run -detach -check-index=0 <file>` 提交唯一 Job ID，保存各提交结果，然后按可靠完成监控章节统一等待。`-detach` 避免 CLI 阻塞在放置监控；CLI 提交成功不代表任务执行成功。提交请求响应丢失时，先按原 Job ID 核对身份与版本，不能换 ID 盲目重提造成重复计算。
- **默认不重跑计算**：普通构建/测试设置 `restart` 的 `attempts = 0`、`mode = "fail"`，并设置 `reschedule` 的 `attempts = 0`、`unlimited = false`。只有明确可安全重试的任务才允许有界重试，且必须保留每次失败证据；不能用重试掩盖测试失败。
- **变量与凭据占位**：严禁在 HCL 文件、环境变量或日志输出中嵌入明文密钥与真实密码，均须使用占位符或受控参数传递。

### 步骤五：产物回传验证与日志检索
**重要机制事实**：Nomad 不会自动将目标节点生成的工作区非日志文件反向上传回控制端。
1. **轻量报告与标准输出**：使用 `nomad alloc logs <alloc-id> <task>`；文件读取使用 `nomad alloc fs <alloc-id> <task>/local/result-manifest.json`，不是不存在的 `alloc fs read` 子命令。先核对实际路径与客户端可达性；取回失败不等于计算失败，但必须报告产物未取回。
2. **重型产物回传**：需在任务脚本中显式定义回传通道（例如构建成功后通过经授权的内网接口或共享目录将产物归档推送），并在完成时输出校验清单（Manifest，包含文件列表、字节大小与 SHA256）。
3. **结果判定标准**：
   - 检查任务分配生命周期状态最终为 `complete`。
   - 检查真实退出码（Exit Code）为 0。
   - 检查实际执行的 `NodeID` 确实符合预期的运算节点快照。

### 步骤六：作用域清理与证据留存
- 任务执行成功且产物完成验证后，通过 `nomad job stop -purge <job-id>` 清理注册的作业，并清理本地临时快照文件。
- **失败现场证据保留**：若任务失败或发生异常退出，**必须保留分配日志与临时诊断工作区**，严禁执行破坏性垃圾回收（Destructive GC），严禁误清理节点上的其他作业或用户资产。

---

## 4. Node/pnpm 作业骨架（须按项目适配，Windows raw_exec 专属）

**【注意】以下 HCL 为 Windows raw_exec 节点下的 Node/pnpm 作业规格骨架（Scaffold），非即插即用任务。** 强制约束 `${attr.kernel.name} == "windows"`；在源码传输与产物回传通道实际打通并校验前，不可宣称自动化已全流程就绪。异构 OS（如 Linux/macOS）或 Docker 驱动需编写专属模板，严禁混用。

```hcl
variable "task_cpu" {
  type        = number
  description = "Task CPU allocation in MHz (positive integer), supplied from prepared node/workload plan."

  validation {
    condition     = var.task_cpu > 0
    error_message = "The task_cpu variable must be a positive integer in MHz."
  }
}

variable "task_memory" {
  type        = number
  description = "Task memory allocation in MiB (positive integer), supplied from prepared node/workload plan."

  validation {
    condition     = var.task_memory > 0
    error_message = "The task_memory variable must be a positive integer in MiB."
  }
}

variable "target_node_id" {
  type        = string
  description = "Target NodeID for deterministic dynamic pinning (obtained via runtime /v1/nodes discovery)."
  default     = ""
}

job "batch-dist-build" {
  datacenters = ["dc1"]
  type        = "batch"

  # 操作系统硬约束 (此骨架专用于 Windows raw_exec 宿主)
  constraint {
    attribute = "${attr.kernel.name}"
    value     = "windows"
  }

  # 目标节点动态定向硬绑定：传入选定 NodeID 实现确定性散列与并发
  dynamic "constraint" {
    for_each = var.target_node_id != "" ? [var.target_node_id] : []
    content {
      attribute = "${node.unique.id}"
      value     = constraint.value
    }
  }

  group "builder" {
    count = 1

    # 严禁自动重试掩盖真实错误
    restart {
      attempts = 0
      mode     = "fail"
    }

    reschedule {
      attempts = 0
      unlimited = false
    }

    task "run-task" {
      driver = "raw_exec"

      # 先通过已验证的通道把源码 ZIP 放到本任务 local/archive.zip，
      # 并将下方 expectedSourceSha256 替换为本次归档的真实 SHA256。
      # 此骨架不含下载或上传服务，未接好传输通道时不能作为完整任务提交。

      config {
        command = "powershell.exe"
        args = [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy", "Bypass",
          "-File", "local/execute.ps1"
        ]
      }

      template {
        data = <<EOF
$ErrorActionPreference = "Stop"
$allocDir = $env:NOMAD_ALLOC_DIR
$taskDir  = $env:NOMAD_TASK_DIR
$workDir  = Join-Path $taskDir "workspace"
$expectedSourceSha256 = "REPLACE_WITH_SNAPSHOT_SHA256"
$archive = Join-Path $taskDir "archive.zip"
if ($expectedSourceSha256 -notmatch '^[0-9a-fA-F]{64}$' -or -not (Test-Path -LiteralPath $archive)) {
    throw "源码归档或校验值未准备，拒绝运行空工作区"
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedSourceSha256) {
    throw "源码 SHA256 不匹配"
}

Write-Host ">>> [1/5] 工具链就绪检查..."
$nodeVer = & node -v 2>$null
if (-not $nodeVer) {
    Write-Error "CRITICAL: Node.js 未在目标节点环境变量中找到"
    exit 1
}
$pnpmVer = & pnpm -v 2>$null
if (-not $pnpmVer) {
    Write-Error "CRITICAL: pnpm 未在目标节点环境变量中找到"
    exit 1
}
Write-Host "节点工具链版本: Node=$nodeVer, pnpm=$pnpmVer"

Write-Host ">>> [2/5] 准备独立工作区与解压安全防御..."
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
Set-Location -LiteralPath $workDir
$destResolved = (Resolve-Path $workDir).Path

# 手动解压仅支持普通文件与目录，不支持链接与特殊文件。
if (Test-Path -LiteralPath $archive) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $destPrefix = $destResolved.TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar
        foreach ($entry in $zip.Entries) {
            $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
            if ([System.IO.Path]::IsPathRooted($entry.FullName) -or $entry.FullName.Contains(':') -or
                $unixType -notin @(0, 0x8000, 0x4000)) {
                throw "不支持的归档路径或文件类型"
            }
            $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destResolved, $entry.FullName))
            if (-not $target.StartsWith($destPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "归档条目越过工作区边界"
            }
            if ($entry.FullName.EndsWith("/") -or $entry.FullName.EndsWith("\")) {
                New-Item -ItemType Directory -Force -Path $target | Out-Null
            } else {
                $parentDir = Split-Path $target -Parent
                if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Force -Path $parentDir | Out-Null }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
            }
        }
    } finally { $zip.Dispose() }
}
if (-not (Test-Path -LiteralPath "package.json")) { throw "源码根目录缺少 package.json" }

Write-Host ">>> [3/5] 执行冻结依赖安装 (利用节点本地缓存)..."
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    $installCode = $LASTEXITCODE
    [Console]::Error.WriteLine("依赖安装失败，退出码: $installCode")
    exit $installCode
}

Write-Host ">>> [4/5] 执行构建/测试指令..."
& pnpm run build
$execCode = $LASTEXITCODE
if ($execCode -ne 0) {
    [Console]::Error.WriteLine("构建失败，退出码: $execCode")
    exit $execCode
}

Write-Host ">>> [5/5] 生成执行摘要与产物清单..."
$manifest = @{
    status      = "execution-complete"
    exitCode    = 0
    nodeName    = $env:COMPUTERNAME
    allocId     = $env:NOMAD_ALLOC_ID
    timestamp   = (Get-Date).ToString("o")
    # dist 仅为示例，正式作业须改为项目约定输出并验证预期文件是否齐全。
    outputFiles = @(Get-ChildItem -Path "dist" -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        @{ path = $_.FullName.Substring($workDir.Length + 1); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -Path "$taskDir\result-manifest.json" -Encoding utf8

Write-Host "计算阶段退出成功；产物验收与回传须由控制端另行确认。"
exit 0
EOF
        destination = "local/execute.ps1"
      }

      # 调度预算，不是 Windows raw_exec 的内核硬限额；由准备好的节点/负载规划显式传参注入。
      resources {
        cpu    = var.task_cpu
        memory = var.task_memory
      }
    }
  }
}
```

---

## 5. 安全红线与特权说明

1. **无鉴权 raw_exec 的特权风险与新节点边界**：
   - 当前集群网络内默认端点未开启 ACL 鉴权，`raw_exec` 驱动在 Windows 节点上以服务权限运行宿主命令。
   - 所有任务逻辑必须具备确定的边界，严禁拼接不可信的动态指令，防止命令注入风险。
   - **第三方/新增节点特权隔离**：新增节点绝不自动继承无限制修改远端宿主 OS 的权限；满载算力授权严格限于隔离分配目录内有界计算任务（构建、测试、批处理），严禁超出工作区修改宿主环境。
2. **严禁破坏系统安全基线**：
   - **网络防护**：严禁打开任何公网监听端口；严禁修改、削弱操作系统的全局防火墙规则。
   - **隧道保护**：严禁断开、重启或更改节点上的 WireGuard VPN 隧道适配器。
   - **存储安全**：严禁删除或清空 Nomad 运行数据目录（如 `data_dir`）；严禁干扰非当前分配工作区以外的任何宿主系统文件。
3. **杜绝伪造优化与幻觉**：
   - 严禁声称支持不存在的“自动化局域网唤醒（WoL）”、“运行时动态 CPU 调频加速”或虚构的构建倍率提升；任何加速事实必须以真实统计的物理秒数为唯一证据。

---

## 6. 分发交付报告规范

当 Agent 执行了 Nomad 集群分发后，最终报告必须包含以下结构化审计要素：

- **Job ID & Allocation ID**：分发的作业标识与具体分配编号。
- **实际执行节点与并发执行证据**：实际承载负载的目标节点 NodeID 与 Node Name，以及通过 Allocation 快照核验其实际执行 NodeID 的匹配记录；多任务场景下必须提供并发提交时间戳、各节点 Allocation 执行时间重叠证据。若任务落到 `imac` 或其他特定节点，记录其选点依据、健康与资源核验结果，以及按满载授权最大化调用的资源规格（如实说明可能引起的响应延迟或发热风险）。
- **选点规划与决策成因**：记录选择集群分发的技术权衡；阐明候选节点的任务契合度、可用算力预算、操作员优先级元数据或向后兼容偏好的裁定依据；若存在串行阶段，必须说明基于依赖图分析的真实前后依赖依据；若未充分利用全部可用节点（如降级并发度），必须陈述任务数少于节点或网络传输/准备开销瓶颈等具体理由。
- **源码标识**：使用的 Git Commit SHA 或工作区快照的 SHA256 校验和。
- **执行状态与真实退出码**：终端状态（`complete` / `failed`）及各阶段 Exit Code。
- **产物与日志检索**：生成的产物清单、日志提取命令或产物回收位置。
- **通道验证状态**：记录数据传输和缓存服务的实际验证范围（如是否仅为端口级部分验证）。
