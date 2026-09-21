# 导学：Agent Harness T04 持久化只读 Agent Run

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| 幂等键与请求指纹 | 区分安全重试和键误复用 | Agent Run 启动事务 | 高频 |
| 状态机与正交状态 | 避免把执行状态和人工注意力混成枚举爆炸 | Run `status` 与 `attentionReason` | 高频 |
| 事务边界 | 网络调用不能被数据库原子性覆盖 | intent、claim、target evidence、terminal 分段提交 | 高频 |
| 至少一次与不确定结果 | 理解崩溃窗口为什么不能盲目重试 | queued/running Run 的分级重启恢复 | 高频 |
| CQRS 式读模型 | 区分持久化事实与 UI 投影 | `inspect` 与聊天消息投影 | 中高频 |
| 安全诊断 | 错误可观测但不泄漏凭据、原始响应和隐式推理 | Trace-safe diagnostic | 中高频 |
| 失败分类学 | 不同失败边界决定确定性与恢复建议 | Context / Vendor / Artifact | 中高频 |
| 乐观并发控制 | 防止多个领取者重复推进同一 Run | status + version 条件更新 | 中频 |
| 契约版本化 | 让客户端、存储和 UI 演进可识别 | start/output/UI schema version | 高频 |
| 持久化内容安全 | 防止凭据、签名 URL 与嵌入负载进入长期存储 | input/output persistable-text gate | 中高频 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 持久化执行状态机 | 断线与刷新后仍能回答真实状态 | durable execution、state machine | `src/agentRuntime/index.ts` | 1 |
| 幂等启动 | 防止客户端重试重复调用模型 | idempotency、fingerprint、unique constraint | `tests/agentRunRuntime.test.ts`、`src/agentRuntime/index.ts` | 2 |
| 外部调用事务切分 | 正面处理数据库与 Provider 无法共同提交 | transaction boundary、unknown effect | `docs/adr/0011-persist-read-only-agent-runs-with-orthogonal-attention.md` | 3 |
| 重启停放与人工注意力 | 不确定调用不自动重放 | recovery、reconciliation、attention | `src/database/agentRunRecovery.ts` | 4 |
| HTTP 事实源与 UI 投影 | 前端渲染不反向定义运行状态 | projection、pure read、refresh reconstruction | `src/routes/agentRuns/*.ts` | 5 |
| 安全可观测性 | 保留故障证据但控制敏感信息扩散 | allowlist、diagnostic projection | `src/diagnostics/traceSafeDiagnostics.ts` | 6 |
| SQLite 并发幂等 | 双连接竞争下仍只产生一个权威 Run | on-conflict、busy retry、authoritative read | `src/agentRuntime/index.ts`、`tests/agentRunRuntime.test.ts` | 7 |

## 3. 必备知识点

- [ ] 能画出 `queued -> running -> succeeded|failed`、`queued -> waiting` 和 `running -> waiting`。
- [ ] 能解释为什么 `needs-attention` 是显示状态，不是持久化生命周期。
- [ ] 能说明幂等唯一键与请求指纹分别防什么问题。
- [ ] 能逐段解释启动、领取、终态三个事务。
- [ ] 能指出模型调用发生在事务外，以及由此产生的不确定窗口。
- [ ] 能说明恢复为什么停放而不是重放。
- [ ] 能解释 inspect 为什么必须是纯读且带 Project 作用域。
- [ ] 能区分业务输出、生命周期 Trace、应用日志与隐藏推理。
- [ ] 能说明输入/输出门禁为何拒绝 credential、签名 URL、base64，却允许普通 URL。
- [ ] 能说明 password、apiKey、cookie、token 等敏感赋值为什么也必须拒绝。
- [ ] 能区分 Context、Vendor、Artifact/persistence、Artifact/redaction 四条失败路径。
- [ ] 能解释 inspect 为什么要重新验证持久化诊断而不能直接 cast。
- [ ] 能解释恢复为何要求恰好一个 active Step，异常时为何整笔回滚。
- [ ] 能解释 resolved target 为何要在外部调用前保存。
- [ ] 能准确陈述本阶段未完成的队列、取消、Web 接线和最终验收。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域语言 | execution model | `CONTEXT.md` | 10 分钟 | Run、Step、Trace 分别是什么 |
| 架构决策 | crash consistency | `docs/adr/0011-persist-read-only-agent-runs-with-orthogonal-attention.md` | 10 分钟 | 为什么 attention 正交、为什么不自动重放 |
| Runtime 主链 | deep module、transaction | `src/agentRuntime/index.ts` | 35 分钟 | 请求如何从 start 到 terminal |
| 状态转换 | state machine、optimistic concurrency | `src/agentRuntime/lifecycle.ts` | 15 分钟 | 领域转换校验与 SQL 前态约束如何分工 |
| 数据模型 | uniqueness、audit trail | `src/lib/initDB.ts` | 20 分钟 | 四张表如何分责与约束 |
| 启动恢复 | readiness、reconciliation | `src/database/readiness.ts`、`src/database/agentRunRecovery.ts` | 20 分钟 | 进程崩溃后如何收敛 |
| 诊断校验与分类 | fail-closed、failure taxonomy | `src/diagnostics/traceSafeDiagnostics.ts`、`src/agentRuntime/index.ts` | 20 分钟 | 错误如何分类、持久化诊断为何不可信任 |
| HTTP/UI | boundary adapter、projection | `src/routes/agentRuns/start.ts`、`src/routes/agentRuns/inspect.ts` | 15 分钟 | 刷新为何能重建同一状态 |
| Vendor 边界 | dependency inversion、resolved target | `src/vendor/contract.ts`、`src/vendor/index.ts` | 15 分钟 | 如何记录模型身份而不泄漏凭据 |
| 验证方法 | focused test、failure injection | `tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts`、`tests/agentRunRoutes.test.ts` | 30 分钟 | 如何证明幂等、原子性和纯读 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。阅读时优先沿“HTTP start → Runtime start → scheduler execute → Vendor → terminal transaction → HTTP inspect → UI projection”主链走一遍，再回看失败与恢复分支。

## 6. 项目技术定位

这是以 **Agent Harness 为主、Agent 应用开发为第二重点、AI 应用后端为补充** 的交叉项目：核心不是训练算法，而是把一次模型调用纳入可持久化、可检查、可恢复、可安全展示的应用执行协议。

## 7. 核心原理解析

### 7.1 重试可能重复执行 -> 幂等键加请求指纹 -> 返回同一 Run 或明确冲突

客户端超时并不表示服务端没有接受请求。项目以业务幂等键定位既有执行，再用完整输入指纹验证两次意图是否相同；数据库唯一约束处理并发竞态，应用层返回既有快照。这避免把“重试”误当成“新执行”，也避免相同键承载不同命令。

### 7.2 数据库无法包住模型调用 -> 分段短事务 -> 保留可恢复的本地事实

若在事务中等待模型，锁会随网络延迟长期占用；若假设数据库与 Provider 原子提交，则崩溃后会得到错误结论。项目先提交意图，再短事务领取，然后在模型返回后提交终态。中间崩溃被明确表示为 unknown effect，而不是伪装成未执行。

逻辑目标解析后、外部调用前，Runtime 还会先持久化安全的 resolved target；因此调用失败时仍能审计本次实际目标。每次状态写入不仅经过集中 transition map 校验，还携带旧状态、version 与受影响行数约束，避免基于过期读取推进。

### 7.3 等待与人工介入语义混杂 -> 正交建模 -> 生命周期稳定、UI 可表达

`waiting` 回答执行是否正在前进，`attentionReason` 回答是否需要人处理。UI 可把两者投影为 `needs-attention`，而存储仍保留可组合的事实。未来出现无需人工介入的限流等待时，不必继续扩充互斥枚举。

### 7.4 Socket 断线导致状态丢失 -> HTTP 纯读快照 -> 刷新可重建

Run、Step、Output 和 Trace 都存储在数据库中，inspect 不依赖进程内队列或前端缓存。聊天消息由快照确定性投影，稳定 ID 与版本支持界面替换旧视图。传输层可以通知“去拉取”，但不能宣布新的事实。

### 7.5 错误对象可能携带秘密 -> 诊断投影 -> 可观察而不复制原始异常

错误先按真实边界分类：Project/Novel 查询抛错属于 Context/executionFailed/safe-retry，只有确认 Project 不存在才是 Context/contextMissing/never；目标解析与模型调用属于 Vendor，证据/终态写入属于 Artifact persistence，输出门禁属于 Artifact redaction。inspect 读取时仍会用 schema 重新验证，损坏诊断 fail closed。这样日志与审计能区分阶段、确定性和重试建议，同时避免把 Provider 原始响应扩散到响应。

### 7.6 输入或输出可能自带秘密 -> 双向持久化门禁 -> 明确拒绝而非静默落库

用户正文和模型最终文本在持久化前使用同一门禁，拒绝 credential 与 password、apiKey、cookie、token 等敏感赋值，拒绝签名 URL 和 base64 负载，同时允许普通 URL 保持正常引用能力。输出不合规时不截断伪装成成功，而是进入 Artifact/redaction 失败链路；该机制是安全基线，不替代后续数据保留、访问审计与完整 DLP。

### 7.7 恢复数据可能已损坏 -> 强不变量检查 -> 事务整体回滚

readiness 对每个 queued/running Run 要求恰好一个匹配前态的 active Step，Run 与 Step 更新还必须各影响一行。若出现零个或多个 active Step、前态漂移或 version 冲突，恢复事务回滚，避免挑一条继续后掩盖数据损坏。queued 中断诊断归为 Decision/known-no-effect，running 未知模型效果归为 Vendor/unknown-effect。

## 8. 关键设计决策

| 决策 | 备选 | 取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| HTTP 快照作为事实源 | Socket 内存状态 | 牺牲纯推送的即时性，换取刷新与重启一致性 | 轮询频率和负载待设计 | 重复 inspect 快照一致且无副作用 |
| 分段短提交 | 单个长事务；完全无事务 | 接受外部调用不确定窗口，避免长锁并保证关键本地边界原子 | 崩溃后需人工 reconcile | 注入终态 Trace 失败，确认整体回滚 |
| waiting + attention 正交 | `needs-attention` 持久化枚举 | 模型更可组合，前端需做一层投影 | 消费方可能错误只看 status | 投影契约测试 |
| 中断不自动重放 | 启动即 retry | 避免重复计费和副作用，恢复速度较慢 | Run 可能长期等待 | readiness 恢复幂等测试 |
| 四类持久化记录 | 单表 JSON；完整事件溯源 | 查询清晰且足够小，尚未形成完整因果图 | 后续迁移成本 | schema/unique contract 测试 |
| 固定只读范围 | 首版即开放工具 | 可证明边界，能力有限 | 用户可能误以为能修改项目 | 固定 scope 校验与系统提示 |
| on-conflict 后重读权威记录 | 进程内锁；只捕获唯一异常 | 支持双连接竞争与请求等价校验 | 持续 busy 不会无限重试 | 双连接文件数据库测试 |
| queued/running 分级恢复 | 统一标 failed 或自动重放 | 保留 known-no-effect 与 unknown-effect 差异 | 当前都缺少恢复命令 | 两类重启恢复与幂等测试 |
| 损坏诊断读取 fail closed | 信任数据库 JSON 并强转 | 防止旧数据或篡改字段绕过安全投影 | 损坏 Run 将不可正常 inspect | 注入未知字段诊断并断言拒绝 |
| 恢复要求一个 active Step | 选择第一条；尽力更新 | 暴露聚合损坏且保证无部分恢复 | readiness 会明确失败 | 多 active Step 注入与回滚测试 |

## 9. 量化与验证（含待测，建议）

- 待测：100、1,000 个并发相同幂等请求下，实际 Run 数、模型调用数和冲突率；验收目标应先由容量需求定义。
- 待测：不同 Run 数量与 Trace 数量下 inspect 的 P50/P95/P99 延迟、SQLite 锁等待时间与查询计划。
- 待测：在 claim 后、Provider 返回前、终态事务中三个位置强制杀进程，核对恢复状态、Trace 序列和重复调用风险。
- 待测：真实 Provider 超时、429、5xx 与网络半开时的诊断分类准确性；本阶段只验证了受控错误投影。
- 待测：App/Web 联调中的刷新重建、重复提交和旧版本消息覆盖；本阶段未执行 Web 端验收。
- 最终验收建议：所有路线阶段完成后统一运行全量测试、完整构建、打包产物核验及 App/Web 端到端场景，避免把阶段单测结论表述成全系统通过。

阶段内已有证据为核心定向集合 53/53、readiness/router 集合 12/12（其中 4 个 schema 测试重复，不能相加当作 65 个独立测试），以及 `yarn lint`、`git diff --check` 通过；没有运行仓库全量测试或完整构建。
