# Agent Harness T04：首条持久化只读 Agent Run 证据报告

## 1. 范围与结论

Issue #60 交付了一条固定范围的只读 Agent Run：用户以版本化请求启动 `scriptAgent` 的项目指导任务，Runtime 持久化 Run、Model Step、最终输出与安全 Trace，并提供按 Project 隔离的 HTTP 检查接口。HTTP 返回的持久化快照是事实源；聊天消息只是可重复生成的 UI 投影，Socket 不参与状态判定。

本阶段只读取 `o_project` 与 `o_novel` 的项目事实，不修改 Script、Asset、Storyboard、Video 等生产工件，不开放工具调用，也不自动恢复或重放不确定的模型请求。这是后续 Agent Harness 的最小纵向切片，不是完整的多步骤编排、人工审批或因果 Trace 系统。

代码证据范围：App 基线 `562836b3c752265f688ec80426557200ef70ab60`；T04 功能提交 `24a9a36328e50785636bb4a58ab02bc95e516a47`；证据边界加固提交 `8cf6c944f2736ead73020272ef639c41e7dc06bc`；凭据与上下文分类对齐提交 `f35df53dd30b4b3b767a8929b14c51f2f1890acf`。本文档只陈述这三个 T04 代码提交能够核验的行为。

T04 未修改 `data/serve/app.js`、`data/web/**` 或 Toonflow-Web 源码。既有 Web 冻结基线仍为 `c8c0bf48cde30b4634c05b652454b701f8980e04`；checked-in `data/serve/app.js` Git blob 为 `073c2143fd794646d56e0331aec42b097ec382ee`，SHA-256 为 `D6E463FA637455C117750DFEFA428A2D26EADA4721D70F27D9504B0D9DE050BD`。`data/web` 六个文件的 SHA-256 仍与 `docs/reports/agent-harness-baseline-57.md` 冻结表一致。由于本阶段按约定未执行 build，这些值只证明 checked-in 产物未变化，不代表 T04 源码已经重新构建验证。

## 2. 版本化契约

启动契约为 `toonflow.agent-run.start.v1`，固定角色 `scriptAgent`、固定范围 `read-only-project-guidance-v1`，请求包含 `projectId`、`clientRequestId` 与非空 `content`。最终输出契约为 `toonflow.agent-run-output.v1`，聊天投影契约为 `toonflow.agent-run-ui.v1`。

幂等键的实际作用域是 `(projectId, role, scope, clientRequestId)`。Runtime 先 trim `clientRequestId` 与 `content`，再计算包含规范化完整输入的 `requestFingerprint`：相同键和相同输入返回既有 Run；相同键但不同输入返回冲突。写入采用 SQLite `onConflict(...).ignore()` 后重读权威记录，并对瞬时 `SQLITE_BUSY` 做一次使用相同身份的安全重试；联合唯一约束与指纹共同守住语义。

`inspect({ runId, projectId })` 只执行查询，不追加 Trace、不推进状态、不触发模型调用，并以 `projectId` 限定可见范围。读取已持久化诊断时会重新验证 Trace-safe schema；损坏、夹带未知字段或不安全的诊断会 fail closed，而不是通过 TypeScript cast 泄漏到响应。页面刷新后可再次通过 HTTP 取得同一 Run 的 Step、Output、Trace 与版本号。

## 3. 持久化模型

| 记录 | 职责 | 关键约束 |
| --- | --- | --- |
| `o_agentRun` | 请求身份、生命周期、注意力、版本与时间戳 | 幂等作用域唯一；`version` 随状态提交递增 |
| `o_agentRunStep` | Run 内有序 Model Step | `(runId, ordinal)` 唯一 |
| `o_agentRunOutput` | 可展示的最终文本 | `(runId, stepId)` 唯一；保存内容哈希与 schema 版本 |
| `o_agentTrace` | 有序、安全的生命周期与诊断证据 | `(runId, sequence)` 唯一；不保存隐藏推理或 Provider 原始负载 |

Run 中的 `input` 是执行所需的业务输入快照，不会复制到 Trace 或 UI 扩展字段。输入和最终输出在写入前都经过 persistable-text gate：拒绝 credential，以及 `password=...`、`apiKey: ...`、`cookie: ...`、`token=...` 等敏感赋值文本，拒绝签名 URL 与 base64 负载，允许普通 URL。Step 同时记录逻辑模型目标、实际解析后的安全目标元数据和提示词指纹；目标元数据只包含 Vendor/Model 标识与调优参数，不包含凭据或 Vendor 源配置，并在外部模型调用前单独持久化，因此失败调用也能审计其已解析目标。

## 4. 状态与 attention 正交

持久化 Run 生命周期为 `queued | running | waiting | succeeded | failed | cancelled`。`needs-attention` 不是第二套持久化状态，而是 UI 对“`status=waiting` 且 `attentionReason` 非空”的显示投影。这样执行停在哪里与是否需要人工介入是两个可独立回答的问题。

当前切片实际写入的主链是 `queued -> running -> succeeded|failed`；进程启动恢复链包含 `queued/pending -> waiting` 与 `running -> waiting`。`src/agentRuntime/lifecycle.ts` 集中维护 Run/Step 转换图，写入还同时校验旧状态、Run version 与受影响行数。类型契约为后续显式取消预留 `cancelled`，但本阶段没有伪造尚未实现的取消命令或恢复命令。恢复后的允许动作只有 `inspect`。

## 5. 事务与外部调用边界

模型调用不在数据库事务内。实现采用分段短提交：

1. 启动事务：校验 Project，原子写入 `queued` Run、`pending` Step 和 `run.created` Trace。
2. 领取事务：以 Run 状态和版本进行条件更新，原子写入 `running` Run、`running` Step 和 `run.started` Trace。
3. 调用前证据：解析逻辑模型目标，将安全的 resolved target 写入仍为 `running` 的 Step；写入不成功则不调用模型。
4. 终态事务：通过输出持久化门禁后，模型成功时原子写入 Output、`succeeded` Step、`succeeded` Run 和 `run.succeeded` Trace；失败时原子写入 `failed` Step、`failed` Run 与 Trace-safe 诊断事件。

该边界避免长事务包裹网络请求，也明确承认“远端可能已执行、但本地终态未提交”的不确定窗口。成功终态写入任一部分失败时事务整体回滚，随后 Runtime 走失败收敛，不留下成功 Output 与非成功 Run 混合的半提交状态。

失败诊断按实际失败边界分类，而不是把所有异常都标成 Vendor：Project/Novel 查询抛错归为 `Context/executionFailed/known-no-effect/safe-retry`；查询成功但确认 Project 不存在才归为 `Context/contextMissing/known-no-effect/never`；目标解析和模型调用归为 `Vendor`，并按是否已发出调用区分 known-no-effect 与 unknown-effect；目标证据或终态数据库提交失败归为 `Artifact/persistence`；输出未通过持久化门禁归为 `Artifact/redaction`。这套分类同时决定 certainty 与 retry disposition，使 Trace 能表达处置差异。

## 6. 重启恢复

数据库 readiness 的固定顺序为 schema、upgrade、defaults、recovery、validate。恢复阶段把遗留 `running` Run 与 Step 原子停放为 `waiting`，以 `Vendor` 分类记录 `interrupted-model-call`、`certainty=unknown-effect` 与 `reconcile-first`；把遗留 `queued/pending` 停放为 `waiting`，以 `Decision` 分类记录 `interrupted-before-model-call`、`certainty=known-no-effect` 与 `safe-retry`。两者都写入 waiting/attention 原因、递增版本并追加 Trace-safe 诊断。

每个待恢复 Run 必须恰好拥有一个与其前态匹配的 active Step；Step/Run 更新也必须各影响一行。零个或多个 active Step、前态/version 竞争等损坏条件都会让整个恢复事务回滚，不接受“挑第一条继续”的静默修复。恢复不会自动重放任何任务：running 无法证明 Provider 是否已经完成或计费，queued 虽然已知未产生外部效果，但当前也没有持久队列/显式恢复命令。第二次恢复不会重复改写已离开活跃状态的记录，也不会追加重复 Trace。

## 7. HTTP 与聊天 UI 投影

- `POST /api/agentRuns/start`：校验版本、固定角色/范围、Project、规范化输入与持久化安全门禁，返回 `{ run, message }`。
- `POST /api/agentRuns/inspect`：按 `runId + projectId` 纯读，返回同样的持久化快照及其聊天投影。
- UI 投影使用 Run ID 作为消息稳定 ID，使用 Run ID 派生内容块 ID，并携带 Run `version`、持久化状态、显示状态、attention 与允许动作。
- 终态文本来自持久化 Output；失败态只显示固定安全文案。前端或 Socket 即使断开，也不会成为执行状态的事实源。

本阶段仅交付 App HTTP 返回现有 `AIMessage` 形态的投影契约与路由，不包含 Toonflow-Web 实际消费改造、跨仓库页面刷新/浏览器验收或 Socket 通知接线；因此不能表述为“现有 UI 已接入”，这些必须在后续集成阶段按同一事实源契约完成。

## 8. 测试证据

阶段验证限定为聚焦单元/契约测试与静态检查，覆盖：

- 新库建表、旧库补表且不改写既有 Project 数据；
- 幂等重试、幂等冲突、并发相同启动只调度一次；
- 双数据库连接竞态、SQLite conflict 重读与瞬时 busy 收敛；
- Project 缺失拒绝与启动事务回滚；
- inspect 纯读、Project 隔离，以及损坏持久化诊断的 fail-closed 重验证；
- 输入/输出持久化门禁：credential、password/apiKey/cookie/token 敏感赋值、签名 URL、base64 拒绝，普通 URL 允许；
- Context、Vendor、Artifact/persistence、Artifact/redaction 失败分类，以及失败调用的 resolved target 审计；
- 成功终态提交注入失败后的整体回滚；
- queued/Decision 与 running/Vendor 两类重启恢复、恢复幂等、恰好一个 active Step 不变量与 attention 投影；
- HTTP 版本/范围校验、404 与 UI 投影；
- 已解析模型目标元数据契约。

证据文件：`tests/agentRunSchema.test.ts`、`tests/agentRunRuntime.test.ts`、`tests/agentRunRoutes.test.ts`、`tests/configuredVendor.test.ts`、`tests/traceSafeDiagnostics.test.ts`。核心定向集合通过 **53/53**；readiness/router 集合通过 **12/12**，其中 Agent Run schema 的 4 个测试与核心集合重复，两个数字不得相加解释为 65 个独立测试。`yarn lint` 与 `git diff --check` 通过。

## 9. 风险、边界与明确延期

- 当前只有单个 Model Step，不代表已经实现任意 DAG、工具执行、审批或补偿编排。
- `queued` 任务可在重启时被如实停放为 known-no-effect waiting，但尚无跨进程持久队列消费或显式恢复动作；后续调度器阶段仍需定义租约与恢复策略。
- `cancelled` 是契约预留状态，本阶段没有取消 API 与竞争条件实现。
- 输入与最终输出会持久化，部署前仍需结合真实数据分类制定保留期、清理与访问审计策略。
- SQLite 外键并非全局强制开启，当前一致性主要由事务、所有权查询和唯一约束保证。
- 当前未进行性能、并发压力、真实 Provider 费用或故障注入的量化测量，相关结论均为待测。
- 按阶段策略，本阶段**未运行仓库全量测试、未执行完整构建、未进行 Toonflow-Web 端到端验收**。全量测试、构建产物核验与 App/Web 联合验收明确延期到所有路线阶段完成后的最终验收。

## 10. 源码证据索引

| 主题 | 真实路径与符号 |
| --- | --- |
| 深模块接口与契约 | `src/agentRuntime/index.ts`：`AgentRuntime`、`StartAgentRunInput`、`AgentRunSnapshot` |
| 幂等启动与事务主链 | `src/agentRuntime/index.ts`：`createAgentRuntime`、`start`、`execute`、`markFailed` |
| 状态转换规则 | `src/agentRuntime/lifecycle.ts`：Run/Step transition maps 与 assertions |
| 持久化内容门禁 | `src/diagnostics/traceSafeDiagnostics.ts`：`inspectPersistableText` |
| 持久化诊断重验证 | `src/diagnostics/traceSafeDiagnostics.ts`：`validateTraceSafeDiagnostic`；`src/agentRuntime/index.ts`：`parseTraceDiagnostic` |
| 失败边界分类 | `src/agentRuntime/index.ts`：`ClassifiedAgentRunError`、`projectFailure` |
| HTTP 纯读/启动入口 | `src/routes/agentRuns/start.ts`、`src/routes/agentRuns/inspect.ts` |
| UI 投影 | `src/agentRuntime/index.ts`：`projectAgentRunToChatMessage` |
| 四类持久化记录 | `src/lib/initDB.ts`：`o_agentRun`、`o_agentRunStep`、`o_agentRunOutput`、`o_agentTrace` |
| 重启停放 | `src/database/agentRunRecovery.ts`：`recoverInterruptedAgentRuns` |
| readiness 接线 | `src/database/readiness.ts`：`recoverInterruptedWork`、`READINESS_PHASES` |
| 模型目标证据 | `src/vendor/contract.ts`：`ConfiguredTextCall.target`；`src/vendor/index.ts`：`openTextCallImpl` |
| 领域定义与决策 | `CONTEXT.md`；`docs/adr/0011-persist-read-only-agent-runs-with-orthogonal-attention.md` |
