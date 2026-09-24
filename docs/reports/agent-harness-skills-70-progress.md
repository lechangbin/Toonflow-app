# Agent Harness T14 · Skill 发布与 Run 绑定（阶段进度）

Issue：`lechangbin/Toonflow-app#70`。本分支堆叠在尚未验收的 T12 ContextBuilder 分支上。以下是发布/绑定第一切片，不是完整 Skill Runtime 或 T21 验收。

## 已实现

- 领域术语和 ADR-0021 将稳定 Skill Definition、可编辑草稿/不可变已发布 SkillRevision、当前 SkillBinding、Run 自身的冻结绑定分开；当前 Markdown 路径不再被新运行时当作修订身份。
- 四张 SQLite 表分别保存 Definition、Revision、激活指针和 Run 绑定；版本化 manifest 描述适配角色与意图、依赖声明、请求的 Tools/Capabilities、资源声明、路由元数据及归属。发布前校验身份、语义版本、去重、大小与安全文本；它只声明请求，不授予 Tool 权限。
- 草稿可按预期内容哈希更新；发布会重验内容与 manifest 哈希，并由 SQLite 触发器禁止修改或删除已发布修订。激活使用绑定版本检查；回滚只是重新指向旧的已发布修订。
- queued Agent Run 可在 Project 作用域内冻结所选 Revision ID 及内容/manifest 哈希。重试读取已冻结绑定，不会因之后激活新版本而改写旧 Run；新 Run 接受新指针。角色不匹配拒绝，Project 删除事务可清理 Run 绑定证据。
- 旧 `o_skillList` 可编辑记录保持原样；升级新增四张表时不会把未验证的旧文件自动发布。
- 新增管理员专用 Skill 管理命令入口：列出不含正文的定义/修订/当前绑定，按 ID 检查单版正文与哈希，只读校验草稿，创建定义、保存/更新草稿、发布和以绑定版本检查激活。入口只从认证用户判定管理员，拒绝请求体伪造 actor；全局 Skill 不因某个 Project 的所有权而开放管理。

## 阶段验证与未完成边界

`tests/skillRuntime.test.ts` 的 2 个定向用例覆盖草稿更新、过时哈希冲突、发布不可变、绑定版本冲突、Run 冻结、未来 Run 激活与回滚、角色拒绝、跨 Project 拒绝、删除许可和旧库兼容。`tests/skillManagementRoutes.test.ts` 的 2 个定向用例覆盖管理投影、只读校验、发布激活、修订检查，以及非管理员拒绝/actor 伪造拒绝。另曾运行 `contextBundle.test.ts` 3 个依赖回归；TypeScript `--noEmit` 通过。未运行全量测试、构建、浏览器或真实 Provider。

依赖闭包与环校验、资源按 ID 加载、有效权限交集、路由和高风险歧义暂停、管理 UI、受控的旧 Skill 导入、Run 创建时自动绑定以及旧 Socket Agent 迁移尚未完成。当前管理 API 也未接前端编辑器；manifest 中的依赖/资源/权限是经结构校验的声明，不是已解析或已授权的执行能力；面试材料不得夸称完整 Skill Marketplace 或安全授权闭环。

## 阶段追问准备（非最终面经）

1. 问：为什么把草稿、发布修订、激活指针和 Run 绑定分开？答：草稿允许作者反复修改；发布时重验内容与 manifest 哈希后形成不可变快照；激活指针只决定未来 Run 默认选哪一版；Run 绑定把当时选择的 Revision ID 和哈希单独冻结。测试让第一条 Run 绑定 1.0.0，激活 1.1.0 后仍复用 1.0.0，新 Run 则选 1.1.0；回滚后再新建的 Run 回到 1.0.0。这里证明的是版本归因，不证明旧 Socket Agent 已迁移。
2. 问：Skill manifest 声明 Tool 是否等于获得 Tool 权限？答：不等于。当前 manifest 的 `requestedTools` 和 `requestedCapabilities` 只是声明，发布只验证结构、身份、重复项与安全文本。真正的有效权限必须由平台、Project、Run、角色、Tool 策略和 Skill 请求取交集，且高风险操作仍需审批；这部分在 T15 尚未实现。面试时应明确称它为“声明校验”，不能称为“权限闭环”。
3. 问：为什么旧 Markdown Skill 不自动发布？答：旧文件可变，部分来源由路径或前端上下文选择，缺少新 manifest 的依赖、资源与权限元数据。如果仅按路径读取并标成已发布，会让一个正在运行的 Run 在文件改动后悄悄换行为。升级测试只验证旧表和 Project 保留、新修订表为空；安全导入需要显式适配与人工确认，不能通过 isolation 或文件名猜测发布身份。
4. 问：为什么 Skill 管理入口要求应用管理员而非 Project owner？答：Definition、Revision 和激活指针是全局共享表，某个 Project 的 owner 若能激活修订，会改变其他 Project 未来 Run 的默认 Skill。入口通过认证后的用户 ID 查询管理员身份，严格拒绝请求体携带 actor；修订列表不返回正文，只能按 ID 单独检查。这个入口解决了受控发布的服务端边界，但尚未提供 UI 或自动导入。
