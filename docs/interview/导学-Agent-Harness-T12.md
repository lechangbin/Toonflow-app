# Agent Harness T12 导学：ContextBundle 与预算化证据

> 岗位方向：Agent Harness 优先，Agent 应用开发其次，AI 应用后端为补充；不面向算法岗。本文是 T12 分支的源码学习路径，不生成简历文字。当前仅有阶段单测；不可说成整个 Agent 系统或版本发布已验收。

## 前置知识与阅读顺序

| 顺序 | 知识点 | 源码入口 | 学完要能回答 |
| --- | --- | --- | --- |
| 1 | Model 上下文窗口、输出/Tool 预留与保守 Token 估算 | `src/context/budget.ts` | 为什么强制内容优先、为什么低权威未用额度只能向上回流 |
| 2 | 数据与指令权威分离 | `docs/adr/0019-build-context-bundles-before-model-intent.md`、`src/context/index.ts` | 为什么 Project/Tool/历史回答都作为 `user` 数据而非 `system` 指令 |
| 3 | Project/修订/保留状态过滤 | `src/context/projectSources.ts`、`src/context/sourceSelection.ts` | 为何过滤要在排序和内容哈希检查之前 |
| 4 | ToolReceipt 因果来源 | `src/context/toolSources.ts`、`src/agentRuntime/causalTrace.ts` | 如何证明一份结果确实属于前置 Step 的已提交 Tool 操作 |
| 5 | 不可变 Bundle | `src/context/index.ts`、`tests/contextBundle.test.ts` | 什么在 Model 意图前冻结，后继 Bundle 如何避免改写历史 |
| 6 | 投影与降级 | `src/context/sourceSelection.ts`、`tests/contextSourceSelection.test.ts` | 完整证据、部分证据和省略各在什么条件下出现 |

## 项目问题与核心机制

原来逐处拼装提示词，既难证明一次 Model 调用看到了哪个 Project 修订，也难回答“长章节/Tool 输出被裁掉多少”。T12 引入 `createContextBuilder().build()`：先核对 Run、Step、准备中的 Attempt 和 Project 范围；同一 SQLite 事务加载候选来源、规划预算、筛选与排序、冻结精确消息和无正文的 manifest。已声明容量的只读 Runtime 分支使用冻结消息调用 Model；强制约束超预算时在调用前失败。

预算公式为 `min(policyMaxInput, contextWindow - outputReserve - toolReserve - max(512, ceil(5% * contextWindow)))`。扣除强制内容后，普通风险按 45/20/20/15、高风险按 60/25/10/5 分给权威资料、Tool Result、近期交互、Memory。估算器当前按 UTF-8 字节保守估算，不等同于特定模型真实 tokenizer；应说明可能牺牲可用容量。

来源选择先检查 Project、Script、Role、修订和保留状态，再验证获准来源的内容哈希并按权威和相关性排序。章节可以显式指定 Unicode code-point 范围，manifest 留原文哈希和片段位置；目录记录分页。Tool 来源必须是同 Project Run、前置 Step、已成功提交且有因果 Trace 的 Receipt，复验工具修订、输出哈希、schema 与安全文本。近期交互也只从同作用域、已完成且早于当前 Run 的输出进入。

可选 Tool Result 完整内容超出分区余额时，先尝试固定类型投影：章节正文前 128 个 code point，或前两条事件及详情前 80 个 code point。投影消息明确声明不完整，manifest 记录投影内容哈希、完整来源哈希、策略与 `tool-projection` 动作；若仍超额则省略。必需 Tool 结果不自动降级。固定前缀不是语义摘要，可能遗漏真正相关的尾部信息。

## 设计取舍与追问线索

| 决策 | 备选与代价 | 当前证据 |
| --- | --- | --- |
| 调用前冻结而非事后记录答案 | 事后无法复原当时来源与预算 | `tests/contextBundle.test.ts` 验证 Bundle 在 Fake Model 调用前已持久化 |
| 必需内容超额失败 | 静默截断会改变任务语义 | `tests/contextBudget.test.ts` 与 `contextSourceSelection.test.ts` |
| 低权威结果只做数据消息 | 直接当系统提示会抬高提示注入权威 | Bundle 消息角色断言 |
| 可选 Tool 固定投影 | 整条省略损失更多信息；前缀又可能遗漏关键事实 | 本轮 6 个定向用例覆盖选择、哈希、必需失败与来源校验 |
| 缺失容量走显式兼容分支 | 猜一个默认窗口可能造成截断或误判 | `src/agentRuntime/index.ts` 与容量定向测试 |

## 自检题

1. 手算一个 4,000 token 窗口、500 输出预留、100 Tool 预留、200 强制内容的普通风险预算，并说明类别溢出时是否可从更高权威类别借额。
2. 同一 ToolReceipt 有成功状态但没有属于前置 Step 的成功 Trace，是否能进入 Bundle？为什么？
3. 一条必需 Tool 结果完整内容超额、投影恰好可放下，Model 会收到什么？
4. 为什么 manifest 保存原完整消息哈希，却不保存原正文？精确消息保存在哪里，谁可读取？
5. 固定前缀投影可能导致什么错误？如何设计显式的定位请求作为后续演进？

## 验证边界与后续学习

本轮 `contextSourceSelection`、`contextToolSources` 共 6 个定向单测及 `tsc --noEmit` 通过；不代表真实 Provider、全部旧 Socket Agent、同一 Step 多轮调用或跨进程恢复已验收。继续阅读 `docs/reports/agent-harness-context-68-progress.md` 与 T13 Memory、T14 Skill、T15 执行路径阶段材料，最后再用 T21 的系统验收证据回答覆盖率问题。若某个文件看不懂，可逐段向 AI 提问并自行复述，不要背诵超出个人参与和已验证范围的表述。
