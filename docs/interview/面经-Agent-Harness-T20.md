# Agent Harness T20 面经：TopologyPlan 阶段版

1. 问：已经把生产 Agent 改成多 Agent 了吗？答：没有。当前落地的是 T0/T1/T2 版本化 TopologyPlan、角色 Tool/Skill 权限校验、交接载荷与产物所有权校验，以及只给出未核验阈值候选的指标排序函数；仅有确定性假角色执行壳，未接生产 Run，也未改变生产开关。证据：`src/agentRuntime/topologyPlan.ts`、`tests/topologyPlan.test.ts`。
2. 问：为什么 handoff 只给 Artifact 引用和哈希？答：原始 Prompt 或完整产物跨角色传输会扩大泄露面，还可能绕过共享 Context 的证据边界。当前严格 schema 只接收计划/Context 哈希、role、case、reason 和有限 Artifact 引用；计划内还检查发送者确实拥有该 kind。测试把 `rawPrompt` 塞进去会拒绝；这只是结构性保护，真实运行中的存储授权仍待执行器接入。
3. 问：模型自己指定 planner 的 Tool 和 Skill，能否拿到更多权限？答：不能。`validateTopologyPlan` 需要可信权限目录，逐角色检查请求的 Tool/Skill 是其子集；多一个未授权 Tool 就拒绝整个计划。后续执行每次 Tool 还必须继承既有 Run/Skill/grant 校验，当前计划层不代替运行时授权。
4. 问：什么时候值得用 T2？答：只有 T0、T1、T2 在同一冻结用例、预算和重复 seed 下都跑齐，且 T0/T1 未同时通过预声明的质量、延迟、成本、token、重试和安全硬门，而 T2 全部通过，并且每组结果能核对真实生产 Run 与评审来源，才有选择 T2 的依据。当前纯指标排序最多返回 `unverified` 的阈值候选，正式拓扑仍为 `null`；不能说 T2 优于单 Agent，更不会自动上线。
5. 问：为什么不做一个综合分选最高？答：安全硬门和成本上限不应被质量分抵消。实现按每个独立阈值和零容忍门判断；证据缺失、预算不同或任何硬门失败，都不能形成采用结论。定向单测验证预算不同会返回 incomplete。
6. 问：角色执行时如何防止 planner 调用 specialist 的 Tool？答：确定性执行壳给每个 handler 一个受限 `invokeTool`，在调用注入 port 前用计划和可信权限目录核对该角色 Tool、累计 Tool 次数和时长；角色输出与交接还要检查所有权和严格 schema。假角色测试中 planner 尝试调用 specialist Tool，port 调用数为零。它不是生产沙箱，handler 若能绕过 port 直接调用外部系统仍需更底层隔离；真实 Run/租约接入也未完成。证据：`src/agentRuntime/topologySimulation.ts`、`tests/topologySimulation.test.ts`。
7. 问：specialist 修改输入 handoff 的哈希，会不会污染 planner 的原始证据？答：不会。传给每个后续 handler 的是上一跳已校验 handoff 的隔离副本，内部记录和最终返回的 handoff 不与角色输入共享可变对象；单测让 specialist 修改副本的哈希，返回的 planner handoff 仍保持原值。这只保护实验执行壳的内存证据，不是生产持久证据完整性证明。

追问底线：T19 实际消融、T20 重复对比、故障迁移分析和生产开关选择均未完成；T21 才做全量与真实环境验收。
