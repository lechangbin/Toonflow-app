# Agent Harness T11 导学：评测记录与生产执行的边界

> 阶段学习材料。当前只有持久证据账本，没有评测结果；按用户要求不生成简历文案，全量验收留到 T21。

先读 `CONTEXT.md` 的 Evaluation Run 与 Agent Run 定义，再读 `docs/adr/0027-evaluate-through-production-agent-runs.md`。核心区别是：Evaluation Run 固定比较问题与样本，Agent Run 才执行一次实际 Agent 请求。若评测另写一套 Agent 流程，它通过也无法证明生产流程可用。

阅读顺序：`src/eval/evaluationRun.ts` 的 `validateEvaluationRunManifest` → `createEvaluationRunRuntime().create` → `src/eval/evaluationAgentCase.ts` 的预检、AgentRuntime `start`/`inspect` → `record` → Evaluation Run `inspect`；随后对照 `src/lib/initDB.ts` 的两张表和更新触发器，最后跑 `tests/evaluationRun.test.ts`、`tests/evaluationAgentCase.test.ts` 和 `tests/goldenEvaluationFreeze.test.ts`。注意 `record` 只取 terminal Run、Output 哈希和 Trace 锚点，不读取原始 Prompt；`inspect` 用 expected/recorded/missing 揭示尚未覆盖的矩阵，并复核来源证据有无变化。

Golden 冻结补充阅读：`src/eval/goldenEvaluationFreeze.ts` → `src/eval/goldenEval.ts` 的 18 例清单校验与规范化哈希 → `tests/goldenEvaluationFreeze.test.ts`。刚冻结时 72 个样本全部 missing；不要把 manifest 冻结解释成场景执行。

新语料导学（ADR-0028）：先对照 `data/eval/agent-harness-golden-v1/manifest.json` 与 `data/eval/agent-runtime-corpus-v1/manifest.json`，指出前者是确定性领域场景、后者是 18 条实际 Agent 请求，两者仅数量相同。读 `agentRuntimeCorpus.ts` 的 12/3/3、规范顺序、角色/权限、fixture 和 rubric 校验；读 `agentRuntimeProjectFixture.ts` 如何验证字节哈希、在空数据库物化 Project，并比对当前 Project 投影；再读 `agentRuntimeEvaluationFreeze.ts` 如何创建 v3 账本，及 `evaluationCaseDefinitions.ts` 如何让报告分别读取 v2 T02 与 v3 新语料。运行 `tests/agentRuntimeCorpus.test.ts`：新语料冻结后 72 格仍全部 missing；本地 Fake Model 的单 cell 有 Run 与受控读取 ToolReceipt，但尚无独立 hard-gate 判定。篡改已物化章节后，`evaluationAgentCase` 在第二次 Model 调用前拒绝；反问为何调用期间仍需隔离或快照锁。

逐例观察练习：读 `docs/reports/agent-harness-t11-case-matrix.md`，任选 DEV-RT-001、HOLD-RT-013、INC-RT-018，分别说出允许的 Tool、禁止的效果、预期 Output 与人工判断部分。再检查 v3 的 actor 身份：fixture owner → 冻结 `caseInputs.actorUserId` → `evaluationAgentCase` 启动预检 → Run input → `evaluationRun.record/inspect`。换成另一 actor 时应在 Model 前拒绝；已记录 Run input 中 actor 被改写时整份观察报告应拒绝。

#104 安全核验练习：读语料里的 `expectedToolCalls`、两例的 `optionalToolCalls` 与 `runtimeCorpusGateVerifier.ts`，对同一 Fake Model cell 依次修改 ToolReceipt `inputHash`、再用自洽哈希伪造 `outputJson`，确认来源读取验真失败；损坏 JSON 时报告仍应保留 72 格并标这一格 failed，父 Run 出现审批提案 Trace 时也必须失败。恢复后安全报告应是 1 verified/71 missing。必需读取不可缺失，许可集合之外的额外章节也不可读取；HOLD-RT-013、INC-RT-017 的当前 Project 可选读取不应误判。再读 `evaluationPairedAssessmentReport.ts`：没传安全验证器时，v3 的人工已评审 cell 只能是 `unverified-safety`；传入且机器安全通过后也只是 `pending-semantic-verification`，分差保持 null。解释为什么自然语言事实、rubric 和评审身份仍需另外核验。

覆盖报告再读 `src/eval/evaluationCoverageReport.ts`：固定 18-case、2-seed、2-variant 的分母；观察一条真实只读 Run 后，仅相应 cell 从 missing 转 observed。解释为何 observed 不是 hard-gate pass，来源 Run 版本被改写时为什么必须整份拒绝，而不能继续显示漂亮的覆盖率。

待评审清单读 `src/eval/evaluationAssessmentQueue.ts`：一个 Run 已成功为何对应 Golden 硬门仍是 `not-evaluated`？为什么必需产物清单、rubric 版本和失败分类可以先列出来，却不能自行填“通过”？

沿 `src/agentRuntime/causalTrace.ts` 的 `auditCausalTraceTimeline` 检查来源 Trace：最后一个 ID 正确但中间前驱断开，为什么不能算有效评测证据？

再核对 Output：为何不能只相信数据库里的 `contentHash` 字段？账本现在按生产 Runtime 的哈希规则重算正文并检查 schema；如果一个 Run 有两个 Output，当前单哈希证据格式会拒绝，而不是任取第一条。多阶段产物集合仍待设计。

再看 Run 的 `createdAt`/`completedAt`：缺少完成时间时能否报告延迟？为什么未知 Provider 收费必须是 `null`，不能填 0？

自测：为什么每个 case/seed/variant 要绑定不同 Agent Run？为何 queued Run 不能计入结果？如果一条来源 Run 的版本在记录之后变化，报告是否仍可采用？为什么一个真实 Runtime/Fake Model 的只读样例不代表 18 个 Golden case 已迁移？本阶段没有质量分、成本、延迟或安全硬门，因此不能得出策略收益结论。

新自测：若 baseline 与 candidate 使用同一 case ID 但不同输入正文，哪一层拒绝？若有人直接调用账本把一个无关终态 Run 填入样本，哪个请求身份检查拒绝？注意 seed 当前仅参与样本请求 ID，还不是 Model 随机性控制。

再追问：为什么冻结输入哈希要与 Runtime 的修剪规则一致？若有人绕过适配器直接调用 `record`，它怎样复核 Run 保存的正文、role 和 scope？Project 快照没有冻结时还能不能宣称“完全同条件”？

新增核对：同一 case 的正文相同，但 baseline 和 candidate 分别运行在两个 Project，能否直接比较？沿 `goldenEvaluationFreeze` → `evaluationAgentCase.execute` → `evaluationRun.record/inspect` 看 Project ID 如何冻结、启动前拒绝和记录后重验。再指出边界：固定 Project ID 仍未固定其内容快照。

交叉核对旧 Draft PR #90：它的独立表与覆盖报告为何不能和当前账本并列上线？怎样迁移其 18-case 分母和“覆盖非质量”语义，同时只保留一个 Evaluation Run 身份？

对照清单的 baseline/candidate：schema、Model、Vendor 被要求相同，否则改变的不只是候选策略；App、Runtime、Tool、Context、Memory、Skill 可因实验而不同。解释为什么“版本相同”仍不能代替同预算、同数据和真实逐例测量。

文件证据练习：读 `evaluationArtifactVerifier.ts` 和 `evaluationPairedAssessmentReport.ts`。先不传 `artifactRoot` 生成报告，确认 `evidenceFileCheckedRuns` 为 0；再提供隔离测试目录，查看两侧返回的实际文件哈希；最后改动一个已声明 SHA-256 的产物字节，确认报告整体拒绝。解释为何文件哈希正确仍不能证明 hard-gate 判定正确、评审人真实、或该文件确实来自引用的生产 Run。报告 v2 只把文件级验真接入可选路径，最终验收尚未完成。

新 v3 来源练习：读 `runtimeCorpusEvidenceArtifacts.ts`，从一条已观察的 v3 Agent Run 生成 Output、ToolReceipt、Trace 的固定投影；将三份文件写入隔离评审目录，并提交其真实 SHA-256。配对报告同时传 `artifactRoot` 与 `runtimeSafety` 后，`sourceProvenanceCheckedRuns` 才从 0 变 1。单改文件字节、单改评审声称的哈希、或只传目录不传 Runtime 依赖都应拒绝。说明这只证明文件与生产 Run 证据一致，既不验证回答语义，也不认证人工评审人的身份。

真实供应商单格练习：读 `scripts/agnesRuntimeCorpusCanary.ts` 和 `docs/reports/agent-harness-t11-agnes-canary.md`。指出它怎样在内存 SQLite 中装配只读 Production Skill/Grant，从环境读取密钥，冻结 v3 清单并通过生产 Runtime 执行 DEV-RT-009；再解释摘要中 1/72 observed、1 条成功读取和 `verified-read-and-safety-only` 各自能与不能证明什么。当前脚本既不能断点续跑，也没有 candidate 实验和人工盲评；不要把它说成 T11 通过。

检查点练习：读 `runtimeCorpusCheckpoint.ts`。为什么不能把包含 Agnes 配置的内存数据库直接序列化到磁盘？沿清空 `o_vendorConfig.inputValues` → `VACUUM` → 密钥字节扫描 → 新文件写入 → 恢复内存配置解释边界。加载时为何还要检查 SQLite 完整性、Vendor 配置仍为空？指出它只解决已完成 cell 的本地证据恢复，不能保证在 Provider 调用中途崩溃后安全重试。

盲评练习：读 `runtimeCorpusBlindReview.ts`，观察 36 对为何固定生成 72 个 A/B 槽位，即使仍有 missing。确认给评审人的 `packets` 没有 variant、case ID、seed 和 Run ID，私有 `privateMap` 才能解盲；HMAC 私钥不得进入评审包。追问：盲评包有 rubric 就等于校准过吗？答案是否定的，独立评审人身份、双评一致性与分歧仲裁记录仍未交付。

混合执行练习：读 `evaluationAgentCase.ts` 的 `runtimeForCase`。为什么只按 role 路由仍不够？同是 scriptAgent，普通只读和 Script Harness 的 scope、Skill/Grant 前置条件不同；Production Harness 又是第三套。跟随 `tests/agentRuntimeCorpus.test.ts` 的三个局部 Fake Model 运行，核对每类 Run 的 role/scope、受控 ToolReceipt 与安全核验。它复用生产 Runtime，而不是另造评测专用执行器。

中断练习：读 `runtimeCorpusExecutionJournal.ts` 的目录锁、`inflight` 和 `completed` 标记。若外部 Model 调用后进程崩溃且没有完成 checkpoint，恢复进程能否只因该格 missing 就重试？不能；日志要求人工核查未知效果。完成时会重开前后两份去密钥快照，复核 v3 账本中恰好多一个已终结来源 Run 的格子；篡改快照或孤儿文件也会拒绝。该实现只针对进程崩溃，Windows 缺少可移植的目录 fsync，不能承诺突然断电后目录项顺序可靠；组件也尚未接入 72-cell runner。

单格编排练习：读 `runtimeCorpusCellRunner.ts`，指出外部 Model 的唯一可调用位置为何必须在 `begin` 之后；为何执行异常不删除 `inflight`。重复已完成 cell 时，`begin` 会在调用执行回调前拒绝。再说明它只固定顺序，尚未承担三类 Runtime 组装、真实模型预算与完整矩阵驱动。

实验设计练习：读 `runtimeCorpusTreatment.ts` 与 `docs/reports/agent-harness-t11-paired-study-plan.md`。为什么 Skill-only 比较还要锁定 App/Schema/Runtime/Tool/Context/Memory/Model/Vendor？哪些普通 Script 只读 case 不受 Skill 处理、只能作负对照？若两次“seed”仅是不同请求身份，为什么不能称为受控随机重复？本文件是预注册草案，不能当成已经观察到的收益。

模型绑定练习：读 `runtimeCorpusModelPolicy.ts` 和 Agnes 单格脚本。区分“清单声明的 Model 修订”和“Vendor 从当前数据库解析出的实际目标”；尝试在定向测试中把 Production 温度改为 1，观察为何在 Model 调用前拒绝。固定两步上限也不等于 72 格总调用次数已持久计量；进程崩溃后仍需先核查外部效果。

Skill 绑定练习：读 `runtimeCorpusSkillBinding.ts`。为何清单中的 `skill` 字符串不能证明两类 Harness 当时真正激活的 Revision？检查它如何复核发布状态、生命周期、内容/manifest 哈希、角色及只读意图，再比较两侧 Tool/能力清单是否相同。然后跟随逐例预检调用真实 Router，新增同优先级 Skill 会让 Harness case 歧义而拒绝；这个预检还须正式 runner 在每次调用前使用。

来源竞态练习：读 `runtimeCorpusGateVerifier.ts` 与 `tests/agentRuntimeCorpus.test.ts` 的 `racedEvaluation`。先让 `evaluation.inspect` 取得旧来源，再把 Output 正文与哈希一起改成另一份安全文本；为什么只检查“正文与当前哈希相符”仍会误判？安全门必须再与冻结 cell 的 Output 哈希比较，漂移时返回 `output-source-drift`。

评审投影练习：同样的 `racedEvaluation` 再调用 `runtimeCorpusEvidenceArtifacts.ts`。如果投影只取当前 Output 而不比对冻结 cell，就可能把已替换的正文作为“来源投影”导出；现在它会直接拒绝。注意 ToolReceipt/Trace 完整正文还未在 EvaluationCase 中冻结整体哈希，不能把这一步夸大为永久不可篡改审计。

Holdout 练习：读公开的 v3 corpus 与 `evaluationPairedAssessmentReport.ts` 的 `holdoutIntegrity`。为什么 12/3/3 分区和哈希并不能证明三条 holdout 未被候选作者看到？当前报告固定标 `unverified-public-corpus`，即使未来 72 格都跑完也不能自动升级为封存盲测结论。

串行执行练习：读 `evaluationAgentCase.executeVariant` 与 `tests/evaluationAgentCase.test.ts`。先提交错误正文或多余 case，确认没有启动 Model；以 `maxNewCells: 1` 跑一格，再不设上限续跑剩余 seed，最后重复调用确认不重发。注意输入集合与修订先整体预检，已记录 cell 来自 `evaluation.inspect` 的来源复核，循环逐格 `await`，但多个调用方或进程同时发起时没有全局互斥。这是为受限并发准备的局部编排，不等于已经跑了 72-cell 生产评测。
