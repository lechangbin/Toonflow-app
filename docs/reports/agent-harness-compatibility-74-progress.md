# Agent Harness T18 · App 兼容边界（阶段进度）

Issue：`lechangbin/Toonflow-app#74`。本 App 分支叠在 T17 Draft PR 上，对应 Web T18 Draft PR #9；当前只是旧 Socket 止损与新 Harness 并行兼容切片，不代表 T18 整体完成。

旧 Script/Production Socket 路由此前收到 `stop` 后只 abort 当前控制器，不发送消息终态；Web 侧现在不再乐观改为 idle，因此会一直显示生成中。共用 `legacyStopLifecycle` 在服务端 abort 同时发送一次 `message:update: stop`，重复 stop 不重复发送；新 chat 抢占旧 chat 时旧消息也得到 stop，旧请求迟到的 finally 不会清空新请求。它仍不是持久 Run 的取消，不能证明旧 Agent 的外部 Tool 没有部分效果，也不能把 Socket 视为生产结果权威。

进一步在旧 `MessageBuilder` 上添加 stop 终态栅栏：停止后的迟到 `complete`、`error` 或状态更新不能覆盖停止回执，重复 stop 也不会再发一次。该栅栏只约束消息状态，不能阻止已在途的内容分片或外部效果；Web 仍须以受控 Run 的 HTTP 快照判断生产结果。

定向验证：`tests/legacyStopLifecycle.test.ts` 2 例覆盖一次停止与迟到 finally；`tests/legacyMessageStopFence.test.ts` 2 例覆盖迟到终态与正常完成；App TypeScript 检查通过。Web 侧对应 `useChat` 定向测试确认发送请求不提前改消息状态。没有跑全量测试、构建、跨仓浏览器流程、真实 Provider 或 bundle 重建。后续 T18 要继续把旧 Socket 生命周期/前端完成回调迁走，完成共用 Run/审批/恢复体验及兼容回退；T21 才做完整验收。
