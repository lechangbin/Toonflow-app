# Agent Harness T21 导学：最终验收与证据索引（准备阶段）

> 对应开放 Issue #77。当前实现证据索引契约和只读文件字节复核，七类正式验收全为 pending。已有局部预验收，但完整冻结组合与独立验真未完成。本文不写简历、不填未测收益。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| 测试层级与可复现命令 | 局部单测不能代替跨仓验收 | Issue #77、`docs/reports/agent-harness-final-acceptance-77-prep.md` | 高 |
| 修订清单与组合身份 | 避免新 App 配旧 Web/bundle | `src/eval/finalAcceptanceIndex.ts` | 高 |
| 声明、索引、独立核验 | 防止自填 passed 形成假证据 | `assessFinalAcceptance`、`verifyFinalAcceptance` | 高 |
| 结果分母和评测归因 | 区分覆盖、硬门、人工质量和成本 | T02/T11 报告、Issue #67 | 高 |
| 外部副作用与 unknown | 真实 Provider 及恢复另需证据 | T09/T17/T20 报告 | 高 |

## 重点亮点与阅读顺序

| 亮点 | 核心问题 | 先看文件 | 顺序 |
| --- | --- | --- | --- |
| 七类验收完整性 | 少一类是否仍可声明完成 | `REQUIRED_ACCEPTANCE_IDS`、Issue #77 | 1 |
| 严格证据字段 | 没命令/哈希/来源可否标 passed | `validateFinalAcceptanceIndex` | 2 |
| 冻结系统修订 | App/Web/schema/bundle 是否同一组合 | `revisionManifestSchema` | 3 |
| 独立检查器 | 元数据自述能否变成验收结论 | `assessFinalAcceptance`、`verifyFinalAcceptance` | 4 |
| 证据文件字节复核 | 路径、缺失与篡改能否被发现 | `computeFinalAcceptanceEvidenceHash` | 5 |
| Paid canary 独立披露 | 假 Provider 如何不冒充真实服务商 | `paidProviderCanary`、阶段报告 | 6 |

## 必备知识点

- [ ] 列出 functional、compatibility、recovery、security、evaluation、build、browser 七类，解释各自不能由哪一类测试替代。
- [ ] 说明 `passed` 的字段要求：仓库内证据路径、执行命令、结果哈希、来源组件和来源修订。
- [ ] 区分索引格式校验、`assess` 的未核验判定，以及外部检查器参与的 `verify`。
- [ ] 解释为何 `verify` 函数允许注入假 `true` 只是接口测试，不能证明真实证据已读过。
- [ ] 复述文件摘要的规范排序、逐文件 SHA-256 和整体哈希，并说明它不执行命令或验证语义。
- [ ] 说明逐项摘要观察器的 `hash-match`、`hash-mismatch`、`unreadable`、`not-claimed` 为什么不返回验收 `ready`。
- [ ] 说明单项来源修订匹配仍不足以核实 App/Web/bundle/Schema 联合组合。
- [ ] 讲清结构性验收与付费 canary 是不同结论；`ready` 与 `paidProviderCanaryGap` 应分别报告。
- [ ] 指出当前七类 pending、无真实最终结果文件、无全量命令记录，不把准备文档说成完成报告。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 验收范围 | Issue 条款、依赖、风险 | GitHub Issue #77、`docs/reports/agent-harness-final-acceptance-77-prep.md` | 20 分钟 | 真正完成门槛是什么 |
| 索引 schema | 七项、十三类修订、路径约束 | `src/eval/finalAcceptanceIndex.ts` | 35 分钟 | 自述证据如何被约束 |
| 反例测试 | 缺证据、错组件、假通过 | `tests/finalAcceptanceIndex.test.ts` | 25 分钟 | 当前单测到底证明什么 |
| 文件字节复核 | 缺失、重复、目录、越界和篡改 | `src/eval/finalAcceptanceEvidenceFiles.ts`、对应定向测试 | 20 分钟 | 哈希能与不能证明什么 |
| 逐项摘要观察 | 已声明通过的七类证据如何逐项读字节 | `src/eval/finalAcceptanceEvidenceInspection.ts`、对应定向测试 | 15 分钟 | 为何全匹配也不是最终验收 |
| 上游分母 | 18-case/72-cell 与结果层缺口 | `docs/interview/导学-Agent-Harness-T11.md`、Issue #67 | 30 分钟 | 为什么评测不能只看覆盖 |
| 最终执行序列 | 先收敛 T12–T20 再统一验收 | `docs/reports/agent-harness-open-stage-sequence.md` | 20 分钟 | 为什么当前不运行全量套件 |

自学提醒：若修订溯源、检查器接口或结果哈希概念不清，请继续追问 AI；本导学给阅读路径与自测题，不代替实际验收操作。

## 项目技术定位

T21 是 Agent Harness 的最终系统证据与运营风险交接门，不是又一个业务 Tool。它要求前面阶段的行为能跨 App/Web、数据库、Model/Vendor、浏览器和进程恢复边界被同一冻结修订组合核验。

## 核心原理解析

1. 问题：阶段定向单测可能各自正确却组合失败。机制：Issue #77 要求七类独立验收，并把每项命令、结果哈希、来源修订和证据路径落入版本化索引。当前七项仍 pending。
2. 问题：人可以手填 `passed`。机制：schema 先拒绝缺证据字段、非仓库路径、错误顺序；`assess` 对仅有元数据的索引始终不返回 ready。格式正确仍不能证明证据真实。
3. 问题：旧 Web 搭新 App 或把 App commit 标成 Web 来源。机制：修订清单冻结十三类组件，单项使用显式 sourceComponent 比对相应修订；联合组合还必须由未来独立检查器核实。
4. 问题：索引中的相对路径可能缺失、被篡改或经 symlink 指向根外。机制：只读模块对真实文件路径与字节进行复核，按规范路径排序计算聚合 SHA-256；这不是命令或内容真实性验收。
5. 问题：付费 Vendor 的费用、CDN 与迟到回调无法从 fake 推断。机制：paid canary 单独标记 not-run/passed/failed；未跑时结构性结论仍可单独陈述，但真实 Provider 行为保持未知。
6. 问题：评测有覆盖但无质量结论。机制：最终报告需引入 T11 的真实成对 case/seed 分母、硬门、人工 rubric、失败和费用来源，不允许拿 T02 deterministic fake 的 18/18 冒充候选收益。
7. 问题：即使逐项文件摘要都与索引相符，也可能把“字节一致”误报成最终验收。机制：`inspectFinalAcceptanceEvidenceFiles` 只返回 `hash-match`、`hash-mismatch`、`unreadable` 或 `not-claimed`，不返回 `ready`；七项全匹配仍须另核命令、来源修订、业务断言和人工评价。

## 关键设计决策

| 选择 | 未采用方案 | 取舍与风险 | 当前证据 |
| --- | --- | --- | --- |
| 固定七项顺序与分母 | 随意填几个通过项 | 防止验收范围缩水，未来增类需版本迁移 | `tests/finalAcceptanceIndex.test.ts` |
| 自述与核验分层 | 填了字段立即 ready | 多一层检查器实现成本，但避免假阳性 | `assessFinalAcceptance`、`verifyFinalAcceptance` |
| 组件定向修订匹配 | 清单里有这个值就算匹配 | 防止跨组件冒名，尚需组合核验 | 错组件定向测试 |
| 只读文件摘要 | 根据路径存在就相信结果 | 能发现字节变化，但不验证命令执行、Git 来源与语义 | `finalAcceptanceEvidenceFiles` 定向测试 |
| 逐项摘要观察，不自动判 ready | 把文件哈希匹配直接接到通过回调 | 避免只读字节检查冒充独立验收；完整检查器仍待实现 | `finalAcceptanceEvidenceInspection` 定向测试 |
| canary 独立状态 | 用假 Provider 代替真实 | 保留零付费阶段测试，同时不伪称外部行为 | `paidProviderCanary` schema |

## 量化与验证（待执行）

当前索引、文件摘要和逐项观察三份定向测试合计 7 passed、1 skipped（本机不可创建外链 symlink），TypeScript 检查通过；另有局部预验收，均不等于最终七类通过。最终应在所有实现阶段收敛后冻结 App/Web/Schema/Bundle 与运行组件，执行 Issue #77 完整套件及独立证据读取；失败、缺失、未运行 canary 和残余风险都要公开。不能先填“已通过”再寻找证据。
