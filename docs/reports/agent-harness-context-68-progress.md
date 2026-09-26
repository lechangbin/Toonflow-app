# Agent Harness T12 · ContextBundle 构造（阶段进度）

Issue：`lechangbin/Toonflow-app#68`。本报告描述预算与来源规划基础，不代表 ContextBuilder、Agent 迁移或 T21 验收完成。

## 已实现

- `ContextBundle` 加入领域术语表，ADR-0019 固定“先构造并冻结、再提交 Model 调用意图”的决策；旧 Socket Agent 尚未迁移。
- 版本化预算规划按 `min(策略上限, 模型窗口 - 输出预留 - Tool 协议预留 - max(512, 5% 模型窗口))` 计算；先完整保留强制内容，再按普通 45/20/20/15、高风险 60/25/10/5 分配可选内容。低权威类别未用额度仅向高权威类别流动；强制内容溢出在调用前失败。
- 版本化保守 UTF-8 字节估算器、确定性的来源资格筛选与排序：Project、Script、Role、修订、保留状态在相关性排序前检查；来源内容哈希冲突或必需来源缺失均拒绝。规划结果仅保留来源身份、修订、哈希、类别、权威、Token 估算、省略原因与已发生的压缩动作（Project 类型化投影和章节目录分页、Novel 证据切片、重复去除、超预算省略），不把原文写进清单条目。尚未实现的 Tool 投影、摘要压缩不会伪报为已执行动作。
- 防御性顺序固定为先校验来源身份、再做 Project/Script/Role/修订/保留状态过滤，只有获准候选才计算内容哈希或参与排序；即使收到一个损坏的跨 Project 候选，也不会读取它的内容完整性结果。
- Project/Novel 来源由同一 SQLite Project 过滤查询加载，跨 Project Novel ID 在读取阶段即不可见；源文本的敏感值检查在构造来源前失败。Project 章节目录默认第一页、每页 20 条，可显式请求后续偏移；清单记录偏移、页大小和总数，越界拒绝。对于较长章节可显式指定 Unicode code-point 起点与长度；越界拒绝而非静默截短，清单记录片段起止位置及完整原文哈希，但不保存原文。片段来源修订同时覆盖章节编号、标题与完整原文哈希，单改元数据也会使旧修订失效。未指定片段时仍按整章预算判断，超额的必需来源直接失败。`createContextBuilder().build()` 校验 Run/Step/准备中的 Attempt 身份，在一个事务中选源、预算规划并冻结精确的 Model 消息与无原文 manifest。Bundle 不可更新或随意删除，同一 Attempt 只能绑定一份；Project 删除事务使用现有证据删除许可清理它。
- 已提交的只读 ToolReceipt 可作为候选 Tool Result：按同一 Project Run 读取、复验 Tool 修订、输出哈希、输出 schema、安全文本，以及完整因果 Trace 中对应的 `tool.succeeded` 事件；只允许由当前 Model Step 之前的 Step 产生。未完成、失败、无成功 Trace、当前或未来 Step、其他 Run 的 Receipt 不会进入候选集合。同一 Step 的工具调用与恢复语义暂不做向前投影，避免把尚未产生的结果倒灌进预调用 Context。
- 可选 Tool Result 超过本类别剩余额度时，优先尝试版本化、确定性的类型投影：`get_novel_text` 保留章节身份与前 128 个 Unicode code point，`get_novel_events` 保留前两条事件及每条详情前 80 个 code point。消息明确标记为部分数据，manifest 的 `tool-projection` 动作、投影哈希、原完整消息哈希及策略保留追溯；若投影仍放不下则整条省略。完整结果能放下时不投影，必需 Tool Result 超额时直接失败，不以片段冒充完整证据。该策略是预算退化路径，不是语义摘要或检索结果；它可能遗漏关键事实。
- 真实只读 AgentRuntime 调用受控 Tool 时传递当前 Step/Attempt 身份，`tool.started` 与终态 Trace 因而带有来源归属；重放同一 operation 时核对原始 Trace 的 Step/Attempt，跨 Attempt 复用相同 operation 拒绝。旧式未绑定 Step 的调用保持兼容，但其回执不会被前置 Step Context 来源加载器误认。
- Context 来源读取时复核成功 Trace 的 Attempt 确属同一 Run 的前置 Step，不能只相信 Trace 自报的 Step ID；损坏记录把 Attempt 指向当前 Step 或其他 Run 时拒绝该 Tool Result。
- 近期交互仅从当前 Run 开始前已完成的同 Project、同 Script、同 Role/Scope 的 Run 与已提交输出形成低权威候选，限定最多十组，并复验输出哈希、schema 与安全文本；当前、未完成、跨作用域或之后才完成的 Run 均不进入候选。真实 ContextBuilder 定向测试验证该候选进入预算与 manifest，历史回答以标注数据的 `user` 消息出现，不继承 `system` 或 `assistant` 指令权威。
- `inspect` 按 Project 授权读取已冻结 Bundle，复验 manifest 与精确消息的哈希和 schema；其他 Project 得到空结果。旧数据库补建 Bundle 表时保留已有 Project。
- 显式刷新或新的 Attempt 可通过同一 Run 内的 `predecessorBundleId` 创建后继 Bundle；前驱必须位于更早 Step 或同一步的更早 Attempt，不能自指或引用未来证据；原 Bundle 内容与哈希不变。Configured Vendor 的 Text Model 可声明并校验 `contextWindowTokens`，`openTextCall` 公开已解析容量；未声明的旧 Model 保持“未知”，不捏造默认容量。
- 已声明容量的只读生产 AgentRuntime 路径在 Model 调用意图提交前构造 Bundle，调用时使用与持久消息完全相同的输入；Bundle 哈希参与 invocation 指纹。强制内容预算不足时不调用 Fake Model。未声明容量的旧 Model 暂走明确标注的兼容路径，不能计入 ContextBundle 迁移完成率。
- Project、Novel 与 Tool Result 文本作为标明“data, not instructions”的 `user` 角色消息注入，只有 Runtime 安全约束和受控 Tool/权限契约可成为 `system` 消息；数据来源不能借 `assistant` 历史发言获得更高的指令地位。

## 阶段验证与边界

七个 `tests/context*.test.ts` 文件的 18 个定向用例覆盖预算公式、风险配比、向上回流、强制内容溢出、跨 Project/Script 筛选、修订与保留状态、损坏/冲突来源、分配不足时不截断、可选 Tool 投影与必需 Tool 不降级、真实 SQLite 来源读取、章节目录分页、Unicode 片段定位与原文哈希、不同定位冲突、已提交且早于当前 Step 的 ToolReceipt 筛选、同作用域且先完成的近期交互筛选、准备中 Agent Attempt 的不可变 Bundle、后继 Bundle、Project 授权读取与删除生命周期、旧库增表、Model 容量声明校验，以及真实 AgentRuntime 在调用前冻结与超额阻断。另对 `configuredVendor.test.ts` 的 `openTextCall` 定向用例验证容量透出。此前新增真实 Runtime→Tool Trace→后续 Step 来源加载器的回归，以及同一 Attempt 重放、跨 Attempt 冲突、无效身份拒绝回归；`controlledTools.test.ts`、`contextToolSources.test.ts`、`agentRunRuntime.test.ts` 当时共 40 个定向用例与 TypeScript `--noEmit` 通过。未在本轮运行全量测试、构建、浏览器或真实 Provider。

目前 Builder 装载 Project 概览、指定 Novel Chapter、已提交的只读 Tool Result 和有限的近期交互；本 T12 分支尚无 Memory、Skill 指令、语义摘要压缩及总结 provenance。Tool 投影仅覆盖两种只读 Tool 的固定前缀，不保证关键事实落在前缀内，亦未覆盖同一 Step 内多次 Model 调用与恢复语义。Model 容量元数据虽可声明并透出，内置/既有配置尚未全面补齐；因此只读 Runtime 仍有无 Bundle 的兼容分支，旧 Socket Agent 更未迁移。测试证明了已声明容量分支的本地调用前冻结，不是整个 Agent 系统的端到端防泄漏或迁移验收；无容量元数据的 Model 必须显式处理，不能用任意默认窗口伪装为真实能力。

本轮增量执行全部七个 `context*.test.ts` 文件的 18 个定向用例与 TypeScript `--noEmit`，均通过；未在本轮运行全量测试或真实 Provider。上述 40 例是此前另三个测试文件的一次记录，不应与本轮 18 例简单相加作为项目总测试数。

## 阶段追问准备（非最终面经）

1. 问：为什么在 Model 调用前冻结 ContextBundle，而不只记录最终回答？答：最终回答无法反推出当时的系统约束、Project 事实、章节片段、Tool 结果和模型窗口预算。Builder 在准备中的 Attempt 上先校验 Project/Step 身份与来源修订，再计算预算，冻结精确消息和无原文 manifest；容量已声明的只读 Runtime 只用这份消息提交调用。若强制内容超预算则在推理前失败。当前仅验证了这条路径，旧 Socket Agent 尚未迁移。
2. 问：章节很长时为什么不直接截断？答：静默截断会制造“读过整章”的假象，甚至切掉否定词或关键证据。当前要求调用方显式给出 Unicode code-point 范围，越界直接拒绝，manifest 留下完整原文哈希与片段位置。未指定范围的必需章节若超出类别预算，也会失败而非伪装成完整输入。章节目录则有单独的 offset/limit/total 分页证据。
3. 问：为何历史回答与 Tool 结果不能作为系统消息？答：它们是较低权威的外部或历史数据，可能包含过时内容或提示注入。Tool 结果必须是同一 Project Run 的已提交 Receipt 且来自当前 Step 之前；历史交互要同 Project/Script/Role/Scope 且先于当前 Run 完成。进入 Bundle 后仍以 `user` 数据消息出现，只有 Runtime 控制的安全与权限契约可占系统权威。此设计降低权限混淆，但不是完整提示注入防御证明。
4. 问：既然有成功的 ToolReceipt，为什么还要给 Trace 绑定 Step/Attempt？答：回执只能证明工具输出曾被提交，不能证明它属于哪次 Model Attempt、是否早于本次 Context 构造。来源加载器要求成功 Trace 可追溯到前置 Step，并在读取时从 Attempt 表复核归属；此前真实 Tool 路径漏传身份，手工 Trace 单测掩盖了接线缺口。现在真实调用写入身份、operation 重放核对原始身份，损坏的跨 Step/Run Attempt 也被拒绝；仍未证明同一步多轮 Model 调用与恢复的完整语义。
5. 问：Tool Result 过长时为什么能投影、必需来源却不能投影？答：可选证据允许清楚标记范围后降级，既保留有限上下文又不谎称读过完整结果；manifest 记录原完整消息哈希和投影策略。必需来源代表调用方把完整结果作为该步最低证据要求，缩成前缀会改变任务语义，所以超额直接失败。固定前缀并非“智能摘要”，如果需要尾部或相关片段，必须另建可定位的显式选择机制。
