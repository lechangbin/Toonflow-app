# Agent Harness T21 · 最终验收准备（未执行）

Issue：`lechangbin/Toonflow-app#77`。本文件只记录验收证据索引契约的准备工作，不是最终验收报告。按用户约定，完整单测、构建、跨仓浏览器流程、恢复、安全和 Golden Eval 套件必须等所有阶段实现结束后统一运行；当前全部七类验收项仍为 pending。

`src/eval/finalAcceptanceIndex.ts` 定义版本化证据索引，要求功能、兼容、恢复、安全、评测、构建和浏览器七类逐项记录来源修订、可复现命令、结果哈希和仓库内证据路径。没有这些字段不能写 `passed`；未通过项不能伪填结果哈希。最终修订清单必须覆盖 App、Web、数据库 schema、bundle、Runtime、Tool、Context、Memory、Skill、Topology、Model、Vendor 与 case。付费 Provider canary 另设明确的 not-run/passed/failed 状态；即使结构性验收日后通过，未做付费 canary 仍须单独披露，不能推断真实费用或服务商行为。

补充区分“填好索引”与“核验通过”：`assessFinalAcceptance` 对仅填写元数据的索引永不返回 ready，并列出尚未独立核验的条目；`verifyFinalAcceptance` 必须由外部检查器逐条核验实际证据，且条目来源修订须出现在冻结清单中，才可能返回 ready。注入的检查器接口本身不是文件/命令验证实现，当前没有任何真实证据被核验。

来源修订核对已从“匹配清单任意值”收紧为显式 `sourceComponent`：每项通过声明 App/Web/schema/bundle 等具体组件，核验时只与该组件的冻结修订比对。把 App 修订冒充 Web 来源即使值确实出现在清单里也会拒绝。单个来源组件尚不足以表达跨 App/Web 的联合证据，最终验收仍需检查器逐条读取证据并核对组合关系；当前不宣称已有真实核验。

当前仅运行 `tests/finalAcceptanceIndex.test.ts` 的 3 个契约定向用例和 App TypeScript 检查，验证默认 pending、无证据禁止声称通过、元数据自述不能代替独立核验。没有跑任何 T21 全量套件、构建、浏览器或真实 Provider，也没有填最终 bundle hash。T17、T18、T19、T20 仍有开放工作，因此 T21 不得标为完成。
