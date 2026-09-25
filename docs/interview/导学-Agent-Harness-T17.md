# Agent Harness T17 导学：生产 Run 与计费图片提案（阶段版）

> 当前覆盖生产指导 Run、只读工作区 Tool、单资产图片、派生资产与单条分镜提案。图片复用 T09 假 Provider 路径，派生资产复用 T08 审批，分镜限定已有空 Video Track 的本地写入。T17 生成黄金链路未完成；完整测试、浏览器与真实 Provider 验收留到 T21。只写可核验的实现与学习材料，不写简历或线上收益。

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
| Video 无副作用准备 | `src/controlledTools/videoGenerationPreparation.ts`、`src/video/production.ts`、ADR-0026 | 为什么校验命令与供应商提交必须分开？ |

## 源码阅读顺序

1. 读 `CONTEXT.md`、`docs/agents/domain.md`、`docs/adr/0016-billable-image-request-recovery.md`，先弄清 Project/Asset 归属和付费副作用边界。
2. 读 `src/agents/productionAgent/harnessPreparation.ts` 与 `src/agentRuntime/index.ts`：认证 Owner 启动生产 Run，创建事务绑定已发布 Skill，模型只能看到显式注册的 Tool。
3. 读 `src/agents/productionAgent/harnessWorkspaceRead.ts`：后端按 Project 与剧本归属读取单一文本字段，歧义和不合规内容拒绝。
4. 读 `src/skillRuntime/grants.ts` 与 `src/controlledTools/billableImageApproval.ts`：图片提案在同一事务内核对运行租约、Skill 请求、Project grant 和权限判定，再创建 T09 待审批子 Run。
5. 读 `src/controlledTools/billableImageLedger.ts`：Owner 决策之后才可能形成 Vendor 请求意图，未知外部结果不能简单重发。
5a. 读 `src/controlledTools/derivedAssetWrite.ts`：派生资产提案复用 T08 的目标状态与等价状态校验，Owner 决策才提交本地 Asset 与 Instruction。
5b. 读 `src/controlledTools/storyboardWriteContract.ts`、`storyboardWriteApproval.ts` 和 `storyboardWriteEffect.ts`：空 Track 单分镜候选冻结目标，模型只提案；Owner 决策在一个事务中提交分镜、关联及持久证据。
5c. 读 `src/controlledTools/videoGenerationProposalContract.ts`、`videoGenerationPreparation.ts` 和 `src/video/production.ts`：单轨道 Video 候选冻结目标，复用手动生成的 Vendor/Prompt/Capability 命令校验，但尚无审批或外部提交。
6. 读 `src/agents/productionAgent/harnessEffects.ts`、`src/routes/agentRuns/productionHarness.ts` 与 `src/routes/agentRuns/storyboardWriteApproval.ts`：只读效果投影从三类持久子审批读状态，不从模型回复猜测结果；Owner 审批从认证请求获取身份。
7. 对照 `tests/productionHarnessRun.test.ts`、`tests/productionHarnessGrants.test.ts`、`tests/billableImageApproval.test.ts` 和阶段报告 `docs/reports/agent-harness-production-migration-73-progress.md`，区分已测与待测。

## 本阶段真实调用链

认证 Owner → 生产 HTTP start → 事务内选择并冻结 Skill → Run 获得租约 → 模型读取生产工作区（需 `read:production-workspace`）→ 模型可分别提出单资产图片、派生资产或单条分镜候选（分别需独立 Project grant）→ 后端核验父 Run、租约和权限 → 创建待 Owner 审批的子 Run → Owner 独立批准/拒绝。图片批准路径仍需 T09 ledger 控制 Vendor 请求；派生资产和分镜批准路径各自在本地事务内提交效果与持久证据。三个模型 Tool 都不直接执行效果。

## 关键取舍与验证

| 决策 | 未采用方案 | 原因与代价 | 当前证据 |
| --- | --- | --- | --- |
| 新旧生产路径并行 | 直接替换旧 Socket 生成 | 生成工具尚未全部具备持久 Step、审批与恢复契约；并行期间仍有未迁移入口 | 生产 Run 和旧路径均保留；报告列出未迁移项 |
| 提案复用 T09 子审批 | 模型直接调用 Vendor | 模型建议不等于 Owner 承担费用；多一层人工处理 | 假模型提案后 VendorRequest 为零；Owner 批准后假 Provider 才调用一次并提交 Asset；超时未知不重放 |
| 独立提案 grant | 复用读取或 Script grant | 读取数据与提出计费候选是不同能力 | 默认拒绝、非 Owner、撤销及跨角色定向测试 |
| 冻结来源关联 | 仅展示模型回复文本 | 文本不能证明一次请求来自哪个受权操作 | 子 Run 记录父 ID/操作/Skill，检查时复核判定哈希；效果投影由数据库重建，审批绑定不可变 |
| 派生资产独立审批 | 复用图片授权或让模型直接写表 | 本地资产变更与计费图片属于不同风险；代价是第二种 Owner grant 和审批记录 | 假模型提案时资产数量不变，Owner 批准后只提交一条；撤销授权后新提案拒绝 |
| 空轨道单分镜审批 | 让模型调用旧批量 Socket 写入 | 旧流程先写分镜再创建轨道，可能部分提交；先限制到已有空轨道和相同时长，代价是暂不支持多分镜分组与新建轨道 | 假模型提案时无分镜写入；Owner 决策单事务提交，关联失败整体回滚；浏览器待验收 |
| Video 准备与提交分离 | 将旧异步生成函数直接作为模型 Tool | 旧函数在落库后立即请求 Vendor，超时后的失败不等于无外部效果；代价是受控 Video 当前只有无副作用准备 | 假 Vendor 单测证明准备不写 Production Action/Generation Task、不提交 Vendor；异步检查中目标变化被拒 |
| Video 精确选型本地估算 | 从 Vendor Capability 推导价格或复用其他时长估算 | Capability 不是账单；Owner 只按当前 Project 和完整 output/audio 选型设置版本化费用上限，缺配置拒绝，代价是需要另行维护估算 | `videoQuotePolicy` SQLite 定向测试覆盖 Owner、revision、时长/画幅/音频隔离；Web 有当前无图文生视频选型设置控件和合约单测，浏览器未验收 |
| Video 批准与 Vendor 提交分离 | 批准时调用旧 `startVideoGenerationBatch` | 旧路径无法证明超时后供应商未接单；当前只持久化 Owner 的精确决策，保持 waiting/pending 且禁用 dispatch，代价是批准后仍需后续账本实现 | 3 个 SQLite 本地审批用例证明批准、拒绝和到期均无 ToolCall/GenerationTask/Video；认证路由无 execute |
| Video 独立请求意图账本 | 直接复用图片账本或失败时重新调用 Vendor | 图片账本含 Asset/Image 专属字段；视频必须绑定 Track/命令与独立 Provider 回执。落账后结果不明时拒绝重放，代价是暂不能自动恢复生成 | 3 个内部账本定向用例证明单次意图、重复不重发、恢复转 unknown；尚无真实 Vendor 调用 |
| Video 媒体观察与项目采纳分离 | 收到 base64 后立即标记生成成功 | 写文件可能失败或崩溃，迟到结果也不能自动覆盖 Project；先落媒体意图、读回验哈希，再等待独立提交 | 3 个 SQLite 媒体单测覆盖待写恢复、重复观察与取消后 late；提交事务另测 |
| Video 项目采纳单事务 | 文件写完即逐表更新成功状态 | Project Video、任务、修订、回执和 Run 必须同成同败；目标漂移或迟到不能自动采纳 | 3 个 SQLite 提交用例覆盖成功幂等、Prompt 漂移和 Revision 插入失败整体回滚；尚无真实 Vendor 组合 |
| Video 取消意图与本地停止分离 | 将取消点击视作供应商已撤销或把超时当作无费用失败 | 网络边界后的作用未知；先记录本地取消意图，再允许停止本地追踪，保留迟到 task/媒体证据且禁用采纳与重放 | 账本/媒体 11 个定向 SQLite 用例覆盖取消前后迟到、停止不重开、同请求不再生成新意图；尚无真实 Provider 取消确认 |
| Video Owner 状态快照从证据重建 | approved 后沿用纯审批 waiting/pending 假设 | 生成后 Run/Receipt 会进入终态，旧假设会阻断 inspect；按 ToolCall/请求/Artifact 重建，并防止 TTL 抹掉已有请求 | 5 个本地审批/投影 SQLite 用例覆盖请求、停止、成功和过期后查看；尚无 Web 执行入口 |
| Video Checkpoint 恢复按 scope 核对 | 将所有 Vendor 意图当图片请求校验 | Video 和 Image 共享 Checkpoint kind 但不同账本；按审批 scope 选择请求表，提交后核对 Project 媒体证据，避免重启误判腐坏 | Video 意图/提交定向恢复及相邻图片/通用恢复单测；跨进程和真实 Vendor 待 T21 |
| Video URL 媒体获取受限 | 复用旧工作台任意 URL 下载 | 外部 URL 不能决定服务端访问范围；仅显式 host allowlist、公开 IPv4 固定解析、HTTPS、无跳转、有限响应，代价是部分 CDN 需单独配置/验证 | 3 个 fake-network 单测覆盖白名单、私有/混合 DNS、格式拒绝；无真实 CDN 验收 |
| Video 重复执行先读原意图 | 每次都先重验当前 Track/Prompt | 首次成功本身会改变 Track，使合法重复请求误报版本冲突；认证后先核对原批准和请求身份，再仅为新意图重验 | fake Provider/SQLite 组合与账本用例覆盖成功后重复、超时后重复、TTL 后原意图；仍无真实 Provider 恰好一次保证 |
| Video HTTP 执行显式开关 | 将已批准自动等同可执行 | 计费提交需独立 Owner 操作及操作员部署开关；默认关闭，未知结果不自动重试，代价是仍需后续 Web/Provider 验收 | 3 个假 Runtime 路由用例覆盖默认关闭、认证 actor、409；真实成本和浏览器仍未验证 |
| Video 模型提案 grant 与执行权分离 | 生产角色自动拥有视频生成权 | `propose:track-video` 只允许提交候选且默认拒绝，Owner 版本化开启/撤销，不授予 `generate:track-video`；模型 Tool 已接入但不能自行批准或派发 | 授权/HTTP 定向用例及假模型/SQLite 链路覆盖撤销后拒绝、幂等子审批、批准后零 Vendor 请求；真实 Provider 待验收 |

## 自测与边界

- [ ] 口头画出模型提案、Owner 决策、Vendor 请求之间的三个权限边界。
- [ ] 解释相同操作重试为何不应多建子审批，改变目标为何要冲突。
- [ ] 指出伪造租约、撤销 grant、跨 Project Asset 分别在哪一层被拒绝。
- [ ] 明确区分“Run 成功回答”和“子审批已处理/图片已生成”；解释迟到图片为何只作为证据。
- [ ] 不把定向单测与 TypeScript 检查说成全量、浏览器或真实 Provider 验收。
- [ ] 说明派生资产的 `expectedVersion`、等价状态与目标状态哈希为何要在 Owner 批准时再校验。
- [ ] 说明分镜为什么限定空轨道、同一时长，以及本地事务能保证什么、不能保证什么。
- [ ] 说明 Video 的本地估算为何不等于 Vendor 报价，批准时还必须绑定 quote revision、命令与目标哈希。
- [ ] 解释 Video 审批 Run 的 waiting/pending 状态为何不能描述成已提交供应商，并指出后续 no-replay 请求账本缺口。
- [ ] 画出 Video 请求 unknown→取消意图→本地停止→迟到 task/媒体的状态时间线，说明每一步不能证明什么。

本阶段没有线上成本下降、成功率、延迟或真实生成质量数据；这些均为待测。T17 后续还要迁移多阶段生产 Step、批量分镜/轨道创建、批量图片和视频及完整 Web 状态投影，T21 才做最终系统验收。

旧批量图片 HTTP 入口补充：请求虽已登录，仍必须在预置图片占位和后台调用 Vendor 前核对 `req.user` 与 Project Owner；仅凭客户端 `projectId` 和 Asset 归属不足以授权计费。现在这条路由复用 Owner 检查，越权定向测试证明没有占位和 Vendor 请求；不代表所有旧图片路由完成授权审计，也不代表异步任务具备受控 ToolReceipt/未知结果恢复。
