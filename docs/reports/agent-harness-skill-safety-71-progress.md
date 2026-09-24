# Agent Harness T15 · Skill 安全解析（阶段进度）

Issue：`lechangbin/Toonflow-app#71`。本分支以 T14 Skill 基础为父，并本地合入尚未验收的 T13 Project Memory 基础；GitHub PR 尚未合并。这里记录的是依赖、权限、资源和路由的第一组拒绝边界，不代表完整 T15 或 T21 验收。

## 已实现

- 集成分支保留 T13/T14 的 Project Memory 与 Skill Definition/Revision/Binding 两套领域边界，手工合并了表定义、触发器与生成类型。合并后 7 个定向回归及 TypeScript 检查通过。
- 已发布 Skill 的精确依赖解析按稳定 ID 排序，以深度优先形成确定性的依赖先于使用者顺序；缺失、哈希损坏、循环、版本冲突、角色不兼容或过大图均拒绝。根 Skill 使用当前激活 Revision，依赖使用 manifest 指定的精确语义版本，不能随绑定指针漂移。
- Tool 权限决策把 Skill 的 Tool/Capability 请求与平台、Project、Run、角色四层 grant 逐项求交，并返回缺失层；Skill 请求本身不会增加任何 grant。审批与 Tool Runtime 的真实效果授权仍在其原有边界，当前这里只证明纯决策规则。
- 资源必须在草稿阶段按 manifest 中的资源 ID、媒体类型与内容哈希注册，发布时检查声明集合完整且内容未损坏；Run 只能凭 Project 范围及冻结的 SkillRevision 绑定按资源 ID 加载，不接受运行时任意路径。资源正文由独立不可变 ResourceRevision 表存储。
- 路由先按角色和显式意图过滤，再按优先级、关键词命中数与稳定 Skill ID 排序；最高优先级与命中数并列时返回 `needs-attention`、不自动选择。结果保留候选 ID、修订 ID 和被拒原因，不复制原始查询文本。
- 发布时同时建立独立的 Revision 生命周期策略。策略只能 `active → deprecated → revoked` 或 `active → revoked`，由版本 CAS 和数据库触发器共同约束；新解析、路由、激活和 Run 绑定仅接纳 `active`。既有 Run 在 `deprecated` 后仍能读取其冻结资源，在 `revoked` 后被拒绝。路由仍列出弃用/撤销候选及拒绝原因，不把消失的候选伪装成从未存在。
- 新增 `bindResolvedRun` 显式入口，在同一个数据库事务中验证 queued Run 的 Project/角色、解析精确依赖闭包，并把闭包的每条 Revision/哈希写入 Run 绑定；若任何依赖失效，事务不留下部分绑定。它拒绝对已有绑定重复解析，避免激活指针变化后悄悄重写历史。旧 `bindRun` 仍可直接绑定根 Skill，因此此入口尚未形成唯一的生产接入路径。

## 阶段验证与未完成边界

生命周期切片后，`skillResolution.test.ts`、`skillPermissions.test.ts`、`skillResources.test.ts`、`skillRouting.test.ts`、`skillRuntime.test.ts` 共 6 个定向用例通过；Skill 基础和 Memory 集成 7 个定向回归此前通过。TypeScript `--noEmit` 通过。未运行全量测试、构建、浏览器或真实 Provider。

尚未把原子依赖闭包绑定接入生产 Run 启动、未持久 Trace 路由与拒绝证据，也未把平台/Project/Run grant 接入真实 Tool 执行调用链。管理 UI/API、依赖/资源升级生命周期和旧 Agent 迁移仍未完成；当前结果不能描述成端到端 Skill 授权闭环。

## 阶段追问准备（非最终面经）

1. 问：为什么依赖必须固定精确 Revision？答：如果 A 依赖 B 的“当前版本”，B 激活新版本后 A 的同一运行可能得到不同指令。解析器把根的激活版本与每条依赖的 exact semanticVersion 分开，逐节点复验已发布状态和哈希，按稳定顺序生成闭包。测试覆盖三节点 DAG、缺失、循环和角色不兼容。它尚未原子绑定到真实 Run，因此不能声称执行期依赖冻结已完整交付。
2. 问：Skill 写了 `read:novel`，为什么仍可能被拒？答：manifest 只表达请求。权限决策还要平台、Project、Run 和角色每层都允许 Tool 所需 capability，少任意一层都会列出缺口；Skill 不能靠文本声明把自己升级为可调用 Tool。当前这是可测试的纯规则，审批与 Tool Runtime 接线仍未完成。
3. 问：为什么资源必须按 ID 与哈希加载？答：运行时文件路径会随着编辑和工作目录变化，也可能形成路径穿越。资源在草稿发布前固定 ID、媒体类型和内容哈希，发布检查齐全，Run 通过冻结修订查该 ID；测试拒绝跨 Project、未声明资源与路径形式输入。这样证明了新资源加载边界的确定性，不等于旧 Socket Agent 已停止读 Markdown 路径。
4. 问：弃用与撤销为什么不同？答：弃用阻止未来选择，但已经冻结修订的 Run 可以继续读取资源，避免发布策略变动破坏可复现性；撤销处理安全事件，立即拒绝历史 Run 的资源访问。策略状态独立于不可变内容，数据库触发器阻止逆向转移，应用层又用版本 CAS 防并发误操作。定向测试覆盖旧 Run、新 Run、重新激活、依赖解析及路由拒绝理由；这仍不等于实际 Tool 执行已获得同等保护。
5. 问：怎样避免依赖解析和 Run 冻结之间的版本竞态？答：`bindResolvedRun` 在一次数据库事务内读取 queued Run、解析根和所有精确依赖，再逐条写入冻结绑定。测试对三节点闭包核对 Revision 集合，并让底层依赖弃用，验证新 Run 失败且没有部分写入。该入口仍待接入生产启动路径；现有直接 `bindRun` 可绕过闭包，不能声称所有 Run 已有此保证。
