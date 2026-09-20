# Agent Harness T02 导学：18 例 Golden Eval 基线

> 证据边界：本文仅基于提交 `943a08893f1255f68837ab2f4b038a5d1d6d151e`、版本化 Manifest 与机器可读原始结果。不包含简历项目简介或 bullet，也不声称已上线、已完成真实模型评分、已有性能收益。当前可验证结论是确定性 hard gate `18/18`；质量量表人工评审为 `0/18 reviewed`、`18/18 pending`。T03 先统一诊断与脱敏，T04 引入首个持久化 Agent Run，T11（#67）再把评测入口切换到 Agent Runtime。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| Golden Test / Regression Corpus | 理解为何用固定输入、真值和可重放结果锁定行为 | `data/eval/agent-harness-golden-v1/manifest.json` | ★★★★★ |
| Hard gate 与 Quality rubric 分离 | 避免把“程序正确性”和“生成质量”混成一个无法解释的总分 | `src/eval/goldenEval.ts` 的 `hardGates` 与 `qualityReview` | ★★★★★ |
| 确定性 Fake / Test Double | 断开付费模型、Vendor 和网络波动，使回归可重放 | `DeterministicFakeModel`、`DeterministicFakeVendor` | ★★★★★ |
| 测试隔离与临时 SQLite | 每个 case 应在独立状态中运行，避免顺序依赖 | `createGoldenScenarioEnvironment` / `cleanup` | ★★★★ |
| Manifest Schema 与 Fail-fast 验证 | 先拒绝 case 数、分区、ID、证据或 rubric 漂移，再执行用例 | `validateGoldenEvalManifest` | ★★★★★ |
| 可归因失败分类 | 把 Runner 自身错误、门禁失败、证据不完整分开 | `failuresByTaxonomy` 及 case `failures` | ★★★★ |
| 幂等、事务与竞态隔离 | incident-regression 不是简单 happy path，要验证超时、取消晚到、回滚 | `timeout-no-replay`、`late-success-after-cancel`、`replacement-atomic-rollback` | ★★★★★ |
| SHA-256 内容指纹 | 用于对比 Manifest 和提示词输出，不把大段内容塞入报告 | `manifestHash`、`generationPromptHash`、`promptHashes` | ★★★ |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 版本化评测契约 | 先定义“测什么、怎么算过、需要什么证据”，才能使回归可审计 | manifest-driven eval、schema validation、stable IDs | `data/eval/agent-harness-golden-v1/manifest.json` | 1 |
| 确定性执行隔离 | 每例临时数据库、固定时间和 Fake 适配器消除外部器噪 | hermetic test、fake adapter、resource cleanup | `src/eval/goldenEvalScenarios.ts` | 2 |
| 可解释的门禁聚合 | 用 case、gate、artifact 三层结果告诉读者“为什么过/失败” | hard gate、evidence completeness、failure taxonomy | `src/eval/goldenEval.ts` | 3 |
| 质量与正确性分母分离 | 不因 18 个程序门禁通过就冒充生成质量通过 | rubric 0/1/2、pending review、no composite score | `src/eval/goldenEval.ts`、`docs/reports/data/agent-harness-golden-v1-results.json` | 4 |
| 事故回归模型 | 把超时不重放、取消晚到防护、原子回滚冻结成长期契约 | no replay、write fencing、transaction rollback | `src/eval/goldenEvalScenarios.ts` 的 `INC-*` 场景 | 5 |
| 机器可读基线 | 原始 JSON 保留分母、命令、环境、指纹和 case 证据，便于 CI 对比 | reproducibility、provenance、baseline drift | `scripts/runGoldenEval.ts`、`tests/goldenEval.test.ts` | 6 |

## 3. 必备知识点

- [ ] 能说清 Manifest 的 case 必需字段：fixture sources、ground truth、hard gates、required artifacts、expected failure class、0/1/2 rubric。
- [ ] 能解释为何分为 12 个 development、3 个 holdout、3 个 incident-regression，以及它们的用途不同。
- [ ] 能画出 `CLI -> runGoldenEval -> manifest validation -> executeGoldenScenario -> isolated SQLite/Fakes -> gate/artifact aggregation -> JSON` 主链。
- [ ] 能区分 case 期望的业务失败与 Runner 自身的评测失败。
- [ ] 能解释为何 `artifact-export-contract` 与 `required-artifacts` 是 Runner 追加的两道通用门禁。
- [ ] 能解释为何原始基线应当 byte-stable，以及测试如何防止漂移。
- [ ] 能明确说出限制：Fake 不代表真实 Provider，18/18 hard gate 不代表 18/18 生成质量。
- [ ] 能说明 T03/T04/T11（#67）的迁移方向：先统一诊断与脱敏，再实现持久化 Agent Run，最后保留 Manifest/结果契约并把场景执行入口改为 Agent Runtime。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 评测输入契约 | Schema、stable ID、partition、truth、rubric | `data/eval/agent-harness-golden-v1/manifest.json` | 35 分钟 | 为什么是 18 例，每例有哪些可审计字段？ |
| Runner 入口与验证 | fail-fast、aggregation、taxonomy | `src/eval/goldenEval.ts` | 45 分钟 | 一个 case 如何从 Manifest 变成结果？ |
| 隔离环境 | temp DB、Fake Model/Vendor、cleanup | `src/eval/goldenEvalScenarios.ts` 第 1–212 行附近 | 35 分钟 | 怎样做到无付费调用且无 case 间污染？ |
| 18 个场景 | extraction / prompt / derived / reference / recovery / incident | `src/eval/goldenEvalScenarios.ts` 的 `scenarios` | 90 分钟 | 每类风险如何被变成可观测 gate 和 artifact？ |
| CLI 与基线写入 | read-only run、`--write`、exit code | `scripts/runGoldenEval.ts`、`package.json` | 15 分钟 | 本地与 CI 怎样运行、何时写入基线？ |
| 契约测试 | exact cardinality、determinism、checked-in baseline | `tests/goldenEval.test.ts` | 25 分钟 | 哪些测试防止 case 漂移和基线被静默改写？ |
| 机器原始结果 | provenance、denominator、evidence | `docs/reports/data/agent-harness-golden-v1-results.json` | 30 分钟 | 哪些是已验证事实，哪些仍是 pending？ |
| 业务边界背景 | Base/Derived、prompt、image lifecycle | `docs/adr/0007-derived-assets-use-parent-anchors.md`、`docs/adr/0008-image-generation-lifecycle.md`、`docs/adr/0009-separate-base-extraction-from-derived-analysis.md` | 45 分钟 | 为什么这些场景值得进入 incident 或 holdout？ |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。建议每读完一层就手写一次输入、状态、输出和失败边界，不要只记内部类名。

## 6. 项目技术定位

**Agent Harness 为主、AI 应用开发为次、AI 应用后端为补充的交叉工程。** 依据是：主产物是可版本化的评测契约、隔离执行环境、可诊断结果与事故回归；同时调用了真实的资产提取、提示编译、Derived Asset 和图像生命周期公开边界，并以 SQLite 事务、错误分类、CLI 和 JSON 基线补齐后端可运行性。

## 7. 核心原理解析

### 7.1 从“测函数”升级为“版本化评测契约”

**问题**：用例若只散落在代码中，审查者难以知道样本分区、真值、所需证据和已知失败类。**机制**：Manifest 为每个 case 固定 ID、fixture source、ground truth、hard gate、artifact、failure class 和 0/1/2 rubric。**落点**：`validateGoldenEvalManifest` 在执行前强制 18 例与 12/3/3 分区，防止基线静默缩水。

### 7.2 确定性来自边界受控，不是来自“多跑几次”

**问题**：真实模型、Vendor、时间和持久化状态都可能导致结果漂移。**机制**：每个 case 创建临时 SQLite，注入固定响应的 Fake Model/Vendor，需要时注入固定 `now`，最终在 `finally` 中销毁数据库和临时目录。**落点**：原始结果明示 `paidProviderCalls: 0`，两次 Runner 结果深相等。

### 7.3 门禁与证据完整性是两个维度

**问题**：某个布尔判断可能通过，但报告没有留下可复核证据，或者证据本身不适合导出。**机制**：场景返回 `gates` 与 `artifacts`；Runner 根据 Manifest 匹配领域门禁，再追加 `artifact-export-contract` 与 `required-artifacts` 两道通用门禁。前者执行顶层 allowlist 和递归敏感内容检查，后者检查证据完整性。**落点**：违规导出归类为 `Artifact/evaluation/redactionFailed`，缺少证据归类为 `Artifact/evaluation/evidenceIncomplete`，都不会被“场景返回 true”掩盖。

### 7.4 程序正确性不等于 AI 质量

**问题**：将 hard gate 与主观质量压成总分，会让“接口没泄密”和“视觉效果好”之间不可解释。**机制**：每例 hard gate 单独出结果，quality 仅冻结量表锚点，在没有人工评审时明确 `pending`、`score: null`。**落点**：当前只能说 hard gate 18/18，quality 仍 18 pending，且结果中不存在 composite score。

### 7.5 事故回归要锁定不变式

**问题**：超时重放可导致重复计费，取消后晚到写入可复活终态，重抽取半成功会破坏关联。**机制**：三个 incident case 分别验证单次 Vendor 调用、状态条件写入栅栏、事务整体回滚。**落点**：`INC-IMG-001`、`INC-IMG-002`、`INC-EXT-001` 保留了分类结果、调用次数和回滚后状态。

### 7.6 可重放结果必须带来源信息

**问题**：一个“全绿”JSON 如果没有 Runner 版本、Manifest 指纹、基线 revision、执行命令和环境层级，无法审计。**机制**：结果顶层固定 `runId`、`runnerVersion`、`manifestHash`、`baselineRevision`、`executionTier`、`commands`、`environment`。**落点**：当前 Manifest SHA-256 为 `f591cf24090b041b6b573fa14a7d63b08283dbbb30dabbfc0bef148072b57940`，可与原始结果交叉核对。

## 8. 关键设计决策

| 决策 | 备选 | 取舍 | 主要风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| Manifest 固定 18 例与 12/3/3 分区 | 代码内临时组装用例 | 增加 schema 维护成本，换取可审计和防静默缩水 | case 存在但业务覆盖仍不充分 | 引入新故障时先补充风险矩阵，再评估是否升版 suite |
| 每 case 独立 SQLite | 共享一个 DB 或 mock repository | 执行成本略高，换取真实 schema 路径和顺序无关 | 数据库初始化变慢 | 待测单 case 启动时间与整体耗时，再决定是否做 schema snapshot |
| Fake Model/Vendor 而非真实 Provider | 直接端到端付费调用 | 保证确定性和零付费调用，但不验证外部服务契约 | Fake 与真实适配器漂移 | 后续增加独立的受控 provider contract/smoke tier，不混入本基线 |
| Hard gate 与 quality rubric 分开 | 单一综合分 | 报告更复杂，但避免不同性质信号相互抵消 | 人工评审可能不一致 | 待测双人盲评一致性，记录分歧而不只记均分 |
| 追加 export-contract 与 required-artifacts 通用门禁 | 只相信 scenario gate | 以 allowlist、递归敏感检查和完整性检查换取安全可复核的结果 | 仍未验证所有 artifact 的业务语义 | 后续为高风险 artifact 增加类型/schema 验证 |
| 将当前场景直接连接现有领域公开边界 | T02 就自建 Agent Runtime | 快速冻结当前行为，但 Runner 还不是统一 Runtime 入口 | 后续 Runtime 迁移可能出现双路径 | T03 统一诊断与脱敏，T04 建立 Runtime，T11（#67）保留 Manifest 和结果契约并切换执行入口 |

## 9. 量化与验证（含待测，建议）

### 已有可核验数据

- 用例定义/执行：`18/18`；分区为 development `12/12`、holdout `3/3`、incident-regression `3/3`。
- 确定性 hard gate：`18 passed / 0 failed / 18 denominator`。这是 case 级通过数，不是统计所有单独 gate 的总数。
- 人工质量评审：`0 reviewed / 18 pending / 18 denominator`，0/1/2 各档当前都是 0，不能换算为质量通过率。
- 环境：临时 SQLite，确定性 Fake Model 和 Fake Vendor，付费 Provider 调用 `0`。
- 可重放标识：Runner `golden-eval-runner@1.0.0`；Manifest hash `f591cf24090b041b6b573fa14a7d63b08283dbbb30dabbfc0bef148072b57940`。

### 待测建议

1. **质量 rubric 人工复评（待测）**：先定义评审员资格、盲评方式和分歧处理，再对 18 例逐例留存证据与 0/1/2 分；不用单一平均分遮蔽 case 差异。
2. **执行性能（待测）**：记录总耗时、case p50/p95、SQLite 初始化占比和峰值内存；当前代码未提供这些数据，不应声称性能改善。
3. **故障注入充分性（待测）**：对 Runner error、gate false、artifact 缺失分别注入，核对 taxonomy 和 CLI 非零退出是否符合预期。
4. **Fake 契约漂移（待测）**：将 Fake 的方法签名与真实 Model/Vendor adapter 契约做类型或 contract test 对齐，避免本地全绿而真实集成失效。
5. **T04/T11 Runtime 迁移验证（待测）**：T03 先固化可复用诊断与脱敏契约；待 T04 有持久化 Runtime 后，以同一 Manifest 对比当前边界与 Agent Runtime 路径，最终由 T11（#67）固化 EvaluationRun 并删除临时双路径。
6. **真实 Provider 冒烟层（待测，不属于本基线）**：若后续确有授权和预算，用极小独立 suite 验证认证、超时、限流和响应 schema，不应修改 deterministic baseline 的“零付费调用”定位。

## 10. 学习后自测

1. 不看代码，用两分钟说清从 Manifest 到 raw result 的整条链路。
2. 说明 `18/18 hard gate` 的精确含义，并主动补充 `18/18 quality pending` 的边界。
3. 从 18 例中各选一个 extraction、prompt、recovery、incident case，说出输入、不变式、artifact 和失败类。
4. 解释为什么现在的 Runner 还不能宣称是统一 Agent Runtime，以及 T03、T04、T11（#67）分别应承担什么边界。
5. 如果面试官说“既然全过了，为什么不能说 AI 效果好”，能用 hard gate / rubric / provider tier 三层边界回答。
