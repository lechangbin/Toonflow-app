# Agent Harness T17 · 生产生成迁移（阶段进度）

Issue：`lechangbin/Toonflow-app#73`。本分支堆叠在尚未完成端到端验收的 T16 上；以下是生产只读指导 Run 与工作区读取接缝，不是生产 Agent 生成黄金链路迁移完成。

## 本次改动

- 为 `productionAgent` 定义独立 `get_production_workspace_text` Tool v1，限定 `production-harness-v1` scope 与 `read:production-workspace` 能力；仅允许读取单个剧本的 `scriptPlan` 或 `storyboardTable`，不包含资产数组、图片生成、分镜写入或旧 Socket 回调。
- 后端适配器同时核对 `o_script` 的 Project 归属与 `o_agentWorkData` 的 Project/剧本/生产 Agent 键；工作区重复行、无效 JSON、过大文本、安全文本不合规时拒绝，缺失工作区只返回空草稿字段。受控 Tool Runtime 仍要求 Run 状态、租约、冻结 Skill 请求与授权交集，不能仅凭模型指令调用。
- Script Harness 的模型 Tool 契约改为显式四项既有只读 Tool（外加原有可选提案 Tool），不会因生产 Tool 加入共享目录而把生产 Tool 当成 Script 可见能力；Script 路由和准备的定向回归继续通过。
- 生产读取另设 `read:production-workspace` Project grant，只有认证 Owner 能按版本开启/撤销；解析时仍检查 Run 为 production 角色与 scope。Script grant 解析器对生产 Tool 明确拒绝，避免新 Tool 因默认分支误映射为 `read:script`。
- 新增显式启用的生产只读指导 Run：独立 production 角色/scope、Vendor 逻辑目标和系统契约；Run 创建事务先核对 Project Owner，再路由并冻结唯一已发布 Skill。模型只看到生产工作区文本 Tool；上下文包含冻结 Skill，执行沿用既有租约、Checkpoint、Trace、ToolReceipt 与 PermissionDecision。HTTP 入口提供 start/inspect/list/cancel，认证 actor 来自中间件；运行时本身也阻止跨 scope inspect/cancel。旧生产 Socket 生成仍保持原样。
- 保留现有生产 Socket 路径，不在未迁移的分镜/资产工具上伪造持久 Run 成功状态。当前 Tool 契约是后续迁移的后端读取边界，尚无生产 Harness Run 创建与模型接线。

## 定向验证与剩余边界

`tests/productionHarnessWorkspaceRead.test.ts` 覆盖独立 Tool 修订/角色/scope、跨 Project 剧本拒绝、重复行拒绝、缺失草稿、无效 JSON 与超长内容。`tests/productionHarnessGrants.test.ts` 覆盖默认拒绝、非 Owner 拒绝、版本冲突、撤销、Script 授权隔离和 HTTP actor 来源。`tests/productionHarnessRun.test.ts` 用假模型验证 Skill 冻结、生产 Tool 调用、权限判定与成功回执、Owner 隔离、入队取消与幂等重试；`tests/productionHarnessRoutes.test.ts` 验证 HTTP actor 不能从请求体伪造、不能经生产入口取消 Script Run。生产相关 6 个定向用例及 Script 准备/路由 2 个相关回归通过，`yarn lint`（TypeScript `--noEmit`）通过。未运行全量测试、构建、浏览器或真实 Provider。

待完成：生产生成专属 typed Steps、多阶段模型与 Vendor 组合、写操作审批/回执、付费生成对账、派生状态因果 Trace、真实重启/租约/迟到结果的跨边界恢复，以及 Web 状态投影和兼容回退。现有只读指导 Run 不能产生图片、视频或分镜效果，不得描述为生产生成黄金链路迁移完成。

## 阶段追问准备（非最终面经）

1. 问：为什么生产工作区读取不能继续让前端 `getFlowData` 回调负责？答：旧工具通过 Socket 回调从前端得到数据，模型侧请求与实际读到的 Project/剧本数据缺少后端一致的授权、回执和恢复身份。新接缝把剧本归属与工作区行的 Project、剧本键在后端核对，并给 Tool 固定修订、scope 和能力；测试证明跨 Project ID 与重复行不会返回内容。它还没有接上生产 Run，不能称完整替代。
2. 问：为何先只读两个文本字段？答：分镜/资产数组含写入、引用资源和付费生成状态，不能混入一个宽泛的“获取工作区”Tool。把拍摄计划与分镜表收敛为有大小上限的只读文本，后续写入和生成必须分别定义审批、幂等、对账契约。测试中的非法 `assets` 键被输入 schema 拒绝。
3. 问：如何处理旧表没有唯一约束的重复数据？答：读取最多两行，若超过一行就失败，不取偶然的第一行。否则不同数据库查询顺序可能让同一 Run 看到不同版本的工作区；单元测试插入重复行后确认失败。持久生成效果的并发约束仍待后续迁移。
4. 问：为何生产读取不能复用 Script 的 `read:script` 授权？答：两种角色的用途与可见数据不同，且该 Tool 读取的是生产 Agent 工作区，不是剧本正文。独立 capability 由 Owner 版本化管理，生产 Run、角色与 Tool 定义同时要求它；Script 解析器收到生产 Tool 直接报错。测试证明默认没有 grant、撤销后再次解析为空、HTTP 请求体里的 actor 无法替代认证用户。
5. 问：已经有生产 Run，是否意味着图片/视频生成迁移完成？答：没有。当前 Run 只有一个受控只读模型 Step，能输出生产建议并读取拍摄计划/分镜表文本，不创建资产、提交分镜或请求付费供应商。假模型测试证明 Run/Skill/Tool/权限/回执这条基础链路可用；旧 Socket 生成仍独立。付费请求必须另外定义提交意图、幂等对账、迟到结果和 Artifact 因果链，不能把文字回复视为生成完成。
6. 问：如何防止新生产入口影响旧 Script Run？答：两个 Runtime 实例分别固定 role/scope、逻辑模型目标和模型可见 Tool 目录；inspect/cancel 在 Runtime 内要求 scope 匹配，路由层再次核对。测试使用生产入口尝试取消 Script Run 时 404 且未调用 cancel；Script Runtime 也不能读取生产 Run。这样并行迁移期间不会因共享表而跨角色控制。
