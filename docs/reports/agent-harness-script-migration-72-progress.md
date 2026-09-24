# Agent Harness T16 · Script Agent 迁移（阶段进度）

Issue：`lechangbin/Toonflow-app#72`。本分支基于仍未验收的 T15 Skill 安全分支；此文档只记录迁移的第一处运行时接缝，不代表旧 Script Agent 已迁移。

## 已实现

- AgentRun 创建事务增加可注入的 `prepareRun` 接缝。在 Run、首个 Step/Attempt、Checkpoint 和 `run.created` Trace 已暂存而尚未提交时调用；准备失败将这些写入一并回滚，且不会调度 Model。准备成功后才返回 queued Run 并安排执行。
- 相同 `clientRequestId` 的幂等重试读取原 Run，不重新调用准备接缝，防止新的 Skill 激活指针或上下文版本改写已经冻结的运行。
- 该接缝目前默认未配置，不改变现有只读 AgentRun 行为，也未接入 T15 的路由/依赖冻结。旧 Script Socket Agent 仍为独立执行路径。

## 阶段验证与边界

`agentRunRuntime.test.ts` 的新增定向用例通过，覆盖准备失败全事务回滚、不调度 Model、重试成功及幂等重试不重准备。`yarn lint`（TypeScript noEmit）通过。未运行全量测试、构建、浏览器或真实 Provider。

下一切片需要把 T15 的路由、依赖、权限与资源入口放进 `prepareRun` 的同一事务，然后再使 Script Agent 的生产入口选择新 Run；还需处理 ContextBundle、规划/Script 写工具、停止/重连与前后端契约。当前不得称为端到端迁移。

## 阶段追问准备（非最终面经）

1. 问：为什么准备动作必须在 Run 创建事务里？答：如果先持久化 queued Run、再异步解析 Skill 或上下文，Worker 可能在准备完成前启动 Model，或准备失败后留下没有能力快照的半成品 Run。这里将准备接缝放在首个 Checkpoint/Trace 写入之后、事务提交之前；任意准备错误让整个创建回滚。定向测试还证明没有调度 Model。它目前只是扩展点，尚未调用真实 Skill 路由，因此不能说迁移已经完成。
2. 问：为什么幂等重试不能重新准备？答：`clientRequestId` 代表同一个请求身份，原 Run 的内容与冻结依赖应当保持不变。重试首先读取权威 Run，指纹一致则返回原结果；若重新解析，激活的 Skill 或 Project 内容可能已变化，同一 Run 会出现两套事实。测试确认准备只在首次创建时执行，重试不会重新运行准备逻辑。
