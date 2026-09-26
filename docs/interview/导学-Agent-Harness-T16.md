# Agent Harness T16 导学：Script Agent 渐进迁移（阶段版）

> 对应 Issue #72。新 Harness 已有只读指导、分项读取、模型侧写入候选及独立 Owner 审批；旧 Script Socket 仍并行，完整迁移、浏览器与真实进程恢复留待后续及 T21。不写简历 bullet 或未经测量的收益。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| Run/Step/Attempt 与创建事务 | 理解准备失败为何不能留下半成品 Run | `src/agentRuntime/index.ts` | 高 |
| 冻结 Skill、动态 grant | 区分指令身份和当前数据授权 | `src/agents/scriptAgent/harnessPreparation.ts`、`src/skillRuntime/grants.ts` | 高 |
| ToolDefinition 与 Receipt | 说明读取/提案的版本化契约及结果证据 | `src/controlledTools/definitions.ts`、`src/controlledTools/scriptWriteApproval.ts` | 高 |
| 租约、审批和目标状态哈希 | 防止失权模型或过时审批写入 | `src/controlledTools/scriptWriteApproval.ts`、`docs/adr/0022-supervise-script-writes-with-frozen-target-state.md` | 高 |
| 新旧路径兼容 | 认识过渡期的两套入口及隔离风险 | `src/socket/routes/scriptAgent.ts`、Web Harness 客户端 | 高 |

## 重点亮点与阅读顺序

| 亮点 | 核心问题 | 先看文件 | 顺序 |
| --- | --- | --- | --- |
| 事务内准备 | queued Run 能否先于 Skill 冻结被调度 | `src/agentRuntime/index.ts`、`harnessPreparation.ts` | 1 |
| 冻结 Context 与受控只读 | 指令变更或跨 Project ID 能否影响已启动 Run | `src/context/index.ts`、`src/agents/scriptAgent/harnessRuntime.ts` | 2 |
| 提案与效果拆分 | 模型是否可直接改规划/剧本 | `src/controlledTools/scriptWriteApproval.ts`、ADR-0022 | 3 |
| Owner 全文复核 | 无正文列表如何避免盲批 | `src/routes/agentRuns/scriptWriteApprovals.ts`、Web 审批客户端 | 4 |
| 双路径隔离 | 旧 Socket 风险如何在迁移期收紧 | `src/socket/routes/scriptAgent.ts`、`tests/scriptHarnessRoutes.test.ts` | 5 |

## 必备知识点

- [ ] 画出 Run 创建事务、Skill 路由与闭包绑定、Context 构造、Model 调度的先后顺序。
- [ ] 解释相同 `clientRequestId` 为什么不得重新准备 Skill；失败重试与新请求有什么区别。
- [ ] 区分 Run 冻结的 Skill 请求和每次 Tool 调用时重读的 Project 当前 grant。
- [ ] 列出 `read:novel`、`read:script-workspace`、`read:script` 的不同数据边界。
- [ ] 说明模型提案只建立子审批 Run，Owner 看全文、重检目标并批准后才发生写入。
- [ ] 解释旧 Socket 修补与新 Harness 迁移不是同一件事；指出尚未迁移的规划/剧本旧行为。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 领域与边界 | Project Owner、规划、剧本 | `CONTEXT.md`、`docs/agents/domain.md`、ADR-0022 | 20 分钟 | 写入对象与审批者是谁 |
| 准备与启动 | 创建事务、scope、幂等 | `src/agents/scriptAgent/harnessPreparation.ts`、`src/routes/agentRuns/startScriptHarness.ts`、`tests/scriptHarnessPreparation.test.ts` | 40 分钟 | 为什么准备失败不调 Model |
| 只读路径 | Context 预算、Tool v2、Project 过滤 | `src/agents/scriptAgent/harnessRuntime.ts`、`src/controlledTools/definitions.ts`、受控 Tool 测试 | 45 分钟 | 数据如何过权限交集 |
| 写入候选 | 提案契约、目标状态、审批事务 | `src/controlledTools/scriptWriteApproval.ts`、`tests/scriptWriteApproval.test.ts` | 60 分钟 | 为什么批准前没有写入 |
| HTTP 与 Web | 认证 actor、全文复核、显式切换 | `src/routes/agentRuns/scriptWriteApprovals.ts`、`tests/scriptWriteApprovalRoutes.test.ts`、Web Draft #7 | 45 分钟 | 用户实际如何监督 |
| 旧路径与报告 | 并行入口的隔离和缺口 | `src/socket/routes/scriptAgent.ts`、`docs/reports/agent-harness-script-migration-72-progress.md` | 25 分钟 | 哪些还不能称为迁移完成 |

自学提醒：若某文件或原理看不懂，请继续追问 AI；本导学负责给学习路径与题目，不替代逐行讲解。

## 项目技术定位

T16 是 Script Agent 从前端回调驱动的旧 Socket 流程向服务端持久 Harness 过渡的阶段。它优先建立一个可选择使用、可追责的监督路径，并在旧路径存续时修补 Project 隔离；不是一次性替换所有 UI 与 Agent 行为。

## 核心调用链

认证 Owner → 启动 `script-harness-guidance-v1` → 创建事务里路由并冻结 Skill/依赖 → 构造有容量约束的 Context → Run 获取租约 → 模型调用受控读取或提出单项写入候选 → 每次检查 Skill、Project/Run/角色 grant → 读取产生 Receipt，提案产生独立 pending 子 Run → Owner 读取完整候选、批准/拒绝 → 批准事务重检目标哈希并提交单项写入、Receipt、Output 与 Trace。

旧 Socket 仍独立运行；其 JWT Owner、Memory 隔离键和剧本 Project 查询已收紧，不能据此说旧规划与剧本写入已经变成 typed Steps。

## 关键设计决策

| 选择 | 未采用方案 | 取舍与风险 | 阶段证据 |
| --- | --- | --- | --- |
| Run 创建事务内准备 | 先提交 queued 后异步补 Skill | 防止半成品执行，准备失败让启动整体失败 | `tests/scriptHarnessPreparation.test.ts` |
| 独立 scope/Tool 修订 | 直接扩大旧只读 Tool v1 | 保护旧 Receipt 契约并明确新权限边界 | `tests/scriptHarnessRoutes.test.ts`、受控 Tool 测试 |
| 单项提案 + Owner 决策 | 模型直接 `setPlanData` | 效果可审、可冲突检测；增加交互成本 | `tests/scriptWriteApproval.test.ts` |
| 全文独立复核 | 审批列表泄露正文或仅看哈希盲批 | 减少内容扩散，批准前仍能看到具体内容 | `tests/scriptWriteApprovalRoutes.test.ts` |
| 显式新旧模式 | 失败时自动退回 Socket | 用户清楚当前权限/证据链；双路径仍要长期收敛 | Web Draft #7 的定向客户端测试 |

## 量化与验证（待测）

现有 App/Web 定向单测与类型检查证明局部契约；假 Model 正向链路证明受控读取和提案→Owner 决策的本地闭环，但不证明真实 Provider、浏览器操作或跨进程中断安全。后续应冻结两仓修订，逐项测同 Step 恢复、审批过期、旧 Socket 迁移、跨 Project 访问及真正的 User 流程。T21 前不得报告端到端迁移完成率或线上收益。
