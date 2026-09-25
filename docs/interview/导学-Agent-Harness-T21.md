# Agent Harness T21 导学：证据索引不是验收结果

> 当前仅实现最终验收的索引契约。所有验收项仍 pending；不写简历和未测收益。

阅读 `src/eval/finalAcceptanceIndex.ts` 的 `validateFinalAcceptanceIndex`、`assessFinalAcceptance` 与 `verifyFinalAcceptance`，再看 `tests/finalAcceptanceIndex.test.ts` 如何拒绝“没有命令、结果哈希和证据链接却标记通过”，以及为什么仅填满这些字段也不等于证据已核验。版本清单列出需要冻结的十三类系统修订，避免拿旧 Web bundle 搭配新 App 声称验收。付费 Provider canary 缺口有独立字段，不会用假 Provider 测试替代。

自测：列出七类最终验收项；解释为什么阶段单测成功不等于浏览器/恢复/安全全通过；说明 paid canary 未运行时可以报告什么、不能报告什么；指出当前索引尚无最终结果文件和验收命令记录。

补充追问：若某项填了 App 修订，却把来源组件标为 Web，仅凭“这个修订值也在最终清单里”能否通过？为什么单组件核对仍不能替代 App/Web/bundle 联合证据检查？
