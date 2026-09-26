# Agent Harness T15 面经：Skill 依赖、权限与路由（阶段版）

> 对应 Issue #71。材料只覆盖可在 T15 源码和定向测试中核验的设计，不提供简历 bullet。T16/T17 的旧 Agent 接线、T21 的全量与真实运行验收仍未完成。第一人称 ownership 须由用户按提交记录确认。

## 项目背景

T14 已能说明一次 Run 使用哪版 Skill，但一个 Skill 可能依赖其他 Skill、请求 Tool 和资源，也可能由路由自动选出。如果只固定根修订，不固定依赖闭包；如果把 manifest 请求当成授权；或让同分路由随排序选中，历史 Run 仍难以解释，且可能越权。T15 在已发布修订之上加入解析、权限判断、资源读取和路由证据，不能独立代表所有生产入口已强制接入。

## 主问与追问

1. 问：为什么只冻结根 Skill 修订还不够？答：根 Skill 的 manifest 可以声明依赖。如果每次运行时再去找依赖的“当前激活版”，管理员更新依赖后，同一个根版本在重试时可能执行不同指令。T15 解析时，根从当前激活指针选取，依赖按 manifest 写明的精确 semanticVersion 选取，记录每个修订 ID、内容/manifest 哈希和依赖边，最后把闭包绑定到 Run。定向测试覆盖指针变化和冲突，但旧 Agent 路径未因此自动迁移。追问：为什么不能只记依赖版本号？答：版本号是声明身份，还需修订和哈希核对内容未变。
2. 问：如何处理依赖图中的循环、重复和版本冲突？答：解析器使用访问中集合发现回边，用已解析映射复用节点；同一个 Skill 被两个父节点要求为不同精确版本时拒绝，而不猜测取哪个。它还限制根数、深度和总节点数，并以稳定顺序处理根及依赖。这样避免无限递归和输入放大，也使闭包证据更容易复现。`tests/skillResolution.test.ts` 是局部契约，不证明大型真实 Skill 库的管理体验。追问：两个父节点要求同版本会重复绑定吗？答：不会，已解析节点复用。
3. 问：为什么依赖必须是已发布且 active 的修订？答：草稿可编辑，不能成为运行时可信内容；deprecated 表示不应进入新 Run，revoked 表示安全禁用。解析时验证发布状态、内容及 manifest 哈希、生命周期和 Agent role 兼容性，任一条件不满足就拒绝整个闭包。这样的失败关闭牺牲部分自动运行率，但不让系统悄悄用最新版替代失效依赖。追问：已绑定 Run 的 deprecated 依赖怎样？答：允许历史读取的策略与新绑定策略不同，revoked 才进一步阻断后续访问。
4. 问：Skill manifest 写了 requestedTools，就能调用 Tool 吗？答：不能。manifest 只是作者的请求，T15 判断还需要该 Tool 的代码侧定义及其所需 capabilities，并检查 Skill 请求的 Tool/Capability 与平台、Project、Run、角色五层授权。任一层缺失都生成具体缺口而非默认放行。受控 Tool 路径还核对 Run、Project、冻结绑定、修订内容哈希及 role；这些定向证据不能推广为所有旧 Socket 入口均已强制经过闸门。追问：为何同时检查 Tool 名和 capability？答：防止泛化 capability 被用于未声明的 Tool。
5. 问：权限“交集”在代码里具体是什么意思？答：对某个 Tool 必需的每个 capability，Skill 必须声明请求，并且平台、Project、Run 和 Agent role 都必须授权；此外 Skill 的 requestedTools 要包含该 Tool 名。`evaluateSkillToolPermission` 返回 allowed 和逐层 missing，授权层不是由模型生成的文本决定。这样可以对拒绝原因做回放，但审计日志只解释本次决策，不能代替审查 grant 来源。追问：如果某层没有配置，是否继承其他层？答：不继承；缺失就拒绝。
6. 问：Project grant 为什么需要独立管理？答：同一个全局 Skill 可能服务不同 Project，但 Project 数据和付费效果不能因全局发布自动开放。`grants.ts` 用 Project 范围、Owner 身份及版本冲突检查来修改授权，并在执行时解析当前 grant；T16/T17 再把具体 Script/Production 能力接到受控效果。这样全局发布权与项目数据授权分离。追问：Owner 能否修改平台权限？答：不能，Project grant 只是其中一层。
7. 问：授权时为何要重新验证 Run 绑定和修订哈希？答：调用 Tool 的时刻离路由和绑定可能已有时间间隔；若只信请求里的 Skill ID，调用方可以指向未绑定 Skill，或使用已损坏的修订。`authorizeBoundSkillDefinition` 在事务中读 Project 内 Run 和其 Skill binding，再对已发布修订的内容、manifest 及绑定哈希逐一比对，并检查 revocation 和 role。它降低证据漂移风险；完整跨进程与真实 Provider 仍需 T21。追问：哈希一致就一定获准吗？答：不是，还要逐层 grant 和 Tool policy。
8. 问：路由优先级和关键词能否让 Skill 自行扩大权限？答：不能。路由只决定候选选择，先过滤修订状态、role 和 intent，再按 manifest 中的 priority 与关键词命中排序。即使选中，也必须经过依赖闭包和权限闸门；路由分数不是授权。`tests/skillRouting.test.ts` 覆盖候选排除与选择，但它使用局部数据，不是线上召回效果指标。追问：为何不直接让模型挑？答：模型输出难以作为可复核的授权依据。
9. 问：两个最高候选同分时为什么不按 Skill ID 自动选择？答：稳定排序用于输出可重复，不能把字典序误当作业务意图。最高 priority 和关键词命中同时并列时，路由返回 `needs-attention`、selected 为空，并保留候选及原因；没有候选时是 `unavailable`。这把歧义显式交给上层处理，避免一个文件名变化导致无意能力执行。追问：能否增加模型重排？答：可以作为提案或人工决策输入，但不能绕过最终明确选择和授权。
10. 问：如何避免“路由选 A、Run 绑定 B”的时间竞争？答：`routeAndBindRun` 在同一个数据库事务里获取决策、检查选中修订、解析闭包、冻结绑定并写路由证据，要求 Run 仍处于可绑定状态。这样至少在数据库事务边界内，证据与实际绑定对应；若后续旧路径不使用这一入口，不能声称整个应用都获得该保障。追问：事务能挡住数据库外的文件变化吗？答：不能，所以运行时内容来自已发布修订而不是任意可变文件。
11. 问：为什么运行时资源必须按 ID 加载？答：如果 Skill 文本能要求读取任意文件路径，就能把运行范围扩大到项目或主机其他文件。T15 在草稿中声明资源 ID、类型和哈希，发布时核对，Run 加载时通过已绑定修订和资源 ID 查找并再次验证生命周期，拒绝路径游走式选择。测试覆盖资源身份和撤销后的访问；它并不代表所有历史遗留文件入口都已删除。追问：资源哈希解决什么？答：保证所取字节与发布快照一致，不保证内容本身安全。
12. 问：deprecated 和 revoked 为何要区分？答：正常退役时通常只阻止新 Run 选入，已冻结 Run 仍可解释并继续读取原修订；安全撤销时需要阻止既有 Run 后续读取受影响修订和资源。T15 的生命周期检查把两者分开，也用版本比较保护策略更新。风险是 revocation 可能使在途 Run 失败，所以需要显式错误与恢复策略，而不能静默替换修订。追问：回滚激活指针等同撤销吗？答：不等同，回滚只改变未来选择。
13. 问：T15 的审计证据足以重现一次效果吗？答：它能说明路由候选、决定、绑定闭包、权限缺口及资源身份，并让这些决定有哈希和数据库记录；但“可解释授权”不等于生产效果完全可重放。一次真实效果还受输入 Bundle、Tool 参数、Vendor 响应、审批与外部状态影响，这些跨层证据在 T16/T17 与 T21 才需连起来验收。追问：若日志丢失怎么办？答：不能用猜测补齐，应报告证据缺失并定位持久化边界。
14. 问：T14、T15、T16/T17 的边界如何向面试官说？答：T14 解决不可变修订及一次 Run 用哪版；T15 在此之上解决依赖闭包、路由、资源和授权决策；T16/T17 才把 Script/Production 黄金路径逐步接入这些契约。堆叠分支中同时看到代码，不代表前一阶段单独具备后一阶段能力。当前各 Issue 仍开放，Draft PR 和定向单测只能作为阶段实现证据。追问：为何先做 T14？答：没有可信修订身份，权限和审计就缺少作用对象。
15. 问：现在能否宣称 Skill 安全机制已完整落地？答：不能。局部解析、路由、资源、权限和 grant 的定向测试能证明明确输入下的行为；尚需确认所有生产入口强制走这些闸门、旧 Skill 与旧 Socket 的迁移边界、异常恢复以及真实跨仓/Provider 行为。完成条件应按 Issue #71 逐条核对，并在 T21 做统一验收。面试时只说已实现的机制及尚未验证的系统边界，不把“没有测试失败”说成“没有安全风险”。追问：下一步最有价值的测试是什么？答：基于真实 Agent 黄金路径检查未授权效果能否绕过闸门。

## 源码证据索引

| 主题 | 关键路径与内部符号 | 对应问题 |
| --- | --- | --- |
| 依赖闭包 | `src/skillRuntime/resolution.ts`、`resolveSkillDependenciesInTransaction`、`tests/skillResolution.test.ts` | 1–3 |
| 权限与 Project grant | `src/skillRuntime/permissions.ts`、`evaluateSkillToolPermission`、`authorizeBoundSkillDefinition`、`src/skillRuntime/grants.ts`、`tests/skillPermissions.test.ts`、`tests/skillProjectGrants.test.ts` | 4–7 |
| 路由与绑定 | `src/skillRuntime/routing.ts`、`routeSkillsInTransaction`、`src/skillRuntime/index.ts`、`routeAndBindRun`、`tests/skillRouting.test.ts` | 8–10 |
| 资源与生命周期 | `src/skillRuntime/index.ts`、`tests/skillResources.test.ts` | 11–12 |
| 阶段边界 | `docs/reports/agent-harness-skill-safety-71-progress.md`、`docs/adr/0021-publish-skill-revisions-before-run-binding.md` | 13–15 |

## 高风险 Claim

不可说“manifest 即授权”“路由分数赋予能力”“所有旧 Agent 已接入”“全量安全测试通过”或“哈希能证明内容无害”。具体 ownership、收益数字及真实 Provider 结论均需要额外证据。此为阶段版；最终 ASu 口播长度、逐题追问与事实一致性质检留到所有阶段和 T21 完成后。
