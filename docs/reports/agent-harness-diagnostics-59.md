# Agent Harness T03：Trace-safe diagnostics 与脱敏硬门

> Issue：#59。Schema：`toonflow.trace-safe-diagnostic.v1`。实现提交：`20db9d1b9e78ad9a9706fd79afbeabd46e416699`。本文是实现与验证证据，不是简历文案；不声称已经上线，也不声称完成仓库全量测试、构建或最终生产验收。

## 1. 交付边界

T03 在引入 durable Agent Run 之前，先建立一个共享、fail-closed 的诊断导出边界。它解决三个问题：不同调用方的失败分类不可比较；原始异常、Provider body、凭证和生成媒体可能进入日志、评测或 UI；非法 Vendor 诊断可能被旧 sanitizer 静默纠正后持久化。

本阶段没有创建 Run、Trace、ToolReceipt 数据表，也没有宣称四类 audience 已各自具备持久化存储。`trace`、`toolReceipt` 是供 T04 及后续阶段使用的投影契约；`evaluation` 已接入 Golden Eval；`ui` 与日志出口通过固定错误和固定拒绝标记收口。

## 2. 精确来源与产物身份

| 项目 | 精确值 |
| --- | --- |
| App 基线 | `4abc74322efef1314766bf52b624b5b8c53ada8f` |
| T03 实现 | `20db9d1b9e78ad9a9706fd79afbeabd46e416699` |
| Web 既有冻结基线（T03 未修改） | `c8c0bf48cde30b4634c05b652454b701f8980e04` |
| `data/serve/app.js` Git blob | `073c2143fd794646d56e0331aec42b097ec382ee` |
| `data/serve/app.js` SHA-256 | `D6E463FA637455C117750DFEFA428A2D26EADA4721D70F27D9504B0D9DE050BD` |
| `src/lib/vendor.json` Git blob | `72bcd4d071a8cc908e453efbf48bdaa136e92e14` |
| `src/lib/vendor.json` SHA-256 | `F162D49CE7DBEC9C79066DAB15C3F568567AA0354434F7C0EE0C807E10AE72AF` |
| negative fixtures Git blob | `2d5933173e9f6ef2cf45367dbe711f4f10586951` |
| negative fixtures SHA-256 | `74C6B96742ACF17FA48B1D664698075BB4FD131102815F0F906EE4D65DCB46EF` |

T03 未修改 `data/web/**` 或 `data/serve/app.js`。根据用户确定的分阶段验收策略，本阶段没有重新执行生产 build；上表记录的是 checked-in bundle 的身份与未修改事实，不是一次新的构建通过声明。

## 3. 共享 taxonomy

稳定失败类为 `Extraction`、`Decision`、`Tool`、`Context`、`Vendor`、`Artifact`。每条安全诊断必须同时给出：

- `stage`：版本化阶段枚举；
- `kind`：版本化失败种类；
- `severity`：`warning | error | fatal`；
- `certainty`：`known-no-effect | known-effect | unknown-effect`；
- `expectedness`：`expected | unexpected`；
- `retryDisposition`：`never | safe-retry | deduplicate-first | reconcile-first`；
- `audience`：`trace | toolReceipt | evaluation | ui`，运行时同样校验，不能只依赖 TypeScript。

字段不在 allowlist、枚举漂移、数值非法或对象无法安全枚举时，投影返回结构化 violations，不返回半脱敏对象。Error cause chain 只保留受约束的 `Error.name`，不保留 message 或 stack。

## 4. 脱敏硬门

`src/diagnostics/traceSafeDiagnostics.ts` 统一检查：

- Bearer/Basic、`sk-`/`sk_`、npm、GitHub、AWS access key、JWT 与敏感键；
- 普通 URL 与签名 URL；
- 长 Base64、短 Data URI、带 metadata/base64url 的 Data URI，以及字符串中部出现的 Data URI；
- Buffer、ArrayBuffer、TypedArray；
- raw Provider/Vendor request/response/payload/result/output/body，含 camel、snake、kebab 形式；
- hidden reasoning / chain-of-thought，含命名分隔符变体；
- 未声明字段、循环引用、超深对象与 throwing getter/Proxy。

旧式自由文本日志不再尝试判断“看起来安全”，而是一律输出固定的 `[diagnostic-rejected:unstructuredLog]`。因此提示词、路径、JSON、错误正文和内容类别都不会从该入口回显。

## 5. 真实生产链接入

### 5.1 Evaluation

Golden Eval 删除本地重复 scanner，改用共享检查器。顶层 artifact 仍受 Manifest allowlist 约束；嵌套对象再受明确 key allowlist 约束。历史基线中 `prompt`、`filePath` 只允许 `null`，若未来塞入提示词正文或本地路径会触发 `invalidContract`，整个 artifact export 被替换为结构化拒绝路径。

### 5.2 Image Vendor failure

图片失败先通过严格 validator，再映射到共享 taxonomy。非法 `kind/stage/attempt`、敏感 request ID 或未知字段不会被纠正成默认值。生产链用三态结果区分：`absent`、`valid`、`rejected`。当 Provider 明确携带非法 `imageFailure` 时，类型化 `VendorImageDiagnosticContractError` 将拒绝事实跨越默认依赖边界，最终持久化 `{ diagnosticRejection: { kind: "contractRejected" } }`；原始诊断与原始异常正文不进入快照。

生成阶段的 timeout/transport/httpError 被标为 `unknown-effect/reconcile-first`，因为请求是否已在 Provider 生效未知；下载阶段失败为 `known-effect/reconcile-first`，因为远端生成结果已观察到，不能盲目重放生成。

### 5.3 日志与 UI

VM、进程异常、Express 全局错误、Agent Socket、模型测试、后台任务、工作流/分镜图片生成、AI 正则分析及 Volcengine 适配器的已知透传路径均改成固定本地分类或稳定用户消息。生成结果、签名材料、AK/SK、Provider task/body 和原始异常不再写日志或返回 UI。

## 6. 版本化负面 fixtures

`data/eval/trace-safe-diagnostics-v1/negative-fixtures.json` 当前冻结 13 类案例：credential、长 Base64、signed URL、raw Provider payload、hidden reasoning、顶层未知字段、嵌套数组、Data URI、常见平台 token、JWT/`sk_`、普通 `token` 键、snake/kebab 绕过、短/metadata/带前缀 Data URI。测试要求每个 fixture 必须 fail-closed，且返回值不得包含源 key 或源 value。

## 7. 本阶段验证

最终实现后执行的阶段测试集合：

```text
node --import tsx --test \
  tests/traceSafeDiagnostics.test.ts \
  tests/goldenEval.test.ts \
  tests/imageGenerationLifecycle.test.ts \
  tests/diagnosticLoggingContracts.test.ts \
  tests/assetImageGeneration.test.ts
```

结果：`81 passed / 0 failed / 81 total`。覆盖纯诊断门、版本化 fixtures、Golden Eval 导出、图片 Vendor 严格提取与真实 generation evidence、已知日志/UI 静态契约。另执行 `yarn lint`（本仓库实际为 `tsc --noEmit`）通过，`git diff --check` 通过；Vendor 源码变更后执行 `yarn vendor2json` 重新生成 `src/lib/vendor.json`。

早一轮更宽的相关集合还验证了 Vendor runtime、Text caller migration 与静态契约，共 `56/56` 通过。数字取决于选择的测试文件集合，不能相加，也不能表述为仓库全量测试。

## 8. 明确延期的最终验收

遵照阶段策略，下列项目没有在 T03 执行：

- `yarn test` 仓库全量测试；
- App production build；
- Web type-check/test/build；
- App/Web bundle 重新比对；
- 真实 Provider 冒烟、真实 Electron 运行与外部日志平台检查。

这些统一留到所有深化阶段完成后的最终验收。T03 当前结论只能是“相关单元/契约测试与静态类型检查通过”。

## 9. 兼容性、限制与回滚

- 为兼容旧测试/调用仍保留 `sanitizeVendorImageFailureDiagnostics`，但注释明确禁止在导出或持久化边界使用；生产持久化已切到 strict validator。
- 固定用户错误会牺牲部分即时排障细节；后续 T04 应把安全结构化诊断写入 Run/Trace，而不是重新开放原始 message。
- 正则检测不是通用 DLP。安全性主要来自 allowlist、schema 与拒绝未知字段；token pattern 是补充防线。
- Evaluation 嵌套 allowlist 与 T02 artifact schema 绑定；新增证据字段必须显式评审和升版，不能临时塞原始对象。
- 回滚应整体回退实现提交 `20db9d1...`，同时回退生成的 `src/lib/vendor.json`。不得只回退 gate 而保留调用点，也不得恢复原始日志。若回滚后继续开发 T04，应先重新建立等价安全边界。

## 10. 验收结论与后续

两位独立只读复核者在最终版本上均确认无 blocker/major；复核只运行定向测试，没有运行全量测试。Issue #59 的代码、ADR、negative fixtures 与本证据报告已经形成可核验链路。

下一阶段 T04 应建立首个 durable、read-only Agent Run，并直接复用本版本 taxonomy 与 audience contract。T04 不应复制新的错误字段体系，也不应让 Trace 存储接触原始 Provider payload。
