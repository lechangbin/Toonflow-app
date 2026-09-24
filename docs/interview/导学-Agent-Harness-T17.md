# Agent Harness T17 导学：生产 Run 与计费图片提案（阶段版）

> 当前仅覆盖已落地的生产指导 Run、只读工作区 Tool、单资产图片提案及派生资产写入提案；前者复用 T09 的假 Provider 路径，后者复用 T08 的本地 Owner 审批。T17 生成黄金链路未完成；完整测试、浏览器与真实 Provider 验收留到 T21。只写可核验的实现与学习材料，不写简历或线上收益。

## 学习目标与前置知识

| 必备概念 | 本项目落点 | 能回答的问题 |
| --- | --- | --- |
| Run、租约与围栏 | `src/agentRuntime/index.ts`、`src/agentRuntime/lease.ts` | 失去执行权的模型回调为什么不能再创建子审批？ |
| 冻结 Skill 与动态 grant | `src/agents/productionAgent/harnessPreparation.ts`、`src/skillRuntime/grants.ts` | 发布时请求能力与 Owner 当前授权为何都要校验？ |
| Tool 合约与输入边界 | `src/controlledTools/definitions.ts` | 只读工作区与计费提案为什么是两个 Tool？ |
| 人工审批与外部成本 | `src/controlledTools/billableImageApproval.ts`、`src/controlledTools/billableImageLedger.ts` | 模型提案、Owner 批准、Vendor 提交分别拥有什么权限？ |
| 父子证据链 | `src/controlledTools/billableImageApproval.ts`、`docs/adr/0023-production-agent-image-proposal-boundary.md` | 父 Run 成功后如何追溯待处理的图片请求？ |
| 本地写入审批 | `src/controlledTools/derivedAssetWrite.ts`、`docs/adr/0024-production-agent-derived-asset-proposal-boundary.md` | 模型为何只能创建待审派生资产，不能直接写入？ |
| 分镜写入候选 | `src/controlledTools/storyboardWriteContract.ts`、`docs/adr/0025-supervise-production-storyboard-writes.md` | 为什么先限定已有 Video Track 的单条分镜？ |

## 源码阅读顺序

1. 读 `CONTEXT.md`、`docs/agents/domain.md`、`docs/adr/0016-billable-image-request-recovery.md`，先弄清 Project/Asset 归属和付费副作用边界。
2. 读 `src/agents/productionAgent/harnessPreparation.ts` 与 `src/agentRuntime/index.ts`：认证 Owner 启动生产 Run，创建事务绑定已发布 Skill，模型只能看到显式注册的 Tool。
3. 读 `src/agents/productionAgent/harnessWorkspaceRead.ts`：后端按 Project 与剧本归属读取单一文本字段，歧义和不合规内容拒绝。
4. 读 `src/skillRuntime/grants.ts` 与 `src/controlledTools/billableImageApproval.ts`：图片提案在同一事务内核对运行租约、Skill 请求、Project grant 和权限判定，再创建 T09 待审批子 Run。
5. 读 `src/controlledTools/billableImageLedger.ts`：Owner 决策之后才可能形成 Vendor 请求意图，未知外部结果不能简单重发。
5a. 读 `src/controlledTools/derivedAssetWrite.ts`：派生资产提案复用 T08 的目标状态与等价状态校验，Owner 决策才提交本地 Asset 与 Instruction。
6. 读 `src/agents/productionAgent/harnessEffects.ts` 与 `src/routes/agentRuns/productionHarness.ts`：只读效果投影分别从图片和派生资产的持久判定与子 Run 读状态，不从模型回复猜测结果；T08 Owner 快照只在完整性验证通过时展示精确 payload。
7. 对照 `tests/productionHarnessRun.test.ts`、`tests/productionHarnessGrants.test.ts`、`tests/billableImageApproval.test.ts` 和阶段报告 `docs/reports/agent-harness-production-migration-73-progress.md`，区分已测与待测。

## 本阶段真实调用链

认证 Owner → 生产 HTTP start → 事务内选择并冻结 Skill → Run 获得租约 → 模型读取生产工作区（需 `read:production-workspace`）→ 模型可分别提出单资产图片候选（另需 `propose:billable-image`）或派生资产写入候选（另需 `propose:derived-asset`）→ 后端核验父 Run、租约和权限 → 创建待 Owner 审批的 T09 或 T08 子 Run → Owner 之后独立批准/拒绝。图片批准路径再由 T09 ledger 控制 Vendor 请求；派生资产批准路径由 T08 在事务内提交 Asset、Instruction、Receipt。两个模型 Tool 都不直接执行效果。

## 关键取舍与验证

| 决策 | 未采用方案 | 原因与代价 | 当前证据 |
| --- | --- | --- | --- |
| 新旧生产路径并行 | 直接替换旧 Socket 生成 | 生成工具尚未全部具备持久 Step、审批与恢复契约；并行期间仍有未迁移入口 | 生产 Run 和旧路径均保留；报告列出未迁移项 |
| 提案复用 T09 子审批 | 模型直接调用 Vendor | 模型建议不等于 Owner 承担费用；多一层人工处理 | 假模型提案后 VendorRequest 为零；Owner 批准后假 Provider 才调用一次并提交 Asset；超时未知不重放 |
| 独立提案 grant | 复用读取或 Script grant | 读取数据与提出计费候选是不同能力 | 默认拒绝、非 Owner、撤销及跨角色定向测试 |
| 冻结来源关联 | 仅展示模型回复文本 | 文本不能证明一次请求来自哪个受权操作 | 子 Run 记录父 ID/操作/Skill，检查时复核判定哈希；效果投影由数据库重建，审批绑定不可变 |
| 派生资产独立审批 | 复用图片授权或让模型直接写表 | 本地资产变更与计费图片属于不同风险；代价是第二种 Owner grant 和审批记录 | 假模型提案时资产数量不变，Owner 批准后只提交一条；撤销授权后新提案拒绝 |

## 自测与边界

- [ ] 口头画出模型提案、Owner 决策、Vendor 请求之间的三个权限边界。
- [ ] 解释相同操作重试为何不应多建子审批，改变目标为何要冲突。
- [ ] 指出伪造租约、撤销 grant、跨 Project Asset 分别在哪一层被拒绝。
- [ ] 明确区分“Run 成功回答”和“子审批已处理/图片已生成”；解释迟到图片为何只作为证据。
- [ ] 不把定向单测与 TypeScript 检查说成全量、浏览器或真实 Provider 验收。
- [ ] 说明派生资产的 `expectedVersion`、等价状态与目标状态哈希为何要在 Owner 批准时再校验。

本阶段没有线上成本下降、成功率、延迟或真实生成质量数据；这些均为待测。T17 后续还要迁移多阶段生产 Step、分镜/资产写入、批量图片和视频及 Web 状态投影，T21 才做最终系统验收。
