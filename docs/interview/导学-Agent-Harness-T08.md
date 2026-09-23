# Agent Harness T08 导学：受审批的衍生资产写入

> 本文面向 Agent Harness／Agent 应用开发岗位追问。按用户要求只提供功能理解与证据，不编写简历摘要或 bullet；未完成的端到端验收明确标为待测。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| Tool Calling 信任边界 | 模型输出的参数不是写入授权 | `src/controlledTools/definitions.ts`、`derivedAssetWrite.ts` | 极高 |
| 乐观并发控制 | 用户批准时目标可能已变化 | 预期契约 revision + 服务端状态哈希 | 极高 |
| 幂等命令与收据 | 重复点击或网络重试不能创建第二个资产 | `clientRequestId`、`operationId`、`clientCommandId` | 极高 |
| SQLite 事务和原子提交 | 资产、契约和证据不得部分成功 | `derivedAssetWrite.ts` 的决定事务 | 极高 |
| 项目所有者与资源归属 | 知道 Project/Asset ID 不等于有权写入 | JWT 用户 ID、Project.userId、父子 Asset、Script 过滤 | 高 |
| 不可变审批绑定 | 批准必须针对当时看到的内容 | ToolApproval 绑定字段与触发器 | 高 |
| 可恢复 Run 和证据链 | 页面或进程重启后仍能解释操作 | Run、Step、Attempt、Receipt、Checkpoint、Trace | 高 |
| 前端权威动作 | UI 不能从状态文本猜测可否重试 | 后端 `allowedActions` | 中高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 最小写权限边界 | 只读 Script Agent 不应获得生产写权限 | capability、role/scope | `src/controlledTools/definitions.ts`、`docs/adr/0015-bind-derived-asset-writes-to-durable-approval.md` | 1 |
| 精确审批绑定 | 批准后不能换载荷或目标 | immutable proposal、hash、expiry | `src/controlledTools/derivedAssetWrite.ts` | 2 |
| 双重冲突检测 | 兼容旧路径只改 Asset 不升契约版本的情况 | optimistic concurrency、state fingerprint | `targetState` 与 `stateHash` | 3 |
| 原子效果与证据 | 局部写入失败不能留下“资产已变但收据未写” | SQLite transaction、checkpoint | `derivedAssetWrite.ts` 的 `decide` | 4 |
| 安全 UI 控制 | 重连、重复点击和冲突时不猜状态 | durable snapshot、allowedActions | Web `rightChatBox/index.vue`、`derivedAssetApproval.ts` | 5 |

## 3. 必备知识点

- [ ] 能区分模型提议、人工授权与实际数据库效果；批准不是任意 Project 写权限。
- [ ] 能说清三类 ID：Run 的客户端请求 ID、Tool 操作 ID、审批命令 ID。
- [ ] 能解释为什么目标版本之外还需要当前状态哈希，以及哈希覆盖了哪些字段。
- [ ] 能沿一次批准说出事务内每个记录的写入顺序与失败回滚边界。
- [ ] 能解释拒绝、过期、冲突、证据篡改和数据库故障各自的可检查状态。
- [ ] 能指出旧 Production Agent 仍未迁移，新 UI 只处理走新 Runtime 的提案。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 背景与术语 | 领域不变量 | `CONTEXT.md`、`docs/adr/0007-derived-assets-use-parent-anchors.md` | 15 分钟 | 为什么衍生资产要带变化契约 |
| 先前控制面 | Run 和只读 Tool 基线 | `docs/adr/0011-persist-read-only-agent-runs-with-orthogonal-attention.md`、`docs/adr/0014-route-read-agent-tools-through-controlled-runtime.md` | 20 分钟 | T08 继承了什么、不继承什么 |
| 写 Tool 定义 | 严格契约与策略 | `src/controlledTools/definitions.ts` | 15 分钟 | 模型输入如何被收窄 |
| 提案入口 | 前置授权、版本、等价态 | `src/controlledTools/derivedAssetWrite.ts` 的 `propose` | 35 分钟 | 什么条件下根本不生成审批 |
| 人工决定 | 原子写入、失败收敛 | `src/controlledTools/derivedAssetWrite.ts` 的 `decide` | 45 分钟 | 何时保证无第二次写入 |
| HTTP 与 Web | 身份来源、卡片动作 | `src/routes/agentRuns/derivedAssetApproval.ts`、Web `src/views/production/components/rightChatBox/index.vue` | 25 分钟 | 为什么 409 不能自动重试 |
| 测试证据 | 负面、安全和恢复 | `tests/derivedAssetWrite.test.ts`、`tests/agentRunSchema.test.ts`、Web `tests/derivedAssetApproval.test.ts` | 35 分钟 | 阶段测试证明了什么、没证明什么 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。先画出“提案 → waiting Run/审批 → 人工决定 → 事务提交或安全终止”的数据流，再尝试不用代码回答每一条失败边界。

## 6. 项目技术定位

主方向是 Agent Harness，其次是 Agent 应用开发，AI 应用后端作为补充：核心工作不是改进模型算法，而是把非可信模型提议转化为用户可批准、可恢复、可审计且不重复的生产效果。

## 7. 核心原理解析

1. 模型参数不能直接写库 → 通过固定 ToolDefinition、严格输入 schema、Project/Script/Asset 所有权校验构成最小写入口 → `propose` 在产生审批前完成全部前置验证。
2. 用户看到的内容可能与批准时不一致 → 把规范化载荷、效果预览、Tool 修订与目标状态哈希绑定到不可变 Approval → `decide` 重新验证绑定与当前目标后才允许写入。
3. 网络和 UI 会重试 → 用持久 Run 请求身份、Tool 操作身份、审批命令身份区分不同层次的重复 → 同一决定返回原快照；改变载荷或旧版本命令被拒绝。
4. 数据库写入可能中途失败 → 资产、契约、Receipt、Output、Checkpoint 和 Trace 处于同一 SQLite 事务 → 注入契约写入故障时没有部分 Asset 成功。
5. 页面不是权威状态 → 后端持久 Run 和 Approval，Web 只投影最近记录与 `allowedActions` → 重连时重新读取，409 时刷新且不自动重试。

## 8. 关键设计决策

| 决策 | 备选 | 当前取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| 独立写范围 | 扩充只读 Script Agent / 独立 Production Agent 范围 | 选择独立范围 | 新旧 Production Agent 暂时并存 | 角色范围与旧路径边界检查 |
| 新建与更新统一入口 | 两个 Tool / 一个有严格 `assetId` 和版本语义的 Tool | 选择统一入口 | 输入分支增多 | 新建版本 0、更新版本递增单元测试 |
| 版本加状态哈希 | 只看 revision / 两者并用 | 选择两者并用 | 历史旧路径可能改 Asset 未升版本 | 目标变化后的审批冲突测试 |
| 本地事务 | 先写 Asset 后写证据 / 单事务 | 选择单事务 | 长事务和 DB 锁需观测 | 故障注入回滚测试 |
| 前端无自动重试 | 409 自动重放 / 只刷新快照 | 选择只刷新 | 用户需重新确认 | Web 动作映射单元测试 |
| 旧路径迁移 | T08 直接替换 / 后续 T17 迁移 | 选择后续迁移 | 当前还有未受控写入口 | 报告明确限制与迁移验收门槛 |

## 9. 量化与验证（含待测）

本阶段能量化的是局部测试断言：批准提交一次、重复命令额外写入零次、负面路径 Asset 修改零次、故障注入后部分提交零次。最终验收建议采集真实运行中的审批冲突率、过期率、重复命令率、事务锁等待、旧路径占比，以及 App/Web 重连与真实模型工具调用的协议一致性；这些指标目前均为待测，不能从测试样本外推成线上收益。
