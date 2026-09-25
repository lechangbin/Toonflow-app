# Agent Harness T20 面经：TopologyPlan 阶段版

1. 问：已经把生产 Agent 改成多 Agent 了吗？答：没有。当前落地的是 T0/T1/T2 版本化 TopologyPlan、角色 Tool/Skill 权限校验、交接载荷与产物所有权校验、等资源结果的最简拓扑选择函数；未接执行器，也未改变生产开关。证据：`src/agentRuntime/topologyPlan.ts`、`tests/topologyPlan.test.ts`。
2. 问：为什么 handoff 只给 Artifact 引用和哈希？答：原始 Prompt 或完整产物跨角色传输会扩大泄露面，还可能绕过共享 Context 的证据边界。当前严格 schema 只接收计划/Context 哈希、role、case、reason 和有限 Artifact 引用；计划内还检查发送者确实拥有该 kind。测试把 `rawPrompt` 塞进去会拒绝；这只是结构性保护，真实运行中的存储授权仍待执行器接入。
3. 问：模型自己指定 planner 的 Tool 和 Skill，能否拿到更多权限？答：不能。`validateTopologyPlan` 需要可信权限目录，逐角色检查请求的 Tool/Skill 是其子集；多一个未授权 Tool 就拒绝整个计划。后续执行每次 Tool 还必须继承既有 Run/Skill/grant 校验，当前计划层不代替运行时授权。
4. 问：什么时候值得用 T2？答：只有 T0、T1、T2 在同一冻结用例、预算和重复 seed 下都跑齐，且 T0/T1 未同时通过预声明的质量、延迟、成本、token、重试和安全硬门，而 T2 全部通过，才有选择 T2 的依据。当前没有这些结果，不能说 T2 优于单 Agent。选择函数返回候选，不自动上线。
5. 问：为什么不做一个综合分选最高？答：安全硬门和成本上限不应被质量分抵消。实现按每个独立阈值和零容忍门判断；证据缺失、预算不同或任何硬门失败，都不能形成采用结论。定向单测验证预算不同会返回 incomplete。

追问底线：T19 实际消融、T20 重复对比、故障迁移分析和生产开关选择均未完成；T21 才做全量与真实环境验收。
