# Agent Harness T18 导学：旧 Socket 停止回执与 HTTP 权威状态

> 仅记录当前兼容切片；T18/T21 尚未验收，不写简历结论。

阅读 `src/socket/legacyStopLifecycle.ts`，再对照 `src/socket/routes/scriptAgent.ts` 和 `productionAgent.ts` 的接入。旧 Web `useChat` 发送 stop 后不再自称已经结束；服务器在 abort 后送一次 `message:update: stop`，新 chat 抢占旧 chat 也有终态。再看 `src/socket/resTool.ts` 的 stop 终态栅栏：旧 Agent 即使迟到调用 `complete` 或已有内容流的 `append`，也不能再向该消息发送更新。两个版本的路径仍并行：受控 Harness 的 Run/审批/效果以 HTTP 持久快照为准，旧 Socket 回执只描述旧消息的本地流状态。

自测：说明为什么“发出 stop”不等于“服务端确认 stop”，为什么服务端即使回复 stop 也不证明供应商请求已撤销；给出旧 chat 的 finally 在新 chat 启动后才到达的时间线；指出目前无浏览器联调和真实进程恢复验收。

补充追问：停止后服务器不再发内容事件，为什么仍不能保证浏览器绝不收到先前已经发出的分片？为何这种内容投影栅栏不等于 Provider 请求取消或费用回滚？

再阅读 `src/socket/legacyProductionContext.ts`。解释为什么 JWT 签名有效并不等于客户端传入的 `projectId`、`scriptId` 归属该用户；握手和 `updateContext` 都必须校验 Project、Script 与隔离键。前端可能先连接后选择剧本，因此允许未选剧本连接，但此时不运行 chat。思考两个并发上下文校验反序返回时为何需要序号保护。

接着看 `legacyProductionContextGate`：切换请求一开始就暂停 chat，而不是等数据库校验结束。失败后不恢复旧上下文的 chat 权限；成功且是最新请求才恢复。画出“切换到 B → 校验未返回 → chat 到达”的时间线，说明没有门时为何仍会用 A 的 Script 执行。
