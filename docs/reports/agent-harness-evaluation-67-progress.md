# Agent Harness T11 · Evaluation Run 持久证据（阶段进度）

Issue：`lechangbin/Toonflow-app#67`。本分支叠在 T17 App Draft PR #96 上，仅实现 Evaluation Run 的冻结清单与关联生产 Agent Run 的逐例证据账本；没有接入 Golden Eval Runner、没有执行成对 baseline/candidate 用例，也没有发布质量、延迟或成本结论。T11 仍开放。

`Evaluation Run` 在 `CONTEXT.md` 中被定义为一组冻结比较及其 Agent Run 证据，不是另一种 Agent 执行。ADR-0027 选择从生产 Runtime 的真实 Run 取证，拒绝另造只为评测服务的 Agent 路径。清单固定 case manifest 哈希、case/至少两个 seed、baseline/candidate 两侧 App/schema/Runtime/Tool/Context/Memory/Skill/Model/Vendor 修订和冻结时间。重复 case/seed 或空修订拒绝。

新增逐例输入正文哈希并要求它与冻结 case 顺序一致：baseline/candidate 对同一个 case 传入不同文本会在启动前拒绝。证据写入和读取都校验来源 Run 的确定性请求 ID 是否对应 variant/case/seed，避免借用不相关的生产 Run。输入哈希仍不能证明外部 Golden fixture 与正文一致；seed 当前只进入幂等请求 ID，并未控制 Model 随机性。

成对可比性门槛：同一 Evaluation Run 的 baseline/candidate 必须共享 schema、Model、Vendor 修订；这些基础环境不同会在创建前拒绝。允许 App/Runtime/Tool/Context/Memory/Skill 在两侧不同，以保留候选改动空间。这只是版本兼容的必要条件，尚未冻结或核对相同 token/Tool/时间预算，也没有根据真实 case 结果判断策略效果。

SQLite 新表 `o_agentEvaluationRun` 保存清单及哈希，`o_agentEvaluationCase` 每 variant/case/seed 至多绑定一个实际 Agent Run，并阻止在同一 Evaluation Run 重用该 Agent Run。写入只接收已终结、版本有效且有 Trace 的 Run，记录来源 Project、Run 版本/状态、Output 哈希和最后 Trace 身份；相同记录幂等，重绑定或清单外组合拒绝。读取重新校验清单/证据哈希、矩阵归属与来源 Run 当前证据，明确返回 expected/recorded/missing。新表的更新触发器阻止篡改已写记录；删除和长期保留政策尚未完备，不能把这一切片称为不可删除的最终审计档案。

执行接线补充：`src/eval/evaluationAgentCase.ts` 先检查冻结矩阵与当前修订，再用确定性请求 ID 调用现有 AgentRuntime，等待注入调度器处理后重新 `inspect`，只把真正终结的 Run 交给上述账本。1 个真实 AgentRuntime + SQLite + Fake Text Model 定向用例证明这条最小只读 case 链、重复执行不多调 Model，以及错修订/错 case 在启动前拒绝。当前修订探针由调用方注入，尚未从构建产物或已配置 Vendor 独立提取；不能因此声称版本真实性已经被最终验收。

阶段验证：`tests/evaluationRun.test.ts` 5 例加 `tests/evaluationAgentCase.test.ts` 1 例，覆盖清单拒绝、终态 Run 关联、幂等、重复 Run 拒绝、矩阵缺口、来源证据变化、queued/无 Trace 拒绝、真实 `initDB` 建表与更新触发器、旧库补建新表时保留原 Project，以及一个真实 Runtime/Fake Model case；App TypeScript 检查通过，生成数据库类型已同步。没有跑全量单测、Golden Eval、构建、浏览器或真实 Provider。

后续 T11 必须把全部 Golden case 经生产 AgentRuntime 执行，增加逐例 rubric/安全硬门/时间/成本等安全结果、冻结报告与成对比较拒绝规则；相关修订应包括 Web/bundle 时再扩展清单。当前账本和单个只读接入样例只证明结果关联契约，不证明任何候选优于基线。T19 的真实消融继续受 T11 阻塞，最终完整验收仍留 T21。
