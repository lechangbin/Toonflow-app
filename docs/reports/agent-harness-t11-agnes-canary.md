# T11 Agnes 单格纵向探针（非质量结论）

2026-09-27 在隔离的内存 SQLite 上运行 `node --import tsx scripts/agnesRuntimeCorpusCanary.ts`，模型政策接线更新后再次运行同一单格并通过。密钥只从进程环境 `AGNES_API_KEY` 读取，未写入仓库、磁盘数据库或本报告；运行后销毁内存数据库。选择新语料 `DEV-RT-009`、baseline、seed 11，只授权 Production Workspace 读取，不装配任何提案或计费执行器。Agnes 文本模型为 `agnes-3.0-flash`；当前从实际 Vendor 绑定核对温度 0、输出上限 512、上下文窗口 524288，并用固定两步上限包装调用；Model 入口预算为一次，执行串行。

两次观测到的安全摘要一致：Evaluation Run 预期 72 格、已观察 1 格；该格生产 Agent Run 为 `succeeded`，Model 入口调用 1 次，成功的受控读取 ToolReceipt 1 条；独立读取/无副作用检查状态 `verified-read-and-safety-only`，违规项为空。脚本只打印这一份不含回复正文的摘要。它还冻结当前代码/Schema/Tool/Context/Memory/Vendor 文件摘要、Skill 修订和文本模型政策哈希；除实际 Vendor 模型绑定的独立读取外，其他 `currentRevisions` 仍由同一进程提供，非外部构建证明。

本次没有运行 candidate、第二 seed、其他 17 例或全部 72 格；没有盲评、语义 hard gate、真实 Provider 费用凭据或等资源配对。因此质量为 **unverified**、成本为 `null`，不得用本探针声称候选优于基线。内存运行不具备跨进程断点续跑；正式 #105 执行仍需隔离的持久证据存储、凭据不落盘、单执行者限流、实际 baseline/candidate 处理差异及独立人工评审。
