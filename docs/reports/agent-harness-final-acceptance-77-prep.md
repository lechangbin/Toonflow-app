# Agent Harness T21 · 最终验收准备（部分预验收，未通过最终门槛）

Issue：`lechangbin/Toonflow-app#77`。本文件记录验收证据索引契约和一次预验收基线，不是最终验收报告。用户已允许提前推进到全量测试与版本发布准备；在开放阶段尚未收敛、证据尚未独立核验前，七类最终验收项仍全部为 pending。

`src/eval/finalAcceptanceIndex.ts` 定义版本化证据索引，要求功能、兼容、恢复、安全、评测、构建和浏览器七类逐项记录来源修订、可复现命令、结果哈希和仓库内证据路径。没有这些字段不能写 `passed`；未通过项不能伪填结果哈希。最终修订清单必须覆盖 App、Web、数据库 schema、bundle、Runtime、Tool、Context、Memory、Skill、Topology、Model、Vendor 与 case。付费 Provider canary 另设明确的 not-run/passed/failed 状态；即使结构性验收日后通过，未做付费 canary 仍须单独披露，不能推断真实费用或服务商行为。

补充区分“填好索引”与“核验通过”：`assessFinalAcceptance` 对仅填写元数据的索引永不返回 ready，并列出尚未独立核验的条目；`verifyFinalAcceptance` 必须由外部检查器逐条核验实际证据，且条目来源修订须出现在冻结清单中，才可能返回 ready。注入的检查器接口本身不是文件/命令验证实现，当前没有任何真实证据被核验。

来源修订核对已从“匹配清单任意值”收紧为显式 `sourceComponent`：每项通过声明 App/Web/schema/bundle 等具体组件，核验时只与该组件的冻结修订比对。把 App 修订冒充 Web 来源即使值确实出现在清单里也会拒绝。单个来源组件尚不足以表达跨 App/Web 的联合证据，最终验收仍需检查器逐条读取证据并核对组合关系；当前不宣称已有真实核验。

此前仅运行 `tests/finalAcceptanceIndex.test.ts` 的 3 个契约定向用例和 App TypeScript 检查，验证默认 pending、无证据禁止声称通过、元数据自述不能代替独立核验。

## 2026-09-26 预验收基线（非最终证据）

- 在 T21 堆叠分支首次执行 `yarn test`：712 项中 711 通过、1 失败。失败为旧图片账本测试以宽泛名称匹配全部 Agent 身份保护触发器，T17 新增的视频触发器进入结果；经源码与定向检查确认，修正测试查询范围，未改数据库行为。修复从 T17 逐级合入 T21。
- 修复后执行 `node --import tsx --test --test-reporter=dot tests/*.test.ts`，退出码 0；`yarn lint` 与 `yarn build` 均退出码 0。图片与视频 schema 的 3 个定向用例也通过。此次命令输出未保存为带哈希的仓库证据，且构建生成物仍需在最终源码冻结后重新核对；不能把这轮运行直接登记为七类验收 `passed`。
- 尚未执行跨仓浏览器、真实进程恢复、安全与 Golden Eval 最终矩阵，也未冻结 App/Web 等联合修订、真实 Provider canary 或最终 bundle hash。T12–T20 仍有开放工作，T21 不得标为完成，更不得据此发布 GitHub 版本。
- Web T18 预验收发现单资产计费审批面板在阻塞的 Vendor POST 期间停止请求状态轮询；修复已从 Web T09 逐级合入 T18。Web T18 的定向测试 19/19、全部 Node 测试 125/125、Vite 生产构建通过。原仓库 `yarn type-check` 通过；T18 工作树因 `node_modules` junction 产生 TS2742，使用 `vue-tsc --noEmit -p tsconfig.app.json --preserveSymlinks` 验证通过。此轮仍未形成冻结 Web bundle 和跨仓浏览器证据。

## 2026-09-26 本地浏览器/恢复预验收（仅 Script 子集）

以 App T21 代码修订 `dc9c37df`、Web T18 代码修订 `0609a7f5` 构建的 `index.html`（SHA-256 `132c528f8113d07a0c744a06665ae0b54abce0d4e3e36b224636138f02316437`）启动同源本地 App/Web。运行目录是独立临时 SQLite，复制内置 Skill、Vendor 和 Prompt Profile；另发布一个只读 Script Skill，把 `deepseek:fixture-text` 的配置地址指向 `127.0.0.1:10689/v1` 本地假 OpenAI 兼容服务，dummy key 仅用于配置校验。没有真实 Provider 调用或付费。测试 Project 直接种入临时数据库，并在浏览器持久化 store 中选定，因为正常项目创建/选择还要求有效的 Image/Video 模型；因此这里不能声称完整项目入口通过。临时浏览器请求日志未纳入仓库证据，也没有独立复验人。

- 浏览器登录后进入 Script 监督 Harness，`startScriptHarness`、`scriptHarnessControls/list`、`inspect` 与 `traceEvidence` 均返回 200。第一条 Run `b8ebdc94-0418-4e26-9bac-3aef70e1a085` 从 queued 到 succeeded，页面展示本地假模型输出，Trace 为 `run.created → run.started → run.succeeded`。刷新页面后重新进入试用模式，服务端近期 Run、状态与输出重新出现；试用模式本身不会跨刷新自动开启。
- 第二条 Run `95704f89-19f9-41af-a1fa-d0c892a0d2d4` 使用 8 秒慢假服务，在 running 时点击停止，`cancel` 返回 200，Trace 先出现 `run.cancellation-requested`，随后假服务返回，最终 Run 为 succeeded。停止请求不是供应商取消保证，也不能把迟到成功隐瞒成 cancelled；当前界面正确显示服务端终态，但这项体验仍需产品文案评审。
- 第三条 Run `af163834-44b4-4918-ad77-b407634a35ae` 使用 30 秒慢假服务，确认假服务已收到一次调用后中断 App 进程；租约过期后再次重启。浏览器刷新并重新进入 Harness，`list/inspect` 返回 `waiting` 与 `interrupted-model-call`，Trace 为 `run.created → run.started → interrupted-model-call`。临时 SQLite 查询该 Run 的持久 Output 数为 0；假服务日志仅有一次模型请求，重启未重放。它证明这个受控场景的故障分类，不涵盖多进程、真实 Provider 对账或所有恢复分支。

这是一轮手工浏览器预验收，未覆盖 Production、写入审批/拒绝、视频/图片 Vendor、所有旧 Socket 黄金路径、跨入口共同 UI、完整安全矩阵和 Golden Eval；七类最终验收索引仍全部 pending。最终发布前还要把环境搭建与浏览器断言自动化、保存脱敏日志和哈希，并在冻结 App/Web 修订上重跑。
