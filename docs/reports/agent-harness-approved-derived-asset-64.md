# Agent Harness T08：审批绑定与衍生资产原子写入证据

## 范围与版本

Issue #64 在 T07 受控只读工具之后加入首个需人工批准的本地生产写工具 `upsert_derived_asset`。App 起点为 `origin/develop@6f44360c01908474b766bcc4d690b964e79c5b32`，实现提交为 `86843cc`（前置契约提交 `0ff9034`）；Web 起点为 `origin/develop@c8c0bf4`，实现与测试纳入提交为 `9725b88..a58ff96`。App PR #87 与 Web PR #4 构成完整 T08 交付，最终合并提交以 Issue #64 的记录为准。ToolDefinition 修订为 `toonflow.tool.upsert-derived-asset.v1`，契约 SHA-256 为 `648a4e1104ab90387c41fcd9bde890d5c0d7e6eca7d886192115ed139b45fe6b`。本阶段没有生成 App/Web bundle，故没有 bundle 哈希、打包截图或真实 Provider 结果；这些属于最终验收。

## 设计与行为变化

旧 Production Agent 的 Socket 工具可直接写 `o_assets` 和变化契约，人工批准不是可恢复的独立记录。T08 没有偷偷改写旧路径，而是建立独立的 `productionAgent / approved-derived-asset-write-v1` Run 范围。严格输入包含父 Asset、可选目标 Asset、预期版本、Script、受限展示字段及新版变化契约；ToolDefinition 明示项目工件修改、无外部费用、逐操作审批、Run 内操作幂等、无自动重放和同库事务提交。

提案先验证 JWT 用户与 Project 所有者、Script/父 Asset/目标 Asset 归属、类型、变化维度、剧本证据、等价状态与目标版本。现有目标必须有有效变化契约；其 `revision` 是预期版本，额外以 Asset 和契约的服务端状态哈希防止绕过版本号的旧路径修改。新建目标的预期版本为 0。只有合法提案才创建 waiting Run、Tool Step/Attempt、pending ToolReceipt、ToolApproval、初始 Agent Checkpoint 和安全 Trace。审批记录绑定规范化载荷哈希、Tool 修订及契约哈希、目标状态哈希、只读效果预览和十分钟到期时间；绑定字段由 SQLite 触发器阻止更新或删除。

批准命令使用 JWT 中的用户 ID，不信任请求体伪造的 `actorUserId`；命令带 `runId / approvalId / clientCommandId / expectedVersion`。事务内重新核对项目所有者、审批绑定、到期、目标版本与状态哈希和等价状态；之后一次性写 Asset、Derived Change Instruction 下一版本、ToolReceipt、Run Output、hash-linked Checkpoint 与 Trace。重复的同一命令直接返回既有快照，不产生第二次 Asset 修改。拒绝、过期、目标冲突和证据异常只保留可检查的安全状态，不写生产资产；到期提案即使无人点击，也会在读取或数据库重启就绪时收敛为持久 `expired`。数据库写入异常使整个事务回滚，pending 提案保留供核查，绝不声称已提交。Trace 不复制展示名称、变化指令或原始异常。

HTTP 提供 `propose / inspect / list / decide`，列表限当前 Project 最多 20 条且待审批优先、其余按创建时间倒序，接口前有应用 JWT 鉴权且 Runtime 再核对 Project.userId。Web 在现有生产 Agent 聊天侧栏展示最多三张审批卡并优先显示可操作提案：服务端效果预览、目标版本、Tool 修订、载荷哈希前缀、到期时间和安全状态；按钮只依据后端 `allowedActions`，点击前再次确认。错误或 409 只刷新权威列表，不自动重复副作用。关闭和重连后重新读取持久列表；没有创建新的管理后台。

## 负面与原子性证据

| 情况 | 本阶段断言 |
| --- | --- |
| 跨 Project 的父 Asset、错误所有者或非法 Script | 提案前拒绝；无 Run、审批或写入 |
| 非法字段、错误目标版本、缺少剧本证据 | 严格拒绝；无提案持久化 |
| 同一提案重试、同一审批命令重试 | 返回同一快照；只发生一次 Asset 写入 |
| 拒绝、过期、被修改的目标或被篡改的审批证据 | 无 Asset/契约写入；状态可安全检查 |
| 目标有等价视觉状态 | 提案/提交两次检查；不会创建重复状态 |
| 契约插入触发数据库故障 | Asset、Receipt、Checkpoint、Trace 全部回滚；pending 提案可检查 |
| worker/页面重启 | 共享 Agent Run 检查器从持久记录重建 waiting 或 succeeded 快照 |

## 本阶段验证与后续验收

App 定向测试：`node --import tsx --test tests/derivedAssetApprovalRoutes.test.ts tests/derivedAssetWrite.test.ts tests/agentRunSchema.test.ts`，**28/28 通过**；加上受影响的 T07 读工具回归 `tests/controlledTools.test.ts` 为 **38/38 通过**，其中验证重启清理器不会吞掉待人工审批的收据；数据库就绪局部回归 `tests/databaseReadiness.test.ts` **7/7 通过**；`yarn lint` 通过。Web 定向单元测试：`node --experimental-strip-types --test tests/derivedAssetApproval.test.ts`，**2/2 通过**；`vue-tsc -p tsconfig.app.json --noEmit --composite false` 通过。Web 工作树的 `yarn type-check` 声明构建因 node_modules 软链接的 TS2742 外部路径错误未通过，未将它当作本阶段成功证据。提交前还需复核 `git diff --check`。

依用户约定，尚未运行全仓库测试、完整 App/Web build、浏览器 E2E、Electron 打包或真实模型／图像 Provider 测试；最终一起验收。T08 尚未把旧 Production Agent Socket 工具迁到新 Run；生产 Agent 通过新 HTTP/Runtime 边界创建的审批可在侧栏处理，旧模型调用不会自动产生 T08 审批卡。完整 Trace 证据抽屉、更多生产写工具和外部费用审批属后续阶段。当前定向测试证明本地事务性质，不构成线上事故率、时延或成本改善的量化证据。

## 兼容、回滚和源码索引

新表 `o_agentToolApproval` 由常规数据库初始化创建，旧 Run 行不重写；旧工具仍可运行，但应在后续迁移阶段收敛。若需停用新入口，可撤去新审批路由与 Web 卡片，保留已落库的 Run、Approval、Receipt 和 Checkpoint 审计记录；不得通过删除表来“回滚”已完成的生产效果。ToolDefinition v1 不得原地改约，后续行为变化须发布新修订并保留旧证据读取能力。

| 主题 | 证据位置 |
| --- | --- |
| 领域与决策 | `CONTEXT.md`、`docs/adr/0015-bind-derived-asset-writes-to-durable-approval.md` |
| Tool 契约与执行 | `src/controlledTools/definitions.ts`、`src/controlledTools/derivedAssetWrite.ts` |
| Schema 与路由 | `src/lib/initDB.ts`、`src/routes/agentRuns/derivedAssetApproval.ts`、`src/router.ts` |
| Web 审批卡 | Toonflow-web `src/views/production/components/rightChatBox/index.vue`、`src/utils/derivedAssetApproval.ts` |
| 聚焦测试 | App `tests/derivedAssetWrite.test.ts`、`tests/derivedAssetApprovalRoutes.test.ts`、`tests/agentRunSchema.test.ts`；Web `tests/derivedAssetApproval.test.ts` |
