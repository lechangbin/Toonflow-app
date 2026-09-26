# Agent Harness T14 导学：Skill 发布、激活与 Run 冻结（阶段版）

> 对应 Issue #70、ADR-0021。T14 是 Skill 版本生命周期基础，不能代替 T15 权限解析、T16/T17 Agent 迁移或 T21 最终验收。本文件不代写简历。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| 不可变修订与内容哈希 | 证明运行时使用哪版指令 | `src/skillRuntime/index.ts` | 高 |
| 乐观并发与激活指针 | 防止管理员覆盖他人更改 | `src/skillRuntime/index.ts`、`tests/skillRuntime.test.ts` | 高 |
| 版本化 manifest | 区分声明与实际授权 | `src/skillRuntime/manifest.ts` | 高 |
| Run/Project 作用域 | 解释历史绑定不随新版本改变 | `src/agentRuntime/index.ts`、`src/skillRuntime/index.ts` | 高 |
| 管理员与 Project Owner | 理解全局 Skill 的管理边界 | `src/routes/agentSkills/` | 中 |

## 重点亮点与学习顺序

| 亮点 | 为什么重要 | 关键词 | 先看文件 | 顺序 |
| --- | --- | --- | --- | --- |
| 草稿/发布分离 | 编辑不应改写已运行指令 | 不可变快照 | `src/skillRuntime/index.ts` | 1 |
| 激活与 Run 绑定分离 | 回滚只影响未来 Run | 版本归因 | `src/skillRuntime/index.ts` | 2 |
| manifest 是请求声明 | Skill 文本不能自己授权 Tool | 最小权限 | `src/skillRuntime/manifest.ts` | 3 |
| 管理命令与显式旧版适配 | 防止 Project Owner 或路径伪装成全局发布权 | 权限、兼容 | `src/routes/agentSkills/`、`src/skillRuntime/legacyImport.ts` | 4 |

## 必备知识点

- [ ] 能区分 Skill Definition、草稿/已发布 SkillRevision、当前 SkillBinding 和 Run 冻结绑定。
- [ ] 解释为什么激活新版本或回滚不会修改历史 Run 的 Revision ID、内容哈希与 manifest 哈希。
- [ ] 说明 `requestedTools`/`requestedCapabilities` 仅是声明，真正 Tool 授权需 T15 的交集及审批。
- [ ] 说明旧 Markdown 路径和旧 `o_skillList` 为何没有自动升级成已发布修订。
- [ ] 指出管理员 API 已有但编辑 UI 与完整旧 Skill 迁移尚未验收。

## 推荐阅读

| 主题 | 技术点 | 阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 领域决策 | 四种身份与生命周期 | `CONTEXT.md`、`docs/adr/0021-publish-skill-revisions-before-run-binding.md` | 15 分钟 | 为什么不按文件路径选 Skill |
| manifest | 角色、意图、Tool/资源声明 | `src/skillRuntime/manifest.ts`、`tests/skillRuntime.test.ts` | 25 分钟 | 声明与授权如何区分 |
| 发布与绑定 | CAS、哈希、历史冻结 | `src/skillRuntime/index.ts`、`tests/skillRuntime.test.ts` | 45 分钟 | 发布/回滚后旧 Run 是否变化 |
| 管理与旧版适配 | 管理员 actor 来源、显式导入 | `src/routes/agentSkills/`、`src/skillRuntime/legacyImport.ts`、`tests/skillManagementRoutes.test.ts`、`tests/legacySkillImport.test.ts` | 35 分钟 | 为什么不能自动发布旧文件 |
| 阶段证据 | 已测/待测 | `docs/reports/agent-harness-skills-70-progress.md` | 10 分钟 | 哪些仍属 T15–T21 |

自学提醒：若某文件或原理看不懂，请继续追问 AI；本导学负责给学习路径与题目，不提供逐行讲解。

## 项目技术定位

这是 Agent Harness 的指令供应链与版本治理能力，核心是可复现运行和安全发布，而非“让模型学会调用更多工具”。

## 核心原理解析

1. 问题：编辑中 Skill 直接进入运行会造成不可复现。机制：草稿可变，发布前核验内容与 manifest 哈希，已发布修订不可原地改写。落点：`createSkillRuntime().publish`、数据库触发器。
2. 问题：激活指针变化可能改变在途 Run。机制：Run 冻结 Revision ID 和哈希，当前绑定只供新 Run 解析。落点：`activate` 与 `bindRun`；T15 后来补依赖闭包。
3. 问题：文本声明可能伪装权限。机制：manifest 只记录请求的 Tool/Capability，不产生授予；T15 才与平台、Project、Run、角色策略求交。落点：`validateSkillManifest`。
4. 问题：全局发布会影响多个 Project。机制：管理 API 从认证用户判断应用管理员，不能信请求体 actor；列表不带正文。落点：Skill 管理路由与定向测试。
5. 问题：旧文件可能含路径依赖和旧回调。机制：仅允许固定、哈希钉住的纯参考源生成草稿提案，保存/发布/激活仍分步。落点：`adaptLegacySkill`。

## 关键设计决策

| 选择 | 备选 | 取舍与风险 | 阶段验证 |
| --- | --- | --- | --- |
| 发布后不可变 | 直接覆盖 Markdown | 便于重放，但增加修订管理 | `tests/skillRuntime.test.ts` |
| 回滚只移激活指针 | 修改旧 Run 绑定 | 历史不变，未来可切回；要记录绑定版本 | `tests/skillRuntime.test.ts` |
| 管理员而非 Project Owner 管全局 Skill | 所有 Owner 可发布 | 防止单 Project 改动影响其他 Project | `tests/skillManagementRoutes.test.ts` |
| 旧版逐个适配 | 自动扫描全部 Markdown | 牺牲迁移速度以避免暗授工具权 | `tests/legacySkillImport.test.ts` |

## 量化与验证（待测）

建议最终核验发布/激活/回滚后的 Run 修订分布、草稿冲突与历史绑定一致性；与 T15 的依赖、资源、权限以及 T16/T17 实际 Agent 路径做跨阶段测试。T14 的定向测试和 TypeScript 检查不证明管理 UI、全部旧 Skill 兼容、真实模型执行或系统上线。
