# Agent Harness T19 · Context/Skill 消融（阶段进度）

Issue：`lechangbin/Toonflow-app#75`。此分支现已合入 T18 App 兼容切片；T18 跨仓兼容与浏览器流程尚未完成。当前只交付评测清单/结果的类型与拒绝契约，没有运行候选消融、没有分数、没有采用某种策略。

`src/eval/ablationContract.ts` 固定两类实验轴。Context 以完整上下文为参考，四个候选分别移除 retrieval、Memory、compaction、provenance，用于区分各层贡献；Skill 以保持权限门的路由为参考，比较显式、关键词、依赖感知、排序路由。所有候选共用相同冻结用例、至少两个递增 seed、相同 token/Tool/超时预算，并锁定 App、Runtime、Tool、Context、Memory、Skill、Model、Vendor、case 清单修订。权限门和四种零容忍硬门不能被消融关闭。

结果契约只接收匹配清单哈希和冻结时间之后的逐 variant/case/seed 记录。重复、缺失、未知组合、未审质量分、无证据的质量分均不能构成可采用结论。汇总分别列出质量阈值、p95 延迟、每例费用上限、重试、资源预算、失败分类和四种安全硬门的分子/分母；没有合成分。任一安全硬门失败或实验矩阵未跑齐，`adoptable` 为 false。结果字段限于指标与证据 ID，不允许原始 Prompt/Provider payload 塞入结果结构。

定向验证：`tests/ablationContract.test.ts` 的 4 例覆盖两类固定候选、重复 seed 与完整矩阵、revision 锁、缺失/重复结果和权限硬门失败；App TypeScript 检查通过。没有调用真实模型、没有开展 Golden Eval 全套、没有生成不可变结果文件。后续需在 T18 兼容边界稳定后冻结实际 case manifest 和版本，接入执行器，预先记录阈值，再跑等资源重复实验、发布逐例结果与拒绝/采用理由。完整验收仍留到 T21。

定向假执行器补充：`src/eval/ablationRunner.ts` 现按冻结清单逐 variant/case/seed 传同一预算和修订给注入 adapter；只收严格的指标结构。adapter 抛错或返回原始 Prompt 等未知字段时，记录不含异常文本的 evidence failure 与未审质量，绝不形成采用结论。新增 2 个假 adapter 单测使相关定向用例共 6 个，App TypeScript 检查通过。它没有实现四种 Context/Skill 的实际运行效果，也没有执行完整 Golden case 或生成不可变结果文件；上一段“尚无执行器”指真实候选执行器，现只有等资源驱动壳。

结果契约补强：清单现在按 case 冻结预期失败类别；例如未经授权请求的正确拒绝可预期 `permission`，正常成功则预期 `none`。汇总增加 `unexpectedFailureClass`，实际类别与预期不符即使质量和安全 gate 都通过，也不可采用。缺失或额外 case 预期在冻结时拒绝。6 个相关定向用例与类型检查通过；这仍不等于实际 case 清单已冻结或真实变体已运行。

采用语义修正：原先纯指标汇总在 Fake adapter 填满质量/延迟/费用后可能返回 `adoptable: true`，但这些 ID 并未核对 T11 的真实 Agent Run 与业务评审。现单独报告 `thresholdsPassed`，而未接独立来源校验前 `adoptable` 恒为 false；不能把指标阈值通过当作方案采用。adapter 异常时延迟、费用、token、Tool 次数与重试数均记为 `null`，`unknownMetrics` 单独计数，不能以 0 冒充无费用或无资源消耗。四个安全硬门同样保持未知 `null`，`hardGateUnknown` 与真正的 `hardGateFailures` 分列；异常不能伪装成已发生泄露，也不能伪装成门禁通过。6 个 T19 定向测试与 TypeScript 检查通过；T11 的逐例真实结果和 T19 的来源核验仍未完成。
