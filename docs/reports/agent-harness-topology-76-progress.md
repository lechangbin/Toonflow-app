# Agent Harness T20 · TopologyPlan 与多 Agent 消融（阶段进度）

Issue：`lechangbin/Toonflow-app#76`。此分支叠在 T19 评测契约分支上；目前没有运行 T0/T1/T2，也没有启用多 Agent 生产链路或做采用决策。

`src/agentRuntime/topologyPlan.ts` 定义版本化 T0 单 worker、T1 planner→worker、T2 planner→specialist→verifier 的角色与交接形状。每个角色的 Tool/Skill 列表必须落在可信权限目录内，Artifact kind 只能有一个 Owner，最终产物必须由对应 worker 或 verifier 拥有。每条交接只携带有哈希的 Artifact 引用、Context Bundle 哈希和受限 reason，不允许原始 Prompt/产物正文；校验发送者所有权、计划哈希、允许的边和字节上限。停止条件限定 handoff 数、Tool 调用与总时长，聚合方式随拓扑固定。

另有独立指标排序函数：只有三种拓扑对同一 case manifest、同一预算、同一重复 seed 数运行且均无缺失时，才逐项检查质量、延迟、成本、token、重试和硬门，并找出第一个指标达标的最简单拓扑；T0 未过才看 T1，T1 未过才看 T2。但目前输入没有独立核验的生产 Run/评审来源，函数只返回 `unverified` 与 `thresholdCandidate`，正式 `topology` 始终为 `null`，不会修改生产开关。不能宣称 T0/T1/T2 谁优或推荐采用。

等资源校验补充：仅比较重复 seed 的数量不足以保证相同样本，选择函数现还要求三组 `seedSetHash` 完全一致；即使数量相同但 seed 集不同，也返回 incomplete。定向测试覆盖该反例。正式结果仍需 T19 执行器生成并校验 hash，当前只是汇总证据的拒绝规则。

确定性角色执行壳补充：`topologySimulation` 接受注入的角色 handler 和 Tool port，逐角色传入其 Skill 白名单，`invokeTool` 在触达 port 前检查角色 Tool 许可和全局调用预算；每次输出只允许有哈希的本角色 Artifact 引用，生成下一跳时再按 TopologyPlan 校验边、所有权和大小。T2 最终要求 verifier 同时给出 verification 与 final。传给下一角色的是已记录 handoff 的隔离副本，handler 不能回写已记录的前序证据。3 个假角色单测覆盖两次交接、越权 Tool 零调用、rawPrompt 字段拒绝及迟后修改前序 handoff；连同原 4 个拓扑契约用例和 App TypeScript 检查通过。它不接生产 AgentRun、数据库租约或真实 Vendor，也不能约束恶意 handler 自行调用外部系统；生产可用性与等资源测量仍未实现。

定向验证：`tests/topologyPlan.test.ts` 的 4 例覆盖三种拓扑、角色越权、Artifact 所有权、恶意 handoff payload、计划哈希和等资源选择；App TypeScript 检查通过。未跑实际多 Agent、Golden Eval、全量套件、浏览器或真实 Provider。后续必须接入 T19 冻结 case/结果体系，跑重复等资源对比和逐例故障迁移，发布不可变结果后才可决定生产拓扑；T21 做最终验收。

采用语义补强：T19 已将 Fake 指标的 `adoptable` 固定为 false，T20 同步把纯指标排序结果从 `candidate` 改为 `unverified`；测试即便提供三组全通过布尔量，仍只得到未核验阈值候选，不获得正式拓扑选择。7 个 T20 定向测试与 TypeScript 检查通过，真实来源核验仍待 T11/T19。
