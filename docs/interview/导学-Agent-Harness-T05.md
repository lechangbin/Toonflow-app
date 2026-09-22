# Agent Harness T05 导学：Attempt、不可变 Checkpoint 与重启恢复

> 本文只用于理解实现、核验证据与准备技术面试，不生成简历 bullet 或 HR 文案。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| 至少一次执行与 exactly-once 幻觉 | 本地数据库和远端模型无法共享事务，崩溃后不能靠猜测重放 | `model-call-intent` 前后恢复分类 | 极高 |
| 逻辑 Step 与物理 Attempt | retry 不能覆盖历史，也不能把“同一步”误建模成多个 Step | Attempt 因果链与 Step 聚合 | 极高 |
| Write-ahead intent | 在外部副作用前提交意图，才能标出不确定窗口 | 调用 Provider 前的 intent Checkpoint | 极高 |
| 不可变事件与快照的差别 | Checkpoint 证明边界，不是任意进度快照 | Checkpoint 表、更新触发器、hash chain | 极高 |
| 乐观并发控制 | 领域转换检查不能替代数据库当前前态 | Run version、SQL 前态、affected rows | 高 |
| SQLite 短事务 | 网络调用若包在事务内会长期占写锁 | 创建、意图、终态分段提交 | 高 |
| 内容寻址与完整性校验 | Output 复用必须证明引用的内容没有变化 | contentHash、payloadHash、确定性序列化 | 高 |
| Fail closed | 损坏或不认识的数据不能被“尽量解释”后继续调度 | corruption/incompatible recovery | 高 |
| Schema 演进 | 老数据库没有 T05 证据，不能伪造回填 | `fixDB` 与 nullable committed-step cursor | 中高 |
| 正交 attention | 告警和生命周期不是同一个维度 | 终态 Run 保持终态，同时暴露 attention | 中高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 顺序 |
| --- | --- | --- | --- | --- |
| 外部副作用安全分界 | 回答“崩溃后能不能重试”最核心的问题 | write-ahead intent、effect certainty、at-least-once | `docs/adr/0012-separate-agent-attempts-from-commit-checkpoints.md`、`src/agentRuntime/index.ts` | 1 |
| 尝试因果链 | 把物理重试历史与逻辑业务步骤分离 | Attempt、causal predecessor、single chain | `CONTEXT.md`、`src/lib/initDB.ts` | 2 |
| 不可变哈希链 Checkpoint | 让恢复依据可验证，而不是只看最后状态字段 | append-only、hash chain、schema version | `src/lib/initDB.ts`、`src/agentRuntime/checkpoints.ts` | 3 |
| 成功输出复用 | 防止成功提交后因响应丢失而重复计费和答案漂移 | output identity、content hash、idempotent recovery | `src/agentRuntime/index.ts` 的成功事务与 evidence validator | 4 |
| 损坏与升级 fail closed | 证明系统面对坏证据时不会冒进 | strict parser、compatibility、attention | `src/database/agentRunRecovery.ts`、`tests/agentRunSchema.test.ts` | 5 |
| SQLite 短事务 | 展示工程取舍，不把网络不确定性藏在锁里 | transaction boundary、OCC、atomic commit | Runtime 与 `src/lib/initDB.ts` | 6 |

建议先画一条时间线：`创建 Run/Step/Attempt -> 提交调用意图 -> 发出 Provider 请求 -> 提交 Output/终态`。然后在每条箭头前后放一个“进程立即退出”的故障点，逐个回答：数据库里有什么、远端可能发生什么、能否新建 Attempt、能否再次调用 Provider。能完整回答这四项，就掌握了 T05 的主线。

## 3. 必备知识点 checklist

- [ ] 能解释 Step 是逻辑工作，Attempt 是一次物理执行，为什么不能只在 Step 上加 retryCount。
- [ ] 能解释 Checkpoint 只证明已提交边界，为什么流式 token 和内存结果不算 Checkpoint。
- [ ] 能说清 `model-call-intent` 之前是 known-no-effect，之后为什么按 unknown-effect 处理。
- [ ] 能画出 Attempt predecessor 与 Checkpoint predecessor 两条单链，并说明唯一约束如何防分叉。
- [ ] 能解释 payloadHash 和 Output contentHash 分别保护什么，又为什么哈希不等于签名。
- [ ] 能说明 Provider 调用为什么在事务外，以及这一选择保留了什么风险。
- [ ] 能解释成功终态如何在一个事务中提交 Output、状态、游标和 Checkpoint。
- [ ] 能解释成功后客户端没收到响应时，重启为什么复用 Output 而不是重跑模型。
- [ ] 能区分 corrupted 与 incompatible，并给出不同运维含义。
- [ ] 能解释 attention 与 status 正交，终态 Run 为什么不能被改回 waiting。
- [ ] 能说明 T04 老记录为什么不能在迁移时批量伪造 Checkpoint。
- [ ] 能准确陈述测试范围：聚焦单元/契约测试，不包含全量、build 与 Web E2E。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域词汇 | 聚合、逻辑步骤、物理尝试、恢复证据 | `CONTEXT.md` | 10 分钟 | Attempt 与 Step、Checkpoint 与 Trace 有何不同 |
| 决策记录 | 外部副作用边界、不可变证据、正交 attention | `docs/adr/0012-separate-agent-attempts-from-commit-checkpoints.md` | 10 分钟 | 为什么 intent 后不自动 replay |
| 表结构 | 唯一约束、外键、追加模型、升级 | `src/lib/initDB.ts`、`src/lib/fixDB.ts` | 25 分钟 | 两条链如何防分叉，老库如何升级 |
| T04 基线 | Run/Step/Output/Trace 与恢复前态 | `docs/reports/agent-harness-run-60.md` | 20 分钟 | T05 解决了 T04 哪个缺口 |
| Runtime 主链 | 分段事务、模型调用、终态提交 | `src/agentRuntime/index.ts`、`src/agentRuntime/checkpoints.ts` | 40 分钟 | 每个 commit boundary 里写了什么 |
| 恢复器 | 链校验、效果确定性、新 Attempt 策略 | `src/database/agentRunRecovery.ts` | 35 分钟 | 重启如何决定 continue、wait 或 reuse |
| 生命周期 | 合法转换、前态校验、终态约束 | `src/agentRuntime/lifecycle.ts` | 15 分钟 | 为什么 map 和 SQL where 都需要 |
| Schema 测试 | 新库/升级/触发器/约束 | `tests/agentRunSchema.test.ts` | 30 分钟 | 不可变和不分叉如何被验证 |
| Runtime/Recovery 测试 | 边界故障注入与调用次数 | `tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts` | 45 分钟 | restart matrix 如何落实为断言 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。优先用“中断位置—持久事实—效果确定性—恢复动作”四列表复述代码，不要从私有函数名开始背诵。

## 6. 项目技术定位

这是一个以 Agent Harness 为第一方向、Agent 应用开发为第二方向、AI 应用后端为补充的交叉项目：重点不是训练或改进算法，而是让模型调用具备可持久化、可恢复、可审计且不会静默重放副作用的工程控制面。

T05 的定位尤其偏 Agent Runtime/AI backend reliability。它不讨论模型准确率，而讨论一次模型调用如何被标识、提交、恢复和证明；这正是生产 Agent 与一次性聊天脚本的关键区别。

## 7. 核心原理解析

### 7.1 Step 与 Attempt 分层

**问题：** 如果直接把 retryCount 加在 Step 上，每次重试会覆盖 startedAt、resolved target 和失败状态；面试时也无法回答某一次调用究竟用了哪个目标、为什么被重试。

**机制：** Step 表示逻辑工作，Attempt 表示该工作的一次物理执行。每个 Attempt 保存 ordinal、reason、状态、调用指纹和 predecessor。前驱唯一约束使历史形成单链，新尝试只能由明确策略产生。

**项目落点：** `o_agentRunAttempt` 关联 Run 与 Step，初始执行和重启恢复都留下独立记录。它不是 retry counter，也不自动授权重试。

### 7.2 `model-call-intent` 是安全分界，不是远端回执

**问题：** 本地 SQLite 与 Provider 不能共享事务。若调用前什么都不写，崩溃后无法判断请求是否发出；若调用后才写，也可能在远端成功、本地未写之间丢失事实。

**机制：** 在调用前以短事务提交调用意图、resolved target、invocation fingerprint 和 Attempt running 状态。意图提交失败则绝不调用；意图提交后发生中断，则保守视为远端效果未知。

**项目落点：** Runtime 只在意图 Checkpoint 成功后执行网络调用。恢复器看到可信 intent、看不到终态，就转为 attention 并禁止自动重放。

### 7.3 Checkpoint 是不可变且可校验的提交证据

**问题：** 只相信 Run 的最后 status 容易被部分升级、手工修改或程序缺陷欺骗；可更新的“checkpoint row”也会抹去历史。

**机制：** 每个 Checkpoint 有 schemaVersion、Run revision、sequence、前驱、规范化 payload 和 payloadHash。写入只追加，数据库触发器拒绝 UPDATE；恢复时重新验证链和引用。

**项目落点：** `o_agentRunCheckpoint` 用 Run 内序号与 predecessor 双重组织顺序，`validateCheckpointChain` 对损坏和未知版本 fail closed。

### 7.4 成功 Output 复用而非模型重放

**问题：** 模型已经成功、终态也提交，但进程在给客户端响应前退出，是最容易被误判为“没完成”并重复计费的场景。

**机制：** 成功事务同时提交 Output、Attempt/Step/Run 终态、committed-step cursor 和成功 Checkpoint。Checkpoint 只引用 Output ID 与 contentHash。重启校验引用后直接读取 Output。

**项目落点：** inspect 和恢复都以数据库为事实源，聊天消息仍是投影。Provider 调用次数测试必须证明成功提交后为零次重放。

### 7.5 Corruption/incompatible fail closed

**问题：** 如果 Checkpoint payload 被修改、前驱断裂或来自更高版本，继续执行可能重复远端副作用；但直接把终态 Run 改为 waiting 又会破坏已提交事实。

**机制：** 严格区分数据损坏与版本不兼容，两者都禁止调度并产生安全 attention。非终态可以进入 waiting；终态保持原生命周期，通过正交 attention 报警。

**项目落点：** 诊断不包含 payload 正文、用户输入或 Provider 原始响应，只暴露可枚举的错误种类和处置方向。

### 7.6 SQLite 短事务与显式不确定窗口

**问题：** 把网络调用包进事务看似“原子”，实际会长期占写锁，仍无法回滚 Provider；反而扩大本地阻塞。

**机制：** 创建、调用意图、成功/失败终态分别使用短事务。SQL 条件带前态和 Run version，受影响行数必须符合预期。网络请求在事务外，风险通过 checkpoint/recovery 语义管理。

**项目落点：** 这不是 exactly-once，而是“本地提交可证明、未知远端效果不自动重放”。面试时要主动说出限制。

## 8. 关键设计决策

| 决策 | 备选 | 取舍 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| Step/Attempt 分表 | Step 上加 retryCount | 多一张表与 join，换取完整因果历史和每次尝试证据 | 链维护复杂、孤儿记录 | 唯一约束、链校验、恢复竞态测试 |
| 调用前 intent Checkpoint | 调用后才记录；长事务包网络 | 显式暴露 unknown-effect，不声称远端原子性 | intent 后、请求前也会保守暂停 | 边界前后立即中断测试 |
| Append-only hash chain | 可更新单行快照；完整 event sourcing | 比快照可靠、比全量事件溯源小 | 哈希无密钥，管理员仍可重写 | update trigger、篡改/断链测试 |
| 成功引用 Output | 把正文复制到 Checkpoint | 避免重复敏感正文，复用已有 contentHash | 引用缺失导致恢复失败 | 缺行、错 hash、错归属测试 |
| 未知效果不自动 retry | 统一自动重试 | 牺牲自动恢复率，避免重复计费/副作用 | 需要人工或后续 reconcile | 断言 intent 后 Provider 调用次数不增加 |
| 终态 attention 正交 | 把 succeeded 改回 waiting | 保留终态事实，仍能暴露证据异常 | UI 需理解双维度 | 终态损坏投影测试 |
| 老记录不伪造回填 | 为历史 Run 生成假 Checkpoint | 兼容更诚实，但老 Run 不具 T05 恢复能力 | 使用者需理解能力差异 | T04 数据库升级测试 |
| 阶段只跑聚焦测试 | 每阶段全量 build/test | 反馈快且符合路线约定 | 跨模块回归延后暴露 | 最终统一验收清单 |

## 9. 量化与验证（含待测）

| 指标/证据 | 当前状态 | 建议测量方式 | 合格含义 |
| --- | --- | --- | --- |
| Restart matrix 覆盖 | Runtime/Schema 聚焦测试 | 对创建、intent、terminal 与 readiness 分界做事务注入和持久状态断言 | 每个已实现边界都有状态、链或 Output 断言 |
| Provider 重放次数 | Fake Provider 调用计数 | intent 被拒、intent 后失败、成功幂等重读 | 不安全恢复路径为 0 次自动重放 |
| Attempt 链分叉 | 结构约束已设计 | 并发创建两个相同 predecessor 的后继 | 至多一个成功，权威重读收敛 |
| Checkpoint 篡改检测 | `tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts` | 修改 envelope/hash/schema 与旧 Output 内容 | corrupt/incompatible 分流并 fail closed |
| T04 升级兼容 | legacy succeeded 与缺列 fixture | 运行 schema upgrade 后 inspect/校验 | 历史记录保留，不伪造 Checkpoint，新 Run 使用 T05 |
| SQLite 锁占用 | 待测 | 记录事务时长与 busy 次数，确认网络阶段无事务 | 网络延迟不等于写锁持有时长 |
| Checkpoint 存储增长 | 待测 | 按 Run/Attempt 数采样数据库增量 | 形成后续保留/归档策略基线 |
| 全量回归与构建 | 未执行 | 所有阶段完成后统一执行 App/Web 全量、build、E2E | 只在最终验收后给系统级结论 |

本阶段完成时只登记实际运行过的聚焦测试命令和数字，不把重复测试相加，也不把 TypeScript 检查称为运行时测试。真实 Provider、多进程压力、Electron 打包和 Web 刷新体验都属于最终验收或后续专项验证。
