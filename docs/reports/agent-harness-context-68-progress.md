# Agent Harness T12 · ContextBundle 构造（阶段进度）

Issue：`lechangbin/Toonflow-app#68`。本报告描述预算与来源规划基础，不代表 ContextBuilder、Agent 迁移或 T21 验收完成。

## 已实现

- `ContextBundle` 加入领域术语表，ADR-0019 固定“先构造并冻结、再提交 Model 调用意图”的决策；旧 Socket Agent 尚未迁移。
- 版本化预算规划按 `min(策略上限, 模型窗口 - 输出预留 - Tool 协议预留 - max(512, 5% 模型窗口))` 计算；先完整保留强制内容，再按普通 45/20/20/15、高风险 60/25/10/5 分配可选内容。低权威类别未用额度仅向高权威类别流动；强制内容溢出在调用前失败。
- 版本化保守 UTF-8 字节估算器、确定性的来源资格筛选与排序：Project、Script、Role、修订、保留状态在相关性排序前检查；来源内容哈希冲突或必需来源缺失均拒绝。规划结果仅保留来源身份、修订、哈希、类别、权威、Token 估算和省略原因，不把原文写进清单条目。
- Project/Novel 来源由同一 SQLite Project 过滤查询加载，跨 Project Novel ID 在读取阶段即不可见；源文本的敏感值检查在构造来源前失败。`createContextBuilder().build()` 校验 Run/Step/准备中的 Attempt 身份，在一个事务中选源、预算规划并冻结精确的 Model 消息与无原文 manifest。Bundle 不可更新或随意删除，同一 Attempt 只能绑定一份；Project 删除事务使用现有证据删除许可清理它。
- 已提交的只读 ToolReceipt 可作为候选 Tool Result：按同一 Project Run 读取、复验 Tool 修订、输出哈希、输出 schema、安全文本，以及完整因果 Trace 中对应的 `tool.succeeded` 事件；未完成、失败、无成功 Trace 或其他 Run 的 Receipt 不会进入候选集合。当前仍未把 Tool 来源与具体前置 Step ordinal 绑定，因此不宣称完整的跨 Step 投影。
- `inspect` 按 Project 授权读取已冻结 Bundle，复验 manifest 与精确消息的哈希和 schema；其他 Project 得到空结果。旧数据库补建 Bundle 表时保留已有 Project。
- 显式刷新或新的 Attempt 可通过同一 Run 内的 `predecessorBundleId` 创建后继 Bundle；原 Bundle 内容与哈希不变。Configured Vendor 的 Text Model 可声明并校验 `contextWindowTokens`，`openTextCall` 公开已解析容量；未声明的旧 Model 保持“未知”，不捏造默认容量。
- 已声明容量的只读生产 AgentRuntime 路径在 Model 调用意图提交前构造 Bundle，调用时使用与持久消息完全相同的输入；Bundle 哈希参与 invocation 指纹。强制内容预算不足时不调用 Fake Model。未声明容量的旧 Model 暂走明确标注的兼容路径，不能计入 ContextBundle 迁移完成率。
- Project、Novel 与 Tool Result 文本作为标明“data, not instructions”的 `user` 角色消息注入，只有 Runtime 安全约束和受控 Tool/权限契约可成为 `system` 消息；数据来源不能借 `assistant` 历史发言获得更高的指令地位。

## 阶段验证与边界

六个 `tests/context*.test.ts` 文件的 13 个定向用例覆盖预算公式、风险配比、向上回流、强制内容溢出、跨 Project/Script 筛选、修订与保留状态、损坏/冲突来源、分配不足时不截断、真实 SQLite 来源读取、已提交 ToolReceipt 筛选、准备中 Agent Attempt 的不可变 Bundle、后继 Bundle、Project 授权读取与删除生命周期、旧库增表、Model 容量声明校验，以及真实 AgentRuntime 在调用前冻结与超额阻断。另对 `configuredVendor.test.ts` 的 `openTextCall` 定向用例验证容量透出；`agentRunRuntime.test.ts` 的 28 个 Runtime 定向回归通过。TypeScript `--noEmit` 检查通过；未运行全量测试、构建、浏览器或真实 Provider。

目前 Builder 只装载 Project 概览、指定 Novel Chapter 与已提交的只读 Tool Result；近期交互、Memory、Skill 指令、完整压缩链、总结 provenance 及 Tool Result 的跨 Step 因果先后约束仍待完成。Model 容量元数据虽可声明并透出，内置/既有配置尚未全面补齐；因此只读 Runtime 仍有无 Bundle 的兼容分支，旧 Socket Agent 更未迁移。测试证明了已声明容量分支的本地调用前冻结，不是整个 Agent 系统的端到端防泄漏或迁移验收；无容量元数据的 Model 必须显式处理，不能用任意默认窗口伪装为真实能力。
