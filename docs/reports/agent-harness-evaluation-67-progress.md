# Agent Harness T11 · Evaluation Run 冻结基础（阶段进度）

Issue：`lechangbin/Toonflow-app#67`。本报告只描述第一切片，不代表 T11 完成，也不是 T21 最终验收。

## 当前已实现

- `Evaluation Run` 与 `Evaluation Case` 术语写入 `CONTEXT.md`，ADR-0018 明确 T02 历史基线不能伪装成后来运行的 Agent Run；新候选用例必须通过生产 AgentRuntime，当前只读 Runtime 尚不能覆盖全部 Script→Asset→Image 场景。
- 新建 `o_evaluationRun` 和 `o_evaluationCase`：同一事务冻结经 T02 manifest 契约校验的 18 个 case、分区和原始 manifest 哈希，以及 Runtime、Tool、Context、Skill、Model、Vendor、评测 schema 与 rubric 修订。Run 的冻结字段不可更新或删除，Case 身份不可改写。
- 冻结操作只创建 18 条 `pending` Case；没有 Agent Run ID、门禁结果、质量评分、产物、耗时或成本时绝不写入成功记录。支持旧数据库新增表而不重写 Project 记录；生成类型声明已同步。
- Case 观察绑定要求真实 AgentRuntime 创建的 Run 具备 `eval:<EvaluationRun>:<Case>` 请求身份、可观察状态与完整因果 Trace；保存 Run 版本、最后 Trace 序号及终态端到端耗时。未知实际收费保留为 `null`，不假称零成本。它只把 Case 标记为 `observed`，不设置完成时间、门禁通过、产物有效或人工评分。
- 配对比较的准入检查会复验两个冻结记录的哈希，要求同一 manifest、评测结果 schema 与 rubric；Runtime、Tool、Context、Skill、Model、Vendor 修订差异明确列为处理变量。此检查不生成分数或性能结论。
- 新增机器可读与 Markdown 可读的配对覆盖报告：固定 18 个 case 分母、逐案列出 `pending`、`observed`、缺失或损坏记录，并显示两边计数及处理变量。`observed` 会重新核对生产 Run 的评测请求身份、版本和完整因果 Trace；仅靠 Case 表里的状态字段不能算作已观察。报告显式声明它不是 hard-gate、Rubric 或质量结论。

## 阶段验证

`tests/evaluationRun.test.ts` 7 个定向用例通过：冻结与禁止改写、修订冲突和事务回滚、CRLF/LF 同一 manifest 身份、旧库增表保留 Project、真实生产 AgentRuntime（确定性 Fake Model）的 Case 观察、配对契约不兼容/损坏拒绝，以及覆盖报告的 18 案分母、观察来源复验与不伪造质量分数。需人工介入的 `waiting` Run 可以作为失败/阻塞观察记录，但不能据此算成功。`yarn lint`（TypeScript `--noEmit`）通过。未运行全量测试、构建、真实 Provider 或浏览器。

## 尚未完成

当前没有执行任何 T11 候选用例，故不存在可宣称的 hard-gate 通过率、人工 0/1/2 分数、成本、性能收益或结果级 baseline/candidate 比较。现有配对报告仅是覆盖状态快照，不是结果报告。后续顺序是：让每条 case 通过生产 AgentRuntime 产生可核验 Run 身份；仅在真实 Run 后提交案例门禁/质量/产物引用/耗时/成本与失败分类；再生成结果级的机器与人工可读配对报告。18 条都经 Runtime 执行、敏感信息及 holdout 门禁、失败分母和可复现命令仍为 T11 后续验收项。
