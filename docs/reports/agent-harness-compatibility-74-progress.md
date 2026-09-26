# Agent Harness T18 · App 兼容边界（阶段进度）

Issue：`lechangbin/Toonflow-app#74`。本 App 分支叠在 T11 Draft PR #101（其上游为 T17）之上，对应 Web T18 Draft PR #9；当前只是旧 Socket 止损与新 Harness 并行兼容切片，不代表 T18 整体完成。

旧 Script/Production Socket 路由此前收到 `stop` 后只 abort 当前控制器，不发送消息终态；Web 侧现在不再乐观改为 idle，因此会一直显示生成中。共用 `legacyStopLifecycle` 在服务端 abort 同时发送一次 `message:update: stop`，重复 stop 不重复发送；新 chat 抢占旧 chat 时旧消息也得到 stop，旧请求迟到的 finally 不会清空新请求。它仍不是持久 Run 的取消，不能证明旧 Agent 的外部 Tool 没有部分效果，也不能把 Socket 视为生产结果权威。

进一步在旧 `MessageBuilder` 上添加 stop 终态栅栏：停止后的迟到 `complete`、`error` 或状态更新不能覆盖停止回执，重复 stop 也不会再发一次。内容流现在共享同一停止标志，已有流的迟到 `append/merge/complete/error` 及停止后新建内容都不再发 Socket 内容事件；已发出的网络分片仍可能在途，外部效果更不会因此撤销。Web 仍须以受控 Run 的 HTTP 快照判断生产结果。

旧 Production Socket 原先只校验 JWT 是否有效，握手和 `updateContext` 却直接采用客户端提供的 Project/Script/隔离键。现按 token 内的用户 ID 校验 Project 归属、Script 与 Project 的关系及隔离键的精确格式；未选剧本只允许建立连接，不允许 chat。上下文切换在校验成功后才生效，切换请求开始时即停止旧消息；并发校验的迟到结果不能覆盖较新选择，断连时 abort 当前消息。这仍是旧路由的边界加固，并非旧 Agent 已迁入 Harness。

切换竞态补强：`updateContext` 一开始就停止旧消息、关闭 chat 门，再做异步归属查询；查询失败仍保持关闭，只有最新切换成功才重开。否则客户端已切到新 Script 时，旧上下文可能趁校验间隙接受新 chat。断连也永久关闭此门。`tests/legacyProductionContextGate.test.ts` 2 例覆盖失败、重试、反序返回和断连；相关定向 6 例及 App TypeScript 检查通过，未运行浏览器联调。

本次新增 `tests/legacyMessageStopFence.test.ts` 第 3 例，覆盖已有文本、Markdown、思考、搜索、Tool、推理内容流及停止后新建内容的迟到事件；该文件 3 例和 App TypeScript 检查通过。下段原阶段计数保留为此前记录，本次增量不代表已做全量兼容回归。

定向验证：`tests/legacyStopLifecycle.test.ts` 2 例覆盖一次停止与迟到 finally；`tests/legacyMessageStopFence.test.ts` 2 例覆盖迟到终态与正常完成；`tests/legacyProductionContext.test.ts` 2 例覆盖合法、越权、错配及未选剧本上下文；App TypeScript 检查通过。Web 侧对应 `useChat` 定向测试确认发送请求不提前改消息状态。没有跑全量测试、构建、跨仓浏览器流程、真实 Provider 或 bundle 重建。后续 T18 要继续把旧 Socket 生命周期/前端完成回调迁走，完成共用 Run/审批/恢复体验及兼容回退；T21 才做完整验收。

2026-09-26 预验收增量：Web T18 修订 `0609a7f5c647743f4d92794efd57cb98fc37816e` 的 Vite 构建已在本地成功，六个 `dist` 文件与本 App 分支 `data/web` 比较后只有 `index.html` 不同；已把该文件同步入 App。同步后 `data/web/index.html` SHA-256 为 `132C528F8113D07A0C744A06665AE0B54ABCE0D4E3E36B224636138F02316437`，其余五个文件哈希一致。此为当前 Web 修订的阶段 bundle，不是 T21 冻结清单。以 T21 堆叠 App 修订、隔离临时数据库、复制的内置 Skill/Vendor/Prompt Profile 与此 Web 构建启动本地 App/Web，浏览器完成登录和 Script Harness 空 Run 的 Owner HTTP 读取。随后在该隔离数据库配置本地假文本 Model 和已发布只读 Skill，实跑 Script Run 创建、完成、停止意图、刷新后的服务端恢复与中断后的 `interrupted-model-call` 分类；逐次观察、Run ID 与边界见 T21 `docs/reports/agent-harness-final-acceptance-77-prep.md`。正常 Project 创建/选择仍需 Image/Video 模型，本轮通过临时种入 Project 和浏览器 store 选定绕开，不计入该路径验收；也未覆盖 Production、写入审批/拒绝、跨入口共同 UI、完整旧 Socket 迁移与最终自动化浏览器套件。

2026-09-26 停止竞态复现与修复：隔离的本地假 Model 在运行期间延迟 8 秒，浏览器在 Script Run 的 queued→running 版本变更窗口点击停止，旧 Web bundle 对 `/scriptHarnessControls/cancel` 收到 HTTP 409 后只刷新状态，没有再次提交停止命令；Run 最终成功且 Trace 没有 `run.cancellation-requested`。根因是 Web 通用 Axios 拦截器把 HTTP 错误缩为响应体，丢失 status。Web T18 修订 `f6126c9` 保留错误 status；Harness 客户端仅在明确 409 时检查同一个 Project/Run/role/scope 的新版本，并用原 `clientCommandId` 最多重试一次。未知网络结果不自动重试，已终态的 Run 也不重试。四个定向契约测试、Web type-check 和 Vite 构建通过。

为可重复验证，新增 `tests/fixtures/prepareHarnessBrowserFixture.ts`、`fakeOpenAITextServer.mjs`、`checkScriptHarnessBrowser.js`：仅在临时 `DATA_DIR` 种入测试 Project、假文本 Model 与已发布只读 Skill；浏览器从登录、创建/完成 Script Run、Trace 检查、刷新后恢复到慢调用停止连续跑通。实跑新 Run `9679427f-c017-4d93-9421-d66e684f9528` 成功；停止 Run `40a985ed-1943-40b1-8ef0-789380cd9651` 的 Trace 为 `run.created → run.started → run.cancellation-requested → run.succeeded`。这证明停止意图已持久化，**不证明**运行中的外部 Model 请求被撤销：当前运行中取消是协作式意图，模型结果迟到仍可成功。六个 Web `dist` 文件与本 App `data/web` 按文件 SHA-256 完全一致；本轮 `index.html` SHA-256 为 `0B14BA5A6A2E7B076069E7A679522E9876C43E16F21733CA78A5EEE70C79AE88`。这仍不是最终验收；Approval/Reject、Production、Reconnect、Recovery、旧 Socket 退场与真实 Vendor 假适配尚需补测。

审批浏览器增量：`tests/fixtures/checkScriptWriteApprovalBrowser.js` 使用同一临时 Project，经已存在的 Owner `/scriptWriteApprovals/propose` 接口建立两个单字段候选；页面刷新待审列表、查看批准候选全文、确认批准，再对另一候选确认拒绝。批准 Run `56918bf4-bccc-4d0e-8365-9b27f745ed07` 只改变 `storySkeleton`，拒绝 Run `6b98adf5-835a-4bde-9e68-ae03ac30a9d3` 不改变 `adaptationStrategy`，由服务端 `getPlanData` 再读复核。测试中提案来源是 Owner HTTP 接口，**不是**模型 Tool 调用，因此只覆盖审批/拒绝 UI 与服务端效果，不覆盖 Skill 授权、模型提案和跨入口复用。两份浏览器夹具还在测试 Project 选择处增加重载后的重试，以适应项目首页异步清空 store；正常 Image/Video 模型配置入口仍未验证。上一段“Approval/Reject 尚需补测”是旧快照，现仅指模型提案来源及更广的审批矩阵未测。
