# Agent Harness T12 面经：ContextBundle 的可核验追问

> 技术准备材料，不是简历文案。以下口播只在本人核对实际贡献后使用；“已通过”仅指 T12 定向单测和类型检查，不代表所有 Agent 入口、真实 Provider 或最终发布通过。

## Q1. 为什么要引入 ContextBundle？

**参考回答：** Agent 最后给出正确答案，仍不能证明当时用了哪个 Project 版本、哪些章节和工具结果、是否越过权限或窗口。ContextBuilder 在 Model 调用意图前选择来源并冻结精确消息、预算和 provenance manifest。后续刷新只建后继 Bundle，不改写旧证据。已声明模型容量的只读 Runtime 分支有调用前冻结测试；旧 Socket 路径尚不能声称全覆盖。

**追问：Bundle 与普通聊天记录有何不同？** Bundle 绑定一次 Run/Step/Attempt，来源经过 Project/修订校验，manifest 可指出纳入、省略和投影；聊天记录通常缺少这组调用时点和预算证据。

## Q2. 预算怎么计算，为什么不能直接截断系统提示？

**参考回答：** 先从窗口扣除输出、Tool 协议与安全余量，再与策略上限取较小值。安全约束、权限、工具契约和 Step 意图是强制内容；不足则在推理前失败。剩余容量按风险权重分区，低权威未用额度只可向高权威回流。截断强制内容会让调用在不完整权限前提下继续，属于错误语义。

**追问：UTF-8 字节为何不等于 Token？** 它是模型无关的保守上界，通常偏紧，不能当作某个供应商 tokenizer 的精确统计；未来若换估算器需升版本并保留原 Bundle 的估算版本。

## Q3. 怎样防止跨 Project 来源混入？

**参考回答：** Project/Novel 在数据库查询阶段限定作用域；筛选器先检查 Project、Script、Role、修订与保留状态，再让获准候选参与内容哈希和相关性排序。ToolReceipt 还需同 Run、前置 Step 的成功 Trace 与 Attempt 归属，并复验工具修订、输出 schema 和哈希。一个外部 Project 的损坏候选不应被读取来算其内容是否损坏。

**追问：结果状态是 succeeded 就足够了吗？** 不够。成功状态不能证明来源时间、Step 或 Attempt，甚至可能是损坏关联；需要因果 Trace 与父子身份交叉核验。

## Q4. Tool Result 过长怎么办？

**参考回答：** 完整内容能放下就用完整内容。可选结果超额时，可尝试固定类型投影并明确声明“部分结果”：Novel 正文前 128 个 Unicode code point，或事件前两条及短详情；manifest 记投影哈希、原消息哈希和策略。投影仍超额就省略。必需结果超额直接失败，不能把片段装作完整证据。

**追问：这是不是摘要？** 不是。它是确定性的前缀/头部投影，既没有语义判断也不保证答案相关事实被保留。如果问题依赖尾部，应该让调用方显式定位片段或设计可验证的检索，而非声称该投影“保留重点”。

**追问：为何按 Unicode code point 而非 JS 字符长度截取？** JS 字符串长度是 UTF-16 code unit 数，会把部分补充平面字符切成半个代理项。用 `Array.from` 保持 code-point 边界；但它仍不等于自然语言字、grapheme 或模型 Token。

## Q5. 为什么低权威来源都作为 user 消息？

**参考回答：** Project 文本、Tool 输出和历史回答都可能含有外部内容甚至“忽略以上规则”等提示注入。它们提供证据，不应因曾经由工具或助手产生就升级为系统规则。系统消息仅承载 Runtime 控制的安全、权限与工具契约。这个分层降低权威混淆，但不是提示注入安全性的完整证明。

## Q6. Bundle 持久化有什么隐私与一致性代价？

**参考回答：** 为复核实际 Model 输入，Bundle 表保存精确消息，故必须限定 Project 授权并纳入项目删除生命周期。公开的 manifest 不含正文，只留来源 ID、修订、哈希、位置和选择动作；读取时复验两个哈希及 schema。数据库存储的是应用内项目证据，不等于可随意导出给所有操作员，也不是不可抵赖的密码学审计。

## Q7. 如何向面试官说明现在的完成度？

**参考回答：** 我会把代码能力、定向验证和系统验收分开。T12 分支完成不可变 Bundle、预算与来源筛选，新增可选 Tool 投影；本轮 6 个相关单测及类型检查通过。Memory、Skill、同一步多轮调用、旧 Socket Agent 与无容量 Model 的迁移需要看后续阶段分支及最终 T21 报告，不能把本阶段测试解释为已发布产品的全入口覆盖。

## 源码证据索引

| 主张 | 可核对位置 |
| --- | --- |
| 预算公式与版本 | `src/context/budget.ts`、`tests/contextBudget.test.ts` |
| 资格筛选、投影与 manifest 条目 | `src/context/sourceSelection.ts`、`tests/contextSourceSelection.test.ts` |
| 已提交 Tool 的因果来源 | `src/context/toolSources.ts`、`tests/contextToolSources.test.ts` |
| 冻结、读取与后继 | `src/context/index.ts`、`tests/contextBundle.test.ts` |
| 阶段限制 | `docs/reports/agent-harness-context-68-progress.md`、`docs/adr/0019-build-context-bundles-before-model-intent.md` |
