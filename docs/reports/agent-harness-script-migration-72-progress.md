# Agent Harness T16 · Script Agent 迁移（阶段进度）

Issue：`lechangbin/Toonflow-app#72`。本分支基于仍未验收的 T15 Skill 安全分支；此文档只记录迁移的第一处运行时接缝，不代表旧 Script Agent 已迁移。

## 已实现

- AgentRun 创建事务增加可注入的 `prepareRun` 接缝。在 Run、首个 Step/Attempt、Checkpoint 和 `run.created` Trace 已暂存而尚未提交时调用；准备失败将这些写入一并回滚，且不会调度 Model。准备成功后才返回 queued Run 并安排执行。
- 相同 `clientRequestId` 的幂等重试读取原 Run，不重新调用准备接缝，防止新的 Skill 激活指针或上下文版本改写已经冻结的运行。
- 该接缝默认未配置，不改变现有只读 AgentRun 行为。旧 Script Socket Agent 仍为独立执行路径。
- T15 的路由与绑定现可在调用方已有事务内执行。新增 Script 专用的可选择启用的 `prepareScriptSkillRun`：用固定类型化意图 `read-only-guidance` 路由当前请求，并在 Run 创建事务中冻结所选 Revision、依赖闭包和审计记录；无候选或并列候选会使 Run 创建整体回滚，Model 不被调度。默认生产入口尚未启用此接缝。
- ContextBuilder 的可选 `includeBoundSkills` 仅从 RunSkillResolution 与 RunSkillBinding 读取已冻结 Skill，复核计划、内容与 manifest 哈希、角色及撤销状态，再把 Skill 正文作为必需系统输入计入 Model 预算；Bundle manifest 只保存修订身份与哈希，不复制正文。Skill 模式下若 Model 未声明 Context 容量，执行在调用前失败，不退回无预算的旧路径。
- AgentRuntime 的可选择启用 `skillMode` 要求启动准备器与可信 grant 提供者，拒绝注入未经此闸门保护的 Tool Runtime。执行时从持久路由决定读取唯一 Skill ID，传给受控 Tool；定向测试让 Model 尝试调用未被 Skill 声明的只读 Tool，验证 PermissionDecision 拒绝且没有 ToolReceipt 或读取结果。
- 已提供独立的 `script-harness-guidance-v1` Run scope 和 HTTP 启动/控制入口。新 scope 必须由 Skill 模式创建；启动事务核对 JWT 操作者确为 Project Owner，旧的只读 Run 入口不能创建新 scope，旧 inspect/cancel/list 无 Owner 信息时看不到新 scope。独立控制入口从 JWT 取 Owner 身份。旧 Script Socket 执行链尚未切换。
- 两个只读 Tool 保留原 v1 修订和旧 scope，Harness 新 scope 使用独立 v2 修订/契约哈希；v2 若没有 Skill 授权闸门，受控 Tool 直接拒绝。历史 v1 ToolReceipt 仍按 v1 读取，不因 v2 发布而被误判损坏。新默认 Script Harness Runtime 组合启动准备器、Context 容量保护、配置 Vendor 与 T15 的 Project 当前 grant 解析器。
- 增加定向正向链路：Owner 显式开启 Project `read:novel` grant，唯一选中的已发布 Skill 声明 `get_novel_text` 与所需能力；Model 在冻结 Skill Context 下调用受控 Tool，获得本 Project 章节，留下 v2 ToolReceipt 和允许的 PermissionDecision。另一条未声明 Tool 的 Skill 仍被拒绝。这里使用注入的假 Model，不涉及真实 Provider。
- 收紧暂存的旧 Socket 边界：连接时从签名 JWT 取用户 ID，核验 Project Owner，并要求客户端 Memory 隔离键恰为本 Project 的 `projectId:scriptAgent`；旧 `get_script_content` 查询也加上 Project 条件，不能仅凭跨项目剧本 ID 读取内容。这是并行旧路径的隔离修补，不是新 Harness 的 Tool 迁移。
- 定向验证新 Harness 在 Model 调度回调执行前取消：持久 Run 与 Step 进入 cancelled，重复 start 返回原 Run，之后即使旧调度回调运行也不调用 Model；全新 Runtime 实例可凭数据库 inspect/list 恢复已成功和已取消 Run 的状态。这里只模拟进程内新实例，并未做真实进程重启或运行中中断验收。
- 新 Harness 增加后端受控 `get_script_workspace`：模型只能指定 `storySkeleton` 或 `adaptationStrategy`，后端按 Run Project 读取规划工作区，输出长度受 Tool schema 限制；不再为这项读取依赖前端 `getPlanData` 回调。它采用独立 Tool 修订和 `read:script-workspace` 能力，须由 Project Owner 单独授予、Skill 冻结修订声明并经过平台/Project/Run/角色交集；默认无 grant 时拒绝且不产生读取回执。旧 Socket 仍使用前端回调，新 Tool 不提供写入。孤立的待处理工作区读取回执也纳入重启恢复的失败结算。
- 同一运行中的定向测试先成功读取工作区，再由 Owner 撤销当前 Project grant，第二次 Tool 调用重新计算权限并被拒绝；第一次已成功的回执保留，第二次只留拒绝的 PermissionDecision、无读取回执。冻结的是 Skill 请求而非 Project 当前授权，撤销不会抹除已发生的读取。
- 新 Harness 增加 `get_script_content` 受控读取：单个剧本 ID、Project 作用域、16,000 字符输出上限与独立 `read:script` Owner grant。只有 `read:novel` 或 `read:script-workspace` 不会授权它；同项目剧本可留下成功回执，跨项目剧本 ID 在适配器前被拒并留下失败回执。旧 Socket 的多 ID 读取仍是隔离后的兼容路径，新 Tool 未迁移剧本写入。
- T16 写入接缝先冻结候选契约：单字段规划工作区写入、剧本创建与按 ID 更新分别使用严格且有大小上限的输入；候选序列化后经持久化安全检查与哈希绑定，审批预览只暴露目标身份、效果、长度和哈希，不复制创作正文。两个独立不可变 ToolDefinition 固定各自的能力、scope、审批策略和契约哈希。ADR-0022 规定后续 Owner 精确审批、目标状态重检和原子效果提交。当前没有注册写 Tool 执行、持久审批或更新 Project 数据。
- 后端目标状态读取器已区分工作区缺失/唯一/重复行、剧本创建时同名竞争与更新时 ID 所属 Project；对旧表的相关当前字段计算哈希，后续审批提交必须在事务中重算并比对。定向测试覆盖旧入口直接修改后哈希变化、跨 Project ID 拒绝、同名冲突。此时仍无审批命令，不能把“可检测冲突”说成“已防止并发写入”。
- 写入 Runtime 的提案事务冻结候选负载/目标状态/ToolDefinition，并创建 waiting Run/Step/Attempt、pending ToolReceipt/ToolApproval、`run-created` Checkpoint 与审批请求 Trace。相同请求身份幂等返回原提案；不同负载复用身份被拒，Owner 错误、跨 Project 剧本 ID 和同名创建在持久化前失败。Owner 决策命令已在同一事务中重检目标哈希：批准后提交工作区单字段或剧本创建/更新、成功回执、Output、终态 Checkpoint 和 Trace；拒绝、过期、冲突只结算安全失败状态。注入 Output 持久化失败时 Project 写入整体回滚。尚未接入模型侧写 Tool。
- 独立 HTTP 适配器现提供 Owner 作用域的 propose/inspect/list/decide，四个命令都只从已认证请求身份派生操作者，忽略 body 伪造的用户 ID；Router 已按仓库生成规则更新。尚未接入 App/Web 审批界面，也没有把写提案作为模型侧 Tool 接入主 Script Run。
- 到期 pending 审批在 inspect/list 和数据库就绪恢复时结算为 expired，失败回执与 `tool.approval.expired` Trace 同事务落盘；重复读取不重复追加事件，且不会改动工作区或剧本。实际杀进程重启验收与端到端 UI 重连仍留到 T21。
- 审批快照读取现在复核 approval/receipt/Run 状态组合、成功回执输出哈希及 Tool 输出 schema；若回执被篡改，inspect 拒绝投影，而不会向重连客户端虚报成功。定向测试故意改坏已批准回执哈希并验证拒绝。

## 阶段验证与边界

最近一轮写入审批 Runtime 与数据库就绪模块共 9 个定向单元测试通过，涵盖批准、重复命令、冲突、拒绝、过期、注入提交失败与就绪流程；HTTP 身份边界及 Router 的定向测试此前通过。写入候选和目标状态另有 5 个定向用例通过，`yarn lint`（TypeScript noEmit）通过。此前受控 Tool、Skill 权限、Project grant、Script 准备等相关定向用例也通过。未运行全量测试、构建、浏览器或真实 Provider。

新入口目前覆盖只读指导、规划工作区和剧本读取，另有独立后端监督写入 Runtime 及 Owner HTTP 审批入口；还需把写入提案接到 Agent Tool、接入前端切换/重连与审批界面、迁移旧 Socket 行为，验证运行中停止/真实进程重启及 App/Web 契约，并补充可信 Skill 管理与发布流程。旧路径和新路径并存，不能称为端到端 Script Agent 迁移。

## 阶段追问准备（非最终面经）

1. 问：为什么准备动作必须在 Run 创建事务里？答：如果先持久化 queued Run、再异步解析 Skill 或上下文，Worker 可能在准备完成前启动 Model，或准备失败后留下没有能力快照的半成品 Run。这里将准备接缝放在首个 Checkpoint/Trace 写入之后、事务提交之前；任意准备错误让整个创建回滚。定向测试还证明没有调度 Model。它目前只是扩展点，尚未调用真实 Skill 路由，因此不能说迁移已经完成。
2. 问：为什么幂等重试不能重新准备？答：`clientRequestId` 代表同一个请求身份，原 Run 的内容与冻结依赖应当保持不变。重试首先读取权威 Run，指纹一致则返回原结果；若重新解析，激活的 Skill 或 Project 内容可能已变化，同一 Run 会出现两套事实。测试确认准备只在首次创建时执行，重试不会重新运行准备逻辑。
3. 问：Script Agent 路由遇到并列怎么办？答：可选择启用的 `prepareScriptSkillRun` 要求唯一选中。它把 T15 的路由决定和依赖冻结放到 Run 创建事务里；如果最高分并列或没有候选，准备抛出错误，整笔事务回滚，所以不会留下 queued Run、路由记录或已经调度的 Model。定向测试覆盖唯一选择与并列拒绝。当前生产入口尚未启用这条接缝，不能把测试结果外推到旧 Socket Agent。
4. 问：为什么不能从 Skill 的“当前激活版本”临时拼 Prompt？答：Run 创建时已有冻结的依赖计划及每条 Revision/哈希；ContextBuilder 重新读取这些证据并复核已发布内容、角色和撤销策略，再把指令计入强制预算。若临时读取当前激活指针，同一个 Run 在恢复后可能收到不同指令。测试核对 Bundle manifest 只留哈希、系统输入确实含冻结内容，且撤销后拒绝重读。旧 Model 无容量声明时 Skill 模式不会绕过预算。
5. 问：为什么提供了 Skill 指令后还要额外配置 Tool grant？答：指令文本不是权限。`skillMode` 用 Run 冻结的 Skill ID 调用受控 Tool 闸门，判定仍要求 Skill 请求、Tool 能力与四层外部 grant 同时成立；测试中即使四层 grant 都允许，Skill 未声明 Tool 也会在适配器执行前拒绝。新默认 Runtime 已接入只读 `read:novel` 的 Project 持久 grant 来源，但旧 Socket 路径和其他能力未迁移，故不能声称全面执行保护。
6. 问：为何新 Script Harness 要用独立 scope 和 Tool v2？答：旧 scope、v1 ToolDefinition 与 ToolReceipt 已有持久契约哈希。直接放宽 v1 的 scope 会让同一修订对应两份策略，既损坏历史证据，也可能无意授权旧路径。新 scope 要求 Skill 模式，v2 Tool 定义只允许该 scope 且拒绝无闸门调用；历史回执仍按 v1 读取。定向测试核对契约哈希不同及旧 Tool 回归。当前只读指导是迁移入口，不代表旧 Script 的规划与写入能力已有 v2 替代。
7. 问：怎样阻止旧端点绕过新入口的 Owner 校验？答：新启动路由从 JWT 中间件取 actor，准备事务再次核对 `o_project.userId`，失败会回滚 Run；运行时的 inspect、cancel、list 对新 scope 还要求 Owner 身份。旧路由不提供这项身份时不能看到或取消新 Run；专用控制路由把 JWT actor 传给运行时。定向测试覆盖伪造 body actor、错误 Owner 和无 Owner 调用。完整前端重连路径仍待接入。
8. 问：如何证明这不是只有拒绝、没有可用能力的空闸门？答：定向测试先由 Project Owner 开启持久 `read:novel` grant，再发布声明了 `get_novel_text` 的 Skill；Harness Run 冻结选中修订、ContextBundle 包含该指令，假 Model 发起受控读取后得到本 Project 章节。数据库中同时可核对 v2 ToolReceipt、允许的 PermissionDecision 和 Run 的最终成功状态。测试不调用真实 Provider，也不覆盖旧 Script Agent 的规划/Script 写能力。
9. 问：新旧路径并存期间，为什么还要修旧 Socket？答：旧连接过去只检查 JWT 签名，Project ID 和 Memory 隔离键来自客户端；剧本读取还只按 ID 查找。即使新 Harness 自身正确，这些旧入口仍可能跨 Project 读取。现在旧连接核对签名 token 对应的 Owner 与规范隔离键，旧剧本查询增加 Project 过滤；两个定向用例分别覆盖伪造上下文与跨项目 ID。修补只缩小旧路径暴露面，不能替代规划和写入 Tool 的正式迁移。
10. 问：用户刚点停止，已入队的执行回调还会不会调用 Model？答：Run 在 queued 态取消时先持久化 cancelled 的 Run/Step/Attempt 与因果 Trace；回调稍后尝试获取执行权时看不到可领取的 queued Run，因此不会调用 Model。测试还验证相同请求 ID 的重复 start 只返回原 cancelled Run，换一个 Runtime 实例仍能 inspect/list 读回状态。运行中供应商请求、中断竞态、真实进程重启和租约接管尚未由此测试证明。
11. 问：为何读取故事骨架不能沿用 `read:novel`？答：两者是不同数据边界；沿用小说授权会让 Skill 获得其 manifest 未必表达的规划工作区读取能力。新 Tool 要求单独的 `read:script-workspace` 能力与 Owner 管理的 Project grant，输入键限制为骨架/改编策略，后端查询限定 Run Project。测试显示只有小说授权时规划工作区仍拒绝；单独授权后可得到本项目数据，其他 Project 的同键数据不进入输出。工作区数据尚未通过受控写 Tool 更新，因此不能说规划闭环已迁移。
12. 问：如果工作区读取时进程中断，为什么不会留下永远 pending 的回执？答：受控读取的 pending 回执在没有存活租约时由恢复器标记失败，并追加一次 `tool.interrupted` 因果事件；重复恢复不重复追加。新工作区 Tool 已加入该恢复集合，定向测试用无租约的孤立回执验证结算。这个测试不等于真实进程重启验收，也不覆盖写入效果对账。
13. 问：Run 已冻结 Skill，Project Owner 中途撤销授权还有用吗？答：Skill 修订冻结的是该 Run 申请哪些 Tool/能力，不等于持续授予。每次调用受控 Tool 都在事务中读取 Project 当前 grant 并重新计算交集。定向测试在一次模型调用中先读成功、后撤销、再读拒绝；第一笔成功回执仍保留，第二笔只有拒绝决策。撤销阻止后续读取，不可能撤回模型已收到的第一次数据。
14. 问：为什么剧本内容读取不用旧的 `ids[]` 模型工具？答：旧调用可提交多个任意 ID，原实现还缺少 Project 条件。新 Tool 每次只收一个正整数 `scriptId`，先要求独立 `read:script` 权限，再核对该 ID 属于 Run Project，输出 schema 限长，回执记录 Tool 修订与结果哈希。测试同时给出授权本项目 ID 的成功与跨项目 ID 的失败证据。旧路径只做了 Project 过滤修补，写入和 App/Web 接线仍未迁移。
15. 问：为何不直接让模型更新整份 `setPlanData`？答：旧接口一次覆盖规划 JSON 和多个剧本，缺少单个效果的稳定身份、版本与原子审批边界。新契约先拆成一个工作区字段或一个剧本创建/更新候选，严格验证并冻结哈希，审批预览不复制正文；ADR-0022 要求后续将 Owner 决策绑定到精确目标状态，并在同一事务里提交领域写入与证据。当前单元测试只能证明候选边界与预览，不能声称审批与写入已经实现。
16. 问：为什么工作区写与剧本写要分两个 Tool 修订？答：两者目标状态和影响范围不同。工作区只允许改骨架或策略单字段，剧本写需要区分创建和按 ID 更新，并在提交时验证剧本属于当前 Project。独立 ToolDefinition 固定各自能力、输入/输出 schema、审批策略与契约哈希，避免单个宽泛写权限覆盖两类效果。定向测试只证明修订契约不同、候选输入被严格限制；执行权限、审批和效果仍待实现。
17. 问：没有数据库版本列，如何发现旧界面在审批等待期间改过目标？答：后端在提案时读取并哈希当前工作区或剧本相关字段，审批提交在同一事务中重新读取比对；工作区重复行、跨 Project 剧本 ID 与同名竞争被明确拒绝。定向测试在提案后让旧入口改动剧本，审批进入 conflicted 而不覆盖旧入口的结果。该机制仍依赖所有最终写入都在同一个 SQLite 事务序列里；完整 App/Web 并发验收留到 T21。
18. 问：怎样证明提案不会提前写入剧本，批准后又不会写一半？答：提案事务只持久化审批证据与等待中的 Agent Run；测试前后核对原字段、Run/回执/Checkpoint/Trace 的存在。批准时，Project 写入与回执、Output、Checkpoint、Trace 同事务提交；测试故意让 Output 插入失败，验证域数据与审批/回执状态一并回滚。重复批准命令返回原结果，不重复创建剧本。HTTP 适配器已有定向测试，模型侧写 Tool 与真实重启仍未验证。
19. 问：为什么请求体里传一个 Owner ID 不能直接批准？答：HTTP 适配器只从认证中间件读取 actor，并在调用 Runtime 时覆盖 body 中任何同名字段；Runtime 再按 Project 当前 Owner 校验，因此前端传来的 ID 不是授权来源。定向路由测试核对 propose、inspect、list、decide 四个入口都使用认证身份。测试使用注入的假认证中间件，生产端完整鉴权链还需最终跨边界验收。
20. 问：用户一直不处理审批，刷新或重启后会不会仍能批准过期内容？答：Runtime inspect/list 和数据库就绪恢复都会筛选到期且仍 pending 的审批，在单一事务中把审批置为 expired、回执置失败、Run 留在需要关注状态并追加安全 Trace；再次读取不重复结算。定向测试在到期后调用 inspect/list 核对事件只出现一次、Project 内容未改变。这里验证了恢复函数和就绪测试，真实进程重启的跨边界验收仍留待 T21。
21. 问：如果数据库里的审批回执被改成“成功”，重连会不会照单全收？答：快照读取不只看一个 status；它对照 approval、ToolReceipt 与 Run 的合法状态组合，并对成功回执重新计算输出哈希、验证版本化输出 schema。定向测试在成功后篡改回执哈希，inspect 直接拒绝投影。该检查防止错误呈现，不等于对数据库物理篡改具备恢复能力；完整证据链审计还要在最终验收覆盖。
