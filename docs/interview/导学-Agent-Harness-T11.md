# Agent Harness T11 导学：评测记录与生产执行的边界

> 阶段学习材料。当前只有持久证据账本，没有评测结果；按用户要求不生成简历文案，全量验收留到 T21。

先读 `CONTEXT.md` 的 Evaluation Run 与 Agent Run 定义，再读 `docs/adr/0027-evaluate-through-production-agent-runs.md`。核心区别是：Evaluation Run 固定比较问题与样本，Agent Run 才执行一次实际 Agent 请求。若评测另写一套 Agent 流程，它通过也无法证明生产流程可用。

阅读顺序：`src/eval/evaluationRun.ts` 的 `validateEvaluationRunManifest` → `createEvaluationRunRuntime().create` → `record` → `inspect`；随后对照 `src/lib/initDB.ts` 的两张表和更新触发器，最后跑 `tests/evaluationRun.test.ts`。注意 `record` 只取 terminal Run、Output 哈希和 Trace 锚点，不读取原始 Prompt；`inspect` 用 expected/recorded/missing 揭示尚未覆盖的矩阵，并复核来源证据有无变化。

自测：为什么每个 case/seed/variant 要绑定不同 Agent Run？为何 queued Run 不能计入结果？如果一条来源 Run 的版本在记录之后变化，报告是否仍可采用？为什么 4 个定向测试不代表 18 个 Golden case 已执行？本阶段没有质量分、成本、延迟或安全硬门，因此不能得出策略收益结论。
