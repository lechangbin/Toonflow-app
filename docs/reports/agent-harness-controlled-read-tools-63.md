# Agent Harness T07：受控只读 Tool 契约与安全证据

## 范围

Issue #63 为 T04-T06 的只读 Agent Run 增加 `get_novel_text` 与 `get_novel_events`。模型只收到两个输入为章节记录 ID 的工具，项目事实中列出前 20 个可读取的章节记录 ID 与编号；工具执行由 `src/controlledTools/` 统一校验、授权、限时、去重、校验输出、持久化 ToolReceipt 和追加 Agent Trace。旧 Script Agent 的 Socket 工具实现没有在本阶段迁移，该迁移属于后续 #72。

## 契约与策略

| Tool | 输入 | 输出 | 上限 |
| --- | --- | --- | --- |
| `get_novel_text` | 严格 `{ novelId: 正整数 }` | `{ novelId, chapterIndex, chapter, text }` | 标题 200 字符、正文 16,000 字符 |
| `get_novel_events` | 严格 `{ novelId: 正整数 }` | `{ novelId, truncated, events[] }` | 前 20 个按事件 ID 排序；名称 200、详情 2,000 字符 |

每个 ToolDefinition 有固定 revision、严格输入/输出 schema、正交风险维度、能力、Run role/scope、审批、幂等、重试、超时、取消、并发、提交、核对、补偿、脱敏、上下文投影和领域适配器身份。定义契约计算 SHA-256 并落入只追加的定义表；同名同 revision 若内容变化会拒绝执行。读取无生产资产写入、无外部费用，不要求审批。5 秒超时后只写安全失败诊断，迟到读取结果不再提交。

## 执行顺序与安全规则

1. 输入按严格 schema 解析；错误只返回枚举化 `contractRejected`，不保存未经校验的输入正文。
2. 在数据库事务中查找当前 Project、role、scope 下没有取消意图的 running Run，核对 worker owner/epoch/fence/expiry。Run 不匹配不写入其收据；已请求取消的 Run 不启动新工具。
3. 以 `(runId, operationId)` 识别同一逻辑调用，输入指纹绑定 Tool 名称、revision 和规范化输入。重复调用返回同一权威收据；复用 ID 改变输入则冲突。
4. 在适配器运行前确认 `o_novel.id` 属于该 Run 的 Project。跨项目或不存在的章节产生 `authorizationFailed` ToolReceipt 与关联 Trace，适配器不会执行。
5. 合法调用先提交 `pending` 收据和 `tool.started` Trace，再用冻结的 `{runId, projectId}` 最小上下文调用领域适配器。模型不收到数据库句柄、Socket 回调或 HTTP 对象。
6. 输出再次过严格 schema、数量上限与敏感内容门禁，成功保存受限 JSON 和哈希；失败只保存安全诊断。终态写入再次核对相同租约，并与关联 Trace 同事务提交。
7. 重启就绪阶段保留有效租约的 pending 读取；失去有效租约的 pending 收据只收敛一次为 `failed` 并追加 `tool.interrupted`。重新尝试需要新的 operation ID。

ToolReceipt 可存储受限的项目读取结果以支持同一操作的重连去重；Agent Trace 只保存收据关联 ID、事件和安全诊断，不复制小说正文。收据重复读取会重新验证输出 schema、内容哈希和安全门禁，篡改后 fail closed。

## 竞态与负面证据

- 同时到来的同一 operation：第二个调用看到 pending 收据，不再启动第二个适配器。
- 相同 operation ID 但 Tool、revision 或规范化输入不同：抛出身份冲突，不复用旧结果。
- 跨 Project 的章节 ID 或不在允许 role/scope 的 Run：在适配器执行前拒绝。
- 输出过长、格式不合法、含不允许持久化内容、适配器异常、超时：只产生枚举化安全诊断，不保存原始异常或不合规输出。
- 收据输出被更改但哈希未同步：重复读取拒绝投影。
- worker 租约到期：迟到读取不能更新收据；启动恢复把失去所有权的 pending 收敛为失败。

## 验证与限制

聚焦测试命令：`node --import tsx --test tests/controlledTools.test.ts tests/agentRunRuntime.test.ts tests/agentRunSchema.test.ts`，**50/50 通过**。测试覆盖 Tool Runtime、真实 Agent Run 工具接线、数据库升级和恢复；其中还验证重复调用不能绕过 ToolDefinition 契约哈希校验。受影响的数据库就绪单元测试 `node --import tsx --test tests/databaseReadiness.test.ts` **7/7 通过**。`yarn lint` 与 `git diff --check` 通过。

没有运行仓库全量测试、完整 App/Web build、浏览器 E2E、Electron 打包或真实模型 Tool Calling；按约定留到所有阶段后的最终验收。T07 的 timeout 不能取消已发出的 SQLite 查询，只保证超时后不把迟到结果当作本次收据成功。当前 ToolReceipt 尚无面向最终用户的历史查看页面；后续 Trace 证据抽屉阶段再提供完整展示。旧 Script Agent 工具仍走原路径，不能把本阶段描述成已迁移所有 Agent。

## 源码索引

| 主题 | 路径 |
| --- | --- |
| 领域与决策 | `CONTEXT.md`、`docs/adr/0014-route-read-agent-tools-through-controlled-runtime.md` |
| 定义与执行 | `src/controlledTools/definitions.ts`、`src/controlledTools/index.ts` |
| 重启收敛 | `src/controlledTools/recovery.ts`、`src/database/readiness.ts` |
| Agent 接线 | `src/agentRuntime/index.ts` |
| Schema 与类型 | `src/lib/initDB.ts`、`src/lib/fixDB.ts`、`src/types/database.d.ts` |
| 聚焦测试 | `tests/controlledTools.test.ts`、`tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts` |
