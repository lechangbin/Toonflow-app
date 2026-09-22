# Agent Harness T06：租约、fencing、取消与重连契约

## 范围与结论

T06 在 T05 的单 Step、只读 Agent Run 上增加执行所有权和客户端命令契约。Run 的持久状态由数据库决定，Socket 连接不是所有权或生命周期依据。本阶段没有改变 Provider 的非原子性：模型调用仍在数据库事务外；`model-call-intent` 之后失联仍按 unknown-effect 等待核对，不自动重放。

实现范围是本地 SQLite 上的单进程/可并发连接的 Run 控制面，不声称分布式共识、跨机器 exactly-once、真实 Provider 取消或前端 UI 已完成重连接线。

## 已实现机制

| 机制 | 持久事实与条件 | 失败时的行为 |
| --- | --- | --- |
| 租约领取 | 仅 queued、无 attention/取消意图；记录 owner、进程 epoch、过期时间；每次到期后领取递增 fence 与 Run version | 未满足前态则不领取 |
| 续租 | 相同 owner/epoch/fence、未过期、仍为 queued/running；仅延长过期时间，不增加生命周期 version | 报告所有权丢失，worker 不得继续提交 |
| 写入 fencing | intent、失败收敛、成功终态在同一短事务内核对 owner/epoch/fence/expiry 和状态版本 | 旧 worker 的迟到结果不写 Output 或终态 |
| 启动恢复 | 活跃 Run 仍有有效租约时保持原状；无租约或租约到期时按 T05 Checkpoint 边界收敛，并清除旧租约字段 | intent 后进入 waiting/attention，不自动再次调用 Provider |
| 取消命令 | Project 范围内的 command ID、输入指纹和 expectedVersion；同 ID 同输入只读回放 | 同 ID 异输入或过期版本返回冲突 |
| 取消安全边界 | queued 时同事务提交取消意图与 Run/Step/Attempt `cancelled`；running 时只持久化意图，等待在途调用自然收敛；首个意图固定 | 不把“请求取消”误报为“Provider 已取消” |
| 刷新/重连 | 按 Project/role/scope 返回一个 current 和最近 20 个 Run 的权威快照；inspect 始终按 Project 隔离 | Socket 断连不写 Run；客户端需主动调用列表/inspect 重新投影 |

## 关键竞态

1. 两个 worker 争取同一 queued Run：SQLite 短事务和版本/前态只允许一个成功领取；同一 owner/epoch 重复领取返回原 fence。
2. 租约过期后新 worker 接管：fence 单调增加；旧 worker 即使持有 Provider 返回，也在终态事务前被拒绝。
3. 维护就绪扫描与活跃 worker 同时发生：恢复器不处理有效租约，避免把活跃 Run 错判为中断。
4. 取消与启动交错：queued 取消提交后，计划中的执行无法领取或提交 intent；running 取消只写持久意图，终态仍由真实模型结果决定。
5. 重连与重试交错：`clientCommandId` 使同一取消命令幂等，`expectedVersion` 防止旧页面覆盖新状态；列表和 inspect 从数据库重读，不依赖 Socket 内存。

租约不证明 Provider 请求没有发出。过期后的恢复仍必须验证 Checkpoint；pre-intent 会记录因果后继 Attempt 并等待后续显式策略，post-intent 只进入待核对状态。T06 不自动调度已恢复的 Attempt，也不执行任何远端 Provider reconcile。

## 数据库与 API

- `o_agentRun` 新增 `leaseOwnerId`、`leaseEpoch`、`leaseExpiresAt`、单调 `fence`、`cancellationRequestedAt`、`cancellationCommandId`。旧库升级后 fence 默认为 0，原有 Run 状态和 version 保持不变。
- `o_agentRunCommand` 记录 `clientCommandId`、输入指纹、预期/结果版本；`(runId, clientCommandId)` 唯一。
- `POST /agentRuns/cancel` 使用 `runId`、`projectId`、`clientCommandId`、`expectedVersion`；409 表示命令身份或版本/状态冲突。
- `POST /agentRuns/list` 使用固定 role/scope 和 Project ID；返回 current、recent 以及对应消息投影。recent 最多 20 个，按创建时间和 ID 确定性排序。

## 验证记录

聚焦命令：`node --import tsx --test tests/agentRunLease.test.ts tests/agentRunRuntime.test.ts tests/agentRunSchema.test.ts tests/agentRunRoutes.test.ts`，**45/45 通过**。该命令覆盖租约争抢、续租、过期接管、迟到结果拒绝、取消幂等、在途取消、数据库升级、恢复、列表路由，以及新 Runtime 对同一数据库的重连投影。本报告不把聚焦测试写成全项目验收。

`yarn lint` 与 `git diff --check` 已通过。按用户约定，仓库全量测试、完整 App/Web build、浏览器 E2E、真实 Provider、Electron 打包和多进程压力测试均留到所有阶段后的最终验收。

## 边界与后续

当前 Web 客户端尚未消费新列表/取消接口，也没有真实断网重连 E2E；后端只提供重连所需的权威快照契约。租约心跳是进程内定时续租，不保证操作系统冻结或网络停顿期间持续持有。T06 只提供“请求取消”与安全边界，不提供 Provider 传输级 abort，也不撤销已发生的远端副作用。后续阶段需要显式 reconcile/人工裁决、UI 接线、运维观测与最终全量验收；不能把这些能力写成已完成。

## 证据索引

| 主题 | 文件 |
| --- | --- |
| 领域与决策 | `CONTEXT.md`、`docs/adr/0013-fence-agent-run-writes-and-separate-cancellation-intent.md` |
| 租约与 Runtime | `src/agentRuntime/lease.ts`、`src/agentRuntime/index.ts` |
| 恢复 | `src/database/agentRunRecovery.ts`、`src/database/readiness.ts` |
| Schema 升级 | `src/lib/initDB.ts`、`src/lib/fixDB.ts`、`src/types/database.d.ts` |
| HTTP 契约 | `src/routes/agentRuns/cancel.ts`、`src/routes/agentRuns/list.ts` |
| 聚焦测试 | `tests/agentRunLease.test.ts`、`tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts`、`tests/agentRunRoutes.test.ts` |
