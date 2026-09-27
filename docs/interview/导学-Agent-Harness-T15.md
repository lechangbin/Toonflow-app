# Agent Harness T15 导学：Skill 依赖、权限与路由（阶段版）

> 对应 Issue #71。T15 建立 Skill 安全解析基础；生产 Run 的完整强制接线、旧 Agent 迁移及 T21 验收仍未完成。本文服务 Agent Harness 面试准备，不提供简历 bullet。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| DAG 与循环检测 | 固定依赖闭包顺序 | `src/skillRuntime/resolution.ts` | 高 |
| 最小权限交集 | Skill 请求不能自授能力 | `src/skillRuntime/permissions.ts`、`src/skillRuntime/grants.ts` | 高 |
| 乐观锁、事务与冻结证据 | 防止路由/绑定间版本漂移 | `src/skillRuntime/index.ts`、`src/skillRuntime/routing.ts` | 高 |
| 不可变资源身份 | 防止运行时任意路径读取 | `src/skillRuntime/index.ts` | 中 |
| 路由歧义与撤销 | 安全地处理并列和安全事件 | `src/skillRuntime/routing.ts` | 高 |

## 重点亮点与学习顺序

| 亮点 | 为什么重要 | 通用关键词 | 先看文件 | 顺序 |
| --- | --- | --- | --- | --- |
| 精确依赖闭包 | 激活指针变更不能改写 Run 的依赖 | DAG、版本固定 | `src/skillRuntime/resolution.ts` | 1 |
| 权限交集 | 防止 Skill 文本提权 | 零信任、能力 | `src/skillRuntime/permissions.ts`、`grants.ts` | 2 |
| 资源 ID 加载 | 不接受任意文件路径 | 不可变资源、范围 | `src/skillRuntime/index.ts` | 3 |
| 有证据的路由 | 并列时不猜测，拒绝理由可查 | 决策日志、失败关闭 | `src/skillRuntime/routing.ts` | 4 |
| 生命周期安全 | deprecated 与 revoked 不同 | 兼容、撤销 | `src/skillRuntime/index.ts` | 5 |

## 必备知识点

- [ ] 区分根 Skill 当前激活版与依赖声明的精确 semanticVersion。
- [ ] 说明平台、Project、Run、角色、Tool、Skill 请求如何逐项求交；缺任一层不能调用适配器。
- [ ] 解释最高分并列为何返回 `needs-attention`，而不是用文件名或随机顺序选择。
- [ ] 说明资源 ID/哈希与任意运行时路径的安全差异。
- [ ] 解释 deprecated 保留历史使用、revoked 拒绝后续访问的不同效果。
- [ ] 指出旧直接绑定入口与尚未迁移的 Socket Agent 会限制“全链路强制”表述。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 前置修订 | T14 不可变基础 | `docs/adr/0021-publish-skill-revisions-before-run-binding.md`、`src/skillRuntime/manifest.ts` | 15 分钟 | T15 解析的对象是什么 |
| 依赖解析 | DAG、缺失/冲突/循环 | `src/skillRuntime/resolution.ts`、`tests/skillResolution.test.ts` | 35 分钟 | 为什么依赖不能用“当前版” |
| 权限 | 多层交集和持久 grant | `src/skillRuntime/permissions.ts`、`src/skillRuntime/grants.ts`、`tests/skillPermissions.test.ts` | 40 分钟 | Skill 为什么不能自授 Tool |
| 路由与绑定 | 决策与闭包同事务 | `src/skillRuntime/routing.ts`、`src/skillRuntime/index.ts`、`tests/skillRouting.test.ts` | 45 分钟 | 如何防止选 A、绑 B |
| 资源与生命周期 | ID/修订/哈希、撤销 | `src/skillRuntime/index.ts`、`tests/skillResources.test.ts` | 35 分钟 | 哪些历史 Run 可继续使用 |
| 阶段报告 | 已实现与缺口 | `docs/reports/agent-harness-skill-safety-71-progress.md` | 10 分钟 | 何处不能宣称完成 |

自学提醒：若某文件或原理看不懂，请继续追问 AI；本导学负责给学习路径与题目，不提供逐行讲解。

## 项目技术定位

这是 Agent Harness 的运行时安全与可复现路由层，不是依赖 Model 遵守提示词的软约束；它为 T16/T17 的真实 Agent 路径提供可选安全闸门。

## 核心原理解析

1. 问题：依赖 Skill 被重新激活。机制：根取当前激活修订，依赖取 manifest 声明的精确版本，按稳定顺序解析并冻结闭包。落点：`resolveSkillDependenciesInTransaction`、`routeAndBindRun`。
2. 问题：Skill 自称需要 Tool。机制：Skill 请求与五类服务端权限来源和 Tool 策略取交，缺口显式返回并在已绑定路径记录 PermissionDecision。落点：`evaluateSkillToolPermission`、受控 Tool 闸门。
3. 问题：路由结果与实际绑定可能不一致。机制：同一事务写不可变路由决定、解析闭包、比较根修订并绑定；并列只留待处理决定。落点：`routeAndBindRun`。
4. 问题：运行时资源路径可变。机制：草稿阶段注册 ID/类型/哈希，发布核完整性，运行只按冻结修订查 ID。落点：Skill 资源加载器。
5. 问题：需要区别正常退役与安全封禁。机制：deprecated 阻新选但允许既有 Run 的冻结资源，revoked 进一步拒绝既有 Run 后续资源访问。落点：Revision lifecycle policy。

## 关键设计决策

| 选择 | 备选 | 取舍与风险 | 阶段证据 |
| --- | --- | --- | --- |
| 精确依赖版本 | 运行时解析最新版本 | 消除版本漂移，升级需显式发布 | `tests/skillResolution.test.ts` |
| 权限交集 | Skill 声明即授权 | 阻止文本提权，配置更繁琐 | `tests/skillPermissions.test.ts`、`skillProjectGrants.test.ts` |
| 并列待处理 | 随机/ID 自动决胜 | 牺牲自动化以避免歧义效果 | `tests/skillRouting.test.ts` |
| 资源 ID/哈希 | 文件路径随时读取 | 约束编辑与目录访问 | `tests/skillResources.test.ts` |

## 量化与验证（待测）

建议最终按冻结 App/Web/Skill 修订统计依赖解析拒绝、授权缺层、撤销后拒绝、路由歧义与资源完整性，并对真实 Script/Production Agent 做跨边界回归。现有定向单测和 TypeScript 检查不证明所有生产入口启用闸门、真实 Provider 安全或全量验收通过。
