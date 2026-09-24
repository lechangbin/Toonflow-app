# Agent Harness T13 · Project Memory（阶段进度）

Issue：`lechangbin/Toonflow-app#69`。本分支堆叠在尚未验收的 T12 ContextBuilder 分支上；这里描述的只是一条来源可核验的 Memory 切片，不代表 T13 完成。

## 已实现

- 领域术语与 ADR-0020 区分新 `Agent Memory` 和旧 Socket `memories`：客户端隔离键不能代替 Project 授权或提交证明，旧表保持兼容且不会自动晋升到新 Context。
- 新 `o_agentProjectMemory` 持久化 Project、可选 Script、角色、来源 Run/Step/Output、来源哈希、Unicode code-point 起止位置、内容哈希、修订、置信类型和生命周期状态。当前唯一支持的类型是 `source-excerpt`，置信类型为 `source-verbatim`；尚不生成模型摘要或声称结构化事实已得到外部验证。
- 捕获前在同一 SQLite 事务内校验 Project 所有权、成功 Step 和 Attempt、`step-committed` Checkpoint 的 payload/hash、Output schema/hash及安全文本，截取范围必须完全落在已提交 Output 内。重复捕获同一范围返回原记录，冲突拒绝。流片段、失败 Attempt、未提交 Tool 结果均不能走此捕获入口。
- ContextBuilder 可显式请求 Memory ID；新加载器先以 Project、角色、Script、active 状态过滤，再复验来源 Run、Step、Attempt、Output、Checkpoint、内容修订和片段位置，才将其作为低权威 `user` 数据消息纳入预算与无原文 manifest。高风险请求走同一严格校验；缺失的必需 Memory 会在 Model 调用前失败。来源完整性变更后拒绝继续使用旧 Memory。
- Project 删除事务先清理新 Memory，再删除其来源 Output 和 Run；生成的数据库类型声明已同步。

## 阶段验证与未完成边界

`tests/projectMemory.test.ts` 的 1 个定向用例使用真实 SQLite 和 Fake Model 验证：未提交来源拒绝、成功 Output 片段定位、重复捕获、跨 Project 拒绝、旧表不自动晋升、高风险 ContextBundle 纳入、来源哈希或 Attempt 状态损坏时读取失败。连同所依赖的 T12 Context 用例共 18 个定向单测以及 TypeScript `--noEmit` 通过。未运行全量测试、构建、浏览器或真实 Provider。

尚未实现摘要来源图、多来源聚合、语义检索、置信度晋升/撤销流程、旧 Memory 的逐条可验证迁移，以及 Script/Production 旧 Socket Agent 迁移。当前 `source-excerpt` 只证明文本来自某次成功 Agent 输出，不证明该输出的业务事实真实；面试时不能把它表述成已验证知识库或已完成跨 Agent Memory 治理。
