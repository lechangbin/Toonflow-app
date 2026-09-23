# Agent Harness T09 · 计费图片请求恢复（进行中）

Issue: `lechangbin/Toonflow-app#65`. Branch: `codex/harness-t09-billable-image-20260923`. This is an implementation checkpoint, **not** T09 acceptance and not a resume claim.

## 已实现和可核验的边界

- `billableImageLifecycle.ts` 对 Project/Asset/Vendor/Model/分辨率、单次调用上限与预估费用上限形成精确 scope hash；状态转换拒绝同一 approval 的二次 dispatch。超时/断连对应 unknown，不能据此断言未计费。
- 三张独立账本表关联 ToolCall、VendorRequest 和 Artifact；请求身份及计费范围禁止原位改写，Provider task ID 和 artifact hash 一旦观察也不能替换。
- `billableImageLedger.dispatch` 在一个事务中检查 Project owner、Run/审批/Tool 契约、有效期、版本和审批时目标状态，再提交 ToolCall、VendorRequest 与 request-intent checkpoint。只有新提交者获得 `maySubmit=true`；重复调用和重启后的检查均为 `false`。
- 观察到可信 Provider task ID 时先记录 checkpoint，再允许后续按 task ID 核对。数据库就绪恢复把没有确认结果的 `dispatch_recorded` 停在 unknown；不自动重发可能计费的请求。恢复读链校验 VendorRequest 与 checkpoint 的对应关系。
- 新增计费提案与决定运行时：服务端报价形成最多一次调用的 scope，冻结 Tool 修订、内容 hash、目标状态指纹和用户可读预览；项目 Owner 才能提案、检查和决定。拒绝、过期、目标漂移不产生 VendorRequest。重复提案即使报价策略更新也返回原审批；重复决定保持幂等。
- 图片前置校验按当前 Project 图片目标、Asset 所属、配置的 Image Model、提示词修订和实际参考图/父资产锚点媒体内容计算指纹；记录只保存摘要，不保存提示词、Base64 或媒体路径。
- dispatch 同事务创建与 VendorRequest 相关联的 `o_image` 占位，但尚不改写 Asset 当前选中的图片。内部产物观察模块对媒体做 MIME/Hash 校验，用请求身份派生存储路径，重复同一回调只返回既有记录，冲突内容拒绝替换；取消后的迟到产物留为 `late` 证据，不改写已取消图片或 Asset 绑定。
- 正常产物接受路径重查 Project Owner、审批绑定、未取消状态、当前图片与目标指纹；在同一 SQLite 事务内提交 Image 完成态、Asset 当前图、Artifact 接受态、ToolCall/Receipt、Run Output、Checkpoint 与 Trace。重复提交只返回原结果；恢复校验最终输出与被接受的 Artifact 关联。
- 内部执行编排复用现有图片域的提示词/参考图/父锚点准备函数与已配置 Vendor 的图片适配器。准备前后及 dispatch 事务各核对一次目标指纹；只有 `maySubmit=true` 的首次请求跨外部调用边界。fake Provider 覆盖成功、重复调用无二次提交、超时未知、取消后迟到与本地提交失败。
- 项目 Owner 可按 Vendor/Model/分辨率配置带修订号的本地审批估算；缺省拒绝提案。这是用户维护的调用预算上限，不是 Provider 实时价格或账单保证。受 JWT 保护的 `/api/agentRuns/billableImage` 路由提供报价读写、提案、列表、审批决定、单次执行、取消及产物查询。执行时服务端重新读取已批准 scope，忽略浏览器传来的 scope 或 actor ID；审批快照同时暴露请求身份/状态供操作员查看，不暴露原始提示词或密钥。

## 阶段验证

`tests/billableImageLifecycle.test.ts`、`tests/billableImageLedger.test.ts`、`tests/billableImageSchema.test.ts`、`tests/billableImageApproval.test.ts`、`tests/billableImagePreflight.test.ts`、`tests/billableImageArtifact.test.ts`、`tests/billableImageExecution.test.ts`、`tests/billableImageQuotePolicy.test.ts`、`tests/billableImageRoutes.test.ts` 和受影响的 `tests/databaseReadiness.test.ts` 为定向测试；已运行的阶段用例均通过。`yarn lint`（TypeScript `--noEmit`）通过。没有运行仓库全量测试、App/Web 构建、浏览器端到端、真实 Provider 或打包验收。

## 尚未实现，不能宣称完成

当前只有受保护的服务端入口，尚无实际用户审批界面或 Agent 自动提案连接，也未验证真实 Provider 行为。现有 Vendor 同步接口没有向 Harness 暴露 Provider task ID，因此实际轮询恢复尚不能兑现；未知请求只能保持待人工核对，不能自动重发。写入媒体在数据库观察事务前进行，事务失败可能留下未关联对象；此时不宣称成功，后续需补清理或回收。旧 `generateAssetImage` 对超时的图片失败状态，不能作为 T09 的无计费证明。Issue #65 和 ADR-0016 应保持开放/proposed。

下一步应接入审批卡与操作员恢复动作；明确同步 Vendor 无任务 ID 时的不可轮询边界，处理孤儿媒体，完成跨模块定向契约验证。T09 完成后再写正式深化说明、导学与面经；简历内容由用户自行决定。
