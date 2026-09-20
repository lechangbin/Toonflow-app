# Agent Harness T02 面经：18 例 Golden Eval 基线

> 按本次交付要求，本文省略项目简介与简历 bullet，只保留面试问题、第一人称 STAR 口播、源码证据索引和高风险 Claim。事实边界：当前可验证结论仅是 deterministic local fake 执行层的 case 级 hard-gate `18/18`；人工质量为 `0/18 reviewed`、`18/18 pending`。本文不声称已经上线、获得真实 Provider 质量、性能收益或人工质量结论。T02 仍调用冻结基线的领域公开边界；T03 先统一诊断与脱敏，T04 引入首个持久化 Agent Run，T11（#67）才把评测执行统一切到 Agent Runtime。

## 一、Agent Harness（优先）

### 1. 你为什么把 Golden Eval 设计成 Manifest 驱动，而不是直接堆测试代码？

**主问口播（STAR）**

【S】我面对的情况是，资产提取、提示词编译、衍生资产约束和图像生命周期已经有多条领域链路，如果只把断言散落在测试函数里，审查者很难知道样本来源、真值、分区和证据要求。【T】我的任务是先形成一个可版本化、可审计的评测契约，而不是先追求更多测试数量。【A】我把每个 case 的稳定 ID、fixture 来源、Ground Truth、hard gate、required artifact、期望失败类和 0/1/2 质量量表都写进 Manifest，再让 Runner 在执行前检查 schema、18 例总数、12/3/3 分区、唯一 ID 和场景注册关系。【R】结果是评测范围不能被静默缩减，运行结果也能追溯到同一份输入契约；但这只证明契约与确定性门禁闭环，不代表真实模型质量或线上效果。

**追问 1：Manifest 比普通参数化测试多解决了什么问题？口播（STAR）**

【S】普通参数化测试也能列输入和期望值，但在这个场景中还需要区分开发集、留出集、事故回归集，并留下为什么该 case 存在的证据来源。【T】我需要让代码审查、后续 Runtime 迁移和机器基线比较都共享同一个事实入口。【A】我把 fixtureSources、groundTruth、expectedFailureClass 和 rubric 与可执行场景解耦，Runner 只负责验证并调度，业务场景负责返回 gates 与 artifacts；这样 case 身份可以跨实现适配器保留。【R】这使 T04/T11（#67）可以替换执行入口而不改 case ID 和判定契约，同时也暴露代价：Manifest schema 需要维护，新增字段必须同步验证逻辑，不能把它当成无成本配置文件。

**追问 2：为什么必须在执行前 fail-fast？口播（STAR）**

【S】如果分区数量、场景名或证据路径有误却仍开始执行，最终的“全绿”可能只是少跑用例，或者跑了错误场景，结果具有欺骗性。【T】我需要把评测定义错误与业务行为失败分开，避免到汇总阶段才发现分母不可信。【A】我在 Runner 入口先校验 schemaVersion、runnerVersion、精确 18 例、12/3/3 分区、ID 格式与唯一性、非空字段、0/1/2 锚点顺序，并在运行前确认 fixture 文件存在。【R】因此错误的评测契约会直接终止，不会生成看似可信的部分结果；这一结果是输入治理能力，不是对被测 AI 能力的加分，也没有形成质量分数。

### 2. 这 18 个 case 为什么分成 development、holdout 和 incident-regression？

**主问口播（STAR）**

【S】我需要覆盖常规功能、非开发样本和真实高风险机制，但如果把所有 case 都混成一个列表，面试官看到的只有总数，无法判断是否只是针对开发样本调参。【T】我的任务是让样本用途和分母显式化，同时保持一个规模可控的冻结基线。【A】我将 12 例放在 development，覆盖提取、提示编译、衍生约束、参考图、恢复和诊断；3 例 holdout 检查未选择 Script、Derived Asset 人工参考图以及缺失轮询记录；3 例 incident-regression 锁定超时不重放、取消后晚到写入和重抽取事务回滚。【R】本次三个分区分别达到 12/12、3/3、3/3 的 deterministic hard-gate case 通过；这不是统计泛化结论，也没有人工质量评审。

**追问 1：三条 holdout 为什么能叫留出集？口播（STAR）**

【S】这里的 holdout 很容易被误解成机器学习意义上的大规模盲测集，但实际只有三条固定场景，规模不足以支持统计推断。【T】我需要准确表达它的工程用途，避免用一个术语制造过度结论。【A】我把它定义为不属于日常 development 分区、但使用同一 Runner 契约的非开发 case，重点检查范围越界、身份权威冲突和结果分母完整性；Manifest 固定其 ID 和 Ground Truth，运行时仍使用确定性 Fake。【R】所以它提供的是“没有只验证开发分区”的结构性证据，而不是模型泛化率、准确率或真实数据分布代表性；如果要扩大统计意义，需要另建样本策略和人工评审协议。

**追问 2：事故回归 case 与普通失败用例有什么差异？口播（STAR）**

【S】普通失败用例常验证一个错误码，但超时、取消竞态和事务中断的危险在于副作用可能已经发生，单看返回值无法证明系统安全。【T】我需要把事故机制转成可长期回归的不变式。【A】我分别记录 Vendor 调用次数、取消后的最终状态与媒体写入、事务失败后的资产和关联表状态，并把稳定失败分类与零副作用或完整回滚同时设为门禁。【R】这样 incident case 不仅问“是否失败”，还问“失败后有没有重复调用、复活终态或残留半写”；当前三例确定性通过，但并不意味着覆盖了所有生产事故或真实网络时序。

### 3. 你如何保证评测可重放和 case 之间互不污染？

**主问口播（STAR）**

【S】这组场景会读写真实 SQLite schema，也会经过 Model 与 Vendor 边界；若共享数据库、系统时间或网络响应，运行顺序和外部波动会让基线漂移。【T】我的任务是建立一个 hermetic 的本地执行层，既走现有领域公开接口，又不触碰生产数据和付费服务。【A】我为每个 case 创建独立的文件型临时 SQLite，注入脚本化 Fake Text Model、Fake Image Vendor，并在可注入处固定时钟；场景串行执行，finally 中关闭数据库并清理临时目录。【R】结果记录明确显示 temporarySqlite、deterministic-fake 与 paidProviderCalls 为 0，重复运行结构一致；这证明本地可重放，不代表真实 Provider 的可用性、延迟或输出稳定性。

**追问 1：为什么用真实 SQLite schema，而不是把 repository 全 mock 掉？口播（STAR）**

【S】如果只 mock repository，事务、条件更新、触发器失败和关联表回滚等高风险行为会被测试替身吞掉，尤其无法验证原子替换。【T】我希望在不访问生产库的前提下保留数据库语义。【A】我让每个 case 初始化应用 schema，再通过共享 work 边界调用领域代码；比如重抽取场景设置一个强制失败触发器，观察旧 Asset 和关联是否在事务失败后仍完整存在。【R】这样能覆盖真实 SQL 事务和状态条件，同时隔离用户数据；代价是初始化成本更高，而本阶段没有性能测量，所以我不会声称这种方案更快，只能说它提升了语义真实性。

**追问 2：串行执行是不是性能问题？口播（STAR）**

【S】18 个 case 当前串行运行，直觉上并行可能更快，但这些场景涉及临时数据库、全局 schema 初始化和脚本化调用顺序，贸然并行会增加不可解释噪声。【T】当前里程碑的优先级是冻结可信基线，而不是优化吞吐。【A】我选择串行调度并为每例独立资源，把确定性和故障归因放在第一位；同时在文档中把总耗时、case p50/p95、SQLite 初始化占比和峰值内存列为待测项。【R】因此现阶段只能证明执行隔离与结果稳定，不能声称串行带来性能收益；若后续测量确认瓶颈，再基于资源所有权设计受控并发。

### 4. Hard gate、required artifact 和 quality rubric 为什么要分三层？

**主问口播（STAR）**

【S】AI 应用评测经常把接口正确性、安全约束和主观质量压成一个平均分，结果可能用高质量分掩盖泄密或副作用错误，也可能只有布尔通过却没有复核证据。【T】我的任务是建立互不替代的判定结构。【A】场景先返回领域 hard gates 和 artifacts，Runner 再追加 artifact-export-contract 与 required-artifacts：前者校验 Manifest allowlist 和敏感导出边界，后者检查证据完整性；质量维度只冻结 0/1/2 锚点，未有人评时强制 pending、score null，并且不计算 composite score。【R】当前 18/18 只表示 18 个 case 的确定性 hard gate 全过，quality 仍是 0 reviewed、18 pending，任何“质量也全过”的说法都超出证据。

**追问 1：为什么 required artifact 也算门禁？口播（STAR）**

【S】一个场景可能返回 true，但如果没有调用次数、状态前后或摘要指纹，审查者无法确认它究竟基于什么事实通过，后续漂移也难定位。【T】我需要把“结论成立”和“证据可复核”同时纳入评测契约。【A】我让 Manifest 列出每例必须存在的 artifact key，Runner 无论场景如何实现都会追加 required-artifacts gate；同时 export-contract 只允许这些顶层 key 出现在报告。缺失时 case 失败、记录 missingArtifacts，并归入 Artifact/evaluation/evidenceIncomplete。【R】这避免了只报绿灯不留证据，不过当前尚未对所有 artifact 做深层业务 schema 和语义验证，因此这仍是可继续加强的边界。

**追问 2：为什么不计算一个综合分方便比较？口播（STAR）**

【S】综合分看似易排序，但本项目的门禁包含证据越界、敏感诊断、取消竞态和事务回滚，这些安全与一致性问题不应被视觉或文本质量分抵消。【T】我需要保留每类信号的含义和责任边界。【A】我把 case hard gate 作为不可平均的约束，把人工 quality rubric 独立保留为 pending，并在结果中明确没有 composite score；未来即使完成 0/1/2 人评，也应同时展示逐例证据和门禁状态。【R】这样报告较复杂，却避免“平均不错所以可发布”的误判；当前没有人工打分，更不能从 18/18 hard gate 推导质量百分比。

### 5. Runner 怎样区分业务预期失败与评测系统自身失败？

**主问口播（STAR）**

【S】Golden case 中有些正确行为就是拒绝，例如证据无效、衍生契约为空、超出参考图上限或 Vendor 超时；如果把这些都当 Runner 失败，评测会把安全拒绝误判成回归。【T】我的任务是同时保留领域 expectedFailureClass 和评测失败 taxonomy。【A】Manifest 为每例声明 primary、stage、kind，场景把真实 failureKind 作为 artifact 并用 hard gate 判断是否符合预期；Runner 把异常、gate false、证据缺失和导出脱敏失败分别分类为 runnerError、hardGateFailed、evidenceIncomplete、redactionFailed。【R】因此预期领域失败在约束与零副作用都满足时仍可成为通过 case，而当前空的 failuresByTaxonomy 只表示本次无评测失败，不表示 18 例没有任何预期业务失败。

**追问 1：Runner 捕获异常后为什么不保存完整 message？口播（STAR）**

【S】Runner 异常信息和 scenario artifacts 都可能夹带临时 SQLite 路径、fixture 正文、Provider 返回体、签名 URL、Base64 甚至凭据，如果直接写入版本化原始结果，会把诊断便利变成泄露面。【T】我需要保留稳定、可归因的错误类别，同时在导出边界拒绝敏感证据。【A】Runner 自身异常只保留 runnerError 分类；scenario artifacts 先校验 Manifest 顶层 allowlist，再递归检查敏感键、签名 URL、二进制和长 Base64。命中后只输出不含原始键名的结构占位位置，并让 artifact-export-contract 与 redactionFailed taxonomy 失败。【R】这样机器结果仍能区分失败且不会原样固化负载；更完整的嵌套异常与未知字段治理继续由 T03 的共享脱敏模块承接。

**追问 2：空的 failuresByTaxonomy 能说明什么？口播（STAR）**

【S】看到空 map 很容易说成“系统没有失败”，但这会混淆评测执行失败和场景内预期的领域失败。【T】我需要在汇报时给出精确口径。【A】我会解释 taxonomy 只聚合 Runner 产生的 Artifact/evaluation 失败，包括 runnerError、hardGateFailed、evidenceIncomplete 和 redactionFailed；其中 runnerError 不会再叠加成缺证据或脱敏失败。例如 timeout case 的 imageGenerationTimeout 是期望观测，它通过 single-call 与稳定分类门禁后不会进入该 map。【R】所以空 map 只能证明本次 18 个 case 的评测门禁、证据与导出安全门齐全，不能证明真实系统从不超时、从不拒绝，也不能替代质量与线上观测；这个边界必须在面试里主动说明。

### 6. 你如何设计“超时不自动重放”的事故回归？

**主问口播（STAR）**

【S】图像生成请求超时时，客户端不知道 Vendor 是否已经接收或产生结果，直接重试可能重复计费或生成重复资源，这是一种结果不确定而非简单失败。【T】我的任务是把这种含糊状态冻结成明确的安全不变式。【A】我让确定性 Fake Vendor 在 generation 阶段抛出 timeout，领域链路将它分类为 imageGenerationTimeout；场景同时记录 vendorCallCount，并要求恰好一次调用，且保留图像状态和媒体写入证据。【R】该 incident case 的 hard gate 通过说明当前冻结实现没有盲目重放且给出稳定分类；它不证明真实网络永不超时，也不提供成本、延迟或生产事故下降数据。

**追问 1：为什么不做一次幂等重试？口播（STAR）**

【S】幂等重试只有在请求携带 Provider 可识别的幂等键、服务端承诺去重，并且客户端能查询同一次执行时才安全；当前冻结边界没有这些已证实条件。【T】我需要在未知结果下选择不会放大副作用的策略。【A】我把 timeout 标成稳定失败类型并限制为单次 Vendor 调用，将后续恢复留给具备明确 checkpoint 或人工决策的更高层，而不是在底层偷偷再次生成。【R】这样牺牲了自动恢复便利，换取不会因猜测而重复调用的可解释边界；T04 引入 Runtime 的 start、inspect、resume 后，也必须先证明同一执行身份和恢复协议，不能直接把重试打开。

**追问 2：这个 case 还缺什么真实世界验证？口播（STAR）**

【S】当前场景用 Fake 精确抛出一个 timeout，能验证本地分类和调用次数，但真实 Provider 还可能出现连接断开、网关超时、响应体损坏或服务端已完成但回包丢失。【T】我需要明确基线覆盖与外部契约覆盖的差距。【A】我会保留 deterministic case 作为长期回归，再在有授权和预算时另建极小的 Provider contract/smoke tier，验证认证、超时、限流、请求 ID 和查询能力，而且不把不稳定外部调用混进此基线。【R】当前结论只到本地不重放机制正确，真实服务可用性、费用和恢复成功率都仍待测。

### 7. 如何防止取消后的晚到成功“复活”终态？

**主问口播（STAR）**

【S】异步生成中，用户取消与 Vendor 成功回调可能交错；如果完成写入只按任务 ID 更新，晚到结果会把已取消记录改回完成，甚至写入媒体。【T】我的任务是验证取消状态具有终态权威，并让晚到写入失效。【A】我在 incident 场景中让生成推进到 downloading 后执行取消，再让 Fake 返回成功内容；随后检查领域方法返回 cancelled、最终状态仍为已取消、媒体写入为零、文件路径为空，并记录晚到更新没有影响行。【R】该门禁证明冻结实现的条件写入栅栏在确定性竞态脚本下有效，但没有声称覆盖所有线程调度或分布式回调场景。

**追问 1：这里为什么既看状态又看副作用？口播（STAR）**

【S】如果只断言最终状态是已取消，代码仍可能先写媒体再因为状态条件更新失败而留下孤儿文件；如果只看媒体写入，又可能状态被错误复活。【T】我需要同时验证控制面和数据面没有分裂。【A】场景收集 cancelled 标志、finalState、mediaWriteCount、filePath 和 Vendor 调用次数，把“取消胜出”与“晚到写入被围栏”拆成两个 hard gate。【R】因此通过结果表示状态与媒体副作用在该路径上一致，不是简单的字符串断言；但垃圾文件系统层面的更多异常注入仍可作为后续扩展，当前没有完整证明所有清理路径。

**追问 2：T04 Runtime 接入后这条不变式怎么保留？口播（STAR）**

【S】T02 直接调用现有图像生命周期公开边界，而 T04 引入首个持久化 Agent Run、T11（#67）统一评测入口；迁移若只关心 API 形状，可能在 start、cancel、resume 的协调中丢失终态规则。【T】我的任务是让 case 身份和可观测结果跨适配器保持不变。【A】我会保留同一个 incident ID、Ground Truth、门禁和 artifacts，把场景入口改成 Runtime 的 start/inspect/cancel 流程，并比较最终状态、晚到更新计数和媒体副作用。【R】只有新旧路径给出相同观察结果后才能删除临时双路径；目前尚未切换，所以不能说 Harness 已经验证 Agent Runtime。

### 8. 你怎样验证重抽取失败时事务完整回滚？

**主问口播（STAR）**

【S】确认重抽取会替换旧 Asset 与 Script 关联，如果删除旧数据后新增或最终状态更新失败，项目会进入半新半旧的不可恢复状态。【T】我的任务是把“全部成功或全部保留旧状态”变成事故回归契约。【A】我先写入旧资产和关联，再通过 SQLite trigger 强制最终 Script 更新失败，调用真实替换边界，捕获 persistenceFailed，并查询事务后的资产与关联表；门禁要求旧资产、旧链接仍在，新资产不存在。【R】确定性 case 通过说明这条本地数据库事务路径实现了 all-or-nothing；它没有证明所有外部媒体副作用都具备分布式事务，也没有线上恢复数据。

**追问 1：为什么用数据库触发器注入失败？口播（STAR）**

【S】如果只 mock 某个 repository 方法抛错，可能绕过真实 SQL 事务边界，无法证明前序 delete 和 insert 会被 SQLite 一起撤回。【T】我需要让失败发生在真实事务的靠后位置，并保留应用 schema 语义。【A】我在临时库创建只用于该 case 的触发器，使最终更新稳定失败，再通过正常领域入口执行替换，最后直接读取资产与关联表作为证据；case 结束时整个临时目录被清理。【R】这种注入可重复且不会污染生产库，能够证明当前事务范围；但它模拟的是指定数据库失败点，不等同于断电、文件系统损坏或跨服务补偿。

**追问 2：如果还有媒体文件删除，数据库回滚够吗？口播（STAR）**

【S】数据库事务只能回滚表内状态，已经执行的文件删除或外部调用通常不能自动撤销，因此“数据库原子”不应被夸大成全链路原子。【T】我需要区分本 case 的验证范围与更广的副作用协调问题。【A】当前场景把 deleteMediaFile 注入为无操作，专门验证 Asset 和 Script 关联的事务回滚；若后续要覆盖媒体，应设计延迟删除、outbox、补偿记录或提交后清理，并为失败窗口新增 artifact 和 case。【R】所以我只声称关系数据在此路径完整回滚，媒体一致性仍需要独立验证，不能借这个 18/18 结论推导出来。

## 二、AI 应用开发（第二优先）

### 9. 资产提取为什么要验证“两阶段调用”和证据落点？

**主问口播（STAR）**

【S】Base Asset 提取不是一次自由生成：第一阶段给候选，第二阶段做完整性审查；如果调用次数漂移或审查新增丢失，覆盖率和成本边界都会失控。【T】我的任务是冻结现有两阶段协议并验证新增候选仍受 Script 证据约束。【A】我给 Fake Model 依次排入提取 payload 与审查 payload，调用真实提取边界，记录 modelCallCount 和 candidateNames；hard gate 要求恰好两次调用，并确认审查阶段带证据补充的角色进入暂存结果。【R】该 development case 证明固定 fixture 下两阶段编排和新增保留符合契约，但没有人工评估资产是否全面，也不能代表真实模型召回率。

**追问 1：为什么“恰好两次”是门禁，而不是实现细节？口播（STAR）**

【S】在这条冻结基线中，一次提取加一次审查共同构成已约定的行为；少一次会失去复核，多一次可能出现未审计成本和不可预测合并。【T】我需要让执行次数成为可观测契约，而不是埋在调用栈里。【A】场景通过脚本化队列只提供两份响应，并把 Fake Model 的实际调用计数写入 artifact，同时 gate 明确检查等于二。【R】因此未来重构若改变调用协议会主动触发评测变化，迫使团队升版或解释取舍；它不是在宣称两次永远最优，更没有成本或质量对比数据。

**追问 2：如何拒绝模型编造的证据？口播（STAR）**

【S】模型可能返回语法正确的资产，却引用未选择的 Script 或原文中不存在的句子；若直接持久化，后续提示生成会建立在伪证据上。【T】我需要让提取结果在写入前 fail closed。【A】我设计 development 与 holdout 两条 case，分别注入无法定位的 excerpt 和未选择的 scriptId，通过真实 contract 校验捕获 invalidOutput，并查询资产表必须仍为零。【R】这证明当前验证边界能阻止这两类伪证据写入；但它不等于语义真实性已由人确认，也不能给出真实模型幻觉率，其他类型的证据歧义仍要继续补充样本。

### 10. 你如何测试提示词中的参考图冲突与无参考图场景？

**主问口播（STAR）**

【S】多个 Asset Reference 可能同时声明控制面部、服饰等维度，若冲突未解决，生成提示会包含相互矛盾的迁移指令；反过来，没有参考图时也不应凭空生成引用语句。【T】我的任务是验证参考约束既能按优先级收敛，也能在空输入时保持干净。【A】我构造不同 priority 且维度重叠的 binding，调用真实编译器，检查最高优先级获选且受控维度唯一；另一个 case 使用无引用 brief，要求 selectedReferenceIds 为空、referenceClause 为空。【R】两条 deterministic 门禁通过说明编译结构符合规则，但未有人评估最终图像的参考图忠实度。

**追问 1：为什么 artifact 保存 hash 而不是完整 prompt？口播（STAR）**

【S】完整 prompt 可能很长，也可能包含业务素材；直接塞入原始报告会增加噪声和潜在泄露，同时基线比较真正关心的是内容是否发生变化。【T】我需要提供稳定的差异证据而不过度复制正文。【A】我对编译后的 generationPrompt 计算 SHA-256，把 selectedReferenceIds、控制维度或 identity marker 作为可读证据，hash 作为精确内容指纹。【R】这样能判断同一输入的输出是否漂移并保持报告紧凑；但 hash 不能解释变化语义，发现差异后仍需回到本地 prompt 和 fixture 做审查，也不能作为质量分数。

**追问 2：优先级正确就能证明生成图忠实吗？口播（STAR）**

【S】编译器选对 reference binding 只说明结构化指令正确，真实图像是否保留身份、服饰和材质还取决于模型理解与 Vendor 能力。【T】我需要防止把输入契约测试夸大成输出质量测试。【A】我将 hard gate 限定在 selected bindings、维度唯一性和生成提示指纹，把“reference fidelity”作为 0/1/2 人工 rubric 的 focus，并保持 qualityReview pending。【R】因此当前可说冲突决策和提示结构通过，不能说图像参考忠实度通过；后者必须由评审员结合实际输出与证据打分，并记录评审者身份、依据和分歧处理过程。

### 11. Derived Asset 为什么必须使用父资产锚点和有界变化契约？

**主问口播（STAR）**

【S】衍生资产要表现同一主体在天气、时段等状态变化下的版本，如果再引入人工参考图或自由重写完整提示，会出现多个身份权威，导致父子身份漂移。【T】我的任务是验证变化可组合，但不越过父资产身份边界。【A】我用一条 case 组合 weather 与 time_of_day，要求 prompt 明确分开 preserve、change、exclude；另一条让 preserve 为空，必须返回 derivedPromptCompilationFailed；holdout 还要求 Derived Asset 带人工参考时在任何 Model/Vendor 调用前拒绝。【R】这些门禁证明本地契约的早拒绝和结构分离，不能证明真实生成图已经保持身份一致。

**追问 1：多维变化为什么不是简单字符串拼接？口播（STAR）**

【S】天气与时段可以共存，但镜头、姿态或不受允许的重塑若混入同一自由文本，变化范围会失控，并且无法知道哪些父特征必须保持。【T】我需要让每个维度在统一契约下组合，而不是相互覆盖。【A】我给编译入口传入 dimensions、evidence、preserve、change、exclude 和匹配的视觉手册，随后检查生成文本包含两个维度语义，并保留三类约束的独立标记与 hash。【R】这说明编译器没有丢掉已声明的维度和边界；实际视觉是否准确仍属 quality rubric，需要人工查看生成结果，目前 18 条都 pending。

**追问 2：为什么禁止 Derived Asset 使用人工参考图？口播（STAR）**

【S】父资产当前接受图已经是衍生生成的身份锚点，再接受人工图会形成竞争权威，系统无法判断应继承父身份还是外部参考中的新身份。【T】我需要在昂贵调用和媒体副作用之前消除歧义。【A】holdout case 构造带人工参考的 Derived Asset，调用解析入口并记录 failureKind、modelCallCount、vendorCallCount；门禁要求 derivedAssetReferenceForbidden 且两类外部调用均为零。【R】这证明拒绝发生得足够早并保留稳定原因，但不表示该产品规则永远不可变；若业务要支持新权威模型，必须先更新领域契约与评测版本。

### 12. 如何验证同类角色提示既一致又有差异？

**主问口播（STAR）**

【S】同一故事里的兄弟角色或相近角色容易被通用模板压成相似提示，出现“generic collision”；但只追求差异又可能脱离 Script 证据。【T】我的任务是验证固定 fixture 下角色提示不相同，并保留各自有来源的服饰身份标记。【A】我加载同一组已冻结 Asset Brief，分别调用真实提示编译器，比较生成 prompt 的内容与 hash，同时检查一个保留玄黑服饰标记、另一个保留粗麻标记。【R】门禁通过说明结构化 brief 到 prompt 的确定性差异仍在，没有证明模型生成的人物视觉差异足够清晰；对应 visual differentiation rubric 仍待人工评审。

**追问 1：只检查两个关键词会不会太弱？口播（STAR）**

【S】两个 marker 能快速发现明显回归，但不能覆盖脸型、年龄、身份气质或整体构图，也可能出现关键词存在却没有真正控制输出的情况。【T】我需要把 hard gate 定位为最低可自动验证约束，而不是完整质量判断。【A】我同时比较整段 prompt 的 SHA-256，确保两份内容不完全相同，再把“clear story-grounded differentiation”放入 0/1/2 人工锚点，等待评审员结合实际产物判断。【R】因此自动层负责防止退化为完全相同或丢失关键身份描述，人评层负责视觉有效性；当前不能把关键词命中率写成准确率或质量通过率。

**追问 2：为什么不直接调用真实图像模型做回归？口播（STAR）**

【S】真实模型受版本、随机种子、服务状态和内容策略影响，直接放进基础回归会导致不可重放、付费和难归因，尤其无法判断变化来自代码还是 Provider。【T】当前目标是先冻结应用自身的编译与约束行为。【A】我使用 deterministic Fake Vendor 并在 prompt 层保留 hash、marker 和 reference 选择证据，把真实图片评价留给独立质量层；原始结果明确记录 paidProviderCalls 为 0。【R】这使本地基线稳定且无付费调用，但没有验证真实模型响应 schema、视觉质量、成本或延迟，后续只能通过独立 smoke 与人工评测补齐。

## 三、后端工程（补充）

### 13. CLI、机器可读 JSON 和 checked-in baseline 如何配合？

**主问口播（STAR）**

【S】评测如果只在测试进程里打印人类日志，很难被 CI 消费，也无法判断结果对应哪个 Manifest、Runner 和基线提交；如果每次运行都自动覆盖文件，又会掩盖漂移。【T】我的任务是让读取执行与基线刷新明确分离，并留下可审计 provenance。【A】CLI 的普通命令只把 JSON 输出到标准输出，显式 write 命令才刷新版本化 raw result；结果携带 suiteId、runId、runnerVersion、manifestHash、baselineRevision、executionTier、commands 和 environment，测试再拒绝未预期漂移。【R】因此同一输入可得到可比较机器证据，变更基线需要显式动作；这不是部署或线上监控系统。

**追问 1：为什么 Manifest hash 要做换行归一化？口播（STAR）**

【S】仓库可能在 Windows 与 Unix 环境使用不同换行符，如果直接按原始字节计算 hash，同一语义内容会因为 CRLF/LF 不同产生伪漂移。【T】我需要让内容身份不受常见工作区换行差异影响。【A】hash 函数先把 CRLF 和单独 CR 统一成 LF，再用 UTF-8 计算 SHA-256，runId 也包含 hash 前缀和 Runner 版本。【R】这样跨平台检出时更可能保持同一 Manifest 身份，同时真正的文本变化仍会改变指纹；它只解决换行层面的稳定性，不代表 schema 语义完全等价，字段重排仍会改变当前内容指纹。

**追问 2：普通运行和 write 命令分离有什么价值？口播（STAR）**

【S】如果开发者每次运行评测都顺便改写 baseline，那么回归可以被新结果自动“接受”，代码审查只看到文件变化却不清楚是否有意。【T】我需要让观察结果与批准新基线成为两个动作。【A】我保留只读执行命令用于本地和 CI 检查，只在明确调用 write 时更新 raw result，再由契约测试对 Manifest、case 结果和 checked-in 文件做一致性验证。【R】这样漂移默认暴露为失败，需要审查者解释后再刷新；它不能替代代码评审，但减少了无意识覆盖基线的机会。

### 14. 你如何保证结果结构可诊断，而不仅是一个退出码？

**主问口播（STAR）**

【S】单一退出码只能告诉 CI 成败，无法回答失败在哪个分区、哪条 gate、缺了什么证据，也无法区分场景错误和 Runner 错误。【T】我的任务是设计一份既能聚合又能向下钻取的结果结构。【A】我在顶层保留 defined、executed、case 级 hardGate 分母、quality 分母、三个 partition 汇总和 failuresByTaxonomy；每个 case 再保留 expectedFailureClass、hardGates、qualityReview、artifacts 与 failures。【R】当前 raw result 可以从 18/18 下钻到具体调用次数、状态或 hash，同时明确 quality pending；结构可诊断不等于所有失败都已覆盖，artifact 的深层 schema 仍可加强。面试中我会先报分母和执行层级，再展示单例证据，避免只念一个绿色数字。

**追问 1：为什么 hardGate 的 denominator 是 case 数而不是 gate 数？口播（STAR）**

【S】每个 case 的 gate 数不同，如果直接汇总所有布尔 gate，多门禁 case 会获得更高权重，而且一个 case 部分失败仍可能被总 gate 通过率稀释。【T】我需要让“一个场景是否整体满足契约”成为汇总单位。【A】Runner 为每例追加证据门禁后，用全部 gates 是否通过计算 case passed，顶层 hardGate 再以 18 个 case 为分母；逐 gate 细节仍保留在 case 下。【R】所以 18/18 的精确含义是 18 个 case 全部整体通过，不是说只有 18 个布尔断言，也不是质量评分；这种口径在文档中必须主动说明，并与人工质量的独立分母并列展示。

**追问 2：failure taxonomy 为什么先只保留四种评测失败？口播（STAR）**

【S】评测层真正需要回答的是执行器自身崩溃、领域门禁不满足、证据不完整，还是证据因敏感内容不能导出；如果复制所有业务错误码，评测故障和被测行为会再次混在一起。【T】我需要一个小而稳定的 Runner taxonomy。【A】我将评测失败限制为 runnerError、hardGateFailed、evidenceIncomplete、redactionFailed，并用 primary/stage/kind 组合为聚合 key；领域错误则留在 expectedFailureClass 和安全 artifacts 中，而且 runnerError 保持单一归类。【R】这让顶层失败可快速归因，同时保留业务细节；未来扩充分类需要升版并同步消费者，不能无边界增长，也不能让同一根因重复计数。

### 15. T02 与 T03、T04、T11（#67）的架构边界是什么，迁移时你会怎么做？

**主问口播（STAR）**

【S】T02 的目标是围绕冻结生产基线建立版本化评测语料与确定性 Runner，当时 Agent Runtime 尚未实现；如果现在把它说成 Runtime Harness，会混淆阶段成果。【T】我的任务是既验证真实领域公开边界，又给后续统一 Runtime 留下稳定迁移契约。【A】T02 直接调用领域接口并固定 case、Ground Truth、gates、artifacts 与结果 schema；T03 建共享诊断和脱敏，T04 建首个持久化 Run，T11（#67）才持久化 EvaluationRun 并强制经 Runtime 执行。【R】当前成果只是 baseline adapter 下 18/18 hard-gate，不能提前声称完整 Agent Runtime 已完成；这种阶段边界比包装成“大而全”更可审计，也更便于复核。

**追问 1：迁移时如何避免双路径长期存在？口播（STAR）**

【S】如果新增 Runtime 后保留一套直接领域调用和一套 Runtime 调用，两边会逐渐产生不同语义，评测到底验证哪条生产链路会变得含糊。【T】我需要一个可比较、可收敛的迁移步骤。【A】我会先保持同一 Manifest 和 case 身份，T04 后为 Runtime 实现 start、inspect、cancel、resume 的适配器，短期对比两条路径的 gate、artifact schema、failure taxonomy 和 raw result，最终由 T11（#67）删除临时适配器。【R】这样迁移依据是可观察结果而不是内部类名相似；目前该对比尚未发生，所以只能列为后续验收方向，不能写成已交付能力。

**追问 2：哪些能力明确不属于 T02？口播（STAR）**

【S】阶段性项目最容易把路线图当成既有成果，尤其是持久化评测运行、候选与基线比较、审阅者 provenance 和真实 Provider 质量。【T】我需要在面试中主动切断这些未经实现或未经验证的 Claim。【A】我会明确说 T02 没有数据库 schema 迁移、没有路由或 Socket 改动、没有生产运行路径变更、没有浏览器或部署验收，也没有人工质量分；它只提供离线 CLI、版本化 Manifest、确定性场景与原始结果。【R】这种边界会减少“看起来没那么大”的包装空间，却保证每个结论都能回到源码和报告核验，也为 T03 留出清晰责任。

## 源码证据索引

| 主题 | 关键路径与内部符号 | 对应正文位置 |
| --- | --- | --- |
| 版本化评测契约 | `data/eval/agent-harness-golden-v1/manifest.json`；`GoldenEvalManifestCase`；`validateGoldenEvalManifest` | 问题 1、2、4、5 |
| Runner 主链与结果结构 | `src/eval/goldenEval.ts`；`runGoldenEval`；`GoldenEvalResult`；`partitionSummary`；`failuresByTaxonomy` | 问题 1、4、5、13、14 |
| Manifest 指纹与安全异常分类 | `hashGoldenEvalManifest`；`safeErrorKind` | 问题 5、13 |
| 场景注册与隔离环境 | `src/eval/goldenEvalScenarios.ts`；`scenarios`；`executeGoldenScenario`；`createGoldenScenarioEnvironment`；`cleanup` | 问题 2、3、15 |
| Fake Model/Vendor | `DeterministicFakeModel`；`DeterministicFakeVendor`；`fixtureGenerationInput`；`imageDependencies` | 问题 3、6、9、12 |
| 两阶段提取与证据校验 | `extraction-two-stage`；`extraction-invalid-evidence`；`extraction-unknown-script`；`runBaseAssetExtraction` | 问题 9 |
| 提取确定性与 Derived 名称折叠 | `extraction-deterministic`；`extraction-derived-fold`；`mergeBaseAssetCandidates` | 问题 2、9 |
| 参考图与提示编译 | `prompt-reference-priority`；`prompt-no-reference`；`prompt-character-contrast`；`compileAssetGenerationPrompt` | 问题 10、12 |
| Derived Asset 约束 | `derived-multi-dimension`；`derived-invalid-contract`；`derived-reference-forbidden`；`compileDerivedAssetPrompt`；`resolveDerivedAssetGenerationEntry` | 问题 11 |
| 参考图准入上限 | `reference-limit`；`createAssetReference` | 问题 2、5 |
| 图像生命周期恢复和诊断 | `recovery-interrupted-images`；`failure-diagnostic-redaction`；`polling-missing-row` | 问题 2、3、5 |
| 超时不重放 | `timeout-no-replay`；`VendorImageGenerationError`；`generateAssetImage` | 问题 6 |
| 取消晚到写入栅栏 | `late-success-after-cancel`；`cancelImageGeneration` | 问题 7 |
| 原子重抽取回滚 | `replacement-atomic-rollback`；`replaceScriptAssetExtraction`；`golden_fail_script_update` | 问题 8 |
| CLI 与版本化原始结果 | `scripts/runGoldenEval.ts`；`tests/goldenEval.test.ts`；`docs/reports/data/agent-harness-golden-v1-results.json` | 问题 13、14 |
| 交付事实与限制 | `docs/reports/agent-harness-golden-58.md`；`docs/interview/导学-Agent-Harness-T02.md` | 全文事实边界、问题 15 |

## 高风险 Claim 清单

| Claim 类型 | 容易说过头的表达 | 本阶段可核验说法 | 仍需什么证据 |
| --- | --- | --- | --- |
| Ownership | “我从 0 到 1 主导了完整 Agent Runtime” | 我围绕冻结基线整理了 Manifest 驱动的 deterministic Golden Eval；T02 尚未切到 Agent Runtime | T03、T04、T11（#67）的实现、提交、评审与职责记录 |
| Architecture | “Runner 已经统一所有 Agent 执行入口” | T02 scenario registry 调用现有领域公开边界；仅经 Runtime 执行属于 T11（#67） | Runtime `start/inspect/cancel/resume` 的适配与等价回归 |
| Metric | “AI 评测准确率 100%” | 18 个确定性 case 的 case 级 hard-gate 为 18/18；不是准确率 | 有代表性的样本设计、统计口径与人工标注 |
| Quality | “18 个样本质量全部通过” | quality 为 0 reviewed、18 pending，0/1/2 分全部未填写 | 评审员资格、盲评、逐例证据与分歧处理 |
| Result | “方案已经上线并稳定运行” | T02 没有改变生产 route、Socket、前端 bundle、数据库 schema 或生产生成路径 | 部署记录、线上监控、回滚记录与用户反馈 |
| Performance | “评测速度或资源使用得到提升” | 当前未记录总耗时、p50/p95、内存或初始化占比 | 基准环境、重复测量与前后对照 |
| Reliability | “彻底解决了超时、取消竞态和数据一致性” | 三个 incident-regression case 在确定性脚本下通过既定不变式 | 更多故障注入、真实时序、生产事故与恢复演练 |
| Provider | “已验证真实模型和 Vendor 能力” | execution tier 为 deterministic-local-fake，paid Provider 调用为 0 | 独立 provider contract/smoke 与授权预算 |
| Scope | “覆盖了完整视频生产链路” | 语料覆盖选定的 Script→Asset→Prompt→Image 路径 | Video Track、Prompt Revision、Video 生成与端到端验收 case |
| Human impact | “显著减少人工审核成本” | 本阶段未测人工耗时、采用率或审核质量 | 流程实验、时间记录、评审一致性和使用反馈 |
