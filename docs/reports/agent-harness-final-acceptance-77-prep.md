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
- Web T18 后续将已验证的 `preserveSymlinks` 写入 TypeScript 配置，并同步共享 Trace 抽屉的自动生成组件声明；标准 `yarn type-check` 与完整 `yarn build` 现均通过。Web 修订 `bfc5252` 重建后的 `dist/index.html` 哈希与 App `data/web/index.html` 相同，六个 bundle 文件逐一 SHA-256 相等；这仍是阶段配对，不是最终冻结清单。

## 2026-09-26 本地浏览器/恢复预验收（仅 Script 子集）

以 App T21 代码修订 `dc9c37df`、Web T18 代码修订 `0609a7f5` 构建的 `index.html`（SHA-256 `132c528f8113d07a0c744a06665ae0b54abce0d4e3e36b224636138f02316437`）启动同源本地 App/Web。运行目录是独立临时 SQLite，复制内置 Skill、Vendor 和 Prompt Profile；另发布一个只读 Script Skill，把 `deepseek:fixture-text` 的配置地址指向 `127.0.0.1:10689/v1` 本地假 OpenAI 兼容服务，dummy key 仅用于配置校验。没有真实 Provider 调用或付费。测试 Project 直接种入临时数据库，并在浏览器持久化 store 中选定，因为正常项目创建/选择还要求有效的 Image/Video 模型；因此这里不能声称完整项目入口通过。临时浏览器请求日志未纳入仓库证据，也没有独立复验人。

- 浏览器登录后进入 Script 监督 Harness，`startScriptHarness`、`scriptHarnessControls/list`、`inspect` 与 `traceEvidence` 均返回 200。第一条 Run `b8ebdc94-0418-4e26-9bac-3aef70e1a085` 从 queued 到 succeeded，页面展示本地假模型输出，Trace 为 `run.created → run.started → run.succeeded`。刷新页面后重新进入试用模式，服务端近期 Run、状态与输出重新出现；试用模式本身不会跨刷新自动开启。
- 第二条 Run `95704f89-19f9-41af-a1fa-d0c892a0d2d4` 使用 8 秒慢假服务，在 running 时点击停止，`cancel` 返回 200，Trace 先出现 `run.cancellation-requested`，随后假服务返回，最终 Run 为 succeeded。停止请求不是供应商取消保证，也不能把迟到成功隐瞒成 cancelled；当前界面正确显示服务端终态，但这项体验仍需产品文案评审。
- 第三条 Run `af163834-44b4-4918-ad77-b407634a35ae` 使用 30 秒慢假服务，确认假服务已收到一次调用后中断 App 进程；租约过期后再次重启。浏览器刷新并重新进入 Harness，`list/inspect` 返回 `waiting` 与 `interrupted-model-call`，Trace 为 `run.created → run.started → interrupted-model-call`。临时 SQLite 查询该 Run 的持久 Output 数为 0；假服务日志仅有一次模型请求，重启未重放。它证明这个受控场景的故障分类，不涵盖多进程、真实 Provider 对账或所有恢复分支。

这是一轮手工浏览器预验收，未覆盖 Production、写入审批/拒绝、视频/图片 Vendor、所有旧 Socket 黄金路径、跨入口共同 UI、完整安全矩阵和 Golden Eval；七类最终验收索引仍全部 pending。最终发布前还要把环境搭建与浏览器断言自动化、保存脱敏日志和哈希，并在冻结 App/Web 修订上重跑。

## 2026-09-26 T11 评审记录接线后的复测

T11 新增不可更新的 Golden cell 评审记录表与来源证据复核，并逐级合入 App T21。T11 分支的两项相关定向测试、TypeScript 检查和完整 App Node 测试均退出码 0；T21 合入后两项定向、`yarn lint`、`yarn build` 与完整 App Node 测试也退出码 0。构建仍产生待最终冻结时提交/核对的 `data/serve/app.js`；此次命令输出未保存为带结果哈希的独立发布证据。现有 72-cell Golden 矩阵仍未逐例执行，评审证据路径仅验证格式，不能据此把评测类别写成 passed。

## 2026-09-26 T11 配对报告接线后的复测

T11 增加暂定配对评审矩阵，并要求已评审记录列齐 Golden 声明的产物种类。T11 的两项相关定向测试与 TypeScript 检查通过；改动逐级合入 T18、T19、T20、T21 后，T21 完整 App Node 测试为 713/713 通过。面试导学与追问材料已同步解释 36 对固定分母、未评审/失败显式呈现和“提交评分不等于独立验真”的边界。新报告只在测试夹具中形成一对暂定分差；生产 72-cell 执行、产物内容与哈希独立复算、真实费用、跨仓冻结修订及七类最终验收都未完成。此轮单测输出仍未归档为独立可哈希验收证据，不触发版本发布。

T11 随后增加独立的文件级引用/哈希检查器，但尚未接入配对报告或最终验收，也没有真实 72-cell 产物供验。它能验证本地文件字节与声明哈希，不验证 hard-gate 语义、评审人身份或文件与来源 Run 的业务关系；因此前段“尚未独立复算”仍指当前实际评测证据未经过检查器。该切片的两项定向单测与 TypeScript 检查通过；合入 T21 后再次执行完整 App Node 测试，dot reporter 退出码 0（新增一项测试后的预期总数 714，未从 dot 输出单独复核计数）。导学和面经已追加文件级验证边界。本次输出未归档，七类最终验收仍 pending。

## 2026-09-26 T18 停止竞态与 T11 文件验真后续预验收

本地浏览器隔离假文本 Model 复现：queued→running 时旧 Web 对停止命令收到 409，HTTP 拦截器丢失错误 status 导致未重试，Run 最终成功且没有取消意图。Web T18 修订 `f6126c9` 保留状态；Harness 仅在明确 409 时重读同一 Run，并用同一个命令 ID 最多重试一次。浏览器重新执行登录、Script Run、Trace、刷新恢复和慢模型停止，Run `9679427f-c017-4d93-9421-d66e684f9528` 成功；Run `40a985ed-1943-40b1-8ef0-789380cd9651` 的 Trace 记录 `run.cancellation-requested` 后仍为 succeeded。它证明停止意图已持久化，但不证明运行中外部调用被撤销。App T18 的阶段报告和临时夹具记录复现方式。Web T18 `node --test tests/*.test.ts` 为 127/127 通过，标准 type-check 与 Vite 构建通过；Web `dist` 六文件与 App `data/web` 逐文件 SHA-256 相等，`index.html` 为 `0B14BA5A6A2E7B076069E7A679522E9876C43E16F21733CA78A5EEE70C79AE88`。这仍是阶段配对，非发布冻结。

T11 把文件检查器接入配对报告 v2：明确给出 `artifactRoot` 时逐条复算引用文件哈希，缺失或不符即整份拒绝；未给时 `evidenceFileCheckedRuns=0`。T11 和 T21 合入后的两项定向测试、TypeScript 检查通过。T21 在此次合入前运行完整 App `yarn test`，输出明确为 714/714 通过；合入后仅复跑相关定向测试，最终全量仍须在源码冻结后执行。文件字节核验不等于来源 Run 关联、硬门语义、评审人身份或质量收益。T12–T20 开放条件、72-cell、跨入口浏览器、真实 Vendor 假适配与七类最终独立核验尚未完成，仍不可打 `v*` 标签或发布 Release。

随后以同一隔离 Project 增加浏览器审批/拒绝用例：由 Owner HTTP 接口建立两条单字段候选，页面查看全文后批准其中一条、拒绝另一条，服务端再读确认仅批准目标字段发生变化。Run ID 和测试来源边界见 T18 报告。该用例没有经过模型 Tool 提案，不能替代 Skill 权限链；也未覆盖 Production、Reconnect、跨入口和完整兼容矩阵。因此浏览器类别仍 pending。

再以全新隔离 Project 补上 Script 模型 Tool 正路径：测试 Skill 声明提案 Tool/Capability，Owner 从页面开启 Project grant；本地假 Model 返回函数调用。父 Run `f3f8d970-0137-4cbe-bfc1-cfd3d3f0fb2b` 的脱敏 Trace 有 `tool.proposal.created`，待审卡关联它；审批前服务端 `storySkeleton` 未变，Owner 查看全文并批准子 Run `155afc33-b552-4b92-bbed-89b61881699d` 后才出现精确候选值。`checkScriptModelProposalBrowser.js` 在临时数据库、假 Model 下复现，未调用付费 Provider。这只扩大 Script 正路径覆盖，不代表权限拒绝、恶意参数、Production Vendor、恢复或全入口兼容已验证，浏览器类别继续 pending。

## 2026-09-26 T12 投影同步及全量预检

T12 增量 `9f1bde2c` 经 T13→T20 依赖链同步到 T21；T16 的新增 Script Workspace Tool 不再误走 Novel 投影，T21 保留原有较完整的 T12 导学/面经并补充本次追问。当前 T21 组合的 `tests/context*.test.ts` 与 `tests/finalAcceptanceIndex.test.ts` 合计 21/21 定向用例、TypeScript `--noEmit` 通过。

在当前源码组合上运行 `yarn test`，715/715 自动化测试通过；`yarn build` 成功。`yarn eval:golden` 的旧本地确定性假适配执行 18/18 case，硬门 18/18 通过，人工质量评分仍为 0/18；这不是 T11 的 72-cell 生产 AgentRuntime baseline/candidate 评测，也不能生成真实质量或费用结论。构建生成的 `data/serve/app.js` 仍为未暂存工作树产物，未冻结为发布来源修订；以上命令输出尚未归档为带哈希的独立验收证据。

发布工作流新增 `validate` 前置 job：Linux/Node 24 安装锁定依赖后依次运行类型检查、全量自动化测试和本地确定性 Golden 硬门，三个平台构建均依赖此 job。它尚未在 GitHub Actions 的目标 tag 上实际运行，也不包含 Web 配对、浏览器、恢复、安全独立核验或 72-cell 生产评测；七类最终验收仍全部 pending。任何 `v*` 标签仍必须在最终索引被独立核验、阶段 Issue 收敛及生成物冻结后才可创建。

用户先选择零费用工程准备，后来明确 Agnes 服务商与三个 Flash 模型，并授权受限并发真实测试；当前已做少量单并发 Provider 探针，详见下节。T11/T19/T20 的真实质量结论仍未验证，也不代填人工 rubric。当前个人仓库默认分支 `develop` 的 GitHub Actions workflow 列表为 0，新增发布工作流尚只存在于草稿堆叠分支，不能通过 `workflow_dispatch` 在 GitHub 实跑；不得以本机 YAML 解析替代跨平台 Actions 结果。

| 最终类别 | 当前可核对的预验收 | 正式 `passed` 之前仍需 |
| --- | --- | --- |
| functional | App 当前组合 715/715 Node 测试、类型检查通过 | 冻结源码和数据后复跑完整相关契约，并归档可复算输出 |
| compatibility | 旧 Socket 止损测试及 Script 正路径局部浏览器用例 | 旧入口退场/迁移、App/Web 共同 Run 行为及回滚矩阵 |
| recovery | 单个隔离 Script Run 的进程中断被分为 `interrupted-model-call` | 多入口、审批、付费请求未知效果与跨进程恢复矩阵 |
| security | Project/Tool/Skill 权限的定向拒绝测试 | 跨入口越权、恶意 Tool 参数、导出脱敏与浏览器网络响应核验 |
| evaluation | T02 本地假适配 18/18 硬门；T11 账本、串行续跑与配对报告契约 | 72-cell 生产 Runtime 执行、独立 hard-gate/人工评审和来源核对；真实评测前不得给质量结论 |
| build | 当前 App `yarn build`；先前 Web 六文件阶段配对 | 最终 App/Web 修订、全部 bundle 哈希冻结，目标 tag 的 Actions 平台构建 |
| browser | Script 启动、停止、刷新、审批/拒绝、模型提案局部成功 | Production、跨入口、Reconnect、恢复、旧 Socket 全路径可重复自动化 |

T19 仍只有等资源假 adapter 与拒绝契约，T20 仍只有隔离角色执行壳和未核验阈值候选；两者没有真实候选效果，更无生产拓扑采用决定。这些是发布门槛，不应被 App 单测通过或 18 例本地 Golden 掩盖。

同日再次用独立临时数据库、全新浏览器 profile 和本地假文本 Model 复测 Script 模型 Tool 提案链。旧夹具因首次使用引导遮住 Harness 按钮超时；T18 加入条件跳过后，第二份全新环境一次通过模型提案、Owner 审批前不写入、审批后精确字段回读，父 Run `edc87290-febd-48c5-86a6-17e0b99646a0`、审批 Run `863b82df-75f8-4a81-85c4-3d2a33309b6e`。此次只证明 Script 正路径夹具可在干净 profile 重复，不覆盖 Production、其他两条夹具的干净 profile 重跑、断连/恢复或七类最终独立核验；本地服务与浏览器会话均已停止，隔离临时数据库未当作项目数据提交。

T11 新增单变体串行执行入口后已逐级同步至 T21：预检冻结正文/修订、按 case/seed 逐格等待，并可限制单次新增 cell、复核后续跑。T11 与 T21 的 `tests/evaluationAgentCase.test.ts` 均为 2/2 通过，T21 类型检查通过；测试使用 Fake Model，观察到的局部最大并发为 1。该入口不提供跨进程全局限流，亦不证明真实服务商调用、72-cell 完成或质量收益。合入后没有重做完整 App 测试或发布验收，七类状态仍为 pending。

## 2026-09-27 Agnes Flash 单并发探针与 T21 同步

T17 加入 Agnes 3.0 Flash、Image 2.5 Flash、Video 2.5 Flash 目录与适配器请求翻译，已逐级合入 T11→T18→T19→T20→T21。T21 本次合入发生的唯一冲突为 T17 面经：保留原有生产迁移边界的第 9、10 问，追加新模型适配的第 11 问；未改运行时代码。合入后 Agnes 适配器、能力目录及 Vendor Runtime 的定向测试 32/32、`yarn lint` 通过。未在此源码组合上重跑完整 App、Web、Golden 或浏览器矩阵。

真实服务探针仅通过独立 Agnes CLI 执行，未经过 Toonflow Project→Run→VendorRequest→Artifact 链路。短文本返回预期内容；Image 2.5 Flash 文生图及 1、2、6 张参考图分别返回可检查的非空 PNG；7 张参考图收到明确上限为 6 的拒绝。首次文生图的 CLI 保存逻辑误将空 Base64 字段当作图片，得到 0 字节临时文件；修复本机 CLI 的 URL 回退后才得到有效图片，因此首次文件不得计作成功证据。视频 4 秒/720P 文生视频三次提交均收到 `video_queue_full` 503，未创建任务，停止重试；Video 2.5 的真实出片、下载和业务链路仍未验证。用户另报告 Base64 编码图片作为视频输入实测可用，此处按用户提供的兼容性观察记录，尚非本轮独立可复算的供应商回执。探针结果只支持接口边界核对，不支持质量、费用或端到端可恢复性的结论。

最终七类验收仍全部 pending；正式冻结前还需将 App/Web/Model/Vendor/数据库/产物修订固定，在同一来源组合上重跑全量测试、72-cell 与人工 rubric、真实受控生产生成链、恢复/安全/浏览器矩阵及可复算证据。当前不得打发布标签或创建 Release。

随后修正 Agnes 图片适配器的静默截断：六张参考图原样提交，超过已实测上限的七张在任何网络 POST 前明确拒绝，避免无提示丢失素材。T17 修订 `756a89b5` 已沿依赖分支同步到当前 T21；当前组合的 Agnes/能力目录/Runtime 定向测试仍为 32/32，`yarn lint` 通过。此修正没有改变上述 Provider 探针的覆盖范围，也不触发七类状态更新。

T11 执行口径核对发现，T02 的 18 例是确定性领域场景，不是已经准备好的 18 条生产 Agent 输入。必须先冻结逐例 Runtime fixture、Project 状态与原 hard gate 的证据映射，或明确版本化新的 AgentRuntime corpus；不能用通用提示词填满 72 格后沿用 T02 的 18/18 结论。详见 T11 阶段报告与 Issue #67；evaluation 类别继续 pending。

## 2026-09-27 配置化 Vendor 真实探针（仍非生产链验收）

用户授权后续继续使用 Agnes key，所有真实调用保持单并发，密钥仅来自进程环境。T17 修订 `756a89b5` 的 Agnes 适配器先通过源级 Vendor Runtime 完成一次文生图和一次 Base64 单参考图生成，得到有效 PNG；随后用内存 SQLite 装载同一配置，通过 `createConfiguredVendor` 的真实配置加载与 AI SDK 路径调用 Agnes 3.0 Flash 文本模型，返回精确预期标记；Image 2.5 Flash 经配置化 Vendor 单参考图生成返回 851854 字节 PNG，SHA-256 `c42f5e6eae6e2cdead2f671d9013b12705b2119d53bf7f98b64c0231438b141f`。其它两张图片的大小与哈希见 T17 阶段报告。内存数据库在调用结束后销毁，未持久化密钥或修改用户 Project。

Video 2.5 Flash 的一张 Base64 首帧先经技能 CLI dry-run 检查为 `keyframe`、4 秒、`720P`，实际提交仍明确返回 `video_queue_full` 503，没有任务 ID；队列拒绝不能判定 Base64 首帧是否被服务商接受。应用适配器虽然已有假网络输入映射测试，这次没有视频 Artifact、CDN host 或播放证据。上述文本/图片探针证明配置化 Vendor 层能实际请求当前模型，却没有经过 Project→Asset Brief/Prompt Revision→Owner 审批→持久 VendorRequest→Artifact Revision→工作台读回；输出图片字节未归档成仓库证据，只有脱敏元数据与哈希。因此七类最终验收仍全部 pending，不能据此设置 `paidProviderCanary=passed` 来代表三模型或生产链路均已验收，也不得发布版本。

## 2026-09-27 隔离生产 AgentRun 真实只读探针

T17 增加可显式运行的 `scripts/agnesProductionReadCanary.ts`，已逐级合入 T11→T18→T19→T20→本分支。它在内存 SQLite 中构造最小 Project/Script/生产工作区、已发布只读 Skill 与 Owner grant，把逻辑决策模型绑定 Agnes 3.0 Flash，限制最多两个模型步骤并只提供 `get_production_workspace_text`。密钥仅从 `AGNES_API_KEY` 环境变量读取。同一次脚本先验证默认目录 Run 为 `failed/contextMissing` 且零模型调用，再以 fixture 自定义预算运行一次真实模型：Run `succeeded`，读取回执 1、输出 1（本次 SHA-256 `28b77d3d9977cfb1198141d227a039851ae66c624fed71661453b69d6d7347ad`）、其他 ToolReceipt 0、生成 VendorRequest 0；定向 Production Run 用例 1/1 和类型检查通过。这比 Vendor-only 文本探针多验证了 Skill→grant→模型→受控读取→Run 输出的局部链路，但仍是内存 Fixture，不是用户 Project/浏览器/付费生成或跨进程验收。

首次运行在真实模型调用前因 Agnes 文本模型没有声明 `contextWindowTokens` 而以 `contextMissing` 失败。为了验证其余链路，探针只在内存 `customModels` 中给同名模型声明 4096-token fixture 预算；这是实验预算，不是经 Agnes 官方核实的模型容量，也没有修改默认适配器。因此默认生产 Skill Run 仍存在可复现的配置阻断，functional/compatibility 类别不能因为这次隔离成功而转为 `passed`。后续应先取得可信容量或设计显式安全降级并补定向回归，再做真实项目数据、浏览器和完整效果链验收。七类最终状态继续全部 pending，发布门槛不变。
