# AsterHub native scheduled-task detailed design

English | [中文](2026-10-05-asterhub-native-scheduler-design.zh.md)

**Status: the user approved implementation from this document; implementation and acceptance are in progress.** Native AsterHub scheduling replaces the desktop product's DSH Schedule Bundle, ships in the installer, and is not a curated plugin. It executes only while the AsterHub Host runs; every trigger creates a fresh conversation. Chat authoring and the task-management page support creation, inspection, editing, and deletion, with an entry below Plugins. This document specifies intended behavior; it does not assert that every capability is implemented or verified.

## Summary

A user can ask for a news briefing every morning at 08:00 and save it after confirming the instruction, zone, workspace, and model. The Host starts an independent Session when due; the task page shows the next time, execution status, result, and failure reason. Hiding the window in the tray does not stop scheduling. Execution is not guaranteed while the app is fully closed or the computer is shut down or asleep; recovery applies the missed-occurrence rules.

## Table of Contents

- [Product scope and tradeoffs](#产品范围与取舍)
- [User flows](#用户流程)
- [Task and run data](#任务与运行数据)
- [Scheduling and concurrency](#调度与并发)
- [Execution and Session lifecycle](#执行与会话生命周期)
- [Accounts, models, and approval](#账户模型与审批)
- [Persistence and recovery](#持久化与恢复)
- [Host API and model tools](#host-api-与模型工具)
- [Task-management page](#任务管理页)
- [Native composition and installer](#原生组装与安装包)
- [Legacy Schedule data](#旧-schedule-数据)
- [Acceptance criteria](#验收标准)
- [References and review items](#依据与审阅事项)

## Product scope and tradeoffs <a id="产品范围与取舍"></a>

This feature is a default capability of the AsterHub desktop product. It follows Cordis services, plugin contributions, and reversible registrations. Native means built into the product, carried in its installer, and mounted by default; it does not introduce an OS service or another Python Agent. Scheduling does not modify the Agent loop or depend on an external npm plugin marketplace.

Support a one-time target, delay, daily, weekly, fixed interval, and custom five-field Cron; support creation, inspection, editing, pause, resume, immediate execution, stopping the current run, deletion, and run history. Daily and weekly rules use explicit IANA zones; daily 08:00 is not an interval of 86400 seconds after creation.

Exclude execution after app exit, waking the computer, automatic startup, cloud scheduling, cross-device synchronization, Webhook triggers, independent script mode, and automatic IM/email delivery. Results are stored first in AsterHub Sessions; tasks may write files in an authorized workspace. Creating a recurring task does not waive approval for external publication or sending.

Do not introduce third-party memory. A fresh Session receives neither the authoring conversation nor the preceding run's messages. Future native memory follows ordinary new-Session permissions and composition; the scheduler does not copy memory itself.

## User flows <a id="用户流程"></a>

### Chat authoring

1. The user supplies an instruction and frequency; the Agent produces a self-contained instruction, not a reference such as doing what was just discussed.
2. Prefill the current workspace when present; otherwise ask the user to select one. The default zone comes from the device, not UI language. The default model is the current Session's selected model in the current account catalog.
3. Show a confirmation card with the task name, complete instruction, recurrence, zone, workspace, model/reasoning effort, next three times, result location, and the facts that the app must remain running, execution consumes credits, and sensitive operations retain approval. Display frequency in natural language without requiring Cron knowledge.
4. The Host persists and enables the task only after confirmation; cancellation creates nothing. The model cannot submit a boolean that replaces human confirmation. Configuration changes invalidate an outstanding confirmation.
5. Success shows a task card and View task entry backed by a durable receipt; model text is not evidence that saving succeeded.

Example: name Daily news briefing; time every day at 08:00, Asia/Shanghai; instruction to search important domestic and international news from the last 24 hours, organize ten items by topic with source links and publication times, produce a Chinese briefing, and explain insufficient sources rather than filling the count from an earlier report. A real workspace and model must be selected. A result Session can be named Daily news briefing · 2026-10-06 08:00; an additional local file is not mandatory.

### Task-page creation and editing

Provide a direct form rather than opening another chat for the model to fill it. Both entry points use the same validation, confirmation, and storage service. The main fields are title, execution time, recurrence/interval, and task objective, with zone, workspace, and catalog model. Offer daily, weekdays, selected weekdays, every N minutes/hours, once, and advanced Cron. Preview the next three times before saving. Edits carry a revision; conflicts retain the draft and request refresh instead of overwriting another window or chat's changes.

Renaming does not change timing. Changes to instructions, timing, workspace, model, or reasoning effort require renewed authorization for future executions. Editing during execution affects only the next run; the current run retains its startup snapshot. Pausing does not stop a started run; stopping this run is a separate operation.

## Task and run data <a id="任务与运行数据"></a>

Task definitions and runs are distinct concepts. Because the existing storage-domain lacks cross-table transactions, initially store a task and its bounded runs in one record. A single atomic put saves occurrence claiming, next target, and current run without pretending that separate task/run writes form a transaction. Full execution text and tool traffic remain in the Session log and are not copied into the task record.

### TaskAggregate (proposed version 1 data)

| Field | Meaning |
|---|---|
| `id` | Branded, globally unique task identity that is never reused |
| `ownerAccountId` | Account ID confirmed by Host authentication; not model-selected and contains no token/key |
| `revision` / `recordVersion` | User-edit conflict revision; every durable write also increments recordVersion for scheduling/recovery comparisons |
| `authorizationRevision` / `ruleRevision` | Instructions, workspace, model/effort, or timing changes advance authorization; only timing changes advance ruleRevision; rename and enable/disable do not advance authorization |
| `name` / `instruction` | Confirmed name and self-contained instruction with explicit length limits |
| `workspaceId` | Explicit stored workspace; execution revalidates directory and registration |
| `timing` | Discriminated once/delay/interval/daily/weekly/cron rule; clock rules retain an IANA zone |
| `modelSelection` | Fixed catalog model ID and optional effort, without provider/Base URL/credentials |
| `enabled` / `deletedAt` | Recurrence enablement and soft deletion; deleted tasks never schedule |
| `nextOccurrenceAt` | Next planned UTC instant; no scheduling target after one-time completion or while paused |
| `consentRevision` | Last confirmed authorizationRevision; a mismatch prevents automatic execution |
| `occurrenceWatermark` | Processed occurrence instant and rule revision; prevents replay after history pruning or clock rollback |
| `pendingOccurrence` | Latest due occurrence waiting for capacity, plus its merged missed range; at most one |
| `activeRunId` | Run holding task execution ownership, including approval waits and stopping |
| `lastOutcome` | Latest summary distinguishing blocked configuration, skipped work, and execution results |
| `runs` | Bounded RunRecord list with metadata and Session/deliverable references only |
| `creationRequest` / `requestReceipts` | Creation identity, parameter digest, and expiring mutation receipts stored in the same put; independent of run pruning |
| `historyPruned` / `skippedRange` | History-pruning flag and time ranges skipped through pause/merging with reasons |
| `createdAt` / `updatedAt` | Host-sampled times; never substitute for revision ordering |

Validate all configuration at tool, Remote, and file entry points, and fully validate every task record on startup. Invalid or future-version records stop scheduling and produce locatable diagnostics. Never silently delete them, return a false empty list, or repair user files. Instructions, working directories, and history remain private local data and never enter the curated catalog service.

Use a normalized discriminated timing union: once stores `atUtc`; delay stores positive integer `seconds` and `anchorAt` / `atUtc` fixed at first durable creation; interval stores integer `seconds` of at least 60, `firstAt`, and `anchorAt`, where firstAt is the first target and anchorAt = firstAt − seconds. Later interval occurrences follow that anchor. Daily stores `time` and `timeZone`; weekly adds unique ascending ISO `weekdays`; cron stores a canonical five-field `expression` and `timeZone`. All targets are UTC. An interval-rule edit uses a supplied future first time, or accepted-write time plus interval when omitted. Resuming a paused interval reanchors at accepted-resume time plus interval and advances ruleRevision; changing only name/instruction retains phase. Replaying a delay receipt never reanchors it; editing its time converts it to once. `schemaVersion: 1` belongs to the domain declaration. Rule revision and occurrence instant jointly identify recurrence; record version does not replace schema version.

### RunRecord

| Field | Meaning |
|---|---|
| `id` / `taskId` | Branded run identity and task binding |
| `trigger` | scheduled / catch-up / manual; manual never consumes a future recurring occurrence |
| `scheduledAt` | Planned UTC occurrence; manual requests separately record requestedAt |
| `definitionRevision` / `snapshot` | Confirmed name, full instruction, timing, workspace, model, and effort snapshot |
| `sessionId` | Independent Session ID generated and stored at reservation; neither the authoring ID nor a history fork |
| `state` | reserved / running / waiting-approval / stopping / succeeded / failed / canceled / interrupted / unknown / blocked / skipped |
| `startedAt` / `finishedAt` | Actual start/termination times; startedAt absent before start |
| `reason` | Stable error/skip code and sanitized explanation without keys or raw authentication responses |
| `resultRef` | Session and result-message/deliverable references; never fabricate values without a successful result |
| `ownerRuntimeId` | Random identity of this Host startup used to recognize retained state after restart |

`blocked` means preflight refused execution before a model call; `failed` means started execution failed; `interrupted` means a confirmed stop/exit interrupted it; `unknown` means crash recovery cannot determine the final outcome; `skipped` means policy did not execute it. UI success describes a normally ended execution interval, not the accuracy of news or an external business result.

Initial retention: at most 200 terminal records, 30 days, and 2 MiB of terminal snapshots per task; reaching any bound prunes the oldest terminal entries in append order. Retain active runs and the latest terminal entry. Names are at most 120 characters; instructions at most 16000 characters and 64 KiB UTF-8; at most 100 undeleted tasks per account and 500 total tasks per data root, including deleted history. Host Config validates and exposes these limits; one maximum snapshot must fit below the history byte budget. Reaching task quota rejects creation with an entry for cleaning history rather than deleting automatically. Sessions follow existing Session retention; pruning task history does not delete Sessions and displays an earlier-records-cleaned marker.

## Scheduling and concurrency <a id="调度与并发"></a>

The Host starts scheduling after domain and account initialization, even without the UI open. Maintain one next-due timer, recheck wall-clock due state, and segment long delays. Recalculate after recovery, account changes, edits, and capacity release. Do not copy Hermes's multiprocess minute ticker, cloud provider, or lease-heartbeat topology.

Reuse DSH daily/weekly/Cron parsing and occurrence arithmetic. Extract pure functions and browser-safe types into an explicit library entry shared by both implementations; do not load the original ScheduleService, duplicate handwritten Cron arithmetic, or add an empty service to a pure library. Preserve existing consumers and public export behavior during extraction so there is one timing rule implementation.

Clock rules follow their saved zone. Skip missing DST times and choose the earlier overlap. Fixed intervals are at least 60 seconds; Cron uses the existing five-field Vixie dialect. System-zone changes do not modify saved rules; model-authored rules also require an explicit zone.

### Missed occurrences

- During Host downtime, sleep, or capacity queueing, retain only the latest due recurring occurrence and merge older ones into one summarized range rather than replaying each.
- Starting the app at 09:00 can catch up an 08:00 task once; show planned 08:00, actual 09:00 (catch-up). Catch-up still creates a fresh Session.
- Pause explicitly stops triggers; resuming never catches up paused time and starts at the next future target. Resuming an expired one-time task requires selecting a new time and never executes implicitly.
- An enabled one-time task overdue through downtime executes once after recovery and successful preflight, with a delay label; do not discard it using Hermes's default short grace window.
- Failure never automatically retries that occurrence. Recurrence retains future timing, and the user may explicitly run now. Clearing blocked configuration catches up only the latest due occurrence; never repeatedly try bad configuration or continuously spend credits.

### Execution limits

At most one active Run exists per task; approval waits also occupy capacity. A due occurrence never launches a parallel copy of the same task, and at most the latest pending occurrence remains. Default Host concurrency is two, configurable through Config. The global FIFO orders by planned instant and task ID. Editing cancels unclaimed pending work for the old definition; a claimed run never changes snapshot.

Run now shares reservation and concurrency admission with scheduled work. Repeated clicks carry requestId and receive an idempotent receipt. An already active task is refused with an entry to its current run, never silently started twice. Manual execution does not advance the recurrence watermark or next target. An explicitly confirmed one-time manual run of a paused task does not resume recurrence.

Pause atomically disables the task, clears nextOccurrenceAt and unclaimed pendingOccurrence, and saves the skipped range/rule watermark. Resume atomically sets the next future target without restoring stale pending work. A reservation after capacity release rechecks enabled, authorization revision, and rule revision. Pause does not clear a claimed Run. Occurrences queued before pause or missed while paused never catch up.

Default execution timeout is 30 minutes including approval waits, exposed as a positive bounded Host Config field. Timeout follows cooperative cancellation and awaits quiescence. Merely writing timeout and releasing capacity while old tools continue would allow overlap with the next run and is forbidden.

## Execution and Session lifecycle <a id="执行与会话生命周期"></a>

1. Check that the task is undeleted, enabled or manually authorized, confirmed, owned by the current account, bound to an existing workspace, and uses a valid model/effort; the app must not hold quit/update admission.
2. Recheck record version and global capacity in the domain management FIFO. One durable put records the reserved Run, fixed Session ID, execution snapshot, activeRunId, and future recurrence target/watermark. A failed write creates neither Agent nor model request.
3. Create a fresh root Agent/Session through workspace and preset composition, using the ordinary AsterHub assistant and controlled model. Install observation and safety rules before the first message. Never call agent-loop directly to bypass composition or persistence.
4. The first durable message identifies a user-confirmed scheduled task and contains task ID, planned/actual time, zone, and complete instruction. Its source is a typed scheduling producer, not fabricated real-time user input. All model-visible input must be reconstructable from the Session log.
5. Observe execution through the claimed inbox message and the exclusively owned run interval, tracking claim, turn/end, request failures, cancellation, and durable flush. A followup return, idle agent/status, or whenIdle alone never proves task completion.
6. Hold a Session owner throughout execution. Opening the result only navigates and never releases ownership early. At termination, close the interval, confirm and flush durable result evidence, dispose the exact handle, await associated resources, and finally atomically store task termination and release capacity. Failed terminal persistence retains reservation/recovery facts and blocks another run; never present persistence failure as success. Ordinary continuation after owner release uses existing Session Controller acquisition/resumption.
7. Human messages in the running Session enter the same execution interval and mark the result as human-intervened. Never attribute its final answer solely to the original task. After stopping the run, the user may continue manually without the scheduler settling that continuation as the original Run.

Derive waiting-approval from unmatched `approval/asked` / `approval/decided` events in [user-approval](../../../packages/interaction/user-approval/README.md) and the `userQuestions` projection in [user-questions](../../../packages/interaction/user-questions/README.md), never from Agent idle. Human interactions display waiting for your action, distinguishing approval from answers in the reason. Any unanswered nonterminal question (open or continued) prevents success even after turn/end. Later turns started by a user answer remain inside this Run's explicit interval.

Observation uses public core Agent events, Session projections, and owner handles without changing AgentLoop. If Session Controller lacks an internal create-and-hold operation accepting execution options, add an explicit Host method at that entry point, sharing preset/permission/model validation with ordinary conversations instead of faking a user Send through UI Remote.

Add `inputMessageId`, `startLogOffset`, `endLogOffset`, `terminalTurn`, `interactionIds`, and `humanIntervened` to Run so the execution interval and intervention are durable. A pregenerated Session ID does not prove Session creation; separately retain `sessionCreated`. Ending first closes this Run's input attribution in Session Controller admission, then checks no pending interaction/input, a recorded normal turn end, and resource quiescence. Messages after closure wait for owner release and enter as ordinary manual continuation. Timeout/stop/account switch also revoke this Run's approval, question, and automatic-continuation capabilities. Add explicit cancellable-interaction methods when existing APIs are insufficient; writing a terminal state alone is insufficient. Checking, closing, and attributing new input share one serialized owner; frontend button disablement cannot prevent races.

| Run transition | Required conditions |
|---|---|
| reserved → running | Session created/registered and initial message durably claimed; startedAt fixed |
| reserved → blocked/failed/interrupted/unknown | New Session cannot be established or startup is unconfirmed; blocked requires no model call; retain reason and Session existence facts |
| running ↔ waiting-approval | Determined by nonterminal interactions in this interval; an idle Agent can still have a waiting Run |
| reserved/running/waiting-approval → stopping | Cancellation accepted but capacity held; revoke interactions and await quiescence |
| running → succeeded/failed | Interval closed and terminal evidence/results committed; idle alone never proves success |
| stopping → canceled/interrupted | Resources stopped and Session flushed; timeout uses failed with timeout reason |
| startup recovery → unknown/interrupted/proven terminal state | Previous owner exited; classify by durable interval evidence without replaying when evidence is absent |
| unclaimed trigger → blocked/skipped | Record nonexecution only; never invent an execution Session |

Every terminal state has finishedAt and cannot return to running through later notifications. Reserved/running/waiting-approval/stopping hold activeRunId. After resources settle, one put stores terminal history and clears activeRunId. Configuration-blocked/skipped entries may have no Session; rescheduling and UI must preserve this distinction.

## Accounts, models, and approval <a id="账户模型与审批"></a>

### Account isolation

Tasks and Runs bind to stable account identities supplied by the Host, never claimed through renderer labels or editable email. After logout or another login, the old account's tasks neither execute nor become visible/manageable to the new account. Do not share task snapshots or new result navigation across accounts. This feature does not broaden global history policy for retained Sessions.

Checking only at startup is insufficient because adapters read the active credential record and a switch can replace its key. The account service must provide authentication epochs and read/write coordination. Before each model request, a run confirms ownerAccountId/epoch and obtains a short credential-use permit. A switch blocks new calls from the old epoch, cancels its Runs and awaits requests/tools, then publishes new credentials. The permit spans actual credential resolution and request dispatch, excluding the race between checking and key replacement; never hold a long lock while waiting for human approval.

Results already produced by the old account remain under it. Stop for account change without automatically migrating results. Missing account identity/epoch fails closed; do not assume getPlatformSession already supplies isolation.

Confirmation is a Host-owned single-operation ticket binding account ID, authentication epoch, operation kind, target task, expectedRevision, authorization revision, and normalized configuration digest, with a suggested five-minute expiry. The model submits drafts but receives no transferable authorization ticket. Client confirmation returns through existing interaction channels. Natural advancement of next-run previews does not invalidate otherwise identical content; authorization/account changes do. Create/update/resume/runNow capture identity on entry and recheck at serialized writing. A switch invalidates uncommitted tickets; late receipts never appear on the new account page. Execution-changing update and runNow on a paused task require confirmation. Rename, pause, and resume under confirmed configuration do not revoke existing recurrence authorization.

### Models and capabilities

Creation fixes the user's selected catalog model and effort; the task page may select another valid model from that account. Tasks neither accept nor store provider, Base URL, API Key, or third-party model configuration. Calls retain applicationModelRoute and Host credential records. Removed models, logout, or failed initial catalog synchronization block execution without choosing a replacement or silently lowering effort. Later model changes in the authoring conversation do not modify the saved task.

Before execution, validate referenced existing skills/tools and the workspace. Ordinary network requests may still fail; record the error rather than promising that preflight guarantees news-site reachability. Missing workspaces, disabled dependencies, or invalid configuration never trigger background installation, directory creation, or permission grants.

### Approval and autonomous scheduling

Chat confirmation authorizes task content and recurrence, not arbitrary external effects or full access. Retain ordinary AsterHub approval. Approval/questions durably show waiting-approval with a link to the run Session. When the user is away, wait until timeout without approving, fabricating answers, or treating task creation as an exemption.

Scheduled Runs and descendant Agents do not register task-mutation tools. The Host also rejects create/edit/pause/run/delete by run origin, preventing tool injection or subagent bypass. A run may read its own task information but cannot extend authorization or create another task tree. Third-party Host plugins retain same-process authority; these policies are not OS isolation against malicious plugins.

## Persistence and recovery <a id="持久化与恢复"></a>

Use version 1 of the proposed `asterhub-automation` domain, storing each task and bounded Run metadata together. Storage-domain continues routing JSON/SQLite backends. New data types update persistence declarations and type acknowledgements; never alter, move, or rewrite committed historical Session generations.

The domain has one registered Host owner; Desktop single-instance behavior does not replace storage write ownership. Locks/backend exclusive opening must reject a second scheduler on the same data root. Without exclusive ownership, show an error and execute nothing rather than falling back to independent in-memory locks in each process.

| Interruption point | Recovery |
|---|---|
| Before durable reservation | Record unconsumed; may claim under the latest-due rule |
| Reserved committed, Session creation unconfirmed | Retain attempt, mark interrupted/unknown, inspect fixed Session ID; never resend automatically |
| Session created, message submission uncertain | Show Session and unknown; idle does not imply nonexecution |
| Tool executed before terminal record | Try to prove termination from the durable interval; otherwise unknown, never replay external effects |
| Terminal record persisted | Do not trigger again; follow saved next target |
| Creation/management receipt lost | Return saved account + requestId receipt within the idempotency window; never duplicate creation/run; reject expired automatic replay |

Occurrence watermark and next target share one write, so history pruning or clock rollback alone cannot repeat claiming. A claimed but unstarted run may require manual inspection/retry after a crash. This explicitly favors avoiding duplicate effects and does not promise end-to-end exactly-once. Unknown state does not mean the business operation never happened.

Soft deletion retains history, watermark, and in-flight ownership. Running tasks cannot be directly deleted by default; stop and await settlement first, then delete. Pause can immediately prevent the next trigger. Deleting does not remove the original Session, generated files, or run history. History cleanup is an explicit independent user action and never recursively deletes directories automatically.

Every write API carries requestId. Creation serializes deduplication, quota, identity/confirmation validation, and put through the domain FIFO. Existing-task writes use the same sequence; another task cannot cross global quota/concurrency checks while a durable write is pending. Receipts bind normalized parameter digests and are retained for a suggested 30 days, at most 1000 per task. A full budget without expired entries rejects new writes instead of erasing valid receipts. Host-issued request identities bind account and expiry; after 30 days, replay is refused and renewed confirmation obtains a new ID. Writes validate current account before looking up valid committed receipts. A committed request returns its original receipt despite expired confirmation or changed expectedRevision; same key with different parameters is refused. Creation receipt and initial task share one record; other receipts share their task put. In-memory indexes are reconstructable accelerators, not truth.

Add explicit `purgeDeleted` for the current user's deleted tasks with no active run and all receipts outside the 30-day window. Confirmation removes the aggregate, not Sessions/deliverables. Capacity uses canonical UTF-8 JSON bytes. Budget terminal history at 2 MiB, receipts at 1 MiB, and the aggregate at a suggested 4 MiB. Config must accommodate a maximum snapshot, an active Run, latest result, and receipt budget or refuse loading. When no legal pruning can fit a record, stop claiming and report storage-quota blocking; never truncate instructions. The global 500-task bound includes other accounts and reports installation-root capacity without disclosing their tasks. Only separately authorized local maintenance can clean another account's expired deleted data; ordinary account pages cannot. No automatic cross-account cleanup is introduced.

Active result Sessions cannot be directly deleted or archived. Add automation-run activity through workspace admission, requiring stop and settlement first. Normal deletion of completed Sessions/deliverables only marks references unavailable. Removing a workspace blocks its tasks while retaining definitions/history; never recreate its directory or move work elsewhere.

## Host API and model tools <a id="host-api-与模型工具"></a>

The proposed `ctx.asterhubAutomation` service is shared by Host, tools, and Client. Its proposed Remote namespace is `automation`, with names/types added to Typert during implementation. The methods below are proposed additions, not current APIs:

| Method | Inputs and obligations |
|---|---|
| `preview` | Draft; validate identity/rule/model/workspace and return normalized draft, authorization digest, and next three instants without creating a task |
| `prepareOperation` | Operation kind, target, normalized parameters; issue account/expiry-bound requestId and request confirmation when required without writing |
| `create` | Draft + requestId + Host-owned human confirmation; return receipt after persistence |
| `list` / `get` | Current-account tasks only, with paging/state filters; reads never start Sessions |
| `update` | taskId + requestId + expectedRevision + changes + required Host confirmation; conflict writes nothing |
| `pause` / `resume` | taskId + requestId + expectedRevision; resume chooses the next future target and clears stale pending work |
| `runNow` | taskId + requestId + target authorization revision; paused/unknown retries require confirmation; return runId and actual state, not execution success |
| `stopRun` | runId + requestId; request cooperative cancellation and enter stopping; publish final state later |
| `remove` / `purgeDeleted` | taskId + requestId + expectedRevision + confirmation; soft deletion or post-retention cleanup of the user's deleted records |
| `runs` | taskId + exclusive cursor + limit; return a bounded page and earlier-history-pruned marker |
| `inspectLifecycle` | Private Host query across accounts for enabled tasks, active Runs, and stopping resources without task content |

Chat can expose one action-style `automation_manage` tool for create/list/get/update/pause/resume/run/remove, with a discriminated action schema requiring each operation's fields. The Host validates identities, workspaces, and catalog models. Human confirmation uses existing interaction mechanisms; payloads contain no private keys, account keys, or forgeable authorization flags. Invalid parameters, conflicts, account mismatch, logout, unavailable models, active runs, and unavailable storage return stable errors. Task text never masquerades as a system instruction.

Client uses authenticated Typert Remote. Incremental notifications cover only current-account visible tasks; reconnect re-reads authoritative records. Cursors bind account, task, and ordering revision and cannot read across accounts. Model-visible receipts, snapshots, and execution inputs enter existing tool/message logs; UI drafts and pure list reads do not add model context.

## Task-management page <a id="任务管理页"></a>

Add a persistent Scheduled tasks entry directly below Plugins and above the workspace list, matching Plugins icon treatment, indentation, row height, hover, and selection. It is not a plugin submenu, settings subpage, or curated item, and remains visible with zero tasks. Register through existing `sidebar.panellist`; Plugins currently has order 0, so place native tasks next (suggested order 10). Replacing ui-schedule must not produce two task entries. Verify actual final adjacency, not only numeric registration values.

Clicking selects Scheduled tasks and opens its management panel in the main content area while retaining workspace/Session navigation, without another native window. Use the existing `main` keyed panel and Plugins full-page layout. Entering neither creates nor activates an Agent/Session nor changes the current draft. Returning restores draft, scrolling, and selection. Product text uses typed locale dictionaries; reuse sidebar, forms, confirmations, toast, date/zone components rather than introducing a separate style system.

The panel header has Scheduled tasks and New task. Below it, show search, state filters, and the current account's tasks. Rows show title, enabled/paused state, instruction summary, frequency/zone, next execution, and latest run status. Title or primary row area opens detail; independent row actions do not. Retain paging and selection. Empty state offers New task and a brief example. Initial loading uses skeletons; failures offer retry and retain old data instead of pretending to be empty. Logged-out state shows an authentication gate, not no tasks. Zones display a recognizable name and UTC offset, distinguishing saved rule zone from the next time in the device zone.

Detail stays in the same main panel with a back-to-list entry restoring search/filter/scroll. Wide layouts may split list/detail; narrow windows navigate between them without forcing the chat right sidebar. Detail has Task configuration and Run history tabs plus explicit Edit/Delete. Configuration displays full title, time, interval/recurrence, instruction, zone, workspace, and model. Editing uses the same fields. Successful save displays the latest Host values; cancel restores stored values. Leaving unsaved asks whether to discard. Run rows show planned/actual start, state, manual/catch-up markers, duration, failure reason, and View result. Failed/unknown runs may still open their Session; deleted Sessions show unavailable results. Files use existing deliverables access, never arbitrary frontend reads of Host paths.

Delete confirmation names the task and explains that future executions stop while history, Sessions, and files remain. Active runs block deletion with a stop-current-run operation; stopping is separately confirmed and must settle before deletion. Successful deletion returns to the list, removes the row, and uses an application toast. Failure retains task/detail with a retryable toast. Pause/resume remain shortcuts. Creation and authorization-changing edits show a complete summary. Conflicts/validation failures retain drafts with field/form errors instead of closing and losing input.

### Direct creation form

New task directly opens the form without creating a chat, sending a model request, or requiring tool-parameter knowledge. Edit reuses it under Edit task and fully prefills saved configuration.

| Field | Control and validation |
|---|---|
| Title | Required trimmed text, e.g. Daily news briefing, at most 120 characters |
| Recurrence | Once, daily, weekdays, selected weekdays, interval, advanced Cron; default daily, enabled after confirmation |
| Execution time | Date/time for once; clock time for daily/weekly; first date/time for interval; reuse a 24-hour picker |
| Interval | Numeric value and minute/hour unit only for interval mode; minimum one minute; understandable copy such as every two hours, mutually exclusive with daily clock time |
| Weekdays / Cron | Weekday selector or five-field expression only for the relevant mode; ordinary users need not fill Cron; invalid Cron shows a field error and prevents submission |
| Objective | Required multiline instruction, preserved without model rewriting; e.g. search the last 24 hours of news, organize by topic, and include sources |
| Zone | Device's real zone prefilled with searchable choices; changes preserve local clock input and refresh preview |
| Workspace | Required registered workspace; may prefill current selection but never create a missing directory in the background |
| Model / effort | Valid current-account catalog choice; saved defaults may prefill, otherwise require selection rather than taking the first entry |

Switching recurrence submits only fields for that mode. Hidden values from another mode cannot remain in the request. Local draft retention across mode switches is allowed but cannot combine time and interval rules. Daily 08:00 is a clock rule; first 08:00 and every two hours is interval with `firstAt` and `anchorAt`, initially targeting firstAt and then firstAt + N × seconds. Without an explicit first time, show that the first run is one interval after saving; the Host sets firstAt from accepted-save time plus interval. An absolute first instant must be strictly future. Editing interval/first time reanchors, advances rule revision, and requires confirmation; name/objective edits do not reset phase.

The footer offers Cancel and Create task (Save changes for edits), next three times, and explanations of fresh Sessions, running-app requirement, and credits. A valid form proceeds through confirmation before submission; creation never immediately executes once. Immediate execution uses Run now on a saved task. Block duplicate save clicks and deduplicate server requestId. Failure retains all inputs and explicit retry. After Host confirmation/save, return to the list, locate the new task, and open detail without taking over another running conversation.

Use labels and error text rather than placeholders alone. Support keyboard navigation; Escape closes calendar/time menus and restores focus. Closing creation or switching tasks asks before discarding unsaved input. Verify light/dark, Windows controls, and small windows so buttons remain visible and menus stay inside the viewport. Follow repository [styling rules](../../web-styling.md) and existing Plugins tokens/components without new palettes, typography, or external component libraries.

Each Run appears in ordinary Session lists with a recognizable title and Scheduled task origin. The task page aggregates history without stealing current-conversation focus. Completion, failure, and approval waits use existing notifications. If a shell lacks the needed native notification API, add an explicit notification-only capability. Notification failure never rolls back saved results or changes success to execution failure. Notifications contain no news body, file contents, or secrets. UI status remains visible without OS notification authorization.

## Native composition and installer <a id="原生组装与安装包"></a>

Use one Host-owning and one Client-owning package, reusing core/API/storage/interaction services. Proposed locations are `packages/schedule/asterhub-automation/` and `packages/client/ui-asterhub-automation/`. A single nonreplaceable implementation does not need three empty Service Definition/Provider/Consumer packages; definitions, provider, and tools may be modules inside the owning package.

Mount through Desktop-specific composition and include it in `apps/desktop-host` resolution and runtime materialization. Include the Client entry in desktop renderer generation and packaging. Service and persistent panel activate by default without plugin-page enablement; ordinary plugin installation/removal cannot accidentally stop this product capability. Ship the pure timing library as an internal dependency without mounting DSH Schedule Bundle.

Exclude `@deepseek-ai/dsh-experimental-schedule-bundle` from Desktop's optional official bundle list and selected-bundle reconciliation. Its `schedule`, `ui-schedule`, and bundled `time-context` rows must not mount. Other desktop time-context needs are declared once by AsterHub composition. Upstream CLI/SDK and shared package source may remain; do not remove Schedule repository-wide.

Startup/configuration changes must switch the actual reserved desktop profile, installed dependencies, Client registrations, tool schemas, and quit inspection, not merely hide names in README or UI. Do not automatically add native functionality to shared web/headless/SDK profiles or delete other user plugins while removing the old bundle.

Desktop owns its reserved `desktop` external-plugin profile and app-created development/runtime images. Ordinary web/headless/SDK/custom profiles do not migrate. Idempotent migration changes only app-owned built-in composition and old Schedule selection, retaining other dependencies/patches. If the Desktop patch manually mounts old ScheduleService/ui-schedule, startup detects conflict before either scheduler is admitted and shows conflicting rows and corrections. Never silently delete patches or permit overlapping automatic execution.

Store versioned `automationCutover: 1` with the complete app composition in the installed profile's configuration document. New scheduling does not start before migration completes; upgrade startup never starts old scheduling first. A failed configuration write/load verification keeps both schedulers from triggering and reports a recoverable error. Product rollback does not promise automatic restoration of old Schedule. Tighten rollback admission with the upgrade: builds that recognize but do not support the marker refuse the profile; when older installers cannot recognize it, explicitly forbid overwrite downgrade and retain backup rather than claiming transparent rollback. Acceptance covers existing profiles, retained plugins, manually conflicting rows, interrupted migration, repeated startup, and unaffected non-Desktop composition.

Implementation entry points:

| Owner | Required integration |
|---|---|
| `apps/desktop/src/project-manager.ts` | `createPluginProfile` and development/runtime metadata use desktop-native composition while retaining external dependencies |
| `apps/desktop-host/src/index.ts` | Load the native Host through the profile runner, without a launcher bypassing dsh profiles |
| `apps/desktop-host/package.json` and `apps/desktop/scripts/prepare-dsh.ts` | Explicit runtime resolution and verification that Host/Client artifacts and timing library ship |
| `packages/api/session-controller/src/agent.ts`, `commands.ts` | Share preset, model choice, workspace registration, and Session ownership; add Host-only creation if needed |
| `packages/webhook/webhook/src/session.ts` | Reuse fresh-Session setup, attachSession, permission, and title ordering without calling Webhook business APIs |
| `packages/account/account-sub2api/src/index.ts` and request paths | Add identity epochs, switching admission, and short credential permits; replace keys only after old-account work settles |
| `apps/desktop-host/src/quit-inspection.ts`, `update-tasks.ts` | Global task checks, update admission locking, and active-resource stopping |
| `packages/client/ui-schedule` components and slot/Remote patterns | Reuse pure date/zone controls and layout, excluding same-Session data sources and schedule Remote from the native panel |
| Optional bundle resolution in `packages/boot/app-boot/src/profile.ts` | Exclude old bundle only for Desktop while retaining upstream non-Desktop behavior |

Quit inspection covers the global task table rather than only schedule families of loaded Sessions. Hiding the window keeps services alive; real quit warns about suspended enabled tasks and interrupted active runs. Update installation closes scheduling admission, then applies existing update policy to active Runs, descendants, jobs, and approval waits. Stop accepted runs/resources fully before closing storage. Future scheduled tasks alone are not running work and do not block an explicitly accepted installation; the new Host reopens storage and restores future targets.

## Legacy Schedule data <a id="旧-schedule-数据"></a>

Do not silently convert DSH same-Session reminders into fresh-Session tasks: model choice, workspace, self-contained instruction, account identity, and recurrence authorization are not equivalent. On first cutover with old reminders, explain the change and let the user review/create new native tasks. Retain old task domains and Session logs without automatic deletion or whole-database scanning/migration.

Only one scheduler may activate during Desktop cutover: stop the old service and await quiescence before starting the new one. Removing old bundle selection does not invoke ordinary uninstall that deletes user package data. A successful new task does not imply the old reminder was canceled. Old reminders no longer schedule after cutover; explain this in migration guidance. Provide an upgrade guide with manual recreation and retained-data locations.

## Acceptance criteria <a id="验收标准"></a>

This is a design; the following are required checks, not completed results. Timing/concurrency use injected wall clocks/controlled timers and isolated data roots, accounts, and listeners rather than real sleeps or shared CI directories.

| Scenario | Required observation |
|---|---|
| Chat creates daily 08:00 news task | Durable only after confirmation; next-three preview matches Host rules; restart retains configuration |
| Direct task-page creation | Same service as chat; cancellation leaves no enabled task; no model filling required |
| Main entry and panel navigation | Scheduled tasks directly below Plugins and above workspaces; one main-panel registration; returning retains chat draft |
| Own tasks and detail navigation | Correct current-account loading, full configuration/history, retained search/filter on return |
| Manual title/time/interval/objective form | Prefill and required validation; distinguish daily 08:00 from first 08:00/every two hours; no model call to create |
| Edit, cancel, delete success/failure | Prefill; cancel saves nothing; conflict retains draft; confirmed deletion stops future work only; failure retains row |
| Two consecutive occurrences | Distinct Session IDs without inherited conversation; same workspace/fixed catalog model; independently navigable results |
| Tray hidden | Due work executes without the panel open or taking conversation focus |
| Exit/sleep across occurrences | No execution while stopped; startup/recovery catches up at most latest; paused periods never catch up |
| DST and clock rollback | Skip missing times/earlier overlap; consumed occurrences never execute again |
| Long same-task run and double Run now | No task overlap; manual requestId idempotency; next recurrence unchanged |
| Edit/pause racing due time | Linearize by FIFO durable order; current snapshot excludes later edits |
| Rename, pause/resume, authorization | Rename/resume do not unexpectedly revoke consent; pause clears unclaimed pending work and capacity release never revives it |
| Lost receipt, restart, history pruning | Original requestId returns original receipt for 30 days; different parameters rejected; expiry never automatically reexecutes |
| Confirm under A, switch to B, submit | Old ticket/requestId never rebound to B; old receipt never shown under B |
| Answer retained question after stop or send during ending | Original Run never resumes; new input uses explicit ordinary manual admission |
| Account switch/logout including request-start race | Old task never uses new account credits/key; stop old Run before replacement; new account cannot read old tasks |
| Removed model/unavailable catalog/no workspace | No automatic request; explicit blocked reason; no fabricated successful Session |
| Approval waits and timeout | Navigable waiting Session, no automatic approval, capacity released after resource settlement |
| Run or descendant creates tasks | Host refuses even if tools are additionally injected |
| Crash at reservation, Session flush, tool effect, settlement | No silent duplicated effects; unknown plus retained Session; manual retry explains risk |
| Corrupt storage/second Host owner | Fail closed, preserve data, never return an empty catalog or start a second scheduler |
| Update interruption and recovery | Admission closure, active-resource settlement, and storage close are ordered; new version restores tasks |
| History pruning and deletion | Watermark retained, Sessions/deliverables preserved, soft deletion has no future trigger |
| Real installer | Host/Client/timing dependencies available offline, default visible entry, no old Schedule tool/bundle activation |
| Existing profile upgrade, manual old rows, downgrade | Other plugins retained, no dual scheduling, failed migration never triggers, non-Desktop unchanged, no claim of automatic old-build rollback |
| Cleanup after deleted history reaches quota | Eligible own deleted records release capacity without deleting unexpired-idempotency or foreign-account data |

Evidence includes focused Host lifecycle/storage tests, account isolation and routing integration, Client Remote/interaction tests, real desktop smoke, model-visible keyless snapshots, and Windows packaged task creation/short-interval runs. Model calls need authorization and real execution; delivery-only or compilation checks do not establish execution/deliverable proof. Product-UI PRs record a GIF through the real service/model path.

## References and review items <a id="依据与审阅事项"></a>

- [Hermes Cron user guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/cron.md) and [internals](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/cron-internals.md): reuse ideas for fresh Sessions, task lifecycle, preflight, and separate execution/delivery results; do not copy provider fallback, script/cloud topology, or every recovery mechanism.
- [DSH Schedule](../../../packages/schedule/schedule/README.md) and [task UI](../../../packages/client/ui-schedule/README.md): existing clock rules and original-Session delivery lack fresh execution Sessions, pause, and Run now; they do not prove completion of this design.
- [Agent Loop creation](../../../packages/core/agent-loop/README.md), [architecture](../../architecture.md), and [defensive rules](../../defensive-patterns.md): reuse public Agent/Session APIs, durable messages, and exact teardown; idle never proves one message complete.
- [storage-domain](../../../packages/storage/storage-domain/README.md): durable single-record writes without cross-table transactions determine task/reservation atomicity.
- [Desktop lifecycle](../../../apps/desktop/README.md) and [account service](../../../packages/account/account-sub2api/README.md): window-close versus quit, fixed routing, and Host credentials. Implementation updates conflicting old documentation; this design does not rewrite current runtime facts.

Reviewable choices: fix the creation-time model rather than follow global defaults; catch up latest recurrence after recovery but never paused time; no same-task overlap and a suggested global capacity of two; approval waits count toward 30-minute timeout; stop before deleting active tasks and retain history; initially deliver in-app without IM/email. These values may change without altering the confirmed direction of native composition, runtime-only scheduling, and fresh Sessions per execution.
