# Agent Harness T16 面经：Script Agent 渐进迁移（阶段版）

> 对应 Issue #72。问题用于应对 Agent Harness、Agent 应用开发和 AI 后端岗位追问，不是简历 bullet。旧 Script Socket 与新 HTTP Harness 并存，真实 Provider、浏览器和跨进程恢复未完成验收；第一人称 ownership 由用户按提交记录确认。

## 项目背景

旧 Script Agent 依赖 Socket、前端规划数据回调及较宽的写入入口，难以解释模型某次读取或修改究竟受哪版指令和哪次审批约束。T16 新增独立监督 Harness：在持久 Run 中冻结 Skill，用受控 Tool 分项读取，模型只提交受权限约束的单项写入候选，Owner 独立复核后才可提交效果。它是渐进迁移，不应被讲成旧 Agent 已完全替换。

## 主问与追问

1. 问：为什么准备 Skill 要放在 Run 创建事务内？答：如果先提交 queued Run 再异步补路由和绑定，调度器可能先拿到 Run 调用 Model，留下没有可信指令身份的执行。创建接缝在首个 Step/Attempt、Checkpoint 与 Trace 暂存后、事务提交前路由并冻结修订；准备失败连 Run 一起回滚，模型不会调度。定向测试证明这一局部顺序，仍需真实进程验收。追问：同一请求重试呢？答：先返回原 Run，不重新读取当前激活 Skill。
2. 问：如何防止用户重复点击产生两套不同的 Skill 决策？答：启动用 `clientRequestId` 和请求指纹识别同一逻辑请求；第一次准备并绑定后，相同身份重试直接读原 Run，不能因中途激活指针变化而重新路由。若同一身份携带不同负载则冲突，而不是静默覆盖。这样解决的是服务端持久请求幂等，不等于网络外部效果恰好一次。追问：用户想使用新版怎么办？答：明确发起一个新请求身份。
3. 问：Script 路由并列或没有候选时怎么处理？答：新 `prepareScriptSkillRun` 要求唯一已发布且兼容的 Skill，路由与闭包绑定在 Run 创建事务内。并列或 unavailable 会使准备失败，事务回滚，不留下待执行 Run，也不调用 Model；不会按字典序假装用户已选择。定向测试覆盖唯一选择与拒绝，旧 Socket 路径没有因该接缝自动受控。追问：为何不退回旧 Agent？答：两条路径权限与证据契约不同，隐式回退会隐藏安全边界。
4. 问：已经冻结 Skill，为什么构造 Prompt 时还要复核？答：Run 绑定保存的是修订身份与哈希，不应相信此时任何“当前文件”或激活指针。ContextBuilder 读取冻结解析计划，核验发布正文、manifest、角色及撤销状态，再把指令作为必需系统输入纳入模型容量预算；没有容量元数据就失败，不用无上限旧路径兜底。Bundle 只保存身份/哈希，不额外复制全文。追问：这样能保证回答质量吗？答：不能，只保证指令来源和预算边界可核查。
5. 问：为何新 Harness 使用独立 scope 和 Tool v2？答：旧 scope 与 v1 ToolReceipt 已有持久合约，若直接扩展旧修订的策略，同一个修订哈希就会对应不同权限含义。新 `script-harness-guidance-v1` scope 要求 Skill 模式，v2 读取 Tool 在无授权闸门时直接拒绝；旧回执仍按 v1 检查。这样过渡时能区分两条链路，代价是还需迁移旧入口。追问：scope 本身授予数据权限吗？答：不授予，还需 Skill 请求和多层 grant。
6. 问：为什么小说、规划工作区和剧本读取需要三个 grant？答：它们分别对应不同 Project 数据范围。`read:novel` 只支持小说章节，`read:script-workspace` 只支持骨架或策略字段，`read:script` 才允许按单个 ID 读取本 Project 剧本；前两者不自动开放第三者。每个 Tool 仍需冻结 Skill 声明、平台/Project/Run/角色交集，输出 schema 还设限长。定向测试覆盖授权正向与跨 Project 拒绝，不能当成所有历史读取入口已迁移。追问：Project grant 中途撤销呢？答：下一次 Tool 调用重新判断。
7. 问：Run 冻结 Skill 后，Owner 撤销 Project grant 是否还有效？答：冻结的是“该 Skill 请求什么”，不是永续许可。每次 Tool 调用都从当前 Project grant 求交；一次模型执行中先读成功、Owner 撤销后再次读取会被拒，第一笔成功回执保留，第二笔只留下拒绝决策。撤销不能让模型忘掉已返回的数据，但能阻止继续访问。追问：为何不同时撤掉 Run binding？答：那会抹掉历史使用的是哪版指令，授权变化应独立留证。
8. 问：写入候选为什么不能沿用旧 `setPlanData` 整包覆盖？答：旧入口跨规划与多剧本字段，模型输出一旦直接提交，很难给单个效果、目标状态和审批建立稳定身份。新候选限定一个规划字段、一个剧本创建或按 ID 更新，输入严格校验大小和类型，冻结序列化负载哈希、目标哈希和 Tool 修订。审批预览仅给目标与长度/哈希，提交还要重检当前数据。代价是多次操作及 Owner 审批。追问：候选阶段会改业务表吗？答：不会。
9. 问：批准前如何让 Owner 真正看见模型要写什么？答：常规列表与 Trace 不复制创作正文，以免大段内容扩散；独立 Owner-only review 在读正文前核验审批状态、过期时间、Project 所属和证据，HTTP 明示不缓存。Web 只有在显示了与当前 approval ID、Run 版本和负载哈希一致的全文后才解锁批准，拒绝可直接提交。单测验证越权和旧版本拒绝，浏览器视觉及缓存行为还未最终验收。追问：仅展示哈希够吗？答：不够，哈希是身份校验，不是人类审阅内容。
10. 问：Owner 批准时怎样防止覆盖他刚刚在旧界面改过的剧本？答：候选创建时读取工作区或剧本相关字段并计算目标状态哈希；批准事务再次读取并比对，跨 Project ID、重复工作区行和同名剧本竞争都拒绝。批准后领域写入、成功 Receipt、Output、Checkpoint 与 Trace 同事务提交；注入 Output 插入失败的测试证明写入会一起回滚。该保障依赖所有提交路径遵守数据库事务，不应说成跨系统强一致。追问：冲突自动合并吗？答：不自动，应重新提案。
11. 问：模型侧的“写入 Tool”会直接修改 Project 吗？答：不会。模型看到的是两个独立的 propose Tool，分别要求 `propose:script-workspace` 和 `propose:script`，不授予 `write:*`。它们还要求有效父 Run 租约、冻结 Skill 声明及当前 Project grant；成功时生成待审子 Run，父 Run 完成也不意味着子提案获批。真正写入由认证 Owner 审阅全文后另行提交。假模型定向测试覆盖先提案后批准，未调用真实 Provider。追问：错误租约能否创建候选？答：不能。
12. 问：父 Run 和子审批 Run 如何关联并防止页面凭空造一条批准？答：子 Run 冻结父 Run ID、模型 Tool 操作 ID、Skill ID 与候选哈希；父 Run 保留同操作的权限判定和 Trace。重连投影复核父子 Project、允许决策、判定哈希和审批/Receipt 状态，而非只信页面文本。HTTP 决策从 JWT 取 actor，不信请求体伪造 Owner ID。局部测试验证来源关联，完整跨进程及浏览器重连仍待 T21。追问：父 Run 成功是否自动批准？答：不会。
13. 问：审批过期或服务重启时会不会突然执行旧候选？答：到期 pending 审批在 inspect/list 或数据库就绪恢复时事务内结算为 expired，失败回执与事件只写一次，业务表不变；批准命令还会重新检查版本和目标哈希。现有测试只模拟新 Runtime 实例和恢复调用，没有实际杀进程、运行中租约接管或 Web 重连的完整验收。追问：若 Vendor 已执行怎么办？答：T16 这些写入是本地效果；外部付费效果需另有请求账本，不可套用该结论。
14. 问：为什么新 Harness 正确仍需要修旧 Socket？答：旧连接仍可到达，并曾让客户端提供 Project/Memory 隔离键，旧剧本查询也只按 ID。过渡期修补改为从签名 JWT 获取用户，核对 Project Owner、规范的 `projectId:scriptAgent` 隔离键，并在剧本查询加 Project 条件；还兼容现有 Web 使用的规范十进制字符串 ID。它缩小并行路径的数据泄露面，不意味着旧规划与写入行为已获得持久 Step 和审批。追问：为何不直接删旧入口？答：现有用户流程尚未由新路径完整替代。
15. 问：T16 当前到底完成到哪里，下一步优先做什么？答：可核验的是独立监督 Run、三类分项只读、模型侧单项写入候选、Owner 全文复核和本地审批提交；Web 有显式新模式和审批操作的定向客户端测试。尚不能说旧 Script Agent 完全迁移：旧 Socket 规划/剧本行为并存，浏览器、真实 Provider、运行中断与实际进程重启未验收。下一步应按 Issue #72 逐项迁移旧黄金链路、冻结 App/Web 契约并在 T21 做系统验收；此阶段不报告线上收益。追问：如何展示局部结果？答：用 Run/Receipt/PermissionDecision/子审批的持久记录与定向测试，而非模型回复截图。

## 源码证据索引

| 主题 | 关键路径与内部符号 | 对应问题 |
| --- | --- | --- |
| 准备、scope 与模型 | `src/agentRuntime/index.ts`、`src/agents/scriptAgent/harnessPreparation.ts`、`harnessRuntime.ts`、`tests/scriptHarnessPreparation.test.ts` | 1–5 |
| 只读与授权 | `src/controlledTools/definitions.ts`、`src/skillRuntime/grants.ts`、`docs/reports/agent-harness-script-migration-72-progress.md` | 6–7 |
| 候选、审批与恢复 | `src/controlledTools/scriptWriteApproval.ts`、`tests/scriptWriteApproval.test.ts`、ADR-0022 | 8–13 |
| HTTP 与兼容 | `src/routes/agentRuns/scriptWriteApprovals.ts`、`src/socket/routes/scriptAgent.ts`、`tests/scriptWriteApprovalRoutes.test.ts`、`tests/scriptHarnessRoutes.test.ts` | 9、12、14–15 |

## 高风险 Claim

不可说“旧 Socket 已停用”“模型拥有直接写权限”“父 Run 成功代表子提案批准”“哈希预览等于全文审阅”“真实 Provider/浏览器/跨进程恢复已通过”。阶段版仍需在 T21 后做 ASu 统一口播与证据一致性质检；个人 ownership 和数字需另证。
