# Agent Harness T13 面经：Project Memory（阶段版）

> 面向 Agent Harness / Agent 应用开发。只覆盖已提交代码的阶段性边界，不提供简历 bullet；个人职责须以实际提交核对。Issue #69 未关闭，摘要来源图、旧 Memory 逐条迁移、语义检索和 T21 验收未完成。

## 项目说明

ToonFlow 原有 Socket 会话 Memory 依靠客户端隔离键保存聊天内容，不能证明 Project 所属和生成过程已经提交。T13 新增 Project 作用域的逐字片段 Memory，使可用的连续性文本能追溯到一次成功提交的 Agent Output，并在再次用于 Model 上下文前复验。这个机制证明来源，不保证模型先前的陈述是真实事实。

## 主问与追问

1. 问：为什么旧 Socket Memory 不能直接迁移？答：旧隔离键是客户端形状的字符串，不能独立证明一行内容属于当前 Project，也没有 Run、Step、Output 和提交 Checkpoint 的因果证据。直接批量迁移会把无法验证的历史文字升级为新 Context 的可信数据。T13 保留旧表给兼容路径，新增 Memory 从同 Project 的已提交 Output 捕获；升级测试证明旧行没有自动进入新表。追问：旧数据是否因此丢失？答：没有，旧 UI 仍可按旧路径读取，但不能借其隔离键获得新 Runtime 的授权。
2. 问：什么条件下才能捕获一段 Memory？答：输入必须明确 Project、Run、Step、Output 和 Unicode code-point 片段范围；在同一数据库事务内核对它们的归属、成功 Step/Attempt、提交 Checkpoint 的 payload/hash、Output schema/hash及安全文本。流片段、失败尝试或未提交 Tool 输出缺少这组证据，会在插入前失败。测试先尝试不存在的 Output，再运行假 Model 后成功捕获。追问：为何要同事务？答：防止验证通过后来源被改、Memory 却先落库。
3. 问：为什么只做逐字片段，不直接总结成事实？答：模型总结会引入新判断，若没有每条总结语句到原始来源的映射，很难回答“这句话从哪里来、是否变形”。T13 先支持已提交 Output 的精确区间，记录完整 Output 哈希、起止位置和片段哈希。它证明来源可定位，不证明原 Output 本身正确。后续摘要来源图与人工/规则审查尚未实现，不能说已有已验证知识库。追问：怎么验证总结？答：需要保存语句级来源边与审查结果，再做独立质量评测。
4. 问：为什么用 Unicode code point 定位？答：JavaScript UTF-16 下标遇到表情等代理项字符时，显示位置和字符串索引可能不一致。捕获时先把 Output 展成 code point 序列，再按起点和长度截取，越界拒绝；读取时对同一来源重新截取比对。测试用含表情的短文本证明片段没有错位。这个设计只解决代码点位置一致性，不保证语义边界合理。追问：如果原文改了？答：Output 哈希或片段 revision 不一致，消费前拒绝。
5. 问：同一片段重复捕获会发生什么？答：Memory 的身份由来源 Output、类型和 code-point 范围确定；第一次插入后，相同请求重试会返回原记录，不多建一条。若同身份下的 Project、Run、Step、内容哈希或 revision 不一致，则作为证据冲突拒绝。这样能防止断线重试导致重复连续性材料，但不代表所有 Memory 操作都具备跨进程恰好一次语义。追问：为什么不按内容去重？答：同样文字来自不同来源时因果身份不同，不能合并。
6. 问：Capture 成功以后为什么 ContextBuilder 还要再检查来源？答：持久记录可能在以后遇到来源损坏、Attempt 状态变化、撤销或 Project/Script 作用域变更。消费前按当前 Run 的 Project、Role 和 Script 找 active Memory，再验证来源 Run、Step、Attempt、Output、Checkpoint、片段范围与 revision，才能作为候选。测试改坏 Output 哈希和 Attempt 状态后确认拒绝；这不等于可以恢复被物理破坏的数据。追问：高风险请求是否例外？答：不例外，仍走相同严格验证。
7. 问：来源可核验是否等于事实真实？答：完全不是。来源链说明“这段文字从某次成功 Agent 输出的哪个位置来”，而那次回答可能本来就是模型推断或错误。T13 将 confidence 固定为逐字来源类型，进入上下文时标为数据且权威低于当前 Project 事实。面试中应主动区分 provenance 与 truth；当前没有事实核验、置信晋升或摘要准确率数据。追问：怎样才能称事实已验证？答：需要独立源文、审查规则或人工证据与可复现实验。
8. 问：为什么 Memory 不能成为 system 指令？答：它可能包含模型历史输出或用户控制的文本，若提升为 system 消息，会把低权威内容变成行为约束，给提示词注入和错误事实放大创造路径。新 ContextBuilder 将 Memory 写成标注 data/not instructions 的 `user` 消息，并纳入 memory 类别预算；受控 Tool、权限与安全合同仍由更高权威边界决定。这个结构能限制权限升级，不能保证模型完全不受恶意语句影响。追问：怎么验证？答：需结合 Golden 安全硬门和真实 Agent 效果测试。
9. 问：跨 Project 的 Memory ID 被请求时会怎样？答：加载器先以当前 Run 的 Project、Role 和 active 状态查询，跨 Project ID 不会被查出；必需 Memory 随后由 ContextBuilder 的 required-source 检查失败，不会退而用其他 Project 的同名内容。捕获端也核对来源 Run 所属 Project。当前测试分别覆盖跨 Project 捕获和同范围消费，完整对抗性跨仓验收仍在 T21。追问：只检查 Memory 行的 Project 字段够吗？答：不够，还要复验其来源 Run/Output 的作用域。
10. 问：Script 维度为什么也要匹配？答：同一个 Project 内可有不同剧本或制作阶段，一段从某剧本输出抽取的连续性文字不应自动影响另一个剧本。Memory 保存来源 Script，加载时要求与当前 Run 的 Script 相同，并且来源 Run 也要重新核对。Project 级来源可用空 Script 表示，但不能在查询时用缺失值猜测其他作用域。追问：跨角色能否共享？答：当前默认按角色过滤，跨角色共享须单独建立授权和证据契约。
11. 问：撤销与删除有什么区别？答：撤销是 Project 作用域的版本/命令 ID 绑定状态转换，重复同命令返回原结果，不同命令冲突；被撤销的 Memory 不再进入新 Bundle，但来源与记录仍保留供审计。普通更新/删除受数据库触发器限制。只有删除整个 Project 时，授权事务才先清理 Memory 再清来源证据。测试覆盖撤销幂等、篡改拒绝和 Project 删除。追问：撤销会收回模型已看到的内容吗？答：不会，只能阻止后续纳入。
12. 问：如果 Capture 时 Output 哈希正确，但 Checkpoint 不匹配呢？答：哈希正确只能证明当前 Output 内容与字段自洽，不能证明它已成为 Run 的提交结果。捕获还解析并验算 `step-committed` Checkpoint，要求其 Run/Step/Attempt 与 Output ID、内容哈希一致，Attempt 也必须成功。缺失或不匹配就拒绝创建 Memory。这是“存在的文本”与“已提交的 Agent 效果”之间的分界。追问：Checkpoint 可以替代所有审计吗？答：不能，完整因果链仍需 T21 验收。
13. 问：Memory 为什么有 revision 和 contentHash 两套信息？答：contentHash 用来发现片段字节改变；revision 还绑定来源 Output 哈希与 code-point 范围，使相同文本但来自不同位置或不同源版本的记录不能被当成同一证据。Context 加载器重算两者，并把 revision 放进候选来源清单。测试破坏来源后读取失败；这些哈希只能发现不一致，不能解释文字的业务含义。追问：相同字句换了位置呢？答：revision 会变化，不能复用旧定位。
14. 问：T13 与 T12 ContextBundle 怎样分工？答：T12 负责预算、授权筛选、不可变输入和来源清单；T13 定义一种新来源的捕获与读时验证，再交给 ContextBuilder 作为低权威候选。Memory 请求可以声明 required；缺失或无资格时在 Model 调用前失败。不能把 T12 的基础或 T16 的生产 Skill 接线都算成 T13 一次性交付。追问：若可选 Memory 超预算？答：按预算省略并记录原因，不能静默截断其内容。
15. 问：T13 目前为什么仍不能关单？答：目前只支持成功 Output 的逐字片段及撤销，旧表保留但无逐条可验证迁移；摘要来源图、多来源聚合、语义检索、事实置信晋升和跨仓最终验收都未完成。两个定向 SQLite/Fake Model 用例与类型检查只能证明局部来源链。面试时应说“可核验来源的 Memory 基础”，不能说“完整长期记忆系统”或报准确率、用户收益。追问：下一步先做什么？答：先定义摘要的语句级来源与失效规则，再做兼容迁移和真实 Eval。

## 源码证据索引

| 主题 | 关键路径与内部符号 | 对应问题 |
| --- | --- | --- |
| 领域与决策 | `CONTEXT.md`、`docs/adr/0020-project-memory-requires-committed-source.md` | 1、3、7 |
| 捕获与撤销 | `src/memory/projectMemory.ts`、`createProjectMemoryStore` | 2–5、11–13 |
| 消费与来源复验 | `src/memory/contextSources.ts`、`createProjectMemoryContextSourceLoader` | 6、9–10、13–14 |
| Context 接线 | `src/context/index.ts`、`src/context/sourceSelection.ts` | 8–9、14 |
| 生命周期与测试 | `src/lib/initDB.ts`、`src/agentRuntime/retention.ts`、`tests/projectMemory.test.ts` | 11–12、15 |

## 阶段交接与高风险 Claim

可核验事实：新 Memory 只收已提交 Output 的可定位逐字片段，消费前复验来源，按 Project/Script/Role 限定，撤销后不再纳入 Context。个人 ownership 需对照提交记录；不存在真实准确率、长期用户使用、摘要收益或“事实自动验证”证据。最终 ASu 口播长度和逐题追问门禁仍待全部实现与 T21 验收后统一复核，本文件不标为最终成稿。
