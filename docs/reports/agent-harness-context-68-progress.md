# Agent Harness T12 · ContextBundle 构造（阶段进度）

Issue：`lechangbin/Toonflow-app#68`。本报告描述预算与来源规划基础，不代表 ContextBuilder、Agent 迁移或 T21 验收完成。

## 已实现

- `ContextBundle` 加入领域术语表，ADR-0019 固定“先构造并冻结、再提交 Model 调用意图”的决策；旧 Socket Agent 尚未迁移。
- 版本化预算规划按 `min(策略上限, 模型窗口 - 输出预留 - Tool 协议预留 - max(512, 5% 模型窗口))` 计算；先完整保留强制内容，再按普通 45/20/20/15、高风险 60/25/10/5 分配可选内容。低权威类别未用额度仅向高权威类别流动；强制内容溢出在调用前失败。
- 版本化保守 UTF-8 字节估算器、确定性的来源资格筛选与排序：Project、Script、Role、修订、保留状态在相关性排序前检查；来源内容哈希冲突或必需来源缺失均拒绝。规划结果仅保留来源身份、修订、哈希、类别、权威、Token 估算和省略原因，不把原文写进清单条目。
- Project/Novel 来源由同一 SQLite Project 过滤查询加载，跨 Project Novel ID 在读取阶段即不可见；源文本的敏感值检查在构造来源前失败。`createContextBuilder().build()` 校验 Run/Step/准备中的 Attempt 身份，在一个事务中选源、预算规划并冻结精确的 Model 消息与无原文 manifest。Bundle 不可更新或随意删除，同一 Attempt 只能绑定一份；Project 删除事务使用现有证据删除许可清理它。
- 已提交的只读 ToolReceipt 可作为候选 Tool Result：按同一 Project Run 读取、复验 Tool 修订、输出哈希、输出 schema 与安全文本；未完成、失败或其他 Run 的 Receipt 不会进入候选集合。尚未建立“此 Receipt 早于当前 Model Step”的因果序号约束，因此未宣称完整的后续 Step 投影。
- `inspect` 按 Project 授权读取已冻结 Bundle，复验 manifest 与精确消息的哈希和 schema；其他 Project 得到空结果。旧数据库补建 Bundle 表时保留已有 Project。

## 阶段验证与边界

五个 `tests/context*.test.ts` 文件的 11 个定向用例覆盖预算公式、风险配比、向上回流、强制内容溢出、跨 Project/Script 筛选、修订与保留状态、损坏/冲突来源、分配不足时不截断、真实 SQLite 来源读取、已提交 ToolReceipt 筛选、准备中 Agent Attempt 的不可变 Bundle、Project 授权读取与删除生命周期，以及旧库增表。TypeScript `--noEmit` 检查通过；未运行全量测试、构建、浏览器或真实 Provider。

目前 Builder 只装载 Project 概览和指定 Novel Chapter；Tool Result、近期交互、Memory、Skill 指令、完整压缩链、总结 provenance、显式刷新以及模型配置中真实上下文窗口的解析仍待完成。现有 AgentRuntime 尚未把 Bundle 接入 Model 调用前的意图提交，旧 Socket Agent 更未迁移。测试证明了 Builder 的本地契约，不是端到端防泄漏或 Agent 迁移验收。下一切片须先明确可用 Model 上下文窗口来源，再接 Runtime 调用；不能把任意默认窗口伪装为模型能力。
