# Agent Harness T13 · Project Memory（阶段进度）

Issue：`lechangbin/Toonflow-app#69`。本分支堆叠在尚未验收的 T12 ContextBuilder 分支上；这里描述的只是一条来源可核验的 Memory 切片，不代表 T13 完成。

## 已实现

- 领域术语与 ADR-0020 区分新 `Agent Memory` 和旧 Socket `memories`：客户端隔离键不能代替 Project 授权或提交证明，旧表保持兼容且不会自动晋升到新 Context。
- 新 `o_agentProjectMemory` 持久化 Project、可选 Script、角色、来源 Run/Step/Output、来源哈希、Unicode code-point 起止位置、内容哈希、修订、置信类型和生命周期状态。当前唯一支持的类型是 `source-excerpt`，置信类型为 `source-verbatim`；尚不生成模型摘要或声称结构化事实已得到外部验证。
- 捕获前在同一 SQLite 事务内校验 Project 所有权、成功 Step 和 Attempt、`step-committed` Checkpoint 的 payload/hash、Output schema/hash及安全文本，截取范围必须完全落在已提交 Output 内。重复捕获同一范围返回原记录，冲突拒绝。流片段、失败 Attempt、未提交 Tool 结果均不能走此捕获入口。
- ContextBuilder 可显式请求 Memory ID；新加载器先以 Project、角色、Script、active 状态过滤，再复验来源 Run、Step、Attempt、Output、Checkpoint、内容修订和片段位置，才将其作为低权威 `user` 数据消息纳入预算与无原文 manifest。高风险请求走同一严格校验；缺失的必需 Memory 会在 Model 调用前失败。来源完整性变更后拒绝继续使用旧 Memory。
- Project 删除事务先清理新 Memory，再删除其来源 Output 和 Run；生成的数据库类型声明已同步。
- Memory 内容与来源字段由 SQLite 触发器禁止改写；只有带预期修订和幂等 command ID 的显式 `active → revoked` 转换可改变生命周期。正常删除被阻止，Project 删除事务持有证据删除许可时例外；被撤销的 Memory 不再进入 Context。

## 阶段验证与未完成边界

`tests/projectMemory.test.ts` 的 2 个定向用例使用真实 SQLite 和 Fake Model 验证：未提交来源拒绝、成功 Output 片段定位、重复捕获、跨 Project 拒绝、旧表不自动晋升、高风险 ContextBundle 纳入、来源哈希或 Attempt 状态损坏时读取失败、撤销幂等及不同命令冲突、不可改写与 Project 删除，以及旧库新增表时保留 Project 和 Socket Memory。所依赖的 T12 Context 17 个定向用例此前通过；本增量的 2 个 Memory 单测与 TypeScript `--noEmit` 通过。未运行全量测试、构建、浏览器或真实 Provider。

尚未实现摘要来源图、多来源聚合、语义检索、置信度晋升、旧 Memory 的逐条可验证迁移，以及 Script/Production 旧 Socket Agent 迁移。当前 `source-excerpt` 只证明文本来自某次成功 Agent 输出，不证明该输出的业务事实真实；面试时不能把它表述成已验证知识库或已完成跨 Agent Memory 治理。

## 阶段追问准备（非最终面经）

1. 问：为什么旧 Memory 的隔离键不足以保证 Project 安全？答：旧 Socket Agent 接受客户端传入的 `isolationKey`，按字符串查询旧表；这个字符串并不证明对应行来自当前 Project 的某个成功 Run，也不证明其摘要引用的消息已提交。因此新 Memory 先从数据库中同 Project 的 Run、Step、Attempt、Output 和提交 Checkpoint 反向证明来源，再写入明确 Project ID。升级时旧行保留给旧界面，但不会自动作为 ContextBuilder 候选。
2. 问：怎样防止失败或部分输出变成长期记忆？答：捕获只接受 `assistant-text` 的完整 Output，并在同一事务中核对 Step 与 Attempt 均成功、`step-committed` Checkpoint 的 payload/hash 指向该 Output、Output 本身的 schema 与哈希有效。流式 token、失败 Attempt 和未提交 Tool 结果没有这组证据，无法走该入口。读取时再次核验来源，测试还模拟了 Output 哈希和 Attempt 状态被破坏后的拒绝。
3. 问：为什么把这种 Memory 称为来源可核验而不是事实已验证？答：目前内容是成功 Agent 输出中的逐字片段，起止位置、原文哈希和内容修订可证明“它从哪里来”，却不能证明模型回答的业务事实正确。Context 中它始终是低权威数据，不能替代当前 Project 事实或直接 Script 证据。后续需要逐条来源图、摘要审查和事实验证，才有资格提高置信等级。
