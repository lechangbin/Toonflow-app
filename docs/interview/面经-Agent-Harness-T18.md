# Agent Harness T18 面经：兼容边界阶段版

1. 问：旧 Socket stop 的问题是什么？答：旧 Web 发出 stop 就本地标记已停止，即使断线也会误报；改为等服务端后，App 旧路由却只 abort 而不回消息终态，界面会挂在 streaming。现在服务端共用生命周期在 abort 后发一次 stop 更新，Web 不再凭发送动作推断完成。两侧定向单测验证局部状态，浏览器端到端尚待 T21。
2. 问：用户快速开始第二条消息，第一条晚完成会不会把第二条清掉？答：生命周期对象持有当前 controller/message；第二条开始时先 abort 并结算第一条，第一条的 finally 只有身份匹配时才能清当前对象。单测故意让旧 finally 晚到，第二条仍可独立停止。
3. 问：服务端发了 stop，就能证明没有视频/图片费用吗？答：不能。这个 Socket 更新只结算聊天流显示；供应商调用可能已经跨过网络边界。受控生成必须看独立 Owner 审批、请求意图账本、unknown/迟到媒体证据与 HTTP Run 状态。旧 Socket 仍是待迁移兼容路径。
4. 问：T18 已完成了吗？答：没有。当前只完成停止回执止损与 Web 的近期 Run/证据抽屉等局部接缝；旧 Socket 生命周期所有权、跨入口审批和浏览器重连/回退验收未完成。不能把局部单测说成完整兼容迁移。
5. 问：收到 stop 后旧 Agent 迟到调用 complete 或追加内容怎么办？答：`MessageBuilder` 把 stop 当作本地终态，同一消息后续的 `complete`、`error`、状态更新以及各类内容流的迟到追加都不再发送；停止后新建内容也不发事件。定向单测覆盖已有文本、思考、搜索、Tool 和推理流。但此前已经发出的网络分片仍可能在途，这个显示层栅栏也不代表 Vendor 效果已撤销。
6. 问：为什么 Production Socket 有有效 JWT 仍需校验上下文？答：旧路由原先信任握手与 `updateContext` 的 Project/Script/隔离键，持有自己 token 的用户可以试探其他项目。现在用 token 内用户 ID 查 Project 归属，再查 Script 属于 Project，并要求隔离键与规范格式精确一致；未选剧本只用于连接，不能启动 chat。异步切换有序号栅栏，避免较早请求迟到后覆盖新上下文。
7. 问：切换上下文校验期间用户立刻发 chat，会不会仍按旧剧本执行？答：切换一开始先停止旧流并关闭 chat 门；校验期间和校验失败后都不启动新 chat，只有最新一次合法切换才重新开放。纯状态门单测覆盖失败、重试、反序返回和断连；尚未做跨仓浏览器时序验收。
8. 问：浏览器点击停止后服务端返回 409，为什么旧版最后没有停止意图？答：Run 从 queued 变 running 时版本递增，按钮可能持有旧版本。旧 Web 的 Axios 拦截器只抛响应体，丢掉 409 状态，Harness 无法识别可重读冲突，只刷新界面；8 秒假模型最终成功且 Trace 无 `run.cancellation-requested`。修复保留状态，仅明确 409 才核对同 Project/Run/role/scope 并复用命令 ID 最多重试一次；未知网络结果不重试。新浏览器用例可观察停止意图，但迟到成功仍可能发生，不是供应商取消保证。
9. 问：批准/拒绝面板的本地浏览器用例证明了什么？答：Owner 接口在临时 Project 建两条单字段候选，页面查看批准候选全文后确认批准，另一条直接拒绝；服务端再读显示只改了获批的 `storySkeleton`。它证明这条 UI 和写入边界，不能证明提案一定来自模型 Tool、也不能替代跨入口兼容或 Production 验收。
10. 问：如何证明模型提案没有绕过 Owner 审批写入？答：隔离夹具发布请求相应 Tool/Capability 的 Skill，Owner 显式打开 Project grant；假模型产生 `propose_script_workspace_write`，父 Run Trace 留 `tool.proposal.created`，卡片指向父 Run。批准前再读 `storySkeleton` 未变；查看全文并批准审批 Run 后才出现候选正文。该正路径使用本地假 Model，不覆盖恶意输入、权限拒绝、真实 Provider 或其他入口。
