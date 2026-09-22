# Agent Harness T06 导学：租约、fencing、取消与重连

> 本文用于理解实现与准备技术追问。按用户要求，不生成简历 bullet 或 HR 文案；效果数字仅引用本阶段聚焦测试，不推断线上收益。

## 1. 前置知识（面试高频标注）

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
| --- | --- | --- | --- |
| 租约与锁的差别 | 租约有过期时间，旧持有者可能继续运行 | `src/agentRuntime/lease.ts` | 极高 |
| 单调 fencing token | 过期不等于旧 worker 停机，写入必须拒绝旧代际 | Run 的 `fence` 与条件更新 | 极高 |
| 本地事务与远端副作用 | Provider 调用不能与 SQLite 原子提交 | intent、调用、终态三个边界 | 极高 |
| 幂等命令与乐观并发 | 重连时重复点击和旧版本提交是不同问题 | command ID、指纹、expectedVersion | 高 |
| 取消意图与终态取消 | 在途模型调用无法靠改数据库状态撤回 | queued/running 两类处理 | 高 |
| 权威快照重建 | Socket 断线不能推断业务任务失败 | list、inspect HTTP 契约 | 高 |
| 数据库升级 | 老 Run 不能凭新增列获得历史所有权 | `initDB`、`fixDB` | 中高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
| --- | --- | --- | --- | --- |
| 有期限的执行所有权 | 避免同一任务被两个 worker 同时推进 | lease、epoch、TTL | `src/agentRuntime/lease.ts` | 1 |
| 旧持有者隔离 | 即使旧模型调用迟到，也不能覆盖新状态 | fencing、conditional write | `src/agentRuntime/index.ts` | 2 |
| 效果安全恢复 | 过期后仍按最后可信意图区分能否重放 | checkpoint、unknown effect | `src/database/agentRunRecovery.ts` | 3 |
| 可重复取消命令 | 同一命令可重试，旧页面不能盲写 | idempotency key、OCC | `src/routes/agentRuns/cancel.ts` | 4 |
| 断线后重新投影 | 业务状态与传输连接解绑 | authoritative snapshot | `src/routes/agentRuns/list.ts` | 5 |

## 3. 必备知识点 checklist

- [ ] 能说明为什么只有 TTL、没有 fencing 的租约不足以阻止迟到写入。
- [ ] 能画出 owner、进程 epoch、fence、过期时间、Run version 各自负责什么。
- [ ] 能说清 heartbeat 为什么不增加生命周期 version，以及续租失败后如何停止提交。
- [ ] 能解释意图 Checkpoint 之后即使租约失效，也不能自动重跑模型。
- [ ] 能区分 queued 取消终态与 running 仅记录取消意图。
- [ ] 能解释相同 command ID 同输入返回当前快照、异输入为何冲突。
- [ ] 能说明断开 Socket 与 Run 持久状态没有因果关系。
- [ ] 能准确承认尚未完成前端重连 UI、真实 Provider abort 与多进程压力验收。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
| --- | --- | --- | --- | --- |
| 领域词汇 | Run、Attempt、Checkpoint、Lease | `CONTEXT.md` | 10 分钟 | 为什么租约不替代 Checkpoint |
| 决策 | 外部副作用、取消边界 | `docs/adr/0013-fence-agent-run-writes-and-separate-cancellation-intent.md` | 10 分钟 | 哪些方案被排除 |
| 所有权 | 领取、续租、失效断言 | `src/agentRuntime/lease.ts` | 25 分钟 | 旧 worker 如何被拒绝 |
| 主链 | 启动、intent、调用、提交、取消、列表 | `src/agentRuntime/index.ts` | 45 分钟 | 每个事务和外部调用的边界 |
| 恢复 | 有效租约跳过、过期后分类 | `src/database/agentRunRecovery.ts` | 30 分钟 | 为什么过期不直接重跑 |
| 升级与路由 | Schema、HTTP 返回 | `src/lib/fixDB.ts`、`src/routes/agentRuns/cancel.ts`、`src/routes/agentRuns/list.ts` | 25 分钟 | 老库如何兼容、新接口如何调用 |
| 测试 | 竞态、版本、升级、恢复 | `tests/agentRunLease.test.ts`、`tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts` | 40 分钟 | 哪些结论有单元证据 |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。建议亲手画两条时间线：一条是“领取→意图→调用→续租→提交”，另一条是“客户端取消/断线→刷新→重新投影”。每个箭头处都问一次：持久记录是什么，旧 worker 是否还能写，Provider 是否可能已经执行。

## 6. 项目技术定位

主方向是 Agent Harness；其次是 Agent 应用开发，AI 应用后端为补充。依据是本阶段重点在 Agent 执行所有权、恢复与命令协议，而不是模型训练、算法调优或离线评测。

## 7. 核心原理解析

1. **并发执行所有权：** 同一 queued Run 可能被重复调度 → 短事务领取带期限的 owner/epoch/fence → 写入前再次验证同一 tuple 与当前前态。
2. **过期后的迟到写：** 旧 worker 不会因 TTL 到点自动停机 → 单调 fence 使新代际可识别 → 旧代际终态事务被拒绝，不提交 Output。
3. **远端效果不确定：** SQLite 无法和 Provider 建立原子事务 → 先持久化调用意图，再做事务外模型请求 → 中断后按 Checkpoint 区分 known/unknown effect。
4. **取消分界：** 用户请求取消不代表模型已停止 → queued 在安全边界可直接终态取消，running 只持久化意图 → 不制造虚假的 Provider 撤销声明。
5. **重连投影：** Socket 连接是传输状态 → Project 范围的 current+20 快照来自数据库 → 刷新时依据服务端事实重建，不根据连接事件改 Run。

## 8. 关键设计决策

| 议题 | 备选 | 取舍 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| 所有权 | 仅布尔锁 / TTL / TTL+fence | 选择 TTL+epoch+fence，避免旧 worker 迟到提交 | 单机 SQLite 不是分布式共识 | 双领取、过期接管、迟到结果测试 |
| 续租 | 每次写入才检查 / 周期续租 | 选择进程内 heartbeat；长模型调用不持有数据库锁 | 进程冻结会失租 | 长调用续租测试 |
| 取消 | 立即改 cancelled / 先记录意图 | 选择效果安全边界：queued 终态、running 意图 | Provider 可能已执行 | 在途取消测试 |
| 恢复 | 过期后直接重跑 / 依据 Checkpoint | 选择后者，保留 unknown-effect 待核对 | 自动恢复率较低 | intent 前后恢复测试 |
| 重连 | 依赖 Socket 会话 / HTTP 权威快照 | 选择持久快照，Socket 不作状态源 | Web UI 尚未接线 | 路由与列表测试；E2E 待测 |

## 9. 量化与验证（含待测，建议）

已验证的是定向单元/契约场景，不是吞吐或线上效果。最终验收建议测量：同 Run 并发领取成功数（预期至多 1）、租约到期后旧 fence 拒绝率（预期 100%）、取消命令重复请求额外状态变更数（预期 0）、断线重连后快照与数据库差异数（预期 0）。这些指标目前未在真实多进程或浏览器环境测量，标记为**待测**。完整仓库测试与构建亦留待所有阶段完成后统一验收。
