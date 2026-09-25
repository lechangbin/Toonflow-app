# Agent Harness T11 面经：持久评测证据阶段版

> 只准备针对已实现代码的追问，不提供简历 bullet 或未证实的结果。T11 Issue #67 未完成。

1. 问：Evaluation Run 与 Agent Run 有什么区别？答：前者冻结一组对照用例、seed 和版本，是比较账本；后者才执行一次 Agent 请求。当前每条评测记录必须引用已终结、有 Trace 的生产 Agent Run。这样避免平行的评测专用流程跑通而生产 Runtime 失败。证据：术语表、ADR-0027、`evaluationRun.ts`。
2. 问：为什么要冻结两侧的修订？答：若 baseline 与 candidate 的 Model、Vendor、Tool、Skill 或 schema 随运行改变，就无法把差异归因到候选变化。清单在记录前锁定两侧修订、case manifest 哈希、同一组 case 和重复 seed，记录只允许落入冻结矩阵。但目前并未实际执行成对实验，不能报改善数字。
3. 问：如何防止一条 Run 被复用成多个评测样本？答：数据库约束同一个 Evaluation Run 中的 Agent Run ID 唯一，且 variant/case/seed 唯一。相同样本、相同 Run 重试写入返回原记录；换 Run 重绑或把同一 Run 填到另一 seed 会失败。对应 SQLite 单测覆盖。
4. 问：如果 Run 没完成或者缺少 Trace，能否记成结果？答：不能。`record` 只接收 terminal 状态、正版本和有效的最后 Trace；Output 可以为空以容纳失败 Run，但不可伪造成功。`inspect` 复核来源 Run 的状态、版本、Output 哈希和最后 Trace，不一致就停止输出有效比较。
5. 问：这个阶段能说 Golden Eval 或消融结果了吗？答：不能。现在只有冻结/关联/缺口契约与 4 个定向测试，未接 18 例 Golden Runtime 执行，未采集 rubric、成本、延迟或安全硬门，也没发布 baseline/candidate 成对报告。T19 真正消融仍被 T11 依赖阻塞，全量验收留到 T21。

源码证据索引：`src/eval/evaluationRun.ts`（清单、写入、读取）、`src/lib/initDB.ts`（两表与不可更新触发器）、`src/types/database.d.ts`（生成类型）、`tests/evaluationRun.test.ts`（定向验证）、`docs/reports/agent-harness-evaluation-67-progress.md`（未完成边界）。
