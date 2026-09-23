# Agent Harness T09 导学：计费生图的审批与恢复

> 面向 Agent Harness、Agent 应用开发，AI 应用后端作为补充。依用户要求只写功能与学习材料，不代写简历。本文基于 T09 分支的源码与定向测试；真实 Provider、浏览器联调、全量测试与最终验收均未完成。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| 外部副作用与不确定结果 | 请求超时不等于供应商未受理、未计费 | `src/controlledTools/billableImageLifecycle.ts` | 极高 |
| 审批范围与一次性授权 | 人工批准必须固定目标、模型与预算估算 | `billableImageApproval.ts`、`billableImageQuotePolicy.ts` | 极高 |
| 请求意图先于网络调用 | 崩溃后不能凭本地失败状态重发收费请求 | `billableImageLedger.ts` | 极高 |
| 幂等与去重 | 重复点击、回调、重连不应产生第二次请求或产物 | `billableImageLedger.ts`、`billableImageArtifact.ts` | 极高 |
| SQLite 事务与文件系统边界 | 数据库事务不能原子覆盖本地文件写入 | `billableImageArtifact.ts`、`billableImageCommit.ts` | 高 |
| 项目所有权与模型配置 | 前端 ID 和模型选择都不是服务端授权 | `billableImagePreflight.ts`、`src/routes/agentRuns/billableImage.ts` | 高 |
| 任务 ID 与可轮询性 | 没有可信 Provider task ID 不能假装自动查询 | `billableImageLedger.ts`、`docs/adr/0016-billable-image-request-recovery.md` | 高 |
| UI 权威动作 | 未知、取消和迟到不能显示“直接重试” | Web `src/utils/billableImageApproval.ts` | 高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 一次性计费授权 | 把用户同意从按钮行为变成可核验的服务端范围 | capability、scope hash、TTL | `src/controlledTools/billableImageApproval.ts`、`billableImageQuotePolicy.ts` | 1 |
| 先落意图后外呼 | 解决“已经发出还是没发出”不可判定的崩溃窗口 | write-ahead intent、idempotency | `billableImageLedger.ts`、`billableImageExecution.ts` | 2 |
| 未知结果保守恢复 | 不把超时当作可安全重试 | uncertain outcome、reconciliation | `billableImageLifecycle.ts`、`recovery.ts` | 3 |
| 产物证据与原子接受 | 观察到文件不等于图片已成为项目资产 | artifact hash、transaction、checkpoint | `billableImageArtifact.ts`、`billableImageCommit.ts` | 4 |
| 安全操作员界面 | 只显示后端允许的审批、提交、取消和核对动作 | state projection、human-in-the-loop | Web `src/views/assets/components/billableImagePanel.vue` | 5 |

## 3. 必备知识点

- [ ] 能区分本地估算、供应商实际账单、审批上限和实际扣费；本阶段无法保证四者数值一致。
- [ ] 能说清审批前、首次 dispatch、Provider 调用、媒体观察、资产接受五个提交边界。
- [ ] 能解释为何首次 dispatch 后即使没有看到 HTTP 响应，也不能直接重放相同请求。
- [ ] 能区分请求 ID、Provider task ID、Artifact hash、Run 版本各自解决的问题。
- [ ] 能解释取消只是意图，迟到图片为何仍保留却不自动绑定资产。
- [ ] 能回答本地媒体已写但数据库没确认时如何通过 `write_pending` 找到证据。
- [ ] 能明确说出旧批量生图、真实 Provider 轮询和最终全量验收仍不在已完成证据内。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域背景 | Asset、Image、Vendor 与 Agent Run 边界 | `CONTEXT.md`、`docs/agents/domain.md`、`docs/adr/0016-billable-image-request-recovery.md` | 20 分钟 | 为什么不能沿用图片“失败”状态判断计费 |
| 纯状态契约 | 允许转换与操作员动作 | `src/controlledTools/billableImageLifecycle.ts`、`tests/billableImageLifecycle.test.ts` | 25 分钟 | 未知与取消为什么不能直接重试 |
| 提案和预算 | Owner 校验、版本化估算、目标指纹 | `src/controlledTools/billableImageApproval.ts`、`billableImageQuotePolicy.ts`、`billableImagePreflight.ts` | 45 分钟 | 审批具体绑定了什么 |
| 外呼主链 | 请求意图、首次提交权、同步 Vendor 组合 | `billableImageLedger.ts`、`billableImageExecution.ts`、`billableImageComposition.ts` | 50 分钟 | 崩溃、超时、重复执行如何处理 |
| 本地效果 | 媒体意图、哈希、接受事务 | `billableImageArtifact.ts`、`billableImageCommit.ts` | 45 分钟 | 何时才称为成功图片 |
| HTTP 与界面 | JWT 身份、快照和按钮映射 | `src/routes/agentRuns/billableImage.ts`、Web `src/views/assets/components/billableImagePanel.vue`、Web `src/utils/billableImageApproval.ts` | 30 分钟 | 用户如何看到未知、迟到与待写入 |
| 阶段证据 | fake Provider 和数据库恢复断言 | `tests/billableImageExecution.test.ts`、`tests/billableImageArtifact.test.ts`、`tests/databaseReadiness.test.ts` | 45 分钟 | 单测能证明什么、不能证明什么 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。建议先手画一次“提案 → 批准 → 请求意图 → 供应商 → 产物观察 → 本地提交”的时序图，再分别在每个箭头处假设断电、超时、重复回调和取消。

## 6. 项目技术定位

第一方向是 Agent Harness，第二方向是 Agent 应用开发，AI 应用后端为补充；重点是让 Agent 的外部计费副作用具备显式授权、耐重启身份、可核验证据和保守恢复，而非模型训练或算法优化。

## 7. 核心原理解析

1. 计费不能由模型或浏览器自行授权 → Owner 维护服务端本地估算并冻结一次调用的目标、模型、分辨率、币种与上限 → `billableImageQuotePolicy.ts`、`billableImageApproval.ts`。
2. 发送后可能丢失结果 → 先事务提交请求身份和检查点，只有创建该记录的执行者获得一次外呼权 → `billableImageLedger.ts`、`billableImageExecution.ts`。
3. 供应商完成与业务成功不同 → 先校验媒体、登记待写入/已观察产物，再在事务中绑定 Image、Asset、Receipt、Run Output 和 Checkpoint → `billableImageArtifact.ts`、`billableImageCommit.ts`。
4. 人工取消不保证外部取消 → 本地记录取消意图，迟到产物保留证据却不复活已结束 Run → `billableImageLedger.ts`、`billableImageArtifact.ts`。
5. UI 超时不能擅自重试 → 后端给请求状态与允许动作；页面展示人工核对、取消、结束跟踪、本地提交等受限动作 → Web `billableImagePanel.vue`。

## 8. 关键设计决策

| 决策 | 备选 | 当前取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| 本地估算缺省拒绝 | 伪造统一价格 / 无报价先调用 / Owner 配置 | 选择 Owner 版本化配置，明确不保证账单 | 估算与供应商实际价格可能偏离 | 报价缺失、越权和修订冲突单测；真实价格待核对 |
| 先记请求意图 | 先外呼后记账 / 先落账后外呼 | 选择后者，宁可出现“可能未发出但不可自动重试” | 人工核对成本 | 重复 dispatch、启动恢复与 fake Provider 超时测试 |
| 未知保守停住 | 超时直接标失败并重试 / unknown | 选择 unknown，禁止原请求自动重放 | 无 task ID 时恢复能力有限 | timeout、重复调用和 UI 文案定向测试 |
| 媒体先有待写入记录 | 文件写入后才插记录 / `write_pending` | 选择先登记意图 | 文件可能不存在或哈希不符 | 写入失败、内容篡改、人工本地恢复单测 |
| 单资产先迁移 | 同时替换批量与单资产 / 先控制一个路径 | 选择单资产 UI 接入，旧批量明确保留 | 暂时有未受控旧路径 | Web 接线与后续迁移验收 |

## 9. 量化与验证（含待测）

当前可核验的是 App T09 定向用例 37/37、Web 新增契约用例 2/2、App TypeScript 静态检查与 Web 无声明输出类型检查；它们不等于全链路成功率。建议最终验收采集同一审批的实际 Provider 提交次数、unknown 占比、人工核对时长、取消后迟到产物数、待写入媒体恢复成功率与审批估算偏差，并跑 App/Web 全量测试、构建、浏览器重复点击/断线、真实 Provider 和打包验证；目前这些线上与端到端指标均为待测。
