# Agent Harness T19 导学：Context/Skill 消融契约（阶段版）

> 对应开放 Issue #75。当前只有代码中的清单/结果契约与假 adapter 驱动，没有实际变体执行、不可变结果文件或因果收益。不写简历，完整验收留到 T21。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| 消融与对照 | 区分机制贡献和多变量混杂 | `CONTEXT_ABLATION_VARIANTS`、`SKILL_ABLATION_VARIANTS` | 高 |
| 实验冻结与分母 | 避免看结果后改阈值或漏 case | `validateAblationManifest`、`expectedAblationRunKeys` | 高 |
| 安全硬门与未知 | 不让质量抵消越权，也不把异常算零成本 | `summarizeAblationResults` | 高 |
| 来源/评审核验 | 假指标与真实 Agent Run 不是同类证据 | T11、`thresholdsPassed`/`adoptable` | 高 |
| Trace-safe 输出 | 不复制 Prompt 和异常秘密到结果 | `runAblationMatrix` | 中 |

## 重点亮点与阅读顺序

| 亮点 | 核心问题 | 先看文件 | 顺序 |
| --- | --- | --- | --- |
| 两条实验轴 | 删哪一项才可归因 | `ablationContract.ts` 常量与 schema | 1 |
| 冻结矩阵 | 五种 variant 是否跑同 case/seed/预算 | `validateAblationManifest`、`expectedAblationRunKeys` | 2 |
| 严格结果 | 异常、未知字段及敏感正文怎样拒绝 | `ablationRunResultSchema`、`ablationRunner.ts` | 3 |
| 阈值汇总 | 缺失、p95、质量、费用、硬门如何分别计 | `summarizeAblationResults` | 4 |
| 采用边界 | 假指标为何只能 thresholdsPassed | `adoptable:false`、阶段报告 | 5 |

## 必备知识点

- [ ] 画出 full-context 与四个 leave-one-out 候选、permission-gated-route 与四个路由候选。
- [ ] 说明至少两个递增唯一 seed、同一 case manifest hash、共同预算和九类修订为什么要冻结。
- [ ] 解释 expected keys 如何让缺失和重复结果不能从分母中消失。
- [ ] 区分 `hardGateFailures`、`hardGateUnknown`、`unknownMetrics` 和 `unexpectedFailureClass`。
- [ ] 解释满分质量为何不能抵消 `permission-escalation=false`。
- [ ] 说明 `thresholdsPassed` 与 `adoptable:false` 的不同证据门槛。
- [ ] 指出当前假 adapter 没有真正移除 Context/Skill 机制，也没有真实 Agent Run 来源核验。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 问题与边界 | 阶段已做/未做 | `docs/reports/agent-harness-ablation-75-progress.md` | 15 分钟 | 为什么还不能报收益 |
| 冻结清单 | 轴、候选、case、seed、修订与阈值 | `src/eval/ablationContract.ts` 前半 | 40 分钟 | 如何防止实验漂移 |
| 结果汇总 | 缺失、硬门、unknown、p95 | 同文件 `summarizeAblationResults` | 45 分钟 | 为什么某候选不通过 |
| 假执行壳 | 严格解析、异常投影、同预算传递 | `src/eval/ablationRunner.ts` | 25 分钟 | 测试中到底执行了什么 |
| 反例单测 | 满分越权、缺样、异常与 rawPrompt | `tests/ablationContract.test.ts` | 35 分钟 | 哪些坏结论被挡住 |
| 上游来源 | 18-case/72-cell 与真实 Run | `docs/interview/导学-Agent-Harness-T11.md` | 30 分钟 | 最终采用还缺什么 |

自学提醒：若消融、p95 或来源核验原理不清，请继续追问 AI；本导学提供学习路径与题目，不替代真实实验。

## 项目技术定位

T19 是评测方法与安全采用门槛，不是策略优化结果。它为以后回答“Context 的哪个组成有效”“哪种 Skill 路由更合适”准备同分母契约，同时保证权限门不能被当作可移除变量。

## 核心原理解析

1. 问题：一次改多项难以归因。机制：Context 每次移除一项；Skill 只比较路由算法，保留权限门。
2. 问题：用例、随机性与预算漂移。机制：Manifest 冻结 hash、case/seed、九类修订、共同预算及阈值，expected keys 枚举完整矩阵。
3. 问题：异常被写成零费用或安全通过。机制：假驱动只记录 evidence failure，费用/Token/安全门均为 null，汇总将 unknown 与真失败分开。
4. 问题：分数掩盖越权。机制：安全硬门零容忍且不做综合分，质量、p95、成本、重试和预算独立报告。
5. 问题：假指标被当真实采用。机制：阈值计算可解释局部数字，但真实 Run/评审来源未核验前 `adoptable` 恒 false。

## 关键取舍与待测

| 选择 | 备选 | 风险与代价 | 当前证据 |
| --- | --- | --- | --- |
| 完整矩阵 | 缺样后只算现有记录 | 实验成本增加，但不隐藏失败分母 | `tests/ablationContract.test.ts` |
| 预冻结阈值 | 看结果调门槛 | 需要事先讨论标准，减少结果操纵 | Manifest hash/时间校验 |
| 不导出原始 Prompt | 复制全部数据到结果 | 降低泄漏面，核验需额外受控入口 | 严格 schema 与假 adapter 测试 |
| 采用与阈值分层 | 数字全过就上生产 | 暂不能给推荐，但避免假 adapter 误导 | `adoptable:false` |

当前没有真实消融结果、不可变结果文件或方案采用决定；未来需接入 T11 的来源与人工评审，并在 T21 统一验收。
