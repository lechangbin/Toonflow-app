# Agent Harness T10 导学：因果 Trace 与安全证据

> 第一方向 Agent Harness，第二方向 Agent 应用开发，AI 应用后端为补充。按用户约定，本阶段只提供实现说明和技术追问准备，不写简历。本文基于 T10 分支和定向单元测试；完整系统、浏览器与真实 Provider 验收留到 T21。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| 本地事务与因果顺序 | UI 到达时间不能说明状态提交顺序 | `src/agentRuntime/causalTrace.ts` | 极高 |
| 外部副作用的不确定性 | 超时不代表 Provider 无效果 | `src/controlledTools/billableImageLedger.ts` | 极高 |
| 关联键与父子一致性 | 避免跨 Run 拼接一条看似完整的链 | `src/agentRuntime/causalTrace.ts` | 极高 |
| 失效关闭的证据导出 | 可观察性不能泄漏提示词、密钥和媒体 URL | `src/agentRuntime/traceEvidence.ts` | 极高 |
| 保留与删除边界 | 未知效果需要保留证据，用户删 Project 需要明确清除 | `src/agentRuntime/retention.ts`、`src/routes/project/delProject.ts` | 高 |
| 数据库与文件系统非原子性 | 删除媒体失败不能谎称已彻底删除 | `src/routes/project/delProject.ts` | 高 |
| 旧数据兼容 | 不能给旧 Trace 凭空补造前驱 | `src/lib/fixDB.ts`、`src/agentRuntime/causalTrace.ts` | 高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 事务内因果追加 | 状态与解释一起提交，避免事后猜测 | sequence、predecessor、transaction | `src/agentRuntime/causalTrace.ts`、`src/agentRuntime/index.ts` | 1 |
| 多实体关联校验 | Trace 不是任意 ID 的拼接 | parent binding、integrity | `src/agentRuntime/causalTrace.ts`、`src/controlledTools/billableImageLedger.ts` | 2 |
| 安全证据投影 | 让操作员看到因果而不看到敏感正文 | allowlist、fail closed | `src/agentRuntime/traceEvidence.ts`、`src/routes/agentRuns/traceEvidence.ts` | 3 |
| 生命周期保留 | 未知计费结果的证据不能被定时器删掉 | retention、owner authorization | `src/agentRuntime/retention.ts`、`src/routes/project/delProject.ts` | 4 |
| 人工可读界面 | 以服务端序列为权威显示审批、取消和迟到 | safe projection、drawer | Web `src/utils/agentTraceEvidence.ts`、`src/views/assets/components/agentTraceEvidenceDrawer.vue` | 5 |

## 3. 必备知识点

- [ ] 能区分 Trace 的提交序列、前驱关系与事件时间戳；时间戳只用于显示。
- [ ] 能说明 Run、Step、Attempt、ToolReceipt、ToolCall、VendorRequest、Artifact 关联的父子校验。
- [ ] 能指出旧 Trace 的 `legacy-unlinked` 不等于已证明完整因果。
- [ ] 能说明为什么诊断使用固定字段分类、不能直接保存异常消息。
- [ ] 能解释新失败写入强制诊断与历史 `legacy-unclassified` 的分母，不能把已识别事件数说成全业务覆盖率。
- [ ] 能回答导出超过上限或证据损坏时为何整体拒绝而非静默截断。
- [ ] 能区分数据库事务删除与媒体目录后置清理，以及清理失败如何呈现。
- [ ] 不把定向测试说成真实 Provider、浏览器或全量验收。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域范围 | Project、Run 与图片副作用 | `CONTEXT.md`、`docs/agents/domain.md`、`docs/adr/0016-billable-image-request-recovery.md` | 20 分钟 | 为什么 Trace 需要连到外部请求 |
| 存储迁移 | 关联列和旧数据兼容 | `src/lib/initDB.ts`、`src/lib/fixDB.ts`、`tests/agentRunSchema.test.ts` | 35 分钟 | 旧库如何升级且不伪造历史 |
| 写入链 | 原子追加和父子校验 | `src/agentRuntime/causalTrace.ts`、`src/agentRuntime/index.ts`、`src/database/agentRunRecovery.ts` | 45 分钟 | 为什么不能各模块自行算序号 |
| 工具与外部效果 | 审批、读工具、计费图片 | `src/controlledTools/index.ts`、`src/controlledTools/derivedAssetWrite.ts`、`src/controlledTools/billableImageLedger.ts` | 50 分钟 | 如何解释批准到产物的链 |
| 导出与权限 | Owner 校验、白名单、失效关闭 | `src/agentRuntime/traceEvidence.ts`、`src/routes/agentRuns/traceEvidence.ts`、`tests/agentTraceEvidence.test.ts` | 35 分钟 | 为什么原始数据库行不直接导出 |
| 删除与界面 | 生命周期与媒体清理 | `src/agentRuntime/retention.ts`、`src/routes/project/delProject.ts`、Web `src/views/assets/components/agentTraceEvidenceDrawer.vue` | 35 分钟 | 删除失败如何向用户交代 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。建议选一个计费图片 Run，在纸上写出审批、请求意图、结果未知、取消、迟到产物的提交序列，再逐条对照 Trace 关联键。

## 6. 项目技术定位

本阶段以 Agent Harness 的可靠性与证据链为主，也覆盖 Agent 应用的人工可读操作界面和 AI 应用后端的权限、事务与清理边界；不涉及算法岗的模型训练或优化。

## 7. 核心原理解析

1. 分散的事件写入易形成断链 → 在状态事务内调用统一追加器，查前驱、分配连续序号并校验同 Run 父子身份 → `causalTrace.ts`。
2. 日志和时间戳不能证明原因 → 导出按数据库序号读取、审计前驱；旧记录保留未链接标记，损坏记录拒绝作为完整证据；已识别失败事件另报告分类覆盖与历史缺口 → `auditCausalTraceTimeline`、`auditTraceFailureClassification`。
3. 观察性可能变成泄漏面 → 只投影 ID、状态、时间与固定词表诊断，并对最终对象做共享敏感内容扫描 → `traceEvidence.ts`。
4. 未知外部效果需要可查 → 不按年龄自动删除 Agent 证据；Project Owner 删除项目时在同一数据库事务清除关联记录 → `retention.ts`。
5. 文件系统无法随数据库回滚 → 提交后再清理项目媒体目录，并明确返回清理失败状态供人工处置 → `delProject.ts`。

## 8. 关键设计决策

| 决策 | 备选 | 当前取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| 以持久序号为权威 | 前端到达时间、日志时间 | 同事务分配序号与前驱 | SQLite 写并发需遵循现有串行写约束 | Trace 写入与恢复定向测试 |
| 旧记录不补前驱 | 按时间补链 | 暴露 `legacy-unlinked` | 历史 Run 无法声称完整因果 | 旧库升级与审计单测 |
| 导出失效关闭 | 尽力跳过坏行 | 整体拒绝超限、损坏、敏感内容 | 可用性下降但不会给出误导的删节证据 | 导出单测 |
| Project 生命周期保留 | 定期清除 | 未知效果在项目存续期可核对 | 数据库增长待测，需后续治理容量 | 保留与删除单测；容量待测 |
| 媒体后置清理 | 假装跨 DB/FS 原子删除 | 返回独立 `mediaCleanup` 结果 | 清理失败无自动重试，需人工处理 | 路由失败注入单测；磁盘故障待验收 |

## 9. 量化与验证（含待测，建议）

当前定向单测证明关联、迁移、导出过滤、授权删除及失败回滚；没有真实性能或线上泄漏率数据。T21 应测多 Run 并发追加的序号连续性、长期 Project 下导出 5000 条上限与数据库增长、浏览器展示顺序、真实 Provider 超时和迟到效果、数据库提交后媒体清理失败与人工处理流程；这些均标记为待测，不写成已完成收益。
