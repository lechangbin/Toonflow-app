# Agent Harness T12 面经：ContextBundle 证据边界（阶段版）

> 本文件只准备已实现基础能力的追问，不提供简历 bullet；简历由用户自行完成。T12 #68 未关闭，全量验收与真实 Provider 行为未验证。回答中“我”的具体职责强度需用户依据提交记录确认，不能把整个团队或跨阶段成果据为己有。

## 项目背景与回答主线

ToonFlow 的 Agent 需要读取 Project、Novel Chapter、Tool 结果和历史交互。T12 的工程问题是：这些来源既可能越权或过时，也可能挤占 Model 窗口；若每次临时拼接，重试和恢复时无法证明 Model 看到了什么。阶段实现把授权筛选、预算规划和一次 Attempt 的输入冻结放进同一 ContextBuilder 边界。它不是检索质量优化报告，也没有证明所有旧 Agent 已迁移。

## 高频主问与追问

1. 问：为什么需要 ContextBundle，而不是在调用 Model 前拼字符串？答：临时拼接会让 Project 数据、历史消息和系统约束混在一起，来源修改后同一请求也可能得到不同输入。T12 把选中的精确消息和来源清单绑定到一个 Attempt，调用前落库，重读时校验哈希。这样能解释“某次模型究竟看了什么”，但目前只覆盖已接入的 Runtime 路径，旧 Socket Agent 仍并行，不能宣称全系统输入可复现。追问：Bundle 和 Trace 为何分开？答：Bundle 受 Project 权限保护且保存精确输入，Trace 只需安全事件与来源身份；若把原文复制进 Trace，会扩大泄漏面。
2. 问：预算公式如何避免 Tool 和安全约束被资料挤掉？答：先从已声明的 Model 窗口扣除输出、Tool 协议与安全余量，再与策略上限取较小值；强制内容完整计入，放不下就拒绝 Model 调用。剩余空间才分给可选来源。T12 单测覆盖强制内容溢出及调用前失败；没有真实供应商的上下文窗口实测，不能报绝对 Token 利用率。追问：为什么不直接截断强制内容？答：截断后权限和审批边界可能失义，宁可失败也不能让半条约束进入模型。
3. 问：普通与高风险配比有什么区别？答：普通请求对可选来源按 45/20/20/15 分配，高风险按 60/25/10/5 调高高权威来源占比；这发生在必需内容完整保留之后。未用低权威额度只向高权威类别流动，避免历史聊天反客为主。测试证明计算与溢出规则，但配比是当前策略，不是通过业务 Eval 证明的最优值。追问：如何调整配比？答：应在冻结 case 与相同预算下成对评测硬门、质量和成本，而不是根据单次好回答直接改。
4. 问：为什么必须先按 Project 过滤再做相关性排序？答：如果越权来源先进入检索、哈希或排序，即使最后不展示，它仍已被处理，且可能影响排序结果或诊断信息。T12 先检查 Project、Script、Role、修订和保留状态，再计算内容完整性及相关性；跨 Project Novel 在数据库查询阶段就不可见。定向测试覆盖损坏的跨 Project 候选不会被当成可用内容。追问：这是否证明不会泄漏？答：只证明这条受控筛选路径，其他旧 Socket 或未迁移入口需要单独审计。
5. 问：强制来源缺失时为什么不降级继续回答？答：若 Run 明确要求某章节或约束，缺失后继续推理会把“无证据”伪装成“已看过来源”。Builder 在调用前拒绝缺失或版本不匹配，留下可解释的失败，而不是让模型猜测。测试包含必需来源失踪、超预算、跨作用域等路径；对于可选资料则记录省略原因，允许在契约内继续。追问：用户该看到什么？答：应看到来源不可用或需刷新，不应收到像正常完成一样的生成结果。
6. 问：Context manifest 为什么不直接存所有正文？答：精确消息需要保存以便检查同一次 Attempt，但可导出的来源清单只要身份、修订、哈希、Token 估算和省略原因。这样诊断时可以说明选择过程而不重复扩散小说或模型输入。Bundle 本身仍含敏感 Project 数据，不能称“零原文存储”；读取需要 Project 授权，删除受证据生命周期约束。追问：哈希能代替内容吗？答：不能，哈希只证明比对一致，不能重建语义或自动判断事实正确。
7. 问：Model 容量未知时为何不填默认窗口？答：不同 Vendor/Model 的实际窗口与预留策略可能不同，编造默认值会让预算检查看似通过却在供应商处失败。T12 对声明容量的路径冻结 Bundle；无声明的旧模型保留显式兼容分支，并在进度报告中列为未迁移。T16 的 Skill 模式进一步要求容量，不能把这个后续限制倒写成 T12 全部路径已强制。追问：兼容分支怎样退出？答：逐个补可信容量元数据，跑对应契约与真实供应商验收，再移除回退。
8. 问：章节太长时怎样避免静默截断？答：Project 来源加载器支持明确的章节目录分页与 Unicode code-point 片段定位；清单记录片段边界和完整章节哈希。请求的范围越界直接拒绝，未指定片段时仍按整章预算处理，必需整章超额不能悄悄砍掉尾部。测试覆盖分页、越界和元数据改变导致的修订失效。追问：为什么用 code point 而不是 UTF-16 下标？答：它减少代理项字符造成的位置歧义，但仍须用测试验证跨语言文本。
9. 问：旧 ToolReceipt 为什么不能直接塞进 Context？答：Tool 的结果只有在同 Project、已提交、schema/哈希有效且因果 Trace 证明成功，并且来自当前 Model Step 之前的 Step，才有资格做候选。失败、pending、其他 Run 或未来 Step 不能被倒灌进预调用输入。当前同一步内多轮 Tool/Model 交错的恢复投影尚未实现，因此不能说所有 Tool 历史都已安全迁移。追问：为何还要查 Trace？答：单独的回执字段不能证明成功事件与 Run 因果链完整。
10. 问：历史回答为什么以低权威数据进入？答：历史 Agent 输出可以提供连续性，但它可能是模型误判或被用户上下文污染，不能变成系统指令。加载器限定同 Project、同 Script、同 Role/Scope、先完成且有有效输出的有限组历史 Run，并将内容放在标记为数据的 user 消息中。这样保留可参考信息，不赋予旧回答新的权限。追问：最多十组是否最优？答：这是当前上限，质量与成本效果待 Golden 对照测量。
11. 问：刷新 Context 为什么必须写 successor Bundle？答：若就地改写前一个 Bundle，已经提交的 Model Attempt 会失去原输入证据，重试无法说明当时见到的来源。后继只能引用更早 Step 或同 Step 更早 Attempt 的 Bundle，原记录与哈希保持不变。定向测试覆盖自指、未来引用与正常后继；这证明本地因果约束，不等于真实进程重启全链路通过。追问：后继会自动继承一切吗？答：不会，仍需按当前授权与来源修订重新选择并明确记录变化。
12. 问：如何证明模型收到的消息与数据库冻结的相同？答：已声明容量的只读 AgentRuntime 在提交 Model 调用意图前构造 Bundle，调用时使用其持久精确消息，Bundle 哈希也参与调用指纹。测试用假 Model 观察输入，并让必需内容超预算时确认模型零调用。它是本地可核验接线，不证明真实 Provider 收包、费用或浏览器重连。追问：为何要在调用意图前？答：相反顺序会产生“可能已外发、但无输入证据”的窗口。
13. 问：数据来源怎样防 prompt injection？答：T12 不宣称彻底解决提示词注入，而是先做权威隔离：Runtime 安全约束和受控 Tool/权限契约才进入高权威消息，Project/Novel/Tool 文本标成数据，以低权威 user 消息送入。来源授权、长度和安全文本检查减少污染面；模型仍可能受内容影响，需在 T11 安全 Golden case 和 T21 跨边界验收中检验。追问：是否可以靠一句“忽略恶意内容”解决？答：不能，关键是结构化角色边界和外部效果授权。
14. 问：ContextBuilder 与 Memory、Skill 的关系是什么？答：T12 先提供预算、筛选、冻结骨架；T13 才将来源可核验的 Memory 作为低权威候选接入，T16 才在生产指导 Run 中读取冻结 Skill 指令并占用强制预算。不能把后续能力归为 T12 一次性交付，也不能把旧 Socket Memory 自动算成可信来源。追问：如果 Skill 被撤销？答：后续运行应按已冻结修订和当前安全策略复核，不能仅重读激活指针。
15. 问：目前最重要的未完成项是什么？答：ContextBuilder 已覆盖 Project 概览、章节、前置 Tool 结果、近期交互和后续接入的 Memory/Skill 局部路径；但旧 Socket Agent、未知容量模型、同 Step 多轮恢复、完整 App/Web 行为和真实 Provider 尚未统一验收。面试中我会把“定向契约通过”和“全部 Agent 输入可复现”分开，前者有测试证据，后者仍待 T16–T21 收敛。追问：怎么验收？答：冻结 App/Web/模型修订，测试断连重启、来源漂移、预算失败、跨 Project 拒绝及 Golden 硬门，再记录明确分母。
16. 问：既然已有成功的 Tool 回执，为什么还要为它记录 Step 和 Attempt？答：我检查 Context 的 Tool 来源接线时发现，来源加载器需要成功 Trace 指向当前 Step 之前的 Step，但真实受控 Tool 路径过去没有把执行时的 Step/Attempt 写入 Trace。只看回执成功状态，无法证明结果产生于哪次尝试，也无法阻止同一 operation 在另一 Attempt 中被当成原执行来重放。因此这轮把运行时已经持有的身份传到 Tool 边界，在开始与终态事件写入因果身份，重放时再对照原始事件；来源读取时又从 Attempt 表复核它确属同一 Run 的前置 Step。定向测试让真实 Tool 完成后建立后续 Step，并注入跨 Step/Run 的损坏身份，分别验证选中与拒绝；这不是多轮 Model 调度或进程恢复的端到端验收。追问：旧的无身份 Tool 调用怎么办？答：我没有让旧调用突然失效，而是把身份字段设为成对可选；无身份调用仍按原契约执行，但因为缺少前置 Step 的因果证据，它的回执不会被新 Context 来源加载器误认为可用。新调用必须同时提供有效 Step 和 Attempt，并归属于正在运行的同一 Run；如果另一 Attempt 复用相同 operation，就判定身份冲突。这样既保留旧接口兼容，又避免把未知来源的结果提升为可冻结的上下文证据。实际恢复与终态后的重放策略仍需单独验证。

## 源码证据索引

| 主题 | 关键路径与符号 | 正文位置 |
| --- | --- | --- |
| 预算 | `src/context/budget.ts`、`planContextBudget` | 2–3 |
| 资格与排序 | `src/context/sourceSelection.ts`、`selectEligibleContextSources` | 4–5 |
| Bundle 冻结 | `src/context/index.ts`、`createContextBuilder` | 1、6、11–12 |
| 来源加载 | `src/context/projectSources.ts`、`toolSources.ts`、`recentInteractionSources.ts` | 8–10 |
| Tool 因果归属 | `src/agentRuntime/index.ts` 的 `invokeReadTool`、`src/controlledTools/index.ts` 的 `createControlledToolRuntime`、`src/context/toolSources.ts` 的 `createCommittedToolContextSourceLoader`；`tests/agentRunRuntime.test.ts`、`tests/controlledTools.test.ts` | 9、16 |
| Runtime 接线 | `src/agentRuntime/index.ts` | 7、12、14 |
| 设计与测试 | `docs/adr/0019-build-context-bundles-before-model-intent.md`、`docs/reports/agent-harness-context-68-progress.md`、`tests/context*.test.ts` | 全部 |

## 阶段证据缺口与交接

给后续材料整合的事实：T12 是 ContextBundle 基础，含预算、来源筛选和局部 Runtime 冻结；个人具体 ownership、真实质量/Token/延迟收益、旧路径迁移程度均须逐项确认。高风险 Claim：不能说“全部 Agent 已走 ContextBuilder”“已彻底防注入”“Token 降低”“上线稳定运行”。本文件为阶段问答稿，最终 ASu 口播长度、逐题追问及事实一致性质量门禁仍须在全部 T 阶段和 T21 验收后统一复核。
