# Agent Harness T18 导学：旧 Socket 停止回执与 HTTP 权威状态

> 仅记录当前兼容切片；T18/T21 尚未验收，不写简历结论。

阅读 `src/socket/legacyStopLifecycle.ts`，再对照 `src/socket/routes/scriptAgent.ts` 和 `productionAgent.ts` 的接入。旧 Web `useChat` 发送 stop 后不再自称已经结束；服务器在 abort 后送一次 `message:update: stop`，新 chat 抢占旧 chat 也有终态。再看 `src/socket/resTool.ts` 的 stop 终态栅栏：旧 Agent 即使迟到调用 `complete` 或已有内容流的 `append`，也不能再向该消息发送更新。两个版本的路径仍并行：受控 Harness 的 Run/审批/效果以 HTTP 持久快照为准，旧 Socket 回执只描述旧消息的本地流状态。

自测：说明为什么“发出 stop”不等于“服务端确认 stop”，为什么服务端即使回复 stop 也不证明供应商请求已撤销；给出旧 chat 的 finally 在新 chat 启动后才到达的时间线；指出目前无浏览器联调和真实进程恢复验收。

补充追问：停止后服务器不再发内容事件，为什么仍不能保证浏览器绝不收到先前已经发出的分片？为何这种内容投影栅栏不等于 Provider 请求取消或费用回滚？

再阅读 `src/socket/legacyProductionContext.ts`。解释为什么 JWT 签名有效并不等于客户端传入的 `projectId`、`scriptId` 归属该用户；握手和 `updateContext` 都必须校验 Project、Script 与隔离键。前端可能先连接后选择剧本，因此允许未选剧本连接，但此时不运行 chat。思考两个并发上下文校验反序返回时为何需要序号保护。

接着看 `legacyProductionContextGate`：切换请求一开始就暂停 chat，而不是等数据库校验结束。失败后不恢复旧上下文的 chat 权限；成功且是最新请求才恢复。画出“切换到 B → 校验未返回 → chat 到达”的时间线，说明没有门时为何仍会用 A 的 Script 执行。

浏览器实践现在可沿 `tests/fixtures/prepareHarnessBrowserFixture.ts` → `fakeOpenAITextServer.mjs` → 三个 `checkScript*Browser.js` 脚本做隔离联调。先解释 queued→running 为什么会让停止按钮拿到旧版本，以及 Web 错误拦截器丢掉 409 时为何停止意图消失；再看重试只在明确冲突且同一个 Run 版本前进时发生。慢假模型的 Run 可以在 `run.cancellation-requested` 后仍 `succeeded`，不能把意图写入说成供应商已撤销。

对比两条审批来源：Owner 直接调用提案接口适合验证查看全文、批准与拒绝 UI；模型 Tool 提案还需要已发布 Skill 请求 Tool/Capability、Owner 开启 Project grant、父 Run 产生 `tool.proposal.created`，提案本身不写入。观察 Model 提案批准前后 `storySkeleton` 的服务端值。上述 Script 夹具只覆盖局部正路径；Production 的独立只读正路径见下段，跨入口审批、重连/恢复及旧 Socket 退场仍是开放门槛。

Production 继续读 `src/agentRuntime/index.ts` 的 Context 预算参数和 ADR-0019。完整 Production Tool/权限合同必须作为强制 Context 保留；固定 8192 上限让真实组合在 Provider 调用前失败，不能通过删掉安全合同来“修好”。在隔离数据库和假 Model 下运行 `checkProductionHarnessBrowser.js`，看 Production 专属 32768 上限如何仍受 Model 容量、输出/协议预留及安全余量约束，并证明成功 Run 的 HTTP 状态、因果抽屉和刷新恢复。脚本现在依次跑普通只读与 `get_production_workspace_text` Tool 读源，观察后一条 `tool.succeeded` 和有哈希的 ToolReceipt；它不证明越权拒绝、审批或 Vendor 生成。

再看脚本的第三条延迟 Run：在 queued/running 阶段刷新页面，之后仍从 HTTP 恢复同一 ID 并看到终态。假模型只根据最后一条 user 指令识别测试触发词；如果扫描所有历史消息，上条读源标记会污染慢调用，让它错误地产生 Tool 调用。把“刷新期间服务端仍在运行”与“进程崩溃后的恢复”分开回答。

进程恢复再读 ADR-0012/0013 与 `src/database/agentRunRecovery.ts`：本地假 Model 延迟时必须确认最新 checkpoint 是 `model-call-intent`、Run 仍 running，才终止专用临时服务。测试为快速走到租约接管分支，仅把临时 Run 的 lease 设为过期；重启后检查 waiting、`interrupted-model-call`、无 Output、无新增假模型调用及浏览器 HTTP 投影。别把这个加速测试描述成真实 60 秒时间测试，也别把无重发等同于供应商端无效果。
