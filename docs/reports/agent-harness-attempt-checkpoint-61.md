# Agent Harness T05：Attempt、Checkpoint 与重启恢复证据报告

## 1. 范围与结论

Issue #61 在 T04 的持久化只读 Agent Run 上补齐“执行尝试”与“已提交事实”两层恢复语义。一个逻辑 `Agent Step` 可以留下多个有因果顺序的 `Agent Attempt`；一个 `Agent Checkpoint` 只证明某个显式数据库提交边界已经完成。两者不能互换：Attempt 回答“这一步实际试过几次”，Checkpoint 回答“重启后哪些本地事实可以信任”。

本阶段的关键安全分界是 `model-call-intent`。该 Checkpoint 在 Provider 调用之前提交：若进程在它之前中断，系统能证明 Provider 未被调用，可以按恢复策略创建后继 Attempt；若进程在它之后、终态提交之前中断，则 Provider 效果未知，Run 必须等待人工关注，不能自动重放。成功终态 Checkpoint 只引用已经同事务提交的 Output 身份与内容哈希，重启时复用 Output，不再次调用 Provider。

Checkpoint 是版本化、不可更新、按前驱链接并校验哈希的恢复证据。流式 token、Provider 部分响应、内存中的模型结果和原始 Provider 负载都不是 Checkpoint。损坏、断链或不支持版本的 Checkpoint 会 fail closed：阻止继续调度，追加安全诊断并投影 attention；已经终态的 Run 不会为显示 attention 而被篡改回非终态。

本阶段仍是固定范围、单 Model Step、只读项目指导；不开放生产工具，不实现未知效果的自动 reconcile，也不声称支持多 Step 并行、分布式租约或跨进程抢占。

## 2. 领域模型与持久化结构

| 记录 | 负责回答的问题 | 关键字段/约束 | 恢复用途 |
| --- | --- | --- | --- |
| `o_agentRun` | 这次请求整体停在哪里 | `status`、`version`、`lastCommittedStepId`、attention | 提供聚合快照与最后提交 Step 游标 |
| `o_agentRunStep` | 逻辑步骤是什么、是否完成 | Run 内 ordinal 唯一、逻辑/物理模型目标、状态 | 多次 Attempt 共享同一个逻辑步骤 |
| `o_agentRunAttempt` | 这一步实际执行了哪一次尝试 | `(runId, stepId, ordinal)` 唯一，`predecessorAttemptId` 唯一，reason/status | 保留初始执行和恢复执行的因果链，禁止分叉 |
| `o_agentRunCheckpoint` | 哪个提交边界已被数据库确认 | Run 内 sequence 唯一，schemaVersion、runVersion、前驱、payloadHash | 重启验证边界、效果确定性与 Output 复用资格 |
| `o_agentRunOutput` | 哪个最终结果可展示 | `(runId, stepId)` 唯一，contentHash、schemaVersion | 成功 Checkpoint 通过 ID 和哈希引用，而不是复制正文 |
| `o_agentTrace` | 为什么进入当前状态 | 安全、单调序号、结构化诊断 | 解释恢复决策，不承担恢复事实源职责 |

Attempt 的前驱唯一约束把每个 Step 的尝试组织成单链；Checkpoint 的前驱唯一约束把一个 Run 的提交证据组织成不可分叉链。Checkpoint 表设置数据库级 `BEFORE UPDATE` 触发器，应用代码也只追加不更新。不可变并不意味着“数据库永远不会损坏”，所以读取时仍需重新计算规范化 payload 哈希并校验版本、序号、前驱、Run revision、Step/Attempt 引用和 Output 引用。

现有 T04 数据库升级时只为 Run 增加可空的 `lastCommittedStepId`，并创建新的 Attempt/Checkpoint 表；历史 Run 不会被伪造回填为“已有可信 Checkpoint”。旧记录的恢复资格必须由兼容策略显式判断，而不能因为迁移成功就自动获得 T05 语义。

## 3. Checkpoint 契约

Checkpoint payload 使用递归键排序的确定性序列化后计算 SHA-256，schemaVersion 决定解析器。本阶段固定以下四种边界：

| Checkpoint kind | 在同一事务内提交的事实 | Provider 效果确定性 | 重启动作 |
| --- | --- | --- | --- |
| `run-created` | Run、Step、初始 Attempt 与创建证据 | known-no-effect | 正常进程可领取初始 Attempt；重启恢复会隔离它并创建因果后继 |
| `attempt-created` | pre-intent 中断后的后继 Attempt 与因果前驱 | known-no-effect | 保留可检查的恢复历史，但 T05 不自动调用 Provider |
| `model-call-intent` | Attempt 已 running、resolved target 与调用指纹、意图 Checkpoint | 边界提交时仍 known-no-effect；其后崩溃时整体按 unknown-effect 处理 | 不自动重放；进入 waiting/attention，等待 reconcile 或人工处置 |
| `step-committed` | Output、Step/Attempt/Run 成功状态、Run committed-step 游标与终态 Checkpoint | committed-effect | 校验 Output ID、schema 与实际内容哈希后直接复用，不再次调用 Provider |

`model-call-intent` 不是“Provider 已收到请求”的证明。它只证明本地即将调用 Provider 的意图已经提交。恢复时只要最新可信证据已经越过这条边界、但没有可信终态，就必须按 unknown-effect 处理；这是为了覆盖“请求已经发出，但响应或本地终态尚未提交”的窗口。

成功 Checkpoint 不保存输出正文，只保存 Output ID 与 content hash。恢复再验证所引用 Output 存在、归属当前 Run/Step、其独立 schemaVersion 受支持，且持久化正文重算哈希匹配；任何缺失或不一致都归为损坏证据，而不是重新生成一份可能不同的答案。

## 4. 事务与短事务边界

| 阶段 | 事务内写入 | 事务外工作 | 中断含义 |
| --- | --- | --- | --- |
| 创建 | Run、Step、初始 Attempt、`run-created` Trace/Checkpoint | 无 | 提交前没有 Run；提交后存在可检查意图 |
| 领取与意图 | 条件更新 Run/Step/Attempt，保存安全 resolved target 和调用指纹，追加 `model-call-intent` | 无 | 提交失败则不调用模型；提交成功后中断按 unknown-effect |
| Provider 调用 | 无长期事务 | 模型网络调用 | 不持有 SQLite 写锁；远端效果无法与本地原子提交 |
| 成功终态 | Output、Attempt/Step/Run 终态、committed-step 游标、成功 Checkpoint 与 Trace | UI 投影 | 同事务全成或全退；提交后重启只复用 Output |
| 失败收敛 | intent 前写 failed；intent 后写 waiting/attention；两者追加安全 Trace，不伪造成功 Checkpoint | UI 投影 | 最新 Checkpoint 保留最后可信边界，诊断不含原始 Provider 负载 |
| 重启恢复 | 校验链后按条件更新 waiting/attention，必要时追加后继 Attempt/恢复证据 | 不调用 Provider | 同一恢复可重复执行，不制造分叉或重复调用 |

模型网络调用绝不放进 SQLite 事务。这样避免在不可控网络延迟期间占用写锁，但也承认本地数据库与远端 Provider 无法形成分布式原子事务。T05 的解决方式不是假装消灭该窗口，而是用意图 Checkpoint 将窗口显式分类，并让 unknown-effect 停下来。

所有推进仍需同时依赖领域转换、SQL 前态、Run version 与受影响行数。Checkpoint 的 `runVersion` 记录它证明的聚合 revision；读取时版本倒退、越界或与相邻证据不一致都应拒绝。短事务、唯一约束和一次权威重读适合当前 SQLite 单机形态；它们不等于分布式共识。

## 5. Restart matrix

| 中断位置 | 可观测持久事实 | 效果判断 | 重启后的预期处置 | 是否新建 Attempt | 是否调用 Provider |
| --- | --- | --- | --- | --- | --- |
| 创建事务提交前 | 无完整 Run/Attempt/Checkpoint | known-no-effect | 原请求以同一幂等键重新开始 | 否；原事务不存在 | 否，直到新创建成功 |
| 创建事务提交后、领取前 | Run/Step/初始 Attempt 与创建边界可信 | known-no-effect | 恢复或调度可继续；若把进程中断记为新尝试，则创建因果后继 | 仅在已接受恢复策略下 | 最多一次 |
| `model-call-intent` 提交前 | 没有调用意图边界 | known-no-effect | 原 Attempt 收敛为 interrupted，创建唯一后继 Attempt | 是，前驱指向原 Attempt | 后继最多一次 |
| `model-call-intent` 提交后、实际请求发出前 | 意图已提交，但重启无法证明请求未发出 | unknown-effect | waiting + attention，禁止自动重放 | 否 | 否 |
| 请求发出后、响应前 | 意图可信，无终态 Checkpoint | unknown-effect | waiting + attention，等待未来 reconcile/人工处理 | 否 | 否 |
| 收到模型结果后、成功事务提交前 | 结果只在内存中，不是 Checkpoint | unknown-effect | waiting + attention，禁止把内存结果当已提交 | 否 | 否 |
| 成功事务提交过程中失败 | 事务整体回滚，没有可信成功链 | unknown-effect | waiting/失败收敛，以最终实现和注入点为准；不得重放 | 否 | 否 |
| 成功事务提交后、响应客户端前 | Output 与成功 Checkpoint 均可信 | committed-effect | inspect/恢复直接复用 Output，保持 succeeded | 否 | 否 |
| Checkpoint hash、前驱或引用损坏 | 链不可验证 | indeterminate/corrupt | fail closed，停止调度，添加安全 attention | 否 | 否 |
| schemaVersion 不受支持 | 证据可能来自更高版本 | incompatible | fail closed，不擅自降级解释，提示升级/处置 | 否 | 否 |
| 终态 Run 上发现损坏证据 | 终态与证据冲突 | corrupt | 保持终态生命周期，不回写 waiting；正交投影 attention | 否 | 否 |

“立即在边界前/后中断”的测试必须使用可控故障点，断言重启后 Provider 调用次数、Attempt 链、Checkpoint 链、Run version、Output 数量与 attention。表中的“最多一次”仅针对本阶段单 Step 的受控测试，不代表跨机器 exactly-once 保证。

## 6. 损坏与不兼容的 fail-closed 规则

恢复器不只检查“有一行 Checkpoint”，而要验证整条可达证据链：schema 版本可识别；sequence 单调且无分叉；前驱属于同一 Run；Attempt/Step 引用一致；payload 能按版本严格解析；规范化 payload 重算哈希相同；runVersion 与提交顺序相容；成功引用的 Output 存在且 contentHash 一致。

校验失败时不把原始 payload、异常堆栈、Provider 响应或用户输入写进 Trace。诊断只保留允许枚举、损坏类别、受控标识符和可安全展示的处置提示。非终态 Run 可以进入 waiting 并设置 attention；终态 Run 保持原状态，只增加正交 attention 信号，避免为了告警而篡改已经提交的业务事实。

不支持版本与数据损坏要区分：前者通常意味着当前程序无法解释更新版本的证据，建议升级兼容；后者表示本版本契约被破坏，需要人工检查或恢复备份。两者都不能自动重放 Provider。

## 7. 测试与验证范围

本阶段遵循“每阶段只做聚焦单元/契约测试，完整测试留到所有阶段最终验收”的约定。

计划并在实现收口后登记的聚焦证据：

- Schema：新库结构、T04 升级、唯一约束、Checkpoint update 触发器、删除生命周期与兼容边界。
- Checkpoint validator：确定性哈希、篡改、断链、分叉、错 Run/Step/Attempt 引用、不支持版本、Output hash 不匹配。
- Runtime：Attempt 初始链、`model-call-intent` 前后故障注入、终态原子提交、成功 Output 复用、未知效果不重放。
- Recovery：restart matrix 各边界、重复 readiness 幂等、终态 attention 正交、损坏/不兼容 fail closed。
- 静态验证：TypeScript 检查与 `git diff --check`。

阶段命令 `node --import tsx --test tests/agentRunRuntime.test.ts tests/agentRunSchema.test.ts tests/agentRunRoutes.test.ts` 通过 **32/32**；`yarn lint` 与 `git diff --check` 通过。补充的隔离测试证明：终态 Checkpoint 损坏或整条链丢失后仍能 inspect 其安全状态和 attention，但不再投影不可信的 Output 或 Checkpoint 摘要。

明确未执行：仓库全量测试、完整 App build、Toonflow-Web 测试与 build、浏览器 E2E、Electron 打包、多进程压力、真实 Provider smoke test。它们统一留到所有阶段完成后的最终验收。因此本报告只能证明 T05 聚焦契约，不能表述为整个项目已经验收。

## 8. 已知限制与后续工作

- 当前只覆盖一个逻辑 Model Step；多 Step DAG、并行聚合和补偿顺序尚未设计。
- unknown-effect 只会停止并请求关注，尚无 Provider 查询式 reconcile 或人工裁决命令。
- Attempt 的恢复创建受固定策略约束，不是面向用户开放的任意 retry API。
- 没有租约、fencing token 与多 worker ownership；这些属于后续 Harness 阶段。
- Checkpoint 证明本地提交，不证明 Provider 已执行或未执行；远端效果仍需专门协议。
- SQLite 触发器阻止普通 UPDATE，但不能防御脱离应用的恶意数据库管理员或文件级篡改；哈希用于检测，不提供密钥签名。
- T04 历史 Run 不被伪造回填为 T05 Checkpoint；兼容读取与恢复资格必须显式区分。
- Web 尚未消费 Attempt/Checkpoint 详情，也未完成刷新与 attention 的浏览器验收。

后续 T06 可在这套证据上增加租约、fencing、取消与重连；更晚阶段再加入 reconcile、人工审批、动作账本和多步骤编排。所有后续能力都必须保持同一原则：没有可信提交证据时不猜测，没有 accepted policy 时不重放。

## 9. 源码与证据索引

| 主题 | 路径/符号 | 状态 |
| --- | --- | --- |
| 领域定义 | `CONTEXT.md`：Agent Attempt、Agent Checkpoint | 已落盘 |
| 架构决策 | `docs/adr/0012-separate-agent-attempts-from-commit-checkpoints.md` | 已落盘 |
| Schema | `src/lib/initDB.ts`：`o_agentRunAttempt`、`o_agentRunCheckpoint`、immutability trigger | 已落盘，最终审查待完成 |
| 升级 | `src/lib/fixDB.ts`：Run committed-step cursor 与新表兼容 | 已落盘，最终审查待完成 |
| Checkpoint 编码/校验 | `src/agentRuntime/checkpoints.ts`：`canonicalCheckpointPayload`、`hashCheckpointPayload`、`parseCheckpointPayload`；`src/agentRuntime/index.ts`：`validateCheckpointRows`、`validateCheckpointEvidence` | 已落盘 |
| Runtime Attempt/commit | `src/agentRuntime/index.ts`：`createAgentRuntime`、`execute`、`settleFailure`、`readSnapshot` | 已落盘 |
| Restart recovery | `src/database/agentRunRecovery.ts`：`validateCheckpointChain`、`recoverCheckpointedRun`、`parkInvalidCheckpointRun` | 已落盘 |
| 聚焦测试 | `tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts`、`tests/agentRunRoutes.test.ts`；32/32 | 已通过 |
