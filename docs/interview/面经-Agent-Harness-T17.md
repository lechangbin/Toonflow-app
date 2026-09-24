# Agent Harness T17 面经：生产 Run 与计费提案（阶段版）

> 仅对应本分支已实现的局部链路。面试时明确说明旧生产 Socket、批量图片、视频、多分镜与新建轨道路径尚未迁移；单条空轨道分镜已具备受控提案与审批，但未通过浏览器验收。全量与真实 Provider 验收留到 T21。不给出未经测量的效果数字，也不代写简历。

## 一面：先把边界讲准

1. 问：T17 到底做完了什么？答：建立独立生产 Harness Run，冻结已发布 Skill，可通过受控 Tool 读取拍摄计划/分镜表文本，并在独立 grant 下分别提出单资产图片、派生资产和单条分镜候选。候选会创建待 Owner 审批子 Run；仅经独立批准的本地资产或分镜写入才算效果已提交，图片还需后续 Vendor 路径。追问“证据在哪”：看 `src/agentRuntime/index.ts`、`src/agents/productionAgent/harnessPreparation.ts`、`tests/productionHarnessRun.test.ts`。
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
8d. 问：Project Owner 怎么知道当前给模型开放了哪些能力？答：后端认证 Owner-only 的生产 grant 快照分别返回工作区读、图片、派生资产和单条分镜提案的 active/version；试用面板用当前版本提交明确的开启或撤销命令，遇到版本冲突只提示刷新，不自动覆盖别人的更新。开启提案能力仍不等于批准效果，模型还要绑定已发布 Skill，并在调用时通过当前 grant 与租约校验。证据：`src/skillRuntime/grants.ts`、`tests/productionHarnessGrants.test.ts`、Web 合约单测；尚无浏览器验收。
8e. 问：旧生产路径与 Harness 并行时，是否还存在“假成功”？答：存在，不能笼统说已迁移。审计发现旧 `add_flowData_storyboard` 将 Socket 写入排队后立即返回 `true`，即使之后回调报错。兼容层现等待回调，错误返回“结果不确定、人工核对、不自动重试”；定向测试覆盖确认和报错。但未解决断线无回调、进程崩溃、幂等与分镜写入持久回执，因此它只是避免一个明确的假成功，完整迁移仍在 T17 待办。证据：`src/agents/productionAgent/tools.ts`、`tests/productionLegacyStoryboardBoundary.test.ts`。
8f. 问：为什么收到前端回执仍不能宣称“分镜链路已可靠”？答：跨仓库核对发现前端原本先把分镜加入本地数组，再向后端写入；后端失败时本地界面可能显示未持久化的数据，且失败回执的字段与 App 检查的字段不一致。兼容修正让 Web 写入后重读服务端数据才确认，失败时只重读、不重发；App 将 `{success:false}` 视为不确定结果。单测覆盖回执与重读顺序，但旧后端批量写路由仍可能部分提交，断连也没有持久 ToolReceipt，所以必须继续迁移到受控分镜写入，不能把这次修正包装为端到端恰好一次。
8g. 问：为什么新分镜写入候选只允许已有空 Video Track 上的一条 Storyboard？答：旧批量路径把分镜插入、资产关联、分组和 Video Track 创建混在同一个前端驱动流程，任何后段失败都可能留下部分状态。先收敛为“空 Track、同一时长、一条分镜”，后端可独立验证 Project/Script/Asset 归属，并冻结精确 payload 与 Track 目标状态哈希。Owner 批准事务同时写入分镜与关联、回执、Checkpoint 和 Trace；关联失败全部回滚，目标变化转冲突，重复决策不再次写入。相关定向 SQLite 用例证明本地事务边界，但多分镜编排、轨道创建和浏览器验收尚未完成，不能据此声称分镜黄金链路完成迁移。证据：`src/controlledTools/storyboardWriteApproval.ts`、`tests/storyboardWriteApproval.test.ts`、ADR-0025。
8h. 问：模型为什么不能直接调用分镜审批接口？答：模型生成的内容只是候选，不代表 Project Owner 接受了对生产计划的更改。受控 Tool 只有提出候选的能力；后端在同一事务检查父 Run 的有效租约、冻结 Skill 申请、当前 Owner grant 与权限判定，才创建待审子 Run。独立的认证 Owner HTTP 命令按版本批准，提交前再次核对目标状态。假模型测试证明提案后分镜表仍为空、撤销授权后新提案拒绝、伪造围栏被拒；这证明本地权限与事务链路，不是浏览器或跨进程故障验收。证据：`src/skillRuntime/grants.ts`、`src/controlledTools/storyboardWriteApproval.ts`、`tests/productionHarnessRun.test.ts`。
8i. 问：旧 Socket 前端一直不回调怎么办？答：兼容路径设定有限等待时间，超时只表示无法确认写入结果，返回“需人工核对、不要自动重试”，不会把排队或断连解释为成功或明确失败。即使收到回调，也必须是显式 `{success:true}` 才算确认；旧格式或无结构回执同样转为结果不确定。迟到回调不能触发再次提交。定向测试用短计时器验证无回调能退出且只发送一次；生产默认等待 20 秒。该措施避免调用无限悬挂，却不解决旧后端部分提交、崩溃恢复或跨进程对账，最终仍要用持久审批与回执替换旧路径。证据：`src/agents/productionAgent/tools.ts`、`tests/productionLegacyStoryboardBoundary.test.ts`。
8j. 问：为什么不直接把现有视频生成函数暴露给模型？答：它虽然有统一的 Video Capability、Prompt Revision 和 Generation Task，但当前手动路由会立即发起异步供应商调用，超时或断线后的“失败”不能证明供应商未接单或未计费，也缺少 Agent Run 的批准、提交意图和未知结果防重放证据。模型可伪造来源字段的风险也先在 HTTP 入口收紧：浏览器只能提交用户来源，不能自称 Project Agent。路由定向测试证明伪造来源未触达编排，正常用户路径仍可进入；这不是视频生成已迁移的证据。后续需先形成可恢复的授权与 Vendor 请求账本，再接模型 Tool。证据：`src/video/production.ts`、`tests/videoWorkbenchOriginBoundary.test.ts`、`docs/agents/video-generation.md`。
8k. 问：为什么受控 Video 候选先只支持 text-to-video？答：单轨道文本生视频只需要冻结现有 Track 选型和 active Prompt Revision，尚不涉及浏览器上传路径、图片读取或多关键帧跨 Project 归属。候选预检会确认 Project/Script/Track 归属、选型一致、没有已有 Video，并把 Prompt Revision 的 brief、draft 和渲染文本哈希纳入目标状态；如果人工修改 Prompt 或 Track，后续审批可按哈希拒绝旧候选。三个 SQLite 定向测试覆盖跨 Project、已有 Video、媒体输入拒绝及状态漂移，但这只是无副作用的预检，尚无审批、Vendor 能力复核、提交意图或未知结果恢复。不能对面试官说“已完成视频生成 Agent 化”。证据：`src/controlledTools/videoGenerationProposalContract.ts`、`tests/videoGenerationProposalContract.test.ts`、ADR-0026。
8l. 问：既然受控候选尚未接图片输入，为什么还要修旧 Video 的图片解析？答：旧手动单条/批量路由仍可真实调用 Vendor；原代码只用 Storyboard 或 Asset ID 取图片，上传路径也直接读，遗漏当前 Project/Script 边界。现在编排解析引用时，Storyboard 必须属于当前 Project/Script，Asset 必须属于当前 Project 且直接属于或显式关联当前 Script，上传路径必须在本 Project/Script 的视频输入命名空间。定向 SQLite 测试验证跨 Project、跨 Script、路径穿越均在读取图片前拒绝，同时原文生视频假供应商编排回归通过。该修正只封住图片引用边界，不代表手动路由具备完整 Owner 授权或 Agent 恰好一次计费能力。证据：`src/video/inputResolution.ts`、`tests/videoInputScope.test.ts`、`src/video/production.ts`。
8m. 问：工作台已有 JWT，为什么还要单独核对 Owner？答：JWT 只能证明是谁发起请求，不证明此人可以操作请求体里指定的 Project。五个生成或更新 Prompt/Video 的路由和 Video 输入上传路由现在使用 token 中的 actor ID 核对目标 Project Owner；批量 Prompt 对全部目标 Project 先完成核对，避免同一批次前几项已写、后几项才发现越权。定向测试让用户 1 请求用户 2 的 Project，六个入口都在调用底层编排或写入前返回 403，缺失 actor 也被拒。这是手动兼容入口的权限补丁；其他工作台路由仍需独立审计，Agent 提案还要冻结 Skill/grant、Owner 审批与可恢复 Vendor 账本。证据：`src/video/workbenchOwner.ts`、`tests/videoWorkbenchOriginBoundary.test.ts`。

## 三面：反例、取舍与未完成项

9. 问：为什么暂不把生产 Agent 宣称为“可恢复生成工作流”？答：目前持久 Run 承载指导、单资产图片提案、派生资产和单条空轨道分镜的受控审批；旧 Socket 的批量图片、视频、多分镜与轨道创建还没有统一 typed Steps、幂等效果和恢复投影。声明整个生产链路已迁移会混淆局部审批成功与真实生成成功。
10. 问：若要继续推进，优先顺序是什么？答：先为各生产效果定义独立 typed Step/Tool 和可验证输入、效果账本及 Owner 授权；再把批量图片、分镜/资产写入和视频逐条迁移并保留兼容回退；最后做跨进程重启、迟到结果、Web 状态和真实 Provider 验收。不能为了赶进度复用“模型回答成功”作为效果完成信号。

## 练习与证据缺口

自测时画两条时间线：A）模型提案→Owner 拒绝，B）模型提案→Owner 批准→Vendor 提交结果未知；分别标出 Run 状态和每一步的权限主体。当前可核验的是本轮定向单测、局部假 Provider 成功路径与 TypeScript 检查；尚无浏览器、真实供应商、完整回归或线上指标。每个回答如需提数字，必须先找到对应测试/日志/报告，找不到就说“待测”。
