# Agent Harness T20 导学：多 Agent 拓扑的权限与交接契约（阶段版）

> 对应开放 Issue #76。当前只有版本化计划、交接校验、假角色执行壳和未核验指标排序；没有生产多 Agent、真实对比或采用结论。简历由用户自行完成，全量验收留到 T21。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| 角色职责与最小权限 | 防止 planner 拿 specialist Tool | `validateTopologyPlan`、权限目录 | 高 |
| Artifact 所有权与引用 | 控制角色间传递的内容和来源 | `validateTopologyHandoff` | 高 |
| 停止条件与资源预算 | 多 Agent 容易放大延迟和 Tool 调用 | `topologyPlanSchema`、`simulateTopology` | 高 |
| 等资源重复对比 | 复杂拓扑需要真实增益证据 | `chooseSimplestTopology`、T19 | 高 |
| 假执行壳与生产隔离 | 避免把 handler 单测讲成上线 | `topologySimulation.ts` | 高 |

## 重点亮点与阅读顺序

| 亮点 | 核心问题 | 先看文件 | 顺序 |
| --- | --- | --- | --- |
| T0/T1/T2 固定形状 | 复杂度如何逐层增加 | `topologyPlan.ts` 的 `shape` | 1 |
| 权限与产物所有权 | 谁有权调用、生成与传递 | `validateTopologyPlan` | 2 |
| 最小交接 payload | 为什么不复制原始 Prompt | `topologyHandoffSchema`、`validateTopologyHandoff` | 3 |
| 假角色执行 | 越权 Tool 是否在 port 前拒绝 | `simulateTopology` | 4 |
| 未核验选择 | 为什么最简单候选仍不能上线 | `chooseSimplestTopology` | 5 |

## 必备知识点

- [ ] 画出 T0 worker；T1 planner→worker；T2 planner→specialist→verifier 的边与 final Owner。
- [ ] 说明 Tool/Skill 权限目录是可信外部输入，不来自模型提案。
- [ ] 解释 Artifact kind 的唯一 Owner、交接边允许 kind 和字节上限。
- [ ] 区分有哈希的 Artifact 引用与真实 Artifact 内容/存储授权核验。
- [ ] 说明 `maxHandoffs`、`maxToolCalls`、`maxWallMs` 的限制及假壳绕过风险。
- [ ] 解释 caseManifestHash、seedSetHash、budgetHash 和完整 expectedRuns 为何必须相同。
- [ ] 解释 `unverified/thresholdCandidate` 与正式 `topology:null` 的关系。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 阶段边界 | 已实现与未实现 | `docs/reports/agent-harness-topology-76-progress.md` | 15 分钟 | 现在能说什么 |
| 计划 | 角色、权限、Owner、停止规则 | `src/agentRuntime/topologyPlan.ts` 前半 | 40 分钟 | T0/T1/T2 怎样区别 |
| 交接 | 引用、计划哈希、Context 哈希、边与大小 | 同文件 `validateTopologyHandoff` | 30 分钟 | 原始 Prompt 为什么不能直接转发 |
| 假执行 | handler、受限 Tool port、副本隔离 | `src/agentRuntime/topologySimulation.ts` | 40 分钟 | 局部单测验证什么 |
| 排序 | 同 case/seed/预算、最简单满足门槛 | 同文件 `chooseSimplestTopology`、`tests/topologyPlan.test.ts` | 30 分钟 | 为什么只有未核验候选 |
| 上游实验 | T11 来源与 T19 等资源结果 | `docs/interview/导学-Agent-Harness-T19.md` | 25 分钟 | 上线决策缺哪层证据 |

自学提醒：若角色拓扑或 handoff 边界不清，请继续追问 AI；本导学给学习路径和题目，不替代真实多 Agent 实验。

## 项目技术定位

T20 为是否值得引入多 Agent 设定权限、交接和证据门槛，默认保持最简单的 T0 参考。它不把额外角色当作天然能力提升，也不因代码里存在 T2 计划就修改生产执行开关。

## 核心原理解析

1. 问题：角色越权。机制：计划角色的 Tool/Skill 必须是可信目录子集，假执行壳调用 port 前再查当前角色与预算。
2. 问题：交接扩大泄露面。机制：仅传 Artifact ID、kind、Owner、哈希、Plan/Context 哈希和受限 reason，不传正文；边还限制种类与字节数。
3. 问题：多个角色声称拥有同一产物。机制：每种 Artifact kind 只有一个 Owner，最终产物由 worker 或 verifier 随拓扑固定。
4. 问题：假指标推导上线选择。机制：三组相同 case、seed、预算和完整分母才能排序；仍只给 `unverified` 阈值候选，正式 topology 为 null。
5. 问题：handler 修改上一跳证据。机制：下一角色收到已记录 handoff 的隔离副本；这仅保证实验壳内存状态，不是生产持久证据。

## 关键设计决策

| 选择 | 未采用方案 | 代价与风险 | 当前证据 |
| --- | --- | --- | --- |
| 先 T0 再 T1/T2 | 默认最复杂拓扑 | 较少角色可能达不到质量，但避免无证据增加成本 | `chooseSimplestTopology` 定向测试 |
| 显式角色权限 | 模型自选 Tool/Skill | 配置成本增加，防止计划层越权 | `validateTopologyPlan` 反例 |
| 引用式 handoff | 角色间传完整 Prompt/正文 | 需要另查 Artifact，降低泄漏面 | 严格 schema 与 rawPrompt 拒绝 |
| 实验壳不接生产 | 直接改生产 Agent | 暂无真实效果，但风险可控 | `tests/topologySimulation.test.ts` |

## 量化与验证（待测）

当前只有定向计划/假角色测试与 TypeScript 检查记录。要形成选择结论，仍需 T11/T19 真实来源及逐例评审、同预算重复试验、故障迁移分析，再在 T21 做完整 App/Web/恢复/安全验收；任何 T2 收益数字目前均无依据。
