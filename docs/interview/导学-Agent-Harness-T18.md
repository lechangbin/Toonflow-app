# Agent Harness T18 导学：旧 Socket 与新 Harness 兼容边界（阶段版）

> 对应开放 Issue #74。已做 App/Web 全量预验收及隔离本地环境的 Script 浏览器/进程恢复子集；旧 Socket 生命周期、Production 与审批跨仓流程、最终冻结修订的 T21 验收仍未完成。不写简历或未测收益。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| 异步生命周期与身份围栏 | 旧 `finally` 不能清掉新 chat | `src/socket/legacyStopLifecycle.ts` | 高 |
| 事件投影与持久权威状态 | Socket stop 不等于 Run/效果完成 | `src/socket/resTool.ts`、新 Harness HTTP | 高 |
| 认证与资源授权分离 | JWT 有效不代表 Project/Script 属于用户 | `src/socket/legacyProductionContext.ts` | 高 |
| 切换竞态与失败关闭 | 校验中不能继续按旧 Script chat | `src/socket/legacyProductionContextGate.ts` | 高 |
| 跨仓协议兼容 | App 发 stop 与 Web 等待 stop 必须同版 | T18 Web Draft PR #9、阶段报告 | 中 |
| 租约与重启恢复 | 进程中断后不能把已提交的模型调用自动重放 | `src/agentRuntime/lease.ts`、`src/database/agentRunRecovery.ts`、T21 预验收报告 | 高 |

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

App/Web 的全量测试和构建已有预验收通过记录，Script 浏览器 start/succeeded/Trace/刷新与租约到期后恢复也有一次隔离环境实测；但测试 Project 绕过正常模型选择，页面监督模式不跨刷新自动开启，Production、写入审批、旧 Socket 黄金路径、全部跨仓浏览器矩阵与真实 Provider 均未验收。T18 的 Issue #74 仍开放，不能把这个子集称为完整兼容迁移。
