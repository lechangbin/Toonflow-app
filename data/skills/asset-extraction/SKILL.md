---
name: asset-extraction
version: 1
---

# Asset Extraction（Base Asset 双阶段提取技能）

Script Base Asset 提取（Issue #41）使用的版本控制 Skill 模板集合。两个阶段各使用一个独立模板，运行时由 `src/script/baseAssetExtraction.ts` 编排模块按固定路由加载，不进入前端提示词管理（`o_prompt`）。

## 模板路由

| 阶段 | 模板文件 | 加载时机 |
| ---- | ---- | ---- |
| 阶段一：基础资产提取 | `prompts/base_asset_extraction.md` | 每次运行的第一 Text Model 调用，作为 system 提示词 |
| 阶段二：完整性审计 | `prompts/base_asset_completeness_review.md` | 每次运行的第二 Text Model 调用，作为 system 提示词；user 内容为候选清单摘要 + 全部剧本原文 |

## 输入

- 全部选中剧本作为一个完整上下文，以 `===== 【剧本ID: xxx】剧本名 =====` 分隔拼接；
- 两次调用复用任务开始时解析出的同一个配置 Text Model 目标（`universalAi` 逻辑角色）。

## 输出契约

- 阶段一：`resultTool` 工具输出 `{ assets: BaseAssetCandidate[] }`；
- 阶段二：`resultTool` 工具输出 `{ additions, factAdditions, typeCorrections, aliasProposals }`，只能补充遗漏、补充稳定事实、修正类型、提议有证据的别名，不能删除候选、不能产生派生状态资产；
- 字段级契约与确定性校验规则定义在 `src/script/assetExtractionContract.ts`，校验、归并、排序由 `src/script/baseAssetExtraction.ts` 的确定性代码完成。

## 修改规则

模板与代码契约强耦合：修改字段名或输出结构时必须同步更新 `src/script/assetExtractionContract.ts`、两份模板文件及 `tests/baseAssetExtraction.test.ts`，并递增 frontmatter 中的 `version`。
