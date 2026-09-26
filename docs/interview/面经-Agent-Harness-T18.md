# Agent Harness T18 面经：旧 Socket 与新 Harness 的兼容边界（阶段版）

> 对应开放 Issue #74。App/Web 全量预验收和 Script Harness 的隔离浏览器/重启恢复子集已有记录；Production、审批、旧 Socket 完整回退与最终冻结版本的跨仓验收仍未完成。本文不提供简历 bullet；个人 ownership 按提交记录确认。

## 项目背景

旧 Script/Production Socket 仍服务现有页面，而新 Harness 以持久 HTTP Run/审批快照承载受控路径。两者的状态含义不能混同。T18 先处理旧 Socket 的停止回执、迟到消息与 Production 上下文越权问题，并为后续迁移保留明确边界，而非宣称所有旧入口已经改造。

## 主问与追问

1. 问：旧 Socket 的 stop 为什么会出现 UI 卡住？答：旧 Web 曾在发出 stop 后乐观标为 idle，这会在断线时误报；改为等服务端确认后，App 旧路由却只 abort 控制器，不给 `message:update: stop`，于是页面继续显示 streaming。T18 让共享生命周期在 abort 后发一次终态，Web 不再凭发送动作猜状态。两端定向单测覆盖局部协议，浏览器端到端仍未验收。追问：stop 回执是什么权威？答：只对这条旧聊天消息的本地流有效。
2. 问：为什么 stop 更新只发送一次？答：用户可能连续点击停止，或新 chat 抢占旧 chat 与主动 stop 同时发生。如果每次都发终态，前端可能重复结算并触发不一致回调。`legacyStopLifecycle` 保留当前 message/controller 身份，abort 与终态发送幂等；测试覆盖重复停止及旧消息被抢占。它不构成持久 Run 取消的 exactly-once 保证，更不能证明供应商没有收到请求。追问：重复 stop 应返回什么？答：保留原终态，不产生第二条效果事件。
3. 问：第一条 chat 的 `finally` 晚到，会不会清掉第二条？答：如果共享变量不带身份，旧异步流程结束时会把当前 controller 设空，使第二条无法停止或错误地显示完成。生命周期只允许与当前 message/controller 身份匹配的 `finally` 清理当前对象；开始第二条前结算第一条。定向测试故意反转完成顺序，证明第二条仍在控制。追问：这能防止所有网络乱序吗？答：不能，浏览器与 Socket 传输仍需跨仓验收。
4. 问：服务端发 stop 后，模型或 Vendor 的外部费用就消失了吗？答：不能这样说。旧 Socket 的 stop 是显示层和进程内 abort 边界，外部请求可能已跨网络边界，甚至已经产生费用或迟到产物。要判断受控生成必须看 Owner 审批、Vendor 请求意图账本、unknown 状态、媒体观察和持久 HTTP Run，而不能看聊天气泡状态。旧路径尚未全部迁移，这类风险需要在 T21 兼容/恢复验收中单独记录。追问：超时是否等于没提交？答：不等于。
5. 问：stop 后旧 Agent 迟到调用 `complete` 或 `error` 怎么办？答：`MessageBuilder` 把 stop 当成同一消息的终态，后续 complete、error、状态变更不会再覆盖它；重复 stop 也不会再发一次。定向测试检查正常完成不受影响、停止后的迟到终态被挡住。这个栅栏限制的是服务端未来事件，不可能收回 stop 前已经发送且还在网络途中的分片。追问：为什么不让迟到 complete 改成成功？答：会把用户明确停止的消息伪装成正常完成。
6. 问：内容流为何也需要 stop 栅栏？答：只挡最终 `complete` 仍可能让旧文本、Markdown、思考、搜索、Tool 或推理内容在 stop 后继续追加，让 UI 看起来又在生成。T18 让已有流的迟到 append/merge/complete/error 和 stop 后新建内容都不再发事件；单测覆盖多种流型。它保护本地输出投影，不等于擦除模型已见到的数据或撤销外部 Tool 效果。追问：已发送分片还能拦吗？答：无法由服务端事后收回。
7. 问：JWT 有效为什么仍可能越权读取其他 Project？答：JWT 只证明请求者身份，不证明客户端提交的 Project、Script 与 Memory 隔离键属于此人。旧 Production Socket 原先信任握手及 `updateContext` 的这些字段，攻击者可带自己 token 指向别人的 ID。现在用 token 用户查 Project Owner，再验证 Script 归属和精确隔离键，失败不开放 chat。定向测试覆盖合法与越权组合；其他旧路由仍需独立审计。追问：前端隐藏别人的 ID 就安全吗？答：不安全，后端必须检查。
8. 问：为什么未选剧本可以连接，却不可以聊天？答：页面可能先建立 Socket 再选择 Script，因此若连接阶段强制有剧本会破坏原交互；但没有明确的 Project/Script 上下文就运行模型，可能落到陈旧或默认数据。T18 把“可建立通道”和“可执行 chat”分开，未选剧本只维持连接，合法选择并完成归属校验后才打开 chat 门。测试覆盖空选择与不匹配场景，浏览器实际切换仍待 T21。追问：可以用上次剧本兜底吗？答：不能静默使用旧上下文。
9. 问：上下文切换校验期间为何必须立即关闭 chat 门？答：若等数据库查完才切换，用户点从 A 到 B 后立刻发送 chat，旧 A 上下文仍可能执行新意图；若 B 校验最终失败，期间的调用已经发生。`legacyProductionContextGate` 在切换开始就停止旧流并关门，只有最新一次合法结果才能重开。纯状态门测试模拟校验中 chat 和失败后 chat，尚未覆盖浏览器/网络真实时序。追问：失败后恢复 A 吗？答：不自动恢复，应要求明确合法选择。
10. 问：两个 `updateContext` 异步校验反序返回会怎样？答：假设先选 B 再选 C，C 先校验成功、B 后完成；若没有序号围栏，晚到 B 会覆盖较新的 C。T18 用切换序号只接受最新请求结果，旧结果即使合法也不能重新开放或更改当前上下文；断连时同样关闭门并 abort 消息。定向测试覆盖反序返回。追问：序号能替代 Project 归属校验吗？答：不能，次序与授权是两道独立检查。
11. 问：旧 Socket 与新 HTTP Harness 的“停止”有什么语义差异？答：旧 Socket stop 针对进程内消息控制器与客户端流显示，缺少持久 Run/Step/Attempt 的取消证据；新 Harness 的取消或审批状态由服务器数据库快照表达，前端刷新后应重新读取。把 Socket stop 当成 HTTP Run 的终态会误导用户，尤其在供应商未知结果或子审批仍 pending 时。T18 只修了旧消息协议，不是统一所有 Agent 生命周期。追问：用户界面应信哪边？答：受控效果以 HTTP 持久证据为准。
12. 问：为什么新 Harness 请求失败不能隐式回退旧 Socket？答：两条路径的 Skill 冻结、grant、审批、恢复和状态语义不同。新路径失败时若悄悄把同一意图交给旧 Agent，用户以为仍受新安全边界保护，实际可能执行宽松旧能力。Web 侧监督模式应显式切换，错误应留在该模式显示，用户明确切出才走旧链路。阶段客户端测试验证局部契约；兼容回退的浏览器行为尚未完成最终验收。追问：这会降低可用性吗？答：会增加显式操作，但避免隐性权限降级。
13. 问：为何 T18 还需要 App/Web 同时冻结测试？答：停止协议一端发、一端收，单仓测试可能分别通过却在同一页面交互中不兼容；例如 Web 不再乐观置 idle 后，App 若不发 stop 就会卡住。当前已把 Web T18 bundle 同步进 App，并在本地页面实跑 Script Run 的启动、状态、Trace 与重启恢复子集；它仍未覆盖旧 Socket 停止、Production 审批和全部断线时序。最终要冻结 App、Web、bundle 匹配修订，再重跑完整矩阵。追问：截图够吗？答：不够，还要可复现命令、脱敏请求/状态证据与修订哈希。
14. 问：阶段报告里哪些事实可以说，哪些仍应保留 unknown？答：可以说旧 stop 一次性终态、迟到消息栅栏、Production 上下文 Owner/Script 隔离和切换门有定向测试；App/Web 全量预验收通过，Script 子集在假服务本地浏览器观察了成功、取消意图与中断恢复。不能说旧 Agent 已迁完、真实 Vendor 已取消、全部浏览器矩阵已通过或所有旧 Socket 均安全。付费 Provider 未调用，结果和退款仍属 unknown。追问：为什么不以测试数量当覆盖率？答：样本范围不等于全入口分母。
15. 问：T18 下一步的完成门槛是什么？答：除当前止损外，还需继续收敛旧 Socket 生命周期所有权和前端完成回调，让新 Harness 的 Run、审批、效果在刷新/重连时以持久快照为权威，并证明显式模式切换、回退及旧入口兼容。现有本地浏览器子集只覆盖 Script，只读模型没有写入审批，测试 Project 还绕过正常选择；要补 Production 和审批/拒绝、自动化跨仓流程、冻结两仓修订和最终 bundle 再对照 Issue #74。当前 Draft PR 与局部实测不能替代所有门槛。追问：如何避免迁移期间混用状态？答：保持来源和终态语义显式。
16. 问：模型请求中断时，为何不自动再发一次？答：【S】我在隔离本地浏览器环境启动了一条只读 Script Run，后端已经把请求发到慢假模型服务；这时只看页面断线，无法判断模型是否已经处理或收费。【T】我要验证进程恢复时系统不把未知效果当成安全失败重试。【A】我确认假服务收到一次调用后中断 App，等运行租约过期再重启；随后在页面重新读取服务端列表、详情和 Trace，并用临时 SQLite 核对 Output 数量。【R】该 Run 进入等待人工核对，Trace 标为模型调用中断，Output 为零，假服务没有第二次调用。这只证明这一组本地时序，不能外推真实 Provider 的账单。追问：为何第一次重启后仍显示 running？答：【S】第一次重启发生在原执行租约尚未过期时，页面读到旧运行状态，若立刻重新执行可能与仍存活的旧 worker 争写。【T】我需要解释恢复的时间边界，而不是把短暂 running 误报为恢复失败。【A】我读取持久租约过期时间，确认就绪恢复在未过期时跳过；到期后重启才由恢复流程检查已提交的模型调用意图，归类成待核对。【R】这保留了租约所有权和副作用不明两道约束，代价是恢复不是瞬时完成；多进程竞争仍需单独测。追问：如果模型迟到成功怎么办？答：【S】另一条慢假模型 Run 在运行中接到停止请求，但 HTTP 请求已越过本地边界。【T】我要区分用户停止意图与供应商实际结果。【A】我看到了取消请求的持久 Trace，随后假模型返回成功时页面依照服务端终态显示 succeeded，不伪造 cancelled。【R】这避免把已观察到的输出藏起来，但不表示这种交互文案已经完善，也不证明真实供应商能取消或退款；最终仍要在 UI 和 Provider canary 中验证。

## 源码证据索引

| 主题 | 关键路径与内部符号 | 对应问题 |
| --- | --- | --- |
| 旧 stop 与迟到栅栏 | `src/socket/legacyStopLifecycle.ts`、`src/socket/resTool.ts`、`tests/legacyStopLifecycle.test.ts`、`tests/legacyMessageStopFence.test.ts` | 1–6 |
| Production 归属与切换 | `src/socket/legacyProductionContext.ts`、`legacyProductionContextGate.ts`、对应定向测试 | 7–10 |
| 双路径与待验收 | `docs/reports/agent-harness-compatibility-74-progress.md`、Web T18 Draft PR #9、Issue #74 | 11–15 |
| 本地浏览器与恢复子集 | `docs/reports/agent-harness-final-acceptance-77-prep.md`、`src/agentRuntime/lease.ts`、`src/database/agentRunRecovery.ts`、Web `src/views/scriptAgent/index.vue` | 13–16 |

## 高风险 Claim

不可说“stop = Vendor 撤销”“旧 Socket 全部迁移”“所有入口都安全”“App/Web 完整浏览器矩阵已验收”。本阶段 16 道主问仍是事实型阶段稿，既有题目的口播长度和逐题追问尚未达到 ASu 最终成稿门槛；T21 证据冻结后需统一质检。
