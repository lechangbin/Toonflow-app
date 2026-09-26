# Agent Harness T12 导学：不可变、可溯源的 ContextBundle（阶段版）

> 目标岗位：Agent Harness 优先，Agent 应用开发其次。只讨论仓库可核验的 T12 基础及明确标出的后续接线；不是 T12 完成证明，也不是简历文案。Issue #68 仍开放，最终验收留到 T21。

## 前置知识

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| 模型上下文窗口与 Token 预算 | 解释为什么必需指令不能被可选资料挤掉 | `src/context/budget.ts` | 高 |
| 来源授权与信任层级 | 区分 Project 数据和系统指令 | `src/context/sourceSelection.ts`、`src/context/index.ts` | 高 |
| SQLite 事务与不可变证据 | 解释 Bundle 与 Attempt 如何一起冻结 | `src/context/index.ts`、`src/lib/initDB.ts` | 高 |
| Agent Run/Step/Attempt | 找到一次 Model 请求所对应的输入 | `src/agentRuntime/index.ts` | 高 |
| 哈希与修订 | 发现来源变化，避免重启后重组不同 Prompt | `src/context/projectSources.ts`、`src/context/index.ts` | 中 |

## 重点亮点与学习顺序

| 亮点 | 为什么重要 | 通用关键词 | 先看文件 | 顺序 |
| --- | --- | --- | --- | --- |
| 强制内容优先的预算 | 安全约束不能靠截断“尽量保留” | 预算、失败关闭 | `src/context/budget.ts` | 1 |
| 授权先于相关性 | 跨 Project 内容不能先进入排序器 | 多租户隔离、来源筛选 | `src/context/sourceSelection.ts` | 2 |
| 精确输入与无原文清单分离 | 既支持重试检查，也减少 Trace 扩散 | 可复现性、数据最小化 | `src/context/index.ts` | 3 |
| Model 意图前冻结 | 防止已发起外部调用却找不到输入证据 | 事务边界、因果顺序 | `src/agentRuntime/index.ts` | 4 |
| Tool 结果的因果归属 | 成功回执还必须证明属于前置 Step，才可进入下一次 Context | 回执、Trace、幂等身份 | `src/controlledTools/index.ts`、`src/context/toolSources.ts` | 5 |

## 必备知识点

- [ ] 能写出 `min(策略上限, 模型窗口−输出预留−Tool 预留−安全余量)`，并解释未知模型窗口不能填任意默认值。
- [ ] 能解释普通 45/20/20/15 与高风险 60/25/10/5 是可选来源分配，强制内容先完整保留。
- [ ] 能区分“同 Project 来源候选”“实际纳入的消息”“manifest 中的来源身份/省略原因”。
- [ ] 能解释刷新为什么创建 successor Bundle，不修改先前 Attempt 的输入。
- [ ] 能说明真实受控 Tool 如何写入 Step/Attempt Trace，以及为何跨 Attempt 不能重用同一 operation ID。

## 推荐阅读（按实际链路）

| 主题 | 通用技术点 | 阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 决策与术语 | 不可变上下文 | `CONTEXT.md`、`docs/adr/0019-build-context-bundles-before-model-intent.md` | 15 分钟 | Bundle 与普通拼 Prompt 的区别 |
| 预算计算 | 必需/可选、溢出 | `src/context/budget.ts`、`tests/contextBudget.test.ts` | 30 分钟 | 为什么超预算在推理前失败 |
| 来源筛选 | Project/Script/Role/修订 | `src/context/sourceSelection.ts`、`tests/contextSourceSelection.test.ts` | 30 分钟 | 为什么不能先检索再过滤 |
| 数据装载 | 章节、Tool 回执、历史交互 | `src/context/projectSources.ts`、`src/context/toolSources.ts`、`src/context/recentInteractionSources.ts` | 45 分钟 | 什么证据有资格进入候选 |
| Tool 因果接线 | 执行身份、Trace、下一 Step 来源 | `src/agentRuntime/index.ts`、`src/controlledTools/index.ts`、`src/context/toolSources.ts`、`tests/agentRunRuntime.test.ts`、`tests/controlledTools.test.ts` | 30 分钟 | 为什么单有成功 Receipt 还不足以进入 Context |
| 冻结与调用 | Attempt/Bundle/Model 意图 | `src/context/index.ts`、`src/agentRuntime/index.ts`、`tests/contextBundle.test.ts` | 45 分钟 | 如何证明模型实际收到冻结消息 |

自学提醒：若某文件或原理看不懂，请继续追问 AI；本导学给出学习路径与题目，不提供逐行讲解。

## 项目技术定位

这是 Agent Harness 的后端上下文治理能力：重点不在检索算法，而在授权、预算、冻结和可审计的 Model 输入边界。

## 核心原理解析

1. 问题：来源太多且窗口有限。机制：先保留安全/权限等强制内容，再按声明容量与风险类别分配可选来源；强制内容放不下时拒绝调用。落点：`planContextBudget` 与 Runtime 调用前构造。
2. 问题：相关性检索可能接触越权文本。机制：先按 Project、Script、Role、修订和保留状态过滤，再做内容哈希与排序。落点：`selectEligibleContextSources`。
3. 问题：重试时重新拼上下文会变。机制：一次 Attempt 固定精确消息和无原文来源清单，后续刷新写 successor。落点：`createContextBuilder().build/inspect`。
4. 问题：Project 文本和历史回答可能注入指令。机制：它们以标记为数据的低权威消息进入，不继承 system 权限。落点：`src/context/index.ts` 与来源加载器。
5. 问题：真实 Tool 执行虽有成功回执，却无法证明属于哪个 Step。机制：Runtime 将 Step/Attempt 身份传给受控 Tool，Tool 的开始及终态 Trace 记录该身份，重放核对原始身份；来源加载器还从 Attempt 表复核它确属同一 Run 的前置 Step，损坏的跨 Step/Run 记录拒绝。落点：`invokeReadTool`、`createControlledToolRuntime`、`createCommittedToolContextSourceLoader`。当前测试直接验证下一 Step 来源接口，尚未实现同一步多轮 Model 调度。

## 关键设计决策

| 选择 | 备选 | 取舍与风险 | 当前验证 |
| --- | --- | --- | --- |
| 未知模型容量保留兼容分支 | 猜一个默认窗口 | 避免伪造预算，但旧路径仍可能没有 Bundle | `tests/contextModelCapacity.test.ts`；完整迁移未完成 |
| 必需来源溢出直接失败 | 截断安全文本 | 牺牲可用性以保留约束完整性 | 预算和 Runtime 定向测试 |
| 精确消息与无原文 manifest 分存 | 全部写进 Trace | 方便复核且减少诊断泄漏；Bundle 本身仍含输入内容，须受 Project 生命周期保护 | Bundle/授权/删除定向测试 |
| 先授权再排序 | 先检索再过滤 | 限制跨 Project 数据进入检索阶段 | 来源筛选定向测试 |
| Tool 回执按 Step/Attempt 归属 | 只看回执成功状态 | 增加因果检查和跨 Attempt 幂等约束；旧式无身份回执保留兼容但不能冒充前置 Step 证据 | `controlledTools`、`contextToolSources`、`agentRunRuntime` 定向测试 |

## 量化与验证（待测）

建议在最终验收记录每次 Model Attempt 的预算、实际包含/省略来源、必需内容溢出率与来源拒绝分类，并检查 App/Web 行为。现有 T12 定向测试证明基础契约，未测线上 Token 成本、回答质量、真实 Provider 窗口准确性或跨仓浏览器链路；T16 才开始接入冻结 Skill 的生产 Run，旧 Socket 路径仍未全部迁移。

## 后续 T12 增量：可选 Tool 投影

只读 Novel Tool 的完整结果超出本类别剩余额度时，可选来源才尝试固定类型投影：正文前 128 个 Unicode code point，或前两条事件及详情前 80 个 code point。消息明确写出完整输出已省略；manifest 记录投影哈希、原完整消息哈希与版本化策略。投影仍超额则省略，必需 Tool 结果超额仍失败。Script Workspace 等新增 Tool 没有这两种 Novel 投影策略，不会错误解析成事件。对应 `src/context/sourceSelection.ts`、`src/context/toolSources.ts` 和 `tests/contextToolSources.test.ts`。

自检：若关键事实在正文尾部，这项投影能否保证回答正确？不能；它只是可追溯的预算降级，不是语义摘要。后续应设计显式可定位片段或检索，而不是把固定前缀说成质量提升。T12 七个 Context 测试文件当前 18/18 定向用例通过，T16 的新增 Tool 兼容回归亦通过；最终全入口验收仍待 T21。
