# Agent Harness T05 面经：Attempt、Checkpoint 与重启恢复

> 本文按用户约定只提供功能实现、证据边界与面试准备，不包含项目简介、简历 bullet 或 HR 文案。共 15 个主问：Agent Harness 8 个、Agent 应用开发 4 个、AI 应用后端 3 个；每题含 2 个追问，共 45 段第一人口播。

## 一、Agent Harness（8 个主问）

### 1. 为什么要把 Agent Step 和 Agent Attempt 分开建模？

**第一人口播：** 我把 Step 定义为 Run 中稳定的逻辑工作，把 Attempt 定义为执行这个 Step 的一次物理尝试。原因是进程中断或显式重试不应该把原来的 startedAt、失败原因和模型目标覆盖掉，也不应该伪造一个全新的业务步骤。每个 Attempt 都保留 ordinal、reason、状态、调用指纹和前驱，后继只能在已接受的恢复策略下产生。这样 inspect 能回答“业务要做哪一步”和“这一步实际试了几次”两个不同问题。当前只实现单 Model Step 的线性 Attempt 链，还没有多步骤并行或用户任意 retry，所以我不会把它说成通用工作流引擎。

**追问 1：为什么不用 Step 上的 retryCount？**

**第一人口播：** retryCount 只能告诉我发生过几次，不能证明每一次使用了什么 resolved target、何时开始、为什么结束，也不能表达一次恢复尝试与前一次中断之间的因果关系。如果覆盖 Step 字段，旧证据会丢失；如果不断往 JSON 数组追加，又失去数据库约束和可查询性。我选择独立 Attempt 表，并用 `(runId, stepId, ordinal)` 与 predecessor 唯一约束防止重复和分叉。代价是查询需要聚合，但恢复判断更可靠。当前 predecessor 只形成单链，不支持从同一失败尝试派生多个实验分支，这是刻意的安全限制。

**追问 2：什么情况下才允许创建新的 Attempt？**

**第一人口播：** 我不把“进程重启”直接等同于“可以重试”。只有最新可信证据仍在调用意图边界之前，能够证明 Provider 没有被调用，并且命中明确的 restart-safe policy，才允许把原 Attempt 标为中断并创建唯一因果后继。只要 `model-call-intent` 已提交而终态未提交，就属于 unknown-effect，不创建新 Attempt，也不再次调用模型。成功或失败终态同样不会在 readiness 中偷偷重试。当前没有面向用户开放的任意 retry API，后续若加入，也必须带预期版本、原因和效果确定性检查。

### 2. `model-call-intent` Checkpoint 解决了什么问题？

**第一人口播：** 本地 SQLite 和远端模型服务不能共享一个原子事务，所以真正的问题不是“怎样实现 exactly-once”，而是“崩溃后如何知道是否安全重放”。我在 Provider 调用前用短事务提交 `model-call-intent`，同时保存安全的模型目标、调用指纹和 Attempt running 状态。事务失败就绝不调用 Provider；事务成功后如果进程中断，恢复器保守认为请求可能已经发出，进入 waiting/attention，不自动重放。这个边界把 known-no-effect 与 unknown-effect 分开，但它不是远端已接收的回执，也没有消除不确定窗口。

**追问 1：为什么 intent 提交后、真正发请求前崩溃也按 unknown-effect？**

**第一人口播：** 因为重启后的进程只能看到持久化事实，无法证明旧进程是在提交返回后的哪一条机器指令上退出。即使某次实际发生在网络调用前，统一按 known-no-effect 自动重试也会错误覆盖另一种情况：旧进程已经发出请求，只是来不及提交终态。我宁愿让少量实际上安全的任务停下来，也不冒重复计费或两份不同答案的风险。若未来 Provider 支持由我方提供幂等键并可查询请求状态，才能用 reconcile 缩小这个窗口，而不是靠本地时间猜测。

**追问 2：能否把 Provider 调用放进数据库事务来消除窗口？**

**第一人口播：** 不能真正消除。数据库回滚无法撤销已经发给 Provider 的请求，网络超时也不能证明远端未执行；与此同时，长事务会在模型延迟期间占用 SQLite 写锁，影响其他本地写入并增加 busy 冲突。我采用创建、调用意图、终态三个短事务，网络调用完全在事务外，把跨系统不原子的事实通过 Checkpoint 和恢复策略暴露出来。结果不是 exactly-once，而是本地提交可证明、未知远端效果不静默重放。真实 Provider 的幂等协议属于后续能力，T05 没有假设它存在。

### 3. 为什么 Checkpoint 要不可变、版本化并形成哈希链？

**第一人口播：** Checkpoint 是恢复决策的证据，不是可以随状态覆盖的缓存。如果只保留一行最新快照，程序缺陷或升级可能抹掉“调用意图已提交”这个关键事实，恢复器就可能错误重试。我让每条 Checkpoint 记录 schemaVersion、Run revision、sequence、前驱、规范化 payload 和 payloadHash，只追加不更新；数据库触发器拒绝普通 UPDATE，前驱唯一约束防止分叉。恢复时还会重新解析和重算哈希，而不是只相信 TypeScript 类型。哈希用于检测意外篡改，不是带密钥签名，无法防御拥有数据库文件权限的恶意重写。

**追问 1：为什么有 sequence 还需要 predecessor？**

**第一人口播：** sequence 能表达 Run 内顺序，也能用唯一约束阻止同一序号重复，但仅凭连续数字无法证明一条新证据是基于哪条既有证据追加的。predecessor 把因果前态显式写进记录，唯一约束还能防止两个并发写者从同一尾节点各自派生后继。两者结合后，校验器可以检查顺序连续、前驱归属一致和链无分叉。当前是单机 SQLite，约束足以服务这个切片；如果未来允许多 worker，还要配合租约和 fencing，不能把哈希链误当作分布式一致性协议。

**追问 2：payloadHash 怎样避免 JSON 字段顺序造成误判？**

**第一人口播：** 我不会直接对任意 `JSON.stringify` 结果建立契约，而是先按 Checkpoint schema 解析，只保留允许字段，再使用递归键排序的确定性形式序列化，最后计算 SHA-256。读取时走同一 codec 并严格拒绝未知或缺失字段，才能保证本实现内的等价 payload 得到相同结果。若 schema 变化就升级 schemaVersion，由对应解析器解释，而不是让旧代码猜测。实现位于 `src/agentRuntime/checkpoints.ts`；它是 Toonflow 当前 TypeScript Runtime 的内部规范化协议，我不会把它夸大为已经验证过的跨语言 canonical JSON 标准。

### 4. 你的重启恢复矩阵是如何设计的？

**第一人口播：** 我不是只测“运行中崩溃”一个宽泛场景，而是围绕每个提交边界前后建立矩阵：创建事务前后、调用意图前后、Provider 响应前后、成功事务前后，以及损坏或不兼容证据。每格都明确四件事：数据库中有哪些可信记录、远端效果属于 known、unknown 还是 committed、能否创建后继 Attempt、重启是否允许调用 Provider。最关键的断言是 intent 后无终态绝不重放，成功提交后复用 Output。当前矩阵针对单 Step 与受控 fake Provider，不等于真实断电、多进程或 Provider 幂等验收。

**追问 1：怎样做到“恰好在提交前后”中断？**

**第一人口播：** 我会在 Runtime 依赖或内部提交边界加入只供测试使用的确定性 fault hook，并结合 SQLite 触发器制造事务最后一条 SQL 失败。hook 用于验证某次提交完成后立即退出的恢复行为，触发器用于验证同一事务前面的写入是否真实回滚。测试每次重新打开文件数据库，运行 readiness，再检查 Provider 调用次数、Attempt/Checkpoint 链、Output 数量和 Run version。最终 hook 名与测试数字要在实现收口后补齐。它仍是受控故障注入，不代表操作系统强杀或磁盘断电已经验证。

**追问 2：恢复函数为什么必须可重复执行？**

**第一人口播：** readiness 本身也可能在处理中断，而且应用可能多次启动，所以同一数据库状态被扫描两次不能继续创建后继 Attempt、重复追加 attention 或再次调用 Provider。我让恢复操作依赖当前 Run version、最新可信 Checkpoint 和唯一 predecessor，写入后再次扫描会看到已经收敛的状态并保持不变。并发扫描若都尝试派生后继，唯一约束和条件更新只允许一个成功，另一个必须权威重读。当前阶段仍是单进程启动路径的聚焦证明，多进程并发恢复要等租约与 fencing 阶段再完整覆盖。

### 5. 已成功提交的 Output 如何在重启后复用？

**第一人口播：** 成功不是先写状态再晚点写结果，而是在一个短事务中原子提交 Output、Attempt/Step/Run 成功状态、Run 的 last committed Step 游标、成功 Checkpoint 和安全 Trace。Checkpoint 不复制模型正文，只记录 Output 身份、schema version 与 contentHash。若进程在提交后、向客户端响应前退出，重启会验证 Checkpoint 链、Output 归属和哈希，然后直接从数据库投影同一结果，不再调用 Provider。这样避免重复计费与答案漂移。若引用缺失或哈希不匹配，就 fail closed，而不是用重新生成来“修复”。

**追问 1：为什么不把完整输出直接放进 Checkpoint？**

**第一人口播：** Output 已经有独立的持久化契约、内容门禁、schema version 和 contentHash，把正文再复制一份会增加敏感数据暴露面、存储增长和两份事实不一致的风险。Checkpoint 的职责是证明提交边界，只需要安全引用即可。恢复时同时校验 ID、Run/Step 归属和 contentHash，能确认引用内容仍与提交时一致。如果 Output 被删除或修改，系统会报告证据损坏并停止，而不是从 Checkpoint 复制旧正文。这个设计依赖 Output 与终态证据同事务提交，不能分成两个最终一致写入。

**追问 2：如果模型返回了内容，但成功事务提交失败怎么办？**

**第一人口播：** 内存里的模型结果不算 Checkpoint，也不能在重启后被当作已提交输出。终态事务任一写入失败都会整体回滚，因此数据库里不会出现“有成功 Output 但 Run 仍 running”的半提交。由于调用意图已经存在，远端效果属于 unknown-effect，系统不能再次调用模型来补写；它应进入 attention，等待后续 reconcile 或人工处置。这个选择会牺牲自动恢复率，但保持不会静默重复外部调用。当前没有安全保存 Provider 原始响应作为恢复材料，因为那会扩大隐私和契约范围。

### 6. Checkpoint 损坏或版本不兼容时如何处理？

**第一人口播：** 我把 corruption 和 incompatible 分开。corruption 包括 payloadHash 不匹配、前驱断裂或分叉、sequence 异常、Run/Step/Attempt 引用错位、成功 Output 缺失或 hash 不一致；incompatible 是 schemaVersion 高于当前解析能力。两类都禁止继续调度和 Provider 重放，并只写安全、枚举化的诊断。非终态 Run 可以收敛到 waiting/attention；已经 succeeded 或 failed 的 Run 保持终态，只通过正交 attention 暴露问题。这样不会为了告警而篡改已提交业务事实。当前不提供自动修复工具，恢复备份或升级需人工完成。

**追问 1：为什么不忽略无法识别的字段，尽量继续？**

**第一人口播：** 对展示配置可以考虑宽松兼容，但 Checkpoint 决定是否再次触发外部副作用，错误解释的代价是重复计费或写入。一个新字段可能改变效果确定性、引用语义或恢复策略，旧程序若静默忽略，就会在不知道新契约的情况下调度。我因此采用严格 schema 和显式版本解析，不支持时 fail closed，并把处置指向升级或人工检查。代价是降级运行不够便利，但这是安全控制面应有的偏好。未来可支持多个已知旧版本解析器，仍不能用 catch-all cast 绕过验证。

**追问 2：诊断怎样避免泄漏用户输入或 Provider 数据？**

**第一人口播：** 校验器只把受控的损坏类别、Checkpoint ID、schema version 和安全处置码交给 Trace，不回显 payload 正文、模型输出、提示词、原始异常对象或 Provider 响应。即使解析失败，也不会把 `JSON.parse` 周围的原字符串拼进错误消息。诊断再经过既有 Trace-safe schema 验证，inspect 读取持久化诊断时也重新校验。这样排障信息会少一些，但不因恢复失败扩大秘密暴露面。数据库管理员仍能直接读取业务表，这是访问控制与保留策略问题，不由 Trace 脱敏单独解决。

### 7. T04 数据库如何升级到 T05，又怎样避免伪造历史？

**第一人口播：** 新数据库直接创建 Attempt、Checkpoint 表和不可更新触发器；旧 T04 数据库通过初始化补表，并为 Run 增加可空的 last committed Step 游标。关键点是我不为历史 Run 批量生成看似完整的 Checkpoint，因为旧版本从未在对应边界原子提交这些证据，迁移无法事后证明当时发生了什么。历史记录可以继续 inspect，但恢复资格要按兼容策略显式限制；新建 Run 才获得完整 T05 语义。升级测试需要从真实 T04 fixture 出发，验证数据保留、重复迁移幂等和新约束生效，最终数字仍待实现完成后登记。

**追问 1：为什么 lastCommittedStepId 设计成可空？**

**第一人口播：** 可空同时表达两种诚实状态：新 Run 尚未提交任何 Step，或历史 Run 没有足够证据安全回填。若强制非空，迁移要么失败，要么被迫制造一个并不存在的已提交 Step，都会污染恢复语义。成功终态事务会在具备证据时写入游标，Checkpoint 还会记录对应 Run revision 和 last committed Step，用于交叉验证。可空并不意味着恢复器随意跳过校验；它必须结合 schema 代际和 Checkpoint 链解释。后续多 Step 场景还需定义游标是否代表连续前缀，而非任意完成节点。

**追问 2：触发器在重复初始化时如何处理？**

**第一人口播：** 触发器使用可重复创建的数据库语句，初始化多次不会生成多个同名触发器；新表创建与加列也走已有的 schema existence 检查。测试不仅要看新库能创建，还要从 T04 数据库运行完整初始化和 fixDB，再运行第二次确认幂等，并实际执行一次 Checkpoint UPDATE 断言被 SQLite 拒绝。触发器只约束 UPDATE，删除生命周期仍需结合外键和项目清理策略核对。最终迁移命令与行为要以合并代码为准，在聚焦测试完成前我不会声称所有历史数据库版本都已覆盖。

### 8. 你如何证明 T05 的契约成立，又如何陈述测试边界？

**第一人口播：** 我按主张建立聚焦证据：Schema 测新库、升级、唯一约束与不可变触发器；codec 测确定性哈希、篡改、不兼容和错引用；Runtime 测初始 Attempt、调用意图、终态原子提交与 Output 复用；Recovery 按 restart matrix 断言 intent 前后策略和 Provider 不重放。阶段命令覆盖 Runtime、Schema、Routes 三个文件，实际是 32/32，通过 TypeScript 检查和 diff check。按用户约定，本阶段不跑仓库全量测试、完整 build 或 Web E2E，所以我只说 T05 聚焦契约通过，不能说项目整体已验收。

**追问 1：为什么 Provider 调用次数是关键断言？**

**第一人口播：** 只断言 Run 最终变成 waiting 或 succeeded，无法证明恢复过程中没有先错误调用一次 Provider 再修改状态。fake Provider 的 invoke count 能直接验证最重要的负向主张：intent 后 unknown-effect 不重放，成功提交后复用 Output 也不重放；intent 前若策略允许后继 Attempt，则只发生一次新调用。我还会把计数与 Attempt/Checkpoint 链、Output 数量一起断言，避免某个 mock 被绕开。它证明受控 Runtime 行为，不代表真实 Provider 自身不会在网络层重复处理请求。

**追问 2：为什么不在每个阶段都跑全量测试和构建？**

**第一人口播：** 这是本路线明确约定的验证节奏：每阶段用最相关的单元、契约和静态检查快速证明局部不变量，把 App/Web 全量、完整 build、打包与浏览器 E2E 留到所有阶段后的统一验收。我会把未执行项写进报告，避免“测试通过”被误解为系统级结论。这种安排可能延后发现跨模块回归，所以最终验收清单必须保留且不能省略。当前阶段也不会更新 checked-in bundle 来冒充 build 结果；若源码与产物尚未重新构建，会明确记录两者边界。

## 二、Agent 应用开发（4 个主问）

### 9. Attempt 与 Checkpoint 应该怎样呈现给最终用户？

**第一人口播：** 最终用户不需要先理解内部表名，但需要知道任务是“正在执行、可以安全重试、结果未知需关注，还是已完成可复用”。我会把 Run status 和正交 attention 作为主要 UI 状态，把 Attempt 数量、上一次中断原因和最近可信提交边界放在可展开的诊断区域。`model-call-intent` 之后的中断应显示“结果无法确认，系统没有自动重试”，而不是笼统失败。当前 T05 主要交付 App 侧持久化与投影基础，Web 端页面、文案和交互尚未完成，因此我只描述应有信息架构，不声称浏览器体验已验收。

**追问 1：为什么不能直接显示“重试”按钮？**

**第一人口播：** 一个统一重试按钮会掩盖效果确定性差异。调用意图之前的 known-no-effect 可以在带版本校验的策略下安全创建后继 Attempt；意图之后可能已经产生 Provider 计费或结果，直接重试会制造重复。UI 应根据 allowed action 和 attention reason 决定是否提供“安全恢复”“等待核对”或“联系处理”，不能只根据 status=waiting 推断。当前还没有用户 retry/reconcile 命令，所以 Web 即使看到 attention 也不应伪造可执行操作，最多提供刷新和诊断信息。

**追问 2：内部 Checkpoint kind 是否应该原样展示？**

**第一人口播：** 默认不应该。`model-call-intent`、hash mismatch 这类名称适合证据面板和开发排障，普通用户更需要“模型请求可能已经发出，未自动重试”这种面向后果的说明。我会让 API 保留版本化 reason code，Web 用稳定映射生成文案，并在高级详情里显示受控 ID 和时间，不显示 payload。这样协议可审计，产品语言也不被内部枚举绑死。当前 Web 映射尚未实现，文档里的建议不是已上线功能；最终还要用可用性与本地化测试验证文案是否准确。

### 10. 页面刷新后如何保持同一任务与同一结果？

**第一人口播：** 浏览器不应把 Socket 消息或内存 token 当事实源。页面持有 Run ID 与 Project ID，通过 inspect 重新读取持久化 Run、Step、Attempt、Checkpoint 摘要和 Output 投影；消息 ID 仍稳定派生自 Run，Run version 用于拒绝旧快照覆盖新状态。如果成功事务已经提交，即使原页面没收到响应，刷新也会复用同一 Output，而不是启动新模型调用。T05 的重点是服务端恢复语义，Web 实际如何保存 Run ID、轮询和渲染历史 Attempt 仍待后续跨仓库接线及 E2E。

**追问 1：流式 token 为什么不能用于刷新恢复？**

**第一人口播：** token 是传输中的部分表现，可能缺字、乱序、重复，也可能在 Provider 最终失败后仍留在页面；把它当 Checkpoint 会让用户看到一个系统无法证明完整性的“结果”。T05 只把经过持久化门禁并与终态同事务提交的 Output 视为可复用结果。刷新时进行中的 token 可以丢失，UI 回到持久状态，这是刻意选择。未来若要恢复流式体验，需要单独设计可验证的 chunk ledger、完成标记与保留策略，不能把现有 Socket 缓冲直接升级为业务事实。

**追问 2：两个页面同时查看时如何避免旧状态覆盖？**

**第一人口播：** 两个页面都只读同一数据库快照，不因 inspect 次数推进状态；客户端按稳定 Run/message ID 合并，并只接受 version 不低于当前版本的投影。Attempt 与 Checkpoint 摘要也应以 ordinal 或 sequence 排序，不能按网络到达顺序追加。服务端状态提交与 version 递增在同一事务，给客户端提供单调依据。当前 App 契约能提供 version，但 Web 的比较逻辑和多标签页测试尚未完成，所以我会把“协议具备去旧覆盖基础”和“前端已验证”明确分开。

### 11. 这套恢复机制怎样影响 Agent 产品的可解释性？

**第一人口播：** 我把可解释性限制在可核验的执行事实，而不是暴露模型隐藏推理。用户或运维可以看到 Run 做了哪个逻辑 Step、产生了几次 Attempt、最近哪个提交边界可信、为何系统拒绝自动重试，以及最终 Output 是否可复用。Trace 负责安全说明，Checkpoint 负责恢复证明，两者职责分开。这样“为什么停住”可以用状态与证据回答，不需要保存 chain-of-thought 或 Provider 原始负载。当前仍缺少 Web 时间线和人工处置界面，所以可解释数据已设计，并不等于完整的可解释产品体验。

**追问 1：Trace 和 Checkpoint 为什么不能合并？**

**第一人口播：** Trace 面向解释与观测，可以记录生命周期事件和安全诊断；Checkpoint 面向调度安全，必须不可变、版本化、哈希校验，并与 Run revision 和提交事务严格绑定。若恢复器直接依赖 Trace，未来调整文案或增加观测事件可能改变调度语义；若所有 Trace 都按 Checkpoint 强约束，又会让普通观测成本过高。我让 Checkpoint 只覆盖少数关键边界，Trace 可以引用或解释这些边界，但不能替代它们。当前两者都会避免隐藏推理和原始 Provider 负载。

**追问 2：如何向用户解释“系统不知道远端是否成功”？**

**第一人口播：** 我会直说“模型请求可能已经发出，但本地没有收到可确认的最终结果；为了避免重复执行，系统没有自动重试”，并给出发生时间、任务标识和下一步，而不是显示抽象的 unknown-effect。若 Provider 后续支持状态查询，界面可以提供“核对远端结果”；否则只能等待人工判断或显式放弃。文案必须避免暗示数据已经丢失或一定计费，也不能承诺重新点击一定安全。当前 T05 只提供 reason/attention 基础，最终用户文案与操作仍属于后续应用开发。

### 12. 将来开放写工具时，T05 的设计能复用到什么程度？

**第一人口播：** 可复用的是执行控制骨架：逻辑 Step 与物理 Attempt 分离、外部副作用前提交意图、终态与产物原子落库、未知效果不静默重放、损坏证据 fail closed。但写工具比只读模型调用更复杂，每个工具需要独立的 idempotency key、权限与审批、effect receipt、补偿或 reconcile 语义，不能把 `model-call-intent` 原样套用为万能 Checkpoint。当前 T05 只对固定只读项目指导和一次模型调用负责，没有 action ledger，也没有人机审批，所以我会说它提供基础，而不是已经支持生产写操作。

**追问 1：工具调用能否共用一个 Run 级 intent？**

**第一人口播：** 不足够。一个 Run 可能依次调用多个工具，每个工具的副作用、幂等能力和可核对方式不同；只写 Run 级 intent 无法判断具体哪一个动作已经越过安全边界。后续应为每个 Action 或工具 Step 保存独立意图、参数指纹、权限决策、外部 receipt 和终态，并把 last committed Step 理解为连续提交前缀。T05 只有一个 Model Step，所以 Run 与 Step 边界看起来接近，我会主动说明这个简化，避免把单步设计过度推广到多工具编排。

**追问 2：审批应该放在 intent 前还是后？**

**第一人口播：** 对有副作用的工具，审批必须在外部调用意图之前完成并作为可验证输入，否则 intent 已提交却发现没有授权，会混淆“计划执行”和“允许执行”。审批本身也要绑定规范化动作摘要、版本和有效期，防止批准后参数被替换。intent 提交后再调用工具，崩溃仍按工具的效果确定性处置。T05 没有审批表和工具执行器，因此这里只能给出演进原则，不能声称现有 Checkpoint 已经证明用户授权；后续需要单独 ADR 和威胁模型。

## 三、AI 应用后端（3 个主问）

### 13. SQLite 下怎样保证 Attempt 与 Checkpoint 不分叉？

**第一人口播：** 我用结构约束和条件写入共同防守。Attempt 在 `(runId, stepId, ordinal)` 上唯一，`predecessorAttemptId` 也唯一；Checkpoint 在 `(runId, sequence)` 上唯一，`predecessorCheckpointId` 唯一。创建后继前仍要读取当前尾节点，并以 Run version、状态和受影响行数做乐观并发检查。两个并发恢复者从同一前驱派生时，最多一个插入成功，另一个不能换个 ordinal 偷偷继续，而要回滚并重读权威链。当前没有多 worker 租约，因此这些约束防止数据分叉，但不等于解决长时间 ownership 和脑裂执行。

**追问 1：为什么唯一约束不能替代 Run version？**

**第一人口播：** 唯一约束只防止某种重复形状，不能证明我基于的聚合状态仍然有效。例如另一个事务可能先把 Run 变成 succeeded，但我的 predecessor 仍是唯一的；如果没有 status/version 条件，我仍可能追加一个语法上不冲突、语义上非法的恢复 Attempt。Run version 把“我读到的快照”绑定到更新前态，affected rows 不为一就触发回滚。反过来，version 也不能替代唯一约束，因为两个写者可能在不同路径上产生重复 identity。两层一起才能守住领域和数据库竞态。

**追问 2：遇到 SQLITE_BUSY 会怎样处理？**

**第一人口播：** 当前策略应只对可证明幂等、身份不变的短事务做有限重试，并在冲突后重读权威状态；不能把包含 Provider 调用的整个流程重跑。创建 Run 在 T04 已使用相同幂等身份处理瞬时 busy，T05 的 Attempt/Checkpoint 写入也必须保持短事务和唯一身份。持续锁竞争应向上暴露并进入安全状态，而不是无限自旋。最终具体 retry 次数和 busy 配置要以合并实现与测试为准。阶段不会做高并发压力测试，因此我不把聚焦双连接或注入测试解释成生产吞吐证明。

### 14. Checkpoint 的 hash、schemaVersion 和 runVersion 分别解决什么问题？

**第一人口播：** payloadHash 检测这条证据的规范化内容是否被意外修改；schemaVersion 决定用哪套字段与语义解析，避免旧代码猜新格式；runVersion 把证据绑定到它所证明的 Run 聚合 revision，帮助发现版本倒退、跳跃或错误归属。三者互补：hash 相同不代表解析语义受支持，版本受支持不代表内容没变，Run revision 合理也不代表引用的 Output 正确。恢复还要检查前驱、sequence、Step/Attempt 归属和 Output contentHash。当前 hash 没有密钥，提供完整性检测而非来源认证。

**追问 1：为什么不直接依赖数据库 WAL？**

**第一人口播：** WAL 保证 SQLite 自身事务的原子性和崩溃恢复，但它不会告诉业务某次提交代表“调用意图”还是“成功输出”，也不会验证应用升级后能否理解旧 payload，更不能协调远端 Provider。Checkpoint 建立的是领域层提交语义，WAL 是其底层持久化基础，两者不是替代关系。即使 WAL 完全可靠，应用仍可能因 bug 写入错误引用或把状态顺序推进错，所以读取端需要 schema 和链校验。当前设计依赖 SQLite 事务可靠性，不尝试自己实现存储引擎日志。

**追问 2：哈希链会不会让迁移和清理很困难？**

**第一人口播：** 会增加约束，所以需要把保留与归档作为显式设计，而不能随意删除中间行。当前阶段 Run 生命周期删除可以整体清理关联证据，但不支持保留后半条链、删除前半条；历史 T04 记录也不会强行接入伪造链。未来若数据增长需要归档，可以生成经过验证的归档根或压缩证明，再从明确版本边界开始新链，并用 ADR 固化语义。T05 尚未测存储增长，也没有归档工具，因此我只把完整链用于当前规模，不宣称它已经解决长期数据治理。

### 15. 这套方案还存在哪些后端风险，下一步怎样演进？

**第一人口播：** 最大边界是它只证明本地提交，不证明 Provider 的真实效果。intent 后无终态只能停住，尚无查询式 reconcile；系统也只有单进程调度语义，没有租约、fencing、取消竞争或多 Step DAG。Checkpoint hash 不是签名，文件级篡改仍超出防线；SQLite 性能和存储增长未压测；Web 也未接线。下一步应先在 T06 增加 worker ownership、租约与 fencing，再定义取消和重连竞争，之后才做 Provider receipt、人工裁决和工具 action ledger。所有阶段完成后统一跑全量 App/Web、build、E2E 与真实故障验收。

**追问 1：租约和 fencing 为什么不能由 Checkpoint 取代？**

**第一人口播：** Checkpoint 记录已经提交的事实，却不能阻止一个失去所有权的旧 worker 在暂停后恢复并继续调用 Provider。租约回答“当前谁有权执行”，fencing token 让后续写入或外部调用能拒绝过期 owner；Checkpoint 回答“此前哪个边界已经提交”。如果只有哈希链，两个 worker 可能都在读到同一尾节点后发起网络请求，数据库最终只接受一条后继也无法撤销另一条远端调用。因此 T05 仍假设受控单 worker，真正多 worker 安全要在后续阶段单独实现和测试。

**追问 2：最终验收应补哪些证据？**

**第一人口播：** 最终要运行仓库全量单测与完整 App/Web build，核对生成路由、数据库类型和 checked-in 产物；做浏览器 E2E，覆盖刷新、双页面版本乱序、attention 与 Output 复用；用文件数据库和真实进程强杀覆盖每个 restart boundary，再做多进程锁竞争和租约过期；对受控 Provider 验证成功、超时、限流、未知结果与可查询 receipt；最后测事务时长、busy、恢复耗时和存储增长。当前阶段只完成聚焦单元/契约和静态检查，任何全量、构建或真实服务数字都不能提前写成结果。

## 四、源码证据索引

| 主题 | 关键路径与内部符号 | 对应问题 |
| --- | --- | --- |
| Attempt/Checkpoint 领域定义 | `CONTEXT.md`：`Agent Attempt`、`Agent Checkpoint` | 1、3、11 |
| 架构决策 | `docs/adr/0012-separate-agent-attempts-from-commit-checkpoints.md` | 2、3、12、15 |
| Attempt/Checkpoint Schema | `src/lib/initDB.ts`：`o_agentRunAttempt`、`o_agentRunCheckpoint`、immutability trigger | 1、3、7、13 |
| T04 数据库升级 | `src/lib/fixDB.ts`：`lastCommittedStepId` 与初始化兼容 | 7 |
| Checkpoint codec 与 validator | `src/agentRuntime/checkpoints.ts`；`src/agentRuntime/index.ts` 的 `validateCheckpointRows` / `validateCheckpointEvidence` | 3、6、14 |
| Runtime 提交边界 | `src/agentRuntime/index.ts` 的 `createAgentRuntime` / `execute` / `settleFailure` | 2、5、13 |
| Attempt 恢复策略 | `src/database/agentRunRecovery.ts` 的 `recoverCheckpointedRun` | 1、4、6、15 |
| Output 复用 | `src/agentRuntime/index.ts` 的 `validateCheckpointEvidence` 与幂等 `start` | 5、10 |
| UI 投影契约 | `src/agentRuntime/index.ts` 的 `projectAgentRunToChatMessage` 与 Attempt/Checkpoint snapshot | 9、10、11 |
| Restart matrix 聚焦测试 | `tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts`、`tests/agentRunRoutes.test.ts`；32/32 | 4、8、13、15 |
