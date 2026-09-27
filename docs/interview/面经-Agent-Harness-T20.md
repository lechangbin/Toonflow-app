# Agent Harness T20 面经：TopologyPlan 与多 Agent 选择（阶段版）

> 对应开放 Issue #76。只有计划/交接校验、假角色执行壳和未核验的指标排序；没有生产多 Agent、真实对比或上线选择。不写简历 bullet，个人 ownership 由用户按提交记录确认。

## 主问与追问

1. 问：已经把生产 Agent 改成多 Agent 了吗？答：没有。当前落地的是 T0/T1/T2 版本化 TopologyPlan、角色 Tool/Skill 权限校验、交接载荷与产物所有权校验，以及只给出未核验阈值候选的指标排序函数；仅有确定性假角色执行壳，未接生产 Run，也未改变生产开关。证据：`src/agentRuntime/topologyPlan.ts`、`tests/topologyPlan.test.ts`。
2. 问：为什么 handoff 只给 Artifact 引用和哈希？答：原始 Prompt 或完整产物跨角色传输会扩大泄露面，还可能绕过共享 Context 的证据边界。当前严格 schema 只接收计划/Context 哈希、role、case、reason 和有限 Artifact 引用；计划内还检查发送者确实拥有该 kind。测试把 `rawPrompt` 塞进去会拒绝；这只是结构性保护，真实运行中的存储授权仍待执行器接入。
3. 问：模型自己指定 planner 的 Tool 和 Skill，能否拿到更多权限？答：不能。`validateTopologyPlan` 需要可信权限目录，逐角色检查请求的 Tool/Skill 是其子集；多一个未授权 Tool 就拒绝整个计划。后续执行每次 Tool 还必须继承既有 Run/Skill/grant 校验，当前计划层不代替运行时授权。
4. 问：什么时候值得用 T2？答：只有 T0、T1、T2 在同一冻结用例、预算和重复 seed 下都跑齐，且 T0/T1 未同时通过预声明的质量、延迟、成本、token、重试和安全硬门，而 T2 全部通过，并且每组结果能核对真实生产 Run 与评审来源，才有选择 T2 的依据。当前纯指标排序最多返回 `unverified` 的阈值候选，正式拓扑仍为 `null`；不能说 T2 优于单 Agent，更不会自动上线。
5. 问：为什么不做一个综合分选最高？答：安全硬门和成本上限不应被质量分抵消。实现按每个独立阈值和零容忍门判断；证据缺失、预算不同或任何硬门失败，都不能形成采用结论。定向单测验证预算不同会返回 incomplete。
6. 问：角色执行时如何防止 planner 调用 specialist 的 Tool？答：确定性执行壳给每个 handler 一个受限 `invokeTool`，在调用注入 port 前用计划和可信权限目录核对该角色 Tool、累计 Tool 次数和时长；角色输出与交接还要检查所有权和严格 schema。假角色测试中 planner 尝试调用 specialist Tool，port 调用数为零。它不是生产沙箱，handler 若能绕过 port 直接调用外部系统仍需更底层隔离；真实 Run/租约接入也未完成。证据：`src/agentRuntime/topologySimulation.ts`、`tests/topologySimulation.test.ts`。
7. 问：specialist 修改输入 handoff 的哈希，会不会污染 planner 的原始证据？答：不会。传给每个后续 handler 的是上一跳已校验 handoff 的隔离副本，内部记录和最终返回的 handoff 不与角色输入共享可变对象；单测让 specialist 修改副本的哈希，返回的 planner handoff 仍保持原值。这只保护实验执行壳的内存证据，不是生产持久证据完整性证明。
8. 问：T0/T1/T2 的具体角色与聚合区别是什么？答：T0 是单 worker、无 handoff，由 worker 持有 final；T1 是 planner→worker，一次交接后仍由 worker 输出最终结果；T2 是 planner→specialist→verifier，两次交接，verifier 必须给出 verification 和 final。`validateTopologyPlan` 把角色顺序、边、聚合方式及 maxHandoffs 固定为版本化形状。它规范实验对象，不说明 T2 更优秀。追问：能随意增加第四个角色吗？答：当前 schema 不支持，须显式升级计划版本。
9. 问：Artifact 为什么只能有一个 Owner？答：若 planner 和 specialist 都声称拥有同一种 candidate，后续 handoff 无法判断谁有权传递或修改，审计会失去来源。计划校验为每个 kind 建立唯一 Owner，最后 final 的 Owner 还随 T0/T1/T2 固定；交接只接受发送者自己拥有且边上允许的 kind。代价是复杂协作必须先拆清产物归属。追问：哈希相同能代替 Owner 吗？答：不能，内容身份和操作权限不同。
10. 问：handoff 为什么携带 planHash 和 contextBundleHash？答：同一个 Artifact 引用若脱离执行计划和输入上下文，接收方无法判断它是否来自当前角色链或当前案例。交接契约同时绑定计划哈希、case ID、发送/接收角色、Context Bundle 哈希、有限 reasonCode 和 Artifact ID/内容哈希，并限制 UTF-8 字节数。它只保证结构性一致，不会自己检查实际 Artifact 存储。追问：能放完整 Prompt 吗？答：严格 schema 不允许原始正文。
11. 问：停机条件为什么包括 handoff、Tool 次数和墙钟时间？答：多角色链容易因循环转交或重复 Tool 调用放大成本。计划固定最多 0/1/2 次交接以及 Tool 和时长预算，假执行壳每次调用 Tool 前检查角色白名单和总调用数，角色循环间检查时间。单测证明越权 Tool 到不了注入 port；但 handler 若绕过 port 直接调用外部系统，该实验壳不是安全沙箱。追问：生产还需要什么？答：Run 租约、受控 Tool 闸门和进程隔离。
12. 问：为什么只比较重复 seed 数仍不足以称等资源？答：两组都跑两次，但一组 seed 为 1/2、另一组为 9/10，随机扰动与案例组合可能不同。排序函数要求三组 caseManifestHash、seedSetHash、budgetHash、expectedRuns 和重复次数一致，且 executedRuns 完整；任何不一致返回 incomplete。这只是证据摘要层的拒绝规则，实际 seed 集与预算是否按声明执行，仍要 T19/T11 真实结果核验。追问：能只比较平均分吗？答：不能绕过样本身份。
13. 问：为什么先选最简单拓扑，而不是分数最高的 T2？答：多 Agent 增加 handoff、Token、延迟、失败面和调试成本，应先看 T0 是否同时满足质量、延迟、成本、token、重试和零安全硬门；不满足才依次考虑 T1/T2。函数按固定顺序找第一个全部达标者，不把质量和安全揉成综合分。当前输入只是未核验布尔摘要，返回 `thresholdCandidate` 而非正式拓扑，因此不能说 T0/T1/T2 已有优劣结论。追问：T2 满分但成本超限？答：不能采用。
14. 问：为什么 `chooseSimplestTopology` 的 `topology` 始终为 null？答：排序函数没有读取生产 Agent Run、真实 case 分母、人工质量证据或 Vendor 费用来源；任何人都可以构造三组布尔量。它只能在完整、同预算的摘要中给一个 `unverified` 阈值候选，不能修改生产开关。T19 目前也只有假 adapter 契约，因此 T20 的采用门被故意锁住。追问：真实来源完善后直接返回正式选择吗？答：还需独立核验逐例结果与风险。
15. 问：T20 要达到可上线选择还缺什么？答：需要将角色链接入持久 Agent Run、租约、Context/Skill/Tool 授权和安全投影，按 T19 冻结的同用例、预算与重复 seed 跑 T0/T1/T2，分析逐例故障迁移、成本和安全硬门，再由独立来源/评审核验形成不可变报告。只有较简单拓扑未满足门槛且更复杂方案有充分证据时，才可讨论生产开关。当前 Issue #76 开放，T21 全量验收未开始。追问：现在能展示什么？答：计划与假执行壳的定向反例。

## 源码证据索引

| 主题 | 关键路径与内部符号 | 对应问题 |
| --- | --- | --- |
| 计划、权限与交接 | `src/agentRuntime/topologyPlan.ts`、`validateTopologyPlan`、`validateTopologyHandoff` | 1–3、8–10 |
| 未核验选择 | 同文件 `chooseSimplestTopology`、`tests/topologyPlan.test.ts` | 4–5、12–14 |
| 假角色执行壳 | `src/agentRuntime/topologySimulation.ts`、`tests/topologySimulation.test.ts` | 6–7、11 |
| 阶段边界 | `docs/reports/agent-harness-topology-76-progress.md`、Issue #76 | 1、14–15 |

## 高风险 Claim

T19 实际消融、T20 重复对比、故障迁移分析和生产开关选择均未完成；T21 才做全量与真实环境验收。不可把 `thresholdCandidate`、假 handler 结果或计划哈希说成生产多 Agent 性能收益。
