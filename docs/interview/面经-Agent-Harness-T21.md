# Agent Harness T21 面经：最终验收准备阶段版

1. 问：项目已完成最终验收吗？答：没有。当前只实现验收证据索引的严格格式和“无证据不得标通过”校验；功能、兼容、恢复、安全、评测、构建、浏览器七类均未执行完整验收。证据：`src/eval/finalAcceptanceIndex.ts`、`tests/finalAcceptanceIndex.test.ts`。
2. 问：为什么阶段定向单测通过不能说明整个 Harness 可用？答：定向单测覆盖单个契约或假 adapter；跨仓 bundle 配套、浏览器重连、真实进程接管、供应商未知结果、长期证据保留和安全边界仍可能失败。T21 必须用统一修订清单和可复现命令逐类验收，并记录每个失败。
3. 问：没有付费供应商 canary 时，能否说计费正确？答：不能。最终索引把 canary 独立记为 not-run/passed/failed；即使所有确定性假 Provider 与结构性验收以后通过，也只能说明这些受控边界，不能推断真实供应商的费用、CDN 或迟到回调。缺口必须显式披露。
4. 问：如何防止把新 App、旧 Web bundle 和不一致 Model 配置的结果拼在一起？答：最终修订清单须同时冻结 App、Web、schema、bundle、Runtime、Tool、Context、Memory、Skill、Topology、Model、Vendor 与 case；每项通过还要声明来源组件和对应修订、测试命令、结果哈希及仓库内证据路径。现在核验不会接受“App 修订碰巧也在清单里，却标成 Web 来源”。跨组件的真实组合仍需独立检查器读证据验证，当前清单为空，因此 readiness=false。
5. 问：把七项都填成 passed 且写上哈希，是否可以直接宣布验收通过？答：不能。字段是提交者声明，索引自检只判断格式；`assessFinalAcceptance` 仍返回 ready=false。只有独立检查器逐条读证据、核验修订与结果后，`verifyFinalAcceptance` 才可能返回 ready；目前尚无真实检查器执行，也没有实际验收数据。单测仅验证该分层契约。

追问底线：本文件是未验收阶段的口头准备材料，不应被当作最终验收结论。
