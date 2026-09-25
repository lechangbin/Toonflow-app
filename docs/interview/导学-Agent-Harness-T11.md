# Agent Harness T11 导学：评测记录与生产执行的边界

> 阶段学习材料。当前只有持久证据账本，没有评测结果；按用户要求不生成简历文案，全量验收留到 T21。

先读 `CONTEXT.md` 的 Evaluation Run 与 Agent Run 定义，再读 `docs/adr/0027-evaluate-through-production-agent-runs.md`。核心区别是：Evaluation Run 固定比较问题与样本，Agent Run 才执行一次实际 Agent 请求。若评测另写一套 Agent 流程，它通过也无法证明生产流程可用。

阅读顺序：`src/eval/evaluationRun.ts` 的 `validateEvaluationRunManifest` → `createEvaluationRunRuntime().create` → `src/eval/evaluationAgentCase.ts` 的预检、AgentRuntime `start`/`inspect` → `record` → Evaluation Run `inspect`；随后对照 `src/lib/initDB.ts` 的两张表和更新触发器，最后跑两个 `tests/evaluation*.test.ts` 定向文件。注意 `record` 只取 terminal Run、Output 哈希和 Trace 锚点，不读取原始 Prompt；`inspect` 用 expected/recorded/missing 揭示尚未覆盖的矩阵，并复核来源证据有无变化。

Golden 冻结补充阅读：`src/eval/goldenEvaluationFreeze.ts` → `src/eval/goldenEval.ts` 的 18 例清单校验与规范化哈希 → `tests/goldenEvaluationFreeze.test.ts`。刚冻结时 72 个样本全部 missing；不要把 manifest 冻结解释成场景执行。

覆盖报告再读 `src/eval/evaluationCoverageReport.ts`：固定 18-case、2-seed、2-variant 的分母；观察一条真实只读 Run 后，仅相应 cell 从 missing 转 observed。解释为何 observed 不是 hard-gate pass，来源 Run 版本被改写时为什么必须整份拒绝，而不能继续显示漂亮的覆盖率。

沿 `src/agentRuntime/causalTrace.ts` 的 `auditCausalTraceTimeline` 检查来源 Trace：最后一个 ID 正确但中间前驱断开，为什么不能算有效评测证据？

再看 Run 的 `createdAt`/`completedAt`：缺少完成时间时能否报告延迟？为什么未知 Provider 收费必须是 `null`，不能填 0？

自测：为什么每个 case/seed/variant 要绑定不同 Agent Run？为何 queued Run 不能计入结果？如果一条来源 Run 的版本在记录之后变化，报告是否仍可采用？为什么一个真实 Runtime/Fake Model 的只读样例不代表 18 个 Golden case 已迁移？本阶段没有质量分、成本、延迟或安全硬门，因此不能得出策略收益结论。

新自测：若 baseline 与 candidate 使用同一 case ID 但不同输入正文，哪一层拒绝？若有人直接调用账本把一个无关终态 Run 填入样本，哪个请求身份检查拒绝？注意 seed 当前仅参与样本请求 ID，还不是 Model 随机性控制。

再追问：为什么冻结输入哈希要与 Runtime 的修剪规则一致？若有人绕过适配器直接调用 `record`，它怎样复核 Run 保存的正文、role 和 scope？Project 快照没有冻结时还能不能宣称“完全同条件”？

交叉核对旧 Draft PR #90：它的独立表与覆盖报告为何不能和当前账本并列上线？怎样迁移其 18-case 分母和“覆盖非质量”语义，同时只保留一个 Evaluation Run 身份？

对照清单的 baseline/candidate：schema、Model、Vendor 被要求相同，否则改变的不只是候选策略；App、Runtime、Tool、Context、Memory、Skill 可因实验而不同。解释为什么“版本相同”仍不能代替同预算、同数据和真实逐例测量。
