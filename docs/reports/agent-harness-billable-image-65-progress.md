# Agent Harness T09 · 计费图片请求恢复（进行中）

Issue: `lechangbin/Toonflow-app#65`. Branch: `codex/harness-t09-billable-image-20260923`. This is an implementation checkpoint, **not** T09 acceptance and not a resume claim.

## 已实现和可核验的边界

- `billableImageLifecycle.ts` 对 Project/Asset/Vendor/Model/分辨率、单次调用上限与预估费用上限形成精确 scope hash；状态转换拒绝同一 approval 的二次 dispatch。超时/断连对应 unknown，不能据此断言未计费。
- 三张独立账本表关联 ToolCall、VendorRequest 和 Artifact；请求身份及计费范围禁止原位改写，Provider task ID 和 artifact hash 一旦观察也不能替换。
- `billableImageLedger.dispatch` 在一个事务中检查 Project owner、Run/审批/Tool 契约、有效期、版本和审批时目标状态，再提交 ToolCall、VendorRequest 与 request-intent checkpoint。只有新提交者获得 `maySubmit=true`；重复调用和重启后的检查均为 `false`。
- 观察到可信 Provider task ID 时先记录 checkpoint，再允许后续按 task ID 核对。数据库就绪恢复把没有确认结果的 `dispatch_recorded` 停在 unknown；不自动重发可能计费的请求。恢复读链校验 VendorRequest 与 checkpoint 的对应关系。

## 阶段验证

`tests/billableImageLifecycle.test.ts`、`tests/billableImageLedger.test.ts`、`tests/billableImageSchema.test.ts` 和受影响的 `tests/databaseReadiness.test.ts` 为定向测试；本阶段全部通过。`yarn lint`（TypeScript `--noEmit`）通过。没有运行仓库全量测试、App/Web 构建、浏览器端到端、真实 Provider 或打包验收。

## 尚未实现，不能宣称完成

当前还没有生成计费 proposal 的 HTTP/Agent 入口、实际用户审批界面，也没有把配置的图片 Vendor 和单资产图片领域入口置于账本之后。Artifact 表目前只有 schema；尚无媒体写入、取消后迟到结果保存和最终 Asset/Image 绑定。旧 `generateAssetImage` 对超时的图片失败状态，不能作为 T09 的无计费证明。Issue #65 和 ADR-0016 应保持开放/proposed。

下一步应先完成审批提案与目标状态指纹，再用假 Provider 把单资产 happy path、模糊提交、重复回调、取消和迟到 artifact 贯通。T09 完成后再写正式深化说明、导学与面经；简历内容由用户自行决定。
