# Agent Harness T17 面经：生产 Run 与计费提案（阶段版）

> 仅对应本分支已实现的局部链路。面试时明确说明旧生产 Socket、批量图片、视频、分镜写入和 Web 完整投影尚未迁移；全量与真实 Provider 验收留到 T21。不给出未经测量的效果数字，也不代写简历。

## 一面：先把边界讲准

1. 问：T17 到底做完了什么？答：建立独立生产 Harness Run，冻结已发布 Skill，可通过受控 Tool 读取拍摄计划/分镜表文本，并在独立 grant 下分别提出单资产图片生成和派生资产写入候选。候选会创建 T09 或 T08 的待 Owner 审批子 Run；它不等于生成或写入完成。追问“证据在哪”：看 `src/agentRuntime/index.ts`、`src/agents/productionAgent/harnessPreparation.ts`、`tests/productionHarnessRun.test.ts`。
2. 问：为何不让模型直接调用旧的图片生成 Tool？答：旧 Socket 流程没有完整的受控租约、审批、请求账本和恢复证据。模型建议只是意图，不能代替 Owner 授权成本。这里让模型停在 proposal，后续沿用 T09 审批与 Vendor ledger。追问“代价”：多一次 Owner 处理，而且目前只覆盖单资产，旧路径仍需迁移。
3. 问：为什么生产工作区读 Tool 只开放两个文本字段？答：剧本 `scriptPlan` 和 `storyboardTable` 是当前指导 Run 需要的有界只读信息；资产数组和生成状态包含不同的隐私、写入和外部成本语义，不应塞进一个宽 Tool。适配器按 Project/剧本键核对并拒绝重复行、不合规文本。证据：`src/agents/productionAgent/harnessWorkspaceRead.ts` 与对应单测。

## 二面：权限、事务与失败追问

4. 问：Skill manifest 请求了图片 Tool，模型就能提案吗？答：不能。还需当前 Owner 显式授予 `propose:billable-image`；运行时检查生产 role/scope、冻结 Skill 请求和 Project grant 的交集。grant 与 `read:production-workspace` 独立，撤销后新操作被拒绝。证据：`src/skillRuntime/grants.ts`、`tests/productionHarnessGrants.test.ts`。
5. 问：父 Run 在模型请求时失去租约，会怎样？答：创建子审批的同一数据库事务会用 Run ID、owner/epoch、fence、过期时间检查租约；失效时不落子审批。假模型单测伪造 fence 验证拒绝。不能据此宣称已完成真实多进程故障验收。
6. 问：模型重试同一个 Tool 调用会重复计费吗？答：提案本身不计费。同一父 Run 和 operation ID 派生确定性请求键，子 Run 的指纹约束目标；不同目标是冲突，不会悄悄复用。真正提交由 T09 Owner 审批与 Vendor ledger 控制。假 Provider 超时被记为未知，重复执行不会再次调用，取消后的迟到图片保留证据但不链接 Asset；真实 Provider 的迟到和对账仍待 T21。
7. 问：如何证明一条审批来自被授权的父 Run？答：子 Run 冻结父 Run ID、操作 ID、Skill ID 和 Tool 合约哈希；父 Run 有同操作的权限判定。inspect 时复核父 scope、判定哈希、allow 结果和审批操作一致性；数据库不允许改写审批绑定。前端需要的效果状态另由 Owner-only 的只读投影从父判定定位子 Run，不取模型自述。证据：`src/controlledTools/billableImageApproval.ts`、`src/agents/productionAgent/harnessEffects.ts`、`docs/adr/0023-production-agent-image-proposal-boundary.md`。
8. 问：父 Run 已成功，Owner 后续处理子审批，会把父 Run 状态改写吗？答：不会。父 Run 的成功只表示模型指导步骤完成，子 Run 是独立的计费效果决策。定向测试验证非 Owner 不能批准；Owner 批准后，假 Provider 只调用一次，图片证据和 Asset 关联在子 Run 提交，父 Run 仍成功。拒绝路径由 T09 审批单测覆盖；面试时必须分别描述两个状态。
8a. 问：派生资产只是本地写表，为何还要审批？答：本地写入虽然没有 Vendor 成本，却会改变 Project 的资产关系和视觉派生指令，错误内容可能被后续生成消费。模型只持有 `propose:derived-asset`，没有 `write:derived-asset`；T08 审批时再次检查精确 payload、目标版本、等价状态和目标状态哈希。定向测试在模型提案后确认资产表没有新增，Owner 批准后只新增一条，撤销 grant 后新提案被拒绝。证据：`src/controlledTools/derivedAssetWrite.ts`、`tests/productionHarnessRun.test.ts`、`docs/adr/0024-production-agent-derived-asset-proposal-boundary.md`。
8b. 问：派生资产提案怎么避免冒用父 Run？答：子 Run 创建和父 Run 权限判定在同一事务内进行；校验父 Run 的运行状态、Owner 身份与有效 lease，冻结 Skill 必须请求该 Tool 与独立能力，Project grant 必须当前有效。子 Run 保存父 Run、操作、Skill 和提案合约哈希；inspect 再复核权限判定哈希与 operation ID。相同操作派生确定性请求键，变更 payload 冲突。这证明本地持久绑定，不代表已经通过跨进程或恶意数据库篡改验收。
8c. 问：Owner 如何确认自己批准的不是被前端摘要掩盖的内容？答：T08 快照原本只有预览和载荷哈希，模型提案接入后不足以逐字段核对。现在 Owner-only inspect 在 schema、payload 哈希、预览、Tool 合约与 Receipt 绑定全部有效时才返回精确 payload；损坏证据不给 payload。试用面板展示完整 JSON，并在缺 payload 时禁用批准；服务端依然以冻结 payload 和目标状态作为提交依据，前端展示不是授权的唯一屏障。证据：`src/controlledTools/derivedAssetWrite.ts`、`tests/derivedAssetWrite.test.ts`、Web PR #8。浏览器交互尚未验收。

## 三面：反例、取舍与未完成项

9. 问：为什么暂不把生产 Agent 宣称为“可恢复生成工作流”？答：目前持久 Run 只承载指导和单资产待审批提案；旧 Socket 的批量图片、视频、分镜/资产写入还没有统一 typed Steps、幂等效果和恢复投影。声明整个生产链路已迁移会混淆局部审批成功与真实生成成功。
10. 问：若要继续推进，优先顺序是什么？答：先为各生产效果定义独立 typed Step/Tool 和可验证输入、效果账本及 Owner 授权；再把批量图片、分镜/资产写入和视频逐条迁移并保留兼容回退；最后做跨进程重启、迟到结果、Web 状态和真实 Provider 验收。不能为了赶进度复用“模型回答成功”作为效果完成信号。

## 练习与证据缺口

自测时画两条时间线：A）模型提案→Owner 拒绝，B）模型提案→Owner 批准→Vendor 提交结果未知；分别标出 Run 状态和每一步的权限主体。当前可核验的是本轮定向单测、局部假 Provider 成功路径与 TypeScript 检查；尚无浏览器、真实供应商、完整回归或线上指标。每个回答如需提数字，必须先找到对应测试/日志/报告，找不到就说“待测”。
