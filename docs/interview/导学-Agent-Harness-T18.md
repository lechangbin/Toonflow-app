# Agent Harness T18 导学：旧 Socket 停止回执与 HTTP 权威状态

> 仅记录当前兼容切片；T18/T21 尚未验收，不写简历结论。

阅读 `src/socket/legacyStopLifecycle.ts`，再对照 `src/socket/routes/scriptAgent.ts` 和 `productionAgent.ts` 的接入。旧 Web `useChat` 发送 stop 后不再自称已经结束；服务器在 abort 后送一次 `message:update: stop`，新 chat 抢占旧 chat 也有终态。再看 `src/socket/resTool.ts` 的 stop 终态栅栏：旧 Agent 即使迟到调用 `complete`，也不能把已停止的消息改回完成。两个版本的路径仍并行：受控 Harness 的 Run/审批/效果以 HTTP 持久快照为准，旧 Socket 回执只描述旧消息的本地流状态。

自测：说明为什么“发出 stop”不等于“服务端确认 stop”，为什么服务端即使回复 stop 也不证明供应商请求已撤销；给出旧 chat 的 finally 在新 chat 启动后才到达的时间线；指出目前无浏览器联调和真实进程恢复验收。
