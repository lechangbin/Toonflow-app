# Agent Harness T17 · 生产生成迁移（阶段进度）

Issue：`lechangbin/Toonflow-app#73`。本分支堆叠在尚未完成端到端验收的 T16 上；目前有生产指导 Run、工作区读取、单资产图片/派生资产/单分镜受控提案，以及无副作用的单轨道 Video 候选预检；不是生产 Agent 生成黄金链路迁移完成。阶段源码导学与追问见 `docs/interview/导学-Agent-Harness-T17.md`、`docs/interview/面经-Agent-Harness-T17.md`；简历由用户自行完成。

## 本次改动

- 为 `productionAgent` 定义独立 `get_production_workspace_text` Tool v1，限定 `production-harness-v1` scope 与 `read:production-workspace` 能力；仅允许读取单个剧本的 `scriptPlan` 或 `storyboardTable`，不包含资产数组、图片生成、分镜写入或旧 Socket 回调。
- 后端适配器同时核对 `o_script` 的 Project 归属与 `o_agentWorkData` 的 Project/剧本/生产 Agent 键；工作区重复行、无效 JSON、过大文本、安全文本不合规时拒绝，缺失工作区只返回空草稿字段。受控 Tool Runtime 仍要求 Run 状态、租约、冻结 Skill 请求与授权交集，不能仅凭模型指令调用。
- Script Harness 的模型 Tool 契约改为显式四项既有只读 Tool（外加原有可选提案 Tool），不会因生产 Tool 加入共享目录而把生产 Tool 当成 Script 可见能力；Script 路由和准备的定向回归继续通过。
- 生产读取另设 `read:production-workspace` Project grant，只有认证 Owner 能按版本开启/撤销；解析时仍检查 Run 为 production 角色与 scope。Script grant 解析器对生产 Tool 明确拒绝，避免新 Tool 因默认分支误映射为 `read:script`。
- 新增显式启用的生产指导 Run：独立 production 角色/scope、Vendor 逻辑目标和系统契约；Run 创建事务先核对 Project Owner，再路由并冻结唯一已发布 Skill。上下文包含冻结 Skill，执行沿用既有租约、Checkpoint、Trace、ToolReceipt 与 PermissionDecision。HTTP 入口提供 start/inspect/list/cancel，认证 actor 来自中间件；运行时本身也阻止跨 scope inspect/cancel。旧生产 Socket 生成仍保持原样。
- 在该 Run 中增加 `propose_asset_image_generation` 模型 Tool。Skill 必须同时请求 Tool 与 `propose:billable-image`，Owner 必须显式开启独立 Project grant；模型只能创建 T09 单资产计费图片的 pending 子审批 Run，不能批准、提交 Vendor 或直接产生图片。父 Run 的租约、身份、冻结 Skill、当前 grant、权限判定与 Tool 合约在子 Run 创建事务中核验；子 Run 冻结父 Run、操作和 Skill 关联，读取时复核 Tool 合约、冻结 Skill Revision、判定哈希与操作对应关系。相同操作使用确定性请求键，变更目标发生冲突；撤销 grant 后新提案拒绝。设计决策见 `docs/adr/0023-production-agent-image-proposal-boundary.md`。
- 增加 Owner-only 的 `/api/agentRuns/productionHarness/effects` 只读投影：先按 Project/角色/scope 核对父 Run，再读取至多 50 条有哈希的模型提案权限判定，以父 Run + 操作 ID 定位子 Run，复用 T09 inspect 验证来源并投影审批、VendorRequest 和 Artifact 摘要。被拒绝提案单独标记 denied；缺子 Run、哈希或来源不一致时整体失败，不用模型自然语言推断生成状态。HTTP 认证 actor 不接受请求体伪造。
- 新增 `propose_derived_asset_write` 模型 Tool，复用 T08 的派生资产精确审批而非直接写资产。独立 `propose:derived-asset` Owner grant 默认拒绝、按版本修改；同一事务核对父 Run 有效租约、Owner、冻结 Skill/Tool/能力交集与权限判定，子 Run 冻结来源并在 inspect 复核。相同父操作幂等，变更 payload 冲突；模型提案时资产表无变化，Owner 批准后 T08 才提交一次。新增路由 `/api/agentRuns/setProposeDerivedAssetGrant`；设计见 `docs/adr/0024-production-agent-derived-asset-proposal-boundary.md`。Owner-only T08 快照在合约、哈希、预览与 Receipt 绑定都通过时返回待审完整 payload；损坏证据不展示该 payload。父 Run 的 `/effects` 另投影 `derivedEffects`，Web Draft PR #8 在试用面板展示完整待审载荷和版本化 Owner 决策。未做浏览器验收。
- 保留现有生产 Socket 路径，不在未迁移的分镜/资产工具上伪造持久 Run 成功状态。当前 Run 可以形成待 Owner 审批的单资产图片意图，但不承载已完成生成效果。
- 配套 Web Draft PR `lechangbin/Toonflow-web#8` 增加显式试用的生产持久 Run 面板：HTTP start/inspect/list/cancel/effects 读服务端快照；模型聊天文本不决定图片效果状态。Owner 在该面板可批准/拒绝提案，批准范围后还需第二次明确确认才提交一次 Vendor 请求；取消、媒体修复和人工核对仍在资产面板。Web 分支的 3 个定向契约用例与非声明式 Vue 类型检查通过；常规声明式类型构建在共享依赖工作树因既有 Socket 类型 TS2742 失败，浏览器验收留到 T21。旧 Socket 仍并行，不能声称已完成 T18 兼容迁移。

## 定向验证与剩余边界

`tests/productionHarnessWorkspaceRead.test.ts` 覆盖独立 Tool 修订/角色/scope、跨 Project 剧本拒绝、重复行拒绝、缺失草稿、无效 JSON、超长内容和提案 Tool 风险声明。`tests/productionHarnessGrants.test.ts` 覆盖默认拒绝、非 Owner 拒绝、版本冲突、撤销、Script 授权隔离和 HTTP actor 来源，新增派生资产提案授权隔离。`tests/productionHarnessRun.test.ts` 用假模型验证 Skill 冻结、读取、图片及派生资产提案、权限判定、授权撤销后拒绝、同操作幂等，以及派生资产提案后无写入、Owner 批准后只写一次。两条独立图片 Asset 分支在同一父 Run 下测试：一条经 Owner 批准、假 Image Provider、T09 请求账本与 Artifact/Asset 提交成功；另一条模拟供应商超时，记为 unknown 且重复执行不再次调用 Provider，取消后迟到图片只保留证据、不链接 Asset。效果投影单测分别核对图片成功、拒绝、迟到及非 Owner 不可读，路由单测核对 actor 来源。生产 Run 的定向恢复测试分别验证模型调用意图前中断只新增继任 Attempt、不自动调用模型，以及调用意图后租约到期被停放、迟到模型结果不能重启 Run；这是同进程数据库恢复函数测试，不等于真实杀进程或跨进程接管验收。本轮新增与直接相关的 `derivedAssetWrite`、生产 grant、生产 Run 共 17 个定向用例通过；修正一条旧测试中跨 scope 的 Inspector 假设，改由 T08 Inspector 重投影审批。`yarn lint`（TypeScript `--noEmit`）通过。这不视作全量验收；未运行构建、浏览器或真实 Provider。

待完成：把生产生成效果表达为父 Run 可恢复的 typed Steps、多阶段模型与 Vendor 组合、分镜/资产写操作审批和回执、批量图片与视频生成迁移、真实进程重启/跨进程租约接管/迟到结果的跨边界恢复，以及 Web 状态投影和兼容回退。当前只有经 Owner 批准的单资产图片子 Run 可以沿 T09 路径提交并关联 Artifact；本地假 Provider 测试覆盖 unknown、禁止重放与迟到证据，但不证明真实供应商行为。父指导 Run 本身不能自行批准或提交计费请求，更不能把待审批意图描述成已生成图片、视频或分镜效果；不得描述为生产生成黄金链路迁移完成。

补充定向验证：派生资产完整 payload 与父 Run `derivedEffects` 投影接入后，最近一次只运行直接相关的 18 个 App 用例和 4 个 Web 合约用例，均通过；App TypeScript 与 Web 非声明式 Vue 类型检查通过。前文 17 个是上一个切片的结果，不代表全量回归。以上均未覆盖浏览器、真实 Provider 或完整测试套件。

授权操作补充：`/api/agentRuns/getProductionGrants` 仅向认证 Owner 返回生产工作区读取、计费图片提案、派生资产提案三项 grant 的 active/version 快照；Web 试用面板按版本显式开启或撤销各项能力，409 冲突不自动重试。Owner 隔离与认证 actor 的定向测试通过；这只是可操作的授权入口，不扩大模型的写入或 Vendor 权限。

旧路径兼容边界补充：`add_flowData_storyboard` 原来在 Socket 回调前立即返回 `true`，把“已排队”误作提交成功。现在等待前端回调后才返回确认；回调错误按结果不确定提示人工核对，不自动重试。2 个定向单测验证确认与错误，TypeScript 检查通过。此修正没有把分镜写入迁到受控 Tool，也没有解决无回调挂起、崩溃恢复或幂等提交；旧路径仍属待迁移风险。

跨仓库兼容修正：Web 旧 Socket 处理器原本在后端写入前先追加本地分镜，且失败回执为 `{success:false}`；App 之前只识别 `error` 字段，仍可能把失败当成功。现在 App 同时拒绝 `success:false`，Web 在写入与后端重读都完成后才回确认，失败时最多重读一次、不重发写入、不乐观追加本地分镜。App 与 Web 各 3 个定向单测及各自无输出类型检查通过。它仍不是持久分镜 Tool，后端批量分镜路由的部分提交风险未消除。

分镜受控写入第一切片：新增 `storyboardWriteContract.ts`，只接受已存在 Video Track 上的单条 Storyboard 候选，验证 Project/Script/Track/Asset 归属、内容长度、Asset ID 去重以及 Track 未选择 Video；冻结 payload 与相关目标状态哈希，不产生写入。3 个 SQLite 定向用例和 App TypeScript 检查通过。设计见 ADR-0025。尚无待审 Run、Owner 批准或分镜提交事务，不能说分镜已迁移。

分镜受控写入第二切片：进一步要求 Track 为空且时长与候选相同；内部 Owner-local 审批 Runtime 已能冻结待审 Run，并在批准事务中复核目标后原子写入 Storyboard、Asset 关联、ToolReceipt、Output、Checkpoint 和 Trace。重复提案/决策读取原有证据，目标漂移转冲突，断线检查可使超时审批落账而不重放写入。9 个相关 SQLite 定向用例和 App TypeScript 检查通过，包括关联表失败时整体回滚。该 Runtime 尚未开放 HTTP、模型 Tool 或 Web UI；旧 Socket 路径仍并行，不能称分镜黄金链路完成迁移。上一段的“尚无待审 Run/提交事务”是第一切片时点记录，现由本段更新。

分镜受控写入第三切片：`propose_storyboard_write` 已接入生产 Harness 模型 Tool 目录。冻结 Skill 同时请求 Tool 与 `propose:storyboard` 能力，认证 Owner 单独按版本开启 Project grant 后，父 Run 有效租约和权限交集才允许建待审子 Run；模型没有审批权。子 Run 冻结父 Run、操作、Skill 与提案合约，检查时复核来源；父 Run `/effects` 从持久权限判定与子 Run 重建 `storyboardEffects`。Owner-only `/api/agentRuns/storyboardWriteApproval` 提供 propose/inspect/decide，Web 试用面板展示完整待审载荷和版本化批准/拒绝。启动恢复与重新检查会结算过期审批，不重放分镜写入。最近一次仅运行相关 24 个 App 定向用例（含数据库 readiness）、6 个 Web 合约用例和两侧无输出类型检查，均通过；未运行全量套件、构建、浏览器或真实 Provider。旧 Socket 批量分镜、轨道创建、批量图片和视频仍未迁移，T17 未完成。前两段是历史切片记录，其“尚未开放”状态由本段更新。

旧 Socket 无回调补充：旧 `add_flowData_storyboard` 的浏览器回调现在有 20 秒上限，并且只接受显式 `{success:true}`；超时或旧格式回执归为“结果不确定、人工核对、不自动重试”，迟到回调不会重发写入。5 个该边界的定向单测和 App 类型检查通过。计时器只能避免永远悬挂，不能证明后端没有部分写入，也不是可恢复 ToolReceipt。

生产模型系统契约同步升为 `toonflow.production-harness-guidance.v2`：明确区分受控指导、模型候选、Owner 批准和效果提交，列出目前三类模型提案；不再把已有提案能力描述成纯只读。生产模型仍不得声称待审请求已经生成或保存。相关生产 Run 定向用例及类型检查通过；没有改变旧 Socket 生成行为。

Video 起点边界：审查共享 `startVideoGenerationBatch` 后确认现有手动 HTTP 路由会直接进入异步 Vendor 调用，异常被记录为失败，尚无 T09 式“提交可能已发生”的防重放账本。因此本阶段不把它包装为模型 Tool；先收紧单条/批量视频生成、单条/批量 Prompt 生成与人工 Prompt Revision 共五个工作台路由，只允许 `requestedBy: "user"`（缺省为 user），浏览器不能自称 `project-agent`。共享生产模块仍保留可信调用者的 `project-agent` 类型，供未来受控编排复用。两个定向路由用例验证伪造来源在触达生成编排或 Prompt 写入前被拒，正常用户请求仍通过；另有旧 Socket 回调和生产 Run 相关五例、App 类型检查通过。这只是来源防伪接缝，不等于 Owner 授权；视频生成的持久审批、未知结果恢复和真实 Provider 验收仍待完成。

受控 Video 候选第一切片：`videoGenerationProposalContract.ts` 仅冻结 Project/Script/现有 Video Track 的单轨道 text-to-video 候选；要求当前 Track 选择与候选一致、选中的是该 Track 的 active Prompt Revision、尚无已有 Video，且不接受上传路径或图片输入。摘要与目标状态哈希可供下一步审批前复核，但此阶段不建待审 Run、不请求 Vendor、不创建 Production Action/Generation Task，也不检查 Vendor 当前 Capability。3 个 SQLite 定向用例和 App TypeScript 检查通过，覆盖跨 Project、已有 Video、非文本输入、Prompt Revision 与选型漂移、损坏的持久 JSON。设计见 ADR-0026；不得称其为视频生成迁移完成。

旧 Video 图片输入归属修正：原共享编排按 Storyboard/Asset ID 直接找图片，上传路径直接读取，未绑定当前 Project/Script。现在解析 Storyboard 时核对 Project/Script，解析 Asset 时核对 Project 及该 Script 的直接归属或显式关联，上传路径只接受本 Project/Script 下的 `video-inputs` 命名空间和安全文件名；不合范围在读取图片字节、创建 Production Action 或调用 Vendor 前拒绝。3 个独立 SQLite 归属用例与 2 个原视频编排定向用例、App TypeScript 检查通过；这不解决 HTTP Owner 授权、上传文件的内容来源证明或 Vendor 未知结果恢复。

## 阶段追问准备（非最终面经）

1. 问：为什么生产工作区读取不能继续让前端 `getFlowData` 回调负责？答：旧工具通过 Socket 回调从前端得到数据，模型侧请求与实际读到的 Project/剧本数据缺少后端一致的授权、回执和恢复身份。新接缝把剧本归属与工作区行的 Project、剧本键在后端核对，并给 Tool 固定修订、scope 和能力；测试证明跨 Project ID 与重复行不会返回内容。它已接上只读生产 Run，但尚未替代旧生成工具。
2. 问：为何先只读两个文本字段？答：分镜/资产数组含写入、引用资源和付费生成状态，不能混入一个宽泛的“获取工作区”Tool。把拍摄计划与分镜表收敛为有大小上限的只读文本，后续写入和生成必须分别定义审批、幂等、对账契约。测试中的非法 `assets` 键被输入 schema 拒绝。
3. 问：如何处理旧表没有唯一约束的重复数据？答：读取最多两行，若超过一行就失败，不取偶然的第一行。否则不同数据库查询顺序可能让同一 Run 看到不同版本的工作区；单元测试插入重复行后确认失败。持久生成效果的并发约束仍待后续迁移。
4. 问：为何生产读取不能复用 Script 的 `read:script` 授权？答：两种角色的用途与可见数据不同，且该 Tool 读取的是生产 Agent 工作区，不是剧本正文。独立 capability 由 Owner 版本化管理，生产 Run、角色与 Tool 定义同时要求它；Script 解析器收到生产 Tool 直接报错。测试证明默认没有 grant、撤销后再次解析为空、HTTP 请求体里的 actor 无法替代认证用户。
5. 问：已经有生产 Run，是否意味着图片/视频生成迁移完成？答：没有。当前 Run 能输出生产建议、读取拍摄计划/分镜表文本，并为单资产图片创建待 Owner 审批的意图；不能创建资产、提交分镜或自行请求付费供应商。假模型测试证明父 Run/Skill/Tool/权限/子审批这条局部链路可用；旧 Socket 生成仍独立。不能把文字回复或待审批意图视为生成完成。
6. 问：如何防止新生产入口影响旧 Script Run？答：两个 Runtime 实例分别固定 role/scope、逻辑模型目标和模型可见 Tool 目录；inspect/cancel 在 Runtime 内要求 scope 匹配，路由层再次核对。测试使用生产入口尝试取消 Script Run 时 404 且未调用 cancel；Script Runtime 也不能读取生产 Run。这样并行迁移期间不会因共享表而跨角色控制。
7. 问：为什么模型的图片 Tool 只做提案，不能复用 Owner 批准接口？答：模型可以建议目标，但不代表 Project Owner 承担费用。提案复用 T09 的单资产预检和待审批账本；只有认证 Owner 的后续批准能推进供应商提交。假模型测试在提案后检查 VendorRequest 为零，撤销 grant 后第二次提案被拒绝。
8. 问：如何证明子审批确实来自那次受权模型调用？答：创建事务先校验父 Run 正在运行、租约有效、actor 属于 Owner、冻结 Skill 请求了 Tool/能力且当前 grant 仍允许，然后持久化同操作的权限判定和子 Run 来源。检查子审批时再复核父 Run、权限判定哈希与审批操作 ID；数据库禁止改写审批绑定。这是本地持久证据链，不等于已经验收跨进程篡改或真实供应商回调。
9. 问：如果同一模型 Tool 操作重试或 Owner 撤销授权，会不会重复计费？答：相同父 Run 与操作 ID 生成确定性请求键，子 Run 的请求指纹约束目标；改变目标会冲突，当前 grant 撤销会拒绝新提案。提案本身不触发计费，真正的提交由 T09 Owner 审批与 Vendor ledger 控制，未知提交结果不会自动重发。定向测试只证明本地假模型/假报价条件下的行为，真实 Provider 对账留待 T21。
