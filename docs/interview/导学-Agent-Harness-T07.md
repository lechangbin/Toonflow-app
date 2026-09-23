# Agent Harness T07 导学：受控只读 Tool

> 本文用于理解实现和准备技术追问。按用户要求不编写简历内容；未测量的收益保持为待测。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| Tool Calling 的信任边界 | 模型给出的工具名和参数都不能自动获得数据权限 | `src/controlledTools/index.ts` | 极高 |
| Project 数据隔离 | 知道章节 ID 不等于有权读取其正文 | Run Project 与 Novel Project 双重过滤 | 极高 |
| 幂等身份 | 同一模型调用可能因传输或重试重复进入 | `(runId, operationId)` 收据唯一约束 | 极高 |
| 严格输入与输出 schema | 只校验输入无法防适配器返回异常结构 | `definitions.ts` 的双向 schema | 高 |
| 租约与迟到写 | 旧 worker 可能在读取结束后失去 Run 所有权 | ToolReceipt 终态前的 lease 断言 | 高 |
| 证据与内容分离 | 排障链路不应复制小说正文 | ToolReceipt 内容、Trace 结构事实 | 高 |
| 重启收敛 | 先写 pending 后进程中断会留下悬挂调用 | `recovery.ts` | 中高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 最小权限执行入口 | 模型只能请求既定读取能力 | allowlist、least privilege | `src/controlledTools/definitions.ts`、`src/controlledTools/index.ts` | 1 |
| 跨项目授权 | 阻断猜测 ID 读取他人项目 | resource ownership、scope | `src/controlledTools/index.ts` 的授权事务 | 2 |
| 持久幂等收据 | 保留一次逻辑调用的结果和失败事实 | operation identity、receipt | `src/lib/initDB.ts`、`src/controlledTools/index.ts` | 3 |
| 受限输出与安全诊断 | 防止非预期内容进入模型上下文和 Trace | strict schema、redaction | `src/diagnostics/traceSafeDiagnostics.ts` | 4 |
| 进程中断恢复 | 避免 pending 永久悬挂 | lease、recovery | `src/controlledTools/recovery.ts` | 5 |
| Agent 接线 | 验证工具真正用于模型调用 | AI SDK Tool Calling | `src/agentRuntime/index.ts` | 6 |

## 3. 必备知识点 checklist

- [ ] 能说明 ToolDefinition、ToolReceipt、Agent Trace、Agent Checkpoint 分别证明什么。
- [ ] 能画出校验输入、查 Run、校验租约、校验 Novel 归属、去重、提交 pending、执行适配器、验证输出、提交终态的顺序。
- [ ] 能解释为什么不能把模型传入的 Project ID 用作授权依据。
- [ ] 能解释相同 operation ID 复用不同参数为什么必须拒绝。
- [ ] 能说明 `get_novel_events` 为什么返回 `truncated`。
- [ ] 能解释 Trace 为什么不保存小说正文，Receipt 为什么保存受限输出和哈希。
- [ ] 能说明 5 秒超时无法杀掉正在执行的 SQLite 查询，但能阻止迟到结果写成成功。
- [ ] 能诚实指出旧 Script Agent 工具尚未迁移、真实模型 Tool Calling 尚未最终验收。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域词汇 | Run、ToolDefinition、ToolReceipt、Trace | `CONTEXT.md` | 10 分钟 | 收据与 Checkpoint 的差异 |
| 架构决策 | 受控执行、最小上下文 | `docs/adr/0014-route-read-agent-tools-through-controlled-runtime.md` | 10 分钟 | 为什么不能直接暴露旧 Socket 工具 |
| 契约 | 版本、策略、双向 schema | `src/controlledTools/definitions.ts` | 20 分钟 | revision 如何阻止静默改约 |
| 主链 | 授权、去重、收据、诊断 | `src/controlledTools/index.ts` | 45 分钟 | 每个失败点写入什么 |
| 数据库 | 表、唯一约束、不可变触发器、升级 | `src/lib/initDB.ts`、`src/lib/fixDB.ts` | 25 分钟 | 新旧数据库如何兼容 |
| 接线与重启 | Model Tools、租约、pending 恢复 | `src/agentRuntime/index.ts`、`src/controlledTools/recovery.ts` | 30 分钟 | 旧 worker 和重启如何处理 |
| 单元证据 | 负面用例、竞态 | `tests/controlledTools.test.ts`、`tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts` | 35 分钟 | 目前证明了哪些性质 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。建议以“模型请求章节 ID=11，但 Run 属于 Project 7，章节属于 Project 8”为例，逐行追踪何时拒绝、是否执行适配器、数据库留下什么安全证据。

## 6. 项目技术定位

主方向是 Agent Harness，第二方向是 Agent 应用开发，AI 应用后端为补充。T07 的核心是 Agent 工具权限、执行协议与证据，不涉及算法训练或模型结构研究。

## 7. 核心原理解析

1. **不可信模型参数：** 模型可生成任意 Tool 输入 → 严格 schema 和白名单 ToolDefinition → 未经校验的参数不能进入适配器。
2. **资源级授权：** Run 有 Project，Novel 也有 Project → 数据库在适配器前核对二者归属 → 猜测其他项目的 ID 只得到安全拒绝。
3. **重复调用：** 网络和模型运行可能重复请求同一操作 → Run 内 operation ID 加输入指纹和唯一约束 → 重放返回同一收据，改参冲突。
4. **受限证据：** 小说正文需要交给模型，但不能复制到每条 Trace → Receipt 保存受限输出与 hash，Trace 保存收据 ID 和安全诊断 → 排障时可验证事实且降低内容扩散。
5. **失去所有权：** 读取适配器结束时 Run 可能已被恢复或取消 → 终态收据前再核对租约 → 旧 worker 无法写成功，重启收敛 pending。

## 8. 关键设计决策

| 议题 | 备选 | 取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| Tool 入口 | 直接重用 Socket 回调 / 受控 Runtime | 选择受控 Runtime，模型不拿 DB/Socket | 旧 Agent 仍需后续迁移 | Agent Run 工具接线测试 |
| 章节身份 | 章节序号 / 数据库 ID | 选择 Novel ID，便于精确归属校验 | 前端需传正确 ID | 跨项目 ID 负面测试 |
| 重复读取 | 每次重查 / 持久收据 | 选择同一 operation 返回收据 | Receipt 保存受限项目内容 | 重复与篡改测试 |
| 事件上限 | 超限失败 / 截前 20 并标记 | 选择稳定排序与 `truncated` | 超长详情仍失败 | 21 条事件测试 |
| 异常输出 | 尽量清洗 / 严格拒绝 | 选择 fail closed | 部分合法长文本可能无法读取 | 超长、异常、敏感内容测试 |

## 9. 量化与验证（含待测，建议）

已完成的是受控单元与契约验证。最终验收建议统计：跨项目请求导致适配器执行的次数（预期 0）、重复 operation 导致的额外执行次数（预期 0）、异常输出进入 Trace 的次数（预期 0）、失租后迟到成功写入数（预期 0）、长文本和多事件的实际拒绝/截断比例。真实模型、浏览器和多进程环境的这些数据均为**待测**，不能从本阶段单元测试推算线上效果。
