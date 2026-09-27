# Agent Harness T13 导学：Project Memory 的来源证据（阶段版）

> 对应 Issue #69、ADR-0020；目标岗位优先 Agent Harness。T13 尚未验收，仅有逐字片段 Memory 的阶段实现；旧 Socket `memories` 不会自动晋升。简历由用户自行完成，本文只给源码学习与追问准备。

## 前置知识

| 知识点 | 为何需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| Run/Step/Attempt/Checkpoint | 判断内容是否来自已提交执行 | `src/agentRuntime/index.ts`、`src/agentRuntime/checkpoints.ts` | 高 |
| 不可变来源与哈希 | 检测输出改写和片段定位漂移 | `src/memory/projectMemory.ts` | 高 |
| Project 与 Script 作用域 | 阻止跨项目或不相关剧本的 Memory 借用 | `src/memory/contextSources.ts` | 高 |
| Context 预算与信任层级 | Memory 只能作为低权威数据 | `src/context/index.ts`、`src/context/budget.ts` | 高 |
| SQLite 事务与触发器 | 捕获、撤销、删除的不同生命周期 | `src/lib/initDB.ts`、`src/agentRuntime/retention.ts` | 中 |

## 重点亮点与学习顺序

| 亮点 | 为什么重要 | 通用关键词 | 先看哪些文件 | 顺序 |
| --- | --- | --- | --- | --- |
| 成功提交才捕获 | 流片段和失败尝试不能成为长期记忆 | 提交边界、证据 | `src/memory/projectMemory.ts` | 1 |
| 可定位逐字片段 | 保留来源而不编造摘要事实 | provenance、Unicode 定位 | `src/memory/projectMemory.ts` | 2 |
| 使用前再次核验 | 捕获成功不保证来源后来未损坏 | 读时校验、Project 隔离 | `src/memory/contextSources.ts` | 3 |
| 撤销与旧表兼容 | 安全撤销不能篡改历史来源 | 生命周期、迁移 | `src/lib/initDB.ts`、`src/agentRuntime/retention.ts` | 4 |

## 必备知识点

- [ ] 说清“来源可核验”只能证明来自某个成功提交的 Output，不能证明 Output 的业务事实正确。
- [ ] 画出 `Run → Step/Attempt → Checkpoint → Output → Memory → ContextBundle` 的因果链。
- [ ] 解释捕获与再次读取为何都要校验 Project、Script、角色、修订和 Output 哈希。
- [ ] 区分 active→revoked 与 Project 删除；不能把撤销说成清除来源证据。
- [ ] 解释旧 Socket Memory 的 `isolationKey` 为何不是授权或提交证明。

## 推荐阅读（真实源码路线）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域决策 | 新旧 Memory 边界 | `CONTEXT.md`、`docs/adr/0020-project-memory-requires-committed-source.md` | 15 分钟 | 为什么不能直接迁旧表 |
| 捕获 | 成功 Step、Checkpoint、片段哈希 | `src/memory/projectMemory.ts`、`tests/projectMemory.test.ts` | 40 分钟 | 未提交来源如何拒绝 |
| 消费 | 读时来源复验与低权威候选 | `src/memory/contextSources.ts`、`src/context/index.ts` | 35 分钟 | 撤销或漂移后为何不能使用 |
| 生命周期 | 不可改写、撤销、授权删除 | `src/lib/initDB.ts`、`src/agentRuntime/retention.ts` | 30 分钟 | 为什么删除 Project 要先清 Memory |
| 阶段证据 | 已测与未测 | `docs/reports/agent-harness-memory-69-progress.md` | 10 分钟 | 哪些回答必须标待测 |

自学提醒：若某文件或原理看不懂，请继续追问 AI；本导学负责给学习路径与题目，不提供逐行讲解。

## 项目技术定位

这是 Agent 应用后端中的连续性证据治理，服务于 Agent Harness 的 ContextBuilder；不是语义检索算法或已验证知识库。

## 核心原理解析

1. 问题：旧聊天摘要缺少 Project 和执行来源。机制：新 Memory 从同 Project 已提交 Output 抽取可定位片段，记录来源 Run/Step/Output 和哈希。落点：`captureOutputExcerpt`。
2. 问题：流片段或失败尝试可能被误记。机制：同一事务核对成功 Step/Attempt 与提交 Checkpoint，缺任一项拒绝。落点：`src/memory/projectMemory.ts`。
3. 问题：捕获后来源可能改写。机制：构造 Context 前重新核对当前 Run 作用域、来源状态、哈希、片段位置和 revision。落点：`createProjectMemoryContextSourceLoader`。
4. 问题：Memory 文字可能具有注入性或错误事实。机制：它只是 `user` 角色的低权威历史数据，并受预算约束，不成为系统指令。落点：`src/context/index.ts`。
5. 问题：需要停用但不能抹除已发生证据。机制：版本/命令 ID 绑定的幂等撤销，普通更新删除被触发器阻止；Project 删除另走授权生命周期。落点：`revoke`、数据库触发器与 `deleteProjectAgentEvidence`。

## 关键设计决策

| 选择 | 备选 | 取舍与风险 | 阶段验证 |
| --- | --- | --- | --- |
| 只支持逐字片段 | 直接让模型生成摘要 | 先保留可复核来源，尚无摘要来源图 | `tests/projectMemory.test.ts` |
| 读取前复核来源 | 捕获一次后永久信任 | 多次查询成本换来来源漂移拒绝 | 定向破坏 Output/Attempt 测试 |
| 旧表保留、不自动晋升 | 根据隔离键批量迁移 | 避免把未验证历史内容升级为权威证据 | 旧库升级定向测试 |
| 显式撤销 | 直接删除行 | 保留审计身份；Project 删除仍需专门清理 | 撤销/触发器/删除测试 |

## 量化与验证（待测）

建议最后统计可用 Memory 的来源核验通过率、撤销生效、跨 Project 拒绝、Context 纳入率和来源漂移拒绝分类。现有 T13 仅有 2 个定向 SQLite/Fake Model 用例及类型检查记录；没有摘要事实准确率、语义检索收益、真实用户效果或跨进程/浏览器最终验收。T21 前不能把它描述为完整 Memory 治理。
