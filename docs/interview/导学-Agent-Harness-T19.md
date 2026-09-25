# Agent Harness T19 导学：先冻结消融契约，再测策略

> 只解释已落库的评测契约，不宣称消融结果或简历收益。完整测试与最终验收留到 T21。

入口：`src/eval/ablationContract.ts`、`src/eval/ablationRunner.ts`；阶段证据：`tests/ablationContract.test.ts`、`docs/reports/agent-harness-ablation-75-progress.md`。

阅读顺序：先看 `validateAblationManifest` 如何锁定实验轴、四个候选、用例哈希、重复 seed、修订和共同预算；再看 `expectedAblationRunKeys` 生成等资源矩阵；最后看 `summarizeAblationResults` 为什么把缺失、未审质量、安全硬门分别计数并独立判定。与既有 `src/eval/goldenEval.ts` 的 18 例 Golden 清单相比，此模块目前只是消融元契约，尚未调 Golden Runner。

假执行驱动逐组合把同一预算交给 adapter，严格解析指标；异常文本不进入结果，返回原始 Prompt 等未知字段会变为 evidence failure。单测证明这一拒绝行为，但 adapter 目前只是注入的假函数，不代表四种实际策略已运行。

关键取舍：四个 Context 候选采用完整参考的逐项移除，不把多个变量同时改变后再归因；Skill 路由候选不移除权限门，因为“无授权上升”是所有策略都必须守住的前置条件。每个 variant 对同一 case/seed 运行，成本、延迟、质量、失败分类独立报告，不用合成分掩盖安全失败。未跑齐、质量待审或证据 ID 缺失都不能形成采用结论。

自测：解释为什么阈值和 manifest hash 必须先于结果冻结；为什么 case manifest hash 与 Runtime/Tool/Skill/Model 修订都要入清单；给出一条 `permission-escalation=false` 即使质量为 2 也不能采用的反例；指出当前没有真实评测结果、没有因果收益数字。
