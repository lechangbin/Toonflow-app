# Agent Harness T18 导学：旧 Socket 与新 Harness 兼容边界（阶段版）

> 对应开放 Issue #74。Script 与 Production 的隔离本地假模型浏览器正路径、Script 审批以及受控进程恢复已有阶段证据；旧 Socket 迁移、跨入口完整矩阵、真实 Provider 与最终冻结修订的 T21 验收仍未完成。不写简历或未测收益。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| 异步生命周期与身份围栏 | 旧 `finally` 不能清掉新 chat | `src/socket/legacyStopLifecycle.ts` | 高 |
| 事件投影与持久权威状态 | Socket stop 不等于 Run/效果完成 | `src/socket/resTool.ts`、新 Harness HTTP | 高 |
| 认证与资源授权分离 | JWT 有效不代表 Project/Script 属于用户 | `src/socket/legacyProductionContext.ts` | 高 |
| 切换竞态与失败关闭 | 校验中不能继续按旧 Script chat | `src/socket/legacyProductionContextGate.ts` | 高 |
| 跨仓协议兼容 | App 发 stop 与 Web 等待 stop 必须同版 | T18 Web Draft PR #9、阶段报告 | 中 |
| 租约与重启恢复 | 进程中断后不能把已提交的模型调用自动重放 | `src/agentRuntime/lease.ts`、`src/database/agentRunRecovery.ts`、T21 预验收报告 | 高 |
自测：说明为什么“发出 stop”不等于“服务端确认 stop”，为什么服务端即使回复 stop 也不证明供应商请求已撤销；给出旧 chat 的 finally 在新 chat 启动后才到达的时间线；区分现有本地假模型浏览器/进程恢复子集与尚缺的完整兼容验收。

## 重点亮点与阅读顺序

| 亮点 | 核心问题 | 先看文件 | 顺序 |
| --- | --- | --- | --- |
| stop 回执闭环 | 发送动作能否代表服务器接受 | `legacyStopLifecycle.ts`、`legacyStopLifecycle.test.ts` | 1 |
| 迟到内容栅栏 | 停止后 complete/append 是否复活 UI | `resTool.ts`、`legacyMessageStopFence.test.ts` | 2 |
| Project/Script 归属 | 客户端隔离键能否伪造 | `legacyProductionContext.ts`、对应测试 | 3 |
| 切换先关门 | B 尚未验证时能否按 A 执行 | `legacyProductionContextGate.ts`、对应测试 | 4 |
| 新旧状态分工 | 哪条链路是受控效果权威 | `docs/reports/agent-harness-compatibility-74-progress.md` | 5 |
| 浏览器实测与证据边界 | 本地假 Model 下的启动、停止、刷新与重启分别证明什么 | `docs/reports/agent-harness-final-acceptance-77-prep.md` | 6 |

## 必备知识点

- [ ] 画出 Web 发 stop、App abort、一次 stop 回执、页面终态的时间线。
- [ ] 解释旧消息的 finally、complete、内容 append 晚到时分别由什么挡住。
- [ ] 说明已发网络分片与已跨网络的 Vendor 效果为何无法被本地栅栏撤销。
- [ ] 区分 JWT actor、Project Owner、Script 归属和规范 Memory 隔离键四项。
- [ ] 画出选 B → 校验 pending → chat 到达 → B 校验失败的失败关闭路径。
- [ ] 解释旧 Socket 与 HTTP Run/审批不能隐式回退或混用终态。
- [ ] 解释一次慢模型实测中 `cancellation-requested → succeeded` 为什么不等同于停止失效，也不能说供应商已取消。
- [ ] 解释模型调用已送达后杀进程、租约到期、重启为什么进入 `waiting` 而不是重放或直接失败。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 阶段背景 | App/Web 并行路径与缺口 | `docs/reports/agent-harness-compatibility-74-progress.md` | 15 分钟 | T18 已做和未做哪些 |
| 停止生命周期 | 幂等、身份、抢占 | `src/socket/legacyStopLifecycle.ts`、`tests/legacyStopLifecycle.test.ts` | 35 分钟 | 为什么只发一次 stop |
| 内容栅栏 | 终态与迟到事件 | `src/socket/resTool.ts`、`tests/legacyMessageStopFence.test.ts` | 35 分钟 | 为什么 stop 后不能继续追加 |
| 上下文认证 | Project/Script/隔离键 | `src/socket/legacyProductionContext.ts`、对应测试 | 40 分钟 | JWT 为什么不够 |
| 切换门 | 异步反序、失败与断连 | `src/socket/legacyProductionContextGate.ts`、对应测试 | 35 分钟 | 如何避免旧上下文误执行 |
| 前端组合 | 显式模式与回执 | Web T18 Draft PR #9、T21 browser 验收计划 | 25 分钟 | 哪些还需真实浏览器 |
| 跨仓子集实测 | 本地假 Model、HTTP Run、Trace、租约恢复 | `docs/reports/agent-harness-final-acceptance-77-prep.md`、Web `src/views/scriptAgent/index.vue`、`src/components/agentTraceEvidenceDrawer.vue` | 35 分钟 | 哪些行为已在真实页面观察，哪些仍未覆盖 |

自学提醒：若 Socket 事件或异步竞态不清，请继续追问 AI；本导学给阅读路径与自测题，不替代浏览器验证。

## 项目技术定位

这是双路径迁移期的兼容与安全止损：让旧聊天流的终态更可信，同时让旧 Production 上下文不能仅凭客户端 ID 越权。它不把旧 Socket 变成受控 Run，也不为旧 Vendor 效果提供持久账本。

## 核心原理解析

1. 问题：Web 不再乐观置 idle 后，App 仅 abort 会让流卡住。机制：服务端共用生命周期在 abort 后发一次 stop 事件，新 chat 抢占时也结算旧消息。
2. 问题：旧回调晚到会覆盖新状态。机制：当前 controller/message 以身份比对清理，MessageBuilder 在 stop 后拒绝更多终态或内容事件。
3. 问题：JWT 有效但 Project/Script 由客户端伪造。机制：从 token 得 actor，查 Owner、Script 所属和精确隔离键；未选 Script 可连接不可 chat。
4. 问题：切换校验异步造成旧上下文窗口。机制：一开始就停止旧流并关闭 chat，只有最新合法请求重开，失败和断连保持关闭。
5. 问题：Socket 状态被误当效果状态。机制：旧 stop 只说明本地消息流，受控 Run/审批/外部请求仍以 HTTP 持久快照及账本为准。
6. 问题：刷新和进程中断可能让页面本地状态与模型真实效果分离。机制：监督模式进入后从 HTTP 读取近期 Run 和 Trace；模型请求已发出时中断 App，只有租约过期后的恢复流程将 Run 停在需人工核对的 waiting，而不是静默重发。本地假服务实测一次请求、零 Output；这不证明真实供应商的结果或退款。

## 关键取舍与待测

| 选择 | 代价 | 当前证据 | 后续门槛 |
| --- | --- | --- | --- |
| 新旧路径并行 | 双协议与状态维护 | App/Web 定向测试 | 跨仓浏览器与回退验收 |
| stop 后不发迟到事件 | 已发送分片无法追回 | MessageBuilder 定向测试 | 真实网络时序验证 |
| 切换先关门 | 校验期间暂不可 chat | Gate 状态测试 | 浏览器切换与断线验证 |
| 客户端 ID 不可信 | 每次需查归属 | Production 上下文定向测试 | 全旧入口审计 |

App/Web 曾有全量预验收记录，之后的新组合尚未做最终全量验收。Script 与 Production 的本地假模型浏览器子集已覆盖启动、读源、刷新、审批正路径及受控中断恢复；但测试 Project 绕过正常模型选择，Production 审批/拒绝、旧 Socket 黄金路径、全部跨入口浏览器矩阵和真实 Provider 仍未验收。T18 Issue #74 保持开放，不能把子集称为完整兼容迁移。

补充 Script 浏览器实践：沿 `tests/fixtures/prepareHarnessBrowserFixture.ts`、`fakeOpenAITextServer.mjs` 和三个 `checkScript*Browser.js` 脚本分别复现停止版本冲突、Owner 直接提案的批准/拒绝，以及 Skill/Project grant 允许后的模型 Tool 提案。queued→running 可让按钮持有旧版本；Web 丢掉 409 会使停止意图消失；修复仅对明确冲突重读同一 Run 并复用命令 ID 重试。Trace 中 `run.cancellation-requested` 后仍可能 `succeeded`，不等于供应商撤销。模型提案的父 Run 有 `tool.proposal.created`，但 `storySkeleton` 直到 Owner 看全文并批准才改变。Script 夹具仍只覆盖子集；Production 正路径另见下文，正常 Project 模型配置、跨入口、旧 Socket 退场和完整恢复矩阵未验收。

对比两条审批来源：Owner 直接调用提案接口适合验证查看全文、批准与拒绝 UI；模型 Tool 提案还需要已发布 Skill 请求 Tool/Capability、Owner 开启 Project grant、父 Run 产生 `tool.proposal.created`，提案本身不写入。观察 Model 提案批准前后 `storySkeleton` 的服务端值。上述 Script 夹具只覆盖局部正路径；Production 的独立只读正路径见下段，跨入口审批、重连/恢复及旧 Socket 退场仍是开放门槛。

Production 继续读 `src/agentRuntime/index.ts` 的 Context 预算参数和 ADR-0019。完整 Production Tool/权限合同必须作为强制 Context 保留；固定 8192 上限让真实组合在 Provider 调用前失败，不能通过删掉安全合同来“修好”。在隔离数据库和假 Model 下运行 `checkProductionHarnessBrowser.js`，看 Production 专属 32768 上限如何仍受 Model 容量、输出/协议预留及安全余量约束，并证明成功 Run 的 HTTP 状态、因果抽屉和刷新恢复。脚本现在依次跑普通只读与 `get_production_workspace_text` Tool 读源，观察后一条 `tool.succeeded` 和有哈希的 ToolReceipt；它不证明越权拒绝、审批或 Vendor 生成。

再对照 `checkProductionReadDeniedBrowser.js` 与 `inspectProductionReadDenied.ts`：从 Owner 页面撤销 Project 工作区读取授权后，即使假模型仍提出同一个 Tool 调用，服务端也只留下 `allowed=false` 的权限决策，缺失层为 Project capability，既没有成功 ToolReceipt，也没有实际读取。模型回复“读取被拒绝”后 Run 仍可 succeeded；这表示模型对拒绝作了终结回复，不是 Tool 成功。首次浏览器试验发现抽屉没有拒绝事件；随后在 `src/controlledTools/index.ts` 的决策事务内为新拒绝追加安全 `tool.denied` Trace，第二份全新隔离浏览器已看到该事件，重复操作不重复追加。Trace 仍不携带决策行 ID 或操作 ID，逐操作审计要结合权限决策账本，不能只看抽屉。

再看脚本的第三条延迟 Run：在 queued/running 阶段刷新页面，之后仍从 HTTP 恢复同一 ID 并看到终态。假模型只根据最后一条 user 指令识别测试触发词；如果扫描所有历史消息，上条读源标记会污染慢调用，让它错误地产生 Tool 调用。把“刷新期间服务端仍在运行”与“进程崩溃后的恢复”分开回答。

旧 Production 前端另读 `rightChatBox/index.vue` 的 `watch(connected)` 与 `useChat.ts` 的 `message:update`：传输层重连不是消息完成证据，不能因此本地写入 idle。现在 watcher 仅刷新审批；消息终态由服务端更新驱动。用 `productionLegacyReconnectBoundary.test.ts` 解释这个静态回归门，并说明仍缺真实 Socket 断线期间终态丢失的浏览器恢复矩阵；旧聊天可能保持生成中，受控 Harness 的 HTTP Run 才是可查询的权威状态。

进程恢复再读 ADR-0012/0013 与 `src/database/agentRunRecovery.ts`：本地假 Model 延迟时必须确认最新 checkpoint 是 `model-call-intent`、Run 仍 running，才终止专用临时服务。测试为快速走到租约接管分支，仅把临时 Run 的 lease 设为过期；重启后检查 waiting、`interrupted-model-call`、无 Output、无新增假模型调用及浏览器 HTTP 投影。别把这个加速测试描述成真实 60 秒时间测试，也别把无重发等同于供应商端无效果。
