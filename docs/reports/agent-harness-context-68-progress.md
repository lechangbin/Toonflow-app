# Agent Harness T12 · ContextBundle 构造（阶段进度）

Issue：`lechangbin/Toonflow-app#68`。本报告描述预算与来源规划基础，不代表 ContextBuilder、Agent 迁移或 T21 验收完成。

## 已实现

- `ContextBundle` 加入领域术语表，ADR-0019 固定“先构造并冻结、再提交 Model 调用意图”的决策；旧 Socket Agent 尚未迁移。
- 版本化预算规划按 `min(策略上限, 模型窗口 - 输出预留 - Tool 协议预留 - max(512, 5% 模型窗口))` 计算；先完整保留强制内容，再按普通 45/20/20/15、高风险 60/25/10/5 分配可选内容。低权威类别未用额度仅向高权威类别流动；强制内容溢出在调用前失败。
- 版本化保守 UTF-8 字节估算器、确定性的来源资格筛选与排序：Project、Script、Role、修订、保留状态在相关性排序前检查；来源内容哈希冲突或必需来源缺失均拒绝。规划结果仅保留来源身份、修订、哈希、类别、权威、Token 估算和省略原因，不把原文写进清单条目。

## 阶段验证与边界

`tests/contextBudget.test.ts` 与 `tests/contextSourceSelection.test.ts` 的 6 个定向用例覆盖预算公式、风险配比、向上回流、强制内容溢出、跨 Project/Script 筛选、修订与保留状态、损坏/冲突来源、分配不足时不截断。TypeScript `--noEmit` 检查通过；未运行全量测试、构建、浏览器或真实 Provider。

目前来源规划接受由可信加载器提供的候选记录，还没有从数据库自行装载并核验来源，也没有持久不可变 ContextBundle、完整压缩链、Model Attempt 集成或后续的 Context/Memory ablation。不能把这些纯规划测试当成端到端防泄漏证据。下一切片是数据库来源加载、持久清单和 Runtime 调用前冻结。
