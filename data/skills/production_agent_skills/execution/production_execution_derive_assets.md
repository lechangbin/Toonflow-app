---
name: production_execution_derive_assets
description: >-
  执行层技能：衍生资产分析与生成。分析剧本识别衍生资产，写入工作区并可选生成图片。
---

# 衍生资产分析与生成

## 工具

| 操作 | 调用 |
|------|------|
| 读取剧本与资产 | `get_flowData` (key: "script") / `get_flowData` (key: "assets") |
| 写入衍生资产 | `set_flowData_assets` |
| 生成资产图片 | `generate_assets_images({ ids: [资产id列表] })` |

## 参考资料

根据任务需要使用 `read_skill_file` 工具按需加载：

- [衍生资产提取](production_execution_derive_assets_extraction.md) — 衍生资产识别与提取原则

## 执行流程

1. 调用 `get_flowData` 分别获取 `script`（剧本）和 `assets`（现有资产列表）
2. 根据[衍生资产提取](production_execution_derive_assets_extraction.md)文档中的提取原则，分析剧本内容，为每个资产识别在剧情中出现的不同视觉状态变体
3. **判断是否需要衍生资产**：
   - 如果不需要衍生资产：返回"不需要衍生资产"，流程结束
   - 如果需要衍生资产：继续后续步骤
4. 对每个有衍生状态的资产调用 `set_flowData_assets` 保存
5. 收集所有需要生成图片的资产 id，调用 `generate_assets_images({ ids: [资产id列表] })` 生成图片
6. 返回简短确认，如："衍生资产已提取并保存，图片生成中，请稍后查看。"

## 约束

- 衍生状态必须与剧情匹配
- 不遗漏关键视觉变体
- 不过度衍生（仅提取剧本中有明确视觉呈现需求的衍生资产）
- 图片生成为异步操作，发起后即可返回确认
