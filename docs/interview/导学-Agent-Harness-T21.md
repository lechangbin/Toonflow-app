# Agent Harness T21 导学：证据索引不是验收结果

> 当前仅实现最终验收的索引契约。所有验收项仍 pending；不写简历和未测收益。

阅读 `src/eval/finalAcceptanceIndex.ts` 的 `validateFinalAcceptanceIndex` 与 `assessFinalAcceptance`，再看 `tests/finalAcceptanceIndex.test.ts` 如何拒绝“没有命令、结果哈希和证据链接却标记通过”。版本清单列出需要冻结的十三类系统修订，避免拿旧 Web bundle 搭配新 App 声称验收。付费 Provider canary 缺口有独立字段，不会用假 Provider 测试替代。

自测：列出七类最终验收项；解释为什么阶段单测成功不等于浏览器/恢复/安全全通过；说明 paid canary 未运行时可以报告什么、不能报告什么；指出当前索引尚无最终结果文件和验收命令记录。
