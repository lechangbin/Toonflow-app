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

后续 T11 必须把全部 Golden case 经生产 AgentRuntime 执行，增加逐例可核验 rubric/安全硬门、产物引用、失败分类与真实费用来源，并生成结果级成对比较；相关修订应包括 Web/bundle 时再扩展清单。当前账本和单个只读接入样例只证明结构证据关联，不证明任何候选优于基线。T19 的真实消融继续受 T11 阻塞，最终完整验收仍留 T21。

2026-09-26 评审结果账本切片：新增 `o_agentEvaluationAssessment`，每个 Evaluation Run/case/seed/variant 最多一条不可更新记录；`createEvaluationAssessmentLedger` 只接受已在生产 Run 证据账本观察到、并属于冻结 Golden manifest 的 cell。记录必须按冻结顺序完整列出 hard gate，附格式受限的证据引用；人工评分只能为 0/1/2 且需要评审人、理由和引用，待评审则必须保留 null。结果绑定来源 case 证据哈希，重读时再次调用 Evaluation Run 的来源校验；重复同内容提交幂等，冲突评审拒绝覆盖。Run 非成功时必须显式给失败分类，费用仍为 null。测试覆盖非法 gate/评分、重复与冲突、SQLite 更新触发器、来源证据漂移，以及一次真实 AgentRuntime/Fake Model Run 关联后的评审记录；`evaluationAssessment` 与 Golden 集成定向 2/2、TypeScript 检查通过，数据库类型已再生成。

这只建立“谁基于哪条已观察 Run 提交了什么评审”的持久接口。证据路径目前只校验格式、不读取文件和哈希，评审人身份也是调用方声明；没有独立 hard-gate 执行器、校准后的人工 rubric、结果级成对报告、真实费用来源或 72-cell 执行。因此仍不能声称 hard gate 已经被系统独立验证、候选优于基线或 T11 已完成。
