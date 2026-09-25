# Agent Harness T20 · TopologyPlan 与多 Agent 消融（阶段进度）

Issue：`lechangbin/Toonflow-app#76`。此分支叠在 T19 评测契约分支上；目前没有运行 T0/T1/T2，也没有启用多 Agent 生产链路或做采用决策。

`src/agentRuntime/topologyPlan.ts` 定义版本化 T0 单 worker、T1 planner→worker、T2 planner→specialist→verifier 的角色与交接形状。每个角色的 Tool/Skill 列表必须落在可信权限目录内，Artifact kind 只能有一个 Owner，最终产物必须由对应 worker 或 verifier 拥有。每条交接只携带有哈希的 Artifact 引用、Context Bundle 哈希和受限 reason，不允许原始 Prompt/产物正文；校验发送者所有权、计划哈希、允许的边和字节上限。停止条件限定 handoff 数、Tool 调用与总时长，聚合方式随拓扑固定。

另有独立比较选择函数：只有三种拓扑对同一 case manifest、同一预算、同一重复 seed 数运行且均无缺失时，才逐项检查质量、延迟、成本、token、重试和硬门，并选择第一个全部达标的最简单拓扑；T0 未过才看 T1，T1 未过才看 T2。此函数只返回候选，不修改生产开关。当前输入尚无真实评测执行器或结果，因此不能宣称 T0/T1/T2 谁优。

定向验证：`tests/topologyPlan.test.ts` 的 4 例覆盖三种拓扑、角色越权、Artifact 所有权、恶意 handoff payload、计划哈希和等资源选择；App TypeScript 检查通过。未跑实际多 Agent、Golden Eval、全量套件、浏览器或真实 Provider。后续必须接入 T19 冻结 case/结果体系，跑重复等资源对比和逐例故障迁移，发布不可变结果后才可决定生产拓扑；T21 做最终验收。
