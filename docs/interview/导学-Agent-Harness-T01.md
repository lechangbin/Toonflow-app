# Agent Harness T01 导学：可复现的原项目基线

> 对应已关闭 Issue #57 和 `docs/reports/agent-harness-baseline-57.md`。这是后续 T02–T21 的来源与构建基线，不是 Agent Runtime 功能。历史报告记录了当时的完整测试和构建结果；按当前迭代约定，本次材料补写不重新运行全量测试。不给出简历 bullet。

## 前置知识

| 知识点 | 为什么需要 | 项目位置 | 高频度 |
| --- | --- | --- | --- |
| Git 提交图、merge-base、Git blob | 证明接受/排除的改动与精确来源 | `docs/reports/agent-harness-baseline-57.md` | 高 |
| 锁文件与工具链 | 避免“本机能跑”依赖隐式版本 | App/Web `package.json`、`yarn.lock` | 高 |
| 前后端构建产物归属 | 区分权威源码与嵌入 App 的 Web bundle | App `data/web`、Web `dist` | 高 |
| 生成文件稳定性 | 防止 clean checkout 需要先运行一次生成器 | Web 的 Vite 声明、`.gitattributes` | 中 |
| 测试层级 | 区分历史完整基线和未来 T 阶段定向验证 | 基线报告的 Gate results | 高 |

## 重点亮点与学习顺序

| 亮点 | 核心问题 | 先看文件 | 顺序 |
| --- | --- | --- | --- |
| 精确提交身份 | 哪些原项目修复进入后续 Harness 基座 | 基线报告的 Frozen source identities | 1 |
| 干净检出验证 | 锁定依赖后能否无本机缓存启动 | 基线报告的 Toolchain/Gate results | 2 |
| 生成产物溯源 | App 中的 Web 页面来自哪个 Web 修订 | 基线报告的 Generated bundle provenance | 3 |
| 排除错误合并 | 如何证明确实没带入被拒绝的 #32 | 基线报告的 merge-base 证据 | 4 |
| 后续工作边界 | T01 为何不能说 Agent Harness 已完成 | `docs/reports/agent-harness-open-stage-sequence.md` | 5 |

## 必备知识点

- [ ] 说明 App 和 Web 各自的最终基线 commit，而不是只说“当时 main 分支”。
- [ ] 解释为什么 hash Git blob 字节而不是 Windows checkout 里的换行转换结果。
- [ ] 说明为什么 Web 的生成声明必须在首次 `type-check` 前就可用。
- [ ] 区分 Web `dist`、App `data/web` 和 App `data/serve/app.js` 的来源。
- [ ] 解释 `git merge-base --is-ancestor` 退出码能证明什么、不能证明什么。
- [ ] 分开讲历史 T01 全量验证与当前 T02–T20 只跑定向单测的约定。

## 推荐阅读

| 主题 | 技术点 | 建议阅读位置 | 预计时间 | 能回答什么 |
| --- | --- | --- | --- | --- |
| 工作流 | 个人仓库、上游只读、Issue/PR | `docs/agents/issue-tracker.md`、`docs/agents/codebase-guide.md` | 20 分钟 | 为什么版本证据在个人仓库冻结 |
| 来源身份 | Git 提交图、排除项 | `docs/reports/agent-harness-baseline-57.md` 前两节 | 25 分钟 | 合并的具体起点是什么 |
| 环境身份 | Node/Yarn/锁文件/数据库初始化 | 同报告 Toolchain、Database 节 | 25 分钟 | 如何排查环境漂移 |
| 产物复现 | Web 生成声明、Bundle 哈希 | 同报告 Generated bundle provenance | 30 分钟 | 源码和页面是否同源 |
| 历史门禁 | App/Web 的测试、类型、构建 | 同报告 Gate results、Reproduction procedure | 30 分钟 | 当时通过了哪些验证 |
| 后续继承 | T02 Golden Eval 的版本来源 | `docs/reports/agent-harness-golden-58.md` | 15 分钟 | 基线之后第一步是什么 |

自学提醒：若 Git blob、构建链或锁文件原理看不懂，请继续追问 AI；本导学只给学习路径和可核验事实，不代替逐行讲解。

## 项目技术定位

T01 的价值是为二次开发建立“在相同源代码与工具链下可以复现”的起点。它服务后续 Agent Harness 实验归因，也保证原有生成链路修复的来源可追踪；本身不实现 Model 路由、Run、Tool 或审批。

## 核心原理解析

1. 问题：App/Web 双仓有不同修订和生成产物。机制：分别冻结 commit，Web 构建后按相对路径和 SHA-256 核对 App 嵌入页面。落点：报告的源身份与 bundle 表。
2. 问题：开发者机器曾生成类型声明，干净检出可能缺文件。机制：把生成声明纳入版本控制与漂移检测，验证首次 type-check 无需先跑 Vite。落点：Web 基线 PR #2/#3 的 Gate results。
3. 问题：Windows 换行转换使工作树字节哈希与仓库内容不同。机制：对 Git blob 计算 canonical SHA-256，并固定生成文件换行规则。落点：报告的锁文件与声明哈希。
4. 问题：被拒绝的改动可能无意混进基线。机制：用提交祖先关系明确排除 #32，而不是仅凭 PR 状态推测。落点：报告的 merge-base 验证。
5. 问题：后续评测无法归因起点。机制：记录工具链、依赖锁、数据库初始化、App/Web 构建产物和执行命令。落点：基线报告的复现步骤。

## 关键设计决策

| 选择 | 备选 | 取舍与风险 | 已有证据 |
| --- | --- | --- | --- |
| 双仓精确 commit | 只记默认分支名称 | 文档较繁，但版本不会随分支移动 | Frozen source identities |
| 干净检出验证 | 用本机缓存判定 | 成本较高，但暴露隐式依赖 | Gate results |
| Git blob canonical hash | 直接 hash Windows 工作树 | 避免换行假漂移，须解释字节口径 | Toolchain/生成产物表 |
| 源码与产物分离 | 直接改生成 bundle | 构建要额外核对，但保持权威来源清晰 | Generated bundle provenance |

## 量化与验证边界

基线报告记录 App `406/406` 测试、Web 合约 `89/89`、类型检查及两仓构建在其冻结修订下通过；这些是 2026-09-20 的历史证据，不等于今天堆叠的 T02–T21 分支已通过全量验证，也不是线上稳定性或真实 Provider 结果。当前只补写导学与面经，未重新执行全套命令。
