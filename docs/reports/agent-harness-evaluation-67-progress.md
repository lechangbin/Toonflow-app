# Agent Harness T11 · Evaluation Run 持久证据（阶段进度）

Issue：`lechangbin/Toonflow-app#67`。本分支叠在 T17 App Draft PR #96 上，实现 Evaluation Run 冻结清单与关联生产 Agent Run 的逐例证据账本。现已能在同一账本冻结 T02 的完整 18-case Golden manifest 原文与哈希，但没有接入 Golden Eval Runner、没有执行这 18 例的成对 baseline/candidate，也没有发布质量、延迟或成本结论。T11 仍开放。

`Evaluation Run` 在 `CONTEXT.md` 中被定义为一组冻结比较及其 Agent Run 证据，不是另一种 Agent 执行。ADR-0027 选择从生产 Runtime 的真实 Run 取证，拒绝另造只为评测服务的 Agent 路径。清单固定 case manifest 哈希、case/至少两个 seed、baseline/candidate 两侧 App/schema/Runtime/Tool/Context/Memory/Skill/Model/Vendor 修订和冻结时间。重复 case/seed 或空修订拒绝。

新增逐例输入正文哈希并要求它与冻结 case 顺序一致：baseline/candidate 对同一个 case 传入不同文本会在启动前拒绝。证据写入和读取都校验来源 Run 的确定性请求 ID 是否对应 variant/case/seed，避免借用不相关的生产 Run。输入哈希仍不能证明外部 Golden fixture 与正文一致；seed 当前只进入幂等请求 ID，并未控制 Model 随机性。

冻结输入进一步包含 role/scope，哈希按 AgentRuntime 实际采用的 `trim()` 后正文计算；`record` 和 `inspect` 复核生产 Run 持久化的 input、role、scope，避免绕过执行适配器或事后改写来源输入。它并未冻结 Project 数据快照或供应商实际随机种子，完整同条件比较仍待后续阶段。

同案 Project 可比性补充：冻结输入增加 Project ID，清单版本提升为 `toonflow.evaluation-run.v2`。执行适配器在调用 Model 前拒绝错 Project；绕过适配器直接 `record` 或在记录后改写来源 Project，账本写入/重读也会拒绝。7 个 T11 定向用例通过，含跨 Project 启动、记账和重读拒绝。这里只固定 Project 身份，未冻结该 Project 的小说章节、剧本及配置快照，故仍不能宣称 baseline/candidate 已在完全相同的数据条件下比较。

Golden 清单收敛：`freezeGoldenEvaluationRun` 先使用现有 T02 校验器验证真实 18-case manifest，再要求调用方为 18 个 case 按原顺序显式提供待执行输入，最后在同一 `o_agentEvaluationRun` 中保存规范化清单原文、哈希及逐例输入指纹。刚冻结时 `inspect` 固定显示 18×2 variant×2 seed＝72 个预期但缺失的样本，绝不把历史 T02 结果伪装为新 Agent Run。测试里的逐例正文仅是冻结契约夹具，不是已迁移的真实 Golden 场景输入。早期 Draft PR #90 的独立 `o_evaluationRun`/`o_evaluationCase` 不会作为第二套最终 schema；两份 Draft 目前仍需收敛处理。

覆盖报告已在单一账本上重写：`src/eval/evaluationCoverageReport.ts` 对每个 Golden case/seed 展示 baseline/candidate 的 observed/missing，固定 18 个 case、每侧 36 个样本分母，并输出机器可读对象与 Markdown。observed 只意味着真实生产 Run 证据通过 `inspect` 复核，绝不推导 hard-gate、人工评分或质量提升；来源 Run 改写时整份报告拒绝，而非输出部分可信统计。此实现移植了 #90 的覆盖/质量分离思想，但 #90 的独立表和结果契约仍需最终取舍，当前也不是结果级配对报告。

`src/eval/evaluationAssessmentQueue.ts` 从同一账本与 Golden 定义生成逐 cell 待评审清单：列出每例声明的 hard-gate ID、必需产物、rubric 版本、Run 状态和耗时，但硬门统一为 `not-evaluated`、rubric 分数为 `null`、失败分类为 `pending`。即使测试中一个只读 Run 成功且结构覆盖从 0 变 1，72 个样本仍全部待业务评审。这是后续真实场景评测的工作队列，不是已经提交的 hard-gate 或质量结果。

成对可比性门槛：同一 Evaluation Run 的 baseline/candidate 必须共享 schema、Model、Vendor 修订；这些基础环境不同会在创建前拒绝。允许 App/Runtime/Tool/Context/Memory/Skill 在两侧不同，以保留候选改动空间。这只是版本兼容的必要条件，尚未冻结或核对相同 token/Tool/时间预算，也没有根据真实 case 结果判断策略效果。

SQLite 新表 `o_agentEvaluationRun` 保存清单及哈希，`o_agentEvaluationCase` 每 variant/case/seed 至多绑定一个实际 Agent Run，并阻止在同一 Evaluation Run 重用该 Agent Run。写入只接收已终结、版本有效且有 Trace 的 Run，记录来源 Project、Run 版本/状态、Output 哈希和最后 Trace 身份；相同记录幂等，重绑定或清单外组合拒绝。读取重新校验清单/证据哈希、矩阵归属与来源 Run 当前证据，明确返回 expected/recorded/missing。新表的更新触发器阻止篡改已写记录；删除和长期保留政策尚未完备，不能把这一切片称为不可删除的最终审计档案。

来源 Trace 现复用生产侧的因果链审计：写入和重读都要求从首事件开始序号连续、前驱身份正确；仅有一个“最后 Trace ID”不能证明整条链完整。定向测试把第二条事件前驱改成错误值后，`record` 与 `inspect` 均拒绝。

来源 Output 校验补充：账本不再只读取一个 `contentHash` 字段，而是重算当前单输出正文的 Runtime 哈希并核对 Output schema；正文被改而哈希未改时，写入与重读均拒绝。当前证据格式只存一个 Output 哈希，因此遇到多输出 Run 明确拒绝，不悄悄取第一条；多阶段生产 Run 的输出集合契约和逐项产物引用仍待后续设计。T11 7 个定向用例及 App TypeScript 检查通过，这不是业务质量评分。

终态 Run 的创建/完成时间也纳入来源证据；缺失或倒序时间拒绝，账本保存两端时间与可重算的端到端 `elapsedMs`，重读时复核。实际收费尚无可信 Provider 计量，`costMicros` 明确保留 `null`，不把未知成本说成零。

执行接线补充：`src/eval/evaluationAgentCase.ts` 先检查冻结矩阵与当前修订，再用确定性请求 ID 调用现有 AgentRuntime，等待注入调度器处理后重新 `inspect`，只把真正终结的 Run 交给上述账本。1 个真实 AgentRuntime + SQLite + Fake Text Model 定向用例证明这条最小只读 case 链、重复执行不多调 Model，以及错修订/错 case 在启动前拒绝。当前修订探针由调用方注入，尚未从构建产物或已配置 Vendor 独立提取；不能因此声称版本真实性已经被最终验收。

阶段验证：`tests/evaluationRun.test.ts` 5 例、`tests/evaluationAgentCase.test.ts` 1 例和 `tests/goldenEvaluationFreeze.test.ts` 1 例，覆盖清单拒绝、终态 Run 关联、幂等、重复 Run 拒绝、矩阵缺口、来源证据变化、queued/无 Trace 拒绝、真实 `initDB` 建表与更新触发器、旧库补建新表时保留原 Project、一个真实 Runtime/Fake Model case，以及 18-case/72-cell 冻结与覆盖报告；报告用一个真实只读 Run 显示 1/36 的结构覆盖，改写来源版本后拒绝。App TypeScript 检查通过，生成数据库类型已同步。没有跑全量单测、Golden Eval Runner、构建、浏览器或真实 Provider。

后续 T11 必须把确定的生产 AgentRuntime corpus 经生产 Runtime 执行，增加逐例可核验 rubric/安全硬门、产物引用、失败分类与真实费用来源，并生成结果级成对比较；T02 Golden 保持独立确定性基线，不强行迁移其不可由单次 Agent 请求观察的场景。相关修订应包括 Web/bundle 时再扩展清单。当前账本和单个只读接入样例只证明结构证据关联，不证明任何候选优于基线。T19 的真实消融继续受 T11 阻塞，最终完整验收仍留 T21。

2026-09-26 评审结果账本切片：新增 `o_agentEvaluationAssessment`，每个 Evaluation Run/case/seed/variant 最多一条不可更新记录；`createEvaluationAssessmentLedger` 只接受已在生产 Run 证据账本观察到、并属于冻结 Golden manifest 的 cell。记录必须按冻结顺序完整列出 hard gate，附格式受限的证据引用；人工评分只能为 0/1/2 且需要评审人、理由和引用，待评审则必须保留 null。结果绑定来源 case 证据哈希，重读时再次调用 Evaluation Run 的来源校验；重复同内容提交幂等，冲突评审拒绝覆盖。Run 非成功时必须显式给失败分类，费用仍为 null。测试覆盖非法 gate/评分、重复与冲突、SQLite 更新触发器、来源证据漂移，以及一次真实 AgentRuntime/Fake Model Run 关联后的评审记录；`evaluationAssessment` 与 Golden 集成定向 2/2、TypeScript 检查通过，数据库类型已再生成。

这一步只建立“谁基于哪条已观察 Run 提交了什么评审”的持久接口。证据路径目前只校验格式、不读取文件和哈希，评审人身份也是调用方声明；没有独立 hard-gate 执行器、校准后的人工 rubric、真实费用来源或 72-cell 执行。因此仍不能声称 hard gate 已经被系统独立验证、候选优于基线或 T11 已完成。

2026-09-26 配对评审报告切片：`src/eval/evaluationPairedAssessmentReport.ts` 从同一冻结清单的覆盖报告和评审账本生成固定 36 对、72 侧的机器可读报告与 Markdown。每侧明确区分缺生产 Run、未评审、Run 失败、待人工评分、硬门失败和已提交评分；只有同一 case/seed 两侧都提交了硬门通过且已评审的评分，才显示暂定分差。分母保持全部 36 对，缺失和失败不会从分母消失。报告明确标注评审和引用尚未独立验证，分差不是因果质量提升结论，成本与延迟也不作比较。已评审记录还必须列齐 Golden 声明的产物种类；产物路径及内容哈希仍是提交方声明，尚未独立读取校验。两个 T11 定向测试、TypeScript 检查通过；其中一对的分差仅由测试夹具产生，不是真实业务评测结果。T11 仍需 72-cell 生产执行、独立硬门与产物校验、费用来源及最终比较验收。

后续文件级验真切片：`src/eval/evaluationArtifactVerifier.ts` 接受明确的本地验证根目录，逐一解析评审引用，拒绝越界路径或非普通文件，读取真实字节并复算每个声明的产物 SHA-256，返回引用文件的观测哈希。定向单测覆盖正常复算、假哈希、缺文件与路径穿越；TypeScript 检查通过。此检查器尚未接入配对报告或最终验收流程，也没有真实 72-cell 的产物可供运行；它只验证文件存在及字节哈希，不验证 hard-gate 语义、评审人身份或文件与来源 Run 的业务关联。因此报告仍保持“提交方声明、未独立核验”的标记。

2026-09-26 配对报告文件级验真接线：报告契约升为 `toonflow.paired-assessment-report.v2`。调用方显式提供 `artifactRoot` 时，生成报告前先逐条对已记录评审调用文件检查器；任一引用缺失、越界或声明的产物 SHA-256 不符，整份报告拒绝，不产生部分“已核验”矩阵。每侧返回实际读取的引用文件哈希，汇总 `evidenceFileCheckedRuns`；未传根目录时该值为 0，文件列表为 `null`，绝不暗示已核验。定向测试同时覆盖成功、篡改后拒绝与未启用检查；TypeScript 检查通过。这里的“核验”仅指文件路径与字节哈希，硬门语义、人工评分/身份、文件与来源 Run 的业务关联仍未独立核验，暂定分差仍不是收益结论。72-cell Golden 执行和最终验收均未完成。

2026-09-26 单变体串行执行切片：`evaluationAgentCase.executeVariant` 从已冻结清单读取 case/seed 顺序，在启动任何生产 Run 前一次性校验传入的全部 case 正文哈希、集合与本次变体修订；再从 `evaluation.inspect` 的已验证证据跳过已记录 cell，逐 cell `await execute`，可用 `maxNewCells` 限制本次新增量并在下次调用续跑。它只运行 baseline 或 candidate 中的一侧，避免把不同修订要求混在同一进程；返回该侧 expected/alreadyRecorded/executed/remaining。`tests/evaluationAgentCase.test.ts` 2/2 通过，新增用例以真实 AgentRuntime、SQLite 和 Fake Text Model 验证错误输入在启动前拒绝、首批 1 cell 后续跑、重复调用不重发、观察到的局部 Model 调用最大并发为 1。此串行约束仅作用于单次 `executeVariant` 调用，不是跨进程分布式锁；没有真实 Provider 调用、费用测量、Golden 18 例运行、独立硬门或质量结论。`seed` 仍只是 cell 身份，未控制真实 Model 随机性。

2026-09-27 执行口径核对：T02 的 18 个稳定 case 并非 18 条已有生产 Agent 输入，而是调用确定性领域接缝的结构场景；其中包含提示词编译、SQLite 恢复、超限拒绝与预期失败等。当前 T11 冻结器允许调用方提供每例 Agent 输入正文，但尚无逐例的生产 Runtime fixture、Project 状态快照及原 hard gate 到 Run/Artifact 证据的映射。直接用 18 条泛化提示词填满 72 格只会得到形式上的覆盖，不能宣称原 Golden case 已迁移。下一切片须先冻结逐例输入与数据快照、说明哪些 T02 场景可经现有 Tool/Runtime 观察、哪些需独立版本的新 AgentRuntime corpus，再执行 baseline/candidate；若更换 corpus，应保留 T02 确定性基线的独立身份，不混用其历史 18/18 硬门结果。此口径缺口已记录在 Issue #67。

2026-09-27 用户决策与新语料切片：用户确认新建 AgentRuntime 18-case 语料，T02 Golden 18-case 继续作为独立确定性基线。ADR-0028、`CONTEXT.md` 和 `docs/reports/agent-harness-t11-runtime-corpus-spec.md` 固定这个身份区分。新增 `data/eval/agent-runtime-corpus-v1/manifest.json`，包含 12/3/3 分区的 18 条不同请求与具体 Project fixture 哈希；`data/eval/fixtures/agent-runtime-project-v1.json` 给出三章小说、事件关联、第一集剧本及 Script/Production 工作区。语料校验器拒绝缺例、重复、角色/权限不匹配、无效 fixture 哈希与 rubric 顺序；物化器只向空的隔离数据库写入经字节哈希核对的整套 Project 数据，失败不留部分写入。

新冻结器把语料原文、哈希、每例输入、Project ID 与修订写入 `toonflow.evaluation-run.v3`，而既有 T02 `v2` 路径继续可读。覆盖报告、待评审清单、评审账本和配对报告通过统一定义读取器消费任一冻结来源；不再把新语料误标为 Golden。已用定向测试验证 v3 冻结后 72 格全部 missing、消费者分母一致、fixture 哈希错误拒绝；另有一个真实 AgentRuntime + SQLite + Fake Model 的新语料 cell 调用受控 `get_novel_text` 并持久化一条成功 ToolReceipt，证明局部执行链可接通。执行适配器现在对 v3 case 要求注入真实 Project fixture 校验，并在启动前及 Run 终结后比对章节、事件、剧本、工作区与冻结数据；定向测试篡改章节后拒绝再次启动 Model。它仍不是长时间 Model 调用期间的数据库快照锁，也未实现独立 hard-gate 评分。新语料尚未完成真实 Provider 72-cell 执行、Tool/Output 语义硬门、人工 rubric 或质量比较。T11 仍开放；后续按 #103、#104、#105 推进。

双轴复核修正：语料校验现在拒绝同分区内重排；Project 状态核验在一个读取事务内对照冻结 fixture，期望行按 ID 排序以兼容合法的非排序源文件。v3 从 fixture 冻结 owner/actor ID，执行适配器在启动前检查 actor；Runtime 对显式 actor 做 Project Owner 校验并持久化于 Run input，账本写入与重读再次核对，避免两侧在不同权限身份下被误视为同条件。`docs/reports/agent-harness-t11-case-matrix.md` 列出每例预期 Tool/Trace/Output 与人工判断边界；机器可执行硬门及独立评分仍属 #104。生产调用期间无持续数据锁，这一限制不因前后两次核对而消失。

2026-09-27 #104 第一切片：`agent-runtime-corpus-v1` 每例新增结构化 `expectedToolCalls`，并受角色/权限范围校验。它是该例必需的读取集合；HOLD-RT-013 与 INC-RT-017 另列 `optionalToolCalls`，允许但不要求当前 Project 来源读取。除此之外的额外同 Project 章节读取也不计为通过，重复预期读取允许但不能代替缺失读取。`runtimeCorpusGateVerifier.ts` 对一个已观察 cell 独立复核当前 Project fixture、Run Output 安全性、受控读取 ToolReceipt 的输入哈希/输出 schema/真实 fixture 内容、对应因果 Trace，以及父 Run 的审批提案 Trace、输入中明确链接该父 Run 的子提案 Run 和父 Run 直接审批、图片、视频 Vendor 请求均不存在；缺预期读取或发现越界/伪造来源即返回失败，不以评审者自行提交的 `passed: true` 为证。损坏的 ToolReceipt 标记该格失败，72 格报告仍保留完整分母。全分母安全报告对 72 格区分 missing、failed、verified-read-and-safety-only。定向 Fake Model 用例证实一格读取通过、71 格缺失，并覆盖换输入哈希、自洽伪造 Tool 输出、损坏 JSON、伪造审批提案 Trace 和链接子 Run 的拒绝。配对报告现对 v3 语料将未跑安全检查的人工已评审记录标为 `unverified-safety`；安全检查通过也只标为 `pending-semantic-verification`，安全失败则为 `gate-failed`，不会输出暂定分差。此验证仍不能独立判断自然语言事实、holdout 泄漏/污染、人工 rubric 身份或来源 Run 与外部产物的语义关系；#104 保持开放。

2026-09-27 #104 第二切片：`runtimeCorpusEvidenceArtifacts.ts` 从已观察的生产 Run 生成固定版本的 Output、ToolReceipt、Trace 三类受保护评审投影，绑定 Evaluation Run、variant/case/seed、Agent Run ID 和来源证据哈希，并对投影正文做安全文本检查。配对报告契约升为 `toonflow.paired-assessment-report.v3`：v3 调用方若提供 `artifactRoot`，必须同时提供 Runtime 安全依赖；先复算磁盘文件字节，再对已完成评分且无来源失败分类的 Run 核对这些独立生成的生产证据投影哈希，任一不符整份报告拒绝。合法的取消/失败 Run 可没有 Output 与三份评审产物，仍保留在固定分母并显示 `run-failed`，不能因开启来源核验而令整份报告中断。`sourceProvenanceCheckedRuns` 与单纯的 `evidenceFileCheckedRuns` 分开计数；未验证时保持 0。定向测试在一条真实 AgentRuntime/Fake Model Run 上生成三份临时文件，验证正向绑定、篡改文件拒绝、伪造评审哈希拒绝、无安全依赖拒绝，以及第二条真实生产 Run 在 Model 调用前取消且无 Output 时仍保留 36 对；定向 8/8 与 TypeScript 通过。这里的证据文件只供受保护的本地评审目录，未上传到 GitHub；投影与来源 Run 一致也不能证明自然语言回答正确、评审人身份真实或 holdout 未泄漏。#104 与 #105 仍开放。

2026-09-27 #105 单格真实模型探针：`scripts/agnesRuntimeCorpusCanary.ts` 以 `AGNES_API_KEY` 环境变量在内存数据库装配 Agnes、只读 Production Skill/Grant、新 v3 语料冻结器及生产 AgentRuntime。仅执行 DEV-RT-009 的 baseline/seed 11：72 格中 1 格 observed，Run succeeded、Model 入口 1 次、受控读取 1 条，独立安全读取检查通过。完整边界和复现命令见 `docs/reports/agent-harness-t11-agnes-canary.md`。这不是候选实验，更不是 72-cell 质量、费用或收益结论；#105 仍开放。

2026-09-27 #105 可恢复执行准备：`runtimeCorpusCheckpoint.ts` 提供单执行者调用的内存 SQLite 快照操作，先把所有 Vendor `inputValues` 清空并执行 `VACUUM`，再序列化为新增的本地 checkpoint 文件，最后恢复仅存内存的 Vendor 配置；写盘前还检查调用方提供的真实密钥字节没有出现在快照中。加载时用快照字节新建内存数据库并验证 SQLite 完整性与 Vendor 配置仍为空，密钥只能重新从进程环境注入。定向单测以模拟密钥验证磁盘字节无密钥、内存仍有密钥、恢复后的 Project 可读、重复序号拒绝。该工具目前未接入 72-cell 执行器；它不解决外部 Model 调用期间进程崩溃造成的未知效果，正式续跑必须对此 fail closed。

2026-09-27 #105 盲评准备：`runtimeCorpusBlindReview.ts` 从 v3 已观察来源生成固定 36 对/72 侧的匿名 A/B 评审包；每侧只给请求、0/1/2 rubric、fixture 哈希、可安全展示的回复或 missing/failed 状态。HMAC 私钥决定稳定随机侧序与不可猜测 token，评审包元数据不含 variant、case ID、seed、Run ID、修订或来源证据哈希；独立的私有映射保留解盲所需身份。Fake Model 定向用例验证 1 ready/71 missing 与结构化元数据不泄漏基线/候选标签。模型回复本身仍可能自报处理方式，导出前需要人工核对并保留排除记录。尚无外部评审人、校准记录或评分，此函数不会自行产生质量结论；实际导出时必须把私有映射与评审包分开保存。

2026-09-27 #105 混合 Runtime 接线：新 18 例同时包含普通 Script 只读、Script Harness、Production Harness 三个 role/scope 合约；单个 `AgentRuntime` 实例无法执行全部。`evaluationAgentCase` 增加按 role＋scope 选择现有生产 Runtime 的入口，同时保留历史单 Runtime 依赖，拒绝同时传两种绑定方式。定向测试在同一 v3 Evaluation Run 中通过对应生产 Runtime/Fake Model 执行三种 scope，Script 与 Production Harness 都有真实 Skill 发布、Project 读取 Grant 与成功 ToolReceipt，独立来源读取/安全检查通过。这证明路由接线，不是完整 18×2×2 执行或同条件模型质量。`currentRevisions()` 目前仍是调用方声明；正式比较前须独立从三套 Runtime 的实际模型绑定、Tool/Skill/Context 修订抽取并逐格核对冻结合同，不能因路由成功便宣称修订同条件。

2026-09-27 #105 进程崩溃边界准备：`runtimeCorpusExecutionJournal.ts` 通过原子创建目录锁限制同一评测目录只有一个执行者，调用外部 Model 前写入并同步逐格 `inflight` 标记。`complete` 重新打开前后两份去密钥 SQLite 快照，调用 Evaluation Run `inspect` 验证 v3 冻结清单不变、已有格子证据不变且恰好新增该格的终态来源 Run，才写 `completed`；恢复时再复核快照哈希、连续序号与孤儿文件。checkpoint 改用独占临时文件加不覆盖目标的 hard link 发布，避免同序号并发覆写。定向测试覆盖单执行者、未知 Provider 效果拦截、旧快照冒充完成、完成后恢复及快照篡改。它们仍未组装成正式 72-cell runner，也不能替代 Provider 幂等。Windows 缺少可移植的目录 fsync；当前只讨论进程崩溃恢复，不声称突然断电下目录项持久顺序有保证，断电后须人工核对，不能自动续跑。

2026-09-27 #105 单格编排切片：`runtimeCorpusCellRunner.ts` 把 `begin` → 注入的生产 cell 执行 → 去密钥快照 → `complete` 固定为一个顺序边界。已完成 cell 再次调用时在执行回调前拒绝，定向 Fake 来源 Run 测试验证不会额外启动调用。执行回调抛错或快照/完成校验失败时故意保留未完成标记，须人工核查 Provider 是否收到请求；这不是自动重试机制。当前模块仍未装配三类真实 Runtime、两套处理 Skill、全局模型预算及 72-cell CLI，因而 #105 保持开放。

2026-09-27 #105 比较合同准备：`runtimeCorpusTreatment.ts` 为推荐的 Skill-only A/B 方案增加 v3 清单前置校验，要求 Skill 修订确实不同、其余 App/Schema/Runtime/Tool/Context/Memory/Model/Vendor 修订完全相同；定向用例验证 72 格及隐藏模型、Vendor、Runtime、Context 改动被拒绝。`agent-harness-t11-paired-study-plan.md` 明确普通 Script 只读格为未受 Skill 处理的负对照，交替执行顺序、单并发、固定分母、未知成本和盲评/holdout 边界。此方案仍是待冻结的预注册草案，未建立两份实际 Skill 修订、未从配置独立核验模型政策，也未运行 72 格或取得人工评分。

2026-09-27 #105 实际模型政策切片：`runtimeCorpusModelPolicy.ts` 固定 Agnes 文本模型、温度 0、输出上限 512、上下文窗口 524288 和最多两步，并为这些字段生成模型政策哈希；包装实际 Vendor `openTextCall` 结果时先核对绑定再强制两步上限。定向测试用真实 `initDB`/ConfiguredVendor 装配分别核对 Script 与 Production 逻辑模型，改温度立即拒绝；随后单格 Agnes 探针复跑成功，仍仅 1/72 observed、一次模型入口、一次受控读取、质量未验证。当前它验证目标和局部步骤上限，但尚无跨进程 72-cell 总调用预算、两侧 Skill 实际修订或人工评分；#105 保持开放。

2026-09-27 #105 实际 Skill 绑定切片：`runtimeCorpusSkillBinding.ts` 在读取事务内从两类 Harness 的活动绑定联接已发布 Revision 与生命周期政策，复算内容/manifest 哈希、校验角色和只读意图，生成实际激活集合指纹。比较 baseline/candidate 时要求 Skill ID、请求 Tool 和 Project 能力列表一致；仅提示内容/Revision 可以不同。逐例路由预检还会用真实 Router 对新语料的每条 Script/Production Harness 请求核对所选 Skill，普通 Script 只读格跳过；新增同优先级候选造成歧义即拒绝。定向单测从真实 SkillRuntime 发布/激活两类 Skill，验证候选内容更换导致指纹变化、增加 Tool/能力被拒绝、已发布内容不可改、撤销 Revision 后检查失败，以及逐例路由歧义拒绝。预检尚未接入正式 72-cell runner，也未安装正式两版 Skill，故不能宣称完整执行条件已冻结。

2026-09-27 #104 来源 Output 竞态修正：安全门读取 Run Output 时现在同时取正文、哈希和 schema，重算正文哈希并要求等于冻结 cell 的 `outputHash`；在 `evaluation.inspect` 与后续安全读取之间把 Output 换成另一份哈希自洽的安全文本会得到 `output-source-drift`，不再误判为 `verified-read-and-safety-only`。新语料 AgentRuntime 定向 6/6 与 TypeScript 通过。它只关闭这一个来源读竞态；不能据此解决所有外部变更窗口或自然语言事实评分，#104 仍开放。

2026-09-27 #104 评审投影同步修正：生成受保护 Output/ToolReceipt/Trace 文件前也复算当前 Output schema、正文哈希并与冻结 cell 的 `outputHash` 比较；同样的 inspect→读取竞态不再能导出一份表面上来源正确、实际来自已换正文的评审投影。定向竞态用例和 TypeScript 通过。Trace/ToolReceipt 的完整字节内容尚未在 EvaluationCase 写入时冻结为整体摘要，因此这里仍是当前来源投影的一致性保护，不应描述为永久不可篡改的完整审计链。

2026-09-27 #104 脱敏回归：复用 inspect→读取竞态夹具，把 Output 换成含模拟 API key 赋值的文本，独立安全门明确返回 `output-missing-or-unsafe`，而不是只依赖 Run 状态或来源哈希。此测试使用虚构字符串，不含用户真实凭据；定向 6/6 与 TypeScript 通过。规则正则无法证明覆盖所有秘密格式，受保护目录和人工导出复核仍必需。

2026-09-27 #104 holdout 状态显式化：当前 AgentRuntime holdout 三例在公开仓库中，开发过程已可读取；文件哈希与冻结清单不等于未接触盲测集。v3 配对报告现在固定写出 `holdoutIntegrity: unverified-public-corpus`，Markdown 同样说明不具封存盲测证明；v2 Golden 报告则标 `not-assessed`。定向新语料/Golden 报告测试和 TypeScript 通过。若最终要作独立 holdout 质量结论，需要新的封存流程及证明；当前不得把公开集结果称为未污染泛化证据。

2026-09-27 #105 调用前预检边界：单格编排器新增可注入 `preflight`，在写 `inflight` 前检查实际模型/Skill/路由/Project 的静态条件；配置漂移时既不留下“Provider 效果未知”标记，也不调用模型。之后执行适配器仍须在 marker 写入后重复关键检查，以防预检与调用之间的状态变化。定向测试验证预检报错时 Model 回调为 0 且恢复检查仍安全；正式 runner 尚未把全部实际检查接入此钩子。

2026-09-27 #105 矩阵顺序切片：`runtimeCorpusMatrixOrder.ts` 从冻结 v3 清单生成 36 对、72 侧的确定性顺序，每对相邻执行两侧，并在 36 对中平衡 baseline-first/candidate-first 各 18 对；续跑只过滤来源账本已经观察的 cell，重复或矩阵外身份拒绝。定向测试覆盖 72 唯一格、平衡首侧及 3 格后的稳定剩余顺序。它仅提供顺序，不调用模型；正式 driver 仍须在每格前先检查崩溃日志，再接 Skill 激活、预算与生产 Runtime。

2026-09-27 #105 两版 Skill 发布切片：`runtimeCorpusTreatmentSkills.ts` 提供不含逐例答案的普通只读/来源约束两套 Script、Production 文本，用同两个 Skill Definition 发布 baseline/candidate 各一版；两侧 manifest 的角色、只读意图、Tool、能力、依赖、资源与路由政策不变。发布器先激活 baseline，切到 candidate 实测活动指纹并核对权限相等，再切回 baseline；逐格切换操作按当前绑定版本幂等，断在两类 Skill 切换中间可在调用前重新修复。定向单测在真实 SkillRuntime/SQLite 中验证两版指纹不同、Tool 数相同、候选切换/重复/切回以及错误指纹拒绝。尚未把该发布器与 72-cell runner 和真实 Agnes 配对调用装配，文本也未得到人工评审，不能视为实验已经开始。

2026-09-27 #105 非秘密续跑方案：`runtimeCorpusStudyPlan.ts` 将 Evaluation Run ID/清单哈希、模型政策哈希及两版 Skill 的 ID/活动指纹以独占新文件保存，并对规范对象计算校验哈希；重开时要求与预期冻结身份完全一致，拒绝符号链接、重复写入、不同模型政策或字节篡改。测试确认不包含 API key 字段。该文件只是可恢复元数据，不是凭据库或防恶意篡改签名；Windows 目录持久性限制仍在，尚未接入 72-cell driver。

2026-09-27 #105 串行矩阵驱动切片：`runtimeCorpusMatrixDriver.ts` 把已冻结的 36 对顺序、来源账本、进程崩溃日志和单格编排串起来，只按预定前缀逐格 `await` 执行，支持 `maxNewCells` 分批。开始前重开指定的去密钥检查点，核对文件哈希、清单与已记录来源证据均等于当前内存账本；传旧检查点不会触发预检或模型回调。局部 Fake 来源测试从第 1 格续跑第 2 格，报告 72 预期、1 新增、70 缺失，并验证错误检查点先拒绝；TypeScript 检查通过。驱动器的实际 Runtime/Skill/Model 预检与执行仍由调用方注入，尚无正式 Agnes 72 格入口，不能据此声称跑过完整矩阵、得到质量结论或完成 T21 全量验收。

2026-09-27 #105 Agnes 矩阵工程探针：`scripts/agnesRuntimeCorpusStudy.ts` 已把普通 Script、Script Harness、Production Harness 三类生产 Runtime，两版同权限 Skill、实际模型政策/路由/fixture 前置检查、来源账本和串行矩阵驱动接到同一隔离内存数据库；`scripts/agnesRuntimeCorpusInspect.ts` 从去密钥快照只读列出覆盖、安全状态和未完成调用标记。私有目录中的一次真实单并发试跑到 22/72 格，22 格均为成功 Run、独立机器门为 `verified-read-and-safety-only`，随后 `candidate:DEV-RT-006:29` 留下未完成 `inflight` 而无第 23 份快照。外部调用效果未知，日志强制停机且不自动重试；细节与局限见 `agent-harness-t11-agnes-matrix-pilot.md`。这不是完整 72 格、人工评分、费用测量或质量收益证明，T11/#105 继续开放。

2026-09-27 T11 双轴复核修正：发现未评审的已观察格若机器门失败，配对报告会过早返回 `unassessed` 而隐藏已知失败；现在即使没有人工记录也输出 `gate-failed` 和 `runtime:*` 违规且分数仍为 `null`。另一个缺口是安全门失败虽在格末停机，下一次 `run` 未重验旧格；现在续跑前重新生成完整来源安全报告，任一旧格失败就拒绝后续 Provider 调用。第三，旧 pilot 的 App/Runtime/Tool 修订只对少数代表文件取哈希；新 `runtimeCorpusCodeRevision.ts` 对执行源码闭包、脚本、依赖锁文件及各子系统目录内容取哈希，重启时代码变动将与冻结合同不符。定向 AgentRuntime/报告/源码摘要 8/8 与 TypeScript 检查通过。旧 22 格 pilot 不可用新修订合同静默续跑；未完成外部调用仍待人工核查，72 格与人工评审依旧缺失。

2026-09-27 #104 完整来源行摘要切片：新写入的 v3 EvaluationCase 除已有 Output 哈希和因果 Trace 末端外，还保存 `sourceAuditHash`，由当时 Run 相关的整组 Output、Trace、ToolReceipt、审批、ToolCall、图片/视频 Vendor 请求行按稳定路径/字段排序后计算。后续 `evaluation.inspect` 重算；即使 Trace 仍保持连续、ToolReceipt 的正文与其新哈希自洽，只要源行被改写就拒绝来源账本。历史已写 v3 记录无此字段时仍可只读，但不因此追认为新合同；旧 22 格 pilot 是这种历史记录且已因中断/代码修订封存。新的 Fake Runtime 回归分别篡改 Output 元数据、Trace 和 Receipt，验证来源复核拒绝；机器门篡改测试改用已读取旧快照后的竞态模型。另一条合法成功但未调用预期 Tool 的 Run 保留在 72 分母，未提交人工评审也显示 `gate-failed`，并阻止自动续跑。定向 AgentRuntime 7/7 与 TypeScript 通过。摘要不是外部签名、不能证明自然语言答案正确或公开 holdout 未污染；#104 保持开放。

2026-09-27 #105 第二份独立 v3 Agnes 工程试跑：从当前来源闭包新建 0/72 账本，单并发执行后留有 5/72 个成功且机器门通过的格子；下一格 `candidate:DEV-RT-002:11` 在 execute 阶段失败，未产生 checkpoint 6，外部请求状态未知。in-flight 标记阻断自动续跑和重试。该结果没有人工语义评审，不能代替 72-cell 质量结论；细节见 `agent-harness-t11-agnes-matrix-pilot.md`。

2026-09-27 #67 v2 来源身份收敛：默认 `validateEvaluationRunManifest` 和新增 `evaluation.create` 现在拒绝没有 `goldenManifestJson` 的 v2；正式 T02 Golden 冻结必须走带 18 例原文、哈希和输入合同的路径。此前测试/历史产生的单例、无来源 v2 记录可在显式 `allowSourceLessLegacyV2` 兼容读取下继续 `inspect`/`record`，但定义依赖的报告仍拒绝它们，不能当作 T02 证据。定向 v2 创建拒绝、旧记录读写兼容和正式 18 例冻结 8/8，TypeScript 通过；这没有把 T02 确定性用例变成 AgentRuntime 生产输入，也没有执行 Golden 72 格。

2026-09-27 #104 输出评测控制标记增量：独立机器门在已观察 Run 的 Output 中检查冻结 case ID、Evaluation Run ID 和源 Agent Run ID，任何一个原样出现均增加 `evaluation-control-marker-leak`，即使正文自身哈希格式正确也不能视为干净回答。Fake Runtime 测试先红后绿，逐一注入三种标记并保持来源漂移检查；整份 T11 AgentRuntime 定向文件 7/7、TypeScript 检查通过。这个规则只检测精确内部标识泄漏，不等于语义上的 holdout 未污染，也不能识别所有改写/变形泄漏；现有公开 holdout 仍为 `unverified-public-corpus`，#104/#105 和质量结论继续开放。
