# Agent Harness T21 · 最终验收准备（未执行）

Issue：`lechangbin/Toonflow-app#77`。本文件只记录验收证据索引契约的准备工作，不是最终验收报告。按用户约定，完整单测、构建、跨仓浏览器流程、恢复、安全和 Golden Eval 套件必须等所有阶段实现结束后统一运行；当前全部七类验收项仍为 pending。

`src/eval/finalAcceptanceIndex.ts` 定义版本化证据索引，要求功能、兼容、恢复、安全、评测、构建和浏览器七类逐项记录来源修订、可复现命令、结果哈希和仓库内证据路径。没有这些字段不能写 `passed`；未通过项不能伪填结果哈希。最终修订清单必须覆盖 App、Web、数据库 schema、bundle、Runtime、Tool、Context、Memory、Skill、Topology、Model、Vendor 与 case。付费 Provider canary 另设明确的 not-run/passed/failed 状态；即使结构性验收日后通过，未做付费 canary 仍须单独披露，不能推断真实费用或服务商行为。

当前仅运行 `tests/finalAcceptanceIndex.test.ts` 的 2 个契约定向用例和 App TypeScript 检查，验证默认 pending 与无证据禁止声称通过。没有跑任何 T21 全量套件、构建、浏览器或真实 Provider，也没有填最终 bundle hash。T17、T18、T19、T20 仍有开放工作，因此 T21 不得标为完成。
