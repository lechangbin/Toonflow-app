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

## 阶段验证与边界

最近一轮 Script 准备定向用例已覆盖 v2 Tool 的允许/拒绝两条链路并通过；此前独立 HTTP 入口、受控 Tool v1/v2 兼容与 Tool Context 共 14 个相关定向用例通过。`yarn lint`（TypeScript noEmit）通过。未运行全量测试、构建、浏览器或真实 Provider。

新入口目前仅覆盖只读指导；还需接入前端切换与重连，迁移规划/Script 写工具和旧 Socket 行为，验证停止/刷新/进程重启及 App/Web 契约，并补充可信 Skill 管理与发布流程。旧路径和新路径并存，不能称为端到端 Script Agent 迁移。

## 阶段追问准备（非最终面经）

1. 问：为什么准备动作必须在 Run 创建事务里？答：如果先持久化 queued Run、再异步解析 Skill 或上下文，Worker 可能在准备完成前启动 Model，或准备失败后留下没有能力快照的半成品 Run。这里将准备接缝放在首个 Checkpoint/Trace 写入之后、事务提交之前；任意准备错误让整个创建回滚。定向测试还证明没有调度 Model。它目前只是扩展点，尚未调用真实 Skill 路由，因此不能说迁移已经完成。
2. 问：为什么幂等重试不能重新准备？答：`clientRequestId` 代表同一个请求身份，原 Run 的内容与冻结依赖应当保持不变。重试首先读取权威 Run，指纹一致则返回原结果；若重新解析，激活的 Skill 或 Project 内容可能已变化，同一 Run 会出现两套事实。测试确认准备只在首次创建时执行，重试不会重新运行准备逻辑。
3. 问：Script Agent 路由遇到并列怎么办？答：可选择启用的 `prepareScriptSkillRun` 要求唯一选中。它把 T15 的路由决定和依赖冻结放到 Run 创建事务里；如果最高分并列或没有候选，准备抛出错误，整笔事务回滚，所以不会留下 queued Run、路由记录或已经调度的 Model。定向测试覆盖唯一选择与并列拒绝。当前生产入口尚未启用这条接缝，不能把测试结果外推到旧 Socket Agent。
4. 问：为什么不能从 Skill 的“当前激活版本”临时拼 Prompt？答：Run 创建时已有冻结的依赖计划及每条 Revision/哈希；ContextBuilder 重新读取这些证据并复核已发布内容、角色和撤销策略，再把指令计入强制预算。若临时读取当前激活指针，同一个 Run 在恢复后可能收到不同指令。测试核对 Bundle manifest 只留哈希、系统输入确实含冻结内容，且撤销后拒绝重读。旧 Model 无容量声明时 Skill 模式不会绕过预算。
5. 问：为什么提供了 Skill 指令后还要额外配置 Tool grant？答：指令文本不是权限。`skillMode` 用 Run 冻结的 Skill ID 调用受控 Tool 闸门，判定仍要求 Skill 请求、Tool 能力与四层外部 grant 同时成立；测试中即使四层 grant 都允许，Skill 未声明 Tool 也会在适配器执行前拒绝。新默认 Runtime 已接入只读 `read:novel` 的 Project 持久 grant 来源，但旧 Socket 路径和其他能力未迁移，故不能声称全面执行保护。
6. 问：为何新 Script Harness 要用独立 scope 和 Tool v2？答：旧 scope、v1 ToolDefinition 与 ToolReceipt 已有持久契约哈希。直接放宽 v1 的 scope 会让同一修订对应两份策略，既损坏历史证据，也可能无意授权旧路径。新 scope 要求 Skill 模式，v2 Tool 定义只允许该 scope 且拒绝无闸门调用；历史回执仍按 v1 读取。定向测试核对契约哈希不同及旧 Tool 回归。当前只读指导是迁移入口，不代表旧 Script 的规划与写入能力已有 v2 替代。
7. 问：怎样阻止旧端点绕过新入口的 Owner 校验？答：新启动路由从 JWT 中间件取 actor，准备事务再次核对 `o_project.userId`，失败会回滚 Run；运行时的 inspect、cancel、list 对新 scope 还要求 Owner 身份。旧路由不提供这项身份时不能看到或取消新 Run；专用控制路由把 JWT actor 传给运行时。定向测试覆盖伪造 body actor、错误 Owner 和无 Owner 调用。完整前端重连路径仍待接入。
8. 问：如何证明这不是只有拒绝、没有可用能力的空闸门？答：定向测试先由 Project Owner 开启持久 `read:novel` grant，再发布声明了 `get_novel_text` 的 Skill；Harness Run 冻结选中修订、ContextBundle 包含该指令，假 Model 发起受控读取后得到本 Project 章节。数据库中同时可核对 v2 ToolReceipt、允许的 PermissionDecision 和 Run 的最终成功状态。测试不调用真实 Provider，也不覆盖旧 Script Agent 的规划/Script 写能力。
