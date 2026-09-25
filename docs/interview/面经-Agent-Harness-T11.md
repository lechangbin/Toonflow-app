# Agent Harness T11 面经：持久评测证据阶段版

> 只准备针对已实现代码的追问，不提供简历 bullet 或未证实的结果。T11 Issue #67 未完成。

1. 问：Evaluation Run 与 Agent Run 有什么区别？答：前者冻结一组对照用例、seed 和版本，是比较账本；后者才执行一次 Agent 请求。当前每条评测记录必须引用已终结、有 Trace 的生产 Agent Run。这样避免平行的评测专用流程跑通而生产 Runtime 失败。证据：术语表、ADR-0027、`evaluationRun.ts`。
2. 问：为什么要冻结两侧的修订？答：若 baseline 与 candidate 的 Model、Vendor、Tool、Skill 或 schema 随运行改变，就无法把差异归因到候选变化。清单在记录前锁定两侧修订、case manifest 哈希、同一组 case 和重复 seed，记录只允许落入冻结矩阵。但目前并未实际执行成对实验，不能报改善数字。
3. 问：如何防止一条 Run 被复用成多个评测样本？答：数据库约束同一个 Evaluation Run 中的 Agent Run ID 唯一，且 variant/case/seed 唯一。相同样本、相同 Run 重试写入返回原记录；换 Run 重绑或把同一 Run 填到另一 seed 会失败。对应 SQLite 单测覆盖。
4. 问：如果 Run 没完成或者缺少 Trace，能否记成结果？答：不能。`record` 只接收 terminal 状态、正版本、正确的样本请求 ID 和有效的最后 Trace；Output 可以为空，目前并未以 Output 是否存在单独评定成功质量。`inspect` 复核来源 Run 的请求身份、状态、版本、Output 哈希和最后 Trace，不一致就停止输出有效比较。
5. 问：这个阶段能说 Golden Eval 或消融结果了吗？答：不能。现在能冻结真实 18-case Golden manifest，但 72 个 variant/seed 样本仍全部缺失；仅有一个实际 AgentRuntime + Fake Model 的只读 case 接线样例，共 7 个 T11 定向测试。未接 18 例 Golden Runtime 执行，未采集 rubric、成本、延迟或安全硬门，也没发布 baseline/candidate 成对报告。T19 真正消融仍被 T11 依赖阻塞，全量验收留到 T21。
6. 问：新执行适配器如何避免另造一条 Agent 路径？答：它调用既有 AgentRuntime 的 `start` 和 `inspect`，用确定性的评测样本请求 ID 继承 Runtime 幂等性；只有确认真正终结，才把该 Run 的持久证据写入 Evaluation Run。预检不在冻结矩阵或修订不符时在启动前失败。测试的调度器和 Text Model 是本地 Fake，不能证明真实供应商或所有 Golden 场景已经走该链路。
7. 问：为什么不能拿不同模型或数据库结构的两组 Run 直接比较？答：Model、Vendor 和 schema 改变会与候选策略变化混杂，无法归因。清单在 baseline/candidate 间要求这三种修订一致，若不同就在记录前拒绝；其他模块修订可作为候选差异保留。它仍是必要而非充分条件，预算相同与逐例质量、安全结果还未完成。
8. 问：只冻结 case ID 为什么不足以做成对比较？答：两侧可能传入不同的正文，比较结果便混入了输入差异。清单现在额外冻结每个 case 的正文哈希，执行前校验；账本也验证 Run 的确定性请求 ID 对应该 cell。不过 seed 尚未控制模型随机性，外部 Golden fixture 与输入的绑定还没有完成，不能把这个局部门禁夸大成完整同条件实验。
9. 问：绕过执行适配器直接写账本，或修改已记录 Run 的输入，如何发现？答：`record` 和 `inspect` 都会解析 Run 持久化的输入，按 Runtime 的 `trim()` 规则核对正文哈希，并核对冻结的 role/scope 和样本请求 ID。伪造来源文本或换角色会拒绝；但 Project 数据快照和模型随机种子未冻结，不能宣称所有环境变量一致。
10. 问：早期已经有一套 18-case 冻结表，为什么还要收敛？答：早期 Draft #90 冻结真实 Golden manifest 和覆盖分母，但使用独立的 Run/Case 表与请求身份；后续生产 Agent Run 账本如果另起一套，就会出现两个权威来源。当前选择把 18-case 原文、哈希和明确提供的输入契约冻结在同一配对账本里，并已移植“覆盖不等于质量”的报告语义。早期 Draft 仍需收敛处理，不能作为两套 schema 并列交付，更不能宣称 18 例已跑通。
11. 问：覆盖报告为什么不能直接变成质量报告？答：它只按冻结的 case、seed 和 variant 统计“有无可复核生产 Run”，不会检查业务硬门、产物语义或人工 0/1/2 评分。即使所有 cell 都 observed，模型可能给出错误结论；现在一个真实只读样例只让基线侧 1/36 个 cell 从 missing 变 observed，且来源版本变更会使整份报告拒绝。质量和收益必须等 18 例真实场景及逐例证据齐全后另算。

源码证据索引：`src/eval/evaluationRun.ts`（清单、写入、读取）、`src/eval/goldenEvaluationFreeze.ts`（真实 18-case 清单冻结）、`src/eval/evaluationCoverageReport.ts`（覆盖非质量报告）、`src/eval/evaluationAgentCase.ts`（真实 Runtime 接线）、`src/lib/initDB.ts`（两表与不可更新触发器）、`src/types/database.d.ts`（生成类型）、`tests/evaluationRun.test.ts`、`tests/evaluationAgentCase.test.ts` 与 `tests/goldenEvaluationFreeze.test.ts`（定向验证）、`docs/reports/agent-harness-evaluation-67-progress.md`（未完成边界）。
