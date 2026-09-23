# Agent Harness T11 · Evaluation Run 冻结基础（阶段进度）

Issue：`lechangbin/Toonflow-app#67`。本报告只描述第一切片，不代表 T11 完成，也不是 T21 最终验收。

## 当前已实现

- `Evaluation Run` 与 `Evaluation Case` 术语写入 `CONTEXT.md`，ADR-0018 明确 T02 历史基线不能伪装成后来运行的 Agent Run；新候选用例必须通过生产 AgentRuntime，当前只读 Runtime 尚不能覆盖全部 Script→Asset→Image 场景。
- 新建 `o_evaluationRun` 和 `o_evaluationCase`：同一事务冻结经 T02 manifest 契约校验的 18 个 case、分区和原始 manifest 哈希，以及 Runtime、Tool、Context、Skill、Model、Vendor、评测 schema 与 rubric 修订。Run 的冻结字段不可更新或删除，Case 身份不可改写。
- 冻结操作只创建 18 条 `pending` Case；没有 Agent Run ID、门禁结果、质量评分、产物、耗时或成本时绝不写入成功记录。支持旧数据库新增表而不重写 Project 记录；生成类型声明已同步。

## 阶段验证

`tests/evaluationRun.test.ts` 4 个定向用例通过：冻结与禁止改写、修订冲突和事务回滚、CRLF/LF 同一 manifest 身份、旧库增表保留 Project。`yarn lint`（TypeScript `--noEmit`）通过。未运行全量测试、构建、真实 Provider 或浏览器。

## 尚未完成

当前没有执行任何 T11 候选用例，故不存在可宣称的 hard-gate 通过率、人工 0/1/2 分数、成本、性能收益或 baseline/candidate 比较。后续顺序是：让每条 case 通过生产 AgentRuntime 产生可核验 Run 身份；仅在真实 Run 后提交案例门禁/质量/产物引用/耗时/成本与失败分类；再校验两次 Run 的 manifest 和必要修订兼容性，生成机器与人工可读的配对报告。18 条都经 Runtime 执行、敏感信息及 holdout 门禁、失败分母和可复现命令仍为 T11 后续验收项。
