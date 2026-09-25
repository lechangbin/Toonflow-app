# Agent Harness T21 面经：最终验收准备阶段版

1. 问：项目已完成最终验收吗？答：没有。当前只实现验收证据索引的严格格式和“无证据不得标通过”校验；功能、兼容、恢复、安全、评测、构建、浏览器七类均未执行完整验收。证据：`src/eval/finalAcceptanceIndex.ts`、`tests/finalAcceptanceIndex.test.ts`。
2. 问：为什么阶段定向单测通过不能说明整个 Harness 可用？答：定向单测覆盖单个契约或假 adapter；跨仓 bundle 配套、浏览器重连、真实进程接管、供应商未知结果、长期证据保留和安全边界仍可能失败。T21 必须用统一修订清单和可复现命令逐类验收，并记录每个失败。
3. 问：没有付费供应商 canary 时，能否说计费正确？答：不能。最终索引把 canary 独立记为 not-run/passed/failed；即使所有确定性假 Provider 与结构性验收以后通过，也只能说明这些受控边界，不能推断真实供应商的费用、CDN 或迟到回调。缺口必须显式披露。
4. 问：如何防止把新 App、旧 Web bundle 和不一致 Model 配置的结果拼在一起？答：最终修订清单须同时冻结 App、Web、schema、bundle、Runtime、Tool、Context、Memory、Skill、Topology、Model、Vendor 与 case；每项通过还要绑定来源修订、测试命令、结果哈希和仓库内证据路径。当前清单为空，因此 readiness=false。

追问底线：本文件是未验收阶段的口头准备材料，不应被当作最终验收结论。
