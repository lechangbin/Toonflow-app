# Agent Harness T03 导学：Trace-safe 诊断与脱敏门禁

> 证据基线：提交 `20db9d1b9e78ad9a9706fd79afbeabd46e416699`。本文只描述仓库中已经落地、可由源码与阶段单测核验的行为；不声称已经上线，不声称取得性能收益，也不把尚未实现的 Run/Trace 持久化写成完成项。按当前迭代约定，本阶段只执行聚焦单元测试与静态检查，全量测试、构建和端到端验收统一留到所有阶段完成后的最终验收。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| Agent Harness 与业务 Agent 的边界 | 理解诊断契约为何属于运行保障层，而不是某个 Prompt 或模型策略 | `src/diagnostics/traceSafeDiagnostics.ts`、ADR 0010 | 高 |
| Fail-closed / Fail-open | 能解释发现未知字段或敏感内容时为什么整条拒绝，而不是删字段后继续 | `inspectTraceSafePayload`、`projectTraceSafeDiagnostic` | 高 |
| 白名单契约与运行时校验 | TypeScript 类型不能保护 VM、JSON、Vendor 等运行时边界 | stage/kind/audience/attribute allowlist | 高 |
| 结果确定性与重试语义 | 超时不等于失败；盲目重放可能产生重复副作用 | `certainty`、`retryDisposition`、图片 Vendor 适配 | 高 |
| 敏感信息与间接泄漏 | 密钥、签名 URL、Base64、异常 message/stack、隐藏推理都可能进入日志 | 递归检查器、异常链投影、legacy logger 固定标记 | 高 |
| 适配器与领域契约 | 供应商错误形态不应直接污染核心分类和 UI | `projectVendorImageFailureDiagnostic` | 中高 |
| 契约版本化与负向夹具 | 安全边界需要可回归的反例资产，而不只是几条正向测试 | `data/eval/trace-safe-diagnostics-v1/negative-fixtures.json` | 中高 |
| 结构化路径与最小披露 | 报告问题位置时不能把原始 key/value 再泄漏出去 | `TraceSafeViolation.path` 只记录索引化结构路径 | 中 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 统一诊断契约 | 把不同消费者拉回一个版本化语义面，避免日志、评测和 UI 各自脱敏 | schema、taxonomy、projection | `src/diagnostics/traceSafeDiagnostics.ts` | 1 |
| Fail-closed 安全门禁 | 任何未知结构和敏感载荷都拒绝整条导出，避免“删掉一半后看似可信” | allowlist、recursive inspection、redaction gate | 同上；负向夹具 | 2 |
| 重试语义建模 | 用“副作用是否已发生”约束重试，不把网络失败简单等价为安全重试 | outcome certainty、reconcile-first | `src/assets/imageGenerationLifecycle.ts` | 3 |
| 旧日志收口 | 对无法证明安全的自由文本不再尝试猜测，而是输出稳定拒绝标记 | legacy boundary、safe marker | `src/utils/vm.ts`、`src/err.ts` | 4 |
| 多出口一致投影 | 同一接口面向 Trace、ToolReceipt、evaluation、UI 四类受众 | audience projection、contract reuse | 诊断模块与对应测试 | 5 |
| 可回归负向证据 | 用版本化恶意样本覆盖密钥、JWT、签名 URL、二进制、环和深层对象 | adversarial fixtures、regression | `tests/traceSafeDiagnostics.test.ts`、夹具文件 | 6 |

## 3. 必备知识点

- [ ] 能区分失败分类、发生阶段、稳定 kind、严重度、结果确定性、预期性和重试处置，说明它们为什么不能揉成一个错误码。
- [ ] 能解释 TypeScript 静态类型为何无法覆盖反序列化对象、VM 对象、第三方响应和恶意 getter。
- [ ] 能说明白名单校验、敏感模式检测、递归深度限制、循环引用检测各自解决什么威胁。
- [ ] 能解释为什么异常链只保留受约束的 `Error.name`，而不输出 message、stack 与 cause 原文。
- [ ] 能区分 `known-no-effect`、`known-effect`、`unknown-effect`，并据此选择 `safe-retry` 或 `reconcile-first`。
- [ ] 能指出 T03 的边界：定义与接入安全投影，不创建 Run/Trace 数据表，不宣称持久化已经完成。
- [ ] 能说明阶段单测与最终全量验收的不同证据力度，避免把局部绿色说成全仓通过。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 决策记录 | 架构边界、取舍、演进约束 | `docs/adr/0010-use-one-fail-closed-diagnostic-export-seam.md` | 8 分钟 | 为什么选择统一深模块和 fail-closed |
| 核心契约 | schema、分类法、白名单、递归检查 | `src/diagnostics/traceSafeDiagnostics.ts` | 35 分钟 | 一条诊断如何被接受或拒绝 |
| Vendor 适配 | 防腐层、结果确定性、重试纪律 | `src/assets/imageGenerationLifecycle.ts` | 25 分钟 | 图片超时为何要先对账而非盲重试 |
| 评测复用 | 共享检查器、兼容性 | `src/eval/goldenEval.ts` | 15 分钟 | 如何在不改变既有评测输出的前提下复用门禁 |
| 旧入口收口 | legacy compatibility、安全退化 | `src/utils/vm.ts`、`src/err.ts` | 15 分钟 | 自由文本日志为什么只输出固定标记 |
| 供应商边界 | 原始响应、签名材料、稳定本地错误 | `data/vendor/volcengine.ts`、`data/vendor/volcengineSd2.ts` | 25 分钟 | 哪些 Provider 信息不能越过边界 |
| 负向回归 | 恶意样本、跨 audience 一致性 | `tests/traceSafeDiagnostics.test.ts` | 30 分钟 | 如何证明门禁不是只有 happy path |
| 静态迁移守卫 | 防止旧日志写法回归 | `tests/diagnosticLoggingContracts.test.ts` | 15 分钟 | 如何约束散落调用点不再输出异常正文 |
| 领域接入测试 | Vendor 诊断验证与映射 | `tests/imageGenerationLifecycle.test.ts` | 20 分钟 | 非法 Vendor 诊断如何被拒绝 |
| 版本化反例 | 数据驱动安全回归 | `data/eval/trace-safe-diagnostics-v1/negative-fixtures.json` | 10 分钟 | 新泄漏类型如何进入回归资产 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。建议每读完一个入口，先画出“输入来源 → 校验 → 投影 → 消费者”的四格图，再对照测试补充拒绝路径。

## 6. 项目技术定位

这是一个以 **Agent Harness 为主、Agent 应用开发为第二重点、AI 应用后端为补充** 的交叉项目阶段：核心工作是给 Agent 运行链路建立可审计、可复用且不泄漏的诊断出口；它不涉及模型训练、推理算法或算法岗所需的指标优化。

### 证据边界

- 已实现：版本化诊断 schema；六类 failure class；显式 stage/kind；四种 audience；递归敏感内容检查；严格字段与数值校验；异常链最小投影；Vendor 图片失败适配；旧日志入口固定拒绝标记；版本化负向夹具与聚焦单测。
- 已接入：Golden Eval 复用共享检查器；图片生成生命周期使用共享投影；多个旧日志与 Vendor 原始信息路径完成收口。
- 未实现：Agent Run 与 Trace 的持久化模型、真正的 ToolReceipt 存储、面向用户的完整诊断查询界面、跨进程追踪链、生产告警规则。
- 未验证：全仓测试、生产构建、端到端流程、真实性能影响、线上泄漏率或故障恢复收益；这些统一留到所有阶段后的最终验收。

## 7. 核心原理解析

### 7.1 自由文本不可证明安全 → 结构化契约 → 单一出口

问题：模型、Provider、VM 和异常对象都能产生自由文本，靠调用方“记得脱敏”会形成大量不一致出口。机制：先把诊断压缩成受控字段，再通过一个投影函数验证枚举、属性和原因链。项目落点：`TraceSafeDiagnosticInput` 进入 `projectTraceSafeDiagnostic`，成功时才生成带 schemaVersion 与 audience 的输出。

### 7.2 删除危险字段会伪造完整性 → 整条拒绝 → 结构路径反馈

问题：若发现 secret 后只删掉该字段，消费者无法知道证据已残缺，可能错误地把剩余内容当成完整事实。机制：任一违规使整条结果变为 `ok: false`，只返回 violation code 与不含原 key 的结构位置。项目落点：`inspectTraceSafePayload` 和诊断属性检查都采用 fail-closed。

### 7.3 静态类型保护不到运行时 → 运行时 allowlist → 防契约漂移

问题：第三方 JSON、VM 对象以及强制类型断言可以绕过 TypeScript。机制：在运行时枚举顶层字段、stage、kind、audience、attribute key 与数值范围；未知值直接拒绝。项目落点：预注册 stage/kind 集合、精确输入字段集合和属性语义校验。

### 7.4 网络失败不代表未执行 → 结果确定性 → 保守重试

问题：请求超时或传输错误时，供应商可能已经接受任务，直接重试可能重复生成或计费。机制：把错误与副作用确定性分开，生成阶段的 timeout/transport/httpError 映射为 `unknown-effect + reconcile-first`；下载阶段已有远端产物，映射为 `known-effect + reconcile-first`。项目落点：`projectVendorImageFailureDiagnostic`。

### 7.5 异常链有定位价值但也携带秘密 → 只留错误种类 → 有界原因链

问题：message、stack、cause 往往包含请求正文、文件路径、密钥或 Provider 响应。机制：检查完整消息是否危险，但输出只保留符合标识符约束的 Error.name，并限制原因链深度。项目落点：`inspectCauseChain`。

### 7.6 旧接口无法保证结构化 → 固定拒绝标记 → 推动迁移

问题：VM `logger(string)` 等旧接口没有上下文，安全检测永远可能漏报。机制：不尝试回显“看起来安全”的内容，统一输出 `[diagnostic-rejected:unstructuredLog]`。项目落点：`formatTraceSafeLog` 与 VM、进程级错误入口；代价是短期可观测细节减少，但避免把猜测当保证。

## 8. 关键设计决策

| 决策 | 备选 | 取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| 一个共享深模块 | 各业务分别写脱敏 helper | 一致性与审计性优先，减少重复策略 | 模块成为关键依赖点 | 核心单测 + 多 audience 同输入测试 |
| 整条 fail-closed | 删除危险字段后继续输出 | 保留证据完整性语义 | 合法新字段会被拒绝，迁移成本更高 | unknown-field 负向测试与版本化夹具 |
| stage/kind 使用注册表 | 允许任意安全字符串 | 防拼写漂移和不可聚合 | 新场景需要先扩契约 | 非法枚举单测；新增值需测试评审 |
| Error 只输出 name | 输出清洗后的 message | 降低泄漏面并保留粗粒度类型 | 定位信息不足 | 原因链单测确认 name 保留、正文消失 |
| 旧日志全部固定标记 | 正则判断后回显普通文本 | 安全边界清晰 | 迁移期日志可读性下降 | 静态守卫 + legacy logger 单测 |
| Vendor 先验证再映射 | 将非法字段静默修正为默认值 | 防止坏数据伪装成合法证据 | 对旧 Vendor 更严格 | 非法 kind/stage/数值/未知字段测试 |
| 不在 T03 新建持久化 | 同时完成 Run/Trace 表和查询 UI | 控制阶段范围，先稳定契约 | 当前四 audience 只是统一输出契约，并非四套存储都完成 | 在 ADR 与报告中明确延期边界 |

## 9. 量化与验证（含待测，建议）

### 已有阶段证据

- 聚焦单元测试覆盖：负向夹具、四 audience、异常链、循环引用、深度限制、未知枚举、Vendor 图片失败映射、旧日志静态迁移守卫。
- 静态检查可用于证明关键旧入口没有重新出现输出捕获异常正文、Provider 原始对象或签名材料的写法。
- 当前提交可作为复现基线；本文不把测试用例数量推导成线上安全覆盖率。

### 最终验收时再测

| 指标/验证项 | 当前状态 | 建议方法 | 通过标准建议 |
| --- | --- | --- | --- |
| 全仓回归测试 | 待测 | 所有阶段完成后统一运行仓库完整测试命令 | 无新增失败，并记录精确命令与用例数 |
| 生产构建 | 待测 | 最终验收执行正式 build | 构建成功且产物差异可解释 |
| E2E Agent 流程 | 待测 | 覆盖工具失败、Vendor 超时、下载失败、UI 展示 | 敏感原文不出现在日志、响应和持久化输出 |
| 性能开销 | 待测 | 对典型与深层 payload 做基准，统计 P50/P95 | 先采基线再定阈值，不预设虚构百分比 |
| 误拒绝率 | 待测 | 回放合法诊断样本并统计 contractRejected | 每个误拒绝能对应契约扩展或调用方修复 |
| 泄漏回归能力 | 部分已测 | 扩充 secret、URL、JWT、二进制、恶意 getter 语料 | 所有恶意样本 fail-closed 且返回值不含原文 |
| 重试正确性 | 部分已测 | 模拟请求已受理但客户端超时的供应商场景 | unknown-effect 不自动重放，先查询/对账 |

## 10. 限制与后续深化

1. 当前规则仍是显式模式与白名单的组合，不等价于形式化的信息流证明；最终应结合真实日志采样、渗透测试和代码审计。
2. Trace、ToolReceipt、evaluation、UI 是同一投影接口的受众标签，但 T03 未实现前三者之外的新持久化设施；不要口述成“四套系统已上线”。
3. 固定拒绝标记牺牲了旧日志可读性，后续应把高价值调用点迁移到结构化诊断，而不是重新放开自由文本。
4. stage/kind 注册表需要治理流程；新增枚举应同步 ADR/契约、负向夹具、调用方与消费者。
5. Vendor 的 `providerRequestId` 仅在符合受控标识符时可输出；是否允许更多字符必须基于真实供应商格式和安全审查。

## 11. 自测题

1. 为什么“先删除 secret，再输出剩余对象”不符合本阶段的证据完整性目标？
2. `unknown-effect` 与 `known-effect` 分别会怎样影响重试策略？举图片生成和下载各一个例子。
3. 为什么 `Error.name` 也需要运行时检查，而不能天然认为安全？
4. 如果新增一个 `region` 属性，应该改哪些 allowlist、类型、测试和文档？
5. 同一个恶意诊断为何要对四种 audience 都测试，而不能只测 Trace？
6. 固定拒绝标记造成哪些观测损失？怎样通过结构化迁移补回来？
7. 哪些证据能证明 T03 已完成，哪些说法必须等最终全量验收后才能成立？
8. 设计一个“Vendor 已受理但响应超时”的测试，说明期望的 certainty 和 retryDisposition。
9. 为什么 violation path 不直接记录原始字段名？它如何在安全与可定位之间折中？
10. 如果最终 E2E 发现 UI 仍展示 Provider 原始错误，你会沿哪条数据链定位并在哪一层修复？
