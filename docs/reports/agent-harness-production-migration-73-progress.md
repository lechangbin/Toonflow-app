# Agent Harness T17 · 生产生成迁移（阶段进度）

Issue：`lechangbin/Toonflow-app#73`。本分支堆叠在尚未完成端到端验收的 T16 上；以下是生产只读指导 Run、工作区读取和单资产计费图片提案接缝，不是生产 Agent 生成黄金链路迁移完成。

## 本次改动

- 为 `productionAgent` 定义独立 `get_production_workspace_text` Tool v1，限定 `production-harness-v1` scope 与 `read:production-workspace` 能力；仅允许读取单个剧本的 `scriptPlan` 或 `storyboardTable`，不包含资产数组、图片生成、分镜写入或旧 Socket 回调。
- 后端适配器同时核对 `o_script` 的 Project 归属与 `o_agentWorkData` 的 Project/剧本/生产 Agent 键；工作区重复行、无效 JSON、过大文本、安全文本不合规时拒绝，缺失工作区只返回空草稿字段。受控 Tool Runtime 仍要求 Run 状态、租约、冻结 Skill 请求与授权交集，不能仅凭模型指令调用。
- Script Harness 的模型 Tool 契约改为显式四项既有只读 Tool（外加原有可选提案 Tool），不会因生产 Tool 加入共享目录而把生产 Tool 当成 Script 可见能力；Script 路由和准备的定向回归继续通过。
- 生产读取另设 `read:production-workspace` Project grant，只有认证 Owner 能按版本开启/撤销；解析时仍检查 Run 为 production 角色与 scope。Script grant 解析器对生产 Tool 明确拒绝，避免新 Tool 因默认分支误映射为 `read:script`。
- 新增显式启用的生产指导 Run：独立 production 角色/scope、Vendor 逻辑目标和系统契约；Run 创建事务先核对 Project Owner，再路由并冻结唯一已发布 Skill。上下文包含冻结 Skill，执行沿用既有租约、Checkpoint、Trace、ToolReceipt 与 PermissionDecision。HTTP 入口提供 start/inspect/list/cancel，认证 actor 来自中间件；运行时本身也阻止跨 scope inspect/cancel。旧生产 Socket 生成仍保持原样。
- 在该 Run 中增加 `propose_asset_image_generation` 模型 Tool。Skill 必须同时请求 Tool 与 `propose:billable-image`，Owner 必须显式开启独立 Project grant；模型只能创建 T09 单资产计费图片的 pending 子审批 Run，不能批准、提交 Vendor 或直接产生图片。父 Run 的租约、身份、冻结 Skill、当前 grant、权限判定与 Tool 合约在子 Run 创建事务中核验；子 Run 冻结父 Run、操作和 Skill 关联，读取时复核哈希与操作对应关系。相同操作使用确定性请求键，变更目标发生冲突；撤销 grant 后新提案拒绝。设计决策见 `docs/adr/0023-production-agent-image-proposal-boundary.md`。
- 保留现有生产 Socket 路径，不在未迁移的分镜/资产工具上伪造持久 Run 成功状态。当前 Run 可以形成待 Owner 审批的单资产图片意图，但不承载已完成生成效果。

## 定向验证与剩余边界

`tests/productionHarnessWorkspaceRead.test.ts` 覆盖独立 Tool 修订/角色/scope、跨 Project 剧本拒绝、重复行拒绝、缺失草稿、无效 JSON、超长内容和提案 Tool 风险声明。`tests/productionHarnessGrants.test.ts` 覆盖默认拒绝、非 Owner 拒绝、版本冲突、撤销、Script 授权隔离和 HTTP actor 来源。`tests/productionHarnessRun.test.ts` 用假模型验证 Skill 冻结、读取和图片提案、权限判定、伪造租约拒绝、授权撤销后拒绝、无 Vendor 请求、审批绑定不可变、Owner 隔离、入队取消与幂等重试。T09 审批/路由测试作为相关回归；本次 11 个定向用例通过，`yarn lint`（TypeScript `--noEmit`）通过，不视作全量验收。未运行全量测试、构建、浏览器或真实 Provider。

待完成：生产生成专属 typed Steps、多阶段模型与 Vendor 组合、分镜/资产写操作审批和回执、批量图片与视频生成迁移、派生状态因果 Trace、真实重启/租约/迟到结果的跨边界恢复，以及 Web 状态投影和兼容回退。现有 Run 不能自行批准或提交计费请求，更不能把待审批意图描述成已生成图片、视频或分镜效果；不得描述为生产生成黄金链路迁移完成。

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
