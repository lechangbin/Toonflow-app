# Agent Harness T20 导学：多 Agent 拓扑的权限与交接契约

> 当前仅为类型和校验层；没有生产多 Agent 执行，也没有性能/质量结论。简历由用户自行完成，完整验收留到 T21。

阅读入口：`src/agentRuntime/topologyPlan.ts`、`src/agentRuntime/topologySimulation.ts`，定向证据：`tests/topologyPlan.test.ts`、`tests/topologySimulation.test.ts`，阶段记录：`docs/reports/agent-harness-topology-76-progress.md`。

先比较 T0、T1、T2 的角色序列和 handoff 数，再看 `validateTopologyPlan` 如何拒绝超出角色权限目录的 Tool/Skill、重复 Artifact Owner 和错误的最终产物 Owner。接着看 `validateTopologyHandoff`：交接消息携带引用和哈希，不含正文；即使 payload 字段通过类型检查，也必须匹配具体计划的边、发送者所有权和大小限制。最后看 `chooseSimplestTopology` 如何在三种拓扑证据齐全、资源相同且所有独立阈值达标时选择最简单候选。

确定性执行壳逐角色给出 Skill 白名单，Tool 调用必须经过受限 port，产物和下一跳再过契约校验；T2 的 verifier 必须给出 verification 和 final。后续角色只拿已记录 handoff 的隔离副本，无法通过修改自己的输入篡改先前的记录。它只用于假角色试验，不是可持久恢复的生产 AgentRun，也不能防止 handler 绕过 port 直接访问系统。

自测：画出 T2 的 planner→specialist→verifier 并标明谁拥有 plan/candidate/final；解释为什么不能让 specialist 把不属于自己的 Artifact 放入交接；说明单条高质量样例不能替代相同用例、预算和重复 seed；指出当前还没有执行器和实测结果。
