# Agent Harness T10 · 因果 Trace 与证据导出（阶段报告）

报告契约：`toonflow.t10-evidence-report.v1`。Issue：`lechangbin/Toonflow-app#66`。本文件只报告 T10 分支可定位的实现与定向测试，不是 T21 全量验收或生产运行报告。

## 版本化证据

| 维度 | 契约版本 | 当前机制 | 定向证据 | 边界 |
| --- | --- | --- | --- | --- |
| 因果完整性 | `toonflow.trace-timeline-evidence.v1` | 每 Run 按持久序号审计连续性及前驱；`linked`、`legacy-unlinked`、`corrupt` 明确分开 | `tests/agentRunRuntime.test.ts`、`tests/agentRunSchema.test.ts`、`tests/controlledTools.test.ts`、`tests/derivedAssetWrite.test.ts`、`tests/agentTraceEvidence.test.ts` | 旧记录不补造前驱；不是加密不可抵赖链 |
| 失败分类 | `toonflow.trace-failure-classification.v1` | 当前 Harness 已识别失败事件的新写入强制安全诊断，旧事件缺失则标 `legacy-unclassified` 并显示分母 | `tests/causalTrace.test.ts`、`tests/agentTraceEvidence.test.ts`、`tests/billableImageApproval.test.ts` | 只统计当前词表内已存在的 Trace，不声称旧业务路径全覆盖 |
| 脱敏 | `toonflow.trace-redaction-evidence.v1` | 服务端 Owner 校验、字段白名单、安全诊断复核、完整投影扫描；仅通过后输出 `passed` | `tests/agentTraceEvidence.test.ts`、Web `tests/agentTraceEvidence.test.ts` | 仅覆盖此导出接口；其他日志与下载后传播不在证明范围 |
| 保留 | `toonflow.agent-evidence-retention.v1` | Project 存续期不自动清理；Owner 删除 Project 时数据库事务清除关联 Agent 证据；导出对象不在服务端另存 | `tests/agentEvidenceRetention.test.ts`、`tests/agentRunSchema.test.ts` | 项目媒体目录在数据库提交后清理，失败单独报告，尚无自动重试 |
| 导出包 | `toonflow.agent-trace-export.v1` | 包含以上三个版本化片段与事件列表，超 5000 条或损坏时拒绝 | `tests/agentTraceEvidence.test.ts` | 不声称超限 Run 已完整导出 |

## 因果覆盖范围

统一追加器校验事件所带 Run、Step、Attempt、ToolReceipt、ToolCall、VendorRequest 和 ImageArtifact 身份。Run 创建、执行意图、成功、失败、取消、恢复、受控读工具、衍生资产审批，以及 T09 单资产计费图片的审批、请求意图、未知、取消、迟到、产物与本地接受均使用事务内追加。`src/agentRuntime/causalTrace.ts` 是新写入的唯一直接 `o_agentTrace` 插入点；导出按序号和前驱核对。旧批量生图和历史 Run 不因此自动获得完整因果身份，不能宣称“全业务路径 100% 覆盖”。

诊断在写入和导出两端使用受控字段合同，不存原始异常消息、堆栈、提示词、Provider payload、Base64、签名 URL 或媒体路径。失败阶段与效果确定性依照当前 Trace-safe taxonomy；Provider 请求后的不确定效果不会归类为可直接重试的已知无效果。衍生资产审批的过期、冲突和证据损坏以及计费图片审批过期均写入 Trace-safe 授权失败诊断；用户主动拒绝保留为决定事件，不误标成系统故障。当前没有对所有旧代码路径做全系统失败分类审计。

## 阶段验证与未完成项

本轮更新后，因果/导出/审批定向单测 21 个通过；受影响的 Run/Schema/受控工具/计费 Ledger、执行与产物单测 67 个通过；留存与删除 3 个定向用例在前一轮通过。`yarn lint`（TypeScript `--noEmit`）通过。Web 抽屉用例重跑 2 个通过，类型检查通过；删除提醒用例此前通过。没有运行仓库全量测试、构建或浏览器端到端。

T21 最终验收仍需：全量单测与构建、跨仓浏览器交互、真实 Provider 成功/未知/迟到对账、跨进程并发、磁盘清理故障、敏感信息抓包审查和长期存储容量测量。此阶段不运行这些全量测试，也不宣称线上效果。面试准备材料见 `docs/interview/导学-Agent-Harness-T10.md` 与 `docs/interview/面经-Agent-Harness-T10.md`；简历由用户自行编写。
